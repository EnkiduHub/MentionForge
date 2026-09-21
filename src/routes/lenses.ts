import type { Context } from "hono";
import { Hono } from "hono";
import { paymentRequiredHttp, runLensPipeline } from "../lib/research-handler";
import { AgentError } from "../schemas/errors";
import { mapCompare, mapDigest, mapReply, mapRisk, projectReplyWithOptionalLlama } from "../lib/lenses";

export const lensRoutes = new Hono<{ Bindings: Env }>();

async function wrap(
  c: Context<{ Bindings: Env }>,
  parse: Parameters<typeof runLensPipeline>[4]["parse"],
) {
  const id = c.get("requestId") as string;
  try {
    return await runLensPipeline(c.env, c.executionCtx, c.req.raw, id, { parse });
  } catch (err) {
    if (err instanceof AgentError && err.code === "PAYMENT_REQUIRED") {
      return paymentRequiredHttp(c.env, new URL(c.req.url).origin, err);
    }
    throw err;
  }
}

function postOnly(c: Context<{ Bindings: Env }>): never {
  throw new AgentError("VALIDATION_ERROR", "Use POST.", {
    request_id: String(c.get("requestId") ?? ""),
    hint: "POST this path with a JSON body. GET is not supported for paid lenses.",
  });
}

lensRoutes.post("/v1/compare", (c) => wrap(c, mapCompare));
lensRoutes.get("/v1/compare", (c) => postOnly(c));

lensRoutes.post("/v1/digest", (c) => wrap(c, mapDigest));
lensRoutes.get("/v1/digest", (c) => postOnly(c));

lensRoutes.post("/v1/risk", (c) => wrap(c, mapRisk));
lensRoutes.get("/v1/risk", (c) => postOnly(c));

lensRoutes.post("/v1/reply", (c) =>
  wrap(c, (raw) => {
    const mapped = mapReply(raw);
    return {
      ...mapped,
      project: (full) => projectReplyWithOptionalLlama(c.env, full, mapped.input),
    };
  }),
);
lensRoutes.get("/v1/reply", (c) => postOnly(c));
