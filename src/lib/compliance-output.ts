import type { ResearchResponse } from "../schemas/research";
import { THEME_VOCAB, isThemeVocab } from "./theme-vocab";

export const RESEARCH_ALLOW = new Set([
  "query",
  "timeframe",
  "volume",
  "total",
  "by_platform",
  "trend",
  "t",
  "count",
  "sentiment",
  "overall",
  "positive",
  "neutral",
  "negative",
  "distribution",
  "share_of_voice",
  "brand",
  "mentions",
  "share",
  "signals",
  "risk",
  "spike",
  "reasons",
  "themes",
  "theme",
  "summary",
  "citations",
  "url",
  "domain",
  "x_post_ids",
  "meta",
  "request_id",
  "latency_ms",
  "sources_used",
  "billing",
  "amount_usdc",
  "tx_hash",
  "free_trial",
  "confidence",
  "degraded",
  "as_of",
  "freshness",
  "next_queries",
  "markdown",
  "id",
  "created_bucket",
  "intent",
  "x",
  "web",
  "reviews",
  "news",
]);

export function citationDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function walkObjectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(walkObjectKeys);
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [k, ...walkObjectKeys(v)]);
  }
  return [];
}

export function assertAllowlist(body: unknown, allowed: Set<string>): void {
  for (const key of walkObjectKeys(body)) {
    if (!allowed.has(key)) {
      throw new Error(`disallowed key: ${key}`);
    }
  }
}

export function stripRedditPlatform(rec: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec ?? {})) {
    if (k === "reddit") continue;
    out[k] = v;
  }
  return out;
}

export function publicThemes(themes: Array<{ theme: string; count: number }>): Array<{ theme: string; count: number }> {
  return themes
    .filter((t) => isThemeVocab(t.theme))
    .map((t) => ({ theme: t.theme, count: t.count }));
}

export { THEME_VOCAB };

export function publicCitations(cites: Array<{ url: string }>): Array<{ url: string; domain: string }> {
  const seen = new Set<string>();
  const out: Array<{ url: string; domain: string }> = [];
  for (const c of cites) {
    if (!c.url || seen.has(c.url)) continue;
    seen.add(c.url);
    const domain = citationDomain(c.url);
    if (!domain) continue;
    out.push({ url: c.url, domain });
  }
  return out;
}

export function publicShareOfVoice(
  rows: Array<{ brand: string; mentions: number; share: number }> | undefined,
): Array<{ brand: string; mentions: number; share: number }> | undefined {
  if (!rows?.length) return undefined;
  return rows.map((r) => ({ brand: r.brand, mentions: r.mentions, share: r.share }));
}

export function perPostLabelsOn(env: Env): boolean {
  return (env.X_PER_POST_LABELS ?? "").toLowerCase() === "on";
}

export type PublicXMention = {
  id: string;
  url: string;
  created_bucket: string;
  sentiment?: number;
  intent?: ResearchResponse["mentions"][number]["intent"];
};

export function xStatusUrl(id: string): string {
  return `https://x.com/i/web/status/${id}`;
}

export function createdBucket(iso: string, hourly: boolean): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return hourly ? new Date().toISOString().slice(0, 13) + ":00:00.000Z" : new Date().toISOString().slice(0, 10) + "T00:00:00.000Z";
  return hourly ? `${d.toISOString().slice(0, 13)}:00:00.000Z` : `${d.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

export function extractXPostId(url: string, explicit?: string): string | undefined {
  if (explicit && /^\d+$/.test(explicit)) return explicit;
  const m = /\/status\/(\d+)/i.exec(url);
  return m?.[1];
}

export function buildPolishPrompt(opts: {
  query: string;
  volume: number;
  overall: number;
  themes: string[];
  risk: string;
}): string {
  return [
    `query_label=${opts.query}`,
    `volume=${opts.volume}`,
    `sentiment_overall=${opts.overall}`,
    `themes=${opts.themes.join(",") || "none"}`,
    `risk=${opts.risk}`,
  ].join("\n");
}

export function renderAllowedMarkdown(res: Pick<ResearchResponse, "query" | "summary" | "volume" | "sentiment" | "share_of_voice" | "themes" | "citations" | "signals">): string {
  const sov = (res.share_of_voice ?? [])
    .map((r) => `- ${r.brand}: ${(r.share * 100).toFixed(1)}% (${r.mentions})`)
    .join("\n");
  const themes = (res.themes ?? []).slice(0, 5).map((t) => `- ${t.theme} (${t.count})`).join("\n");
  const cites = (res.citations ?? []).slice(0, 8).map((c) => `- ${c.url}`).join("\n");
  const risk = res.signals ? `${res.signals.risk}${res.signals.spike ? ", spike" : ""}` : "n/a";
  return [
    `# ${res.query}`,
    "",
    res.summary ?? "",
    "",
    `Volume: ${res.volume.total}. Sentiment: ${res.sentiment.overall}. Risk: ${risk}.`,
    sov ? `\n## Share of voice\n${sov}` : "",
    themes ? `\n## Themes\n${themes}` : "",
    cites ? `\n## Citations\n${cites}` : "",
  ]
    .filter((block) => block !== "")
    .join("\n")
    .trim();
}
