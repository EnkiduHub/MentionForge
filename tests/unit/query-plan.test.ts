import { describe, expect, it } from "vitest";
import { planQuery, windowFor } from "../../src/lib/research/query-plan";
import { nextQueries } from "../../src/lib/next-queries";
import type { ResearchRequest } from "../../src/schemas/research";

const base: ResearchRequest = {
  query: "ForgeCo vs RivalCo",
  platforms: ["web"],
  timeframe: "7d",
  limit: 10,
  include_summary: true,
};

describe("vs query plan", () => {
  it("splits A vs B", () => {
    const plan = planQuery(base);
    expect(plan.vs?.a).toBe("ForgeCo");
    expect(plan.vs?.b).toBe("RivalCo");
    expect(plan.reddit).toContain("RivalCo");
  });

  it("emits three follow-up queries", () => {
    const n = nextQueries(base);
    expect(n).toHaveLength(3);
    expect(n[0]).toMatch(/vs competitors/i);
    expect(n[1]).toMatch(/complaints/i);
    expect(n[2]).toMatch(/24 hours/i);
  });

  it("relative windows keep in-flight Wikipedia timestamps", () => {
    const before = Date.now();
    const win = windowFor("7d");
    expect(win.to.getTime()).toBeGreaterThan(before);
    expect(win.to.getTime() - before).toBeGreaterThanOrEqual(60_000);
    expect(Date.parse(new Date(before + 8_000).toISOString())).toBeLessThanOrEqual(win.to.getTime());
  });
});
