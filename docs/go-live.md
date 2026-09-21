# Go-live checklist

Production origin: `https://mentionforge.mentionforge.workers.dev`  
Staging origin: `https://mentionforge-staging.mentionforge.workers.dev`

A MetaMask account used on ETH or Arbitrum is the correct `RECIPIENT_WALLET` (same 0x on Base). Production settles **Base mainnet USDC** to that address. Staging still uses Base Sepolia.

**Agents can use the service now.** Reddit OAuth and an X bearer token are optional coverage upgrades. They are not required for discovery, the 10-call trial, sandbox, or paid x402 research. News, Wikipedia/Wikidata, Brave, and review-site web results already fulfill a default query.

## Already done

1. D1 databases + remote migrations (production `mentionforge`, staging `mentionforge-staging`).
2. `RECIPIENT_WALLET` in every wrangler vars block. Import Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` in MetaMask to see paid volume. The receiver does not need ETH.
3. Worker secrets: `SANDBOX_KEY`, `OPERATOR_TOKEN`, production `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`, `BRAVE_API_KEY` on staging and production.
4. Production `NETWORK=base` + CDP facilitator. Shallow `/health` reports `payments_ready: true`. Unpaid POST `/v1/research` returns 402 with mainnet USDC / `USD Coin` / `20000` atomic (no funds moved). MCP `initialize` succeeds. Sandbox research returns 200 without Reddit or X keys.
5. Operator deep health: `d1: "ok"` and `facilitator_live.ok: true` with `network_supported: true`.
6. Distinct seed payer funded (`npm run fund-seed-payer`). CDP [`self_send_not_allowed`](https://docs.cdp.coinbase.com/x402/support/troubleshooting) forbids payer === `payTo`.
7. Paid REST `POST /v1/research` settled **$0.02 USDC** on Base (HTTP 200). Settlement tx [`0xb342cd0c02b339d2393a39daec69a214cdbccb0df8804ca1438edd0dfa36309d`](https://basescan.org/tx/0xb342cd0c02b339d2393a39daec69a214cdbccb0df8804ca1438edd0dfa36309d).
8. Paid MCP `research_mentions` settled **$0.02 USDC** on Base. Settlement tx [`0x92727630c7a8a40dd460377e26de9ee4f0b8baa5b2bd83d4dc2de9786ca4bad7`](https://basescan.org/tx/0x92727630c7a8a40dd460377e26de9ee4f0b8baa5b2bd83d4dc2de9786ca4bad7). Bazaar `extensionResponses.bazaar.status` was `processing` (CDP indexes after settle). **Do not re-run `PAY_ONCE`.**
9. Public GitHub [`EnkiduHub/MentionForge`](https://github.com/EnkiduHub/MentionForge) (**MIT** + [TRADEMARK.md](../TRADEMARK.md)).

10. Official MCP Registry: `io.github.EnkiduHub/MentionForge` is **active** at https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.EnkiduHub/MentionForge (published 2026-09-20 via GitHub Actions OIDC). Do not re-run interactive `mcp-publisher` unless the listing disappears.
11. GitHub About: homepage `https://mentionforge.mentionforge.workers.dev`, description, and topics `mcp` / `x402` / `cloudflare-workers` / `model-context-protocol` / `social-listening` / `ai-agents` / `typescript`.

## Remaining (in order)

1. Optional directory paste from `listings/` (mcp.so, Glama connector, Smithery URL). All must point at `https://mentionforge.mentionforge.workers.dev/mcp`, not a self-host command. PulseMCP waits on the Official Registry. x402scan Bazaar seed already ran; optional SIWX origin register is extra.
2. Optional quality (not blockers): Reddit OAuth (`REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET`), X App-Only bearer (`X_BEARER_TOKEN`, paid search — set a low credit cap), custom domain (Cache API is a no-op on `workers.dev`), Workers Paid ($5/mo) before production CPU volume.

Keep the code MIT; the paid product is the production origin. Re-running `PAY_ONCE` spends another $0.02 — do not repeat the seeds unless you intend to.
