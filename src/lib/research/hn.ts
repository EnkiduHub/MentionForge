/** Hacker News paid rows: URLs and counts only. Titles, text, and authors never leave the worker. */

export function hnItemUrl(objectId: string): string {
  return `https://news.ycombinator.com/item?id=${objectId}`;
}

/** Daily UTC bucket (same grain as X `created_bucket` keep-fields). */
export function hnCreatedBucket(timestamp: string): string {
  const t = Date.parse(timestamp);
  const d = Number.isFinite(t) ? new Date(t) : new Date();
  return `${d.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

/** Citation label is the registrable host, never the story headline. */
export function hnCitationLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return host || "news.ycombinator.com";
  } catch {
    return "news.ycombinator.com";
  }
}

export function isHnPublicRow(m: {
  platform?: string;
  created_bucket?: string;
  text?: string;
  author?: string;
}): boolean {
  return m.platform === "news" && typeof m.created_bucket === "string" && m.text == null && m.author == null;
}
