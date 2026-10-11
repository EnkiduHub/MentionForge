import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { allowedFetch } from "../../src/lib/allowlist";
import {
  isSubsourceDisabled,
  WRANGLER_DISABLED_SOURCES,
} from "../../src/lib/disabled-sources";
import { overlayBilling, runResearch } from "../../src/lib/research/engine";
import { hnItemUrl } from "../../src/lib/research/hn";
import { projectCompare, projectDigest, projectList, projectReply, projectRisk } from "../../src/lib/lenses";
import { parseResearchInput, researchResponseSchema } from "../../src/schemas/research";
import {
  HN_STUB_AUTHOR,
  HN_STUB_OBJECT_ID,
  HN_STUB_STORY,
  HN_STUB_TITLE,
  executionCtx,
  hnAlgoliaJson,
  jsonResponse,
  mockEnv,
  setGlobalFetch,
  stubCaches,
} from "../helpers/env";

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
    if (url.startsWith("https://news.google.com/")) {
      forbidden.push(url);
      throw new Error(`forbidden host fetch ${url}`);
    }
    if (url.startsWith("https://hn.algolia.com/")) {
      return jsonResponse(hnAlgoliaJson());
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
  return [...raw.matchAll(/"DISABLED_SOURCES"\s*:\s*"([^"]+)"/g)].map((m) => m[1]!);
}

function assertNoHnTitleAuthor(body: unknown) {
  const raw = JSON.stringify(body);
  expect(raw).not.toContain(HN_STUB_TITLE);
  expect(raw).not.toContain(HN_STUB_AUTHOR);
  expect(raw).not.toMatch(/"username"\s*:/);
}

function billingMeta() {
  return {
    request_id: "req",
    latency_ms: 1,
    billing: { amount_usdc: "0", tx_hash: null, free_trial: true },
  };
}

