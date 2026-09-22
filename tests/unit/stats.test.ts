import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import {
  executionCtx,
  flushExecution,
  jsonResponse,
  mockEnv,
  seedStats,
  setGlobalFetch,
  stubCaches,
  stubSourcesFetch,
} from "../helpers/env";

const app = createApp();

async function call(
  path: string,
  init: RequestInit = {},
  env = mockEnv(),
  ctx = executionCtx(),
): Promise<Response> {
  const res = await app.fetch(new Request(`https://mentionforge.test${path}`, init), env, ctx);
  await flushExecution(ctx);
  return res;
}

describe("public volume", () => {
  beforeEach(() => {
    stubCaches();
    stubSourcesFetch();
  });

  it("reports paid plus trial and hides revenue and historical call noise", async () => {
    const env = mockEnv();
    const ctx = executionCtx();
    seedStats(env, {
      day: "2026-09-22",
      calls: 122,
      paid: 10,
      usdc_micros: 200_000,
      errors: 0,
      trial: 12,
    });

    const pub = await call("/stats", {}, env, ctx);
    expect(pub.status).toBe(200);
    const body = (await pub.json()) as { calls: number; paid: number; trial: number; usdc_micros?: number };
    expect(body).toEqual({ calls: 22, paid: 10, trial: 12 });
    expect(body.usdc_micros).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/usdc/i);

    const htmlRes = await call(
      "/stats",
      { headers: { Accept: "text/html", "Sec-Fetch-Dest": "document" } },
      env,
      ctx,
    );
    expect(htmlRes.headers.get("content-type") ?? "").toMatch(/text\/html/);
    const page = await htmlRes.text();
    expect(page).toMatch(/Successful research completions only/);
    expect(page).toMatch(/calls equals paid plus trial/);
    expect(page).toMatch(/Revenue is not published here/);
    expect(page).toMatch(/&quot;calls&quot;: 22/);
    expect(page).toMatch(/&quot;paid&quot;: 10/);
    expect(page).toMatch(/&quot;trial&quot;: 12/);
    expect(page).not.toMatch(/usdc_micros/);

    const op = await call("/v1/operator/stats", { headers: { Authorization: "Bearer test-operator" } }, env, ctx);
    const ledger = (await op.json()) as {
      totals: { calls: number; paid: number; trial: number; usdc_micros: number; errors: number };
    };
    expect(ledger.totals).toMatchObject({
      calls: 122,
      paid: 10,
      trial: 12,
      usdc_micros: 200_000,
      errors: 0,
    });

    const dash = await call("/operator", { headers: { Authorization: "Bearer test-operator" } }, env, ctx);
    const dashHtml = await dash.text();
    expect(dashHtml).toMatch(/historical non-completion noise/);
    expect(dashHtml).toMatch(/>0\.20</);
  });

  it("counts successful completions only and records source failures as errors", async () => {
    let allowPaid = false;
    const env = mockEnv({
      PAID_LIMIT: { async limit() { return { success: allowPaid }; } },
    });
    const ctx = executionCtx();

    const unpaid = await call(
      "/v1/research",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "ForgeCo", timeframe: "7d" }),
      },
      env,
      ctx,
    );
    expect(unpaid.status).toBe(402);

    const invalid = await call("/v1/research", { method: "PUT" }, env, ctx);
    expect(invalid.status).toBe(400);

    const limited = await call(
      "/v1/research",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Sandbox-Key": "test-sandbox",
          "Idempotency-Key": "stats-trial-0001-aaaa-bbbb-cccccccccccc",
        },
        body: JSON.stringify({ query: "ForgeCo", timeframe: "7d", limit: 5 }),
      },
      env,
      ctx,
    );
    expect(limited.status).toBe(429);

    allowPaid = true;
    const trialHeaders = {
      "content-type": "application/json",
      "X-Sandbox-Key": "test-sandbox",
      "Idempotency-Key": "stats-trial-0001-aaaa-bbbb-cccccccccccc",
    };
    const trial = await call(
      "/v1/research",
      { method: "POST", headers: trialHeaders, body: JSON.stringify({ query: "ForgeCo", timeframe: "7d", limit: 5 }) },
      env,
      ctx,
    );
    expect(trial.status).toBe(200);
    const replay = await call(
      "/v1/research",
      { method: "POST", headers: trialHeaders, body: JSON.stringify({ query: "ForgeCo", timeframe: "7d", limit: 5 }) },
      env,
      ctx,
    );
    expect(replay.status).toBe(200);

    const pay = btoa(
      unescape(encodeURIComponent(JSON.stringify({ payload: { authorization: { from: "payer" } }, x402Version: 2 }))),
    );
    const paid = await call(
      "/v1/research",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "PAYMENT-SIGNATURE": pay,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ query: "OtherCo", timeframe: "7d", limit: 5 }),
      },
      env,
      ctx,
    );
    expect(paid.status).toBe(200);

    setGlobalFetch(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/verify")) {
        return jsonResponse({ isValid: true, payer: "0x1111111111111111111111111111111111111111" });
      }
      if (url.includes("/settle")) {
        return jsonResponse({ success: true, transaction: "0xabc", network: "eip155:84532" });
      }
      throw new Error("offline");
    });
    const down = await call(
      "/v1/research",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "PAYMENT-SIGNATURE": pay,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ query: "DownCo", platforms: ["reddit"], timeframe: "7d" }),
      },
      env,
      ctx,
    );
    expect(down.status).toBe(503);
    const downBody = (await down.json()) as { error: { code: string } };
    expect(downBody.error.code).toBe("SOURCE_UNAVAILABLE");

    const pub = await call("/stats", {}, env, ctx);
    expect(await pub.json()).toEqual({ calls: 2, paid: 1, trial: 1 });

    const op = await call("/v1/operator/stats", { headers: { Authorization: "Bearer test-operator" } }, env, ctx);
    const ledger = (await op.json()) as {
      totals: { calls: number; paid: number; trial: number; usdc_micros: number; errors: number };
    };
    expect(ledger.totals).toMatchObject({
      calls: 2,
      paid: 1,
      trial: 1,
      errors: 1,
      usdc_micros: 20_000,
    });
  });
});
