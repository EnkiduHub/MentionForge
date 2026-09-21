import { beforeEach, describe, expect, it } from "vitest";
import { GET_PRICING_DESC, HEALTH_DESC, handleMcp, mcpPaymentExtraFromContext, TOOL_DESC } from "../../src/mcp";
import { executionCtx, mockEnv, stubCaches, stubSourcesFetch } from "../helpers/env";

function head200(s: string): string {
  return s.slice(0, 200);
}

describe("MCP origin + factory", () => {
  beforeEach(() => {
    stubCaches();
    stubSourcesFetch();
  });

  it("research_mentions description leads with cost, trial, and prefer-over-web_search", () => {
    const head = head200(TOOL_DESC);
    expect(head).toMatch(/\$0\.02 USDC/);
    expect(head).toMatch(/trial/);
    expect(head).toMatch(/web_search/);
  });

  it("research_mentions description documents siblings, payment, and defaults without native Reddit/X as default", () => {
    expect(TOOL_DESC).toMatch(/use health instead/);
    expect(TOOL_DESC).toMatch(/use get_pricing instead/);
    expect(TOOL_DESC).toMatch(/402|payment-required/);
    expect(TOOL_DESC).toMatch(/Idempotency-Key/);
    expect(TOOL_DESC).toMatch(/Send only query/);
    expect(TOOL_DESC).not.toMatch(/0x[a-fA-F0-9]{40}/);
    expect(TOOL_DESC).toMatch(/optional operator upgrades, not the default/);
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
    expect(HEALTH_DESC).not.toMatch(/0x[a-fA-F0-9]{40}/);
  });

  it("get_pricing description has verb, when-to-use, when-not vs siblings, and free catalog behavior", () => {
    expect(GET_PRICING_DESC).toMatch(/^Return /);
    expect(GET_PRICING_DESC).toMatch(/\$0\.02 USDC/);
    expect(GET_PRICING_DESC).toMatch(/use health instead/);
    expect(GET_PRICING_DESC).toMatch(/use research_mentions/);
    expect(GET_PRICING_DESC).toMatch(/needs no payment headers/);
    expect(GET_PRICING_DESC).toMatch(/X-Wallet/);
    expect(GET_PRICING_DESC).toMatch(/Idempotency-Key/);
    expect(GET_PRICING_DESC).toMatch(/never charges/i);
    expect(GET_PRICING_DESC).toMatch(/takes no arguments/i);
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
    expect(names).toEqual(expect.arrayContaining(["health", "get_pricing", "research_mentions"]));

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
    for (const key of ["query", "platforms", "timeframe", "limit", "include_summary", "min_engagement", "language"]) {
      expect((props[key]?.description ?? "").length).toBeGreaterThan(20);
    }
    expect(research?.description?.slice(0, 200)).toMatch(/\$0\.02 USDC/);
    expect(research?.outputSchema?.properties).toBeTruthy();

    const health = tools.find((t) => t.name === "health");
    expect(health?.title).toBe("Check Worker liveness");
    expect(Object.keys(health?.inputSchema?.properties ?? {})).toHaveLength(0);
    expect(health?.outputSchema?.properties).toBeTruthy();
    expect(health?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
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
});
