/// <reference types="node" />
/**
 * Payment smoke against a live origin.
 *
 * Default: unpaid 402 + pricing/network guards. Never spends USDC unless
 * PAY_ONCE=1 and TEST_PAYER_PRIVATE_KEY is set in the environment / .dev.vars.
 */
import {
  assertAcceptsMainnet,
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
    error?: { hint?: string; code?: string };
    payment?: {
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
    console.log("Then PAY_ONCE=1 with TEST_PAYER_PRIVATE_KEY (0x + 64 hex, Base USDC + Base ETH). Default is dry-run.");
    return;
  }
  if (!price.payments_ready) {
    console.error("payments_ready is false; refusing to sign a payload that cannot settle.");
    process.exit(1);
  }

  const { account, client } = payerClient(readPayerPrivateKey());
  console.log("payer", account.address);
  const paymentRequired = {
    x402Version: 2,
    error: "PAYMENT-SIGNATURE header is required",
    resource:
      unpaidJson.payment && "resource" in unpaidJson.payment
        ? unpaidJson.payment.resource
        : {
            url: `${origin}/v1/research`,
            description: "research",
            mimeType: "application/json",
          },
    accepts: unpaidJson.payment?.accepts ?? [],
  };
  const payload = await client.createPaymentPayload(paymentRequired as never);
  const sig = encodePaymentHeader(payload);
  const paid = await fetch(`${origin}/v1/research`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": "00000000-0000-4000-8000-0000000000b1",
      "PAYMENT-SIGNATURE": sig,
    },
    body: BODY,
  });
  const paidText = await paid.text();
  console.log("paid", paid.status, paidText.slice(0, 800));
  if (paid.status !== 200) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
