import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { corsMiddleware } from "./lib/cors";
import { apiSecurityHeaders, htmlSecurityHeaders, WWW_AUTHENTICATE } from "./lib/security-headers";
import { AgentError } from "./schemas/errors";
import { researchRoutes } from "./routes/research";
import { lensRoutes } from "./routes/lenses";
import { entityRoutes } from "./routes/entity";
import { discoveryRoutes } from "./routes/discovery";
import { exampleRoutes } from "./routes/example";
import { pricingRoutes } from "./routes/pricing";
import { operatorRoutes } from "./routes/operator";
import { bumpStats } from "./lib/analytics";
import { limitOrThrow } from "./lib/rate-limit";
import { logRequest } from "./lib/logger";
import { wantsHtmlDocument } from "./lib/http-json";
import { discoveryDocumentHtml } from "./lib/html";

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.use("*", async (c, next) => {
    const id = c.req.header("X-Request-Id") || crypto.randomUUID();
    c.set("requestId", id);
    c.header("X-Request-Id", id);
    for (const [k, v] of Object.entries(apiSecurityHeaders())) c.header(k, v);
    await next();
  });

  app.use("*", (c, next) => corsMiddleware(c.env.ALLOWED_ORIGINS)(c, next));

  app.use("*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    const discovery =
      path === "/health" ||
      path.startsWith("/.well-known") ||
      path === "/openapi.json" ||
      path.startsWith("/llms") ||
      path === "/robots.txt" ||
      path === "/stats" ||
      path === "/skill.md" ||
      path === "/server-card.json" ||
      path === "/v1/pricing" ||
      path === "/v1/research/example" ||
      path === "/v1/entity" ||
      path === "/v1/suggest";
    const id = c.get("requestId") as string;
    if (discovery) await limitOrThrow(c.env.DISCOVERY_LIMIT, c.req.header("cf-connecting-ip") ?? "disc", id, 10);
    await next();
  });

  app.route("/", discoveryRoutes);
  app.route("/", exampleRoutes);
  app.route("/", pricingRoutes);
  app.route("/", operatorRoutes);
  app.route("/", entityRoutes);
  app.route("/", lensRoutes);
  app.route("/", researchRoutes);

  app.notFound((c) => {
    const body = {
      error: {
        code: "VALIDATION_ERROR",
        message: "Not found",
        recoverable: true,
        hint: "See GET /llms.txt and GET /openapi.json",
        details: {},
      },
      request_id: c.get("requestId"),
    };
    if (wantsHtmlDocument(c)) {
      const path = new URL(c.req.url).pathname;
      return c.html(
        discoveryDocumentHtml({
          title: "Not found",
          hint: "That path is not a MentionForge surface. Use the header or GET /llms.txt.",
          path,
          body: JSON.stringify(body, null, 2),
        }),
        404,
        {
          ...htmlSecurityHeaders(),
          "Cache-Control": "private, no-store",
          Vary: "Accept, Sec-Fetch-Dest",
        },
      );
    }
    return c.json(body, 404);
  });

  app.onError((err, c) => {
    const id = (c.get("requestId") as string) || "unknown";
    if (err instanceof AgentError) {
      // Completions are counted only in persistResearch. Client rejections must not bump `calls`.
      if (err.code === "INTERNAL_ERROR" || err.code === "SOURCE_UNAVAILABLE") {
        void bumpStats(c.env, c.executionCtx, {
          paid: false,
          trial: false,
          error: true,
          usdcMicros: 0,
        });
      }
      const headers: Record<string, string> = { "X-Request-Id": err.request_id };
      if (err.code === "RATE_LIMITED") headers["Retry-After"] = String(err.details.retry_after ?? 60);
      if (err.code === "UNAUTHORIZED") {
        headers["Cache-Control"] = "no-store";
        headers["WWW-Authenticate"] = WWW_AUTHENTICATE;
      }
      logRequest({ msg: "agent_error", code: err.code, request_id: err.request_id });
      const res = c.json(err.body(), err.status() as 400, headers);
      return res;
    }
    if (err instanceof HTTPException) {
      return err.getResponse();
    }
    logRequest({ msg: "internal", err: String(err), request_id: id });
    void bumpStats(c.env, c.executionCtx, { paid: false, trial: false, error: true, usdcMicros: 0 });
    return c.json(
      new AgentError("INTERNAL_ERROR", "Internal error.", { request_id: id }).body(),
      500,
    );
  });

  return app;
}
