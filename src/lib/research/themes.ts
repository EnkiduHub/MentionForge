import type { SourceMention } from "./types";
import { THEME_VOCAB, themesFromText } from "../theme-vocab";

export function extractThemes(
  mentions: SourceMention[],
  _brandTokens: string[],
): Array<{ theme: string; count: number }> {
  const counts = new Map<string, number>();
  for (const label of THEME_VOCAB) counts.set(label, 0);
  for (const m of mentions) {
    const hay = `${m.text} ${m.title ?? ""}`;
    for (const label of themesFromText(hay)) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([theme, count]) => ({ theme, count }));
}
