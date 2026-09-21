import { describe, expect, it, beforeEach } from "vitest";
import { shareOfVoice, brandHits, relevantToBrands } from "../../src/lib/research/sov";
import { researchOnly } from "../../src/lib/cache";
import { cacheKeyMaterial } from "../../src/lib/research/query-plan";
import { isDevShapedQuery, isSiteScopedWebQuery, codeSearchQuery } from "../../src/lib/research/sources/web";
import { fetchReddit } from "../../src/lib/research/sources/reddit";
import { planQuery, windowFor } from "../../src/lib/research/query-plan";
import { FetchPool } from "../../src/lib/fetch-pool";
import { mapCompare } from "../../src/lib/lenses";
import { fetchWeb } from "../../src/lib/research/sources/web";
import { suggestTool } from "../../src/lib/suggest";
import { runResearch } from "../../src/lib/research/engine";
import { createApp } from "../../src/app";
import {
  executionCtx,
  jsonResponse,
  mockEnv,
  setGlobalFetch,
  stubCaches,
  stubSourcesFetch,
} from "../helpers/env";
import { parseResearchInput } from "../../src/schemas/research";
import type { CachedResearch } from "../../src/schemas/research";

describe("share of voice", () => {
  it("attributes longest brand first", () => {
    const rows = shareOfVoice(
      [
        { text: "OpenAI shipped GPT", url: "https://example.com/a", engagement: 2 },
        { text: "other news", url: "https://example.com/b", engagement: 1 },
      ],
      ["AI", "OpenAI"],
    );
    const open = rows.find((r) => r.brand === "OpenAI");
    const ai = rows.find((r) => r.brand === "AI");
    expect(open?.mentions).toBe(1);
    expect(ai?.mentions).toBe(0);
    expect(brandHits("openai shipped", "OpenAI")).toBe(true);
    expect(relevantToBrands({ text: "RivalCo shipped a rival", url: "https://example.com/c" }, ["ForgeCo", "RivalCo"])).toBe(
      true,
    );
    expect(relevantToBrands({ text: "unrelated industry note", url: "https://example.com/d" }, ["ForgeCo", "RivalCo"])).toBe(
      false,
    );
  });
});

describe("researchOnly + cache key overlays", () => {
  it("round-trips new intelligence fields and drops markdown", () => {
    const body = {
      query: "ForgeCo vs RivalCo",
      timeframe: "7d",
      volume: { total: 1, by_platform: { x: 0, reddit: 1, web: 0, reviews: 0, news: 0 }, trend: [] },
      sentiment: { overall: 0, positive: 0, neutral: 100, negative: 0, distribution: { positive: 0, neutral: 100, negative: 0, by_platform: { reddit: 1 } } },
      themes: [],
      mentions: [],
      citations: [],
      share_of_voice: [{ brand: "ForgeCo", mentions: 1, engagement: 1, share: 1 }],
      signals: { risk: "low", spike: false, reasons: ["no spike or negative concentration"] },
      voices: [{ author: "u/ops", platform: "reddit", mentions: 1, engagement: 3 }],
      markdown: "should not cache",
      meta: { sources_used: ["reddit"], request_id: "x", latency_ms: 1, billing: { amount_usdc: "0.02", tx_hash: null, free_trial: false } },
    } as unknown as CachedResearch;
    const out = researchOnly(body);
    expect(out.share_of_voice?.[0]?.brand).toBe("ForgeCo");
    expect(out.signals?.risk).toBe("low");
    expect(out.voices?.[0]?.author).toBe("u/ops");
    expect("markdown" in out).toBe(false);
    expect(out.meta).not.toHaveProperty("billing");
    expect(out.meta).not.toHaveProperty("request_id");
  });

  it("omits view/focus/include_markdown from the cache key", () => {
    const a = parseResearchInput({ query: "ForgeCo", timeframe: "7d" });
    const b = parseResearchInput({
      query: "ForgeCo",
      timeframe: "7d",
      view: "compact",
      focus: "complaint",
      include_markdown: true,
    });
    expect(cacheKeyMaterial(a)).toBe(cacheKeyMaterial(b));
  });
});

