import type { Context } from "hono";
import { Hono } from "hono";
import { paymentRequiredHttp, runResearchPipeline } from "../lib/research-handler";
import { bazaarSurfaceForPath } from "../lib/x402";
import { AgentError } from "../schemas/errors";

export const researchRoutes = new Hono<{ Bindings: Env }>();

async function wrap(c: Context<{ Bindings: Env }>) {
  const id = c.get("requestId") as string;
  const url = new URL(c.req.url);
  try {
    return await runResearchPipeline(c.env, c.executionCtx, c.req.raw, id);
  } catch (err) {
    if (err instanceof AgentError && err.code === "PAYMENT_REQUIRED") {
      return paymentRequiredHttp(c.env, url.origin, err, bazaarSurfaceForPath(url.pathname));
    }
    throw err;
  }
}

researchRoutes.post("/v1/research", (c) => wrap(c));
researchRoutes.get("/v1/research", (c) => wrap(c));
researchRoutes.on("PUT", "/v1/research", (c) => methodErr(c));
researchRoutes.on("PATCH", "/v1/research", (c) => methodErr(c));
researchRoutes.on("DELETE", "/v1/research", (c) => methodErr(c));

researchRoutes.post("/v1/research_mentions", (c) => wrap(c));
researchRoutes.get("/v1/research_mentions", (c) => wrap(c));
researchRoutes.on("PUT", "/v1/research_mentions", (c) => methodErr(c));
researchRoutes.on("PATCH", "/v1/research_mentions", (c) => methodErr(c));
researchRoutes.on("DELETE", "/v1/research_mentions", (c) => methodErr(c));

function methodErr(c: Context<{ Bindings: Env }>): never {
  const path = new URL(c.req.url).pathname;
  throw new AgentError("VALIDATION_ERROR", "Use GET or POST.", {
    request_id: String(c.get("requestId") ?? ""),
    hint: `POST ${path} with JSON body.`,
  });
}
