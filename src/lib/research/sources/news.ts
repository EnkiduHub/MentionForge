import { GDELT_THROTTLE_S, SOURCE_TIMEOUT_MS } from "../../constants";
import { matchFlag, putFlag } from "../../cache";
import { cleanSnippet } from "../../html";
import { assertAllowedUrl, cancelBody } from "../../allowlist";
import { abortMs } from "../../fetch-pool";
import type { QueryPlan } from "../query-plan";
import { gdeltTimespan } from "../query-plan";
import type { ResearchRequest } from "../../../schemas/research";
import type { SourceMention, SourceResult, TimeWindow } from "../types";
import type { SourceCtx } from "../http";
import { cite, getJson } from "../http";
import { isSubsourceDisabled } from "../../disabled-sources";

type GdeltDoc = {
  articles?: Array<{
    url?: string;
    title?: string;
    seendate?: string;
    domain?: string;
    language?: string;
  }>;
};

type HnHit = {
  hits?: Array<{
    objectID?: string;
    title?: string | null;
    url?: string | null;
    author?: string;
    created_at?: string;
    points?: number;
    num_comments?: number;
    story_text?: string | null;
  }>;
};

export type GoogleNewsItem = {
  title: string;
  link: string;
  description: string;
  pubDate: string;
};

/** Browser-like UA. The product UA is often sent to Google's consent interstitial from Workers IPs. */
const GNEWS_BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const GNEWS_ACCEPT = "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1";
const GNEWS_CONSENT_COOKIE = "CONSENT=YES+cb.20210328-17-p0.en+FX+667";
const GNEWS_MAX_HOPS = 3;

export function googleNewsRssUrl(query: string, language?: string): string {
  const q = encodeURIComponent(query);
  if (language && /^[a-z]{2}$/.test(language) && language !== "en") {
    const gl = language.toUpperCase();
    return `https://news.google.com/rss/search?q=${q}&hl=${language}&gl=${gl}&ceid=${gl}:${language}`;
  }
  return `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
}

export async function fetchNews(
  ctx: SourceCtx,
  plan: QueryPlan,
  win: TimeWindow,
  req: ResearchRequest,
): Promise<SourceResult> {
  const mentions: SourceMention[] = [];
  const citations: SourceResult["citations"] = [];
  let degraded = false;

  if (!isSubsourceDisabled(ctx.env, "gnews")) {
    const rss = await fetchGoogleNewsRss(ctx, googleNewsRssUrl(plan.news, req.language));
    if (rss) {
      for (const item of parseGoogleNewsRss(rss)) {
        const ts = item.pubDate ? new Date(item.pubDate) : new Date();
        if (ts < win.from || ts > win.to) continue;
        const snippet = [...new Set([item.title, item.description].filter(Boolean))].join(" — ") || item.link;
        mentions.push({
          platform: "news",
          url: item.link,
          author: "news",
          timestamp: ts.toISOString(),
          text: snippet,
          engagement: 1,
          title: item.title,
        });
        citations.push(cite(item.link, item.title || item.link, "google-news"));
      }
    } else {
      degraded = true;
    }
  }

  const throttled = await matchFlag("throttle:gdelt");
  if (!throttled) {
    await putFlag("throttle:gdelt", GDELT_THROTTLE_S);
    const lang = req.language ? `&sourcelang=${req.language}` : "";
    const gUrl = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(plan.news)}&mode=ArtList&format=json&timespan=${gdeltTimespan(req.timeframe)}&maxrecords=20&sort=DateDesc${lang}`;
    const g = await getJson<GdeltDoc>(ctx, gUrl);
    if (g?.articles) {
      for (const a of g.articles) {
        if (!a.url) continue;
        const ts = parseGdeltDate(a.seendate) ?? new Date();
        if (ts < win.from || ts > win.to) continue;
        mentions.push({
          platform: "news",
          url: a.url,
          author: a.domain ?? "gdelt",
          timestamp: ts.toISOString(),
          text: a.title ?? a.url,
          engagement: 2,
          title: a.title,
        });
        citations.push(cite(a.url, a.title ?? a.url, "gdelt"));
      }
    }
  }

  if (!isSubsourceDisabled(ctx.env, "hn") && mentions.length < 3) {
    const fromI = Math.floor(win.from.getTime() / 1000);
    const toI = Math.floor(win.to.getTime() / 1000);
    const hn = await getJson<HnHit>(
      ctx,
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(plan.news)}&tags=story&numericFilters=${encodeURIComponent(`created_at_i>${fromI},created_at_i<=${toI}`)}`,
    );
    for (const h of hn?.hits ?? []) {
      const url = h.url ?? (h.objectID ? `https://news.ycombinator.com/item?id=${h.objectID}` : "");
      if (!url) continue;
      const ts = h.created_at ? new Date(h.created_at) : new Date();
      if (ts < win.from || ts > win.to) continue;
      const title = h.title ?? undefined;
      const snippet = [title, h.story_text].filter(Boolean).join(" — ") || url;
      mentions.push({
        platform: "news",
        url,
        author: h.author ?? "hn",
        timestamp: ts.toISOString(),
        text: snippet,
        engagement: (h.points ?? 0) + (h.num_comments ?? 0),
        title,
      });
      citations.push(cite(url, title ?? url, "hn"));
    }
    if (!hn) degraded = true;
  }

  if (!mentions.length) return { source: "news", mentions: [], citations: [], degraded };
  return { source: "news", mentions, citations, degraded };
}

