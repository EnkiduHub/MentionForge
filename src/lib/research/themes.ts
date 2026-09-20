import type { SourceMention } from "./types";
import { tokenize } from "./sentiment";

const STOP = new Set(
  "the a an and or of to in on for with from by is it this that are was be as at we you they i if but not no yes just so about into over after before than then also more most can will your our their inc ltd llc https http www html href com org net".split(
    " ",
  ),
);

export function extractThemes(
  mentions: SourceMention[],
  brandTokens: string[],
): Array<{ theme: string; count: number; examples: string[] }> {
  const skip = new Set(brandTokens.map((t) => t.toLowerCase()));
  const counts = new Map<string, { n: number; examples: string[] }>();
  for (const m of mentions) {
    const toks = tokenize(m.text).filter((t) => t.length > 2 && !STOP.has(t) && !skip.has(t));
    const grams: string[] = [];
    for (let i = 0; i < toks.length; i++) {
      grams.push(toks[i]!);
      if (i + 1 < toks.length) grams.push(`${toks[i]} ${toks[i + 1]}`);
    }
    const seen = new Set<string>();
    for (const g of grams) {
      if (seen.has(g)) continue;
      seen.add(g);
      const cur = counts.get(g) ?? { n: 0, examples: [] };
      cur.n++;
      if (cur.examples.length < 2) cur.examples.push(m.text.slice(0, 140));
      counts.set(g, cur);
    }
  }
  return [...counts.entries()]
    .filter(([, v]) => v.n >= 2)
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 8)
    .map(([theme, v]) => ({ theme, count: v.n, examples: v.examples }));
}
