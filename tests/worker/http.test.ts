import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";

describe("worker fetch", () => {
  it("HEAD /health is 200", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://example.com/health", { method: "HEAD" }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
  });

  it("landing is HTML", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://example.com/"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/html/);
  });

  it("example is unpaid 200", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://example.com/v1/research/example"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
  });
});
