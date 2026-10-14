import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { executionCtx, mockEnv, stubCaches, stubSourcesFetch } from "../helpers/env";
import { incrementXIdUsage, quotaUnitsForResponse, rollingXIdSum, setXIdUsageNow } from "../../src/lib/x-id-cap";

const app = createApp();
const wallet = "0x2222222222222222222222222222222222222222";

type MemDb = {
  flags: { failUsage: boolean; failIdempotency: boolean };
  trial: Map<string, { used: number; updated_at: string }>;
};

function mem(env: Env): MemDb {
  return env.DB as unknown as MemDb;
}

function payHeader(): string {
  return btoa(
    unescape(encodeURIComponent(JSON.stringify({ payload: { authorization: { from: "payer" } }, x402Version: 2 }))),
  );
}

function negativeRedditFetch(): { settleCount: number } {
  return stubSourcesFetch({
    redditPosts: [
      { id: "r1", title: "ForgeCo is a terrible awful broken scam", selftext: "refund problems" },
      { id: "r2", title: "ForgeCo outage was awful and disappointing", selftext: "delay and failure" },
      { id: "r3", title: "ForgeCo support is useless and I hate it", selftext: "broken and poor" },
    ],
  });
}

async function call(path: string, init: RequestInit, env: Env): Promise<Response> {
  return app.fetch(new Request(`https://mentionforge.test${path}`, init), env, executionCtx());
}

describe("plan quota before charge", () => {
  beforeEach(() => {
    stubCaches();
    setXIdUsageNow(undefined);
  });

  afterEach(() => {
    setXIdUsageNow(undefined);
  });

  it("counts each risk id, not one unit per call", () => {
    const batch = {
      query: "ForgeCo",
      signals: { risk: "high", spike: false, reasons: ["negatives"] },
      negatives: [
        { id: "a", platform: "reddit", url: "https://reddit.com/a", author: "u/a", text: "bad", sentiment: -0.5 },
        { id: "b", platform: "reddit", url: "https://reddit.com/b", author: "u/b", text: "worse", sentiment: -0.8 },
        { id: "c", platform: "reddit", url: "https://reddit.com/c", author: "u/c", text: "worst", sentiment: -0.9 },
      ],
      next_queries: [],
      meta: {},
    };
    expect(quotaUnitsForResponse(batch)).toBe(3);
    expect(quotaUnitsForResponse({ ...batch, negatives: [] })).toBe(0);
  });

  it("POST /v1/risk charges quota per negative id and replays do not count or settle again", async () => {
    const env = mockEnv({ X_ID_CAP: "10" });
    const pay = negativeRedditFetch();
    const headers = {
      "content-type": "application/json",
      "PAYMENT-SIGNATURE": payHeader(),
      "Idempotency-Key": "risk-batch-0001-aaaa-bbbb-cccccccccccc",
    };
    const body = JSON.stringify({ query: "ForgeCo", platforms: ["reddit"], timeframe: "7d" });
    const first = await call("/v1/risk", { method: "POST", headers, body }, env);
    expect(first.status).toBe(200);
    const payload = (await first.json()) as { negatives: Array<{ id: string }> };
    expect(payload.negatives.length).toBeGreaterThan(1);
    expect(await rollingXIdSum(env)).toBe(payload.negatives.length);
    expect(pay.settleCount).toBe(1);

    const replay = await call("/v1/risk", { method: "POST", headers, body }, env);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(payload);
    expect(await rollingXIdSum(env)).toBe(payload.negatives.length);
    expect(pay.settleCount).toBe(1);
  });

  it("rejects over cap before settle and before a trial starts", async () => {
    const env = mockEnv({ X_ID_CAP: "1" });
    const pay = negativeRedditFetch();
    const paid = await call(
      "/v1/risk",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "PAYMENT-SIGNATURE": payHeader(),
          "Idempotency-Key": "risk-over-0001-aaaa-bbbb-cccccccccccc",
        },
        body: JSON.stringify({ query: "ForgeCo", platforms: ["reddit"], timeframe: "7d" }),
      },
      env,
    );
    expect(paid.status).toBe(429);
    const paidBody = (await paid.json()) as { error: { code: string; details: { retry_after_days?: number } } };
    expect(paidBody.error.code).toBe("X_ID_CAP_REACHED");
    expect(paidBody.error.details.retry_after_days).toBe(30);
    expect(pay.settleCount).toBe(0);
    expect(await rollingXIdSum(env)).toBe(0);

    const trial = await call(
      "/v1/research",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Wallet": wallet,
          "Idempotency-Key": "risk-trial-0001-aaaa-bbbb-cccccccc",
        },
        body: JSON.stringify({ query: "ForgeCo", platforms: ["reddit"], timeframe: "7d" }),
      },
      env,
    );
    expect(trial.status).toBe(429);
    expect(mem(env).trial.get(wallet.toLowerCase())?.used ?? 0).toBe(0);
    expect(pay.settleCount).toBe(0);
  });

  it("fails closed when the usage ledger cannot be read", async () => {
    const env = mockEnv({ X_ID_CAP: "10" });
    mem(env).flags.failUsage = true;
    const pay = negativeRedditFetch();
    const res = await call(
      "/v1/risk",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "PAYMENT-SIGNATURE": payHeader(),
          "Idempotency-Key": "risk-down-0001-aaaa-bbbb-cccccccccccc",
        },
        body: JSON.stringify({ query: "ForgeCo", platforms: ["reddit"], timeframe: "7d" }),
      },
      env,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("QUOTA_UNAVAILABLE");
    expect(body.error.message).toMatch(/nothing was charged/i);
    expect(pay.settleCount).toBe(0);
    expect(mem(env).trial.size).toBe(0);
  });

  it("fails closed when the idempotency ledger cannot be read", async () => {
    const env = mockEnv();
    mem(env).flags.failIdempotency = true;
    const pay = negativeRedditFetch();
    const res = await call(
      "/v1/research",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "PAYMENT-SIGNATURE": payHeader(),
          "Idempotency-Key": "idem-down-0001-aaaa-bbbb-cccccccccccc",
        },
        body: JSON.stringify({ query: "ForgeCo", platforms: ["reddit"], timeframe: "7d" }),
      },
      env,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("QUOTA_UNAVAILABLE");
    expect(pay.settleCount).toBe(0);
  });

  it("rolls the usage window forward", async () => {
    const env = mockEnv();
    const t0 = Date.parse("2026-01-01T00:00:00Z");
    setXIdUsageNow(t0);
    await incrementXIdUsage(env, 4);
    expect(await rollingXIdSum(env)).toBe(4);
    setXIdUsageNow(t0 + 31 * 86400000);
    expect(await rollingXIdSum(env)).toBe(0);
  });
});
