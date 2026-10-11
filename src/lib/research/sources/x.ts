import type { QueryPlan } from "../query-plan";
import type { SourceCtx } from "../http";
import { cite, emptyResult, getJson } from "../http";
import { fetchWeb } from "./web";
import type { SourceMention, SourceResult, TimeWindow } from "../types";
import { disabledSourcesFromEnv } from "../../disabled-sources";
import { extractXPostId, xStatusUrl } from "../../compliance-output";

type XSearch = {
  data?: Array<{
    id?: string;
    text?: string;
    created_at?: string;
  }>;
};

function xSearchUrl(query: string): string {
  return `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=20&tweet.fields=created_at,text`;
}

/** X_BEARER_TOKEN is optional. Output is Post-ID only (Compliance A4). */
export async function fetchX(ctx: SourceCtx, plan: QueryPlan, win: TimeWindow): Promise<SourceResult> {
  if (disabledSourcesFromEnv(ctx.env).has("x")) return emptyResult("x", false, "source_disabled");
  if (ctx.env.X_BEARER_TOKEN) {
    const url = xSearchUrl(plan.x);
    const json = await getJson<XSearch>(ctx, url, { authorization: `Bearer ${ctx.env.X_BEARER_TOKEN}` });
    if (json?.data?.length) {
      const mentions: SourceMention[] = [];
      for (const t of json.data) {
        const ts = t.created_at ? new Date(t.created_at) : new Date();
        if (ts < win.from || ts > win.to) continue;
        const id = t.id ?? "";
        if (!id) continue;
        mentions.push({
          platform: "x",
          url: xStatusUrl(id),
          author: "",
          timestamp: ts.toISOString(),
          text: t.text ?? "",
          engagement: 0,
          postId: id,
        });
      }
      return {
        source: "x",
        mentions,
        citations: mentions.slice(0, 8).map((m) => cite(m.url, m.postId ?? "", "x")),
      };
    }
  }

  const web = await fetchWeb(ctx, { ...plan, web: `${plan.web} site:x.com OR site:twitter.com` }, win);
  const mentions: SourceMention[] = [];
  for (const m of web.mentions) {
    const id = extractXPostId(m.url, m.postId);
    if (!id) continue;
    mentions.push({
      ...m,
      platform: "x",
      url: xStatusUrl(id),
      author: "",
      postId: id,
    });
  }
  if (!mentions.length) return emptyResult("x", true);
  return {
    source: "x",
    mentions,
    citations: mentions.slice(0, 8).map((m) => cite(m.url, m.postId ?? "", "x-web")),
    degraded: true,
  };
}

export { xSearchUrl };
