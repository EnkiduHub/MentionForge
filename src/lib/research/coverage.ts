import { PLATFORMS, type Platform } from "../constants";
import { AgentError } from "../../schemas/errors";

export const SOURCES_DISABLED_DESC =
  "Requested platform ids that were turned off and not searched. A zero in volume.by_platform for one of these ids is not an empty window.";

export const COVERAGE_NOTE_DESC =
  "Plain-language note when a requested platform was turned off and not searched. A zero count for that platform is not an empty window.";

function listPhrase(ids: readonly string[]): { phrase: string; plural: boolean } {
  if (ids.length === 1) return { phrase: ids[0]!, plural: false };
  if (ids.length === 2) return { phrase: `${ids[0]} and ${ids[1]}`, plural: true };
  return { phrase: `${ids.slice(0, -1).join(", ")}, and ${ids[ids.length - 1]}`, plural: true };
}

/** Sentence an agent can quote when a requested platform was skipped. */
export function coverageNote(disabled: readonly string[] | undefined): string | undefined {
  if (!disabled?.length) return undefined;
  const { phrase, plural } = listPhrase(disabled);
  const be = plural ? "were" : "was";
  const them = plural ? "them" : "it";
  const those = plural ? "those sources are" : "that source is";
  return `${phrase} ${be} not searched because ${those} turned off. A zero count for ${them} is not an empty window.`;
}

type CoverageCarrier = {
  summary?: string;
  meta: {
    sources_disabled?: string[];
    coverage_note?: string;
  };
};

/**
 * Attach `meta.coverage_note` and, when a summary exists, append the same sentence.
 * Safe to call twice: the sentence is not repeated.
 */
export function applyCoverage<T extends CoverageCarrier>(
  body: T,
): Omit<T, "meta" | "summary"> & { summary?: string; meta: T["meta"] & { coverage_note?: string } } {
  const note = coverageNote(body.meta.sources_disabled);
  if (!note) {
    if (!body.meta.coverage_note) return body;
    const meta = { ...body.meta };
    delete meta.coverage_note;
    return { ...body, meta };
  }
  const summary = body.summary && !body.summary.includes(note) ? `${body.summary} ${note}` : body.summary;
  return {
    ...body,
    summary,
    meta: { ...body.meta, coverage_note: note },
  };
}

/**
 * Tool error for a request whose every platform is turned off.
 * The hint names the `platforms` values to send next so the model can retry
 * with adjusted parameters (MCP tool execution errors). Nothing is charged:
 * this throws before trial consumption and before settlement.
 */
export function disabledSourcesError(disabled: readonly Platform[], requestId: string): AgentError {
  const skipped = [...disabled].sort();
  const retry = PLATFORMS.filter((id) => !skipped.includes(id));
  const note = coverageNote(skipped) ?? "Requested sources are turned off.";
  const hint = retry.length
    ? `${note} Retry this question with platforms set to ${retry.join(", ")}. Do not retry the same platforms. Nothing was charged.`
    : `${note} Every requested platform is turned off. Nothing was charged. Check get_health source_backends before calling again.`;
  return new AgentError("SOURCE_UNAVAILABLE", `Requested sources are turned off: ${skipped.join(", ")}.`, {
    request_id: requestId,
    hint,
    details: {
      reason: "sources_disabled",
      sources_disabled: skipped,
      retry_platforms: retry,
    },
  });
}
