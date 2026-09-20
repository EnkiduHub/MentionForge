import { describe, expect, it } from "vitest";
import { isSiteScopedWebQuery } from "../../src/lib/research/sources/web";

describe("site-scoped web queries", () => {
  it("skips encyclopedia for review and X host filters", () => {
    expect(isSiteScopedWebQuery('Cloudflare Workers site:trustpilot.com OR site:g2.com review')).toBe(true);
    expect(isSiteScopedWebQuery("Cloudflare Workers site:x.com OR site:twitter.com")).toBe(true);
    expect(isSiteScopedWebQuery("Cloudflare Workers")).toBe(false);
  });
});
