import { describe, expect, it } from "vitest";
import { executiveSummary } from "../../src/lib/research/summary";
import { parseResearchInput } from "../../src/schemas/research";

describe("executiveSummary", () => {
  it("describes mixed coverage without template Risk/Opportunity labels", () => {
    const text = executiveSummary({
      req: parseResearchInput({ query: "Cloudflare Workers", timeframe: "7d" }),
      mentions: [],
      overall: -0.02,
      volume: 11,
      themes: [{ theme: "network" }, { theme: "serverless" }, { theme: "global" }],
    });
    expect(text).toContain("Cloudflare Workers: 11 fused mentions");
    expect(text).toContain("weight cited URLs");
    expect(text).not.toMatch(/\bRisk:/);
    expect(text).not.toMatch(/\bOpportunity:/);
  });
});
