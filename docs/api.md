# MentionForge REST API

Base URL is the Worker origin. Prefer **POST** `/v1/research` so payment headers are not stripped.

## Research

`POST /v1/research`

```json
{
  "query": "Cloudflare Workers",
  "platforms": ["reddit", "news", "web", "reviews", "x"],
  "timeframe": "7d",
  "limit": 20,
  "include_summary": true
}
```

Unknown keys are stripped. Do not send payment fields in the body. Omit `platforms` to use all five. Native Reddit OAuth and X recent-search are optional Worker secrets; without them those platforms degrade and news/web/reviews still complete the call.

Headers:

- `Idempotency-Key` — 8–128 chars. Same key + different body → `409 IDEMPOTENCY_CONFLICT`. Same key + same body → replay original billing (no second settle).
- `PAYMENT-SIGNATURE` — x402 v2 payload (Base64). Alias `X-PAYMENT`.
- `X-Wallet` — EVM address for the 10-call trial.
- `X-Sandbox-Key` — operator sandbox (timing-safe).

Response required keys: `query`, `timeframe`, `volume`, `sentiment`, `themes`, `mentions`, `citations`, `meta`. `summary` omitted only when `include_summary=false`.

`meta` conversion fields: `confidence`, `degraded`, `as_of`, `freshness` (`live` | `cached`), `next_queries` (≤3). **No `cache_hit`.** Billing is always for the current payer.

GET `/v1/research` is supported via query string. Docs tell agents to prefer POST.

## Free discovery

| Path | Notes |
| --- | --- |
| `GET /` | Landing (static assets, worker-first) |
| `GET/HEAD /health` | Liveness. `degraded` if `RECIPIENT_WALLET` / facilitator is missing. Public JSON includes `source_backends` (reddit `public`/`oauth`, x `web`/`api`). `?deep=1` is operator-only (D1 + live facilitator probe + `sources_configured`) |
| `GET /v1/research/example` | Free snapshot of a real **Cloudflare Workers** sandbox call |
| `GET /v1/pricing` | Exact micros + trial rules |
| `GET /stats` | `{ calls }` from D1 |
| `GET /openapi.json` | OpenAPI 3.1 + `x-logo` |
| `GET /llms.txt` | When to call this instead of web_search |
| `GET /llms-full.txt` | Full agent guide |
| `GET /.well-known/x402` | Resource URLs built from `request.url` origin |
| `GET /.well-known/mcp` | Streamable HTTP pointer |
| `GET /server-card.json` | MCP server card |
| `GET /v1/operator/stats` | Bearer `OPERATOR_TOKEN` (`401 UNAUTHORIZED` without it) |
| `GET /operator` | HTML dashboard (USDC earned from D1) |

## Errors

JSON `{ error: { code, message, recoverable, hint, details }, request_id }`.

`402 PAYMENT_REQUIRED` includes `error.hint` with amount `0.02 USDC`, CAIP-2 network, `payTo`, trial header, `Idempotency-Key` example, and a curl retry.

Limits (per colo): paid 120/60s, unpaid 20/60s, trial 10/60s, discovery 120/60s.
