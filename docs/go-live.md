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

## Remaining (in order)

1. Use a **funded Base account** as the seed payer (a MetaMask account on Base is valid). It needs Base USDC plus a little Base ETH for gas. Export **that account’s private key** (`0x` + 64 hex) into local `.dev.vars` as `TEST_PAYER_PRIVATE_KEY`. MetaMask → Account details → Show private key. Never the 12/24-word seed, and never the public `RECIPIENT_WALLET` address (40 hex). Same account as `payTo` is fine (self-transfer of $0.02). A dedicated low-balance account is safer only because this key sits on disk.
2. One paid REST call (moves **$0.02 USDC** to yourself):

   ```bash
   ORIGIN=https://mentionforge.mentionforge.workers.dev PAY_ONCE=1 npm run test-payment
   ```

   Expect HTTP 200 and `meta.billing.tx_hash`. Check `/operator` (Bearer `OPERATOR_TOKEN`) for USDC earned.
3. **One Bazaar-seeding paid MCP call** (second **$0.02 USDC**; `_meta["x402/payment"]` is the payload object):

   ```bash
   ORIGIN=https://mentionforge.mentionforge.workers.dev PAY_ONCE=1 npm run seed-bazaar
   ```
4. Public GitHub `EnkiduHub/MentionForge` (**MIT** + [TRADEMARK.md](../TRADEMARK.md)). Do **not** switch to a non-commercial license for launch — directories and agents discover the **hosted URL**; clones still pay this Worker.
5. Official MCP Registry: `mcp-publisher login github` then `mcp-publisher publish` (`listings/official-registry.md`). Copy in `listings/` for mcp.so, Glama, Smithery, PulseMCP, x402scan — all must point at `https://mentionforge.mentionforge.workers.dev/mcp`, not a self-host command.
6. Optional quality (not blockers): Reddit OAuth (`REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET`), X App-Only bearer (`X_BEARER_TOKEN`, paid search — set a low credit cap), custom domain (Cache API is a no-op on `workers.dev`), Workers Paid ($5/mo) before production CPU volume.

Do not run `PAY_ONCE` until the payer wallet has Base USDC + Base ETH and `TEST_PAYER_PRIVATE_KEY` is `0x` + 64 hex (never the public payTo address). Keep the code MIT; the paid product is the production origin.
