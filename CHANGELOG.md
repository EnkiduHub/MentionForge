# Changelog

## Unreleased

- Paid MCP `research_mentions`: official Bazaar `{ info, schema }` extensions, AgentError `isError` (never opaque Internal Server Error), no settle on research failure
- Paid MCP verify: facilitator / matching throws map to payment-required (REST parity) instead of wrapper ISE; facilitator verify is called without client-echoed bazaar extensions; MCP x402 `resource.description` uses VALUE_PROP so CDP `/verify` is not rejected for a >500-char tool description; paid MCP replays `Idempotency-Key` hits before verify; `INTERNAL_ERROR` includes `details.cause` (`x402_wrapper` / `output_schema` / `uncaught`)
- Smithery directory link is the non-`@` listing `https://smithery.ai/servers/enkiduhub/mentionforge`
- Glama GitHub listing: `glama.json` maintainers plus a stdio `Dockerfile` (`CMD`, not `ENTRYPOINT`) and `package.json` `bin`/`start` that bridge to the hosted `/mcp` via `mcp-remote` (no Worker clone)
- README includes Glama score + card badges (`EnkiduHub/MentionForge` listing URLs)
- Agent discoverability: rich MCP server card, Cursor/Claude install in `/llms.txt`, public `GET /skill.md`, forge-mark PNG OG/logo/favicon

## 1.0.0 — 2026-09-17

- Initial MentionForge Worker: Hono REST + `createMcpHandler`, x402 $0.02 USDC
- Research-only Cache API, D1 trial/idempotency/stats, Analytics Engine writes
- Landing, OpenAPI 3.1, MCP tools/resources/prompts, live Cloudflare Workers snapshot at `/v1/research/example`
