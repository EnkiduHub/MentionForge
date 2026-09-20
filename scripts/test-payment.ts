/// <reference types="node" />
/**
 * Payment smoke against a live origin.
 *
 * Default: unpaid 402 + pricing/network guards. Never spends USDC unless
 * PAY_ONCE=1 and TEST_PAYER_PRIVATE_KEY is set in the environment / .dev.vars.
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
const BODY = JSON.stringify({
  query: "OpenAI",
  timeframe: "7d",
  limit: 8,
  include_summary: false,
});

async function main() {
  const price = await assertProductionReady(origin);

  const unpaid = await fetch(`${origin}/v1/research`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": "00000000-0000-4000-8000-000000000099",
    },
    body: BODY,
  });
  const unpaidJson = (await unpaid.json()) as {
    error?: { hint?: string; code?: string; details?: { err?: string; invalidReason?: string; payment?: unknown } };
    payment?: {
      x402Version?: number;
      resource?: unknown;
      accepts?: Array<{ network?: string; asset?: string; extra?: { name?: string } }>;
    };
  };
  if (unpaid.status === 503 && unpaidJson.error?.code === "PAYMENT_UNAVAILABLE") {
    console.log("PAYMENT_UNAVAILABLE — set CDP_API_KEY_ID and CDP_API_KEY_SECRET on the Worker before any paid call.");
    process.exit(0);
  }
  if (unpaid.status !== 402) {
    console.error("expected 402, got", unpaid.status, unpaidJson);
    process.exit(1);
  }
  assertAcceptsMainnet(unpaidJson.payment?.accepts?.[0]);
  console.log("402 mainnet USDC ok; no funds moved.");
  console.log("payTo", price.pay_to);
  console.log("payer_key", describePayerKey());

  if (!wantPayOnce()) {
    console.log("Dry-run complete. Next: GET /health?deep=1 with OPERATOR_TOKEN (facilitator_live.ok).");
    console.log("Then: npm run fund-seed-payer  (CDP rejects payer === payTo).");
    console.log("Then PAY_ONCE=1 with TEST_SEED_PAYER_PRIVATE_KEY (0x + 64 hex, Base USDC). Default is dry-run.");
    return;
  }
  if (!price.payments_ready) {
    console.error("payments_ready is false; refusing to sign a payload that cannot settle.");
    process.exit(1);
  }

  const { account, client } = payerClient(readPayerPrivateKey());
  assertPayerDiffersFromPayTo(account.address, price.pay_to);
  console.log("payer", account.address);
  const required = unpaidJson.payment;
  if (!required?.accepts?.length) {
    throw new Error("402 payment.accepts missing; cannot sign");
  }
  const payload = await client.createPaymentPayload(required as never);
  const rec = payload as {
    x402Version?: number;
    accepted?: { amount?: string; network?: string; payTo?: string };
    resource?: { description?: string };
    payload?: { authorization?: { value?: string; to?: string } };
  };
  console.log("payload_shape", {
    x402Version: rec.x402Version,
    amount: rec.accepted?.amount ?? rec.payload?.authorization?.value,
    network: rec.accepted?.network,
    payTo: rec.accepted?.payTo,
    descLen: rec.resource?.description?.length ?? 0,
  });
  const sig = encodePaymentHeader(payload);
  const paid = await fetch(`${origin}/v1/research`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
      "PAYMENT-SIGNATURE": sig,
    },
    body: BODY,
  });
  const paidText = await paid.text();
  console.log("paid", paid.status, paidText.slice(0, 1200));
  if (paid.status !== 200) {
    try {
      const fail = JSON.parse(paidText) as { error?: { message?: string; details?: unknown } };
      console.log("verify_details", fail.error?.details ?? fail.error?.message);
    } catch {
      /* not JSON */
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
