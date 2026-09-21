import type { CachedResearch, Mention, ResearchRequest, ResearchResponse } from "../../schemas/research";
import { emptyPlatformCounts } from "../../schemas/research";
import { AgentError } from "../../schemas/errors";
import { AI_TIMEOUT_MS, ENGINE_BUDGET_MS, MAX_MENTION_CHARS } from "../constants";
import { FetchPool } from "../fetch-pool";
import { coalesce } from "../coalesce";
import { matchResearch, putResearch, researchOnly, ttlForTimeframe } from "../cache";
import { sha256Hex, truncate } from "../crypto";
import { cleanSnippet } from "../html";
import { cacheKeyMaterial, planQuery, windowFor } from "./query-plan";
import { canonicalizeUrl, fingerprint, isSpam, relevantToQuery } from "./spam";
import { scoreText, tokenize } from "./sentiment";
import { extractThemes } from "./themes";
import { sortMentions } from "./rank";
import { executiveSummary } from "./summary";
import { isOpen, recordFailure, recordSuccess } from "./circuit";
import { fetchReddit } from "./sources/reddit";
import { fetchNews } from "./sources/news";
import { fetchWeb } from "./sources/web";
import { fetchReviews } from "./sources/reviews";
import { fetchX } from "./sources/x";
import type { SourceCtx } from "./http";
import type { SourceMention, SourceResult } from "./types";
import { relevantToBrands, shareOfVoice } from "./sov";
import { classifyIntent, relevanceScore } from "./intent";
import { detectSignals, sentimentByPlatform, topVoices } from "./signals";

const failCounts = new Map<string, number>();

export type ResearchRun = { body: CachedResearch; freshness: "live" | "cached" };

export async function runResearch(
  env: Env,
  req: ResearchRequest,
  requestId: string,
  executionCtx?: { waitUntil(promise: Promise<unknown>): void },
): Promise<ResearchRun> {
  const key = await sha256Hex(cacheKeyMaterial(req));
  return coalesce(`research:${key}`, async () => {
    const cached = await matchResearch(key);
    const policy = ttlForTimeframe(req.timeframe);
    if (cached && !cached.stale) {
      return { body: researchOnly(cached.body), freshness: "cached" as const };
    }
    if (cached && cached.stale && executionCtx) {
      executionCtx.waitUntil(
        gather(env, req, requestId)
          .then((fresh) => putResearch(key, fresh, policy.ttlSec))
          .catch(() => undefined),
      );
      return { body: researchOnly(cached.body), freshness: "cached" as const };
    }
    const fresh = await gather(env, req, requestId);
    await putResearch(key, fresh, policy.ttlSec);
    return { body: fresh, freshness: "live" as const };
  });
}

