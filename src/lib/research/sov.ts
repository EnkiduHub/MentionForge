export type ShareOfVoiceRow = {
  brand: string;
  mentions: number;
  engagement: number;
  share: number;
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-token match. Longest brand first so "AI" does not steal "OpenAI". */
export function brandHits(hay: string, brand: string): boolean {
  const tokens = brand
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  if (!tokens.length) return false;
  return tokens.every((t) => new RegExp(`(?:^|[^a-z0-9])${escapeRe(t)}(?:$|[^a-z0-9])`, "i").test(hay));
}

/** Vs/multi-brand fusion must keep competitor-only hits, not only brand A. */
export function relevantToBrands(
  m: { text: string; url: string; title?: string },
  brands: string[],
): boolean {
  if (!brands.length) return false;
  const hay = `${m.text} ${m.title ?? ""} ${m.url}`;
  return brands.some((b) => brandHits(hay, b));
}

export function shareOfVoice(
  mentions: Array<{ text: string; title?: string; url: string; engagement: number }>,
  brands: string[],
): ShareOfVoiceRow[] {
  if (!brands.length) return [];
  const sorted = [...brands].sort((a, b) => b.length - a.length);
  const buckets = new Map(brands.map((b) => [b, { mentions: 0, engagement: 0 }]));
  let other = { mentions: 0, engagement: 0 };
  for (const m of mentions) {
    const hay = `${m.text} ${m.title ?? ""} ${m.url}`.toLowerCase();
    let hit: string | undefined;
    for (const b of sorted) {
      if (brandHits(hay, b)) {
        hit = b;
        break;
      }
    }
    if (hit) {
      const cur = buckets.get(hit)!;
      cur.mentions += 1;
      cur.engagement += m.engagement;
    } else {
      other.mentions += 1;
      other.engagement += m.engagement;
    }
  }
  const total = mentions.length || 1;
  const rows: ShareOfVoiceRow[] = brands.map((b) => {
    const cur = buckets.get(b)!;
    return {
      brand: b,
      mentions: cur.mentions,
      engagement: cur.engagement,
      share: Number((cur.mentions / total).toFixed(4)),
    };
  });
  if (other.mentions) {
    rows.push({
      brand: "other",
      mentions: other.mentions,
      engagement: other.engagement,
      share: Number((other.mentions / total).toFixed(4)),
    });
  }
  return rows;
}
