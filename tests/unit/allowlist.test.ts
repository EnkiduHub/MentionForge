import { describe, expect, it } from "vitest";
import { allowedFetch, assertAllowedUrl } from "../../src/lib/allowlist";
import { jsonResponse, setGlobalFetch } from "../helpers/env";

describe("allowlist", () => {
  it("rejects non-https and unknown hosts", () => {
    expect(() => assertAllowedUrl("http://en.wikipedia.org/")).toThrow(/non-https/);
    expect(() => assertAllowedUrl("https://evil.example/")).toThrow(/blocked host/);
  });

  it("refuses redirects off the allowlist", async () => {
    setGlobalFetch(async () => new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } }));
    await expect(allowedFetch("https://en.wikipedia.org/w/api.php")).rejects.toThrow(/blocked host/);
  });

  it("follows an allowlisted redirect", async () => {
    let n = 0;
    setGlobalFetch(async (input) => {
      n += 1;
      const url = String(input instanceof Request ? input.url : input);
      if (n === 1) {
        return new Response(null, { status: 302, headers: { location: "https://en.wikipedia.org/wiki/ForgeCo" } });
      }
      expect(url).toContain("wiki/ForgeCo");
      return jsonResponse({ ok: true });
    });
    const res = await allowedFetch("https://en.wikipedia.org/w/api.php");
    expect(res.status).toBe(200);
    expect(n).toBe(2);
  });
});