export function parseGoogleNewsRss(xml: string): GoogleNewsItem[] {
  const items: GoogleNewsItem[] = [];
  for (const item of xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const block = item[0] ?? "";
    const title = cleanSnippet(decodeXml(tag(block, "title")));
    let link = decodeXml(tag(block, "link")).trim();
    if (!link) {
      const guid = decodeXml(tag(block, "guid")).trim();
      if (/^https?:\/\//i.test(guid)) link = guid;
    }
    if (!link) {
      const href = /<link\b[^>]*\bhref=["']([^"']+)["']/i.exec(block)?.[1];
      if (href) link = decodeXml(href).trim();
    }
    const description = cleanSnippet(decodeXml(tag(block, "description")));
    const pubDate = tag(block, "pubDate");
    if (!link) continue;
    items.push({ title, link, description, pubDate });
    if (items.length >= 25) break;
  }
  return items;
}

export async function fetchGoogleNewsRss(ctx: SourceCtx, url: string): Promise<string | null> {
  assertAllowedUrl(url);
  const start = url;
  try {
    return await ctx.pool.run(() => fetchGoogleNewsRssOnce(start, false));
  } catch (err) {
    logGnewsFailure({
      reason: "network",
      host: hostOf(start),
      snippet: err instanceof Error ? err.name : "error",
    });
    return null;
  }
}

async function fetchGoogleNewsRssOnce(startUrl: string, withConsentCookie: boolean): Promise<string | null> {
  const headers = gnewsHeaders(withConsentCookie);
  let current = startUrl;
  for (let hop = 0; hop <= GNEWS_MAX_HOPS; hop++) {
    const res = await fetch(current, {
      method: "GET",
      redirect: "follow",
      signal: abortMs(SOURCE_TIMEOUT_MS),
      headers,
    });
    const host = responseHost(res, current);
    const contentType = res.headers.get("content-type");

    if (isConsentHost(host) || locationIsConsent(res)) {
      cancelBody(res);
      if (!withConsentCookie) return fetchGoogleNewsRssOnce(startUrl, true);
      logGnewsFailure({ reason: "consent", status: res.status, host, contentType, snippet: "" });
      return null;
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      cancelBody(res);
      if (!loc) {
        logGnewsFailure({ reason: "http", status: res.status, host, contentType, snippet: "" });
        return null;
      }
      let next: URL;
      try {
        next = new URL(loc, current);
      } catch {
        logGnewsFailure({ reason: "http", status: res.status, host, contentType, snippet: loc.slice(0, 120) });
        return null;
      }
      if (isConsentHost(next.hostname)) {
        if (!withConsentCookie) return fetchGoogleNewsRssOnce(startUrl, true);
        logGnewsFailure({ reason: "consent", status: res.status, host: next.hostname, contentType, snippet: "" });
        return null;
      }
      if (next.protocol !== "https:" || next.hostname !== "news.google.com") {
        logGnewsFailure({
          reason: "http",
          status: res.status,
          host: next.hostname,
          contentType,
          snippet: "",
        });
        return null;
      }
      current = next.href;
      continue;
    }

    const body = await res.text();
    if (
      !withConsentCookie &&
      (isConsentResponse(res, current, body) || (res.ok && !looksLikeRss(body) && isGoogleHtml(contentType, body)))
    ) {
      return fetchGoogleNewsRssOnce(startUrl, true);
    }
    if (!res.ok) {
      logGnewsFailure({ reason: "http", status: res.status, host, contentType, snippet: body });
      return null;
    }
    if (host && host !== "news.google.com") {
      logGnewsFailure({ reason: "http", status: res.status, host, contentType, snippet: body });
      return null;
    }
    if (!looksLikeRss(body)) {
      logGnewsFailure({ reason: "parse", status: res.status, host, contentType, snippet: body });
      return null;
    }
    return body;
  }
  logGnewsFailure({ reason: "http", status: 310, host: hostOf(startUrl), snippet: "too many redirects" });
  return null;
}

function gnewsHeaders(withConsentCookie: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    "user-agent": GNEWS_BROWSER_UA,
    accept: GNEWS_ACCEPT,
    "accept-language": "en-US,en;q=0.9",
  };
  if (withConsentCookie) headers.cookie = GNEWS_CONSENT_COOKIE;
  return headers;
}

