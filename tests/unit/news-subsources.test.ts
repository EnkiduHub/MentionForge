/// <reference types="node" />
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

function googleNewsRss(opts?: { title?: string; link?: string; description?: string }): string {
  const title = opts?.title ?? "ForgeCo ships from Google News";
  const link = opts?.link ?? "https://example.com/forgeco-gnews";
  const description = opts?.description ?? "ForgeCo coverage on Google News.";
  const pub = new Date().toUTCString();
  return `<?xml version="1.0"?><rss><channel><item><title><![CDATA[${title}]]></title><link>${link}</link><description><![CDATA[${description}]]></description><pubDate>${pub}</pubDate></item></channel></rss>`;
}

function stubNewsFetch(opts?: { skipGnews?: boolean; skipHn?: boolean }) {
  const fetched: string[] = [];
  setGlobalFetch(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    fetched.push(url);
    if (url.startsWith("https://news.google.com/")) {
      if (opts?.skipGnews) return new Response("", { status: 404 });
      return new Response(googleNewsRss(), {
        status: 200,
        headers: { "content-type": "application/rss+xml" },
      });
    }
    if (url.startsWith("https://hn.algolia.com/")) {
      if (opts?.skipHn) return jsonResponse({}, 404);
      return jsonResponse({
        hits: [
          {
            objectID: "1",
            title: "ForgeCo on HN",
            url: "https://example.com/forgeco-hn",
            author: "ops",
            created_at: new Date().toISOString(),
            points: 10,
            num_comments: 2,
            story_text: "ForgeCo discussion",
          },
        ],
      });
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
  return { fetched };
}

function wranglerDisabledSources(): string[] {
  const raw = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
  return [...raw.matchAll(/"DISABLED_SOURCES"\s*:\s*"([^"]+)"/g)].map((m) => m[1]!);
}

describe("news sub-sources gnews/hn", () => {
  beforeEach(() => {
    stubCaches();
  });

  it("isSubsourceDisabled is off by default; only listed tokens disable", () => {
    expect(isSubsourceDisabled(mockEnv({ DISABLED_SOURCES: undefined }), "gnews")).toBe(false);
    expect(isSubsourceDisabled(mockEnv({ DISABLED_SOURCES: undefined }), "hn")).toBe(false);
    expect(isSubsourceDisabled(mockEnv({ DISABLED_SOURCES: "x,reddit" }), "gnews")).toBe(false);
    expect(isSubsourceDisabled(mockEnv({ DISABLED_SOURCES: "x,reddit" }), "hn")).toBe(false);
    expect(isSubsourceDisabled(mockEnv({ DISABLED_SOURCES: WRANGLER_DISABLED_SOURCES }), "gnews")).toBe(false);
    expect(isSubsourceDisabled(mockEnv({ DISABLED_SOURCES: WRANGLER_DISABLED_SOURCES }), "hn")).toBe(false);
    expect(isSubsourceDisabled(mockEnv({ DISABLED_SOURCES: "x,reddit,gnews" }), "gnews")).toBe(true);
    expect(isSubsourceDisabled(mockEnv({ DISABLED_SOURCES: "hn" }), "hn")).toBe(true);
  });

  it("wrangler top-level, staging, and production all set x,reddit", () => {
    const values = wranglerDisabledSources();
    expect(values.length).toBeGreaterThanOrEqual(3);
    expect(values.every((v) => v === WRANGLER_DISABLED_SOURCES)).toBe(true);
    expect(WRANGLER_DISABLED_SOURCES).toBe("x,reddit");
    expect(WRANGLER_DISABLED_SOURCES).not.toMatch(/\b(?:gnews|hn|brave|reviews)\b/);
  });

  it("fetches Google News by default and results flow into output", async () => {
    const { fetched } = stubNewsFetch();
    const { body } = await runResearch(
      mockEnv(),
      parseResearchInput({ query: "ForgeCo" }),
      "req",
      executionCtx(),
    );
    expect(fetched.some((u) => u.startsWith("https://news.google.com/rss/search"))).toBe(true);
    expect(fetched.some((u) => u.includes("hl=en-US") && u.includes("gl=US") && u.includes("ceid=US:en"))).toBe(true);
    expect(fetched.some((u) => u.includes("api.gdeltproject.org"))).toBe(true);
    const gnewsCite = body.citations.find((c) => c.source === "google-news");
    expect(gnewsCite).toBeTruthy();
    expect(gnewsCite?.url).toBe("https://example.com/forgeco-gnews");
    expect(gnewsCite?.title).toBe("ForgeCo ships from Google News");
    const gnewsMention = body.mentions.find((m) => m.url === "https://example.com/forgeco-gnews");
    expect(gnewsMention).toBeTruthy();
    expect(gnewsMention?.platform).toBe("news");
    expect(gnewsMention?.text).toContain("ForgeCo ships from Google News");
    expect(gnewsMention?.text).toContain("ForgeCo coverage on Google News");
    expect(body.volume.by_platform.news).toBeGreaterThan(0);
  });

  it("fetches Google News with the production DISABLED_SOURCES value", async () => {
    const { fetched } = stubNewsFetch();
    const { body } = await runResearch(
      mockEnv({ DISABLED_SOURCES: WRANGLER_DISABLED_SOURCES }),
      parseResearchInput({ query: "ForgeCo" }),
      "req",
      executionCtx(),
    );
    expect(fetched.some((u) => u.startsWith("https://news.google.com/rss/search"))).toBe(true);
    expect(fetched.some((u) => u.includes("api.gdeltproject.org"))).toBe(true);
    expect(body.citations.some((c) => c.source === "google-news")).toBe(true);
  });

  it("platforms [news] includes Google News, GDELT, and headline citations", async () => {
    const { fetched } = stubNewsFetch();
    const { body } = await runResearch(
      mockEnv({ DISABLED_SOURCES: WRANGLER_DISABLED_SOURCES }),
      parseResearchInput({ query: "ForgeCo", platforms: ["news"] }),
      "req",
      executionCtx(),
    );
    expect(fetched.some((u) => u.startsWith("https://news.google.com/rss/search"))).toBe(true);
    expect(fetched.some((u) => u.includes("api.gdeltproject.org"))).toBe(true);
    expect(body.mentions.every((m) => m.platform === "news")).toBe(true);
    expect(body.mentions.some((m) => m.url === "https://example.com/forgeco-gnews")).toBe(true);
    expect(body.mentions.some((m) => m.url === "https://example.com/forgeco-gdelt")).toBe(true);
    const gdelt = body.mentions.find((m) => m.url.includes("forgeco-gdelt"));
    expect(gdelt?.text).toBe("ForgeCo ships from GDELT");
    expect(body.citations.find((c) => c.source === "gdelt")?.title).toBe("ForgeCo ships from GDELT");
    expect(body.citations.find((c) => c.source === "google-news")?.title).toBe("ForgeCo ships from Google News");
    const hn = body.mentions.find((m) => m.url === "https://example.com/forgeco-hn");
    expect(hn?.text).toContain("ForgeCo on HN");
    expect(hn?.text).toContain("ForgeCo discussion");
    expect(body.citations.find((c) => c.source === "hn")?.title).toBe("ForgeCo on HN");
    expect(body.volume.by_platform.news).toBeGreaterThanOrEqual(2);
  });

  it("does not fetch Google News when gnews is listed in DISABLED_SOURCES", async () => {
    const { fetched } = stubNewsFetch();
    const { body } = await runResearch(
      mockEnv({ DISABLED_SOURCES: "gnews" }),
      parseResearchInput({ query: "ForgeCo", platforms: ["news"] }),
      "req",
      executionCtx(),
    );
    expect(fetched.some((u) => u.includes("news.google.com"))).toBe(false);
    expect(fetched.some((u) => u.includes("api.gdeltproject.org"))).toBe(true);
    expect(body.citations.every((c) => c.source !== "google-news")).toBe(true);
  });

  it("outbound allowlist accepts Google News and HN Algolia", async () => {
    setGlobalFetch(async () => new Response("ok", { status: 200 }));
    await expect(allowedFetch("https://news.google.com/rss/search?q=a")).resolves.toMatchObject({ status: 200 });
    await expect(allowedFetch("https://hn.algolia.com/api/v1/search?query=a")).resolves.toMatchObject({ status: 200 });
  });
});