async function gather(env: Env, req: ResearchRequest, requestId: string): Promise<CachedResearch> {
  const plan = planQuery(req);
  const win = windowFor(req.timeframe);
  const pool = new FetchPool();
  const ctx: SourceCtx = { env, pool, query: plan.unquoted, lang: req.language };
  const wanted = new Set(req.platforms);

  const jobs: Array<() => Promise<SourceResult>> = [];
  if (wanted.has("reddit")) jobs.push(() => guarded("reddit", () => fetchReddit(ctx, plan, win)));
  if (wanted.has("news")) jobs.push(() => guarded("news", () => fetchNews(ctx, plan, win, req)));
  if (wanted.has("web")) jobs.push(() => guarded("web", () => fetchWeb(ctx, plan, win)));
  if (wanted.has("reviews")) jobs.push(() => guarded("reviews", () => fetchReviews(ctx, plan, win)));
  if (wanted.has("x")) jobs.push(() => guarded("x", () => fetchX(ctx, plan, win)));

  const results = await collectWithBudget(jobs, ENGINE_BUDGET_MS);

  const anyMentions = results.some((r) => r.mentions.length > 0);
  const allFailed = results.length > 0 && results.every((r) => !!r.error && r.mentions.length === 0);
  if (!anyMentions && (allFailed || (!results.length && jobs.length > 0))) {
    throw new AgentError("SOURCE_UNAVAILABLE", "All upstream sources failed.", { request_id: requestId });
  }

  const degraded = unique([
    ...results.filter((r) => r.degraded).map((r) => r.source),
    ...results.flatMap((r) => r.degradedFlags ?? []),
  ]);

  const qTokens = tokenize((plan.brands ?? [plan.brand]).join(" "));
  const onTopic = (item: { text: string; url: string; title?: string }) =>
    plan.brands && plan.brands.length >= 2 ? relevantToBrands(item, plan.brands) : relevantToQuery(item, qTokens);
  let fused: SourceMention[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    for (const m of r.mentions) {
      const url = canonicalizeUrl(m.url);
      const item = { ...m, url, text: truncate(cleanSnippet(m.text.replace(/\s+/g, " ").trim()), MAX_MENTION_CHARS) };
      if (isSpam(item)) continue;
      if (!onTopic(item)) continue;
      if (req.min_engagement && item.engagement < req.min_engagement) continue;
      const fp = fingerprint(item);
      if (seen.has(fp) || seen.has(url)) continue;
      seen.add(fp);
      seen.add(url);
      fused.push(item);
    }
  }

  fused = fused.filter((m) => {
    const t = Date.parse(m.timestamp);
    return Number.isFinite(t) && t >= win.from.getTime() && t <= win.to.getTime();
  });

  fused = sortMentions(fused, win);
  const fetchCap = Math.min(50, Math.max(req.limit * 3, 20));
  fused = fused.slice(0, fetchCap);

  let scored = fused.map((m) => ({ m, s: scoreText(m.text, qTokens) }));
  scored = await maybeDistilbert(env, scored);
  const mentions: Mention[] = scored.slice(0, req.limit).map(({ m, s }) => {
    const tagged = classifyIntent(m.text, s.score);
    return {
      id: idFor(m),
      platform: m.platform,
      url: m.url,
      author: m.author,
      timestamp: m.timestamp,
      text: m.text,
      engagement: m.engagement,
      sentiment: s.score,
      intent: tagged.intent,
      aspects: tagged.aspects.length ? tagged.aspects : undefined,
      relevance: relevanceScore(m, qTokens),
    };
  });

  const by = emptyPlatformCounts();
  for (const m of fused) by[m.platform] += 1;

  let pos = 0,
    neu = 0,
    neg = 0,
    weighted = 0,
    wsum = 0;
  const distPlat: Record<string, number> = {};
  for (const { m, s } of scored) {
    if (s.label === "positive") pos++;
    else if (s.label === "negative") neg++;
    else neu++;
    const w = Math.log1p(m.engagement);
    weighted += s.score * w;
    wsum += w;
    distPlat[m.platform] = (distPlat[m.platform] ?? 0) + 1;
  }
  const totalSent = pos + neu + neg || 1;
  const pct = (n: number) => Number(((n / totalSent) * 100).toFixed(1));
  const overall = wsum ? Number((weighted / wsum).toFixed(4)) : 0;

  const themes = extractThemes(fused, qTokens);
  const trend = bucketTrend(fused, req.timeframe === "24h");

  const citations = dedupeCites(results.flatMap((r) => r.citations))
    .filter((c) => onTopic({ text: c.title, url: c.url }))
    .slice(0, 40);

  const fusedUrls = new Set(fused.map((m) => m.url));
  const citeUrls = new Set(citations.map((c) => c.url));
  const sourcesUsed = results
    .filter(
      (r) =>
        r.mentions.some((m) => fusedUrls.has(canonicalizeUrl(m.url))) ||
        r.citations.some((c) => citeUrls.has(c.url)),
    )
    .map((r) => r.source);

  let summary: string | undefined;
  if (req.include_summary) {
    summary = executiveSummary({ req, mentions: fused, overall, volume: fused.length, themes });
    const polished = await maybePolish(env, summary);
    if (polished) summary = polished;
  }

  const confidence = Math.max(0.15, Math.min(0.95, 0.35 + mentions.length / 40 + (sourcesUsed.length / 10) - degraded.length * 0.08));

  if (fused.length === 0 && jobs.length > 0 && results.every((r) => !!r.error)) {
    throw new AgentError("SOURCE_UNAVAILABLE", "All upstream sources failed.", { request_id: requestId });
  }

  const volume = { total: fused.length, by_platform: by, trend };
  const sentiment = {
    overall,
    positive: pct(pos),
    neutral: pct(neu),
    negative: pct(neg),
    distribution: { positive: pct(pos), neutral: pct(neu), negative: pct(neg), by_platform: distPlat },
    by_platform: sentimentByPlatform(scored.map(({ m, s }) => ({ platform: m.platform, score: s.score }))),
  };
  const sov = plan.brands?.length ? shareOfVoice(fused, plan.brands) : undefined;
  const signals = detectSignals(volume, sentiment);
  const voices = topVoices(mentions);

  return {
    query: req.query,
    timeframe: req.timeframe,
    volume,
    sentiment,
    themes,
    mentions,
    summary,
    citations,
    ...(sov ? { share_of_voice: sov } : {}),
    signals,
    ...(voices?.length ? { voices } : {}),
    meta: {
      sources_used: sourcesUsed.length ? sourcesUsed : ["none"],
      confidence: Number(confidence.toFixed(3)),
      degraded: degraded.length ? degraded : undefined,
      as_of: new Date().toISOString(),
    },
  };
}

