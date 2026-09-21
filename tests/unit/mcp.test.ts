import { beforeEach, describe, expect, it } from "vitest";
import { GET_PRICING_DESC, HEALTH_DESC, handleMcp, mcpPaymentExtraFromContext, TOOL_DESC, COMPARE_DESC, DIGEST_DESC, RISK_DESC, REPLY_DESC, LIST_DESC, TRENDS_DESC } from "../../src/mcp";
import { bazaarExtension, bazaarHttpExtension, BAZAAR_RESOURCE_DESC, BAZAAR_TOOL_DESC, encodeHeader } from "../../src/lib/x402";
import { createApp } from "../../src/app";
import { executionCtx, mockEnv, stubCaches, stubSourcesFetch } from "../helpers/env";

const MCP_HEADERS = {
  "content-type": "application/json",
  host: "mentionforge.test",
  accept: "application/json, text/event-stream",
} as const;

const PAID_ARGS = { query: "ForgeCo", platforms: ["reddit"], timeframe: "7d", limit: 5, include_summary: false };

type Json = Record<string, unknown>;

function asRecord(v: unknown): Json | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
}

async function mcpJson(res: Response): Promise<unknown> {
  const raw = await res.text();
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/event-stream")) {
    const chunks = raw
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.replace(/^data:\s?/, "").trim())
      .filter(Boolean);
    const last = chunks.at(-1);
    if (!last) throw new Error(`empty MCP SSE body: ${raw.slice(0, 200)}`);
    return JSON.parse(last) as unknown;
  }
  return JSON.parse(raw) as unknown;
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

function toolResult(parsed: unknown): Json {
  const rec = asRecord(parsed);
  return asRecord(rec?.result) ?? rec ?? {};
}

function contentText(result: Json): string {
  const content = result.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      const rec = asRecord(item);
      return typeof rec?.text === "string" ? rec.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

async function mcpInitialize(env = mockEnv()) {
  const init = await handleMcp(
    new Request("https://mentionforge.test/mcp", {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      }),
    }),
    env,
    executionCtx(),
  );
  const session = init.headers.get("mcp-session-id");
  return {
    env,
    headers: { ...MCP_HEADERS, ...(session ? { "mcp-session-id": session } : {}) },
  };
}

async function unpaidResearch(session: { env: Env; headers: Record<string, string> }) {
  const unpaid = await handleMcp(
    new Request("https://mentionforge.test/mcp", {
      method: "POST",
      headers: session.headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "research_mentions", arguments: PAID_ARGS },
      }),
    }),
    session.env,
    executionCtx(),
  );
  const parsed = await mcpJson(unpaid);
  const required = asPaymentRequired(parsed);
  if (!required) {
    throw new Error(`expected payment-required, got ${JSON.stringify(parsed).slice(0, 500)}`);
  }
  const accepts = required.accepts as unknown[];
  expect(accepts.length).toBeGreaterThan(0);
  return { accepts, required };
}

function stubPayment(accepted: unknown) {
  return { x402Version: 2, accepted, payload: { signature: "0xsig" } };
}

async function paidResearch(
  session: { env: Env; headers: Record<string, string> },
  payment: unknown,
  mode: "both" | "meta" | "header",
  idempKey = crypto.randomUUID(),
) {
  const extraHeaders: Record<string, string> = {
    ...session.headers,
    "Idempotency-Key": idempKey,
  };
  const params: Json = { name: "research_mentions", arguments: PAID_ARGS };
  if (mode === "both" || mode === "meta") {
    params._meta = { "x402/payment": payment };
  }
  if (mode === "both" || mode === "header") {
    extraHeaders["PAYMENT-SIGNATURE"] = encodeHeader(payment);
  }
  const res = await handleMcp(
    new Request("https://mentionforge.test/mcp", {
      method: "POST",
      headers: extraHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params }),
    }),
    session.env,
    executionCtx(),
  );
  const parsed = await mcpJson(res);
  return { res, parsed, result: toolResult(parsed) };
}

function head200(s: string): string {
  return s.slice(0, 200);
}