describe("news sub-sources gnews/hn", () => {
  beforeEach(() => {
    stubCaches();
  });

  it("gnews stays fail-closed; hn is on unless listed", () => {
    expect(isSubsourceDisabled(mockEnv({ DISABLED_SOURCES: undefined }), "gnews")).toBe(true);
    expect(isSubsourceDisabled(mockEnv({ DISABLED_SOURCES: undefined }), "hn")).toBe(false);
    expect(isSubsourceDisabled(mockEnv({ DISABLED_SOURCES: "x,reddit" }), "gnews")).toBe(true);
    expect(isSubsourceDisabled(mockEnv({ DISABLED_SOURCES: "x,reddit" }), "hn")).toBe(false);
    expect(isSubsourceDisabled(mockEnv({ DISABLED_SOURCES: WRANGLER_DISABLED_SOURCES }), "gnews")).toBe(true);
    expect(isSubsourceDisabled(mockEnv({ DISABLED_SOURCES: WRANGLER_DISABLED_SOURCES }), "hn")).toBe(false);
    expect(isSubsourceDisabled(mockEnv({ DISABLED_SOURCES: "x,reddit,gnews,hn" }), "hn")).toBe(true);
  });

  it("wrangler top-level, staging, and production all set x,reddit,gnews", () => {
    const values = wranglerDisabledSources();
    expect(values.length).toBeGreaterThanOrEqual(3);
    expect(values.every((v) => v === WRANGLER_DISABLED_SOURCES)).toBe(true);
    expect(WRANGLER_DISABLED_SOURCES).toBe("x,reddit,gnews");
  });

  it("fetches HN with default settings and never fetches Google News; GDELT still runs", async () => {
    const { forbidden, fetched } = stubNewsFetch();
    const { body } = await runResearch(
      mockEnv(),
      parseResearchInput({ query: "ForgeCo" }),
      "req",
      executionCtx(),
    );
    expect(forbidden).toEqual([]);
    expect(fetched.some((u) => u.startsWith("https://hn.algolia.com/"))).toBe(true);
    expect(fetched.some((u) => u.startsWith("https://news.google.com/"))).toBe(false);
    expect(fetched.some((u) => u.includes("api.gdeltproject.org"))).toBe(true);
    expect(citationHosts(body.citations.map((c) => c.url))).not.toContain("news.google.com");
    const hnCite = body.citations.find((c) => c.source === "hn");
    expect(hnCite?.url).toBe(hnItemUrl(HN_STUB_OBJECT_ID));
    expect(hnCite?.title).toBe("example.com");
    expect(hnCite?.title).not.toBe(HN_STUB_TITLE);
    assertNoHnTitleAuthor(body);
  });

  it("fetches HN with the production DISABLED_SOURCES value and never fetches Google News", async () => {
    const { forbidden, fetched } = stubNewsFetch();
    await runResearch(
      mockEnv({ DISABLED_SOURCES: WRANGLER_DISABLED_SOURCES }),
      parseResearchInput({ query: "ForgeCo" }),
      "req",
      executionCtx(),
    );
    expect(forbidden).toEqual([]);
    expect(fetched.some((u) => u.startsWith("https://hn.algolia.com/"))).toBe(true);
    expect(fetched.some((u) => u.startsWith("https://news.google.com/"))).toBe(false);
    expect(fetched.some((u) => u.includes("api.gdeltproject.org"))).toBe(true);
  });

  it("platforms [news] uses GDELT plus HN links/counts, not Google News", async () => {
    const { forbidden, fetched } = stubNewsFetch();
    const { body } = await runResearch(
      mockEnv({ DISABLED_SOURCES: WRANGLER_DISABLED_SOURCES }),
      parseResearchInput({ query: "ForgeCo", platforms: ["news"] }),
      "req",
      executionCtx(),
    );
    expect(forbidden).toEqual([]);
    expect(fetched.some((u) => u.includes("api.gdeltproject.org"))).toBe(true);
    expect(fetched.some((u) => u.startsWith("https://hn.algolia.com/"))).toBe(true);
    const hosts = citationHosts([...body.mentions.map((m) => m.url), ...body.citations.map((c) => c.url)]);
    expect(hosts).not.toContain("news.google.com");
    expect(body.mentions.every((m) => m.platform === "news")).toBe(true);
    expect(body.citations.some((c) => c.source === "gdelt")).toBe(true);
    expect(body.citations.some((c) => c.source === "hn")).toBe(true);
    const hnRows = body.mentions.filter((m) => m.url.includes("news.ycombinator.com"));
    expect(hnRows.length).toBeGreaterThan(0);
    for (const row of hnRows) {
      expect(row.url).toBe(hnItemUrl(HN_STUB_OBJECT_ID));
      expect(row.story_url).toBe(HN_STUB_STORY);
      expect(row.created_bucket).toMatch(/T00:00:00.000Z$/);
      expect(row.points).toBe(17);
      expect(row.comments).toBe(5);
      expect(row).not.toHaveProperty("title");
      expect(row).not.toHaveProperty("text");
      expect(row).not.toHaveProperty("author");
      expect(row).not.toHaveProperty("username");
    }
    expect(body.volume.by_platform.news).toBeGreaterThan(0);
    assertNoHnTitleAuthor(body);
    expect(researchResponseSchema.safeParse({
      ...body,
      meta: { ...body.meta, request_id: "r", latency_ms: 1, billing: { amount_usdc: "0", tx_hash: null, free_trial: true } },
    }).success).toBe(true);
  });

  it("omits HN title and author from lens and research routes", async () => {
    stubNewsFetch();
    const { body } = await runResearch(
      mockEnv(),
      parseResearchInput({ query: "ForgeCo", platforms: ["news"] }),
      "req",
      executionCtx(),
    );
    const full = overlayBilling(body, billingMeta(), "live");
    const routes = [
      full,
      projectDigest(full),
      projectList(full),
      projectRisk(full),
      projectReply(full, { query: "ForgeCo", stance: "neutral" }),
      projectCompare(full, ["ForgeCo"]),
    ];
    for (const payload of routes) {
      assertNoHnTitleAuthor(payload);
    }
  });

  it("outbound allowlist allows HN Algolia and rejects Google News", async () => {
    await expect(allowedFetch("https://news.google.com/rss/search?q=a")).rejects.toThrow(/blocked host/);
    setGlobalFetch(async () => jsonResponse({ hits: [] }));
    const res = await allowedFetch("https://hn.algolia.com/api/v1/search?query=a");
    expect(res.status).toBe(200);
  });
});
