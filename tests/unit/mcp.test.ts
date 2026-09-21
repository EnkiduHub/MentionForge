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

  it("research_mentions description documents siblings, payment, and open-world without native Reddit/X as default", () => {
    expect(TOOL_DESC).toMatch(/health/);
    expect(TOOL_DESC).toMatch(/get_pricing/);
    expect(TOOL_DESC).toMatch(/402|payment-required/);
    expect(TOOL_DESC).toMatch(/Idempotency-Key/);
    expect(TOOL_DESC).toMatch(/Read-only|read-only/);
    expect(TOOL_DESC).toMatch(/open-world/);
    expect(TOOL_DESC).toMatch(/not idempotent/i);
    expect(TOOL_DESC).not.toMatch(/0x[a-fA-F0-9]{40}/);
    expect(TOOL_DESC.toLowerCase()).not.toMatch(/native reddit and x are default/);
    expect(TOOL_DESC).toMatch(/unless the operator enabled native APIs/);
  });

  it("health description has verb, when-to-use, when-not vs siblings, and free/read-only behavior", () => {
    expect(HEALTH_DESC).toMatch(/^Check /);
    expect(HEALTH_DESC).toMatch(/get_pricing/);
    expect(HEALTH_DESC).toMatch(/research_mentions/);
    expect(HEALTH_DESC).toMatch(/free/i);
    expect(HEALTH_DESC).toMatch(/read-only/);
    expect(HEALTH_DESC).toMatch(/Never charges/);
    expect(HEALTH_DESC).toMatch(/Not open-world/);
    expect(HEALTH_DESC).not.toMatch(/0x[a-fA-F0-9]{40}/);
  });

  it("get_pricing description has verb, when-to-use, when-not vs siblings, and free catalog behavior", () => {
    expect(GET_PRICING_DESC).toMatch(/^Return /);
    expect(GET_PRICING_DESC).toMatch(/\$0\.02 USDC/);
    expect(GET_PRICING_DESC).toMatch(/health/);
    expect(GET_PRICING_DESC).toMatch(/research_mentions/);
    expect(GET_PRICING_DESC).toMatch(/X-Wallet/);
    expect(GET_PRICING_DESC).toMatch(/Idempotency-Key/);
    expect(GET_PRICING_DESC).toMatch(/Never charges/);
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
});
