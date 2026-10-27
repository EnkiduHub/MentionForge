import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import {
  executionCtx,
  mockEnv,
  seedApiKey,
  stubCaches,
  stubSourcesFetch,
  getGlobalFetch,
  setGlobalFetch,
} from "../helpers/env";
import { authenticateApiKey } from "../../src/lib/api-key";
import { readPlanUsage } from "../../src/lib/plan-quota";
import { verifyStripeSignature } from "../../src/lib/stripe";

const app = createApp();
const PLAIN = "mfk_testkey_aaaaaaaaaaaaaaaaaaaaaaaa";
const PRICE = "price_1UTrCWHRKyy2qPSgkzrHPr8p";

type MemDb = {
  flags: { failUsage: boolean; failIdempotency: boolean; failPlanUsage: boolean };
  trial: Map<string, { used: number }>;
  planUsage: Map<string, { calls: number; period_start: number; key_hash: string }>;
  apiKeys: Map<string, { status: string; period_start: number; period_end: number; claimed: number; pending_key: string | null }>;
};

function mem(env: Env): MemDb {
  return env.DB as unknown as MemDb;
}

async function call(path: string, init: RequestInit, env: Env): Promise<Response> {
  return app.fetch(new Request(`https://mentionforge.test${path}`, init), env, executionCtx());
}

async function sign(payload: string, secret: string, ts = Math.floor(Date.now() / 1000)): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${ts}.${payload}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${ts},v1=${hex}`;
}

function researchInit(key: string, extra: HeadersInit = {}): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${key}`,
      ...extra,
    },
    body: JSON.stringify({ query: "ForgeCo", platforms: ["news"], timeframe: "7d", limit: 5 }),
  };
}

