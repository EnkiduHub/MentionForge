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
import { authenticateApiKey, keyIsLive } from "../../src/lib/api-key";
import { readPlanUsage } from "../../src/lib/plan-quota";
import { KEY_ALREADY_CLAIMED_MSG, PORTAL_RETURN_URL, verifyStripeSignature } from "../../src/lib/stripe";

const app = createApp();
const PLAIN = "mfk_testkey_aaaaaaaaaaaaaaaaaaaaaaaa";
const PRICE = "price_1UTrCWHRKyy2qPSgkzrHPr8p";

type MemDb = {
  flags: { failUsage: boolean; failIdempotency: boolean; failPlanUsage: boolean };
  trial: Map<string, { used: number }>;
  planUsage: Map<string, { calls: number; period_start: number; key_hash: string }>;
  apiKeys: Map<
    string,
    {
      key_hash: string;
      stripe_customer_id: string;
      stripe_subscription_id: string;
      status: string;
      period_start: number;
      period_end: number;
      claimed: number;
      pending_key: string | null;
      checkout_session_id: string | null;
    }
  >;
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

async function postWebhook(env: Env, event: Record<string, unknown>): Promise<Response> {
  const payload = JSON.stringify(event);
  const sig = await sign(payload, env.STRIPE_WEBHOOK_SECRET!);
  return call(
    "/v1/stripe/webhook",
    { method: "POST", headers: { "Stripe-Signature": sig, "content-type": "application/json" }, body: payload },
    env,
  );
}

function checkoutCompletedEvent(eventId: string, sessionId: string, customerId: string, subscriptionId: string) {
  return {
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        mode: "subscription",
        payment_status: "paid",
        status: "complete",
        customer: customerId,
        subscription: subscriptionId,
        line_items: { data: [{ price: { id: PRICE } }] },
      },
    },
  };
}

function invoicePaidEvent(eventId: string, customerId: string, subscriptionId: string) {
  return {
    id: eventId,
    type: "invoice.paid",
    data: {
      object: {
        id: `in_${eventId}`,
        customer: customerId,
        subscription: subscriptionId,
      },
    },
  };
}

