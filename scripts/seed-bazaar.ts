/// <reference types="node" />
/**
 * Bazaar seed: unpaid MCP research_mentions (402) then one paid tools/call.
 *
 * Default is dry-run (no USDC). Spends $0.02 only when PAY_ONCE=1 and
 * TEST_PAYER_PRIVATE_KEY is 0x + 64 hex in the environment / .dev.vars.
 *
 * MCP x402 expects `_meta["x402/payment"]` to be the payload object, not REST base64.
 */
import {
  assertAcceptsMainnet,
  assertPayerDiffersFromPayTo,
  assertProductionReady,
  describePayerKey,
  encodePaymentHeader,
  payerClient,
  readPayerPrivateKey,
  serviceOrigin,
  wantPayOnce,
} from "./payer.js";

const origin = serviceOrigin();
const ARGS = { query: "Cloudflare Workers", timeframe: "7d", limit: 5, include_summary: false };

type Json = Record<string, unknown>;

function parseMcpBody(text: string, contentType: string): unknown {
  if (contentType.includes("text/event-stream")) {
    const chunks = text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .filter(Boolean);
    const last = chunks.at(-1);
    if (!last) throw new Error("empty MCP SSE body");
    return JSON.parse(last) as unknown;
  }
  return JSON.parse(text) as unknown;
}

function asRecord(v: unknown): Json | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
}

function asPaymentRequired(value: unknown): Json | null {
  const obj = asRecord(value);
  if (!obj) return null;
  if (obj.x402Version != null && Array.isArray(obj.accepts)) return obj;
  if (obj.payment) return asPaymentRequired(obj.payment);
  if (obj.structuredContent) return asPaymentRequired(obj.structuredContent);
  if (obj.result) return asPaymentRequired(obj.result);
  const err = asRecord(obj.error);
  if (err) {
    const nested = asPaymentRequired(err.data);
    if (nested) return nested;
    const data = asRecord(err.data);
    if (data?.x402) return asPaymentRequired(data.x402);
  }
  const content = obj.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      const rec = asRecord(item);
      if (typeof rec?.text === "string") {
        try {
          const found = asPaymentRequired(JSON.parse(rec.text) as unknown);
          if (found) return found;
        } catch {
          /* not JSON */
        }
      }
    }
  }
  return null;
}

async function mcpRpc(body: unknown, extraHeaders: Record<string, string> = {}) {
  const res = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = parseMcpBody(text, res.headers.get("content-type") ?? "");
  } catch {
    parsed = { raw: text.slice(0, 500) };
  }
  return { res, text, parsed };
}

async function main() {
  const price = await assertProductionReady(origin);
  const keyInfo = describePayerKey();
  console.log("payer_key", keyInfo);
  console.log(`Target: ${origin}/mcp tool research_mentions`);

  const init = await mcpRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "mentionforge-seed", version: "1.0.0" },
    },
  });
  const session = init.res.headers.get("mcp-session-id");
  const sessionHeaders: Record<string, string> = session ? { "mcp-session-id": session } : {};
  console.log("mcp initialize", init.res.status, session ? "session" : "stateless");

  const unpaid = await mcpRpc(
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "research_mentions", arguments: ARGS },
    },
    sessionHeaders,
  );
  const required = asPaymentRequired(unpaid.parsed);
  if (!required) {
    console.error("expected MCP payment required, got", unpaid.res.status, unpaid.text.slice(0, 1500));
    process.exit(1);
  }
  const accepts = required.accepts as Array<{ network?: string; asset?: string; extra?: { name?: string } }>;
  assertAcceptsMainnet(accepts[0]);
  console.log("MCP 402/payment-required ok; no funds moved.");
  console.log("payTo", price.pay_to);

  if (!wantPayOnce()) {
    console.log("Dry-run complete. Then npm run fund-seed-payer and PAY_ONCE=1 (payer must differ from payTo).");
    return;
  }
  if (!price.payments_ready) {
    console.error("payments_ready is false; refusing to sign a payload that cannot settle.");
    process.exit(1);
  }

  const { account, client } = payerClient(readPayerPrivateKey());
  assertPayerDiffersFromPayTo(account.address, price.pay_to);
  console.log("payer", account.address);
  const payload = await client.createPaymentPayload(required as never);
  const paid = await mcpRpc(
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "research_mentions",
        arguments: ARGS,
        _meta: { "x402/payment": payload },
      },
    },
    {
      ...sessionHeaders,
      "Idempotency-Key": crypto.randomUUID(),
      "PAYMENT-SIGNATURE": encodePaymentHeader(payload),
    },
  );
  console.log("paid", paid.res.status, paid.text.slice(0, 2000));
  if (asPaymentRequired(paid.parsed)) {
    console.error("MCP still returned payment-required after PAYMENT-SIGNATURE / _meta.");
    process.exit(1);
  }
  const rec = asRecord(paid.parsed);
  const result = asRecord(rec?.result);
  if (!paid.res.ok || rec?.error || result?.isError) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
