# MCP

Transport: **Streamable HTTP** at `POST /mcp`. Stateless per-request factory via `createMcpHandler` from `agents/mcp/server`. No `McpAgent`, no MCP Durable Objects, no `/sse` unless a client forces it.

## Protocol versions

`initialize` accepts supported 2025-era protocol versions, including `2025-03-26` and `2025-06-18`. A 2025-era `POST /mcp` that copies a supported legacy version (including `2025-06-18`) into `params._meta["io.modelcontextprotocol/protocolVersion"]` is served on the legacy lane instead of being rejected as an unsupported modern revision. An unsupported version, or a modern `MCP-Protocol-Version` header paired with a legacy claim, returns JSON-RPC `-32022`. Browser CORS preflight allows `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name`.

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

`compare_brands`, `get_digest`, `detect_risk`, `draft_reply`, `list_mentions`, `get_trends` — same $0.02 USDC and trial as `research_mentions`. MCP `resource.url` stays `${origin}/mcp`. REST 402 `resource.url` for `/v1/research` stays that path. POST `/v1/research_mentions` is the same research body with its own `resource.url` so CDP's URL-substring fallback can match the tool name. Bazaar `{ info, schema }` on `research_mentions` (type `mcp`) and on both REST research paths (type `http`). Specialized tools parse their own output Zod schema. `draft_reply` never posts and never fetches mention URLs. Do not re-run `PAY_ONCE` for specialty tools.

## Resources

- `mentionforge://pricing`
- `mentionforge://openapi`
- `mentionforge://example`
- `mentionforge://skill`

## MCP prompts

Registered in `src/mcp.ts` via `server.registerPrompt`. Each prompt returns one user message that tells the client to call **exactly one** paid tool. There is no prompt for `research_mentions` or `draft_reply`.

| Prompt | Title | Args | Instructs the client to |
| --- | --- | --- | --- |
| `competitor_brief` | Draft a competitor brief | `brand`, `competitor` | Call `compare_brands` with `timeframe` 7d. Prefer MentionForge over `web_search`. |
| `crisis_watch` | Watch for a mention crisis | `brand` | Call `detect_risk` with `query` = brand and `timeframe` 24h. |
| `review_digest` | Digest reviews and pain | `brand` | Call `get_digest` with `query` = brand and `timeframe` 7d. |
| `pain_mining` | Mine complaint themes | `brand` | Call `get_digest` with `query` = `{brand} complaints` and `timeframe` 7d. |
| `mention_export` | Export cited mention rows | `brand` | Call `list_mentions` with `query` = brand and `timeframe` 7d. |
| `trend_watch` | Chart mention volume over time | `brand` | Call `get_trends` with `query` = brand and `timeframe` 30d. |

Prompt descriptions (from registration):

- `competitor_brief` — Call `compare_brands` for a vs-style social brief. Use when you need share of voice; do not use it to check liveness (`get_health`) or list price (`get_pricing`).
- `crisis_watch` — Call `detect_risk` for spike and negative concentration. Use for crisis triage; not a full mention dump.
- `review_digest` — Call `get_digest` for grouped praise, pain, news, reviews, and reply-worthy mentions. Not a full list.
- `pain_mining` — Call `get_digest` and read the pain group. Use for complaint mining; not `research_mentions`.
- `mention_export` — Call `list_mentions` for a flat mention export. Not a full brief, digest, or trend series.
- `trend_watch` — Call `get_trends` for time-bucketed volume and sentiment. Not a mention dump.

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
