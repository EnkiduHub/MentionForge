# Recipes

Three copy-paste jobs, each ending in one paid call. Every call below fits in the shared **10-call trial** (`X-Wallet` or `X-Sandbox-Key`). After the trial, each successful call is **$0.02 USDC** on Base via x402 (see [payments](../docs/payments.md)). Live sources are web, news and reviews. Reddit and X are disabled (`GET /health`).

Origin: `https://mentionforge.mentionforge.workers.dev`. Send a fresh `Idempotency-Key` per new request, and the same one when retrying the same body.

Try the free `get_example` tool (or `GET /v1/research/example`) first if you only want the response shape.

## 1. Weekly competitor share of voice

**MCP (Cursor, Claude Desktop):** add [mcp.json](mcp.json), then ask:

> Compare share of voice for Notion vs Obsidian and Logseq over the last 7 days.

The client should pick `compare_brands` (one paid call).

**REST:**

```bash
curl -sS -X POST https://mentionforge.mentionforge.workers.dev/v1/compare \
  -H "content-type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "X-Wallet: 0xYOUR_WALLET" \
  -d '{"brand":"Notion","competitors":["Obsidian","Logseq"],"timeframe":"7d"}'
```

**You get:** `share_of_voice` per brand, per-brand sentiment, mention counts and up to three themes, plus cited sources. Up to two competitors.

## 2. Launch-day risk check

**MCP:** ask:

> Check launch-day risk for Cloudflare Workers in the last 24h: any volume spike or negative concentration?

The client should pick `detect_risk` (one paid call).

**REST:**

```bash
curl -sS -X POST https://mentionforge.mentionforge.workers.dev/v1/risk \
  -H "content-type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "X-Wallet: 0xYOUR_WALLET" \
  -d '{"query":"Cloudflare Workers","timeframe":"24h"}'
```

**You get:** risk `signals` (spike, negative concentration, reasons), up to five most negative cited mentions and up to three follow-up queries. An empty window still succeeds and still counts as a call.

## 3. Unsent reply drafts for reply-worthy mentions

**MCP:** ask:

> Draft a supportive reply to a recent Notion mention that is worth answering. Do not post it.

The client should pick `draft_reply` (one paid call).

**REST:**

```bash
curl -sS -X POST https://mentionforge.mentionforge.workers.dev/v1/reply \
  -H "content-type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "X-Wallet: 0xYOUR_WALLET" \
  -d '{"query":"Notion","stance":"supportive","timeframe":"7d"}'
```

`stance` is `supportive`, `neutral` (default) or `defensive`.

**You get:** draft text with the `source_url` and `mention_id` it answers. Every draft has `unsent: true`: MentionForge never posts, and never fetches `mention_url`. Review before you send anything yourself.

## When the trial runs out

A paid call without trial left returns HTTP `402` with `error.hint`. Follow the hint and retry the **same body and `Idempotency-Key`** with a `PAYMENT-SIGNATURE` header (x402 v2). An x402-capable client handles this for you.
