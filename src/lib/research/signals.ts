import type { Mention, ResearchResponse } from "../../schemas/research";
import type { Platform } from "../constants";

const PLACEHOLDER_AUTHOR = /^(wikipedia|wikidata|news|web|official|gdelt|hn|reddit|x|unknown)$/i;

export function detectSignals(
  volume: ResearchResponse["volume"],
  sentiment: ResearchResponse["sentiment"],
): ResearchResponse["signals"] {
  if (volume.total === 0) {
    return { risk: "low", spike: false, reasons: ["no mentions in window"] };
  }
  const trend = volume.trend ?? [];
  let spike = false;
  if (trend.length >= 2) {
    const last = trend[trend.length - 1]!.count;
    const earlier = trend.slice(0, -1);
    const mean = earlier.reduce((s, b) => s + b.count, 0) / earlier.length;
    spike = mean > 0 && last >= mean * 2 && last >= 3;
  }
  const negShare = sentiment.negative;
  const reasons: string[] = [];
  if (spike) reasons.push("latest volume bucket is elevated vs earlier mean");
  if (negShare >= 40) reasons.push("negative mentions are concentrated");
  let risk: "low" | "elevated" | "high" = "low";
  if (spike && negShare >= 40) risk = "high";
  else if (spike || negShare >= 25) risk = "elevated";
  if (!reasons.length) reasons.push("no spike or negative concentration");
  return { risk, spike, reasons };
}

export function sentimentByPlatform(
  scored: Array<{ platform: Platform; score: number }>,
): Record<string, number> {
  const acc: Record<string, { sum: number; n: number }> = {};
  for (const row of scored) {
    const cur = acc[row.platform] ?? { sum: 0, n: 0 };
    cur.sum += row.score;
    cur.n += 1;
    acc[row.platform] = cur;
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(acc)) {
    out[k] = Number((v.sum / (v.n || 1)).toFixed(4));
  }
  return out;
}

export function topVoices(mentions: Mention[]): ResearchResponse["voices"] {
  const map = new Map<string, { author: string; platform: Mention["platform"]; mentions: number; engagement: number }>();
  for (const m of mentions) {
    const author = (m.author || "").trim();
    if (!author || PLACEHOLDER_AUTHOR.test(author)) continue;
    const key = `${m.platform}|${author.toLowerCase()}`;
    const cur = map.get(key) ?? { author, platform: m.platform, mentions: 0, engagement: 0 };
    cur.mentions += 1;
    cur.engagement += m.engagement;
    map.set(key, cur);
  }
  return [...map.values()]
    .sort((a, b) => b.engagement - a.engagement || b.mentions - a.mentions)
    .slice(0, 8);
}
