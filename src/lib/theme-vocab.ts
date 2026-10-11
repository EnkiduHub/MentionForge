import type { Aspect } from "../schemas/research";

/** Aspect enum plus a curated topic list. Themes are never copied as n-grams from source text. */
export const ASPECT_LABELS: readonly Aspect[] = ["pricing", "support", "reliability", "security", "performance"];

export const TOPIC_LABELS = [
  "launch",
  "outage",
  "migration",
  "docs",
  "api",
  "latency",
  "privacy",
  "billing",
  "onboarding",
  "network",
  "serverless",
] as const;

export const THEME_VOCAB: readonly string[] = [...ASPECT_LABELS, ...TOPIC_LABELS];

const VOCAB_SET = new Set(THEME_VOCAB.map((t) => t.toLowerCase()));

export function isThemeVocab(label: string): boolean {
  return VOCAB_SET.has(label.toLowerCase());
}

export function themesFromText(text: string): string[] {
  const hay = text.toLowerCase();
  return THEME_VOCAB.filter((label) => new RegExp(`(?:^|[^a-z0-9])${label}(?:$|[^a-z0-9])`, "i").test(hay));
}
