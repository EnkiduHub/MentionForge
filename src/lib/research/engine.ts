import type { CachedResearch, ResearchRequest, ResearchResponse } from "../../schemas/research";
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
import { classifyIntent } from "./intent";
import { detectSignals, sentimentByPlatform } from "./signals";
import { disabledSourcesFromEnv, urlUsesDisabledSocial } from "../disabled-sources";
import type { Platform } from "../constants";
import {
  buildPolishPrompt,
  createdBucket,
  extractXPostId,
  perPostLabelsOn,
  publicCitations,
  publicShareOfVoice,
  publicThemes,
  stripRedditPlatform,
  xStatusUrl,
  type PublicXMention,
} from "../compliance-output";

const failCounts = new Map<string, number>();

export type ResearchRun = { body: CachedResearch; freshness: "live" | "cached" };

export async function researchCacheKey(env: Env, req: ResearchRequest): Promise<string> {
  const disabled = [...disabledSourcesFromEnv(env)].sort().join(",");
  return sha256Hex(`${cacheKeyMaterial(req)}\ndisabled:${disabled}`);
}

export async function runResearch(
  env: Env,
  req: ResearchRequest,
  requestId: string,
  executionCtx?: { waitUntil(promise: Promise<unknown>): void },
): Promise<ResearchRun> {
  const key = await researchCacheKey(env, req);
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
  const disabled = disabledSourcesFromEnv(env);
  const sourcesDisabled = [...wanted].filter((p) => disabled.has(p)).sort();
  const enabled = [...wanted].filter((p) => !disabled.has(p));

  if (wanted.size > 0 && enabled.length === 0) {
    return emptyDisabledBody(req, sourcesDisabled);
  }

  const jobs: Array<() => Promise<SourceResult>> = [];
  if (wanted.has("reddit") && !disabled.has("reddit")) jobs.push(() => guarded("reddit", () => fetchReddit(ctx, plan, win)));
  if (wanted.has("news") && !disabled.has("news")) jobs.push(() => guarded("news", () => fetchNews(ctx, plan, win, req)));
  if (wanted.has("web") && !disabled.has("web")) jobs.push(() => guarded("web", () => fetchWeb(ctx, plan, win)));
  if (wanted.has("reviews") && !disabled.has("reviews")) jobs.push(() => guarded("reviews", () => fetchReviews(ctx, plan, win)));
  if (wanted.has("x") && !disabled.has("x")) jobs.push(() => guarded("x", () => fetchX(ctx, plan, win)));

  const results = dropDisabledSocial(
    await collectWithBudget(jobs, ENGINE_BUDGET_MS),
    disabled,
  );

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
  const citeOnTopic = (item: { url: string }) => onTopic({ text: "", url: item.url });
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
  const hourly = req.timeframe === "24h";
  const labelsOn = perPostLabelsOn(env);
  const xPublic: PublicXMention[] = [];
  for (const { m, s } of scored) {
    if (m.platform !== "x") continue;
    const id = extractXPostId(m.url, m.postId);
    if (!id) continue;
    const tagged = classifyIntent(m.text, s.score);
    const row: PublicXMention = {
      id,
      url: xStatusUrl(id),
      created_bucket: createdBucket(m.timestamp, hourly),
    };
    if (labelsOn) {
      row.sentiment = s.score;
      row.intent = tagged.intent;
    }
    xPublic.push(row);
    if (xPublic.length >= req.limit) break;
  }
  const mentions = xPublic;
  const x_post_ids = xPublic.map((m) => m.id);

  const by = emptyPlatformCounts();
  for (const m of fused) {
    if (m.platform === "reddit") continue;
    by[m.platform] += 1;
  }

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
    if (m.platform !== "reddit") distPlat[m.platform] = (distPlat[m.platform] ?? 0) + 1;
  }
  const totalSent = pos + neu + neg || 1;
  const pct = (n: number) => Number(((n / totalSent) * 100).toFixed(1));
  const overall = wsum ? Number((weighted / wsum).toFixed(4)) : 0;

  const trend = bucketTrend(fused, hourly);

  const citations = publicCitations(
    dedupeCites(results.flatMap((r) => r.citations)).filter((c) => citeOnTopic(c)).slice(0, 40),
  );

  const fusedUrls = new Set(fused.map((m) => m.url));
  const citeUrls = new Set(citations.map((c) => c.url));
  const sourcesUsed = results
    .filter(
      (r) =>
        r.mentions.some((m) => fusedUrls.has(canonicalizeUrl(m.url))) ||
        r.citations.some((c) => citeUrls.has(c.url)),
    )
    .map((r) => r.source);

  const themes = publicThemes(extractThemes(fused, qTokens));
  let summary: string | undefined;
  if (req.include_summary) {
    summary = executiveSummary({ req, mentions: fused, overall, volume: fused.length, themes });
    const polishPrompt = buildPolishPrompt({
      query: req.query,
      volume: fused.length,
      overall,
      themes: themes.map((t) => t.theme),
      risk: detectSignals(
        { total: fused.length, by_platform: by, trend: bucketTrend(fused, hourly) },
        {
          overall,
          positive: 0,
          neutral: 0,
          negative: 0,
          distribution: { positive: 0, neutral: 0, negative: 0, by_platform: {} },
        },
      ).risk,
    });
    const polished = await maybePolish(env, polishPrompt);
    if (polished) summary = polished;
  }

  const confidence = Math.max(0.15, Math.min(0.95, 0.35 + mentions.length / 40 + (sourcesUsed.length / 10) - degraded.length * 0.08));

  if (fused.length === 0 && jobs.length > 0 && results.every((r) => !!r.error)) {
    throw new AgentError("SOURCE_UNAVAILABLE", "All upstream sources failed.", { request_id: requestId });
  }

  const volume = {
    total: fused.length,
    by_platform: stripRedditPlatform(by) as CachedResearch["volume"]["by_platform"],
    trend,
  };
  const sentByPlat = stripRedditPlatform(
    sentimentByPlatform(scored.filter(({ m }) => m.platform !== "reddit").map(({ m, s }) => ({ platform: m.platform, score: s.score }))),
  );
  const sentiment = {
    overall,
    positive: pct(pos),
    neutral: pct(neu),
    negative: pct(neg),
    distribution: { positive: pct(pos), neutral: pct(neu), negative: pct(neg), by_platform: distPlat },
    by_platform: sentByPlat,
  };
  const sov = publicShareOfVoice(plan.brands?.length ? shareOfVoice(fused, plan.brands) : undefined);
  const signals = detectSignals(volume, sentiment);

  return {
    query: req.query,
    timeframe: req.timeframe,
    volume,
    sentiment,
    themes,
    mentions,
    x_post_ids,
    summary,
    citations,
    ...(sov ? { share_of_voice: sov } : {}),
    signals,
    meta: {
      sources_used: sourcesUsed.length ? sourcesUsed : ["none"],
      confidence: Number(confidence.toFixed(3)),
      degraded: degraded.length ? degraded : undefined,
      as_of: new Date().toISOString(),
    },
  };
}

