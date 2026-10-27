import type { Context } from "hono";
import { Hono } from "hono";
import { AgentError } from "../schemas/errors";
import {
  claimKey,
  createBillingPortalSession,
  handleStripeEvent,
  previewKeyClaim,
  verifyStripeSignature,
} from "../lib/stripe";
import { requireRegisteredApiKey } from "../lib/api-key";
import { planKeyMonthlyCalls, readPlanUsage } from "../lib/plan-quota";
import { limitOrThrow } from "../lib/rate-limit";
import { wantsHtmlDocument } from "../lib/http-json";
import { claimPageHtml } from "../lib/html";
import { htmlSecurityHeaders } from "../lib/security-headers";

export const stripeRoutes = new Hono<{ Bindings: Env }>();

const CLAIM_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
};

function respondClaimError(c: Context<{ Bindings: Env }>, err: AgentError): Response {
  const status = err.status() as 400 | 401 | 402 | 404 | 410 | 429 | 500 | 503;
  if (wantsHtmlDocument(c)) {
    return c.html(
      claimPageHtml({
        mode: "error",
        code: err.code,
        message: err.message,
        hint: err.hint,
      }),
      status,
      {
        ...htmlSecurityHeaders(),
        ...CLAIM_HEADERS,
        "X-Request-Id": err.request_id,
        Vary: "Accept, Sec-Fetch-Dest",
      },
    );
  }
  return c.json(err.body(), status, {
    ...CLAIM_HEADERS,
    "X-Request-Id": err.request_id,
    Vary: "Accept, Sec-Fetch-Dest",
  });
}

async function readPostedSessionId(c: Context<{ Bindings: Env }>): Promise<string> {
  const fromQuery = (c.req.query("session_id") ?? "").trim();
  if (fromQuery) return fromQuery;

  const contentType = (c.req.header("content-type") ?? "").toLowerCase();
  if (contentType.includes("application/json")) {
    try {
      const json = (await c.req.json()) as { session_id?: unknown };
      if (typeof json?.session_id === "string") return json.session_id.trim();
    } catch {
      return "";
    }
  }
  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    try {
      const form = await c.req.parseBody();
      const val = form.session_id;
      if (typeof val === "string") return val.trim();
    } catch {
      return "";
    }
  }
  try {
    const raw = (await c.req.text()).trim();
    if (!raw) return "";
    if (raw.startsWith("{")) {
      const parsed = JSON.parse(raw) as { session_id?: unknown };
      if (typeof parsed?.session_id === "string") return parsed.session_id.trim();
    }
    const params = new URLSearchParams(raw);
    return (params.get("session_id") ?? "").trim();
  } catch {
    return "";
  }
}

stripeRoutes.post("/v1/stripe/webhook", async (c) => {
  const requestId = String(c.get("requestId") ?? "unknown");
  const secret = c.env.STRIPE_WEBHOOK_SECRET ?? "";
  const payload = await c.req.text();
  const ok = await verifyStripeSignature(payload, c.req.header("Stripe-Signature") ?? null, secret);
  if (!ok) {
    throw new AgentError("VALIDATION_ERROR", "Invalid Stripe-Signature.", { request_id: requestId });
  }
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    throw new AgentError("VALIDATION_ERROR", "Webhook body must be JSON.", { request_id: requestId });
  }
  await handleStripeEvent(c.env, event, requestId);
  return c.json({ received: true }, 200);
});

stripeRoutes.get("/v1/keys/claim", async (c) => {
  const requestId = String(c.get("requestId") ?? "unknown");
  const sessionId = (c.req.query("session_id") ?? "").trim();
  try {
    const preview = await previewKeyClaim(c.env, sessionId, requestId);
    if (wantsHtmlDocument(c)) {
      return c.html(
        claimPageHtml({ mode: "ready", sessionId: preview.session_id }),
        200,
        {
          ...htmlSecurityHeaders(),
          ...CLAIM_HEADERS,
          Vary: "Accept, Sec-Fetch-Dest",
        },
      );
    }
    return c.json(
      {
        plan: preview.plan,
        session_id: preview.session_id,
        claimed: false,
        prefix: "mfk_",
        hint: "POST /v1/keys/claim with session_id to reveal your API key once.",
      },
      200,
      {
        ...CLAIM_HEADERS,
        Vary: "Accept, Sec-Fetch-Dest",
      },
    );
  } catch (err) {
    if (err instanceof AgentError) {
      return respondClaimError(c, err);
    }
    throw err;
  }
});

stripeRoutes.post("/v1/keys/claim", async (c) => {
  const requestId = String(c.get("requestId") ?? "unknown");
  const sessionId = await readPostedSessionId(c);
  try {
    const claimed = await claimKey(c.env, sessionId, requestId);
    if (wantsHtmlDocument(c)) {
      return c.html(
        claimPageHtml({ mode: "revealed", key: claimed.key }),
        200,
        {
          ...htmlSecurityHeaders(),
          ...CLAIM_HEADERS,
          Vary: "Accept, Sec-Fetch-Dest",
        },
      );
    }
    return c.json(
      { plan: claimed.plan, key: claimed.key, prefix: "mfk_" },
      200,
      {
        ...CLAIM_HEADERS,
        Vary: "Accept, Sec-Fetch-Dest",
      },
    );
  } catch (err) {
    if (err instanceof AgentError) {
      return respondClaimError(c, err);
    }
    throw err;
  }
});

stripeRoutes.get("/v1/keys/me", async (c) => {
  const requestId = String(c.get("requestId") ?? "unknown");
  const key = await requireRegisteredApiKey(c.env, c.req.raw, requestId);
  await limitOrThrow(c.env.PAID_LIMIT, key.key_hash, requestId);
  let used: number;
  try {
    used = await readPlanUsage(c.env, key.key_hash, key.period_start);
  } catch (err) {
    if (err instanceof AgentError) throw err;
    throw new AgentError("QUOTA_UNAVAILABLE", "Usage ledger unavailable. Request denied; nothing was charged.", {
      request_id: requestId,
      details: { reason: "plan_usage_read_failed" },
    });
  }
  const limit = planKeyMonthlyCalls(c.env);
  const remaining = Math.max(0, limit - used);
  return c.json(
    {
      plan: "key" as const,
      status: key.status,
      period_start: Number(key.period_start),
      period_end: Number(key.period_end),
      calls_used: used,
      calls_limit: limit,
      calls_remaining: remaining,
      manage_url: "/v1/keys/portal",
    },
    200,
    CLAIM_HEADERS,
  );
});

stripeRoutes.post("/v1/keys/portal", async (c) => {
  const requestId = String(c.get("requestId") ?? "unknown");
  const key = await requireRegisteredApiKey(c.env, c.req.raw, requestId);
  await limitOrThrow(c.env.PAID_LIMIT, key.key_hash, requestId);
  const session = await createBillingPortalSession(c.env, key.stripe_customer_id, requestId);
  return c.json({ url: session.url }, 200, CLAIM_HEADERS);
});