describe("MCP origin + factory", () => {
  beforeEach(() => {
    stubCaches();
    stubSourcesFetch();
  });

  it("research_mentions description front-loads purpose then cost, trial, and prefer-over-web_search", () => {
    expect(TOOL_DESC).toMatch(/^Research /);
    const head = head200(TOOL_DESC);
    expect(head).toMatch(/\$0\.02 USDC/);
    expect(head).toMatch(/trial/);
    expect(head).toMatch(/web_search/);
  });

  it("research_mentions description documents siblings, payment, and defaults without native Reddit/X as default", () => {
    expect(TOOL_DESC).toMatch(/use get_health instead/);
    expect(TOOL_DESC).toMatch(/use get_pricing instead/);
    expect(TOOL_DESC).toMatch(/use get_digest instead/);
    expect(TOOL_DESC).toMatch(/use get_trends instead/);
    expect(TOOL_DESC).toMatch(/use list_mentions instead/);
    expect(TOOL_DESC).toMatch(/402|payment-required/);
    expect(TOOL_DESC).toMatch(/Idempotency-Key/);
    expect(TOOL_DESC).toMatch(/Send only query/);
    expect(TOOL_DESC).not.toMatch(/0x[a-fA-F0-9]{40}/);
    expect(TOOL_DESC).toMatch(/optional operator upgrades, not the default/);
  });

  it("paid specialty tools front-load purpose, keep cost in the first 200 chars, and never include wallets", () => {
    for (const desc of [COMPARE_DESC, DIGEST_DESC, RISK_DESC, REPLY_DESC, LIST_DESC, TRENDS_DESC]) {
      expect(desc).toMatch(/^(Compare|Group|Detect|Draft|Export|Return) /);
      expect(head200(desc)).toMatch(/\$0\.02 USDC/);
      expect(head200(desc)).toMatch(/trial/);
      expect(head200(desc)).toMatch(/web_search/);
      expect(desc).toMatch(/use get_health instead/);
      expect(desc).toMatch(/use get_pricing instead/);
      expect(desc).toMatch(/use research_mentions( or list_mentions)? instead/);
      expect(desc).not.toMatch(/0x[a-fA-F0-9]{40}/);
    }
  });

  it("health description has verb, when-to-use, when-not vs siblings, and free behavior", () => {
    expect(HEALTH_DESC).toMatch(/^Check /);
    expect(HEALTH_DESC).toMatch(/use get_pricing instead/);
    expect(HEALTH_DESC).toMatch(/use research_mentions/);
    expect(HEALTH_DESC).toMatch(/needs no X-Wallet/);
    expect(HEALTH_DESC).toMatch(/free/i);
    expect(HEALTH_DESC).toMatch(/instead/);
    expect(HEALTH_DESC).toMatch(/never charges/i);
    expect(HEALTH_DESC).toMatch(/takes no arguments/i);
    expect(HEALTH_DESC).toMatch(/Call with \{\}/);
    expect(HEALTH_DESC).not.toMatch(/0x[a-fA-F0-9]{40}/);
  });

  it("get_pricing description has verb, when-to-use, when-not vs siblings, and free catalog behavior", () => {
    expect(GET_PRICING_DESC).toMatch(/^Return /);
    expect(GET_PRICING_DESC).toMatch(/\$0\.02 USDC/);
    expect(GET_PRICING_DESC).toMatch(/use get_health instead/);
    expect(GET_PRICING_DESC).toMatch(/use research_mentions/);
    expect(GET_PRICING_DESC).toMatch(/needs no payment headers/);
    expect(GET_PRICING_DESC).toMatch(/X-Wallet/);
    expect(GET_PRICING_DESC).toMatch(/Idempotency-Key/);
    expect(GET_PRICING_DESC).toMatch(/never charges/i);
    expect(GET_PRICING_DESC).toMatch(/takes no arguments/i);
    expect(GET_PRICING_DESC).toMatch(/those paid tools/);
    expect(GET_PRICING_DESC).not.toMatch(/0x[a-fA-F0-9]{40}/);
  });

  it("rejects a malformed Origin", async () => {
    const req = new Request("https://mentionforge.test/mcp", {
      method: "POST",
      headers: { origin: "not a url", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    const res = await handleMcp(req, mockEnv({ ALLOWED_ORIGINS: "https://ok.example" }), executionCtx());
    expect(res.status).toBe(403);
  });

  it("builds a per-request initialize result", async () => {
    const env = mockEnv();
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    const headers = { "content-type": "application/json", host: "mentionforge.test" };
    const a = await handleMcp(new Request("https://mentionforge.test/mcp", { method: "POST", headers, body }), env, executionCtx());
    const b = await handleMcp(new Request("https://mentionforge.test/mcp", { method: "POST", headers, body }), env, executionCtx());
    expect(a.status).not.toBe(403);
    expect(b.status).not.toBe(403);
  });

  it("maps SDK v2 ctx.mcpReq._meta onto the x402 wrapper extra", () => {
    const extra = mcpPaymentExtraFromContext({
      mcpReq: { _meta: { "x402/payment": { x402Version: 2, payload: { signature: "sig" } } } },
    });
    expect(extra._meta["x402/payment"]).toEqual({ x402Version: 2, payload: { signature: "sig" } });
  });

  it("maps ctx._meta and header fallbacks, preferring existing _meta payment", () => {
    const fromCtxMeta = mcpPaymentExtraFromContext({
      _meta: { "x402/payment": { x402Version: 2, payload: { signature: "ctx" } } },
    });
    expect(fromCtxMeta._meta["x402/payment"]).toEqual({ x402Version: 2, payload: { signature: "ctx" } });

    const headerReq = new Request("https://mentionforge.test/mcp", {
      headers: { "PAYMENT-SIGNATURE": encodeHeader({ x402Version: 2, payload: { signature: "hdr" } }) },
    });
    const fromHttp = mcpPaymentExtraFromContext({ http: { req: headerReq } });
    expect(fromHttp._meta["x402/payment"]).toEqual({ x402Version: 2, payload: { signature: "hdr" } });

    const closedOver = new Request("https://mentionforge.test/mcp", {
      headers: { "PAYMENT-SIGNATURE": encodeHeader({ x402Version: 2, payload: { signature: "closed" } }) },
    });
    const fromClosed = mcpPaymentExtraFromContext({}, closedOver);
    expect(fromClosed._meta["x402/payment"]).toEqual({ x402Version: 2, payload: { signature: "closed" } });

    const preferMeta = mcpPaymentExtraFromContext(
      { mcpReq: { _meta: { "x402/payment": { x402Version: 2, payload: { signature: "meta" } } } } },
      headerReq,
    );
    expect(preferMeta._meta["x402/payment"]).toEqual({ x402Version: 2, payload: { signature: "meta" } });

    const coerced = mcpPaymentExtraFromContext({
      _meta: { "x402/payment": { x402Version: "2", payload: { signature: "str" } } },
    });
    expect(coerced._meta["x402/payment"]).toEqual({ x402Version: 2, payload: { signature: "str" } });
  });

  it("tools/list exposes described research parameters Glama TDQS scores", async () => {
    const env = mockEnv();
    const headers = { "content-type": "application/json", host: "mentionforge.test", accept: "application/json, text/event-stream" };
    const init = await handleMcp(
      new Request("https://mentionforge.test/mcp", {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } },
        }),
      }),
      env,
      executionCtx(),
    );
    expect(init.status).toBe(200);
    const session = init.headers.get("mcp-session-id");
    const listed = await handleMcp(
      new Request("https://mentionforge.test/mcp", {
        method: "POST",
        headers: { ...headers, ...(session ? { "mcp-session-id": session } : {}) },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      }),
      env,
      executionCtx(),
    );
    expect(listed.status).toBe(200);
    const raw = await listed.text();
    const dataLines = raw.split("\n").filter((line) => line.startsWith("data: "));
    const payload = JSON.parse(dataLines.at(-1)?.slice(6) ?? raw) as {
      result?: {
        tools?: Array<{
          name: string;
          title?: string;
          description?: string;
          annotations?: {
            readOnlyHint?: boolean;
            destructiveHint?: boolean;
            idempotentHint?: boolean;
            openWorldHint?: boolean;
          };
          inputSchema?: { properties?: Record<string, { description?: string }> };
          outputSchema?: { properties?: Record<string, unknown> };
        }>;
      };
    };
    const tools = payload.result?.tools ?? [];
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "get_health",
        "get_pricing",
        "get_example",
        "suggest_tool",
        "get_entity_profile",
        "research_mentions",
        "compare_brands",
        "get_digest",
        "detect_risk",
        "draft_reply",
        "list_mentions",
        "get_trends",
      ]),
    );
    expect(names).toHaveLength(12);
    expect(names.every((n) => /^[a-z]+_[a-z_]+$/.test(n))).toBe(true);

    const research = tools.find((t) => t.name === "research_mentions");
    expect(research?.title).toBe("Research social mentions");
    expect((research?.title ?? "").length).toBeGreaterThan("research_mentions".length);
    expect(research?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
    const props = research?.inputSchema?.properties ?? {};
    for (const key of ["query", "platforms", "timeframe", "limit", "include_summary", "min_engagement", "language", "view", "focus", "include_markdown"]) {
      expect((props[key]?.description ?? "").length).toBeGreaterThan(20);
    }
    expect(research?.description?.slice(0, 200)).toMatch(/^Research /);
    expect(research?.description?.slice(0, 200)).toMatch(/\$0\.02 USDC/);
    expect(research?.outputSchema?.properties).toBeTruthy();

    const health = tools.find((t) => t.name === "get_health");
    expect(health?.title).toBe("Check Worker liveness");
    expect(Object.keys(health?.inputSchema?.properties ?? {})).toHaveLength(0);
    expect(health?.outputSchema?.properties).toBeTruthy();
    expect(health?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });

    const reply = tools.find((t) => t.name === "draft_reply");
    expect(reply?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });

    const pricing = tools.find((t) => t.name === "get_pricing");
    expect(pricing?.title).toBe("Get price and trial terms");
    expect(Object.keys(pricing?.inputSchema?.properties ?? {})).toHaveLength(0);
    expect(pricing?.outputSchema?.properties).toBeTruthy();
    expect(pricing?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("x402 resource description stays under the CDP verify length cap", async () => {
    const session = await mcpInitialize();
    const { required } = await unpaidResearch(session);
    const resource = asRecord(required.resource);
    const desc = resource?.description;
    expect(typeof desc).toBe("string");
    expect(String(desc).length).toBeGreaterThan(20);
    expect(String(desc).length).toBeLessThanOrEqual(480);
    expect(BAZAAR_RESOURCE_DESC.length).toBeLessThanOrEqual(480);
    expect(BAZAAR_TOOL_DESC.length).toBeLessThanOrEqual(480);
    expect(resource?.url).toBe("https://mentionforge.test/mcp");
    expect(String(resource?.url)).not.toMatch(/^mcp:/);
    expect(resource?.serviceName).toBe("MentionForge");
    expect(resource?.iconUrl).toBe("https://mentionforge.test/logo-256x256.png");
    const bazaar = asRecord(asRecord(required.extensions)?.bazaar);
    const input = asRecord(asRecord(bazaar?.info)?.input);
    expect(input?.type).toBe("mcp");
    expect(input?.toolName).toBe("research_mentions");
    expect(input?.transport).toBe("streamable-http");
    expect(String(input?.description)).toMatch(/social listening/);
    expect(String(input?.description)).toMatch(/brand sentiment/);
    expect(String(input?.description)).not.toMatch(/0x[a-fA-F0-9]{40}/);
    expect(String(input?.description)).toMatch(/optional operator upgrades/);
  });

  it("paid research_mentions succeeds with _meta, header, or both, and settles once", async () => {
    const session = await mcpInitialize();
    const { accepts } = await unpaidResearch(session);
    const payment = stubPayment(accepts[0]);

    for (const mode of ["both", "meta", "header"] as const) {
      const stub = stubSourcesFetch();
      const paid = await paidResearch(session, payment, mode);
      expect(asPaymentRequired(paid.parsed)).toBeNull();
      expect(paid.result.isError).toBeFalsy();
      expect(contentText(paid.result)).not.toBe("Internal Server Error");
      const structured = asRecord(paid.result.structuredContent);
      expect(structured?.query).toBe("ForgeCo");
      expect(stub.settleCount).toBe(1);
      const settle = stub.settleBodies.join("\n");
      expect(settle).toContain("https://mentionforge.test/mcp");
      expect(settle).toContain("bazaar");
      expect(settle).toContain("research_mentions");
      expect(settle).not.toMatch(/mcp:\/\//);
    }
  });

  it("replays a paid MCP call from idempotency without a second settle", async () => {
    const session = await mcpInitialize();
    const { accepts } = await unpaidResearch(session);
    const payment = stubPayment(accepts[0]);
    const stub = stubSourcesFetch();
    const key = "11111111-1111-4111-8111-111111111111";
    const first = await paidResearch(session, payment, "both", key);
    expect(first.result.isError).toBeFalsy();
    expect(stub.settleCount).toBe(1);
    const second = await paidResearch(session, payment, "both", key);
    expect(asPaymentRequired(second.parsed)).toBeNull();
    expect(second.result.isError).toBeFalsy();
    expect(contentText(second.result)).not.toBe("Internal Server Error");
    expect(asRecord(second.result.structuredContent)?.query).toBe("ForgeCo");
    expect(stub.settleCount).toBe(1);
  });

  it("maps facilitator verify throws to payment-required instead of Internal Server Error", async () => {
    const session = await mcpInitialize();
    const { accepts } = await unpaidResearch(session);
    const stub = stubSourcesFetch({ failVerify: true });
    const paid = await paidResearch(session, stubPayment(accepts[0]), "both");
    expect(contentText(paid.result)).not.toBe("Internal Server Error");
    expect(asPaymentRequired(paid.parsed)).toBeTruthy();
    const body = (() => {
      try {
        return JSON.parse(contentText(paid.result)) as { error?: { code?: string; details?: { cause?: string } } };
      } catch {
        return null;
      }
    })();
    expect(body?.error?.code).not.toBe("INTERNAL_ERROR");
    expect(stub.settleCount).toBe(0);
  });

  it("does not settle when paid research fails with SOURCE_UNAVAILABLE", async () => {
    const session = await mcpInitialize();
    const { accepts } = await unpaidResearch(session);
    const stub = stubSourcesFetch({ failSources: true });
    const paid = await paidResearch(session, stubPayment(accepts[0]), "both");
    expect(paid.result.isError).toBe(true);
    const text = contentText(paid.result);
    expect(text).not.toBe("Internal Server Error");
    const body = JSON.parse(text) as { error?: { code?: string } };
    expect(body.error?.code).toBe("SOURCE_UNAVAILABLE");
    expect(stub.settleCount).toBe(0);
  });

  it("bazaarExtension includes info and schema; GET /.well-known/x402 exposes HTTP and MCP bazaar", async () => {
    const bazaar = asRecord(bazaarExtension.bazaar);
    const mcpInput = asRecord(asRecord(bazaar?.info)?.input);
    expect(mcpInput?.type).toBe("mcp");
    expect(mcpInput?.toolName).toBe("research_mentions");
    expect(mcpInput?.transport).toBe("streamable-http");
    expect(bazaar?.schema).toBeTruthy();
    expect(String(mcpInput?.description)).toMatch(/social listening/);

    const http = asRecord(bazaarHttpExtension.bazaar);
    const httpInput = asRecord(asRecord(http?.info)?.input);
    expect(httpInput?.type).toBe("http");
    expect(httpInput?.method).toBe("POST");
    expect(httpInput?.bodyType).toBe("json");
    expect(http?.schema).toBeTruthy();

    const app = createApp();
    const res = await app.fetch(
      new Request("https://mentionforge.test/.well-known/x402", { headers: { Accept: "application/json" } }),
      mockEnv(),
      executionCtx(),
    );
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      extensions?: { bazaar?: { info?: { input?: { type?: string; method?: string } } } };
      mcp_extensions?: { bazaar?: { info?: { input?: { type?: string; toolName?: string } } } };
      payment?: { resource?: { url?: string }; extensions?: { bazaar?: { info?: { input?: { type?: string } } } } };
      resources?: Array<{ url?: string; description?: string }>;
    };
    expect(doc.extensions?.bazaar?.info?.input?.type).toBe("http");
    expect(doc.extensions?.bazaar?.info?.input?.method).toBe("POST");
    expect(doc.mcp_extensions?.bazaar?.info?.input?.type).toBe("mcp");
    expect(doc.mcp_extensions?.bazaar?.info?.input?.toolName).toBe("research_mentions");
    expect(doc.payment?.resource?.url).toBe("https://mentionforge.test/v1/research");
    expect(doc.payment?.extensions?.bazaar?.info?.input?.type).toBe("http");
    expect(doc.resources?.some((r) => r.url === "https://mentionforge.test/v1/research")).toBe(true);
    expect(doc.resources?.some((r) => r.url === "https://mentionforge.test/mcp")).toBe(true);
    expect(doc.resources?.every((r) => String(r.description).includes("MentionForge"))).toBe(true);
  });
});
