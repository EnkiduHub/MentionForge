import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { allowedFetch } from "../../src/lib/allowlist";
import {
  isSubsourceDisabled,
  WRANGLER_DISABLED_SOURCES,
} from "../../src/lib/disabled-sources";
import { runResearch } from "../../src/lib/research/engine";
import { parseResearchInput } from "../../src/schemas/research";
import { executionCtx, jsonResponse, mockEnv, setGlobalFetch, stubCaches } from "../helpers/env";

function gdeltSeenDate(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

function stubNewsFetch() {
  const forbidden: string[] = [];
  const fetched: string[] = [];
  setGlobalFetch(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    fetched.push(url);
    if (url.startsWith("https://news.google.com/") || url.startsWith("https://hn.algolia.com/")) {
      forbidden.push(url);
      throw new Error(`forbidden host fetch ${url}`);
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
    if (url.includes("api.gdeltproject.org")) {
      return jsonResponse({
        articles: [
          {
            url: "https://example.com/forgeco-gdelt",
            title: "ForgeCo ships from GDELT",
            seendate: gdeltSeenDate(),
            domain: "example.com",
            language: "English",
          },
        ],
      });
    }
    return jsonResponse({}, 404);
  });
  return { forbidden, fetched };
}

function citationHosts(urls: string[]): string[] {
  return urls.map((u) => {
    try {
      return new URL(u).hostname.replace(/^www\./, "");
    } catch {
      return u;
    }
  });
}

function wranglerDisabledSources(): string[] {
  const raw = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
  const matches = [...raw.matchAll(/"DISABLED_SOURCES"\s*:\s*"([^"]+)"/g)].map((m) => m[1]!);
  return matches;
}

describe("news sub-sources gnews/hn", () => {
  beforeEach(() => {
    stubCaches();
  });

  it("isSubsourceDisabled is fail-closed for unset, x,reddit, and production value", () => {
    expect(isSubsourceDisabled(mockEnv({ DISABLED_SOURCES: undefined }), "gnews")).toBe(true);
    expect(isSubsourceDisabled(mockEnv({ DISABLED_SOURCES: undefined }), "hn")).toBe(true);
    expect(isSubsourceDisabled(mockEnv({ DISABLED_SOURCES: "x,reddit" }), "gnews")).toBe(true);
    expect(isSubsourceDisabled(mockEnv({ DISABLED_SOURCES: "x,reddit" }), "hn")).toBe(true);
    expect(isSubsourceDisabled(mockEnv({ DISABLED_SOURCES: WRANGLER_DISABLED_SOURCES }), "gnews")).toBe(true);
    expect(isSubsourceDisabled(mockEnv({ DISABLED_SOURCES: WRANGLER_DISABLED_SOURCES }), "hn")).toBe(true);
  });

  it("wrangler top-level, staging, and production all set x,reddit,gnews,hn", () => {
    const values = wranglerDisabledSources();
    expect(values.length).toBeGreaterThanOrEqual(3);
    expect(values.every((v) => v === WRANGLER_DISABLED_SOURCES)).toBe(true);
    expect(WRANGLER_DISABLED_SOURCES).toBe("x,reddit,gnews,hn");
  });

  it("does not fetch Google News or HN when DISABLED_SOURCES is unset; GDELT still runs", async () => {
    const { forbidden, fetched } = stubNewsFetch();
    const { body } = await runResearch(
      mockEnv(),
      parseResearchInput({ query: "ForgeCo" }),
      "req",
      executionCtx(),
    );
    expect(forbidden).toEqual([]);
    expect(fetched.some((u) => u.includes("api.gdeltproject.org"))).toBe(true);
    expect(citationHosts(body.citations.map((c) => c.url))).not.toContain("news.google.com");
    expect(citationHosts(body.citations.map((c) => c.url))).not.toContain("news.ycombinator.com");
  });

  it("does not fetch Google News or HN with the production DISABLED_SOURCES value", async () => {
    const { forbidden, fetched } = stubNewsFetch();
    await runResearch(
      mockEnv({ DISABLED_SOURCES: WRANGLER_DISABLED_SOURCES }),
      parseResearchInput({ query: "ForgeCo" }),
      "req",
      executionCtx(),
    );
    expect(forbidden).toEqual([]);
    expect(fetched.some((u) => u.includes("api.gdeltproject.org"))).toBe(true);
  });

  it("platforms [news] only uses GDELT", async () => {
    const { forbidden, fetched } = stubNewsFetch();
    const { body } = await runResearch(
      mockEnv({ DISABLED_SOURCES: WRANGLER_DISABLED_SOURCES }),
      parseResearchInput({ query: "ForgeCo", platforms: ["news"] }),
      "req",
      executionCtx(),
    );
    expect(forbidden).toEqual([]);
    expect(fetched.some((u) => u.includes("api.gdeltproject.org"))).toBe(true);
    const hosts = citationHosts([...body.mentions.map((m) => m.url), ...body.citations.map((c) => c.url)]);
    expect(hosts).not.toContain("news.google.com");
    expect(hosts).not.toContain("news.ycombinator.com");
    expect(body.volume.by_platform.news).toBeGreaterThan(0);
    expect(body.mentions.every((m) => m.platform === "news")).toBe(true);
    expect(body.mentions.every((m) => m.url.includes("gdelt") || m.url.includes("example.com"))).toBe(true);
    expect(body.citations.every((c) => c.source === "gdelt")).toBe(true);
    expect(body.volume.by_platform.news).toBe(body.mentions.filter((m) => m.url.includes("example.com/forgeco-gdelt")).length);
  });

  it("outbound allowlist rejects Google News and HN Algolia", async () => {
    await expect(allowedFetch("https://news.google.com/rss/search?q=a")).rejects.toThrow(/blocked host/);
    await expect(allowedFetch("https://hn.algolia.com/api/v1/search?query=a")).rejects.toThrow(/blocked host/);
  });
});