describe("github gate", () => {
  it("skips github on site-scoped queries and gates on dev-shaped text", () => {
    expect(isSiteScopedWebQuery("ForgeCo site:x.com")).toBe(true);
    expect(isDevShapedQuery("ForgeCo")).toBe(false);
    expect(isDevShapedQuery("Cloudflare Workers")).toBe(false);
    expect(isDevShapedQuery("Cloudflare Workers vs AWS Lambda")).toBe(false);
    expect(isDevShapedQuery("Cloudflare Workers sdk")).toBe(true);
    expect(isDevShapedQuery("react vs vue")).toBe(true);
    const vs = planQuery(parseResearchInput({ query: "ForgeCo vs RivalCo", platforms: ["web"] }));
    expect(codeSearchQuery(vs)).toContain("RivalCo");
    expect(codeSearchQuery(vs)).not.toMatch(/^"/);
  });

  it("fetchWeb does not call GitHub or Stack Overflow when the query is site-scoped", async () => {
    const seen: string[] = [];
    setGlobalFetch(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      seen.push(url);
      return jsonResponse({});
    });
    const env = mockEnv({ BRAVE_API_KEY: "brave" });
    const ctx = { env, pool: new FetchPool(), query: "ForgeCo sdk" };
    const plan = planQuery(parseResearchInput({ query: "ForgeCo sdk", platforms: ["web"] }));
    plan.web = `${plan.web} site:trustpilot.com`;
    await fetchWeb(ctx, plan, windowFor("7d"));
    expect(seen.some((u) => u.includes("api.github.com"))).toBe(false);
    expect(seen.some((u) => u.includes("api.stackexchange.com"))).toBe(false);
    expect(isDevShapedQuery(plan.web)).toBe(true);
    expect(isSiteScopedWebQuery(plan.web)).toBe(true);
  });
});

