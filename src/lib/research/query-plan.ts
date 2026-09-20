import type { ResearchRequest, Timeframe } from "../../schemas/research";
import type { TimeWindow } from "./types";

export function windowFor(tf: Timeframe): TimeWindow {
  const now = Date.now();
  if (typeof tf === "object") {
    return { from: new Date(tf.from), to: new Date(tf.to), label: `${tf.from}/${tf.to}` };
  }
  const ms =
    tf === "24h" ? 86400000 : tf === "7d" ? 7 * 86400000 : tf === "30d" ? 30 * 86400000 : 90 * 86400000;
  // Encyclopedia / Brave stamps are Date.now() after gather starts. Without slack they fall after `to` and vanish.
  const slackMs = 120_000;
  return { from: new Date(now - ms), to: new Date(now + slackMs), label: tf };
}

/** Clamp "now" into the research window so in-flight encyclopedia mentions survive fusion. */
export function stampInWindow(win: TimeWindow): string {
  const now = Date.now();
  if (now < win.from.getTime()) return win.from.toISOString();
  if (now > win.to.getTime()) return win.to.toISOString();
  return new Date(now).toISOString();
}

export function gdeltTimespan(tf: Timeframe): string {
  if (typeof tf === "object") return "3m";
  if (tf === "24h") return "24h";
  if (tf === "7d") return "7d";
  if (tf === "30d") return "1m";
  return "3m";
}

export type QueryPlan = {
  original: string;
  quoted: string;
  unquoted: string;
  brand: string;
  vs?: { a: string; b: string };
  reddit: string;
  news: string;
  web: string;
  reviews: string;
  x: string;
};

export function planQuery(req: ResearchRequest): QueryPlan {
  const original = req.query.trim();
  const vsMatch = original.split(/\s+vs\.?\s+/i);
  const vs = vsMatch.length === 2 ? { a: vsMatch[0]!.trim(), b: vsMatch[1]!.trim() } : undefined;
  const brand = vs?.a ?? original.split(/\s+/).slice(0, 4).join(" ");
  const quoted = `"${brand.replace(/"/g, "")}"`;
  const unquoted = brand;
  return {
    original,
    quoted,
    unquoted,
    brand,
    vs,
    reddit: vs ? `${quoted} OR "${vs.b}"` : quoted,
    news: unquoted,
    web: unquoted,
    reviews: `${quoted} (review OR reviews OR "customer service")`,
    x: unquoted,
  };
}

export function cacheKeyMaterial(req: ResearchRequest): string {
  const q = req.query.normalize("NFC").trim().toLowerCase();
  const platforms = [...req.platforms].sort().join(",");
  const tf = typeof req.timeframe === "string" ? req.timeframe : `${req.timeframe.from}|${req.timeframe.to}`;
  return JSON.stringify({
    q,
    platforms,
    tf,
    limit: req.limit,
    lang: req.language ?? "",
    min: req.min_engagement ?? 0,
    sum: req.include_summary,
  });
}
