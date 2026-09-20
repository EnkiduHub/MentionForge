import { cleanSnippet } from "../../html";
import type { QueryPlan } from "../query-plan";
import { stampInWindow } from "../query-plan";
import type { SourceCtx } from "../http";
import { cite, emptyResult, getJson } from "../http";
import type { SourceMention, SourceResult, TimeWindow } from "../types";
import { fetchWikidata } from "./wikidata";

type WikiSearch = { query?: { search?: Array<{ title: string; snippet?: string; pageid?: number }> } };
type WikiSummary = { title?: string; extract?: string; content_urls?: { desktop?: { page?: string } } };
type BraveWeb = { web?: { results?: Array<{ title?: string; url?: string; description?: string; age?: string }> } };

/** True when the web query is already restricted to a host (reviews / X degrade). */
export function isSiteScopedWebQuery(q: string): boolean {
  return /\bsite:/i.test(q);
}

/** Web = Wikipedia + Wikidata (entity / official site) + optional Brave. DDG Instant Answer is not web search. */
export async function fetchWeb(ctx: SourceCtx, plan: QueryPlan, win: TimeWindow): Promise<SourceResult> {
  const mentions: SourceMention[] = [];
  const citations: SourceResult["citations"] = [];
  const degradedFlags: string[] = [];
  const siteScoped = isSiteScopedWebQuery(plan.web);

  const wikiSearchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(plan.web)}&format=json&srlimit=5&utf8=1`;
  const [wikiSearch, wd] = siteScoped
    ? [null, emptyResult("wikidata")]
    : await Promise.all([getJson<WikiSearch>(ctx, wikiSearchUrl), fetchWikidata(ctx, plan, win)]);

  const top = wikiSearch?.query?.search?.[0]?.title;
  const snippet = cleanSnippet(wikiSearch?.query?.search?.[0]?.snippet ?? "");
  if (top) {
    const sum = await getJson<WikiSummary>(
      ctx,
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(top)}`,
    );
    const url = sum?.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(top.replace(/ /g, "_"))}`;
    const text = cleanSnippet(sum?.extract ?? (snippet || top));
    mentions.push({
      platform: "web",
      url,
      author: "wikipedia",
      timestamp: stampInWindow(win),
      text,
      engagement: 8,
      title: sum?.title ?? top,
    });
    citations.push(cite(url, sum?.title ?? top, "wikipedia"));
  } else if (!siteScoped) {
    degradedFlags.push("wikipedia");
  }

  if (!siteScoped) {
    mentions.push(...wd.mentions);
    citations.push(...wd.citations);
    if (wd.degraded) degradedFlags.push("wikidata");
  }

  if (ctx.env.BRAVE_API_KEY) {
    const brave = await getJson<BraveWeb>(
      ctx,
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(plan.web)}&count=8`,
      { "X-Subscription-Token": ctx.env.BRAVE_API_KEY },
    );
    for (const r of brave?.web?.results ?? []) {
      if (!r.url) continue;
      mentions.push({
        platform: "web",
        url: r.url,
        author: "web",
        timestamp: stampInWindow(win),
        text: cleanSnippet([r.title, r.description].filter(Boolean).join(" — ")),
        engagement: 3,
        title: r.title ? cleanSnippet(r.title) : r.title,
      });
      citations.push(cite(r.url, r.title ?? r.url, "brave"));
    }
  } else {
    degradedFlags.push("brave");
  }

  if (!mentions.length) return { ...emptyResult("web", true), degradedFlags };
  return {
    source: "web",
    mentions,
    citations,
    degraded: degradedFlags.length > 0,
    degradedFlags,
  };
}
