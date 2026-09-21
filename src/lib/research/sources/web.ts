import { cleanSnippet } from "../../html";
import type { QueryPlan } from "../query-plan";
import { stampInWindow } from "../query-plan";
import type { SourceCtx } from "../http";
import { cite, emptyResult, getJson } from "../http";
import type { SourceMention, SourceResult, TimeWindow } from "../types";
import { fetchWikidata } from "./wikidata";
import { wikipediaHost } from "../../allowlist";
import { GDELT_THROTTLE_S } from "../../constants";
import { matchFlag, putFlag } from "../../cache";
import { isOpen, recordFailure, recordSuccess } from "../circuit";

type WikiSearch = { query?: { search?: Array<{ title: string; snippet?: string; pageid?: number }> } };
type WikiSummary = { title?: string; extract?: string; content_urls?: { desktop?: { page?: string } } };
type BraveWeb = { web?: { results?: Array<{ title?: string; url?: string; description?: string; age?: string }> } };
type GithubSearch = {
  items?: Array<{
    html_url?: string;
    title?: string;
    body?: string;
    user?: { login?: string };
    comments?: number;
    created_at?: string;
  }>;
};
type StackSearch = {
  items?: Array<{
    link?: string;
    title?: string;
    body?: string;
    owner?: { display_name?: string };
    score?: number;
    creation_date?: number;
  }>;
};

const githubFails = new Map<string, number>();
const soFails = new Map<string, number>();

/** True when the web query is already restricted to a host (reviews / X degrade). */
export function isSiteScopedWebQuery(q: string): boolean {
  return /\bsite:/i.test(q);
}

/** Keyword + known code-product gate. Must stay false for SAMPLE_QUERY (`Cloudflare Workers`) and the landing vs preset. */
export function isDevShapedQuery(q: string): boolean {
  return /\b(?:github|gitlab|npm|sdk|api|library|stackoverflow|stack overflow|open.?source|typescript|python|rust|golang|javascript|framework|package|react|vue|vuex|angular|svelte|next\.?js|nuxt|django|flask|rails|laravel|kubernetes|k8s|docker|terraform|postgres(?:ql)?|redis|mongodb|webpack|vite|pytorch|tensorflow)\b/i.test(
    q,
  );
}

/** Quoted-OR adapter queries are wrong for GitHub/SO; use brand names. */
export function codeSearchQuery(plan: QueryPlan): string {
  return plan.brands?.length ? plan.brands.join(" OR ") : plan.unquoted;
}

