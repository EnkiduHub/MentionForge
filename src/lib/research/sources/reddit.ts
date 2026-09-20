import type { QueryPlan } from "../query-plan";
import type { TimeWindow } from "../types";
import type { SourceCtx } from "../http";
import { cite, emptyResult, getJson } from "../http";
import type { SourceMention, SourceResult } from "../types";
import { allowedFetch } from "../../allowlist";
import { abortMs } from "../../fetch-pool";
import { SOURCE_TIMEOUT_MS, UNAUTH_SOURCE_TIMEOUT_MS, USER_AGENT } from "../../constants";

type RedditListing = {
  data?: {
    children?: Array<{
      data?: {
        id?: string;
        subreddit?: string;
        author?: string;
        title?: string;
        selftext?: string;
        permalink?: string;
        url?: string;
        created_utc?: number;
        score?: number;
        num_comments?: number;
      };
    }>;
  };
};

type TokenJson = { access_token?: string; expires_in?: number };

export async function fetchReddit(ctx: SourceCtx, plan: QueryPlan, win: TimeWindow): Promise<SourceResult> {
  const q = encodeURIComponent(plan.reddit);
  const token = await redditOAuthToken(ctx);
  const url = token
    ? `https://oauth.reddit.com/search?q=${q}&sort=relevance&t=year&limit=50&raw_json=1`
    : `https://www.reddit.com/search.json?q=${q}&sort=relevance&t=year&limit=50&raw_json=1`;
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  const json = await getJson<RedditListing>(ctx, url, headers, token ? SOURCE_TIMEOUT_MS : UNAUTH_SOURCE_TIMEOUT_MS);
  if (!json) return emptyResult("reddit", true, "reddit_unavailable");
  const mentions: SourceMention[] = [];
  for (const child of json.data?.children ?? []) {
    const d = child.data;
    if (!d) continue;
    const ts = new Date((d.created_utc ?? 0) * 1000);
    if (ts < win.from || ts > win.to) continue;
    const permalink = d.permalink ? `https://www.reddit.com${d.permalink}` : d.url ?? "";
    const text = [d.title, d.selftext].filter(Boolean).join(" — ");
    mentions.push({
      platform: "reddit",
      url: permalink,
      author: d.author ? `u/${d.author}` : "unknown",
      timestamp: ts.toISOString(),
      text,
      engagement: (d.score ?? 0) + (d.num_comments ?? 0),
      title: d.title,
    });
  }
  return {
    source: "reddit",
    mentions,
    citations: mentions.slice(0, 8).map((m) => cite(m.url, m.title ?? m.text.slice(0, 80), "reddit")),
  };
}

/** Optional. Missing credentials → public search.json with a short abort (often blocked from Workers). */
async function redditOAuthToken(ctx: SourceCtx): Promise<string | null> {
  const id = ctx.env.REDDIT_CLIENT_ID;
  const secret = ctx.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  const cacheReq = new Request("https://mentionforge.cache/reddit-oauth", { method: "GET" });
  try {
    const hit = await caches.default.match(cacheReq);
    if (hit) return await hit.text();
  } catch {
    /* ignore */
  }
  try {
    const res = await allowedFetch("https://www.reddit.com/api/v1/access_token", {
      pool: ctx.pool,
      signal: abortMs(SOURCE_TIMEOUT_MS),
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${id}:${secret}`)}`,
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": USER_AGENT,
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as TokenJson;
    const token = json.access_token;
    if (!token) return null;
    const ttl = Math.max(60, Math.min(json.expires_in ?? 3600, 3500));
    try {
      await caches.default.put(
        cacheReq,
        new Response(token, { headers: { "Cache-Control": `private, max-age=${ttl}` } }),
      );
    } catch {
      /* ignore */
    }
    return token;
  } catch {
    return null;
  }
}
