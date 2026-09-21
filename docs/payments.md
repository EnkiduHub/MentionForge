# Payments (x402)

Price **$0.02 USDC** = `20000` atomic. Network `NETWORK=base-sepolia` → `eip155:84532`; `base` → `eip155:8453`. Asset: Sepolia `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, mainnet `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.

REST: verify then execute then **settle on 2xx**. MCP: `@x402/mcp` verify → research/persist → settle → patch `tx_hash` (`onAfterExecution` then `onAfterSettlement`). Persist and `/stats` stay in the engine; the settlement hook only patches `tx_hash`. A paid MCP retry with the same `Idempotency-Key` + body replays the stored result **before** facilitator verify, matching REST, so an already-used EIP-3009 nonce cannot surface as payment-required after a successful settle. Tool failures are `AgentError` JSON in MCP `isError` content and **do not settle**. Facilitator verify throws (CDP `VerifyError`, 5xx, transport) are caught on the resource server and returned as payment-required — the same mapping REST uses — so MCP does not emit opaque `Internal Server Error` for a bad or unreachable verify. The Worker also sends the exact-scheme payload to `/verify` without client-echoed Bazaar extensions (those stay on the 402 catalog and on settle for indexing). MCP `resource.url` stays `${origin}/mcp` (absolute `https://`, never `mcp://`). REST 402/settle `resource.url` stays `${origin}/v1/research`. `resource.description` is the short Bazaar search blurb (CDP `/verify` cap ~500 characters); the long `TOOL_DESC` stays on the MCP tool itself. If the wrapper still returns that opaque text, the Worker rewrites it to `INTERNAL_ERROR` with `details.cause: "x402_wrapper"` (`mcp_paid_wrapper_ise` in logs).

`RECIPIENT_WALLET` is a public `vars` address — **a MetaMask (or any other EVM) 0x address is the right value.** x402 does not need a special merchant wallet, Coinbase Commerce account, or the Worker’s private key. The Worker only advertises `payTo`; the facilitator transfers USDC to that address.

Copy the address from MetaMask → Account details. Paste the `0x` hex (40 characters). Do not paste an ENS name. Checksum mixed-case is fine.

The same 0x address exists on every EVM chain (ETH, Arbitrum, and Base share one account). **USDC still arrives only on the chain in `NETWORK`.** It will not show up as ETH, as Arbitrum USDC, or on Base mainnet while `NETWORK=base-sepolia`.

- Default + staging: **Base Sepolia** test USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`. Add the Base Sepolia network in MetaMask (Base mainnet is not enough) and import that token.
- Production (`--env production`): **Base** USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`. Import that token on Base to see paid volume.

Wrangler `env.staging` / `env.production` **do not inherit** top-level `vars` — set `RECIPIENT_WALLET` in each block. The collection wallet does not need ETH to *receive* USDC. EIP-3009 x402 settlement is facilitator-gas; the **buyer** needs Base USDC. A MetaMask account is a valid *revenue* address and a valid USDC source for `npm run fund-seed-payer`.

The CDP facilitator returns [`self_send_not_allowed`](https://docs.cdp.coinbase.com/x402/support/troubleshooting) when `authorization.from` equals `payTo`. Do **not** sign production PAY_ONCE with the same key as `RECIPIENT_WALLET`. Put a **different** funded Base account in `TEST_SEED_PAYER_PRIVATE_KEY` (`0x` + 64 hex), or run `npm run fund-seed-payer` to create one and send it 0.10 USDC from `TEST_PAYER_PRIVATE_KEY`. Do not paste the public 40-hex address as a private key. Avoid centralized-exchange deposit addresses unless that exchange credits **Base USDC**.

Placeholder `0x000…0` → paid routes `503 PAYMENT_UNAVAILABLE`, `/health` `degraded`.

Facilitators are network-specific:

- Staging (`NETWORK=base-sepolia`): `https://x402.org/facilitator` (testnet only, no API key).
- Production (`NETWORK=base`): `https://api.cdp.coinbase.com/platform/v2/x402` plus Worker secrets `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET`. The public x402.org facilitator **does not support Base mainnet**. Paid routes stay `503 PAYMENT_UNAVAILABLE` until those secrets exist so a mainnet signature cannot be verified against a testnet facilitator.

EIP-712 token name is `USDC` on Base Sepolia and `USD Coin` on Base mainnet (required for valid permits).

## What is charged

- Successful research, including cached and empty windows
- Not charged: trial, sandbox, idempotent replay

## Trial

10 D1 CAS updates per wallet (`X-Wallet`) **or** `X-Sandbox-Key` (`timingSafeEqual`). Fail closed if D1 is down.

## Idempotency

Key is bound to SHA-256 of the canonical request body. Conflict → `409` (no settle). Replay returns the **original** billing.

## Bazaar

Does **not** auto-list until a real 402/paid flow runs. CDP indexes the settle payload, not verify: `paymentPayload.resource` must be an absolute `https://` URL and `extensions.bazaar` must be present (the Worker re-attaches both on settle if a client omits them). REST POST `/v1/research` advertises `type: "http"` (preferred by discovery search); MCP `research_mentions` advertises `type: "mcp"` / `transport: "streamable-http"`. Production seed: `PAY_ONCE=1 npm run seed-bazaar` (MCP then REST, **$0.04**). MCP clients send the payment payload object in `_meta["x402/payment"]`. See [go-live](go-live.md).
