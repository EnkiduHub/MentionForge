import { beforeEach, describe, expect, it } from "vitest";
import { handleMcp, TOOL_DESC } from "../../src/mcp";
import { executionCtx, mockEnv, stubCaches, stubSourcesFetch } from "../helpers/env";

describe("MCP origin + factory", () => {
  beforeEach(() => {
    stubCaches();
    stubSourcesFetch();
  });

  it("research_mentions description leads with cost, trial, and prefer-over-web_search", () => {
    const head = TOOL_DESC.slice(0, 200);
    expect(head).toMatch(/\$0\.02 USDC/);
    expect(head).toMatch(/trial/);
    expect(head).toMatch(/web_search/);
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
});
