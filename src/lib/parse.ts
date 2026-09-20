import type { Context } from "hono";
import { MAX_BODY_BYTES, SAMPLE_QUERY } from "../lib/constants";
import { parseResearchInput, type ResearchRequest } from "../schemas/research";
import { AgentError } from "../schemas/errors";

export function getRequestId(c: Context): string {
  return c.get("requestId") as string;
}

export async function readResearchRequest(c: Context): Promise<ResearchRequest> {
  const requestId = getRequestId(c);
  if (c.req.method === "GET") {
    const q = c.req.query("query") ?? "";
    const platforms = c.req.query("platforms");
    const from = c.req.query("from");
    const to = c.req.query("to");
    const timeframe = from && to ? { from, to } : c.req.query("timeframe") ?? "7d";
    const limit = c.req.query("limit");
    const include = c.req.query("include_summary");
    const min = c.req.query("min_engagement");
    const language = c.req.query("language");
    try {
      return parseResearchInput({
        query: q,
        platforms: platforms ? platforms.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
        timeframe,
        limit: limit ? Number(limit) : undefined,
        include_summary: include === undefined ? undefined : include === "true",
        min_engagement: min ? Number(min) : undefined,
        language,
      });
    } catch (err) {
      throw zodToAgent(err, requestId);
    }
  }
  const len = Number(c.req.header("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) {
    throw new AgentError("PAYLOAD_TOO_LARGE", "Body exceeds 8KB.", { request_id: requestId });
  }
  let buf: ArrayBuffer;
  try {
    buf = await c.req.raw.arrayBuffer();
  } catch {
    throw new AgentError("VALIDATION_ERROR", "Body must be JSON.", { request_id: requestId });
  }
  if (buf.byteLength > MAX_BODY_BYTES) {
    throw new AgentError("PAYLOAD_TOO_LARGE", "Body exceeds 8KB.", { request_id: requestId });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    throw new AgentError("VALIDATION_ERROR", "Body must be JSON.", { request_id: requestId });
  }
  try {
    return parseResearchInput(raw);
  } catch (err) {
    throw zodToAgent(err, requestId);
  }
}

function zodToAgent(err: unknown, requestId: string): AgentError {
  const issues = (err as { issues?: Array<{ path: unknown; message: string }> }).issues;
  return new AgentError("VALIDATION_ERROR", "Invalid research request.", {
    request_id: requestId,
    details: { issues: issues ?? String(err) },
    hint: `Example: ${JSON.stringify({ query: SAMPLE_QUERY, timeframe: "7d", limit: 20, include_summary: true })}`,
  });
}
