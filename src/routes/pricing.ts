import { Hono } from "hono";
import { DEFAULT_TRIAL_CALLS } from "../lib/constants";
import { paymentConfig, paymentsReady } from "../lib/x402";
import { sendPublic } from "../lib/http-json";

export const pricingRoutes = new Hono<{ Bindings: Env }>();

export function pricingPayload(env: Env, origin: string) {
  const cfg = paymentConfig(env);
  return {
    name: "MentionForge",
    price_usdc: cfg.price,
    amount_atomic: cfg.amount,
    asset: "USDC",
    network: cfg.network,
    pay_to: cfg.payTo,
    asset_address: cfg.asset,
    eip712: cfg.extra,
    free_trial_calls: Number.parseInt(env.FREE_TRIAL_CALLS || String(DEFAULT_TRIAL_CALLS), 10),
    trial: {
      header_wallet: "X-Wallet",
      header_sandbox: "X-Sandbox-Key",
    },
    endpoint: `${origin}/v1/research`,
    mcp: `${origin}/mcp`,
    tool: "research_mentions",
    payments_ready: paymentsReady(env),
    idempotency_header: "Idempotency-Key",
  };
}

pricingRoutes.get("/v1/pricing", (c) => {
  const origin = new URL(c.req.url).origin;
  return sendPublic(c, pricingPayload(c.env, origin), 200, { "Cache-Control": "public, max-age=60" }, {
    title: "Pricing",
    hint: "Settlement details for agents. payTo is here, not on the marketing landing.",
  });
});
