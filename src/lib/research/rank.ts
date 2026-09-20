import type { Platform } from "../constants";
import type { SourceMention } from "./types";
import type { TimeWindow } from "./types";

const QUALITY: Record<Platform, number> = {
  news: 1.2,
  web: 1.15,
  reviews: 1.1,
  reddit: 1,
  x: 0.85,
};

export function recencyDecay(ts: string, win: TimeWindow): number {
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return 0.5;
  const span = Math.max(1, win.to.getTime() - win.from.getTime());
  const age = win.to.getTime() - t;
  return Math.max(0.15, 1 - age / span);
}

export function rankScore(m: SourceMention, win: TimeWindow): number {
  return recencyDecay(m.timestamp, win) * Math.log1p(Math.max(0, m.engagement)) * (QUALITY[m.platform] ?? 1);
}

export function sortMentions(mentions: SourceMention[], win: TimeWindow): SourceMention[] {
  return [...mentions].sort((a, b) => rankScore(b, win) - rankScore(a, win));
}
