# Changelog

## Unreleased

- Docs: `examples/README.md` lists MCP resource URIs (`mentionforge://pricing`, `openapi`, `example`, `skill`); unit test fails when README, `docs/mcp.md`, or that examples index omit a registered `server.registerResource` URI (MF-D1029).
- Docs: `examples/README.md` lists POST-only `/v1/mentions` and `/v1/trends` with the other paid lenses; unit test fails when README, `docs/mcp.md`, or that examples index omit a registered MCP prompt or those REST paths (MF-D1028).
- Support page: static/fallback contact is `harbor-ops@mail.grokbot.com`; `GET /support` is noindex (`X-Robots-Tag` and robots meta) and is not listed in `/sitemap.xml`.
- Fix: `upsertKeyFromSubscription` now `COALESCE`s `checkout_session_id` on an existing subscription row so `invoice.paid` / `customer.subscription.updated` arriving before `checkout.session.completed` (or claim self-heal) no longer leave claim lookup stuck on `NOT_FOUND`.
- Key plan post-purchase path: `GET /v1/keys/claim` validates the Checkout session without burning the key and renders an HTML confirmation form (`POST /v1/keys/claim`, `Cache-Control: no-store`, `X-Robots-Tag: noindex`, `public/claim.js`) when `Accept` prefers `text/html`; `POST /v1/keys/claim` performs the one-time reveal (HTML page with Copy button, warning notice, curl/MCP how-to, quota, `/v1/keys/me`, `/v1/keys/portal`, and `/support`, or JSON `{plan,key,prefix}`). `claimKey` self-heals via `upsertKeyFromSubscription` when the Checkout redirect lands before the webhook. Added `GET /v1/keys/me` (usage/period ledger), `POST /v1/keys/portal` (Stripe Billing Portal session with `503 PORTAL_UNAVAILABLE` fallback), `/support` HTML page + optional `SUPPORT_EMAIL` var, `past_due` grace until `period_end`, and actionable hints on `PAYMENT_REQUIRED`, `PLAN_QUOTA_REACHED`, and `KEY_ALREADY_CLAIMED`.
- Site: wrap landing content in `<main id="main">`, demote nested `Public volume` stat headings to `<h3>`, and add a plain-language 3-step `How it works` section with worked costs and plain definitions of `x402` and `USDC on Base`.
- Site: add static `/privacy`, `/terms`, and `/about` HTML pages derived from Worker code, linked in the footer and `/sitemap.xml`, and set `Cache-Control: public, max-age=31536000, immutable` on `/logo-440w.webp`.
- Docs: README Hosted product vs this repo lists POST-only `/v1/mentions` and `/v1/trends` with the other paid lenses (MF-D1024).
- Stripe Key plan: $29/mo (`STRIPE_KEY_PRICE_ID`), 1,500 calls per billing period, hard stop `PLAN_QUOTA_REACHED` (HTTP 429, not counted). `Authorization: Bearer mfk_...` / `X-Api-Key` skips x402 and trial. Plan quota is reserved before work; the global X_ID cap (1,500,000 IDs / 30 days) still applies. Either cap denies with nothing charged; an X_ID denial releases the plan reservation. 1,500 × 50 IDs = 75,000 IDs per key-month (5% of the global cap). Webhook `POST /v1/stripe/webhook` and one-time `GET /v1/keys/claim`.
- Docs: README Official MCP Registry badge and Listed on links use the same `/v0.1/servers` search URL as `DIRECTORY_LINKS.official_registry` (MF-D1023).
- Dev toolchain: vitest 4.1.x, `@cloudflare/vitest-plugin` (pool-workers successor), wrangler 4.152.x; weekly Dependabot for npm and GitHub Actions (MF-B07).
- Docs: point `docs/README.md`, `listings/README.md`, and the README Glama listing URL at Worker version `1.2.2` (MF-D1022).
- Landing: one schema.org SoftwareApplication JSON-LD block in the public HTML (MF-23).
- Docs: `docs/use-cases.md` — five MCP jobs mapped to one real tool or prompt each (MF-21).
- Docs: README FAQ for free trial, x402 price, payment headers, and live source backends (MF-19).
- Added `examples/free-tour.sh`: zero-wallet tour of five free routes (MF-18).
- Docs: README `Listed on` section linking Glama, Smithery, Official MCP Registry and CDP x402 Bazaar (MF-24).
- Paid calls check the rolling plan quota before a trial is consumed and before x402 settle. A usage or idempotency ledger read error is HTTP 503 and does not settle. `POST /v1/risk` counts each returned negative id. Replays of the same Idempotency-Key return the stored body and are not charged or counted again.
- Unit test fails when `GET /server-card.json` or `GET /llms.txt` omit a registered MCP tool name
- Add `smithery.yaml` so Smithery can rescan the hosted Streamable HTTP MCP at `https://mentionforge.mentionforge.workers.dev/mcp` (`target: remote`, empty `configSchema`).
- Google News rows no longer repeat the headline when the RSS description is HTML that echoes the title (including a trailing ` - Source`). Publisher name/domain from `<source url>` is stored separately. Citations use a publisher article URL when the feed includes one, otherwise keep the Google link, and label with the headline (falling back to the `<source url>` domain, source name, or link when the title is empty). Mention `author` is the publisher name. The gnews fetch follows at most 3 hops with `redirect: "manual"` and will not request any host other than `news.google.com` / `consent.google.com`.
- Google News RSS fetch uses `hl=en-US&gl=US&ceid=US:en` with a browser User-Agent and `Accept: application/rss+xml`, and retries the original URL with a `CONSENT` cookie when Google sends `consent.google.com`. XML parsing accepts CDATA and entities. Non-200 / parse failures log status, final host, content-type, and a 120-char snippet (no secrets).
- Restore Google News RSS (default on), Hacker News Algolia, and richer news output: HN / GDELT / Google News rows include title plus a short snippet; citation labels are headlines again. `DISABLED_SOURCES` is `x,reddit` in all wrangler blocks (X and Reddit stay off until native API keys exist). `news.google.com` and `hn.algolia.com` are back on the outbound allowlist. `purge:forbidden` no longer treats Google News or HN hosts as hits. Brave web results and Trustpilot review targeting stay on.
- CDP Bazaar discovery copy: `resource.description` leads with brand monitoring and brand sentiment analysis; tag `MCP` replaced with `brand monitoring`. Descriptions stay ≤480 characters and do not claim a native Reddit or X feed.
- Public `GET /stats` is successful product usage only: `{ calls, paid, trial }` with `calls` = paid + trial. Validation, rate limits, and other non-completions no longer increment `calls`. Operator ledger still includes raw `calls`, paid, trial, USDC, and errors. No D1 migration; redeploy the Worker after merge
- CDP Bazaar keyword discovery: `resource.description` leads with brand sentiment and social listening, tags include `research_mentions`, and POST `/v1/research_mentions` is the same $0.02 research call whose resource URL contains that tool name. POST `/v1/research` stays the existing HTTP catalog row. Descriptions stay ≤480 characters and do not claim a native Reddit or X feed.
- CDP Bazaar discovery: REST POST `/v1/research` advertises type `http` bazaar metadata; MCP `research_mentions` stays type `mcp` / `streamable-http`. Settle re-attaches absolute `https://` `paymentPayload.resource` + bazaar extensions (verify still strips extensions). Unpaid GET/empty POST `/v1/research` return 402 before body validation so CDP probes can index. Search keywords stay honest (no native Reddit/X as default).
- Paid MCP `research_mentions`: official Bazaar `{ info, schema }` extensions, AgentError `isError` (never opaque Internal Server Error), no settle on research failure
- Paid MCP verify: facilitator / matching throws map to payment-required (REST parity) instead of wrapper ISE; facilitator verify is called without client-echoed bazaar extensions; MCP x402 `resource.description` uses the Bazaar search blurb so CDP `/verify` is not rejected for a >500-char tool description; paid MCP replays `Idempotency-Key` hits before verify; `INTERNAL_ERROR` includes `details.cause` (`x402_wrapper` / `output_schema` / `uncaught`)
- Smithery directory link is the non-`@` listing `https://smithery.ai/servers/enkiduhub/mentionforge`
- Glama GitHub listing: `glama.json` maintainers plus a stdio `Dockerfile` (`CMD`, not `ENTRYPOINT`) and `package.json` `bin`/`start` that bridge to the hosted `/mcp` via `mcp-remote` (no Worker clone). Glama env schema stays empty — `RECIPIENT_WALLET` is Worker `payTo`, not a container var; Glama users still settle on the hosted origin
- README includes Glama score + card badges (`EnkiduHub/MentionForge` listing URLs); License section is the MIT grant (copyright 2026 MentionForge) plus trademarks from TRADEMARK.md; surfaces list MCP `get_health` / `get_pricing` and discovery routes
- Agent discoverability: rich MCP server card, Cursor/Claude install in `/llms.txt`, public `GET /skill.md`, forge-mark PNG OG/logo/favicon

## 1.2.2 — 2026-09-21

- Glama TDQS: front-load rate limits in the paid-tool tail (`get_digest` Behavior was 4 for missing limits) and mark compare's vs-join as a cross-field rule the schema cannot encode
- Keep purpose-first copy and optional free-tool flags from 1.2.1 so the next connector sweep can score Parameters and Conciseness above the stale 10-tool snapshot
- Official MCP Registry: publish `server.json` `1.2.2` (was left at `1.1.0` after the Worker bumps). GitHub Actions OIDC republishes on this file change. Glama GitHub-listing Available Tools still need Deploy + Make Release — Sync Server only refreshes the README scrape
- Glama Dockerfile: `WORKDIR /app` + relative `CMD ["node", "scripts/glama-stdio.mjs"]` so a generated clone-into-`/app` inspect does not look for `/home/node/glama-stdio.mjs` and keep the v1.0.0 three-tool snapshot
- Price remains $0.02 USDC; the 10-call trial stays shared

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
