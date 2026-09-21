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
    expect(plan.news).toContain("RivalCo");
    expect(plan.web).toContain("RivalCo");
    expect(plan.reviews).toContain("RivalCo");
    expect(plan.x).toContain("RivalCo");
    expect(plan.brands).toEqual(["ForgeCo", "RivalCo"]);
  });

  it("splits three brands", () => {
    const plan = planQuery({ ...base, query: "ForgeCo vs RivalCo vs ThirdCo" });
    expect(plan.brands).toEqual(["ForgeCo", "RivalCo", "ThirdCo"]);
    expect(plan.reddit).toContain("ThirdCo");
    expect(plan.news).toContain("ThirdCo");
    expect(plan.web).toContain("ThirdCo");
    expect(plan.reviews).toContain("ThirdCo");
    expect(plan.x).toContain("ThirdCo");
  });

  it("clamps four-way vs to the first three brands", () => {
    const plan = planQuery({ ...base, query: "ForgeCo vs RivalCo vs ThirdCo vs FourthCo" });
    expect(plan.brands).toEqual(["ForgeCo", "RivalCo", "ThirdCo"]);
    expect(plan.web).toContain("RivalCo");
    expect(plan.news).not.toContain("FourthCo");
  });

  it("splits versus the same as vs", () => {
    const plan = planQuery({ ...base, query: "ForgeCo versus RivalCo" });
    expect(plan.brands).toEqual(["ForgeCo", "RivalCo"]);
    expect(plan.web).toContain("RivalCo");
    expect(nextQueries({ ...base, query: "ForgeCo versus RivalCo" })[2]).toMatch(/vs RivalCo/i);
  });

  it("emits three follow-up queries", () => {
    const n = nextQueries(base);
    expect(n).toHaveLength(3);
    expect(n[0]).toMatch(/complaints/i);
    expect(n[1]).toMatch(/24 hours/i);
    expect(n[2]).toMatch(/vs RivalCo/i);
    expect(nextQueries({ ...base, query: "ForgeCo", timeframe: "24h" })[1]).toMatch(/reviews/i);
  });

  it("relative windows keep in-flight Wikipedia timestamps", () => {
    const before = Date.now();
    const win = windowFor("7d");
    expect(win.to.getTime()).toBeGreaterThan(before);
    expect(win.to.getTime() - before).toBeGreaterThanOrEqual(60_000);
    expect(Date.parse(new Date(before + 8_000).toISOString())).toBeLessThanOrEqual(win.to.getTime());
  });
});