describe("Stripe Key plan", () => {
  beforeEach(() => {
    stubCaches();
    stubSourcesFetch();
  });

  it("calls 1..1500 succeed and call 1501 is PLAN_QUOTA_REACHED", { timeout: 120_000 }, async () => {
    const env = mockEnv({ PLAN_KEY_MONTHLY_CALLS: "1500" });
    const hash = await seedApiKey(env, PLAIN);
    const pay = stubSourcesFetch();
    let lastOk = 0;
    for (let i = 1; i <= 1500; i++) {
      const res = await call("/v1/research", researchInit(PLAIN), env);
      expect(res.status, `call ${i}`).toBe(200);
      const body = (await res.json()) as { meta: { billing: { amount_usdc: string; free_trial: boolean; plan?: string } } };
      expect(body.meta.billing.plan).toBe("key");
      expect(body.meta.billing.amount_usdc).toBe("0");
      expect(body.meta.billing.free_trial).toBe(false);
      lastOk = i;
    }
    expect(lastOk).toBe(1500);
    const row = [...mem(env).planUsage.values()][0];
    expect(row?.calls).toBe(1500);
    expect(pay.settleCount).toBe(0);
    expect(mem(env).trial.size).toBe(0);

    const denied = await call("/v1/research", researchInit(PLAIN), env);
    const deniedBody = (await denied.json()) as { error: { code: string } };
    console.log("call 1501 ->", denied.status, deniedBody.error.code);
    expect(denied.status).toBe(429);
    expect(deniedBody.error.code).toBe("PLAN_QUOTA_REACHED");
    expect([...mem(env).planUsage.values()][0]?.calls).toBe(1500);
    expect(pay.settleCount).toBe(0);
    expect(mem(env).trial.size).toBe(0);
    expect(await readPlanUsage(env, hash, row!.period_start)).toBe(1500);
  });

  it("starts a new usage row when period_start changes", async () => {
    const env = mockEnv();
    const now = Math.floor(Date.now() / 1000);
    const hash = await seedApiKey(env, PLAIN, { period_start: now - 1000, period_end: now + 1000 });
    expect((await call("/v1/research", researchInit(PLAIN), env)).status).toBe(200);
    expect([...mem(env).planUsage.values()][0]?.calls).toBe(1);
    const stored = mem(env).apiKeys.get(hash)!;
    stored.period_start = now + 1;
    stored.period_end = now + 40 * 86400;
    expect((await call("/v1/research", researchInit(PLAIN), env)).status).toBe(200);
    expect(mem(env).planUsage.size).toBe(2);
    expect([...mem(env).planUsage.values()].every((r) => r.calls === 1)).toBe(true);
  });

  it("releases the plan reservation when the X_ID cap denies", async () => {
    const env = mockEnv({ X_ID_CAP: "1" });
    const hash = await seedApiKey(env, PLAIN);
    stubSourcesFetch({
      redditPosts: [
        { id: "r1", title: "ForgeCo is a terrible awful broken scam", selftext: "refund problems" },
        { id: "r2", title: "ForgeCo outage was awful and disappointing", selftext: "delay and failure" },
        { id: "r3", title: "ForgeCo support is useless and I hate it", selftext: "broken and poor" },
      ],
    });
    const res = await call(
      "/v1/risk",
      {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${PLAIN}` },
        body: JSON.stringify({ query: "ForgeCo", platforms: ["reddit"], timeframe: "7d" }),
      },
      env,
    );
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("X_ID_CAP_REACHED");
    const used = [...mem(env).planUsage.values()][0]?.calls ?? 0;
    expect(used).toBe(0);
    expect(hash).toHaveLength(64);
  });

  it("does not double-count an idempotent replay", async () => {
    const env = mockEnv();
    await seedApiKey(env, PLAIN);
    const headers = {
      "content-type": "application/json",
      Authorization: `Bearer ${PLAIN}`,
      "Idempotency-Key": "key-plan-replay-0001-aaaa-bbbb-cccccc",
    };
    const body = JSON.stringify({ query: "ForgeCo", platforms: ["news"], timeframe: "7d", limit: 5 });
    const first = await call("/v1/research", { method: "POST", headers, body }, env);
    expect(first.status).toBe(200);
    const replay = await call("/v1/research", { method: "POST", headers, body }, env);
    expect(replay.status).toBe(200);
    expect([...mem(env).planUsage.values()][0]?.calls).toBe(1);
  });

  it("denies when the plan usage ledger is down", async () => {
    const env = mockEnv();
    await seedApiKey(env, PLAIN);
    mem(env).flags.failPlanUsage = true;
    const res = await call("/v1/research", researchInit(PLAIN), env);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("QUOTA_UNAVAILABLE");
  });

  it("rejects a bad Stripe-Signature with 400", async () => {
    const env = mockEnv();
    const res = await call(
      "/v1/stripe/webhook",
      {
        method: "POST",
        headers: { "content-type": "application/json", "Stripe-Signature": "t=1,v1=deadbeef" },
        body: JSON.stringify({ id: "evt_bad", type: "checkout.session.completed" }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("creates a key on a signed checkout.session.completed and ignores duplicates", async () => {
    const env = mockEnv();
    const prev = getGlobalFetch();
    setGlobalFetch(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("api.stripe.com/v1/subscriptions/")) {
        return new Response(
          JSON.stringify({
            id: "sub_live",
            status: "active",
            customer: "cus_live",
            current_period_start: 1_700_000_000,
            current_period_end: 1_700_000_000 + 30 * 86400,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return prev(input as never, init);
    });
    const event = {
      id: "evt_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_1",
          mode: "subscription",
          payment_status: "paid",
          status: "complete",
          customer: "cus_live",
          subscription: "sub_live",
          line_items: { data: [{ price: { id: PRICE } }] },
        },
      },
    };
    const payload = JSON.stringify(event);
    const sig = await sign(payload, env.STRIPE_WEBHOOK_SECRET!);
    const first = await call(
      "/v1/stripe/webhook",
      { method: "POST", headers: { "Stripe-Signature": sig, "content-type": "application/json" }, body: payload },
      env,
    );
    expect(first.status).toBe(200);
    expect(mem(env).apiKeys.size).toBe(1);
    const dup = await call(
      "/v1/stripe/webhook",
      { method: "POST", headers: { "Stripe-Signature": sig, "content-type": "application/json" }, body: payload },
      env,
    );
    expect(dup.status).toBe(200);
    expect(mem(env).apiKeys.size).toBe(1);
    setGlobalFetch(prev);
  });

  it("claims a key once then returns 410", async () => {
    const env = mockEnv();
    const pending = "mfk_claimonce_bbbbbbbbbbbbbbbbbbbbbbbb";
    await seedApiKey(env, pending, {
      checkout_session_id: "cs_claim_1",
      pending_key: pending,
      claimed: 0,
      stripe_subscription_id: "sub_claim",
    });
    const prev = getGlobalFetch();
    setGlobalFetch(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("api.stripe.com/v1/checkout/sessions/cs_claim_1")) {
        return new Response(
          JSON.stringify({
            id: "cs_claim_1",
            payment_status: "paid",
            status: "complete",
            subscription: "sub_claim",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return prev(input as never, init);
    });
    const first = await call("/v1/keys/claim?session_id=cs_claim_1", { method: "GET" }, env);
    expect(first.status).toBe(200);
    const body = (await first.json()) as { key: string; plan: string };
    expect(body.key).toBe(pending);
    expect(body.plan).toBe("key");
    const second = await call("/v1/keys/claim?session_id=cs_claim_1", { method: "GET" }, env);
    expect(second.status).toBe(410);
    setGlobalFetch(prev);
  });

  it("returns 404 KEY_SESSION_NOT_FOUND when Stripe does not know the session", async () => {
    const env = mockEnv();
    const prev = getGlobalFetch();
    setGlobalFetch(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("api.stripe.com/v1/checkout/sessions/cs_test_fake123")) {
        return new Response(
          JSON.stringify({ error: { type: "invalid_request_error", code: "resource_missing" } }),
          { status: 404, headers: { "content-type": "application/json" } },
        );
      }
      return prev(input as never, init);
    });
    const res = await call("/v1/keys/claim?session_id=cs_test_fake123", { method: "GET" }, env);
    setGlobalFetch(prev);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; message: string; hint: string; recoverable: boolean } };
    expect(body.error.code).toBe("KEY_SESSION_NOT_FOUND");
    expect(body.error.message).toBe("No checkout session found for this id.");
    expect(body.error.hint).not.toMatch(/facilitator|retry in 30s/i);
    expect(body.error.recoverable).toBe(false);
  });

  it("maps a Stripe 500 on claim to 503 PAYMENT_UNAVAILABLE without facilitator wording", async () => {
    const env = mockEnv();
    const prev = getGlobalFetch();
    setGlobalFetch(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("api.stripe.com/v1/checkout/sessions/cs_claim_500")) {
        return new Response(JSON.stringify({ error: { type: "api_error" } }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      return prev(input as never, init);
    });
    const res = await call("/v1/keys/claim?session_id=cs_claim_500", { method: "GET" }, env);
    setGlobalFetch(prev);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string; hint: string; details: { status: number } } };
    expect(body.error.code).toBe("PAYMENT_UNAVAILABLE");
    expect(body.error.details.status).toBe(500);
    expect(body.error.hint).not.toMatch(/facilitator/i);
  });

  it("maps a Stripe network failure on claim to 503 PAYMENT_UNAVAILABLE", async () => {
    const env = mockEnv();
    const prev = getGlobalFetch();
    setGlobalFetch(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("api.stripe.com/v1/checkout/sessions/cs_claim_net")) {
        throw new TypeError("fetch failed");
      }
      return prev(input as never, init);
    });
    const res = await call("/v1/keys/claim?session_id=cs_claim_net", { method: "GET" }, env);
    setGlobalFetch(prev);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string; hint: string } };
    expect(body.error.code).toBe("PAYMENT_UNAVAILABLE");
    expect(body.error.hint).not.toMatch(/facilitator/i);
  });

  it("keeps unpaid sessions as 402 PAYMENT_REQUIRED on claim", async () => {
    const env = mockEnv();
    const prev = getGlobalFetch();
    setGlobalFetch(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("api.stripe.com/v1/checkout/sessions/cs_claim_open")) {
        return new Response(
          JSON.stringify({ id: "cs_claim_open", payment_status: "unpaid", status: "open", subscription: null }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return prev(input as never, init);
    });
    const res = await call("/v1/keys/claim?session_id=cs_claim_open", { method: "GET" }, env);
    setGlobalFetch(prev);
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("PAYMENT_REQUIRED");
  });

  it("rejects canceled and expired keys", async () => {
    const env = mockEnv();
    const now = Math.floor(Date.now() / 1000);
    await seedApiKey(env, PLAIN, { status: "canceled" });
    const canceled = await call("/v1/research", researchInit(PLAIN), env);
    expect(canceled.status).toBe(402);
    await seedApiKey(env, "mfk_expired_cccccccccccccccccccccccc", {
      status: "active",
      period_start: now - 40 * 86400,
      period_end: now - 10,
      stripe_subscription_id: "sub_expired",
    });
    const expired = await call("/v1/research", researchInit("mfk_expired_cccccccccccccccccccccccc"), env);
    expect(expired.status).toBe(402);
    const missing = await call("/v1/research", researchInit("mfk_unknown_dddddddddddddddddddddddd"), env);
    expect(missing.status).toBe(401);
  });

  it("verifyStripeSignature rejects stale timestamps", async () => {
    const payload = "{}";
    const sig = await sign(payload, "whsec_test_mock", Math.floor(Date.now() / 1000) - 400);
    expect(await verifyStripeSignature(payload, sig, "whsec_test_mock")).toBe(false);
  });

  it("authenticateApiKey returns null when no key is presented", async () => {
    const env = mockEnv();
    const req = new Request("https://mentionforge.test/v1/research");
    expect(await authenticateApiKey(env, req, "r1")).toBeNull();
  });
});

afterEach(() => {
  /* fetch restored per test when wrapped */
});