function emptyDisabledBody(req: ResearchRequest, sourcesDisabled: Platform[]): CachedResearch {
  return {
    query: req.query,
    timeframe: req.timeframe,
    volume: { total: 0, by_platform: stripRedditPlatform(emptyPlatformCounts()) as CachedResearch["volume"]["by_platform"], trend: [] },
    sentiment: {
      overall: 0,
      positive: 0,
      neutral: 0,
      negative: 0,
      distribution: { positive: 0, neutral: 0, negative: 0, by_platform: {} },
    },
    themes: [],
    mentions: [],
    x_post_ids: [],
    citations: [],
    signals: { risk: "low", spike: false, reasons: ["no mentions in window"] },
    meta: {
      sources_used: ["none"],
      confidence: 0.15,
      degraded: sourcesDisabled,
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

function dedupeCites(cites: Array<{ url: string }>) {
  const seen = new Set<string>();
  const out: Array<{ url: string }> = [];
  for (const c of cites) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    out.push(c);
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function unique(xs: string[]): string[] {
  return [...new Set(xs.filter(Boolean))];
}

function dropDisabledSocial(results: SourceResult[], disabled: Set<Platform>): SourceResult[] {
  if (disabled.size === 0) return results;
  return results
    .filter((r) => !disabled.has(r.source as Platform))
    .map((r) => ({
      ...r,
      mentions: r.mentions.filter((m) => !disabled.has(m.platform) && !urlUsesDisabledSocial(m.url, disabled)),
      citations: r.citations.filter((c) => !urlUsesDisabledSocial(c.url, disabled)),
    }));
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

export async function maybePolish(env: Env, text: string): Promise<string | undefined> {
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

export { buildPolishPrompt } from "../compliance-output";

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