function braveUrl(q: string, lang?: string): string {
  const base = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=8`;
  if (lang && /^[a-z]{2}$/.test(lang)) return `${base}&search_lang=${lang}`;
  return base;
}

/** Web = Wikipedia + Wikidata (entity / official site) + optional Brave. DDG Instant Answer is not web search. */
export async function fetchWeb(ctx: SourceCtx, plan: QueryPlan, win: TimeWindow): Promise<SourceResult> {
  const mentions: SourceMention[] = [];
  const citations: SourceResult["citations"] = [];
  const degradedFlags: string[] = [];
  const siteScoped = isSiteScopedWebQuery(plan.web);
  const wiki = wikipediaHost(ctx.lang);

  const wikiSearchUrl = `https://${wiki}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(plan.web)}&format=json&srlimit=5&utf8=1`;
  const [wikiSearch, wd] = siteScoped
    ? [null, emptyResult("wikidata")]
    : await Promise.all([getJson<WikiSearch>(ctx, wikiSearchUrl), fetchWikidata(ctx, plan, win)]);

  const top = wikiSearch?.query?.search?.[0]?.title;
  const snippet = cleanSnippet(wikiSearch?.query?.search?.[0]?.snippet ?? "");
  if (top) {
    const sum = await getJson<WikiSummary>(
      ctx,
      `https://${wiki}/api/rest_v1/page/summary/${encodeURIComponent(top)}`,
    );
    const url = sum?.content_urls?.desktop?.page ?? `https://${wiki}/wiki/${encodeURIComponent(top.replace(/ /g, "_"))}`;
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
      braveUrl(plan.web, ctx.lang),
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

  if (!siteScoped && isDevShapedQuery(plan.web)) {
    const [gh, so] = await Promise.all([fetchGithub(ctx, plan, win), fetchStackOverflow(ctx, plan, win)]);
    mentions.push(...gh.mentions, ...so.mentions);
    citations.push(...gh.citations, ...so.citations);
    if (gh.degraded) degradedFlags.push("github");
    if (so.degraded) degradedFlags.push("stackoverflow");
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

async function fetchGithub(ctx: SourceCtx, plan: QueryPlan, win: TimeWindow): Promise<SourceResult> {
  if (await isOpen("github")) return { source: "github", mentions: [], citations: [], degraded: true };
  const throttled = await matchFlag("throttle:github");
  if (throttled) return { source: "github", mentions: [], citations: [] };
  await putFlag("throttle:github", GDELT_THROTTLE_S);
  const q = codeSearchQuery(plan);
  // /search/issues covers issues and PRs. GitHub Discussions are not on this REST endpoint.
  const json = await getJson<GithubSearch>(
    ctx,
    `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=5`,
    { accept: "application/vnd.github+json" },
  );
  if (!json) {
    await recordFailure("github", githubFails);
    return { source: "github", mentions: [], citations: [], degraded: true, error: "github_unavailable" };
  }
  await recordSuccess("github", githubFails);
  const mentions: SourceMention[] = [];
  const citations: SourceResult["citations"] = [];
  for (const item of json.items ?? []) {
    if (!item.html_url) continue;
    const ts = item.created_at ? new Date(item.created_at) : new Date();
    if (ts < win.from || ts > win.to) continue;
    mentions.push({
      platform: "web",
      url: item.html_url,
      author: item.user?.login ?? "github",
      timestamp: ts.toISOString(),
      text: cleanSnippet([item.title, item.body].filter(Boolean).join(" — ")).slice(0, 500),
      engagement: item.comments ?? 1,
      title: item.title,
    });
    citations.push(cite(item.html_url, item.title ?? item.html_url, "github"));
  }
  return { source: "github", mentions, citations };
}

async function fetchStackOverflow(ctx: SourceCtx, plan: QueryPlan, win: TimeWindow): Promise<SourceResult> {
  if (await isOpen("stackoverflow")) return { source: "stackoverflow", mentions: [], citations: [], degraded: true };
  const throttled = await matchFlag("throttle:stackoverflow");
  if (throttled) return { source: "stackoverflow", mentions: [], citations: [] };
  await putFlag("throttle:stackoverflow", GDELT_THROTTLE_S);
  const json = await getJson<StackSearch>(
    ctx,
    `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(codeSearchQuery(plan))}&site=stackoverflow&pagesize=5`,
  );
  if (!json) {
    await recordFailure("stackoverflow", soFails);
    return { source: "stackoverflow", mentions: [], citations: [], degraded: true, error: "stackoverflow_unavailable" };
  }
  await recordSuccess("stackoverflow", soFails);
  const mentions: SourceMention[] = [];
  const citations: SourceResult["citations"] = [];
  for (const item of json.items ?? []) {
    if (!item.link) continue;
    const ts = item.creation_date ? new Date(item.creation_date * 1000) : new Date();
    if (ts < win.from || ts > win.to) continue;
    mentions.push({
      platform: "web",
      url: item.link,
      author: item.owner?.display_name ?? "stackoverflow",
      timestamp: ts.toISOString(),
      text: cleanSnippet([item.title, item.body].filter(Boolean).join(" — ")).slice(0, 500),
      engagement: item.score ?? 1,
      title: item.title,
    });
    citations.push(cite(item.link, item.title ?? item.link, "stackoverflow"));
  }
  return { source: "stackoverflow", mentions, citations };
}
