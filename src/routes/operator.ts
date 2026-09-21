import { Hono } from "hono";
import { operatorOk } from "../lib/trial";
import { operatorStats } from "../lib/analytics";
import { AgentError } from "../schemas/errors";
import { BRAND } from "../brand/tokens";
import { BRAND_ASSETS } from "../lib/brand-assets";
import { escapeHtml } from "../lib/html";
import { htmlSecurityHeaders } from "../lib/security-headers";

export const operatorRoutes = new Hono<{ Bindings: Env }>();

function gate(c: { env: Env; req: { header: (n: string) => string | undefined }; get: (k: string) => unknown }) {
  if (!operatorOk(c.env, c.req.header("Authorization") ?? null)) {
    throw new AgentError("UNAUTHORIZED", "Operator token required.", {
      request_id: String(c.get("requestId") ?? "unknown"),
      hint: "Authorization: Bearer <OPERATOR_TOKEN>",
    });
  }
}

operatorRoutes.get("/v1/operator/stats", async (c) => {
  gate(c);
  return c.json(await operatorStats(c.env), 200, { "Cache-Control": "no-store" });
});

operatorRoutes.get("/operator", async (c) => {
  gate(c);
  const s = await operatorStats(c.env);
  const usdc = (s.totals.usdc_micros / 1_000_000).toFixed(2);
  const days = [...(s.days ?? [])].reverse();
  const max = Math.max(1, ...days.map((d) => d.calls));
  const sparkPts = days
    .map((d, i) => {
      const x = days.length <= 1 ? 0 : (i / (days.length - 1)) * 240;
      const y = 54 - (d.calls / max) * 48;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const spark = days.length
    ? `<div class="op-spark"><svg viewBox="0 0 240 64" role="img" aria-label="30-day call sparkline"><polyline fill="none" stroke="currentColor" stroke-width="2" points="${sparkPts}"/></svg></div>`
    : "";
  const asOf = escapeHtml(s.as_of);
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="color-scheme" content="dark"/>
  <title>MentionForge operator</title>
  <link rel="icon" href="${BRAND_ASSETS.favicon}" type="image/png" sizes="128x128"/>
  <link rel="stylesheet" href="/styles.css"/>
</head>
<body>
  <a class="skip" href="#main">Skip to dashboard</a>
  <div class="aurora" aria-hidden="true"></div>
  <div class="wrap">
    <header class="top">
      <p class="eyebrow">${escapeHtml(BRAND.wordmark)}</p>
      <nav aria-label="Operator">
        <a href="/">Public</a>
        <a href="/v1/operator/stats">Stats JSON</a>
        <a href="/health">Health</a>
      </nav>
    </header>
    <header class="hero hero-compact">
      <div>
        <h1 id="main">Operator ledger</h1>
        <p class="lede">D1 totals for this deployment. Analytics Engine is write-only and is not queried here.</p>
      </div>
      <div class="mark-wrap">
        <img class="mark mark-sm" src="${BRAND_ASSETS.chrome}" width="96" height="96" alt=""/>
      </div>
    </header>
    <section class="grid" aria-label="Totals">
      <article class="card"><h2>Calls</h2><p class="stat">${s.totals.calls}</p></article>
      <article class="card"><h2>Paid</h2><p class="stat">${s.totals.paid}</p></article>
      <article class="card"><h2>USDC</h2><p class="stat">${escapeHtml(usdc)}</p></article>
      <article class="card"><h2>Trial</h2><p class="stat">${s.totals.trial}</p></article>
      <article class="card"><h2>Errors</h2><p class="stat">${s.totals.errors}</p></article>
    </section>
    ${spark}
    <p class="muted">as_of ${asOf}</p>
  </div>
</body>
</html>`;
  return c.html(html, 200, { "Cache-Control": "no-store", ...htmlSecurityHeaders() });
});
