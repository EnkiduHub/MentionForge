import type { ResearchRequest, ResearchResponse } from "../../schemas/research";

function renderMarkdown(res: ResearchResponse): string {
  const sov = (res.share_of_voice ?? [])
    .map((r) => `- ${r.brand}: ${(r.share * 100).toFixed(1)}% (${r.mentions})`)
    .join("\n");
  const themes = (res.themes ?? []).slice(0, 5).map((t) => `- ${t.theme} (${t.count})`).join("\n");
  const cites = (res.citations ?? []).slice(0, 8).map((c) => `- ${c.title}: ${c.url}`).join("\n");
  const risk = res.signals ? `${res.signals.risk}${res.signals.spike ? ", spike" : ""}` : "n/a";
  return [
    `# ${res.query}`,
    "",
    res.summary ?? "",
    "",
    `Volume: ${res.volume.total}. Sentiment: ${res.sentiment.overall}. Risk: ${risk}.`,
    sov ? `\n## Share of voice\n${sov}` : "",
    themes ? `\n## Themes\n${themes}` : "",
    cites ? `\n## Citations\n${cites}` : "",
  ]
    .filter((block) => block !== "")
    .join("\n")
    .trim();
}

/** Overlay after cache. Does not change aggregates when `focus` filters returned mentions. */
export function projectResearch(res: ResearchResponse, req: ResearchRequest): ResearchResponse {
  let mentions = res.mentions;
  if (req.focus) {
    mentions = mentions.filter((m) => m.intent === req.focus);
  }
  let citations = res.citations;
  let themes = res.themes;
  let summary = res.summary;
  if (req.view === "compact") {
    mentions = mentions.slice(0, 8);
    citations = citations.slice(0, 8);
    themes = themes.map((t) => ({ ...t, examples: [] }));
    if (summary) {
      const parts = summary.split(/(?<=\.)\s+/);
      summary = parts.slice(0, 2).join(" ");
    }
  }
  const out: ResearchResponse = { ...res, mentions, citations, themes, summary };
  if (req.include_markdown) out.markdown = renderMarkdown(out);
  else delete out.markdown;
  return out;
}
