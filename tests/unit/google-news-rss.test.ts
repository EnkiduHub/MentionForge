import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FetchPool } from "../../src/lib/fetch-pool";
import { planQuery, windowFor } from "../../src/lib/research/query-plan";
import {
  fetchGoogleNewsRss,
  fetchNews,
  gnewsCitationLabel,
  gnewsMentionText,
  googleNewsRssUrl,
  isGnewsFetchHost,
  parseGoogleNewsRss,
} from "../../src/lib/research/sources/news";
import { parseResearchInput } from "../../src/schemas/research";
import { jsonResponse, mockEnv, setGlobalFetch, stubCaches } from "../helpers/env";

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
      source: "The Example Times",
      publisher: "example.com",
    });
    expect(items[0]?.description).toContain("The Example Times");
    expect(items[0]?.description).not.toMatch(/<[^>]+>/);
    expect(items[0]?.description).not.toMatch(/&nbsp;|&amp;|&lt;/i);
    expect(gnewsMentionText(items[0]!.title, items[0]!.description, items[0]!.source)).toBe(
      "ForgeCo launches Workers RSS & more",
    );
    expect(gnewsCitationLabel(items[0]!)).toBe("ForgeCo launches Workers RSS & more");
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
    expect(redirects.every((r) => r === "manual")).toBe(true);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain("hl=en-US");
    expect(parseGoogleNewsRss(xml ?? "")).toHaveLength(3);
  });

  it("retries with a CONSENT cookie when Google redirects to consent.google.com", async () => {
    const cookies: string[] = [];
    setGlobalFetch(async (input, init) => {
      cookies.push(header(init, "cookie"));
      expect(init?.redirect).toBe("manual");
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

  it("uses only the title when the description echoes 'title - Source' and keeps source/publisher separate", () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item>
        <title>ForgeCo ships - The Example Times</title>
        <link>https://news.google.com/rss/articles/CBMiEcho</link>
        <description><![CDATA[<a href="https://news.google.com/rss/articles/CBMiEcho">ForgeCo ships - The Example Times</a>&nbsp;&nbsp;<font color="#6f6f6f">The Example Times</font>]]></description>
        <source url="https://www.example.com">The Example Times</source>
        <pubDate>Sun, 11 Oct 2026 16:00:00 GMT</pubDate>
      </item>
    </channel></rss>`;
    const [item] = parseGoogleNewsRss(xml);
    expect(item?.description).toContain("ForgeCo ships - The Example Times");
    expect(item?.description).not.toMatch(/<a |<font |&nbsp;/i);
    expect(item?.source).toBe("The Example Times");
    expect(item?.publisher).toBe("example.com");
    expect(gnewsMentionText(item!.title, item!.description, item!.source)).toBe("ForgeCo ships - The Example Times");
    expect(gnewsMentionText(item!.title, item!.description, item!.source)).not.toContain(" — ");
  });

  it("prefers a publisher article URL from the RSS and labels the citation with the headline", () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item>
        <title>ForgeCo direct - Wire</title>
        <link>https://news.google.com/rss/articles/CBMiDirect</link>
        <guid isPermaLink="false">CBMiDirect</guid>
        <description><![CDATA[<a href="https://wire.example/forgeco-direct">ForgeCo direct - Wire</a>]]></description>
        <source url="https://www.wire.example">Wire</source>
        <pubDate>Sun, 11 Oct 2026 16:00:00 GMT</pubDate>
      </item>
      <item>
        <title>ForgeCo google-only - Wire</title>
        <link>https://news.google.com/rss/articles/CBMiGoogleOnly</link>
        <description><![CDATA[ForgeCo google-only - Wire]]></description>
        <source url="https://www.wire.example">Wire</source>
        <pubDate>Sun, 11 Oct 2026 15:00:00 GMT</pubDate>
      </item>
    </channel></rss>`;
    const items = parseGoogleNewsRss(xml);
    expect(items[0]?.link).toBe("https://wire.example/forgeco-direct");
    expect(gnewsCitationLabel(items[0]!)).toBe("ForgeCo direct - Wire");
    expect(items[1]?.link).toBe("https://news.google.com/rss/articles/CBMiGoogleOnly");
    expect(gnewsCitationLabel(items[1]!)).toBe("ForgeCo google-only - Wire");
    expect(gnewsCitationLabel({ title: "", link: "https://x.example/a", publisher: "wire.example" })).toBe("wire.example");
  });

  it("does not request a redirect host other than news.google.com or consent.google.com", async () => {
    const urls: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setGlobalFetch(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      urls.push(url);
      expect(init?.redirect).toBe("manual");
      return new Response(null, {
        status: 302,
        headers: { location: "https://evil.example/rss" },
      });
    });
    await expect(fetchGoogleNewsRss(gnewsCtx(), googleNewsRssUrl("ForgeCo"))).resolves.toBeNull();
    expect(urls).toEqual([googleNewsRssUrl("ForgeCo")]);
    expect(urls.some((u) => u.includes("evil.example"))).toBe(false);
    expect(isGnewsFetchHost("news.google.com")).toBe(true);
    expect(isGnewsFetchHost("consent.google.com")).toBe(true);
    expect(isGnewsFetchHost("evil.example")).toBe(false);
    const payload = JSON.parse(String(warn.mock.calls[0]?.[0])) as { host: string; snippet: string };
    expect(payload.host).toBe("evil.example");
    expect(payload.snippet).toContain("blocked redirect host");
    warn.mockRestore();
  });

  it("stops after 3 redirect hops on news.google.com", async () => {
    const urls: string[] = [];
    setGlobalFetch(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      urls.push(url);
      expect(init?.redirect).toBe("manual");
      return new Response(null, {
        status: 302,
        headers: { location: `https://news.google.com/rss/search?q=hop${urls.length}` },
      });
    });
    await expect(fetchGoogleNewsRss(gnewsCtx(), googleNewsRssUrl("ForgeCo"))).resolves.toBeNull();
    expect(urls).toHaveLength(4);
    expect(urls.every((u) => new URL(u).hostname === "news.google.com")).toBe(true);
  });

  it("emits Google News rows with title-only text, publisher field, and citation label/url rules", async () => {
    const rss = `<?xml version="1.0"?><rss><channel>
      <item>
        <title>ForgeCo ships - The Example Times</title>
        <link>https://news.google.com/rss/articles/CBMiRow</link>
        <description><![CDATA[<a href="https://news.google.com/rss/articles/CBMiRow">ForgeCo ships - The Example Times</a>&nbsp;&nbsp;<font>The Example Times</font>]]></description>
        <source url="https://www.example.com">The Example Times</source>
        <pubDate>${new Date().toUTCString()}</pubDate>
      </item>
      <item>
        <title>ForgeCo analysis - Wire</title>
        <link>https://news.google.com/rss/articles/CBMiWire</link>
        <description><![CDATA[<a href="https://wire.example/analysis">ForgeCo analysis - Wire</a>]]></description>
        <source url="https://wire.example">Wire</source>
        <pubDate>${new Date().toUTCString()}</pubDate>
      </item>
    </channel></rss>`;
    setGlobalFetch(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      expect(url).not.toContain("evil.");
      if (url.startsWith("https://news.google.com/")) {
        return new Response(rss, { status: 200, headers: { "content-type": "application/rss+xml" } });
      }
      return jsonResponse({}, 404);
    });
    const req = parseResearchInput({ query: "ForgeCo", platforms: ["news"] });
    const result = await fetchNews(gnewsCtx(), planQuery(req), windowFor("7d"), req);
    const echo = result.mentions.find((m) => m.title === "ForgeCo ships - The Example Times");
    expect(echo?.text).toBe("ForgeCo ships - The Example Times");
    expect(echo?.text).not.toContain(" — ");
    expect(echo?.publisher).toBe("example.com");
    expect(echo?.author).toBe("The Example Times");
    expect(echo?.url).toBe("https://news.google.com/rss/articles/CBMiRow");
    const echoCite = result.citations.find((c) => c.url === echo?.url);
    expect(echoCite?.title).toBe("ForgeCo ships - The Example Times");
    expect(echoCite?.source).toBe("google-news");
    const direct = result.mentions.find((m) => m.title === "ForgeCo analysis - Wire");
    expect(direct?.url).toBe("https://wire.example/analysis");
    expect(direct?.publisher).toBe("wire.example");
    const directCite = result.citations.find((c) => c.url === "https://wire.example/analysis");
    expect(directCite?.title).toBe("ForgeCo analysis - Wire");
    expect(result.citations.some((c) => c.url.includes("CBMiWire"))).toBe(false);
  });
});
