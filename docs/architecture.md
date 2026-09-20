# Architecture

Cloudflare Worker. `compatibility_date` `2026-09-17`, `nodejs_compat`.

- Hono REST + `createMcpHandler` factory
- D1: `trial_wallets`, `idempotency`, `stats_daily`
- Analytics Engine `METRICS` is **write-only** in the Worker. Operator dashboards read D1.
- Cache API GET keys hold **research-only** JSON + SWR. Billing is overlaid per request.
- Static assets: `run_worker_first: true`, `not_found_handling: none`. `/mcp` and `/v1` never fall through to `index.html` first.
- Fetch pool max 5, 2500 ms per-source abort (800 ms for unauthenticated Reddit), 8000 ms engine budget, in-flight coalesce, GDELT ~1/5s via Cache flag. Cache API is a no-op on `*.workers.dev` until a custom domain is attached.
- Web = Wikipedia + Wikidata + optional Brave (`BRAVE_API_KEY`). DDG Instant Answer is not treated as web search. Mark `degraded` when Brave is absent.
- Reddit OAuth (`REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET`) and X recent-search (`X_BEARER_TOKEN`) are optional. Without them the adapters still run (public Reddit JSON with a short abort / web `site:x.com`) and the engine succeeds on news + web + reviews. Those keys are not required for agents to use REST or MCP.
- Upstream `fetch` uses `redirect: "manual"` and re-allowlists each `Location` (max 3 hops) so an open redirect cannot SSRF off the host allowlist.
- SSRF allowlist only; mention URLs are never fetched
- Workers AI summary polish is optional (<250 ms)

Paid REST order: CORS (incl. 402, `maxAge` 86400) → request id → rate limit → 8 KB cap → Zod `.strip()` → idempotency 409/replay → trial CAS or x402 verify → engine → this-request billing → settle on 2xx → D1 idempotency upsert → `waitUntil` D1 `stats_daily` + AE point.

Workers Paid ($5/mo) before production CPU volume. Free is enough for current traffic. Production settles Base USDC via the CDP facilitator; staging remains Base Sepolia / x402.org.
