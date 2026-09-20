import type { SourceMention } from "./types";

const PUMP = /\b(100x|to the moon|guaranteed returns|double your|airdrop|secret presale)\b/i;

export function isSpam(m: SourceMention): boolean {
  const t = m.text.trim();
  if (t.length < 8) return true;
  const urls = t.match(/https?:\/\//g)?.length ?? 0;
  if (urls >= 3 && t.replace(/https?:\/\/\S+/g, "").trim().length < 20) return true;
  if (PUMP.test(t)) return true;
  return false;
}

export function fingerprint(m: SourceMention): string {
  const host = safeHost(m.url);
  const norm = m.text.toLowerCase().replace(/\s+/g, " ").slice(0, 180);
  return `${m.platform}|${host}|${norm}`;
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function canonicalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    const host = u.hostname.toLowerCase();
    if (u.protocol === "http:" && (host === "wikidata.org" || host.endsWith(".wikidata.org"))) {
      u.protocol = "https:";
    }
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((k) => u.searchParams.delete(k));
    return u.toString();
  } catch {
    return url;
  }
}

/** Drop off-topic hits (HN “Workers” matching a Show HN about something else). */
export function relevantToQuery(m: { text: string; url: string; title?: string }, tokens: string[]): boolean {
  const normalized = tokens.map((t) => t.toLowerCase()).filter((t) => t.length >= 2);
  const significant = normalized.filter((t) => t.length >= 4);
  const hay = `${m.text} ${m.title ?? ""} ${m.url}`.toLowerCase();
  if (significant.length === 0) {
    return normalized.length === 0 || normalized.some((t) => hay.includes(t));
  }
  if (hay.includes(significant[0]!)) return true;
  return significant.length >= 2 && significant.every((t) => hay.includes(t));
}
