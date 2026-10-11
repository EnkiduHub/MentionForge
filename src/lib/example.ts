import type { ResearchRequest, ResearchResponse } from "../schemas/research";

/** Overlay for MCP `get_example`. `full` is the frozen snapshot; `compact` slices rows only. */
export function projectExample(res: ResearchResponse, view: "full" | "compact" = "full"): ResearchResponse {
  if (view !== "compact") return res;
  return {
    ...res,
    mentions: res.mentions.slice(0, 8),
    citations: res.citations.slice(0, 8),
    x_post_ids: (res.x_post_ids ?? []).slice(0, 8),
  };
}

export const SAMPLE_REQUEST: ResearchRequest = {
  query: "Example Brand",
  platforms: ["web", "news"],
  timeframe: "7d",
  limit: 12,
  include_summary: true,
  language: "en",
};

/** Synthetic fixture — no live snippets, no reddit.com, no x.com. */
export const EXAMPLE_RESPONSE: ResearchResponse = {
  query: "Example Brand",
  timeframe: "7d",
  volume: {
    total: 4,
    by_platform: { x: 0, web: 3, reviews: 0, news: 1 },
    trend: [{ t: "2026-10-01T00:00:00.000Z", count: 4 }],
  },
  sentiment: {
    overall: 0.1,
    positive: 50,
    neutral: 50,
    negative: 0,
    distribution: { positive: 50, neutral: 50, negative: 0, by_platform: { web: 3, news: 1 } },
    by_platform: { web: 0.12, news: 0.05 },
  },
  themes: [
    { theme: "pricing", count: 2 },
    { theme: "support", count: 1 },
    { theme: "reliability", count: 1 },
  ],
  mentions: [],
  x_post_ids: [],
  summary:
    "Example Brand: 4 fused mentions in the selected window, sentiment mixed-to-neutral (0.10). Themes: pricing, support, reliability. Coverage is mixed across sources; weight cited URLs over any single platform. High-engagement threads are the fastest sentiment lever.",
  citations: [
    { url: "https://example.com/about", domain: "example.com" },
    { url: "https://example.org/news/example-brand", domain: "example.org" },
  ],
  share_of_voice: [{ brand: "Example Brand", mentions: 4, share: 1 }],
  signals: { risk: "low", spike: false, reasons: ["no spike or negative concentration"] },
  meta: {
    sources_used: ["web", "news"],
    confidence: 0.5,
    as_of: "2026-10-01T00:00:00.000Z",
    request_id: "example-synthetic",
    latency_ms: 12,
    billing: { amount_usdc: "0", tx_hash: null, free_trial: true },
    next_queries: ["Example Brand vs competitors", "Example Brand complaints", "Example Brand last 24 hours"],
    freshness: "cached",
    degraded: ["synthetic"],
  },
};
