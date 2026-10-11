import { GDELT_THROTTLE_S } from "../../constants";
import { matchFlag, putFlag } from "../../cache";
import type { QueryPlan } from "../query-plan";
import { gdeltTimespan } from "../query-plan";
import type { ResearchRequest } from "../../../schemas/research";
import type { SourceMention, SourceResult, TimeWindow } from "../types";
import type { SourceCtx } from "../http";
import { cite, getJson } from "../http";
import { isSubsourceDisabled } from "../../disabled-sources";
import { hnCitationLabel, hnItemUrl } from "../hn";

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

export async function fetchNews(
  ctx: SourceCtx,
  plan: QueryPlan,
  win: TimeWindow,
  req: ResearchRequest,
): Promise<SourceResult> {
  const mentions: SourceMention[] = [];
  const citations: SourceResult["citations"] = [];
  let degraded = false;

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
          origin: "gdelt",
        });
        citations.push(cite(a.url, a.title ?? a.url, "gdelt"));
      }
    }
  }

  if (!isSubsourceDisabled(ctx.env, "hn")) {
    const fromI = Math.floor(win.from.getTime() / 1000);
    const toI = Math.floor(win.to.getTime() / 1000);
    const hn = await getJson<HnHit>(
      ctx,
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(plan.news)}&tags=story&numericFilters=${encodeURIComponent(`created_at_i>${fromI},created_at_i<=${toI}`)}`,
    );
    for (const h of hn?.hits ?? []) {
      const itemUrl = h.objectID ? hnItemUrl(h.objectID) : "";
      const storyUrl = h.url?.trim() || "";
      const url = itemUrl || storyUrl;
      if (!url) continue;
      const ts = h.created_at ? new Date(h.created_at) : new Date();
      if (ts < win.from || ts > win.to) continue;
      const points = h.points ?? 0;
      const comments = h.num_comments ?? 0;
      mentions.push({
        platform: "news",
        url,
        author: h.author ?? "hn",
        timestamp: ts.toISOString(),
        text: h.title ?? h.story_text ?? url,
        engagement: points + comments,
        title: h.title ?? undefined,
        origin: "hn",
        ...(storyUrl && storyUrl !== url ? { story_url: storyUrl } : {}),
        points,
        comments,
      });
      citations.push(cite(url, hnCitationLabel(storyUrl || url), "hn"));
    }
    if (!hn) degraded = true;
  }

  if (!mentions.length) return { source: "news", mentions: [], citations: [], degraded };
  return { source: "news", mentions, citations, degraded };
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