async function collectWithBudget(jobs: Array<() => Promise<SourceResult>>, ms: number): Promise<SourceResult[]> {
  const slots: Array<SourceResult | undefined> = jobs.map(() => undefined);
  const running = jobs.map((j, i) =>
    j()
      .then((v) => {
        slots[i] = v;
      })
      .catch((err) => {
        slots[i] = { source: "unknown", mentions: [], citations: [], degraded: true, error: String(err) };
      }),
  );
  await Promise.race([Promise.all(running), sleep(ms)]);
  return slots.filter((r): r is SourceResult => !!r);
}

async function guarded(name: string, fn: () => Promise<SourceResult>): Promise<SourceResult> {
  if (await isOpen(name)) {
    return { source: name, mentions: [], citations: [], degraded: true, error: "circuit_open" };
  }
  try {
    const r = await fn();
    if (r.error && !r.mentions.length) await recordFailure(name, failCounts);
    else await recordSuccess(name, failCounts);
    return r;
  } catch (err) {
    await recordFailure(name, failCounts);
    return { source: name, mentions: [], citations: [], degraded: true, error: String(err) };
  }
}

function bucketTrend(mentions: SourceMention[], hourly: boolean) {
  const map = new Map<string, number>();
  for (const m of mentions) {
    const d = new Date(m.timestamp);
    const key = hourly
      ? `${d.toISOString().slice(0, 13)}:00:00.000Z`
      : `${d.toISOString().slice(0, 10)}T00:00:00.000Z`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([t, count]) => ({ t, count }));
}

function dedupeCites(cites: CachedResearch["citations"]) {
  const seen = new Set<string>();
  const out: CachedResearch["citations"] = [];
  for (const c of cites) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    out.push(c);
  }
  return out;
}

function idFor(m: SourceMention): string {
  const s = `${m.platform}|${m.url}|${m.timestamp}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return `mf_${(h >>> 0).toString(16)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function unique(xs: string[]): string[] {
  return [...new Set(xs.filter(Boolean))];
}

type DistilbertOut =
  | { label?: string; score?: number }
  | Array<{ label?: string; score?: number }>;

function distilbertToScore(out: DistilbertOut): number | null {
  const arr = Array.isArray(out) ? out : [out];
  const pos = arr.find((x) => (x.label ?? "").toUpperCase().includes("POS"));
  const neg = arr.find((x) => (x.label ?? "").toUpperCase().includes("NEG"));
  if (pos?.score != null && neg?.score != null) return Number((pos.score - neg.score).toFixed(4));
  if (pos?.score != null) return Number((pos.score * 2 - 1).toFixed(4));
  if (neg?.score != null) return Number((1 - neg.score * 2).toFixed(4));
  return null;
}

async function maybeDistilbert(
  env: Env,
  scored: Array<{ m: SourceMention; s: { score: number; label: "positive" | "neutral" | "negative" } }>,
): Promise<Array<{ m: SourceMention; s: { score: number; label: "positive" | "neutral" | "negative" } }>> {
  if (!env.AI || scored.length === 0) return scored;
  const topN = scored.slice(0, 10);
  try {
    const overlay = await Promise.race([
      Promise.all(
        topN.map(async ({ m, s }) => {
          try {
            const raw = (await env.AI!.run("@cf/huggingface/distilbert-sst-2-int8", { text: m.text })) as DistilbertOut;
            const dl = distilbertToScore(raw);
            if (dl == null) return { m, s };
            const score = Number((0.55 * s.score + 0.45 * dl).toFixed(4));
            const clamped = Math.max(-1, Math.min(1, score));
            const label = clamped > 0.12 ? ("positive" as const) : clamped < -0.12 ? ("negative" as const) : ("neutral" as const);
            return { m, s: { score: clamped, label } };
          } catch {
            return { m, s };
          }
        }),
      ),
      sleep(AI_TIMEOUT_MS).then(() => null),
    ]);
    if (!overlay) return scored;
    return [...overlay, ...scored.slice(10)];
  } catch {
    return scored;
  }
}

async function maybePolish(env: Env, text: string): Promise<string | undefined> {
  if (!env.AI) return undefined;
  try {
    const out = await Promise.race([
      env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [
          { role: "system", content: "Rewrite this executive social-listening brief in 4 short sentences. No markdown." },
          { role: "user", content: text },
        ],
      }),
      sleep(AI_TIMEOUT_MS).then(() => null),
    ]);
    if (!out || typeof out !== "object") return undefined;
    const resp = (out as { response?: string }).response;
    return resp?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function overlayBilling(
  research: CachedResearch,
  extras: ResearchResponse["meta"],
  freshness: "live" | "cached",
): ResearchResponse {
  return {
    ...research,
    meta: {
      ...research.meta,
      ...extras,
      freshness,
    },
  };
}
