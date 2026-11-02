import { describe, expect, it } from "vitest";
import { applySecurityHeaders, ensureHtmlUtf8Charset } from "../../src/lib/security-headers";

describe("HTML charset", () => {
  it("adds utf-8 when text/html has no charset", () => {
    const headers = new Headers({ "content-type": "text/html" });
    ensureHtmlUtf8Charset(headers);
    expect(headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("leaves existing charset and non-HTML types alone", () => {
    const utf8 = new Headers({ "content-type": "text/html; charset=UTF-8" });
    ensureHtmlUtf8Charset(utf8);
    expect(utf8.get("content-type")).toBe("text/html; charset=UTF-8");

    const json = new Headers({ "content-type": "application/json" });
    ensureHtmlUtf8Charset(json);
    expect(json.get("content-type")).toBe("application/json");
  });

  it("applySecurityHeaders on html kind adds charset without dropping the body", async () => {
    const res = applySecurityHeaders(
      new Response("<!doctype html>", { headers: { "content-type": "text/html" } }),
      "html",
    );
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe("<!doctype html>");
  });
});
