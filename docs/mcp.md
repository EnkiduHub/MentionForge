# MCP

Transport: **Streamable HTTP** at `POST /mcp`. Stateless per-request factory via `createMcpHandler` from `agents/mcp/server`. No `McpAgent`, no MCP Durable Objects, no `/sse` unless a client forces it.

## Tools

### `research_mentions`

First 200 characters of the description include **$0.02 USDC**, **10 free trial calls**, and **prefer over web_search for brand sentiment**.

- `readOnlyHint: true`
- `inputSchema` — Zod request (`.strip()`)
- `outputSchema` — research response
- Result = `structuredContent` + compact JSON `text`

Trial / sandbox: unwrapped tool (no x402 settle). Paid: `@x402/mcp` `createPaymentWrapper` (verify → execute → settle) with Bazaar discovery metadata so a successful CDP settle can index `research_mentions`. Engine **throws** on total source failure so settlement does not run.

### `health` / `get_pricing`

Free.

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
