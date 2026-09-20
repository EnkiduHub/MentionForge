import { createApp } from "./app";
import { handleMcp } from "./mcp";
import { AgentError } from "./schemas/errors";
import { paymentRequiredHttp } from "./lib/research-handler";
import { logRequest } from "./lib/logger";
import { applySecurityHeaders, assetKind } from "./lib/security-headers";
import { absolutizePublicHtml } from "./lib/html";
import { hydrateLandingHtml } from "./lib/landing";
import { publicCallCount } from "./lib/analytics";

const app = createApp();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
      try {
        const mcp = await handleMcp(request, env, ctx);
        return applySecurityHeaders(mcp, "asset");
      } catch (err) {
        if (err instanceof AgentError && err.code === "PAYMENT_REQUIRED") {
          return applySecurityHeaders(paymentRequiredHttp(env, url.origin, err), "asset");
        }
        logRequest({ msg: "mcp_fail", err: String(err) });
        const body = new AgentError("INTERNAL_ERROR", "MCP handler failed.", {
          request_id: crypto.randomUUID(),
        }).body();
        return applySecurityHeaders(
          new Response(JSON.stringify(body), {
            status: 500,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "no-store",
            },
          }),
          "asset",
        );
      }
    }
    const res = await app.fetch(request, env, ctx);
    if (res.status !== 404) return res;
    if (env.ASSETS) {
      // html_handling is none so `/` does not auto-map to index.html; keep API 404s as JSON.
      const assetRequest =
        url.pathname === "/" || url.pathname === ""
          ? new Request(new URL("/index.html", url.origin), request)
          : request;
      const asset = await env.ASSETS.fetch(assetRequest);
      if (asset.status !== 404) {
        const kind = assetKind(url.pathname, asset.headers.get("content-type"));
        if (kind === "html") {
          const html = await asset.text();
          const landing =
            url.pathname === "/" || url.pathname === "" || url.pathname === "/index.html";
          const calls = landing ? await publicCallCount(env) : 0;
          const page = hydrateLandingHtml(absolutizePublicHtml(html, url.origin), env, calls);
          const rewritten = new Response(page, {
            status: asset.status,
            statusText: asset.statusText,
            headers: asset.headers,
          });
          return applySecurityHeaders(rewritten, "html");
        }
        if (/\.(?:js|css)$/i.test(url.pathname)) {
          const headers = new Headers(asset.headers);
          headers.set("Cache-Control", "public, max-age=60, must-revalidate");
          return applySecurityHeaders(new Response(asset.body, { status: asset.status, headers }), kind);
        }
        return applySecurityHeaders(asset, kind);
      }
    }
    return res;
  },
} satisfies ExportedHandler<Env>;
