import { Hono } from "hono";
import { DEFAULT_TRIAL_CALLS } from "../lib/constants";
import { paymentConfig, paymentsReady } from "../lib/x402";
import { sendPublic } from "../lib/http-json";

export const pricingRoutes = new Hono<{ Bindings: Env }>();

export function pricingPayload(env: Env, origin: string, opts?: { includeCatalog?: boolean }) {
  const cfg = paymentConfig(env);
  const includeCatalog = opts?.includeCatalog !== false;
  const payload = {
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
    tools: [
      { name: "get_health", kind: "free" as const },
      { name: "get_pricing", kind: "free" as const },
      { name: "get_example", kind: "free" as const },
      { name: "suggest_tool", kind: "free" as const },
      { name: "get_entity_profile", kind: "free" as const },
      { name: "research_mentions", kind: "paid" as const, price_usdc: cfg.price },
      { name: "compare_brands", kind: "paid" as const, price_usdc: cfg.price },
      { name: "get_digest", kind: "paid" as const, price_usdc: cfg.price },
      { name: "detect_risk", kind: "paid" as const, price_usdc: cfg.price },
      { name: "draft_reply", kind: "paid" as const, price_usdc: cfg.price },
      { name: "list_mentions", kind: "paid" as const, price_usdc: cfg.price },
      { name: "get_trends", kind: "paid" as const, price_usdc: cfg.price },
    ],
    endpoints: [
      { method: "GET", path: "/v1/pricing", kind: "free" as const },
      { method: "GET", path: "/v1/research/example", kind: "free" as const },
      { method: "GET", path: "/v1/entity", kind: "free" as const },
      { method: "GET", path: "/v1/suggest", kind: "free" as const },
      { method: "POST", path: "/v1/research", kind: "paid" as const },
      { method: "POST", path: "/v1/compare", kind: "paid" as const },
      { method: "POST", path: "/v1/digest", kind: "paid" as const },
      { method: "POST", path: "/v1/risk", kind: "paid" as const },
      { method: "POST", path: "/v1/reply", kind: "paid" as const },
      { method: "POST", path: "/v1/mentions", kind: "paid" as const },
      { method: "POST", path: "/v1/trends", kind: "paid" as const },
    ],
    payments_ready: paymentsReady(env),
    idempotency_header: "Idempotency-Key",
  };
  if (includeCatalog) return payload;
  const { tools: _tools, endpoints: _endpoints, ...settlement } = payload;
  return settlement;
}

pricingRoutes.get("/v1/pricing", (c) => {
  const origin = new URL(c.req.url).origin;
  return sendPublic(c, pricingPayload(c.env, origin), 200, { "Cache-Control": "public, max-age=60" }, {
    title: "Pricing",
    hint: "Settlement details for agents. payTo is here, not on the marketing landing.",
  });
});
