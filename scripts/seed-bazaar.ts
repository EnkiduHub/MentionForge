/// <reference types="node" />
/**
 * Bazaar seed: unpaid MCP research_mentions (402) + unpaid REST POST /v1/research (402),
 * then PAY_ONCE settles both so CDP can index type:mcp and type:http.
 *
 * Default is dry-run (no USDC). Spends $0.04 ($0.02 MCP + $0.02 REST) when PAY_ONCE=1 and
 * TEST_PAYER_PRIVATE_KEY / TEST_SEED_PAYER_PRIVATE_KEY is 0x + 64 hex in the environment / .dev.vars.
 *
 * MCP x402 expects `_meta["x402/payment"]` to be the payload object, not REST base64.
 * CDP discovery requires paymentPayload.resource (absolute https) plus echoed bazaar extensions.
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

function echoCatalog(payload: unknown, required: Json): Json {
  const out = asRecord(payload) ? { ...asRecord(payload)! } : {};
  const resource = asRecord(required.resource);
  if (resource) out.resource = resource;
  const extensions = asRecord(required.extensions);
  if (extensions?.bazaar) {
    const current = asRecord(out.extensions) ?? {};
    if (!current.bazaar) out.extensions = { ...current, ...extensions };
  }
  return out;
}

function catalogLog(label: string, doc: Json | unknown): void {
  const rec = asRecord(doc) ?? {};
  const resource = asRecord(rec.resource);
  const extensions = asRecord(rec.extensions);
  const bazaar = asRecord(extensions?.bazaar);
  const input = asRecord(asRecord(bazaar?.info)?.input);
  console.log(label, {
    resource_url: typeof resource?.url === "string" ? resource.url : null,
    resource_https: typeof resource?.url === "string" ? resource.url.startsWith("https://") : false,
    service_name: typeof resource?.serviceName === "string" ? resource.serviceName : null,
    extension_keys: extensions ? Object.keys(extensions) : [],
    bazaar_type: typeof input?.type === "string" ? input.type : null,
    bazaar_tool: typeof input?.toolName === "string" ? input.toolName : null,
    bazaar_method: typeof input?.method === "string" ? input.method : null,
  });
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
  catalogLog("mcp_402_catalog", required);
  console.log("payTo", price.pay_to);

  const restUnpaid = await fetch(`${origin}/v1/research`, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(ARGS),
  });
  const restUnpaidJson = (await restUnpaid.json()) as { payment?: Json };
  const restRequired = asPaymentRequired(restUnpaidJson.payment) ?? asPaymentRequired(restUnpaidJson);
  if (restUnpaid.status !== 402 || !restRequired) {
    console.error("expected REST 402, got", restUnpaid.status, JSON.stringify(restUnpaidJson).slice(0, 800));
    process.exit(1);
  }
  assertAcceptsMainnet(
    (restRequired.accepts as Array<{ network?: string; asset?: string; extra?: { name?: string } }>)[0],
  );
  console.log("REST 402/payment-required ok; no funds moved.");
  catalogLog("rest_402_catalog", restRequired);

  if (!wantPayOnce()) {
    console.log("Dry-run complete. Then npm run fund-seed-payer and PAY_ONCE=1 (payer must differ from payTo).");
    console.log("PAY_ONCE spends $0.04: MCP research_mentions then REST POST /v1/research (HTTP Bazaar).");
    return;
  }
  if (!price.payments_ready) {
    console.error("payments_ready is false; refusing to sign a payload that cannot settle.");
    process.exit(1);
  }

  const { account, client } = payerClient(readPayerPrivateKey());
  assertPayerDiffersFromPayTo(account.address, price.pay_to);
  console.log("payer", account.address);
  const payload = echoCatalog(await client.createPaymentPayload(required as never), required);
  const recPayload = payload as {
    x402Version?: number;
    accepted?: { amount?: string; network?: string; payTo?: string };
    payload?: { authorization?: { value?: string } };
  };
  console.log("mcp_payload_shape", {
    x402Version: recPayload.x402Version,
    hasAccepted: recPayload.accepted != null,
    hasPayload: recPayload.payload != null,
    amount: recPayload.accepted?.amount ?? recPayload.payload?.authorization?.value,
    network: recPayload.accepted?.network,
    payTo: recPayload.accepted?.payTo,
  });
  catalogLog("mcp_payload_catalog", payload);
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
  if (asPaymentRequired(paid.parsed)) {
    const req = asPaymentRequired(paid.parsed);
    const acc = Array.isArray(req?.accepts) ? (req.accepts as Array<Record<string, unknown>>)[0] : undefined;
    console.error("MCP still returned payment-required after PAYMENT-SIGNATURE / _meta.", {
      error: req?.error,
      resource_url: asRecord(req?.resource)?.url,
      accept: acc
        ? { network: acc.network, amount: acc.amount, asset: acc.asset, payTo: acc.payTo, extra: acc.extra }
        : null,
      extension_keys: Object.keys(asRecord(req?.extensions) ?? {}),
    });
    process.exit(1);
  }
  const rec = asRecord(paid.parsed);
  const result = asRecord(rec?.result);
  if (!paid.res.ok || rec?.error || result?.isError) {
    const content = result?.content;
    const texts = Array.isArray(content)
      ? content
          .map((item) => {
            const recItem = asRecord(item);
            return typeof recItem?.text === "string" ? recItem.text : "";
          })
          .filter(Boolean)
      : [];
    console.error("paid MCP failed", {
      status: paid.res.status,
      isError: result?.isError,
      jsonrpc_error: rec?.error,
      content: texts.join("\n").slice(0, 1500),
    });
    process.exit(1);
  }
  console.log("paid MCP ok", paid.res.status);

  const restPayload = echoCatalog(await client.createPaymentPayload(restRequired as never), restRequired);
  catalogLog("rest_payload_catalog", restPayload);
  const restPaid = await fetch(`${origin}/v1/research`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
      "PAYMENT-SIGNATURE": encodePaymentHeader(restPayload),
    },
    body: JSON.stringify(ARGS),
  });
  const restPaidText = await restPaid.text();
  if (restPaid.status !== 200) {
    console.error("paid REST failed", { status: restPaid.status, body: restPaidText.slice(0, 1500) });
    process.exit(1);
  }
  console.log("paid REST ok", restPaid.status);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
