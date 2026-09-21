import { describe, expect, it } from "vitest";
import { allowedFetch, assertAllowedUrl } from "../../src/lib/allowlist";
import { jsonResponse, setGlobalFetch } from "../helpers/env";

describe("allowlist", () => {
  it("allows language wikipedia hosts and rejects prefix tricks", () => {
    expect(assertAllowedUrl("https://es.wikipedia.org/wiki/X").hostname).toBe("es.wikipedia.org");
    expect(assertAllowedUrl("https://ceb.wikipedia.org/wiki/X").hostname).toBe("ceb.wikipedia.org");
    expect(() => assertAllowedUrl("https://en.wikipedia.org.evil.example/")).toThrow(/blocked host/);
    expect(() => assertAllowedUrl("http://api.github.com/")).toThrow(/non-https/);
    expect(assertAllowedUrl("https://api.github.com/search/issues").hostname).toBe("api.github.com");
    expect(assertAllowedUrl("https://api.stackexchange.com/2.3/search").hostname).toBe("api.stackexchange.com");
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
