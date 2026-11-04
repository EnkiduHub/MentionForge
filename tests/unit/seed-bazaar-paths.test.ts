import { afterEach, describe, expect, it, vi } from "vitest";
import { parsePayPaths, settlePayPaths, type PayPath } from "../../scripts/pay-paths";

describe("PAY_PATHS settlements", () => {
  const prev = process.env["PAY_PATHS"];

  afterEach(() => {
    if (prev === undefined) delete process.env["PAY_PATHS"];
    else process.env["PAY_PATHS"] = prev;
  });

  it("PAY_PATHS=mcp makes exactly one settlement call", async () => {
    process.env["PAY_PATHS"] = "mcp";
    const settle = vi.fn(async () => {});
    const count = await settlePayPaths(parsePayPaths(process.env["PAY_PATHS"]), settle);
    expect(count).toBe(1);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledWith("mcp");
  });

  it("default PAY_PATHS makes three settlement calls", async () => {
    delete process.env["PAY_PATHS"];
    const settle = vi.fn(async (_path: PayPath) => {});
    const count = await settlePayPaths(parsePayPaths(process.env["PAY_PATHS"]), settle);
    expect(count).toBe(3);
    expect(settle.mock.calls.map((call) => call[0])).toEqual([
      "mcp",
      "rest-research",
      "rest-research-mentions",
    ]);
  });

  it("unknown PAY_PATHS throws and does not settle", async () => {
    const settle = vi.fn(async () => {});
    expect(() => parsePayPaths("mcp,nope")).toThrow(/unknown value/i);
    expect(settle).not.toHaveBeenCalled();
  });
});