describe("reddit Brave-only fallback", () => {
  beforeEach(() => {
    stubCaches();
  });

  it("uses Brave site:reddit.com and does not fetch wikipedia", async () => {
    const seen: string[] = [];
    setGlobalFetch(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      seen.push(url);
      if (url.includes("reddit.com/search")) return jsonResponse({}, 403);
      if (url.includes("brave.com")) {
        expect(url).toContain("site%3Areddit.com");
        return jsonResponse({
          web: { results: [{ title: "ForgeCo thread", url: "https://www.reddit.com/r/saas/comments/x", description: "ForgeCo" }] },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const env = mockEnv({ BRAVE_API_KEY: "brave" });
    const ctx = { env, pool: new FetchPool(), query: "ForgeCo" };
    const plan = planQuery(parseResearchInput({ query: "ForgeCo", platforms: ["reddit"] }));
    const r = await fetchReddit(ctx, plan, windowFor("7d"));
    expect(r.mentions.length).toBe(1);
    expect(r.mentions[0]?.platform).toBe("reddit");
    expect(r.degraded).toBe(true);
    expect(seen.some((u) => u.includes("wikipedia"))).toBe(false);
  });
});

describe("free tools never 402", () => {
  beforeEach(() => {
    stubCaches();
    stubSourcesFetch();
  });

  it("GET /v1/suggest and /v1/entity stay 200", async () => {
    const app = createApp();
    const env = mockEnv();
    const suggest = await app.fetch(
      new Request("https://mentionforge.test/v1/suggest?need=compare%20two%20brands", { headers: { Accept: "application/json" } }),
      env,
      executionCtx(),
    );
    expect(suggest.status).toBe(200);
    const body = (await suggest.json()) as { tool?: string; example_args?: { query?: string } };
    expect(body.tool).toBe("compare_brands");
    expect(JSON.stringify(body)).not.toMatch(/0x[a-fA-F0-9]{40}/);

    const entity = await app.fetch(
      new Request("https://mentionforge.test/v1/entity?query=ForgeCo", { headers: { Accept: "application/json" } }),
      env,
      executionCtx(),
    );
    expect(entity.status).toBe(200);
    expect(entity.status).not.toBe(402);
  });

  it("GET paid lenses return 400", async () => {
    const app = createApp();
    const env = mockEnv();
    for (const path of ["/v1/compare", "/v1/digest", "/v1/risk", "/v1/reply"]) {
      const res = await app.fetch(
        new Request(`https://mentionforge.test${path}`, { headers: { Accept: "application/json" } }),
        env,
        executionCtx(),
      );
      expect(res.status, path).toBe(400);
    }
  });
});

describe("vs query scoring", () => {
  beforeEach(() => {
    stubCaches();
  });

  it("scores competitor-only mentions as relevant", async () => {
    const now = Math.floor(Date.now() / 1000);
    setGlobalFetch(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("reddit.com")) {
        return jsonResponse({
          data: {
            children: [
              {
                data: {
                  id: "r1",
                  author: "ops",
                  title: "RivalCo launched",
                  selftext: "RivalCo is shipping a rival",
                  permalink: "/r/saas/comments/r1/rivalco/",
                  created_utc: now - 3600,
                  score: 8,
                  num_comments: 1,
                },
              },
            ],
          },
        });
      }
      return jsonResponse({});
    });
    const { body } = await runResearch(
      mockEnv(),
      parseResearchInput({ query: "ForgeCo vs RivalCo", platforms: ["reddit"] }),
      "req",
      executionCtx(),
    );
    const hit = body.mentions.find((m) => /RivalCo/i.test(m.text));
    expect(hit).toBeTruthy();
    expect(hit?.relevance ?? 0).toBeGreaterThan(0);
  });
});

describe("suggest_tool sanitizes", () => {
  it("strips urls and wallets from example_args.query", () => {
    const out = suggestTool("research https://evil.example javascript:alert(1) 0x1111111111111111111111111111111111111111 Cloudflare");
    expect(out.tool).toBe("research_mentions");
    expect(JSON.stringify(out.example_args)).not.toMatch(/https?:\/\//);
    expect(JSON.stringify(out.example_args)).not.toMatch(/javascript:/);
    expect(JSON.stringify(out.example_args)).not.toMatch(/0x[a-fA-F0-9]{40}/);
  });

  it("strips payment header names from example_args", () => {
    const out = suggestTool("research PAYMENT-SIGNATURE:abc X-Wallet Cloudflare");
    expect(JSON.stringify(out.example_args)).not.toMatch(/PAYMENT-SIGNATURE/i);
    expect(JSON.stringify(out.example_args)).not.toMatch(/X-Wallet/i);
    expect(JSON.stringify(out.example_args)).toMatch(/Cloudflare/);
  });

  it("defaults unknown needs to research_mentions", () => {
    expect(suggestTool("tell me about the weather of ForgeCo").tool).toBe("research_mentions");
  });

  it("splits versus into brand and competitors", () => {
    const out = suggestTool("ForgeCo versus RivalCo");
    expect(out.tool).toBe("compare_brands");
    expect(out.example_args.brand).toBe("ForgeCo");
    expect(out.example_args.competitors).toEqual(["RivalCo"]);
  });
});

describe("compare hash uses sanitized brands", () => {
  it("does not keep urls in the idempotency hash object", () => {
    const mapped = mapCompare({
      brand: "https://evil.example ForgeCo",
      competitors: ["RivalCo"],
    });
    expect(JSON.stringify(mapped.hashObject)).not.toMatch(/https?:\/\//);
    expect((mapped.hashObject as { brand: string }).brand).toMatch(/ForgeCo/);
    expect(mapped.research.query).toBe("ForgeCo vs RivalCo");
  });
});
