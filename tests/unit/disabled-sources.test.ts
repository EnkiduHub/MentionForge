import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { runResearch } from "../../src/lib/research/engine";
import {
  fetchTargetsDisabledSocial,
  parseDisabledSources,
  urlUsesDisabledSocial,
} from "../../src/lib/disabled-sources";
import { parseResearchInput } from "../../src/schemas/research";
import { executionCtx, jsonResponse, mockEnv, setGlobalFetch, stubCaches } from "../helpers/env";
import { sourceBackends } from "../../src/lib/source-backends";

const SOCIAL_HOST = /(?:^|\/\/)(?:www\.)?(?:x\.com|twitter\.com|reddit\.com)\b/i;

function assertNoDisabledSocialFetch(url: string) {
  expect(fetchTargetsDisabledSocial(url, parseDisabledSources("x,reddit")), url).toBe(false);
  expect(url, url).not.toMatch(SOCIAL_HOST);
}

describe("DISABLED_SOURCES", () => {
  beforeEach(() => {
    stubCaches();
  });

  it("parses a comma list of platform ids", () => {
    expect([...parseDisabledSources("x, reddit,nope")].sort()).toEqual(["reddit", "x"]);
    expect(parseDisabledSources(undefined).size).toBe(0);
    expect(urlUsesDisabledSocial("https://www.reddit.com/r/x/1", parseDisabledSources("x,reddit"))).toBe(true);
    expect(urlUsesDisabledSocial("https://x.com/a/status/1", parseDisabledSources("x,reddit"))).toBe(true);
    expect(urlUsesDisabledSocial("https://en.wikipedia.org/wiki/ForgeCo", parseDisabledSources("x,reddit"))).toBe(false);
    expect(fetchTargetsDisabledSocial("https://api.search.brave.com/res/v1/web/search?q=ForgeCo%20site%3Ax.com%20OR%20site%3Atwitter.com", parseDisabledSources("x,reddit"))).toBe(true);
    expect(fetchTargetsDisabledSocial("https://api.search.brave.com/res/v1/web/search?q=ForgeCo%20site%3Areddit.com", parseDisabledSources("x,reddit"))).toBe(true);
  });

  it("health reports x and reddit as disabled", async () => {
    const env = mockEnv({
      DISABLED_SOURCES: "x,reddit",
      REDDIT_CLIENT_ID: "id",
      REDDIT_CLIENT_SECRET: "secret",
      X_BEARER_TOKEN: "bearer",
    });
    expect(sourceBackends(env)).toMatchObject({ x: "disabled", reddit: "disabled", reviews: "web" });
    const app = createApp();
    const res = await app.fetch(new Request("https://mentionforge.test/health"), env, executionCtx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source_backends: { x: string; reddit: string } };
    expect(body.source_backends.x).toBe("disabled");
    expect(body.source_backends.reddit).toBe("disabled");
  });

  it("does not fetch x.com, twitter.com, reddit.com, or Brave site: queries, and drops those URLs", async () => {
    const seen: string[] = [];
    setGlobalFetch(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      seen.push(url);
      assertNoDisabledSocialFetch(url);
      if (url.startsWith("https://news.google.com/")) {
        throw new Error(`forbidden host fetch ${url}`);
      }
      if (url.startsWith("https://hn.algolia.com/")) {
        return jsonResponse({ hits: [] });
      }
      if (url.includes("wikipedia.org/w/api.php")) {
        return jsonResponse({ query: { search: [{ title: "ForgeCo", snippet: "A fictional brand" }] } });
      }
      if (url.includes("wikipedia.org/api/rest_v1")) {
        return jsonResponse({
          title: "ForgeCo",
          extract: "ForgeCo is a fictional research brand used in tests.",
          content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/ForgeCo" } },
        });
      }
      if (url.includes("wikidata.org")) {
        return jsonResponse({
          search: [{ id: "Q1", label: "ForgeCo", description: "fictional", concepturi: "https://www.wikidata.org/entity/Q1" }],
        });
      }
      if (url.includes("brave.com")) {
        return jsonResponse({
          web: {
            results: [
              { title: "ForgeCo", url: "https://example.com/about", description: "ForgeCo site" },
              { title: "ForgeCo tweet", url: "https://x.com/ops/status/9", description: "ForgeCo" },
              { title: "ForgeCo twitter", url: "https://twitter.com/ops/status/9", description: "ForgeCo" },
              { title: "ForgeCo reddit", url: "https://www.reddit.com/r/saas/comments/z", description: "ForgeCo" },
              { title: "ForgeCo review", url: "https://www.trustpilot.com/review/forgeco", description: "ForgeCo reviews" },
            ],
          },
        });
      }
      if (url.includes("gdeltproject.org")) {
        return jsonResponse({
          articles: [
            {
              url: "https://example.com/forgeco-gdelt",
              title: "ForgeCo ships",
              seendate: `${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`,
              domain: "example.com",
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    });

    const env = mockEnv({
      DISABLED_SOURCES: "x,reddit",
      BRAVE_API_KEY: "brave",
      REDDIT_CLIENT_ID: "id",
      REDDIT_CLIENT_SECRET: "secret",
      X_BEARER_TOKEN: "bearer",
    });
    const { body } = await runResearch(
      env,
      parseResearchInput({
        query: "ForgeCo",
        platforms: ["x", "reddit", "web", "reviews", "news"],
        timeframe: "7d",
        include_summary: false,
      }),
      "req",
      executionCtx(),
    );

    expect(seen.length).toBeGreaterThan(0);
    for (const url of seen) assertNoDisabledSocialFetch(url);
    expect(seen.some((u) => u.includes("api.x.com") || u.includes("api.twitter.com"))).toBe(false);
    expect(seen.some((u) => /oauth\.reddit\.com|www\.reddit\.com/.test(u))).toBe(false);

    const urls = [...body.mentions.map((m) => m.url), ...body.citations.map((c) => c.url)];
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(urlUsesDisabledSocial(url, parseDisabledSources("x,reddit")), url).toBe(false);
      expect(url).not.toMatch(/x\.com|twitter\.com|reddit\.com/i);
    }
    expect(body.mentions.some((m) => m.platform === "x" || m.platform === "reddit")).toBe(false);
    expect(body.meta.sources_used).not.toEqual(expect.arrayContaining(["x", "reddit"]));
    expect(body.meta.sources_disabled).toEqual(["reddit", "x"]);
  });

  it("throws SOURCE_UNAVAILABLE without fetching when only disabled sources are requested", async () => {
    const seen: string[] = [];
    setGlobalFetch(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      seen.push(url);
      throw new Error(`unexpected fetch ${url}`);
    });
    await expect(
      runResearch(
        mockEnv({ DISABLED_SOURCES: "x,reddit" }),
        parseResearchInput({ query: "ForgeCo", platforms: ["x", "reddit"] }),
        "req",
        executionCtx(),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
    expect(seen).toEqual([]);
  });
});
