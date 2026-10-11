import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FetchPool } from "../../src/lib/fetch-pool";
import {
  fetchGoogleNewsRss,
  googleNewsRssUrl,
  parseGoogleNewsRss,
} from "../../src/lib/research/sources/news";
import { mockEnv, setGlobalFetch, stubCaches } from "../helpers/env";

const FIXTURE = readFileSync(new URL("../fixtures/google-news.rss", import.meta.url), "utf8");

function gnewsCtx() {
  return { env: mockEnv(), pool: new FetchPool(), query: "ForgeCo" };
}

function header(init: RequestInit | undefined, name: string): string {
  if (!init?.headers) return "";
  return new Headers(init.headers as HeadersInit).get(name) ?? "";
}

describe("Google News RSS", () => {
  beforeEach(() => {
    stubCaches();
  });

  it("builds the en-US locale search URL", () => {
    expect(googleNewsRssUrl("ForgeCo")).toBe(
      "https://news.google.com/rss/search?q=ForgeCo&hl=en-US&gl=US&ceid=US:en",
    );
    expect(googleNewsRssUrl("ForgeCo", "en")).toContain("hl=en-US");
    expect(googleNewsRssUrl("ForgeCo", "de")).toBe(
      "https://news.google.com/rss/search?q=ForgeCo&hl=de&gl=DE&ceid=DE:de",
    );
  });

  it("parses a fixture RSS feed with CDATA, entities, and guid links", () => {
    const items = parseGoogleNewsRss(FIXTURE);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      title: "ForgeCo launches Workers RSS & more",
      link: "https://news.google.com/rss/articles/CBMiAAForgeship",
    });
    expect(items[0]?.description).toContain("The Example Times");
    expect(items[1]).toMatchObject({
      title: `ForgeCo & Co's "launch" — details`,
      link: "https://example.com/forgeco-entities",
      description: "Quoted 'coverage' from",
    });
    expect(items[2]).toMatchObject({
      title: "Guid-only permalink",
      link: "https://example.com/forgeco-guid",
    });
  });

  it("follows an allowlisted news.google.com redirect with browser RSS headers", async () => {
    const urls: string[] = [];
    const redirects: Array<RequestInit["redirect"]> = [];
    setGlobalFetch(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      urls.push(url);
      redirects.push(init?.redirect);
      expect(header(init, "user-agent")).toMatch(/^Mozilla\/5\.0 /);
      expect(header(init, "accept")).toContain("application/rss+xml");
      if (urls.length === 1) {
        return new Response(null, {
          status: 302,
          headers: {
            location: "https://news.google.com/rss/search?q=ForgeCo&hl=en-US&gl=US&ceid=US:en",
          },
        });
      }
      return new Response(FIXTURE, { status: 200, headers: { "content-type": "application/rss+xml" } });
    });
    const xml = await fetchGoogleNewsRss(gnewsCtx(), googleNewsRssUrl("ForgeCo"));
    expect(redirects.every((r) => r === "follow")).toBe(true);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain("hl=en-US");
    expect(parseGoogleNewsRss(xml ?? "")).toHaveLength(3);
  });

  it("retries with a CONSENT cookie when Google redirects to consent.google.com", async () => {
    const cookies: string[] = [];
    setGlobalFetch(async (input, init) => {
      cookies.push(header(init, "cookie"));
      expect(init?.redirect).toBe("follow");
      if (!header(init, "cookie")) {
        return new Response("<html>Before you continue to Google</html>", {
          status: 302,
          headers: {
            location: "https://consent.google.com/ml?continue=https://news.google.com/rss/search?q=ForgeCo",
            "content-type": "text/html",
          },
        });
      }
      return new Response(FIXTURE, { status: 200, headers: { "content-type": "application/rss+xml" } });
    });
    const xml = await fetchGoogleNewsRss(gnewsCtx(), googleNewsRssUrl("ForgeCo"));
    expect(cookies).toEqual(["", expect.stringMatching(/^CONSENT=YES\+/)]);
    expect(parseGoogleNewsRss(xml ?? "")[0]?.title).toContain("ForgeCo launches");
  });

  it("logs status, host, content-type, and a 120-char snippet on non-200", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setGlobalFetch(async () => {
      return new Response("<html>quota exceeded please wait</html>", {
        status: 429,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    });
    await expect(fetchGoogleNewsRss(gnewsCtx(), googleNewsRssUrl("ForgeCo"))).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    const payload = JSON.parse(String(warn.mock.calls[0]?.[0])) as {
      msg: string;
      reason: string;
      status: number;
      host: string;
      content_type: string;
      snippet: string;
    };
    expect(payload).toMatchObject({
      msg: "gnews_fetch_failed",
      reason: "http",
      status: 429,
      host: "news.google.com",
      content_type: "text/html; charset=utf-8",
    });
    expect(payload.snippet).toContain("quota exceeded");
    expect(payload.snippet.length).toBeLessThanOrEqual(120);
    expect(JSON.stringify(payload)).not.toMatch(/CONSENT=|cookie|secret|api[_-]?key/i);
    warn.mockRestore();
  });
});
