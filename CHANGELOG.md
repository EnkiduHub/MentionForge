# Changelog

## 1.2.2 — 2026-09-21

- Glama TDQS: front-load rate limits in the paid-tool tail (`get_digest` Behavior was 4 for missing limits) and mark compare's vs-join as a cross-field rule the schema cannot encode
- Keep purpose-first copy and optional free-tool flags from 1.2.1 so the next connector sweep can score Parameters and Conciseness above the stale 10-tool snapshot
- Official MCP Registry: publish `server.json` `1.2.2` (was left at `1.1.0` after the Worker bumps). GitHub Actions OIDC republishes on this file change. Glama GitHub-listing Available Tools still need Deploy + Make Release — Sync Server only refreshes the README scrape
- Glama Dockerfile: `WORKDIR /app` + relative `CMD ["node", "scripts/glama-stdio.mjs"]` so a generated clone-into-`/app` inspect does not look for `/home/node/glama-stdio.mjs` and keep the v1.0.0 three-tool snapshot
- Price remains $0.02 USDC; the 10-call trial stays shared

## Unreleased

- Public `GET /stats` is successful product usage only: `{ calls, paid, trial }` with `calls` = paid + trial. Validation, rate limits, and other non-completions no longer increment `calls`. Operator ledger still includes raw `calls`, paid, trial, USDC, and errors. No D1 migration; redeploy the Worker after merge
- CDP Bazaar discovery: REST POST `/v1/research` advertises type `http` bazaar metadata; MCP `research_mentions` stays type `mcp` / `streamable-http`. Settle re-attaches absolute `https://` `paymentPayload.resource` + bazaar extensions (verify still strips extensions). Unpaid GET/empty POST `/v1/research` return 402 before body validation so CDP probes can index. Search keywords stay honest (no native Reddit/X as default).
- Paid MCP `research_mentions`: official Bazaar `{ info, schema }` extensions, AgentError `isError` (never opaque Internal Server Error), no settle on research failure
- Paid MCP verify: facilitator / matching throws map to payment-required (REST parity) instead of wrapper ISE; facilitator verify is called without client-echoed bazaar extensions; MCP x402 `resource.description` uses the Bazaar search blurb so CDP `/verify` is not rejected for a >500-char tool description; paid MCP replays `Idempotency-Key` hits before verify; `INTERNAL_ERROR` includes `details.cause` (`x402_wrapper` / `output_schema` / `uncaught`)
- Smithery directory link is the non-`@` listing `https://smithery.ai/servers/enkiduhub/mentionforge`
- Glama GitHub listing: `glama.json` maintainers plus a stdio `Dockerfile` (`CMD`, not `ENTRYPOINT`) and `package.json` `bin`/`start` that bridge to the hosted `/mcp` via `mcp-remote` (no Worker clone). Glama env schema stays empty — `RECIPIENT_WALLET` is Worker `payTo`, not a container var; Glama users still settle on the hosted origin
- README includes Glama score + card badges (`EnkiduHub/MentionForge` listing URLs); License section is the MIT grant (copyright 2026 MentionForge) plus trademarks from TRADEMARK.md; surfaces list MCP `get_health` / `get_pricing` and discovery routes
- Agent discoverability: rich MCP server card, Cursor/Claude install in `/llms.txt`, public `GET /skill.md`, forge-mark PNG OG/logo/favicon

## 1.2.1 — 2026-09-21

- Glama TDQS: move cross-field parameter interactions ahead of the payment tail so Parameter Semantics can score beyond schema restatement
- Add honest optional flags on free tools (`get_health.include_backends`, `get_pricing.include_catalog`, `get_example.view`) so those definitions are no longer zero-argument
- Price remains $0.02 USDC; the 10-call trial stays shared; REST `GET /health`, `GET /v1/pricing`, and `GET /v1/research/example` stay full payloads

## 1.2.0 — 2026-09-21

- Glama TDQS: rename MCP `health` → `get_health` and `entity_profile` → `get_entity_profile` (REST `GET /health` and `GET /v1/entity` unchanged)
- Add paid `list_mentions` / `get_trends` (REST `POST /v1/mentions`, `POST /v1/trends`) so the tool set covers mention export and trend-over-time without overlapping the full brief
- Rewrite every MCP tool description: purpose first, sibling when-not, payment/rate-limit behavior, and parameter interactions beyond the schema
- Price remains $0.02 USDC; the 10-call trial stays shared; do not re-run `PAY_ONCE` for the new lenses

## 1.1.0 — 2026-09-21

- Agent-routed tools: free `get_example`, `suggest_tool`, `entity_profile`; paid `compare_brands`, `get_digest`, `detect_risk`, `draft_reply` (same $0.02 USDC, 10 trial calls shared)
- Engine: multi-brand vs queries (competitor mentions kept in fusion), share of voice, intent/aspects, signals, compact/markdown overlays, Reddit Brave site-only fallback, query-gated GitHub/Stack Overflow
- Landing SSR sentiment/SOV bars and JS volume sparkline; operator 30-day sparkline from D1 `days`

## 1.0.0 — 2026-09-17

- Initial MentionForge Worker: Hono REST + `createMcpHandler`, x402 $0.02 USDC
- Research-only Cache API, D1 trial/idempotency/stats, Analytics Engine writes
- Landing, OpenAPI 3.1, MCP tools/resources/prompts, live Cloudflare Workers snapshot at `/v1/research/example`
