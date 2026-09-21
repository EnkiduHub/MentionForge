# MCP

Transport: **Streamable HTTP** at `POST /mcp`. Stateless per-request factory via `createMcpHandler` from `agents/mcp/server`. No `McpAgent`, no MCP Durable Objects, no `/sse` unless a client forces it.

## Tools

### `research_mentions`

Purpose is front-loaded (verb + resource). The first 200 characters still include **$0.02 USDC**, **10 free trial calls**, and **prefer over web_search for brand sentiment**. Cross-field parameter interactions (what the input schema cannot encode) come next, then when-to-use / when-not vs `get_health` / `get_pricing` / sibling lenses (`use … instead`), then trial headers, `Idempotency-Key`, 402/x402 retry, and rate limits. Native Reddit/X APIs are optional upgrades. Return shape lives on `outputSchema` (TDQS does not want it repeated in prose).

- `title`: Research social mentions
- `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: true`, `idempotentHint: false`
- `inputSchema` — Zod request (`.strip()`) with `.describe()` on every field
- `outputSchema` — research response with `.describe()` on key fields
- Result = `structuredContent` + compact JSON `text`

Trial / sandbox: unwrapped tool (no x402 settle). Paid: `@x402/mcp` `createPaymentWrapper` — verify → research/persist (`executeUnpaidOrPreVerified`, which also bumps `/stats`) → settle → `onAfterSettlement` patches `tx_hash` and stores idempotency again. **One** resource-server `initialize()` per MCP request; all paid tools share it. Bazaar `{ info, schema }` is attached **only** so a successful CDP settle can index `research_mentions`. `resource.url` is `${origin}/mcp` (absolute HTTPS). `resource.description` is the short Bazaar search blurb (CDP `/verify` cap ~500 chars); `TOOL_DESC` remains the MCP tool description. `research_mentions` idempotency hash stays `canonicalJson(researchRequest)` (no `tool` prefix). Specialized paid tools prefix `tool` in their hash and parse their own output Zod schema. MCP SDK v2 delivers request `_meta` on `ctx.mcpReq._meta`; the Worker also merges `ctx._meta` and `PAYMENT-SIGNATURE` / `X-PAYMENT` from the HTTP request onto the wrapper's `extra._meta`.

Tool failures return `{ isError: true }` with `AgentError` JSON in `content` (same shape as REST `AgentError.body()`). The wrapper skips settle when `isError` is set. Resource-server `verifyPayment` catches facilitator throws and returns `{ isValid: false }` so MCP clients see payment-required (REST parity) instead of ISE. If `@x402/mcp` still returns opaque text `Internal Server Error` (throw outside the engine), the Worker rewrites it to `INTERNAL_ERROR` with `details.cause: "x402_wrapper"` and logs `mcp_paid_wrapper_ise`.

Clients send `_meta["x402/payment"]` as the **payload object** (not REST base64). `PAYMENT-SIGNATURE` on the MCP POST is also accepted.

### `get_health`

Free liveness. Optional `include_backends` (default true) keeps `source_backends`; set false to omit that object. `{}` is valid. Use when you only need uptime; for price use `get_pricing` instead; for mentions use `research_mentions`. Never charges, no payment headers. `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`, `idempotentHint: true`. REST `GET /health` is unchanged and always includes backends.

### `get_pricing`

Free catalog ($0.02 USDC, trial headers, CAIP-2 network). Keep `tool: "research_mentions"`; additive `tools[]` / `endpoints[]` unless `include_catalog` is false. `{}` is valid. Use when you need list price or trial terms; for liveness use `get_health` instead; for mentions use `research_mentions`. Never charges. Same annotation pattern as `get_health`. `Idempotency-Key` is required on paid tools, not on this catalog. REST `GET /v1/pricing` stays the full catalog.

### Free routers

`get_example` (`view` full or compact), `suggest_tool`, `get_entity_profile` never charge. `suggest_tool` unknown need → `research_mentions`. The 10-call trial is shared across paid tools; call exactly one paid tool per question. REST `GET /v1/research/example` stays the full fixture.

### Paid lenses

`compare_brands`, `get_digest`, `detect_risk`, `draft_reply`, `list_mentions`, `get_trends` — same $0.02 USDC and trial as `research_mentions`. MCP `resource.url` stays `${origin}/mcp`. REST 402 `resource.url` stays `/v1/research`. Bazaar `{ info, schema }` on `research_mentions` (type `mcp`) and on REST POST `/v1/research` (type `http`). Specialized tools parse their own output Zod schema. `draft_reply` never posts and never fetches mention URLs. Do not re-run `PAY_ONCE` for specialty tools.

## Resources

- `mentionforge://pricing`
- `mentionforge://openapi`
- `mentionforge://example`
- `mentionforge://skill`

## Prompts

- `competitor_brief` — call `compare_brands`
- `crisis_watch` — call `detect_risk`
- `review_digest` / `pain_mining` — call `get_digest`
- `mention_export` — call `list_mentions`
- `trend_watch` — call `get_trends`

## Origin

Malformed Origin is rejected (`403`). `createMcpHandler` `allowedOriginHostnames` is set from `ALLOWED_ORIGINS`.

## Client config

```json
{
  "mcpServers": {
    "mentionforge": {
      "url": "https://mentionforge.mentionforge.workers.dev/mcp"
    }
  }
}
```

Payment meta: `_meta["x402/payment"]` in, `_meta["x402/payment-response"]` out.

The repo `Dockerfile` is a Glama stdio bridge to `https://mentionforge.mentionforge.workers.dev/mcp` (`scripts/glama-stdio.mjs` → `mcp-remote --transport http-only`). Use `WORKDIR /app` and `CMD ["node", "scripts/glama-stdio.mjs"]`, not `ENTRYPOINT` and not `/home/node/glama-stdio.mjs`, so Glama’s generated clone-into-`/app` image and `mcp-proxy` wrap resolve the same path. `package.json` `bin`/`start` are the same bridge so Glama does not infer `wrangler`. It is not a second Worker and must not list `RECIPIENT_WALLET` as a container env var — that address is a Wrangler `vars` value on the hosted origin, which is where x402 `payTo` is advertised. `get_health` / `get_pricing` stay free; paid tools still settle on the hosted origin (`research_mentions` and the specialty lenses share the same `/mcp` x402 resource). Admin form values live in [listings/glama.md](../listings/glama.md).
