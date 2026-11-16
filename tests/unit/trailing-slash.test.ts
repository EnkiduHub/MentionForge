/**
 * Non-root GET/HEAD paths ending in "/" redirect 301 to the path without it (query kept), through
 * both the Hono app and the Worker entry point. API writes, `/mcp/`, and real routes are untouched.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createApp, trailingSlashRedirect } from "../../src/app";
import worker from "../../src/index";
import { executionCtx, mockEnv, stubCaches, stubSourcesFetch } from "../helpers/env";

const ORIGIN = "https://mentionforge.test";
const app = createApp();

/** ASSETS stub: the landing for "/" and "/index.html", 404 for everything else. */
function assetsEnv() {
  const requested: string[] = [];
  const env = mockEnv({
    ASSETS: {
      fetch: async (input: RequestInfo | URL) => {
        const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
        requested.push(path);
        return path === "/index.html"
          ? new Response("<!doctype html><title>MENTION//FORGE</title>", { status: 200, headers: { "content-type": "text/html" } })
          : new Response("not found", { status: 404 });
      },
    } as unknown as Env["ASSETS"],
  });
  return { env, requested };
}

async function viaWorker(path: string, init: RequestInit = {}) {
  const { env, requested } = assetsEnv();
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, init), env, executionCtx());
  return { res, requested };
}

describe("trailing-slash redirect", () => {
  beforeEach(() => {
    stubCaches();
    stubSourcesFetch();
  });

  it("GET /about/ is a 301 to /about, and /about itself is 200", async () => {
    const { res } = await viaWorker("/about/", { headers: { Accept: "text/html", "Sec-Fetch-Dest": "document" } });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/about");
    const target = await viaWorker("/about", { headers: { Accept: "text/html", "Sec-Fetch-Dest": "document" } });
    expect(target.res.status).toBe(200);
  });

  it("keeps the query string exactly as sent", async () => {
    const { res } = await viaWorker("/about/?utm_source=x&q=a%2Fb&empty=");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/about?utm_source=x&q=a%2Fb&empty=");
  });

  it("HEAD redirects too", async () => {
    const { res } = await viaWorker("/privacy/", { method: "HEAD" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/privacy");
  });

  it("removes every trailing slash in one hop", async () => {
    const { res } = await viaWorker("/terms///");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/terms");
  });

  it("GET API and discovery paths redirect to their real route, which then answers 200", async () => {
    for (const [path, location] of [
      ["/v1/research/example/", "/v1/research/example"],
      ["/v1/pricing/?x=1", "/v1/pricing?x=1"],
      ["/health/", "/health"],
      ["/.well-known/x402/", "/.well-known/x402"],
      ["/llms.txt/", "/llms.txt"],
    ] as const) {
      const res = await app.fetch(new Request(`${ORIGIN}${path}`), mockEnv(), executionCtx());
      expect(res.status, path).toBe(301);
      expect(res.headers.get("location"), path).toBe(location);
      const followed = await app.fetch(new Request(`${ORIGIN}${location}`), mockEnv(), executionCtx());
      expect(followed.status, location).toBe(200);
    }
  });

  it("the redirect keeps CORS, request id, and security headers so browser clients can follow it", async () => {
    const res = await app.fetch(
      new Request(`${ORIGIN}/v1/research/example/`, { headers: { Origin: "https://agent.example", "X-Request-Id": "rid-123" } }),
      mockEnv(),
      executionCtx(),
    );
    expect(res.status).toBe(301);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("x-request-id")).toBe("rid-123");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
  });

  it("never produces a protocol-relative (open) redirect", async () => {
    for (const path of ["//evil.example/", "///evil.example//", "/\\evil.example/"]) {
      const { res } = await viaWorker(path);
      const location = res.headers.get("location") ?? "";
      expect(res.status, path).toBe(301);
      expect(location, path).toMatch(/^\/[^/\\]/);
    }
    expect(trailingSlashRedirect("GET", `${ORIGIN}//evil.example/`)).toBe("/evil.example");
    expect(trailingSlashRedirect("GET", `${ORIGIN}//`)).toBe("/");
  });

  it("the root, slash-less paths, and the landing are untouched", async () => {
    const root = await viaWorker("/");
    expect(root.res.status).toBe(200);
    expect(root.res.headers.get("location")).toBeNull();
    expect(root.requested).toEqual(["/index.html"]);
    expect(trailingSlashRedirect("GET", `${ORIGIN}/`)).toBeNull();
    expect(trailingSlashRedirect("GET", `${ORIGIN}/?q=1`)).toBeNull();
    expect(trailingSlashRedirect("GET", `${ORIGIN}/about`)).toBeNull();
    expect(trailingSlashRedirect("GET", `${ORIGIN}/styles.css`)).toBeNull();
  });

  it("POST and other writes are never redirected (a 301 would turn them into GETs)", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      expect(trailingSlashRedirect(method, `${ORIGIN}/v1/research/`), method).toBeNull();
    }
    const { res } = await viaWorker("/v1/research/", {
      method: "POST",
      headers: { "content-type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: "Cloudflare Workers" }),
    });
    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("/mcp/ keeps its trailing slash: it goes to the MCP handler, never to a redirect", async () => {
    expect(trailingSlashRedirect("GET", `${ORIGIN}/mcp/`)).toBeNull();
    expect(trailingSlashRedirect("HEAD", `${ORIGIN}/mcp/`)).toBeNull();
    const appLevel = await app.fetch(new Request(`${ORIGIN}/mcp/`), mockEnv(), executionCtx());
    expect(appLevel.status).not.toBe(301);
    for (const method of ["GET", "POST"]) {
      const { res, requested } = await viaWorker("/mcp/", {
        method,
        headers: { Accept: "application/json, text/event-stream", "content-type": "application/json" },
        ...(method === "POST"
          ? { body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }) }
          : {}),
      });
      expect(res.status, method).not.toBe(301);
      expect(res.headers.get("location"), method).toBeNull();
      expect(requested, method).toEqual([]);
    }
  });

  it("no registered route ends in a slash, so the redirect can never shadow a real route", () => {
    const slashRoutes = createApp()
      .routes.filter((r) => r.path !== "/" && r.path !== "/*" && r.path !== "*" && r.path.endsWith("/"))
      .map((r) => `${r.method} ${r.path}`);
    expect(slashRoutes).toEqual([]);
  });
});
