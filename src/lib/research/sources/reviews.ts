import type { QueryPlan } from "../query-plan";
import type { SourceCtx } from "../http";
import { fetchReddit } from "./reddit";
import { fetchWeb } from "./web";
import type { SourceResult, TimeWindow } from "../types";
import { cite } from "../http";

export async function fetchReviews(ctx: SourceCtx, plan: QueryPlan, win: TimeWindow): Promise<SourceResult> {
  const reviewPlan: QueryPlan = {
    ...plan,
    reddit: `${plan.reddit} (review OR reviews OR "customer service" OR subreddit:reviews)`,
    web: `${plan.web} site:trustpilot.com OR site:g2.com OR site:capterra.com review`,
  };
  const [reddit, web] = await Promise.all([fetchReddit(ctx, reviewPlan, win), fetchWeb(ctx, reviewPlan, win)]);
  const mentions = [...reddit.mentions, ...web.mentions].map((m) => ({ ...m, platform: "reviews" as const }));
  const citations = [
    ...reddit.citations.map((c) => ({ ...c, source: "reviews-reddit" })),
    ...web.citations.map((c) => ({ ...c, source: "reviews-web" })),
  ];
  if (mentions.length === 0) {
    return { source: "reviews", mentions: [], citations: [], degraded: !!(reddit.degraded || web.degraded) };
  }
  return {
    source: "reviews",
    mentions,
    citations: citations.length ? citations : mentions.slice(0, 5).map((m) => cite(m.url, m.title ?? m.text.slice(0, 80), "reviews")),
    degraded: !!(reddit.degraded && web.degraded),
  };
}