function looksLikeRss(body: string): boolean {
  return /<(?:rss|rdf:RDF|feed)\b/i.test(body.slice(0, 4096));
}

function isConsentHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "consent.google.com" || h.endsWith(".consent.google.com");
}

function locationIsConsent(res: Response): boolean {
  return /consent\.google\.com/i.test(res.headers.get("location") ?? "");
}

function isConsentResponse(res: Response, requestUrl: string, body: string): boolean {
  if (isConsentHost(responseHost(res, requestUrl)) || locationIsConsent(res)) return true;
  const head = body.slice(0, 2500).toLowerCase();
  return head.includes("consent.google.com") || head.includes("before you continue to google") || /sorry\/index/.test(head);
}

function isGoogleHtml(contentType: string | null, body: string): boolean {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("xml") || ct.includes("rss") || ct.includes("atom")) return false;
  if (looksLikeRss(body)) return false;
  return ct.includes("text/html") || /<!doctype html|<html[\s>]/i.test(body.slice(0, 1024));
}

function responseHost(res: Response, fallbackUrl: string): string {
  try {
    if (res.url) return new URL(res.url).hostname;
  } catch {
    /* ignore */
  }
  try {
    const loc = res.headers.get("location");
    if (loc) return new URL(loc, fallbackUrl).hostname;
  } catch {
    /* ignore */
  }
  return hostOf(fallbackUrl);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function logGnewsFailure(fields: {
  reason: string;
  status?: number;
  host?: string;
  contentType?: string | null;
  snippet?: string;
}): void {
  console.warn(
    JSON.stringify({
      msg: "gnews_fetch_failed",
      reason: fields.reason,
      status: fields.status ?? null,
      host: fields.host ?? "",
      content_type: fields.contentType ?? "",
      snippet: (fields.snippet ?? "").replace(/\s+/g, " ").slice(0, 120),
    }),
  );
}

function tag(block: string, name: string): string {
  const m = new RegExp(
    `<${name}(?:\\s[^>]*)?>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*</${name}>`,
    "i",
  ).exec(block);
  return (m?.[1] ?? m?.[2] ?? "").trim();
}

function decodeXml(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const n = Number.parseInt(hex, 16);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    })
    .replace(/&#(\d+);/g, (_, num: string) => {
      const n = Number(num);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    });
}

function parseGdeltDate(s?: string): Date | null {
  if (!s || s.length < 8) return null;
  const y = s.slice(0, 4);
  const mo = s.slice(4, 6);
  const d = s.slice(6, 8);
  const hh = s.length >= 10 ? s.slice(8, 10) : "00";
  const mm = s.length >= 12 ? s.slice(10, 12) : "00";
  const ss = s.length >= 14 ? s.slice(12, 14) : "00";
  const dt = new Date(`${y}-${mo}-${d}T${hh}:${mm}:${ss}Z`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}
