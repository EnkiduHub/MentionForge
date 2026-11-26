import { describe, expect, it } from "vitest";
import { applyCoverage, coverageNote, disabledSourcesError } from "../../src/lib/research/coverage";
import { overlayBilling } from "../../src/lib/research/engine";
import { projectResearch } from "../../src/lib/research/project";
import { projectCompare } from "../../src/lib/lenses";
import { compareOutputSchema } from "../../src/schemas/lenses";
import { researchResponseSchema, type CachedResearch, type ResearchResponse } from "../../src/schemas/research";

const NOTE = "reddit and x were not searched because those sources are turned off. A zero count for them is not an empty window.";

describe("coverage note", () => {
  it("names one platform and many platforms without repeating the sentence", () => {
    expect(coverageNote(undefined)).toBeUndefined();
    expect(coverageNote([])).toBeUndefined();
    expect(coverageNote(["reddit"])).toBe(
      "reddit was not searched because that source is turned off. A zero count for it is not an empty window.",
    );
    expect(coverageNote(["reddit", "x"])).toBe(NOTE);
    expect(coverageNote(["web", "reviews", "news"])).toBe(
      "web, reviews, and news were not searched because those sources are turned off. A zero count for them is not an empty window.",
    );
    const once = applyCoverage({ summary: "ForgeCo: 1 fused mention.", meta: { sources_disabled: ["reddit", "x"] } });
    const twice = applyCoverage(once);
    expect(once.summary).toBe(`ForgeCo: 1 fused mention. ${NOTE}`);
    expect(twice.summary).toBe(once.summary);
    expect(once.meta.coverage_note).toBe(NOTE);
  });

  it("names retry platforms and does not tell the agent to wait 15 seconds", () => {
    const err = disabledSourcesError(["x", "reddit"], "req-1");
    expect(err.code).toBe("SOURCE_UNAVAILABLE");
    expect(err.hint).toContain("platforms set to web, reviews, news");
    expect(err.hint).toContain("Nothing was charged");
    expect(err.hint).not.toMatch(/15s/);
    expect(err.hint).not.toMatch(/upstream sources failed/);
    expect(err.details).toEqual({
      reason: "sources_disabled",
      sources_disabled: ["reddit", "x"],
      retry_platforms: ["web", "reviews", "news"],
    });
    const none = disabledSourcesError(["x", "reddit", "web", "reviews", "news"], "req-2");
    expect(none.hint).toContain("get_health source_backends");
    expect(none.details.retry_platforms).toEqual([]);
  });

  it("backfills a cached brief that predates coverage_note and keeps the note in a compact summary", () => {
    const cached = {
      query: "ForgeCo",
      timeframe: "7d",
      volume: { total: 0, by_platform: { x: 0, reddit: 0, web: 0, reviews: 0, news: 0 }, trend: [] },
      sentiment: {
        overall: 0,
        positive: 0,
        neutral: 0,
        negative: 0,
        distribution: { positive: 0, neutral: 0, negative: 0, by_platform: {} },
      },
      themes: [{ theme: "network", count: 1, examples: ["edge"] }],
      mentions: [],
      summary: "ForgeCo: 0 fused mentions in the selected window, sentiment mixed-to-neutral (0.00). Themes: network.",
      citations: [],
      meta: { sources_used: ["web"], sources_disabled: ["reddit", "x"], confidence: 0.4, as_of: "2026-11-01T00:00:00.000Z" },
    } as CachedResearch;
    const billed = overlayBilling(
      cached,
      {
        request_id: "r",
        latency_ms: 3,
        sources_used: ["web"],
        sources_disabled: ["reddit", "x"],
        billing: { amount_usdc: "0.02", tx_hash: null, free_trial: false },
      },
      "cached",
    );
    expect(billed.meta.coverage_note).toBe(NOTE);
    expect(billed.summary).toContain(NOTE);
    expect(billed.meta.freshness).toBe("cached");
    const compact = projectResearch(billed, {
      query: "ForgeCo",
      platforms: ["x", "reddit", "web", "reviews", "news"],
      timeframe: "7d",
      limit: 20,
      include_summary: true,
      view: "compact",
    });
    expect(compact.summary?.startsWith("ForgeCo: 0 fused mentions")).toBe(true);
    expect(compact.summary).toContain(NOTE);
    expect(researchResponseSchema.safeParse(compact).success).toBe(true);
  });

  it("keeps the note on compare output that the paid tool schema accepts", () => {
    const full = {
      query: "ForgeCo vs RivalCo",
      mentions: [],
      citations: [],
      themes: [],
      meta: {
        request_id: "r",
        latency_ms: 1,
        sources_used: ["web"],
        sources_disabled: ["reddit", "x"],
        coverage_note: NOTE,
        billing: { amount_usdc: "0.02", tx_hash: null, free_trial: false },
      },
    } as unknown as ResearchResponse;
    const compared = projectCompare(full, ["ForgeCo", "RivalCo"]);
    const meta = compared.meta as { sources_disabled?: string[]; coverage_note?: string };
    expect(meta.sources_disabled).toEqual(["reddit", "x"]);
    expect(meta.coverage_note).toBe(NOTE);
    expect(compareOutputSchema.safeParse(compared).success).toBe(true);
  });
});
