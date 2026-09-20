import type { ResearchRequest } from "../../schemas/research";
import type { SourceMention } from "./types";

export function executiveSummary(opts: {
  req: ResearchRequest;
  mentions: SourceMention[];
  overall: number;
  volume: number;
  themes: Array<{ theme: string }>;
}): string {
  const tone = opts.overall > 0.15 ? "net positive" : opts.overall < -0.15 ? "net negative" : "mixed-to-neutral";
  const themeList = opts.themes.slice(0, 3).map((t) => t.theme).join(", ") || "no dominant theme";
  const risk =
    opts.overall < -0.1
      ? "Negative mentions outweigh praise — inspect complaints before a launch or buy."
      : "Coverage is mixed across sources; weight cited URLs over any single platform.";
  const opp =
    opts.overall > 0.1
      ? "The strongest positive themes are the best outbound copy."
      : "High-engagement threads are the fastest sentiment lever.";
  return [
    `${opts.req.query}: ${opts.volume} fused mentions in the selected window, sentiment ${tone} (${opts.overall.toFixed(2)}).`,
    `Themes: ${themeList}.`,
    risk,
    opp,
  ].join(" ");
}
