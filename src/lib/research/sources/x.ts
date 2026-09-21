import type { QueryPlan } from "../query-plan";
import type { SourceCtx } from "../http";
import { cite, emptyResult, getJson } from "../http";
import { fetchWeb } from "./web";
import type { SourceMention, SourceResult, TimeWindow } from "../types";

type XSearch = {
  data?: Array<{
    id?: string;
    text?: string;
    author_id?: string;
    created_at?: string;
    public_metrics?: { like_count?: number; retweet_count?: number; reply_count?: number };
  }>;
  includes?: { users?: Array<{ id: string; username: string }> };
};

/** X_BEARER_TOKEN is optional. Without it, X degrades to web mentions (site:x.com). */
export async function fetchX(ctx: SourceCtx, plan: QueryPlan, win: TimeWindow): Promise<SourceResult> {
  if (ctx.env.X_BEARER_TOKEN) {
    const url = `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(plan.x)}&max_results=20&tweet.fields=created_at,public_metrics,author_id&expansions=author_id&user.fields=username`;
    const json = await getJson<XSearch>(ctx, url, { authorization: `Bearer ${ctx.env.X_BEARER_TOKEN}` });
    if (json?.data?.length) {
      const users = new Map((json.includes?.users ?? []).map((u) => [u.id, u.username]));
      const mentions: SourceMention[] = [];
      for (const t of json.data) {
        const ts = t.created_at ? new Date(t.created_at) : new Date();
        if (ts < win.from || ts > win.to) continue;
        const username = t.author_id ? users.get(t.author_id) : undefined;
        const id = t.id ?? "";
        const permalink = username && id ? `https://x.com/${username}/status/${id}` : `https://x.com/i/web/status/${id}`;
        const m = t.public_metrics;
        mentions.push({
          platform: "x",
          url: permalink,
          author: username ? `@${username}` : "x",
          timestamp: ts.toISOString(),
          text: t.text ?? "",
          engagement: (m?.like_count ?? 0) + (m?.retweet_count ?? 0) + (m?.reply_count ?? 0),
        });
      }
      return {
        source: "x",
        mentions,
        citations: mentions.slice(0, 8).map((m) => cite(m.url, m.text.slice(0, 80), "x")),
      };
    }
  }

  const web = await fetchWeb(ctx, { ...plan, web: `${plan.web} site:x.com OR site:twitter.com` }, win);
  const mentions = web.mentions
    .filter((m) => {
      try {
        const h = new URL(m.url).hostname.replace(/^www\./, "");
        return h === "x.com" || h === "twitter.com";
      } catch {
        return false;
      }
    })
    .map((m) => ({ ...m, platform: "x" as const }));
  if (!mentions.length) return emptyResult("x", true);
  return {
    source: "x",
    mentions,
    citations: mentions.slice(0, 8).map((m) => cite(m.url, m.title ?? m.text.slice(0, 80), "x-web")),
    degraded: true,
  };
}
