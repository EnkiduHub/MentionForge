import { describe, expect, it, beforeEach } from "vitest";
import { runResearch, researchCacheKey, buildPolishPrompt } from "../../src/lib/research/engine";
import { xSearchUrl } from "../../src/lib/research/sources/x";
import { fetchReviews } from "../../src/lib/research/sources/reviews";
import { parseDisabledSources, DEFAULT_DISABLED_SOURCES } from "../../src/lib/disabled-sources";
import { RESEARCH_ALLOW, assertAllowlist, walkObjectKeys } from "../../src/lib/compliance-output";
import { THEME_VOCAB, isThemeVocab } from "../../src/lib/theme-vocab";
import { intentSchema, aspectSchema, parseResearchInput, researchResponseSchema } from "../../src/schemas/research";
import { EXAMPLE_RESPONSE } from "../../src/lib/example";
import { matchResearch, putResearch, readCachedResearchBody } from "../../src/lib/cache";
import { BAZAAR_RESOURCE_DESC, BAZAAR_TOOL_DESC } from "../../src/lib/x402";
import { openApiDocument } from "../../src/lib/openapi";
import { assertStripeKeyMode } from "../../src/lib/stripe-keys";
import { rollingXIdSum, setXIdUsageNow, incrementXIdUsage, xIdCap } from "../../src/lib/x-id-cap";
import { persistResearch } from "../../src/lib/research-handler";
import { mapList, mapReply } from "../../src/lib/lenses";
import { executionCtx, flushExecution, jsonResponse, mockEnv, setGlobalFetch, stubCaches } from "../helpers/env";

const SNTL = /SNTL_|@sntl|u\/sntl/i;

function sentinelFetch(opts: { braveHits?: boolean; xIds?: string[] } = {}) {
  const now = new Date().toISOString();
  setGlobalFetch(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("api.x.com")) {
      const ids = opts.xIds ?? ["1001", "1002"];
      return jsonResponse({
        data: ids.map((id) => ({ id, text: "SNTL_TEXT_x", created_at: now })),
      });
    }
    if (url.includes("reddit.com") || url.includes("oauth.reddit.com")) {
      return jsonResponse({
        data: {
          children: [
            {
              data: {
                id: "abc",
                author: "sntl_user",
                title: "SNTL_TITLE_reddit",
                selftext: "SNTL_TEXT_reddit",
                permalink: "/r/saas/comments/abc/x/",
                created_utc: Date.now() / 1000 - 60,
                score: 1,
              },
            },
          ],
        },
      });
    }
    if (url.includes("brave.com")) {
      if (!opts.braveHits) return jsonResponse({ web: { results: [] } });
      return jsonResponse({
        web: {
          results: [
            {
              title: "SNTL_TITLE_brave",
              url: "https://example.net/sntl",
              description: "SNTL_TEXT_brave",
            },
          ],
        },
      });
    }
    if (url.includes("wikipedia.org/w/api.php")) {
      return jsonResponse({ query: { search: [{ title: "ForgeCo", snippet: "SNTL_TEXT_wiki" }] } });
    }
    if (url.includes("wikipedia.org/api/rest_v1")) {
      return jsonResponse({
        title: "SNTL_TITLE_wiki",
        extract: "SNTL_TEXT_wiki",
        content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/ForgeCo" } },
      });
    }
    if (url.includes("wikidata.org")) {
      return jsonResponse({
        search: [{ id: "Q1", label: "SNTL_TITLE_wd", description: "SNTL_TEXT_wd", concepturi: "https://www.wikidata.org/entity/Q1" }],
      });
    }
    if (url.includes("news.google.com")) {
      return new Response(
        `<rss><item><title>SNTL_TITLE_gnews</title><link>https://example.com/n</link><pubDate>${new Date().toUTCString()}</pubDate></item></rss>`,
        { headers: { "content-type": "application/xml" } },
      );
    }
    if (url.includes("gdeltproject.org")) {
      return jsonResponse({ articles: [{ url: "https://example.com/g", title: "SNTL_TITLE_gdelt", seendate: now.replace(/[-:TZ.]/g, "").slice(0, 14) }] });
    }
    if (url.includes("algolia.com")) {
      return jsonResponse({ hits: [{ objectID: "1", title: "SNTL_TITLE_hn", url: "https://example.com/hn", author: "sntl_user", created_at: now }] });
    }
    if (url.includes("api.github.com")) {
      return jsonResponse({
        items: [{ html_url: "https://github.com/ex/x/issues/1", title: "SNTL_TITLE_gh", body: "SNTL_TEXT_gh", user: { login: "sntl_user" }, created_at: now }],
      });
    }
    if (url.includes("api.stackexchange.com")) {
      return jsonResponse({
        items: [{ link: "https://stackoverflow.com/q/1", title: "SNTL_TITLE_so", body: "SNTL_TEXT_so", owner: { display_name: "@sntl_user" }, creation_date: Date.now() / 1000 }],
      });
    }
    return jsonResponse({}, 404);
  });
}

