import { Hono } from "hono";
import { sendPublic } from "../lib/http-json";
import { entityProfile } from "../lib/entity";
import { suggestTool } from "../lib/suggest";
import { AgentError } from "../schemas/errors";
import { entityInputSchema, suggestInputSchema } from "../schemas/lenses";

export const entityRoutes = new Hono<{ Bindings: Env }>();

entityRoutes.get("/v1/entity", async (c) => {
  const requestId = String(c.get("requestId") ?? "");
  let input: { query: string; language?: string };
  try {
    input = entityInputSchema.parse({
      query: c.req.query("query") ?? "",
      language: c.req.query("language") || undefined,
    });
  } catch (err) {
    const issues = (err as { issues?: unknown }).issues;
    throw new AgentError("VALIDATION_ERROR", "Invalid entity query.", {
      request_id: requestId,
      details: { issues: issues ?? String(err) },
      hint: "GET /v1/entity?query=Cloudflare",
    });
  }
  const body = await entityProfile(c.env, input.query, input.language);
  return sendPublic(c, body, 200, { "Cache-Control": "public, max-age=120" }, {
    title: "Entity profile",
    hint: "Free Wikipedia + Wikidata identity card. Not social listening.",
  });
});

entityRoutes.get("/v1/suggest", (c) => {
  const requestId = String(c.get("requestId") ?? "");
  let input: { need: string };
  try {
    input = suggestInputSchema.parse({ need: c.req.query("need") ?? "" });
  } catch (err) {
    const issues = (err as { issues?: unknown }).issues;
    throw new AgentError("VALIDATION_ERROR", "Invalid suggest request.", {
      request_id: requestId,
      details: { issues: issues ?? String(err) },
      hint: "GET /v1/suggest?need=compare%20two%20brands",
    });
  }
  const body = suggestTool(input.need);
  return sendPublic(c, body, 200, { "Cache-Control": "public, max-age=60" }, {
    title: "Suggest tool",
    hint: "Free router. Call exactly one paid tool per question.",
  });
});
