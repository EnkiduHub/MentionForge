import type { ResearchRequest, ResearchResponse } from "../../schemas/research";
import { renderAllowedMarkdown } from "../compliance-output";

/** Overlay after cache. Does not change aggregates when `focus` filters returned mentions. */
export function projectResearch(res: ResearchResponse, req: ResearchRequest): ResearchResponse {
  let mentions = res.mentions;
  if (req.focus) {
    mentions = mentions.filter((m) => m.intent === req.focus);
  }
  let citations = res.citations;
  let themes = (res.themes ?? []).map((t) => ({ theme: t.theme, count: t.count }));
  let summary = res.summary;
  if (req.view === "compact") {
    mentions = mentions.slice(0, 8);
    citations = citations.slice(0, 8);
    if (summary) {
      const parts = summary.split(/(?<=\.)\s+/);
      summary = parts.slice(0, 2).join(" ");
    }
  }
  const x_post_ids = mentions.map((m) => m.id);
  const out: ResearchResponse = { ...res, mentions, citations, themes, summary, x_post_ids };
  if (req.include_markdown) out.markdown = renderAllowedMarkdown(out);
  else delete out.markdown;
  return out;
}