describe("MF compliant output", () => {
  beforeEach(() => {
    stubCaches();
    setXIdUsageNow(undefined);
  });

  it("A1 allowlist on research response", async () => {
    sentinelFetch();
    const { body } = await runResearch(
      mockEnv({ DISABLED_SOURCES: "x,reddit,brave,reviews" }),
      parseResearchInput({ query: "ForgeCo", platforms: ["web", "news"], include_summary: true }),
      "req",
    );
    expect(() => assertAllowlist(body, RESEARCH_ALLOW)).not.toThrow();
    expect(body.volume.by_platform).not.toHaveProperty("reddit");
    expect(body.sentiment.distribution.by_platform).not.toHaveProperty("reddit");
    expect(walkObjectKeys(body)).not.toContain("examples");
    expect(walkObjectKeys(body)).not.toContain("voices");
    expect(body.citations.every((c) => "domain" in c && !("title" in c))).toBe(true);
    researchResponseSchema.parse({
      ...body,
      meta: {
        ...body.meta,
        request_id: "r",
        latency_ms: 1,
        billing: { amount_usdc: "0", tx_hash: null, free_trial: true },
      },
    });
  });

  it("A3 Brave sentinels do not change aggregates when the flag is on", async () => {
    const env = mockEnv({ DISABLED_SOURCES: "x,reddit,reviews", BRAVE_API_KEY: "brave" });
    const req = parseResearchInput({ query: "ForgeCo", platforms: ["web"], include_summary: false });
    sentinelFetch({ braveHits: true });
    const a = await runResearch(env, req, "a");
    sentinelFetch({ braveHits: false });
    const b = await runResearch(env, req, "b");
    const drop = (body: typeof a.body) => {
      const { meta, ...rest } = body;
      return rest;
    };
    expect(drop(a.body)).toEqual(drop(b.body));
  });

  it("A3b default config never invokes fetchReviews", async () => {
    let reviewsCalled = 0;
    const orig = fetchReviews;
    sentinelFetch();
    const env = mockEnv();
    expect([...parseDisabledSources(undefined)].sort()).toEqual(["reddit", "reviews", "x"]);
    expect(DEFAULT_DISABLED_SOURCES).toContain("brave");
    const { body } = await runResearch(
      env,
      parseResearchInput({ query: "ForgeCo", platforms: ["web", "news", "reviews"], include_summary: false }),
      "req",
    );
    expect(body.volume.by_platform.reviews ?? 0).toBe(0);
    expect(body.meta.sources_used).not.toContain("reviews");
    const only = await runResearch(
      env,
      parseResearchInput({ query: "ForgeCo", platforms: ["reviews"], include_summary: false }),
      "req2",
    );
    expect(only.body.volume.total).toBe(0);
    expect(only.body.meta.degraded).toEqual(expect.arrayContaining(["reviews"]));
    expect(reviewsCalled).toBe(0);
    void orig;
  });

  it("A4 x.ts URL drops expansions and handle permalinks", () => {
    const url = xSearchUrl("ForgeCo");
    expect(url).not.toMatch(/expansions=author_id/);
    expect(url).not.toMatch(/user\.fields/);
    expect(url).not.toMatch(/x\.com\/[^/]+\/status/);
  });

  it("A4 X output is id-only", async () => {
    sentinelFetch({ xIds: ["42"] });
    const { body } = await runResearch(
      mockEnv({ DISABLED_SOURCES: "reddit,brave,reviews", X_BEARER_TOKEN: "t" }),
      parseResearchInput({ query: "ForgeCo", platforms: ["x"], include_summary: false }),
      "req",
    );
    expect(body.mentions).toEqual([
      expect.objectContaining({ id: "42", url: "https://x.com/i/web/status/42" }),
    ]);
    expect(body.mentions[0]).not.toHaveProperty("text");
    expect(body.mentions[0]).not.toHaveProperty("author");
    expect(body.x_post_ids).toEqual(["42"]);
  });

  it("A6 themes are vocabulary-only", async () => {
    sentinelFetch();
    const { body } = await runResearch(
      mockEnv({ DISABLED_SOURCES: "x,reddit,brave,reviews" }),
      parseResearchInput({ query: "ForgeCo pricing support", platforms: ["web", "news"] }),
      "req",
    );
    for (const t of body.themes) expect(isThemeVocab(t.theme)).toBe(true);
    expect(THEME_VOCAB.length).toBeGreaterThan(8);
  });

  it("A7 markdown has no citation titles or @", async () => {
    sentinelFetch();
    const { body } = await runResearch(
      mockEnv({ DISABLED_SOURCES: "x,reddit,brave,reviews" }),
      parseResearchInput({ query: "ForgeCo", platforms: ["web"], include_markdown: true }),
      "req",
    );
    const { projectResearch } = await import("../../src/lib/research/project");
    const out = projectResearch(
      {
        ...body,
        meta: {
          ...body.meta,
          request_id: "r",
          latency_ms: 1,
          billing: { amount_usdc: "0", tx_hash: null, free_trial: true },
        },
      },
      parseResearchInput({ query: "ForgeCo", platforms: ["web"], include_markdown: true }),
    );
    expect(out.markdown).toBeTruthy();
    expect(out.markdown).not.toMatch(/@/);
    expect(out.markdown).not.toMatch(/SNTL_TITLE/);
  });

  it("A8 polish prompt has no sentinel", () => {
    const prompt = buildPolishPrompt({
      query: "ForgeCo",
      volume: 3,
      overall: 0.1,
      themes: ["pricing"],
      risk: "low",
    });
    expect(prompt).not.toMatch(SNTL);
    expect(prompt).toMatch(/volume=3/);
  });

  it("A9 sentinel strings never appear in JSON", async () => {
    sentinelFetch({ braveHits: true, xIds: ["9"] });
    const env = mockEnv({ DISABLED_SOURCES: "", BRAVE_API_KEY: "b", X_BEARER_TOKEN: "t" });
    const { body } = await runResearch(
      env,
      parseResearchInput({ query: "ForgeCo", platforms: ["x", "web", "news", "reviews"], include_summary: true }),
      "req",
    );
    const s = JSON.stringify(body);
    expect(s).not.toMatch(SNTL);
    const key = await researchCacheKey(env, parseResearchInput({ query: "ForgeCo", platforms: ["x", "web", "news", "reviews"], include_summary: true }));
    const cached = await readCachedResearchBody(key);
    expect(JSON.stringify(cached)).not.toMatch(SNTL);
    expect(JSON.stringify(EXAMPLE_RESPONSE)).not.toMatch(SNTL);
    expect(JSON.stringify(EXAMPLE_RESPONSE)).not.toMatch(/reddit\.com/i);
    expect(JSON.stringify(openApiDocument("https://mentionforge.test"))).not.toMatch(SNTL);
  });

  it("A10 synthetic example", () => {
    expect(EXAMPLE_RESPONSE.query).toBe("Example Brand");
    expect(EXAMPLE_RESPONSE.meta.degraded).toEqual(expect.arrayContaining(["synthetic"]));
    expect(JSON.stringify(EXAMPLE_RESPONSE)).not.toMatch(/reddit\.com/);
    expect(JSON.stringify(EXAMPLE_RESPONSE)).not.toMatch(/Cloudflare Workers docs/);
    expect(() => assertAllowlist(EXAMPLE_RESPONSE, RESEARCH_ALLOW)).not.toThrow();
  });

  it("A11 cache stores allowlisted body and refresh drops missing X ids", async () => {
    const env = mockEnv({ DISABLED_SOURCES: "reddit,brave,reviews", X_BEARER_TOKEN: "t" });
    const req = parseResearchInput({ query: "ForgeCo", platforms: ["x"], include_summary: false });
    sentinelFetch({ xIds: ["1", "2"] });
    const first = await runResearch(env, req, "a");
    expect(first.body.x_post_ids).toEqual(["1", "2"]);
    const key = await researchCacheKey(env, req);
    const cached = await readCachedResearchBody(key);
    expect(() => assertAllowlist(cached, RESEARCH_ALLOW)).not.toThrow();
    await putResearch(key, { ...first.body, x_post_ids: ["1", "2", "99"], mentions: [...first.body.mentions, { id: "99", url: "https://x.com/i/web/status/99", created_bucket: "2026-10-01T00:00:00.000Z" }] }, 0);
    sentinelFetch({ xIds: ["1"] });
    const ctx = executionCtx();
    const second = await runResearch(env, req, "b", ctx);
    expect(second.freshness).toBe("cached");
    await flushExecution(ctx);
    const after = await matchResearch(key);
    expect(after?.body.x_post_ids).toEqual(["1"]);
  });

  it("A13 X_ID_CAP=5 refuses the next mentions export", async () => {
    const env = mockEnv({ DISABLED_SOURCES: "reddit,brave,reviews", X_BEARER_TOKEN: "t", X_ID_CAP: "5" });
    await incrementXIdUsage(env, 4);
    expect(await rollingXIdSum(env)).toBe(4);
    sentinelFetch({ xIds: ["a", "b"] });
    const { body } = await runResearch(
      env,
      parseResearchInput({ query: "ForgeCo", platforms: ["x"], include_summary: false }),
      "req",
    );
    await expect(
      persistResearch(env, executionCtx(), parseResearchInput({ query: "ForgeCo" }), "id", Date.now(), body, "live", {
        amount_usdc: "0",
        tx_hash: null,
        free_trial: true,
      }, null, "h", mapList({ query: "ForgeCo" }).project),
    ).rejects.toMatchObject({ code: "X_ID_CAP_REACHED" });
    const stripped = await persistResearch(
      env,
      executionCtx(),
      parseResearchInput({ query: "ForgeCo" }),
      "id2",
      Date.now(),
      body,
      "live",
      { amount_usdc: "0", tx_hash: null, free_trial: true },
      null,
      "h2",
    );
    expect((stripped as { x_post_ids: string[] }).x_post_ids).toEqual([]);
    expect((stripped as { meta: { degraded: string[] } }).meta.degraded).toEqual(expect.arrayContaining(["x_id_cap"]));
    expect(xIdCap(env)).toBe(5);
    const t0 = Date.parse("2026-01-01T00:00:00Z");
    setXIdUsageNow(t0);
    await incrementXIdUsage(env, 10);
    setXIdUsageNow(t0 + 31 * 86400000);
    expect(await rollingXIdSum(env)).toBe(0);
  });

  it("A14 intent/aspect enums unchanged; bazaar copy bounds", () => {
    expect(intentSchema.options).toEqual(["praise", "complaint", "question", "buying", "news", "other"]);
    expect(aspectSchema.options).toEqual(["pricing", "support", "reliability", "security", "performance"]);
    expect(BAZAAR_RESOURCE_DESC.length).toBeLessThanOrEqual(500);
    expect(BAZAAR_TOOL_DESC.length).toBeLessThanOrEqual(500);
    expect(BAZAAR_RESOURCE_DESC).not.toMatch(/\bTwitter\b/);
  });

  it("A16 live Stripe key blocked without disclosure", () => {
    expect(() => assertStripeKeyMode({ STRIPE_SECRET_KEY: "sk_live_dummy", LEGAL_DISCLOSURE: "" })).toThrow(/STRIPE_LIVE_KEY_BLOCKED/);
    expect(() => assertStripeKeyMode({ STRIPE_SECRET_KEY: "sk_test_dummy" })).not.toThrow();
    expect(() => assertStripeKeyMode({ STRIPE_SECRET_KEY: "rk_live_dummy", LEGAL_DISCLOSURE: "Acme 1 Main" })).not.toThrow();
  });

  it("A2 reply ignores quote and drops source_url", () => {
    const mapped = mapReply({ query: "ForgeCo", quote: "SNTL_TEXT_quote" });
    const out = mapped.project({
      ...EXAMPLE_RESPONSE,
      mentions: [{ id: "1", url: "https://x.com/i/web/status/1", created_bucket: "2026-10-01T00:00:00.000Z" }],
      meta: { ...EXAMPLE_RESPONSE.meta, request_id: "r", latency_ms: 1 },
    });
    const drafts = (out as { drafts: Array<Record<string, unknown>>; meta: { quote_ignored?: boolean } }).drafts;
    expect(drafts[0]).not.toHaveProperty("source_url");
    expect((out as { meta: { quote_ignored?: boolean } }).meta.quote_ignored).toBe(true);
  });
});
