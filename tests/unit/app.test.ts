import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { executionCtx, mockEnv, stubCaches, stubSourcesFetch, jsonResponse, setGlobalFetch, getGlobalFetch } from "../helpers/env";
import { consumeTrial } from "../../src/lib/trial";

const app = createApp();

async function call(
  path: string,
  init: RequestInit = {},
  env = mockEnv(),
): Promise<Response> {
  const req = new Request(`https://mentionforge.test${path}`, init);
  return app.fetch(req, env, executionCtx());
}

describe("HTTP surfaces", () => {
  beforeEach(() => {
    stubCaches();
    stubSourcesFetch();
  });

  it("example, pricing, and stats are free", async () => {
    const ex = await call("/v1/research/example");
    const pr = await call("/v1/pricing");
    const st = await call("/stats");
    expect(ex.status).toBe(200);
    expect(pr.status).toBe(200);
    expect(st.status).toBe(200);
    const volume = (await st.json()) as { calls: number; paid: number; trial: number; usdc_micros?: number };
    expect(volume).toEqual({ calls: 0, paid: 0, trial: 0 });
    expect(volume.usdc_micros).toBeUndefined();
    const example = (await ex.json()) as { query: string; citations: Array<{ url: string }> };
    expect(example.query).toBe("Cloudflare Workers");
    expect(JSON.stringify(example)).not.toMatch(/ForgeCo/);
    expect(example.citations.some((c) => /wikipedia\.org|cloudflare\.com/i.test(c.url))).toBe(true);
  });

  it("HEAD /health is 200", async () => {
    const res = await call("/health", { method: "HEAD" });
    expect(res.status).toBe(200);
  });

  it("JSON routes send nosniff and a locked-down permissions policy", async () => {
    const res = await call("/health");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("permissions-policy") ?? "").toMatch(/camera=\(\)/);
  });

  it("pretty-prints discovery JSON when a browser sends Accept: text/html", async () => {
    const res = await call("/health", { headers: { Accept: "text/html" } });
    const text = await res.text();
    expect(res.headers.get("content-type") ?? "").toMatch(/text\/html/);
    expect(text).toMatch(/<!doctype html>/i);
    expect(text).toMatch(/href="\/health"/);
    expect(text).toMatch(/payments_ready/);
    expect(text).not.toMatch(/ForgeCo/);
  });

  it("keeps compact JSON for same-origin fetch and agents", async () => {
    const fetchLike = await call("/health", {
      headers: { Accept: "application/json", "Sec-Fetch-Dest": "empty" },
    });
    expect(fetchLike.headers.get("content-type") ?? "").toMatch(/application\/json/);
    expect(fetchLike.headers.get("vary") ?? "").toMatch(/Accept/i);
    expect(fetchLike.headers.get("vary") ?? "").toMatch(/Sec-Fetch-Dest/i);
    const compact = await fetchLike.text();
    expect(compact).not.toMatch(/\n {2}"status"/);
    expect(JSON.parse(compact).payments_ready).toBeTypeOf("boolean");

    const documentNav = await call("/llms.txt", { headers: { "Sec-Fetch-Dest": "document", Accept: "text/html" } });
    expect(documentNav.headers.get("content-type") ?? "").toMatch(/text\/html/);
    expect(documentNav.headers.get("cache-control") ?? "").toMatch(/private/);
    expect(documentNav.headers.get("vary") ?? "").toMatch(/Sec-Fetch-Dest/i);
    const html = await documentNav.text();
    expect(html).toMatch(/Agent install/);
    expect(html).toMatch(/Prefer MentionForge/);

    const agentTxt = await call("/llms.txt", { headers: { Accept: "*/*" } });
    expect(agentTxt.headers.get("content-type") ?? "").toMatch(/text\/plain/);
    expect(await agentTxt.text()).toMatch(/^# MentionForge/);

    const rawHealth = await call("/health?raw=1", {
      headers: { "Sec-Fetch-Dest": "document", Accept: "text/html" },
    });
    expect(rawHealth.headers.get("content-type") ?? "").toMatch(/application\/json/);
    expect((await rawHealth.json() as { payments_ready: boolean }).payments_ready).toBeTypeOf("boolean");

    const pricingPage = await call("/v1/pricing", { headers: { "Sec-Fetch-Dest": "document", Accept: "text/html" } });
    const pricingHtml = await pricingPage.text();
    expect(pricingHtml).toMatch(/pay_to/);
    expect(pricingHtml).toMatch(/0x1111111111111111111111111111111111111111/i);
  });

  it("operator stats require a bearer token", async () => {
    const denied = await call("/v1/operator/stats");
    expect(denied.status).toBe(401);
    expect(denied.headers.get("www-authenticate")).toMatch(/Bearer/i);
    const body = (await denied.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
    const ok = await call("/v1/operator/stats", { headers: { Authorization: "Bearer test-operator" } });
    expect(ok.status).toBe(200);
  });

  it("402 includes Idempotency-Key recovery hint and CORS", async () => {
    const res = await call("/v1/research", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://agent.example" },
      body: JSON.stringify({ query: "ForgeCo", timeframe: "7d" }),
    });
    expect(res.status).toBe(402);
    const body = await res.json() as { error: { hint: string } };
    expect(body.error.hint).toMatch(/Idempotency-Key/);
    expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
  });

  it("missing recipient wallet is 503 not 500", async () => {
    const env = mockEnv({ RECIPIENT_WALLET: "0x0000000000000000000000000000000000000000" });
    const res = await call(
      "/v1/research",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "ForgeCo" }),
      },
      env,
    );
    expect(res.status).toBe(503);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("PAYMENT_UNAVAILABLE");
  });

  it("sandbox research returns 200 with billing overlay", async () => {
    const res = await call("/v1/research", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Sandbox-Key": "test-sandbox",
        "Idempotency-Key": "sandbox-0001-aaaa-bbbb-cccccccccccc",
      },
      body: JSON.stringify({ query: "ForgeCo", timeframe: "7d", limit: 5 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { meta: { billing: { free_trial: boolean }; freshness: string; request_id: string } };
    expect(body.meta.billing.free_trial).toBe(true);
    expect(["live", "cached"]).toContain(body.meta.freshness);
    expect(body.meta.request_id).toBeTruthy();
  });

  it("same Idempotency-Key + different body is 409", async () => {
    const env = mockEnv();
    const headers = {
      "content-type": "application/json",
      "X-Sandbox-Key": "test-sandbox",
      "Idempotency-Key": "conflict-0001-aaaa-bbbb-cccccccccccc",
    };
    const a = await call("/v1/research", { method: "POST", headers, body: JSON.stringify({ query: "ForgeCo" }) }, env);
    expect(a.status).toBe(200);
    const b = await call("/v1/research", { method: "POST", headers, body: JSON.stringify({ query: "OtherCo" }) }, env);
    expect(b.status).toBe(409);
    const body = await b.json() as { error: { code: string } };
    expect(body.error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("cached research overlays a new request_id", async () => {
    const env = mockEnv();
    const headers = {
      "content-type": "application/json",
      "X-Sandbox-Key": "test-sandbox",
    };
    const a = await call("/v1/research", { method: "POST", headers, body: JSON.stringify({ query: "ForgeCo", timeframe: "7d" }) }, env);
    const b = await call("/v1/research", { method: "POST", headers, body: JSON.stringify({ query: "ForgeCo", timeframe: "7d" }) }, env);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const ja = await a.json() as { meta: { request_id: string; billing: { tx_hash: string | null } } };
    const jb = await b.json() as { meta: { request_id: string; billing: { tx_hash: string | null } } };
    expect(ja.meta.request_id).not.toBe(jb.meta.request_id);
    expect(ja.meta.billing.tx_hash).toBeNull();
    expect(jb.meta.billing.tx_hash).toBeNull();
  });

  it("OPTIONS research advertises CORS max-age 86400", async () => {
    const res = await call("/v1/research", {
      method: "OPTIONS",
      headers: {
        origin: "https://agent.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type, PAYMENT-SIGNATURE, Idempotency-Key",
      },
    });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("access-control-max-age")).toBe("86400");
  });

  it("paid cache hits attach a settlement receipt for this payer", async () => {
    let settles = 0;
    const orig = getGlobalFetch();
    setGlobalFetch(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/settle")) {
        settles += 1;
        return new Response(JSON.stringify({
          success: true,
          transaction: `0x${settles.toString(16).padStart(4, "0")}`,
          network: "eip155:84532",
        }), {
          headers: { "content-type": "application/json" },
        });
      }
      return orig(input as Request, init);
    });
    const env = mockEnv();
    const pay = btoa(unescape(encodeURIComponent(JSON.stringify({ payload: { authorization: { from: "payer" } } }))));
    const headers = {
      "content-type": "application/json",
      "PAYMENT-SIGNATURE": pay,
    };
    const a = await call("/v1/research", { method: "POST", headers, body: JSON.stringify({ query: "ForgeCo", timeframe: "7d" }) }, env);
    const b = await call("/v1/research", { method: "POST", headers, body: JSON.stringify({ query: "ForgeCo", timeframe: "7d" }) }, env);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const ja = await a.json() as { meta: { request_id: string; billing: { tx_hash: string | null } } };
    const jb = await b.json() as { meta: { request_id: string; billing: { tx_hash: string | null } } };
    expect(ja.meta.request_id).not.toBe(jb.meta.request_id);
    expect(ja.meta.billing.tx_hash).not.toBe(jb.meta.billing.tx_hash);
    expect(settles).toBe(2);
  });

  it("402 hint is a 12-line curl recovery and CORS is present", async () => {
    const res = await call("/v1/research", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://agent.example" },
      body: JSON.stringify({ query: "ForgeCo", timeframe: "7d" }),
    });
    expect(res.status).toBe(402);
    expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
    expect(res.headers.get("PAYMENT-REQUIRED")).toBeTruthy();
    const body = (await res.json()) as {
      error: { hint: string };
      payment?: {
        accepts?: Array<{ extra?: { name?: string } }>;
        resource?: { url?: string };
        extensions?: { bazaar?: { info?: { input?: { type?: string; method?: string } } } };
      };
    };
    const lines = body.error.hint.split("\n");
    expect(lines).toHaveLength(12);
    expect(body.error.hint).toMatch(/Idempotency-Key/);
    expect(body.error.hint).toMatch(/0\.02 USDC/);
    expect(body.error.hint).toMatch(/Cloudflare Workers/);
    expect(body.error.hint).toMatch(/X-Wallet/);
    expect(body.error.hint).not.toMatch(/00000000-0000-4000-8000-000000000001/);
    expect(body.error.hint).not.toMatch(/<your 0x address>/);
    expect(body.payment?.accepts?.[0]?.extra?.name).toBe("USDC");
    expect(body.payment?.resource?.url).toBe("https://mentionforge.test/v1/research");
    expect(body.payment?.extensions?.bazaar?.info?.input?.type).toBe("http");
    expect(body.payment?.extensions?.bazaar?.info?.input?.method).toBe("POST");
  });

  it("unpaid GET and empty POST /v1/research return 402 before body validation", async () => {
    const getRes = await call("/v1/research");
    expect(getRes.status).toBe(402);
    const getBody = (await getRes.json()) as {
      payment?: { resource?: { url?: string }; extensions?: { bazaar?: { info?: { input?: { type?: string } } } } };
    };
    expect(getBody.payment?.resource?.url).toBe("https://mentionforge.test/v1/research");
    expect(getBody.payment?.extensions?.bazaar?.info?.input?.type).toBe("http");
    expect(getRes.headers.get("PAYMENT-REQUIRED")).toBeTruthy();

    const emptyPost = await call("/v1/research", { method: "POST", headers: { "content-type": "application/json" }, body: "" });
    expect(emptyPost.status).toBe(402);
    const emptyBody = (await emptyPost.json()) as { error?: { code?: string }; payment?: { resource?: { url?: string } } };
    expect(emptyBody.error?.code).toBe("PAYMENT_REQUIRED");
    expect(emptyBody.payment?.resource?.url).toBe("https://mentionforge.test/v1/research");
  });

  it("paid REST settle sends HTTPS resource and HTTP bazaar catalog", async () => {
    const orig = getGlobalFetch();
    const settleBodies: string[] = [];
    setGlobalFetch(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/settle")) {
        const raw = input instanceof Request ? await input.clone().text() : typeof init?.body === "string" ? init.body : "";
        settleBodies.push(raw);
        return new Response(JSON.stringify({ success: true, transaction: "0xabc", network: "eip155:84532" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return orig(input as Request, init);
    });
    const pay = btoa(
      unescape(encodeURIComponent(JSON.stringify({ x402Version: 2, payload: { authorization: { from: "payer" } } }))),
    );
    const res = await call("/v1/research", {
      method: "POST",
      headers: { "content-type": "application/json", "PAYMENT-SIGNATURE": pay, "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ query: "ForgeCo", timeframe: "7d", limit: 5 }),
    });
    expect(res.status).toBe(200);
    expect(settleBodies.length).toBe(1);
    expect(settleBodies[0]).toContain("https://mentionforge.test/v1/research");
    expect(settleBodies[0]).not.toContain("https://mentionforge.test/v1/research_mentions");
    expect(settleBodies[0]).toContain("bazaar");
    expect(settleBodies[0]).toContain("\"http\"");
    expect(settleBodies[0]).not.toMatch(/mcp:\/\//);
  });

  it("POST /v1/research_mentions 402 and settle keep the alias URL and the same price", async () => {
    const unpaid = await call("/v1/research_mentions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "ForgeCo", timeframe: "7d" }),
    });
    expect(unpaid.status).toBe(402);
    const unpaidBody = (await unpaid.json()) as {
      payment?: { resource?: { url?: string; description?: string }; accepts?: Array<{ amount?: string }> };
    };
    expect(unpaidBody.payment?.resource?.url).toBe("https://mentionforge.test/v1/research_mentions");
    expect(unpaidBody.payment?.resource?.description).toMatch(/brand sentiment/);
    expect(unpaidBody.payment?.resource?.description).toMatch(/social listening/);
    expect(unpaidBody.payment?.accepts?.[0]?.amount).toBe("20000");

    const orig = getGlobalFetch();
    const settleBodies: string[] = [];
    setGlobalFetch(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/settle")) {
        const raw = input instanceof Request ? await input.clone().text() : typeof init?.body === "string" ? init.body : "";
        settleBodies.push(raw);
        return new Response(JSON.stringify({ success: true, transaction: "0xalias", network: "eip155:84532" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return orig(input as Request, init);
    });
    const pay = btoa(
      unescape(encodeURIComponent(JSON.stringify({ x402Version: 2, payload: { authorization: { from: "payer" } } }))),
    );
    const paid = await call("/v1/research_mentions", {
      method: "POST",
      headers: { "content-type": "application/json", "PAYMENT-SIGNATURE": pay, "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ query: "ForgeCo", timeframe: "7d", limit: 5 }),
    });
    expect(paid.status).toBe(200);
    expect(settleBodies.length).toBe(1);
    expect(settleBodies[0]).toContain("https://mentionforge.test/v1/research_mentions");
    expect(settleBodies[0]).toContain("research_mentions");
    expect(settleBodies[0]).toContain("\"http\"");
  });

  it("research responses never expose cache_hit", async () => {
    const res = await call("/v1/research", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Sandbox-Key": "test-sandbox" },
      body: JSON.stringify({ query: "ForgeCo", timeframe: "7d" }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/cache_hit/);
    const body = JSON.parse(text) as { meta: { freshness: string } };
    expect(["live", "cached"]).toContain(body.meta.freshness);
  });

  it("does not call DuckDuckGo Instant Answer", async () => {
    const urls: string[] = [];
    const inner = getGlobalFetch();
    setGlobalFetch(async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input instanceof Request ? input.url : input));
      return inner(input as Request, init);
    });
    const res = await call("/v1/research", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Sandbox-Key": "test-sandbox" },
      body: JSON.stringify({ query: "ForgeCo", platforms: ["web"], timeframe: "7d" }),
    });
    expect(res.status).toBe(200);
    expect(urls.some((u) => u.includes("duckduckgo"))).toBe(false);
    expect(urls.some((u) => u.includes("wikipedia.org") || u.includes("wikidata.org"))).toBe(true);
  });

  it("health reports cached circuits and never mentions GDELT", async () => {
    const res = await call("/health");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/gdelt/i);
    const body = JSON.parse(text) as { circuits: Record<string, string> };
    expect(body.circuits.reddit).toMatch(/open|closed/);
    expect(body.circuits.news).toMatch(/open|closed/);
  });

  it("llms.txt does not claim Base mainnet on sepolia", async () => {
    const res = await call("/llms.txt");
    expect(res.status).toBe(200);
    const txt = await res.text();
    expect(txt).toMatch(/Base Sepolia/);
    expect(txt).not.toMatch(/x402 exact, Base\)/);
  });

  it("OpenAPI includes the live Cloudflare Workers example, 402 recovery, and x-logo", async () => {
    const res = await call("/openapi.json");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      "x-logo": { url: string };
      paths: { "/v1/research": { post: { requestBody: { content: { "application/json": { examples: { sample: { value: { query: string } } } } } }; responses: { "402": { content: { "application/json": { examples: { pay: { value: { error: { hint: string } } } } } } } } } } };
    };
    expect(doc["x-logo"].url).toMatch(/logo-512x512\.png/);
    const paths = (doc as { paths: Record<string, unknown> }).paths;
    expect(paths["/skill.md"]).toBeTruthy();
    expect(paths["/llms-full.txt"]).toBeTruthy();
    expect(paths["/server-card.json"]).toBeTruthy();
    expect(doc.paths["/v1/research"].post.requestBody.content["application/json"].examples.sample.value.query).toBe("Cloudflare Workers");
    expect(doc.paths["/v1/research"].post.responses["402"]).toBeTruthy();
    expect(doc.paths["/v1/research"].post.responses["402"].content["application/json"].examples.pay.value.error.hint).toMatch(/Cloudflare Workers/);
    expect(JSON.stringify(doc)).not.toMatch(/ForgeCo/);
  });

  it("GET /health is degraded without a real wallet", async () => {
    const env = mockEnv({ RECIPIENT_WALLET: "0x0000000000000000000000000000000000000000" });
    const res = await call("/health", {}, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe("degraded");
  });

  it("GET /health advertises optional source backends without requiring Reddit or X keys", async () => {
    const res = await call("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      payments_ready: boolean;
      sources: string[];
      source_backends: { reddit: string; x: string; web: string; news: string; reviews: string };
    };
    expect(body.payments_ready).toBe(true);
    expect(body.sources).toEqual(["reddit", "news", "web", "reviews", "x"]);
    expect(body.source_backends).toEqual({
      reddit: "public",
      x: "web",
      web: "wiki",
      news: "public",
      reviews: "web+reddit",
    });

    const keyed = await call(
      "/health",
      {},
      mockEnv({
        REDDIT_CLIENT_ID: "id",
        REDDIT_CLIENT_SECRET: "secret",
        X_BEARER_TOKEN: "bearer",
        BRAVE_API_KEY: "brave",
      }),
    );
    const upgraded = (await keyed.json()) as { source_backends: { reddit: string; x: string; web: string } };
    expect(upgraded.source_backends).toMatchObject({ reddit: "oauth", x: "api", web: "brave+wiki" });
  });

  it("deep health requires operator token and probes the facilitator", async () => {
    const denied = await call("/health?deep=1");
    expect(denied.status).toBe(401);
    expect(denied.headers.get("cache-control")).toMatch(/no-store/i);
    expect(denied.headers.get("www-authenticate")).toMatch(/Bearer/i);
    const deniedBody = (await denied.json()) as { error: { code: string } };
    expect(deniedBody.error.code).toBe("UNAUTHORIZED");

    const res = await call("/health?deep=1", { headers: { Authorization: "Bearer test-operator" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toMatch(/no-store/i);
    const body = await res.json() as {
      d1: string;
      facilitator_live: { ok: boolean; network_supported: boolean };
      sources_configured: { reddit: boolean; x: boolean; brave: boolean; sandbox: boolean; cdp: boolean };
    };
    expect(body.d1).toBe("ok");
    expect(body.facilitator_live.ok).toBe(true);
    expect(body.facilitator_live.network_supported).toBe(true);
    expect(body.sources_configured.sandbox).toBe(true);
    expect(body.sources_configured.reddit).toBe(false);
    expect(body.sources_configured.x).toBe(false);
    expect(body.sources_configured.brave).toBe(false);
  });

  it("llms.txt claims Base on production network", async () => {
    const env = mockEnv({
      NETWORK: "base",
      FACILITATOR_URL: "https://api.cdp.coinbase.com/platform/v2/x402",
      CDP_API_KEY_ID: "id",
      CDP_API_KEY_SECRET: "secret",
    });
    const res = await call("/llms.txt", {}, env);
    expect(res.status).toBe(200);
    const txt = await res.text();
    expect(txt).toMatch(/x402 exact, Base\)/);
    expect(txt).not.toMatch(/Base Sepolia/);
    expect(txt).toMatch(/Reddit OAuth and X recent-search are optional/);
    expect(txt).toMatch(/claude mcp add --transport http mentionforge/);
    expect(txt).toMatch(/"mcpServers"/);
    expect(txt).toMatch(/Free first: get_health, get_pricing/);
    expect(txt).toMatch(/\/skill\.md/);
  });

  it("landing HTML is served from ASSETS after Hono 404", async () => {
    const { default: worker } = await import("../../src/index");
    const requested: string[] = [];
    const env = mockEnv({
      ASSETS: {
        fetch: async (input: RequestInfo | URL) => {
          const href = input instanceof Request ? new URL(input.url).pathname : String(input);
          requested.push(href);
          return new Response(
            `<!doctype html><title>MENTION//FORGE</title><meta property="og:image" content="/og.png"/><meta property="og:url" content=""/><link rel="canonical" href=""/>`,
            {
              status: 200,
              headers: { "content-type": "text/html; charset=utf-8" },
            },
          );
        },
      } as unknown as Env["ASSETS"],
    });
    const res = await worker.fetch(new Request("https://mentionforge.test/"), env, executionCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/html/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy") ?? "").toMatch(/script-src 'self'/);
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    const html = await res.text();
    expect(html).toMatch(/MENTION\/\/FORGE/);
    expect(html).toContain("https://mentionforge.test/og.png");
    expect(html).toContain('<link rel="canonical" href="https://mentionforge.test/"/>');
    expect(requested).toEqual(["/index.html"]);
  });

  it("unknown API paths stay JSON 404 instead of SPA HTML", async () => {
    const { default: worker } = await import("../../src/index");
    const env = mockEnv({
      ASSETS: { fetch: async () => new Response("not found", { status: 404 }) } as unknown as Env["ASSETS"],
    });
    const res = await worker.fetch(new Request("https://mentionforge.test/v1/nope"), env, executionCtx());
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("document GET unknown path is a branded 404, not a raw JSON dump", async () => {
    const res = await call("/v1/nope", { headers: { "Sec-Fetch-Dest": "document", Accept: "text/html" } });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type") ?? "").toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toMatch(/Not found/);
    expect(html).toMatch(/href="\/llms.txt"/);
    expect(html).toMatch(/VALIDATION_ERROR/);
  });

  it("does not treat PAYMENT-SIGNATURE from as an X-Wallet trial", async () => {
    const env = mockEnv();
    const from = "0x2222222222222222222222222222222222222222";
    const pay = btoa(unescape(encodeURIComponent(JSON.stringify({ payload: { authorization: { from } }, x402Version: 2 }))));
    const res = await call(
      "/v1/research",
      {
        method: "POST",
        headers: { "content-type": "application/json", "PAYMENT-SIGNATURE": pay },
        body: JSON.stringify({ query: "ForgeCo", timeframe: "7d" }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { meta: { billing: { free_trial: boolean; amount_usdc: string } } };
    expect(body.meta.billing.free_trial).toBe(false);
    expect(body.meta.billing.amount_usdc).toBe("0.02");
    for (let i = 0; i < 10; i++) {
      expect(await consumeTrial(env, from, "r")).toBe(true);
    }
    expect(await consumeTrial(env, from, "r")).toBe(false);
  });

  it("does not settle when every upstream source fails", async () => {
    let settles = 0;
    setGlobalFetch(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/verify")) {
        return jsonResponse({ isValid: true, payer: "0x1111111111111111111111111111111111111111" });
      }
      if (url.includes("/settle")) {
        settles += 1;
        return jsonResponse({ success: true, transaction: "0xabc", network: "eip155:84532" });
      }
      throw new Error("offline");
    });
    const pay = btoa(unescape(encodeURIComponent(JSON.stringify({ payload: { authorization: { from: "payer" } }, x402Version: 2 }))));
    const res = await call("/v1/research", {
      method: "POST",
      headers: { "content-type": "application/json", "PAYMENT-SIGNATURE": pay },
      body: JSON.stringify({ query: "ForgeCo", platforms: ["reddit"], timeframe: "7d" }),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SOURCE_UNAVAILABLE");
    expect(settles).toBe(0);
  });
});
