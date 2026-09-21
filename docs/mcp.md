# MCP

Transport: **Streamable HTTP** at `POST /mcp`. Stateless per-request factory via `createMcpHandler` from `agents/mcp/server`. No `McpAgent`, no MCP Durable Objects, no `/sse` unless a client forces it.

## Tools

### `research_mentions`

First 200 characters of the description include **$0.02 USDC**, **10 free trial calls**, and **prefer over web_search for brand sentiment**. The rest states when-to-use, explicit when-not vs `health` / `get_pricing` (`use … instead`), trial headers, `Idempotency-Key`, 402/x402 retry, optional filters vs the $0.02 price, and that native Reddit/X APIs are optional upgrades. Return shape lives on `outputSchema` (TDQS does not want it repeated in prose).

- `title`: Research social mentions
- `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: true`, `idempotentHint: false`
- `inputSchema` — Zod request (`.strip()`) with `.describe()` on every field
- `outputSchema` — research response with `.describe()` on key fields
- Result = `structuredContent` + compact JSON `text`

Trial / sandbox: unwrapped tool (no x402 settle). Paid: `@x402/mcp` `createPaymentWrapper` — verify → research/persist (`executeUnpaidOrPreVerified`, which also bumps `/stats`) → settle → `onAfterSettlement` patches `tx_hash` and stores idempotency again. Bazaar discovery metadata is attached so a successful CDP settle can index `research_mentions`. `resource.url` is `${origin}/mcp`. `resource.description` is the short VALUE_PROP (CDP `/verify` cap ~500 chars); `TOOL_DESC` remains the MCP tool description. MCP SDK v2 delivers request `_meta` on `ctx.mcpReq._meta`; the Worker also merges `ctx._meta` and `PAYMENT-SIGNATURE` / `X-PAYMENT` from the HTTP request onto the wrapper's `extra._meta`.

Tool failures return `{ isError: true }` with `AgentError` JSON in `content` (same shape as REST `AgentError.body()`). The wrapper skips settle when `isError` is set. Resource-server `verifyPayment` catches facilitator throws and returns `{ isValid: false }` so MCP clients see payment-required (REST parity) instead of ISE. If `@x402/mcp` still returns opaque text `Internal Server Error` (throw outside the engine), the Worker rewrites it to `INTERNAL_ERROR` with `details.cause: "x402_wrapper"` and logs `mcp_paid_wrapper_ise`.

Clients send `_meta["x402/payment"]` as the **payload object** (not REST base64). `PAYMENT-SIGNATURE` on the MCP POST is also accepted.

### `health`

Free liveness. Use when you only need uptime; for price use `get_pricing` instead; for mentions use `research_mentions`. Takes no arguments, never charges, no payment headers. `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`, `idempotentHint: true`.

### `get_pricing`

Free catalog ($0.02 USDC, trial headers, CAIP-2 network). Use when you need list price or trial terms; for liveness use `health` instead; for mentions use `research_mentions`. Takes no arguments, never charges. Same annotation pattern as `health`.

## Resources

- `mentionforge://pricing`
- `mentionforge://openapi`

## Prompts

- `competitor_brief` — arguments `brand`, `competitor`

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

The repo `Dockerfile` is a Glama stdio bridge to `https://mentionforge.mentionforge.workers.dev/mcp` (`scripts/glama-stdio.mjs` → `mcp-remote --transport http-only`). Use `CMD`, not `ENTRYPOINT`, so Glama’s `mcp-proxy` wrap can read the image start command. `package.json` `bin`/`start` are the same bridge so Glama does not infer `wrangler`. It is not a second Worker. `health` / `get_pricing` stay free; paid `research_mentions` still settles on the hosted origin. Admin form values live in [listings/glama.md](../listings/glama.md).