function stubKeyPlanStripe(opts: {
  sessions: Array<{ id: string; customer: string; subscription: string }>;
  subscriptions: Array<{ id: string; customer: string; periodStart: number; periodEnd: number }>;
}): () => void {
  const prev = getGlobalFetch();
  setGlobalFetch(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    for (const session of opts.sessions) {
      if (url.includes(`api.stripe.com/v1/checkout/sessions/${session.id}`)) {
        return new Response(
          JSON.stringify({
            id: session.id,
            mode: "subscription",
            payment_status: "paid",
            status: "complete",
            customer: session.customer,
            subscription: session.subscription,
            line_items: { data: [{ price: { id: PRICE } }] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
    }
    for (const sub of opts.subscriptions) {
      if (url.includes(`api.stripe.com/v1/subscriptions/${sub.id}`)) {
        return new Response(
          JSON.stringify({
            id: sub.id,
            status: "active",
            customer: sub.customer,
            current_period_start: sub.periodStart,
            current_period_end: sub.periodEnd,
            items: { data: [{ price: { id: PRICE } }] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
    }
    return prev(input as never, init);
  });
  return () => setGlobalFetch(prev);
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

  it("calls 1..1500 succeed and call 1501 is PLAN_QUOTA_REACHED with helpful hint and details", { timeout: 120_000 }, async () => {
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
    const deniedBody = (await denied.json()) as {
      error: { code: string; hint: string; details: Record<string, unknown> };
    };
    console.log("call 1501 ->", denied.status, deniedBody.error.code);
    expect(denied.status).toBe(429);
    expect(deniedBody.error.code).toBe("PLAN_QUOTA_REACHED");
    expect(deniedBody.error.hint).toContain("/v1/keys/me");
    expect(deniedBody.error.hint).toContain("/v1/keys/portal");
    expect(deniedBody.error.details.used).toBe(1500);
    expect(deniedBody.error.details.limit).toBe(1500);
    expect(deniedBody.error.details.usage_url).toBe("/v1/keys/me");
    expect(deniedBody.error.details.manage_url).toBe("/v1/keys/portal");
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

  it("GET /v1/keys/claim does not burn the key (HTML or JSON); POST /v1/keys/claim claims once then returns 410", async () => {
    const env = mockEnv();
    const pending = "mfk_claimonce_bbbbbbbbbbbbbbbbbbbbbbbb";
    const hash = await seedApiKey(env, pending, {
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

    // Browser GET (HTML) + refresh does NOT burn key
    const htmlGet1 = await call(
      "/v1/keys/claim?session_id=cs_claim_1",
      { method: "GET", headers: { Accept: "text/html,application/xhtml+xml" } },
      env,
    );
    expect(htmlGet1.status).toBe(200);
    expect(htmlGet1.headers.get("content-type") ?? "").toMatch(/text\/html/);
    expect(htmlGet1.headers.get("cache-control")).toBe("no-store");
    expect(htmlGet1.headers.get("x-robots-tag")).toBe("noindex");
    expect(htmlGet1.headers.get("content-security-policy") ?? "").toContain("script-src 'self'");
    expect(htmlGet1.headers.get("content-security-policy") ?? "").toContain("form-action 'self'");
    const html1 = await htmlGet1.text();
    expect(html1).toContain('<main id="main">');
    expect(html1).toContain("Reveal my API key");
    expect(html1).toContain('<form method="post" action="/v1/keys/claim">');
    expect(html1).toContain('name="session_id" value="cs_claim_1"');
    expect(html1).not.toContain(pending);
    expect(mem(env).apiKeys.get(hash)?.claimed).toBe(0);

    // JSON GET also validates without burning
    const jsonGet = await call(
      "/v1/keys/claim?session_id=cs_claim_1",
      { method: "GET", headers: { Accept: "application/json" } },
      env,
    );
    expect(jsonGet.status).toBe(200);
    expect(jsonGet.headers.get("cache-control")).toBe("no-store");
    expect(jsonGet.headers.get("x-robots-tag")).toBe("noindex");
    const previewBody = (await jsonGet.json()) as { plan: string; claimed: boolean; session_id: string };
    expect(previewBody.plan).toBe("key");
    expect(previewBody.claimed).toBe(false);
    expect(previewBody.session_id).toBe("cs_claim_1");
    expect(mem(env).apiKeys.get(hash)?.claimed).toBe(0);

    // JSON POST burns the key once and returns {plan, key, prefix}
    const firstPost = await call(
      "/v1/keys/claim?session_id=cs_claim_1",
      { method: "POST", headers: { Accept: "application/json" } },
      env,
    );
    expect(firstPost.status).toBe(200);
    expect(firstPost.headers.get("cache-control")).toBe("no-store");
    expect(firstPost.headers.get("x-robots-tag")).toBe("noindex");
    const body = (await firstPost.json()) as { key: string; plan: string; prefix: string };
    expect(body.key).toBe(pending);
    expect(body.plan).toBe("key");
    expect(body.prefix).toBe("mfk_");

    // Second POST (JSON) is 410 KEY_ALREADY_CLAIMED with required copy
    const secondPost = await call(
      "/v1/keys/claim?session_id=cs_claim_1",
      { method: "POST", headers: { Accept: "application/json" } },
      env,
    );
    expect(secondPost.status).toBe(410);
    const secondJson = (await secondPost.json()) as { error: { code: string; message: string; hint: string } };
    expect(secondJson.error.code).toBe("KEY_ALREADY_CLAIMED");
    expect(secondJson.error.message).toBe(KEY_ALREADY_CLAIMED_MSG);
    expect(secondJson.error.hint).toBe(KEY_ALREADY_CLAIMED_MSG);

    // Subsequent HTML GET is also 410 HTML with the same message
    const claimedHtmlRes = await call(
      "/v1/keys/claim?session_id=cs_claim_1",
      { method: "GET", headers: { Accept: "text/html" } },
      env,
    );
    expect(claimedHtmlRes.status).toBe(410);
    expect(claimedHtmlRes.headers.get("content-type") ?? "").toMatch(/text\/html/);
    const claimedHtml = await claimedHtmlRes.text();
    expect(claimedHtml).toContain(KEY_ALREADY_CLAIMED_MSG);
    expect(claimedHtml).toContain('href="/support"');
    setGlobalFetch(prev);
  });

  it("HTML POST /v1/keys/claim reveals the key with Copy button, warning notice, curl example, MCP note, quota, /v1/keys/me, /v1/keys/portal, and /support", async () => {
    const env = mockEnv();
    const pending = "mfk_htmlreveal_eeeeeeeeeeeeeeeeeeeeeeee";
    await seedApiKey(env, pending, {
      checkout_session_id: "cs_claim_html",
      pending_key: pending,
      claimed: 0,
      stripe_subscription_id: "sub_claim_html",
    });
    const prev = getGlobalFetch();
    setGlobalFetch(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("api.stripe.com/v1/checkout/sessions/cs_claim_html")) {
        return new Response(
          JSON.stringify({
            id: "cs_claim_html",
            payment_status: "paid",
            status: "complete",
            subscription: "sub_claim_html",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return prev(input as never, init);
    });

    const postRes = await call(
      "/v1/keys/claim",
      {
        method: "POST",
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "session_id=cs_claim_html",
      },
      env,
    );
    setGlobalFetch(prev);
    expect(postRes.status).toBe(200);
    expect(postRes.headers.get("content-type") ?? "").toMatch(/text\/html/);
    expect(postRes.headers.get("cache-control")).toBe("no-store");
    expect(postRes.headers.get("x-robots-tag")).toBe("noindex");
    const html = await postRes.text();
    expect(html).toContain('<main id="main">');
    expect(html).toContain(pending);
    expect(html).toContain('data-copy="api-key"');
    expect(html).toContain('<script src="/claim.js" defer></script>');
    expect(html).toContain("<strong>Save this key now - it is shown once</strong>");
    expect(html).toContain(
      `curl -X POST https://mentionforge.mentionforge.workers.dev/v1/research -H 'Authorization: Bearer YOUR_KEY' -H 'content-type: application/json' -d '{"query":"Cloudflare Workers"}'`,
    );
    expect(html).toContain("/mcp");
    expect(html).toContain("1,500 calls per billing period");
    expect(html).toContain("/v1/keys/me");
    expect(html).toContain("/v1/keys/portal");
    expect(html).toContain('href="/support"');
  });

  it("self-heals when claim runs before checkout.session.completed webhook, without duplicating keys in either order", async () => {
    const prev = getGlobalFetch();
    const now = Math.floor(Date.now() / 1000);
    const periodStart = now - 60;
    const periodEnd = now + 30 * 86400;

    setGlobalFetch(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("api.stripe.com/v1/checkout/sessions/cs_race_1")) {
        return new Response(
          JSON.stringify({
            id: "cs_race_1",
            mode: "subscription",
            payment_status: "paid",
            status: "complete",
            customer: "cus_race_1",
            subscription: "sub_race_1",
            line_items: { data: [{ price: { id: PRICE } }] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("api.stripe.com/v1/subscriptions/sub_race_1")) {
        return new Response(
          JSON.stringify({
            id: "sub_race_1",
            status: "active",
            customer: "cus_race_1",
            current_period_start: periodStart,
            current_period_end: periodEnd,
            items: { data: [{ price: { id: PRICE } }] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return prev(input as never, init);
    });

    // Order 1: Redirect (GET + POST claim) arrives BEFORE webhook
    const env1 = mockEnv();
    const preview1 = await call(
      "/v1/keys/claim?session_id=cs_race_1",
      { method: "GET", headers: { Accept: "application/json" } },
      env1,
    );
    expect(preview1.status).toBe(200);
    expect(mem(env1).apiKeys.size).toBe(1);

    // Retry GET is safe and does not mint a second key or burn it
    const preview2 = await call(
      "/v1/keys/claim?session_id=cs_race_1",
      { method: "GET", headers: { Accept: "application/json" } },
      env1,
    );
    expect(preview2.status).toBe(200);
    expect(mem(env1).apiKeys.size).toBe(1);

    const claimedRes = await call(
      "/v1/keys/claim?session_id=cs_race_1",
      { method: "POST", headers: { Accept: "application/json" } },
      env1,
    );
    expect(claimedRes.status).toBe(200);
    const claimed1 = (await claimedRes.json()) as { key: string; plan: string; prefix: string };
    expect(claimed1.key).toMatch(/^mfk_[0-9a-f]{48}$/);

    // Webhook arrives AFTER claim -> updates existing subscription row, no duplicate key, key stays claimed and usable
    const event = {
      id: "evt_race_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_race_1",
          mode: "subscription",
          payment_status: "paid",
          status: "complete",
          customer: "cus_race_1",
          subscription: "sub_race_1",
          line_items: { data: [{ price: { id: PRICE } }] },
        },
      },
    };
    const payload = JSON.stringify(event);
    const sig = await sign(payload, env1.STRIPE_WEBHOOK_SECRET!);
    const whRes = await call(
      "/v1/stripe/webhook",
      { method: "POST", headers: { "Stripe-Signature": sig, "content-type": "application/json" }, body: payload },
      env1,
    );
    expect(whRes.status).toBe(200);
    expect(mem(env1).apiKeys.size).toBe(1);
    const storedRow1 = [...mem(env1).apiKeys.values()][0]!;
    expect(storedRow1.claimed).toBe(1);
    expect(storedRow1.pending_key).toBeNull();

    // Order 2: Webhook arrives FIRST, then GET + POST claim
    const env2 = mockEnv();
    const whFirst = await call(
      "/v1/stripe/webhook",
      { method: "POST", headers: { "Stripe-Signature": sig, "content-type": "application/json" }, body: payload },
      env2,
    );
    expect(whFirst.status).toBe(200);
    expect(mem(env2).apiKeys.size).toBe(1);

    const claimAfterWh = await call(
      "/v1/keys/claim?session_id=cs_race_1",
      { method: "POST", headers: { Accept: "application/json" } },
      env2,
    );
    expect(claimAfterWh.status).toBe(200);
    expect(mem(env2).apiKeys.size).toBe(1);
    const claimed2 = (await claimAfterWh.json()) as { key: string };
    expect(claimed2.key).toMatch(/^mfk_[0-9a-f]{48}$/);

    setGlobalFetch(prev);
  });

  it("invoice.paid then checkout.session.completed backfills checkout_session_id so GET preview then POST reveals one mfk_ key once", async () => {
    const env = mockEnv();
    const now = Math.floor(Date.now() / 1000);
    const restore = stubKeyPlanStripe({
      sessions: [{ id: "cs_order_a", customer: "cus_order_a", subscription: "sub_order_a" }],
      subscriptions: [
        {
          id: "sub_order_a",
          customer: "cus_order_a",
          periodStart: now - 60,
          periodEnd: now + 30 * 86400,
        },
      ],
    });

    const invoiceRes = await postWebhook(env, invoicePaidEvent("evt_order_a_invoice", "cus_order_a", "sub_order_a"));
    expect(invoiceRes.status).toBe(200);
    expect(mem(env).apiKeys.size).toBe(1);
    expect([...mem(env).apiKeys.values()][0]?.checkout_session_id).toBeNull();

    const checkoutRes = await postWebhook(
      env,
      checkoutCompletedEvent("evt_order_a_checkout", "cs_order_a", "cus_order_a", "sub_order_a"),
    );
    expect(checkoutRes.status).toBe(200);
    expect(mem(env).apiKeys.size).toBe(1);
    expect([...mem(env).apiKeys.values()][0]?.checkout_session_id).toBe("cs_order_a");

    const preview = await call(
      "/v1/keys/claim?session_id=cs_order_a",
      { method: "GET", headers: { Accept: "application/json" } },
      env,
    );
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as { claimed: boolean; key?: string; session_id: string };
    expect(previewBody.claimed).toBe(false);
    expect(previewBody.session_id).toBe("cs_order_a");
    expect(previewBody.key).toBeUndefined();
    expect([...mem(env).apiKeys.values()][0]?.claimed).toBe(0);

    const claimed = await call(
      "/v1/keys/claim?session_id=cs_order_a",
      { method: "POST", headers: { Accept: "application/json" } },
      env,
    );
    expect(claimed.status).toBe(200);
    const claimedBody = (await claimed.json()) as { key: string; plan: string; prefix: string };
    expect(claimedBody.key).toMatch(/^mfk_[0-9a-f]{48}$/);
    expect(claimedBody.plan).toBe("key");
    expect(claimedBody.prefix).toBe("mfk_");
    expect(mem(env).apiKeys.size).toBe(1);

    const again = await call(
      "/v1/keys/claim?session_id=cs_order_a",
      { method: "POST", headers: { Accept: "application/json" } },
      env,
    );
    expect(again.status).toBe(410);
    expect(mem(env).apiKeys.size).toBe(1);
    restore();
  });

  it("invoice.paid only (no checkout webhook) self-heals checkout_session_id from the Stripe session and claim succeeds", async () => {
    const env = mockEnv();
    const now = Math.floor(Date.now() / 1000);
    const restore = stubKeyPlanStripe({
      sessions: [{ id: "cs_order_b", customer: "cus_order_b", subscription: "sub_order_b" }],
      subscriptions: [
        {
          id: "sub_order_b",
          customer: "cus_order_b",
          periodStart: now - 60,
          periodEnd: now + 30 * 86400,
        },
      ],
    });

    const invoiceRes = await postWebhook(env, invoicePaidEvent("evt_order_b_invoice", "cus_order_b", "sub_order_b"));
    expect(invoiceRes.status).toBe(200);
    expect(mem(env).apiKeys.size).toBe(1);
    expect([...mem(env).apiKeys.values()][0]?.checkout_session_id).toBeNull();
    expect([...mem(env).apiKeys.values()][0]?.claimed).toBe(0);

    const preview = await call(
      "/v1/keys/claim?session_id=cs_order_b",
      { method: "GET", headers: { Accept: "application/json" } },
      env,
    );
    expect(preview.status).toBe(200);
    expect(mem(env).apiKeys.size).toBe(1);
    expect([...mem(env).apiKeys.values()][0]?.checkout_session_id).toBe("cs_order_b");

    const claimed = await call(
      "/v1/keys/claim?session_id=cs_order_b",
      { method: "POST", headers: { Accept: "application/json" } },
      env,
    );
    expect(claimed.status).toBe(200);
    const claimedBody = (await claimed.json()) as { key: string };
    expect(claimedBody.key).toMatch(/^mfk_[0-9a-f]{48}$/);
    expect(mem(env).apiKeys.size).toBe(1);
    restore();
  });

  it("checkout.session.completed then invoice.paid keeps a single api_keys row per subscription and claim still works", async () => {
    const env = mockEnv();
    const now = Math.floor(Date.now() / 1000);
    const restore = stubKeyPlanStripe({
      sessions: [{ id: "cs_order_c", customer: "cus_order_c", subscription: "sub_order_c" }],
      subscriptions: [
        {
          id: "sub_order_c",
          customer: "cus_order_c",
          periodStart: now - 60,
          periodEnd: now + 30 * 86400,
        },
      ],
    });

    const checkoutRes = await postWebhook(
      env,
      checkoutCompletedEvent("evt_order_c_checkout", "cs_order_c", "cus_order_c", "sub_order_c"),
    );
    expect(checkoutRes.status).toBe(200);
    expect(mem(env).apiKeys.size).toBe(1);
    const originalHash = [...mem(env).apiKeys.values()][0]?.key_hash;
    expect([...mem(env).apiKeys.values()][0]?.checkout_session_id).toBe("cs_order_c");

    const invoiceRes = await postWebhook(env, invoicePaidEvent("evt_order_c_invoice", "cus_order_c", "sub_order_c"));
    expect(invoiceRes.status).toBe(200);
    expect(mem(env).apiKeys.size).toBe(1);
    expect([...mem(env).apiKeys.values()][0]?.key_hash).toBe(originalHash);
    expect([...mem(env).apiKeys.values()][0]?.checkout_session_id).toBe("cs_order_c");

    const claimed = await call(
      "/v1/keys/claim?session_id=cs_order_c",
      { method: "POST", headers: { Accept: "application/json" } },
      env,
    );
    expect(claimed.status).toBe(200);
    const claimedBody = (await claimed.json()) as { key: string };
    expect(claimedBody.key).toMatch(/^mfk_[0-9a-f]{48}$/);
    expect(mem(env).apiKeys.size).toBe(1);
    restore();
  });

  it("does not overwrite an existing checkout_session_id with a second different session id", async () => {
    const env = mockEnv();
    const now = Math.floor(Date.now() / 1000);
    const restore = stubKeyPlanStripe({
      sessions: [
        { id: "cs_order_d1", customer: "cus_order_d", subscription: "sub_order_d" },
        { id: "cs_order_d2", customer: "cus_order_d", subscription: "sub_order_d" },
      ],
      subscriptions: [
        {
          id: "sub_order_d",
          customer: "cus_order_d",
          periodStart: now - 60,
          periodEnd: now + 30 * 86400,
        },
      ],
    });

    const first = await postWebhook(
      env,
      checkoutCompletedEvent("evt_order_d_checkout_1", "cs_order_d1", "cus_order_d", "sub_order_d"),
    );
    expect(first.status).toBe(200);
    expect(mem(env).apiKeys.size).toBe(1);
    expect([...mem(env).apiKeys.values()][0]?.checkout_session_id).toBe("cs_order_d1");

    const second = await postWebhook(
      env,
      checkoutCompletedEvent("evt_order_d_checkout_2", "cs_order_d2", "cus_order_d", "sub_order_d"),
    );
    expect(second.status).toBe(200);
    expect(mem(env).apiKeys.size).toBe(1);
    expect([...mem(env).apiKeys.values()][0]?.checkout_session_id).toBe("cs_order_d1");

    const otherClaim = await call(
      "/v1/keys/claim?session_id=cs_order_d2",
      { method: "GET", headers: { Accept: "application/json" } },
      env,
    );
    expect(otherClaim.status).toBe(404);
    const otherBody = (await otherClaim.json()) as { error: { code: string } };
    expect(otherBody.error.code).toBe("NOT_FOUND");
    expect([...mem(env).apiKeys.values()][0]?.checkout_session_id).toBe("cs_order_d1");

    const originalClaim = await call(
      "/v1/keys/claim?session_id=cs_order_d1",
      { method: "POST", headers: { Accept: "application/json" } },
      env,
    );
    expect(originalClaim.status).toBe(200);
    restore();
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
          headers: { "content-type": "application/json" } },
        );
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

  it("keyIsLive: past_due is live before period_end and not after", () => {
    const now = 1_700_000_000;
    const pastDue = {
      key_hash: "h",
      stripe_customer_id: "cus",
      stripe_subscription_id: "sub",
      status: "past_due",
      period_start: now - 100,
      period_end: now + 100,
      claimed: 1,
      pending_key: null,
      checkout_session_id: null,
    };
    expect(keyIsLive(pastDue, now)).toBe(true);
    expect(keyIsLive({ ...pastDue, period_end: now }, now)).toBe(false);
    expect(keyIsLive({ ...pastDue, period_end: now - 1 }, now)).toBe(false);
  });

  it("allows past_due while period_end is in the future, and denies canceled, unpaid, incomplete_expired, and expired keys with actionable hints", async () => {
    const env = mockEnv();
    const now = Math.floor(Date.now() / 1000);

    // past_due with future period_end is allowed (Stripe retries invoice)
    const pastDueFuture = "mfk_pastdue_future_aaaaaaaaaaaaaaaaaaaa";
    await seedApiKey(env, pastDueFuture, {
      status: "past_due",
      period_start: now - 86400,
      period_end: now + 3 * 86400,
      stripe_subscription_id: "sub_pastdue_future",
    });
    const okPastDue = await call("/v1/research", researchInit(pastDueFuture), env);
    expect(okPastDue.status).toBe(200);

    // past_due with expired period_end is denied
    const pastDueExpired = "mfk_pastdue_expired_bbbbbbbbbbbbbbbbbbb";
    await seedApiKey(env, pastDueExpired, {
      status: "past_due",
      period_start: now - 35 * 86400,
      period_end: now - 60,
      stripe_subscription_id: "sub_pastdue_expired",
    });
    const deniedPastDue = await call("/v1/research", researchInit(pastDueExpired), env);
    expect(deniedPastDue.status).toBe(402);

    // canceled, unpaid, incomplete_expired are denied even when period_end is in the future
    for (const status of ["canceled", "unpaid", "incomplete_expired"] as const) {
      const key = `mfk_${status}_cccccccccccccccccccccc`.slice(0, 40);
      await seedApiKey(env, key, {
        status,
        period_start: now - 60,
        period_end: now + 10 * 86400,
        stripe_subscription_id: `sub_${status}`,
      });
      const res = await call("/v1/research", researchInit(key), env);
      expect(res.status, status).toBe(402);
      const errBody = (await res.json()) as {
        error: { code: string; message: string; hint: string; details: Record<string, unknown> };
      };
      expect(errBody.error.code).toBe("PAYMENT_REQUIRED");
      expect(errBody.error.hint).toContain("/v1/keys/portal");
      expect(errBody.error.hint).toContain("/v1/keys/me");
      expect(errBody.error.details.status).toBe(status);
      expect(errBody.error.details.manage_url).toBe("/v1/keys/portal");
      expect(errBody.error.details.usage_url).toBe("/v1/keys/me");
    }

    // active with expired period_end is denied with 402
    const expiredKey = "mfk_expired_cccccccccccccccccccccccc";
    await seedApiKey(env, expiredKey, {
      status: "active",
      period_start: now - 40 * 86400,
      period_end: now - 10,
      stripe_subscription_id: "sub_expired",
    });
    const expired = await call("/v1/research", researchInit(expiredKey), env);
    expect(expired.status).toBe(402);
    const expiredBody = (await expired.json()) as {
      error: { code: string; hint: string; details: Record<string, unknown> };
    };
    expect(expiredBody.error.hint).toContain("/v1/keys/portal");
    expect(expiredBody.error.details.period_end).toBe(now - 10);

    // unknown key is 401
    const missing = await call("/v1/research", researchInit("mfk_unknown_dddddddddddddddddddddddd"), env);
    expect(missing.status).toBe(401);
  });

  it("cancel_at_period_end subscription keeps working until period_end and customer.subscription.deleted denies afterwards", async () => {
    const env = mockEnv();
    const now = Math.floor(Date.now() / 1000);
    await seedApiKey(env, PLAIN, {
      status: "active",
      period_start: now - 86400,
      period_end: now + 7 * 86400,
      stripe_customer_id: "cus_cancel_end",
      stripe_subscription_id: "sub_cancel_end",
    });

    // Stripe sends customer.subscription.updated with cancel_at_period_end: true, status still "active"
    const updatedEvent = {
      id: "evt_sub_cancel_sched",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_cancel_end",
          customer: "cus_cancel_end",
          status: "active",
          cancel_at_period_end: true,
          current_period_start: now - 86400,
          current_period_end: now + 7 * 86400,
        },
      },
    };
    const updatedPayload = JSON.stringify(updatedEvent);
    const updatedSig = await sign(updatedPayload, env.STRIPE_WEBHOOK_SECRET!);
    const upRes = await call(
      "/v1/stripe/webhook",
      { method: "POST", headers: { "Stripe-Signature": updatedSig, "content-type": "application/json" }, body: updatedPayload },
      env,
    );
    expect(upRes.status).toBe(200);

    // Key still works before period_end
    const allowed = await call("/v1/research", researchInit(PLAIN), env);
    expect(allowed.status).toBe(200);

    // Stripe sends customer.subscription.deleted at period end
    const deletedEvent = {
      id: "evt_sub_deleted",
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_cancel_end",
          customer: "cus_cancel_end",
          status: "canceled",
        },
      },
    };
    const deletedPayload = JSON.stringify(deletedEvent);
    const deletedSig = await sign(deletedPayload, env.STRIPE_WEBHOOK_SECRET!);
    const delRes = await call(
      "/v1/stripe/webhook",
      { method: "POST", headers: { "Stripe-Signature": deletedSig, "content-type": "application/json" }, body: deletedPayload },
      env,
    );
    expect(delRes.status).toBe(200);

    // Key is now denied with 402
    const denied = await call("/v1/research", researchInit(PLAIN), env);
    expect(denied.status).toBe(402);
  });

  it("GET /v1/keys/me and POST /v1/keys/portal provide self-service usage and billing portal", async () => {
    const env = mockEnv({ PLAN_KEY_MONTHLY_CALLS: "1500" });
    const now = Math.floor(Date.now() / 1000);
    const periodStart = now - 3600;
    const periodEnd = now + 29 * 86400;
    await seedApiKey(env, PLAIN, {
      status: "active",
      period_start: periodStart,
      period_end: periodEnd,
      stripe_customer_id: "cus_self_1",
      stripe_subscription_id: "sub_self_1",
    });

    // Unauthenticated requests return 401
    expect((await call("/v1/keys/me", { method: "GET" }, env)).status).toBe(401);
    expect((await call("/v1/keys/portal", { method: "POST" }, env)).status).toBe(401);

    // Make 1 research call, then check GET /v1/keys/me
    expect((await call("/v1/research", researchInit(PLAIN), env)).status).toBe(200);
    const meRes = await call(
      "/v1/keys/me",
      { method: "GET", headers: { Authorization: `Bearer ${PLAIN}` } },
      env,
    );
    expect(meRes.status).toBe(200);
    const me = (await meRes.json()) as {
      plan: string;
      status: string;
      period_start: number;
      period_end: number;
      calls_used: number;
      calls_limit: number;
      calls_remaining: number;
      manage_url: string;
    };
    expect(me).toEqual({
      plan: "key",
      status: "active",
      period_start: periodStart,
      period_end: periodEnd,
      calls_used: 1,
      calls_limit: 1500,
      calls_remaining: 1499,
      manage_url: "/v1/keys/portal",
    });

    // POST /v1/keys/portal creates a Stripe Billing Portal session
    const prev = getGlobalFetch();
    let capturedBody = "";
    setGlobalFetch(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("api.stripe.com/v1/billing_portal/sessions")) {
        capturedBody =
          input instanceof Request ? await input.clone().text() : typeof init?.body === "string" ? init.body : "";
        return new Response(
          JSON.stringify({ id: "bps_test_1", url: "https://billing.stripe.com/p/session/test_123" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return prev(input as never, init);
    });
    const portalRes = await call(
      "/v1/keys/portal",
      { method: "POST", headers: { Authorization: `Bearer ${PLAIN}` } },
      env,
    );
    expect(portalRes.status).toBe(200);
    const portal = (await portalRes.json()) as { url: string };
    expect(portal.url).toBe("https://billing.stripe.com/p/session/test_123");
    const formParams = new URLSearchParams(capturedBody);
    expect(formParams.get("customer")).toBe("cus_self_1");
    expect(formParams.get("return_url")).toBe(PORTAL_RETURN_URL);

    // When Stripe reports no portal configuration (400), return 503 PORTAL_UNAVAILABLE with /support hint
    setGlobalFetch(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("api.stripe.com/v1/billing_portal/sessions")) {
        return new Response(
          JSON.stringify({
            error: {
              type: "invalid_request_error",
              message: "No configuration provided and your test mode default configuration has not been created.",
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
      return prev(input as never, init);
    });
    const unconfRes = await call(
      "/v1/keys/portal",
      { method: "POST", headers: { Authorization: `Bearer ${PLAIN}` } },
      env,
    );
    setGlobalFetch(prev);
    expect(unconfRes.status).toBe(503);
    const unconfBody = (await unconfRes.json()) as { error: { code: string; hint: string } };
    expect(unconfBody.error.code).toBe("PORTAL_UNAVAILABLE");
    expect(unconfBody.error.hint).toContain("/support");
  });

  it("end-to-end flow: webhook (+ duplicate) -> claim GET (no burn) -> POST reveal -> /v1/research -> /v1/keys/me -> 429 quota -> invoice.paid renewal -> subscription.deleted -> 402", async () => {
    const env = mockEnv({ PLAN_KEY_MONTHLY_CALLS: "2" });
    const prev = getGlobalFetch();
    const now = Math.floor(Date.now() / 1000);
    let subPeriodStart = now - 600;
    let subPeriodEnd = now + 30 * 86400;

    setGlobalFetch(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("api.stripe.com/v1/checkout/sessions/cs_e2e_1")) {
        return new Response(
          JSON.stringify({
            id: "cs_e2e_1",
            mode: "subscription",
            payment_status: "paid",
            status: "complete",
            customer: "cus_e2e_1",
            subscription: "sub_e2e_1",
            line_items: { data: [{ price: { id: PRICE } }] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("api.stripe.com/v1/subscriptions/sub_e2e_1")) {
        return new Response(
          JSON.stringify({
            id: "sub_e2e_1",
            status: "active",
            customer: "cus_e2e_1",
            current_period_start: subPeriodStart,
            current_period_end: subPeriodEnd,
            items: { data: [{ price: { id: PRICE } }] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return prev(input as never, init);
    });

    // 1. Signed checkout.session.completed webhook + duplicate event idempotency
    const checkoutEvt = {
      id: "evt_e2e_checkout",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_e2e_1",
          mode: "subscription",
          payment_status: "paid",
          status: "complete",
          customer: "cus_e2e_1",
          subscription: "sub_e2e_1",
          line_items: { data: [{ price: { id: PRICE } }] },
        },
      },
    };
    const checkoutPayload = JSON.stringify(checkoutEvt);
    const checkoutSig = await sign(checkoutPayload, env.STRIPE_WEBHOOK_SECRET!);
    const wh1 = await call(
      "/v1/stripe/webhook",
      { method: "POST", headers: { "Stripe-Signature": checkoutSig, "content-type": "application/json" }, body: checkoutPayload },
      env,
    );
    expect(wh1.status).toBe(200);
    const whDup = await call(
      "/v1/stripe/webhook",
      { method: "POST", headers: { "Stripe-Signature": checkoutSig, "content-type": "application/json" }, body: checkoutPayload },
      env,
    );
    expect(whDup.status).toBe(200);
    expect(mem(env).apiKeys.size).toBe(1);

    // 2. Claim page GET (HTML) does not burn key
    const claimGet = await call(
      "/v1/keys/claim?session_id=cs_e2e_1",
      { method: "GET", headers: { Accept: "text/html" } },
      env,
    );
    expect(claimGet.status).toBe(200);
    expect(await claimGet.text()).toContain("Reveal my API key");
    expect([...mem(env).apiKeys.values()][0]?.claimed).toBe(0);

    // 3. POST reveal burns key and returns plaintext mfk_ key
    const claimPost = await call(
      "/v1/keys/claim",
      {
        method: "POST",
        headers: { Accept: "text/html", "content-type": "application/x-www-form-urlencoded" },
        body: "session_id=cs_e2e_1",
      },
      env,
    );
    expect(claimPost.status).toBe(200);
    const revealedHtml = await claimPost.text();
    const keyMatch = revealedHtml.match(/<pre id="api-key">(mfk_[0-9a-f]{48})<\/pre>/);
    expect(keyMatch).toBeTruthy();
    const apiKey = keyMatch![1]!;
    expect([...mem(env).apiKeys.values()][0]?.claimed).toBe(1);

    // 4. Use key on /v1/research -> quota decrements
    const r1 = await call("/v1/research", researchInit(apiKey), env);
    expect(r1.status).toBe(200);

    // 5. /v1/keys/me shows used=1, remaining=1
    const me1Res = await call("/v1/keys/me", { method: "GET", headers: { Authorization: `Bearer ${apiKey}` } }, env);
    expect(me1Res.status).toBe(200);
    const me1 = (await me1Res.json()) as { calls_used: number; calls_limit: number; calls_remaining: number };
    expect(me1.calls_used).toBe(1);
    expect(me1.calls_limit).toBe(2);
    expect(me1.calls_remaining).toBe(1);

    // Second call hits the 2-call limit
    const r2 = await call("/v1/research", researchInit(apiKey), env);
    expect(r2.status).toBe(200);

    // 6. Third call -> 429 PLAN_QUOTA_REACHED with helpful hint
    const r3 = await call("/v1/research", researchInit(apiKey), env);
    expect(r3.status).toBe(429);
    const r3Body = (await r3.json()) as { error: { code: string; hint: string; details: Record<string, unknown> } };
    expect(r3Body.error.code).toBe("PLAN_QUOTA_REACHED");
    expect(r3Body.error.hint).toContain("/v1/keys/me");
    expect(r3Body.error.hint).toContain("/v1/keys/portal");
    expect(r3Body.error.details.resets_at).toBe(subPeriodEnd);

    // 7. invoice.paid renewal advances period_start and resets quota
    subPeriodStart = subPeriodEnd;
    subPeriodEnd = subPeriodStart + 30 * 86400;
    const invoiceEvt = {
      id: "evt_e2e_invoice_paid",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_e2e_2",
          customer: "cus_e2e_1",
          subscription: "sub_e2e_1",
        },
      },
    };
    const invoicePayload = JSON.stringify(invoiceEvt);
    const invoiceSig = await sign(invoicePayload, env.STRIPE_WEBHOOK_SECRET!);
    const whInvoice = await call(
      "/v1/stripe/webhook",
      { method: "POST", headers: { "Stripe-Signature": invoiceSig, "content-type": "application/json" }, body: invoicePayload },
      env,
    );
    expect(whInvoice.status).toBe(200);

    const meRenewed = (await (
      await call("/v1/keys/me", { method: "GET", headers: { Authorization: `Bearer ${apiKey}` } }, env)
    ).json()) as { calls_used: number; calls_remaining: number; period_start: number; period_end: number };
    expect(meRenewed.calls_used).toBe(0);
    expect(meRenewed.calls_remaining).toBe(2);
    expect(meRenewed.period_start).toBe(subPeriodStart);
    expect(meRenewed.period_end).toBe(subPeriodEnd);

    const afterRenew = await call("/v1/research", researchInit(apiKey), env);
    expect(afterRenew.status).toBe(200);

    // 8. customer.subscription.deleted -> 402 PAYMENT_REQUIRED
    const deleteEvt = {
      id: "evt_e2e_sub_del",
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_e2e_1",
          customer: "cus_e2e_1",
          status: "canceled",
        },
      },
    };
    const deletePayload = JSON.stringify(deleteEvt);
    const deleteSig = await sign(deletePayload, env.STRIPE_WEBHOOK_SECRET!);
    const whDel = await call(
      "/v1/stripe/webhook",
      { method: "POST", headers: { "Stripe-Signature": deleteSig, "content-type": "application/json" }, body: deletePayload },
      env,
    );
    expect(whDel.status).toBe(200);

    const afterDelete = await call("/v1/research", researchInit(apiKey), env);
    expect(afterDelete.status).toBe(402);
    const delBody = (await afterDelete.json()) as { error: { code: string; hint: string } };
    expect(delBody.error.code).toBe("PAYMENT_REQUIRED");
    expect(delBody.error.hint).toContain("/v1/keys/portal");

    setGlobalFetch(prev);
  });

  it("returns 404 for malformed session ids and does not call Stripe with the raw id", async () => {
    const env = mockEnv();
    const prev = getGlobalFetch();
    const urls: string[] = [];
    setGlobalFetch(async (input, init) => {
      urls.push(String(input instanceof Request ? input.url : input));
      return prev(input as never, init);
    });
    const cases = [
      "/v1/keys/claim",
      "/v1/keys/claim?session_id=",
      "/v1/keys/claim?session_id=" + encodeURIComponent("not-a-session"),
      "/v1/keys/claim?session_id=" + encodeURIComponent("cs_x/../../../../v1/customers"),
      "/v1/keys/claim?session_id=" + encodeURIComponent("cs_live_abc?expand[]=customer"),
    ];
    for (const path of cases) {
      const res = await call(path, { method: "GET", headers: { Accept: "application/json" } }, env);
      expect(res.status, path).toBe(404);
      const body = (await res.json()) as { error: { code: string; message: string }; stack?: string };
      expect(body.error.code).toBe("KEY_SESSION_NOT_FOUND");
      expect(body.error.message).toBe("No checkout session found for this id.");
      expect(JSON.stringify(body)).not.toMatch(/stack|api_keys|sqlite/i);
    }
    const post = await call(
      "/v1/keys/claim",
      {
        method: "POST",
        headers: { Accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ session_id: "cs_x/../../../../v1/customers" }),
      },
      env,
    );
    expect(post.status).toBe(404);
    expect(urls.some((url) => url.includes("api.stripe.com"))).toBe(false);

    const html = await call(
      "/v1/keys/claim?session_id=" + encodeURIComponent("cs_x/../../../../v1/customers"),
      { method: "GET", headers: { Accept: "text/html" } },
      env,
    );
    expect(html.status).toBe(404);
    const htmlBody = await html.text();
    expect(htmlBody).not.toMatch(/at stripe|Error:|stack/i);
    setGlobalFetch(prev);
  });

  it("portal uses the authenticated key's customer and ignores a session_id query", async () => {
    const env = mockEnv();
    await seedApiKey(env, PLAIN, { stripe_customer_id: "cus_owner" });
    const prev = getGlobalFetch();
    const urls: string[] = [];
    let captured = "";
    setGlobalFetch(async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      urls.push(url);
      if (url.includes("api.stripe.com/v1/billing_portal/sessions")) {
        captured = input instanceof Request ? await input.clone().text() : typeof init?.body === "string" ? init.body : "";
        return new Response(JSON.stringify({ url: "https://billing.stripe.com/p/session/test_owner" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return prev(input as never, init);
    });
    const res = await call(
      "/v1/keys/portal?session_id=" + encodeURIComponent("cs_other/../../../../v1/customers"),
      { method: "POST", headers: { Authorization: `Bearer ${PLAIN}` } },
      env,
    );
    setGlobalFetch(prev);
    expect(res.status).toBe(200);
    expect(new URLSearchParams(captured).get("customer")).toBe("cus_owner");
    expect(urls.some((url) => url.includes("/v1/customers") || url.includes("cs_other"))).toBe(false);
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
