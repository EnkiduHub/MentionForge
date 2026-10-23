import { Hono } from "hono";
import { AgentError } from "../schemas/errors";
import { claimKey, handleStripeEvent, verifyStripeSignature } from "../lib/stripe";

export const stripeRoutes = new Hono<{ Bindings: Env }>();

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
  const sessionId = c.req.query("session_id") ?? "";
  const claimed = await claimKey(c.env, sessionId, requestId);
  return c.json({ plan: claimed.plan, key: claimed.key, prefix: "mfk_" }, 200, { "Cache-Control": "no-store" });
});
