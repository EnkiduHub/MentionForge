import { describe, expect, it } from "vitest";
import { wantsPrettyJson } from "../../src/lib/http-json";

describe("pretty JSON for browsers", () => {
  it("detects HTML Accept without JSON", () => {
    expect(wantsPrettyJson("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")).toBe(true);
  });

  it("stays compact for agents and same-origin fetch", () => {
    expect(wantsPrettyJson("application/json")).toBe(false);
    expect(wantsPrettyJson("*/*")).toBe(false);
    expect(wantsPrettyJson(undefined)).toBe(false);
  });
});
