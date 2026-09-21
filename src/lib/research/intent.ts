import type { Aspect, Intent } from "../../schemas/research";

const ASPECT_RULES: Array<[Aspect, RegExp]> = [
  ["pricing", /\b(price|pricing|cost|expensive|cheap|overpriced|refund|billing|pricey|subscription)\b/i],
  ["support", /\b(support|customer service|helpdesk|csat|ticket|onboarding)\b/i],
  ["reliability", /\b(outage|down|uptime|reliable|crash|broken|downtime|incident)\b/i],
  ["security", /\b(security|breach|hack|cve|privacy|insecure)\b/i],
  ["performance", /\b(slow|fast|latency|lag|perf|throughput)\b/i],
];

export function classifyIntent(text: string, sentiment: number): { intent: Intent; aspects: Aspect[] } {
  const t = text.toLowerCase();
  const aspects = ASPECT_RULES.filter(([, re]) => re.test(t)).map(([a]) => a);
  let intent: Intent = "other";
  if (/\?/.test(text) || /\b(how (do|does|to)|what is|why does)\b/.test(t)) intent = "question";
  else if (/\b(buy|pricing|alternative|switch to|migrate|worth it)\b/.test(t)) intent = "buying";
  else if (/\b(announce|launches|released|breaking|headline)\b/.test(t)) intent = "news";
  else if (sentiment < -0.12 || /\b(hate|worst|scam|complaint|issue|problem|outage)\b/.test(t)) intent = "complaint";
  else if (sentiment > 0.12 || /\b(love|great|best|recommend|awesome)\b/.test(t)) intent = "praise";
  return { intent, aspects };
}

export function relevanceScore(haystack: { text: string; url: string; title?: string }, tokens: string[]): number {
  const normalized = tokens.map((t) => t.toLowerCase()).filter((t) => t.length >= 2);
  if (!normalized.length) return 0.5;
  const hay = `${haystack.text} ${haystack.title ?? ""} ${haystack.url}`.toLowerCase();
  const hits = normalized.filter((t) => hay.includes(t)).length;
  return Number((hits / normalized.length).toFixed(4));
}
