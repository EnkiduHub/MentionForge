import type { Platform } from "../constants";

export type SourceMention = {
  platform: Platform;
  url: string;
  author: string;
  timestamp: string;
  text: string;
  engagement: number;
  title?: string;
};

export type SourceResult = {
  source: string;
  mentions: SourceMention[];
  citations: { url: string; title: string; source: string; accessed_at: string }[];
  degraded?: boolean;
  degradedFlags?: string[];
  error?: string;
};

export type TimeWindow = { from: Date; to: Date; label: string };
