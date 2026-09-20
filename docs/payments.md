# Payments (x402)

Price **$0.02 USDC** = `20000` atomic. Network `NETWORK=base-sepolia` → `eip155:84532`; `base` → `eip155:8453`. Asset: Sepolia `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, mainnet `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.

REST: verify then execute then **settle on 2xx**. MCP: `@x402/mcp` hook order verify → execute → settle (`onAfterExecution` then `onAfterSettlement`).

`RECIPIENT_WALLET` is a public `vars` address — **a MetaMask (or any other EVM) 0x address is the right value.** x402 does not need a special merchant wallet, Coinbase Commerce account, or the Worker’s private key. The Worker only advertises `payTo`; the facilitator transfers USDC to that address.

Copy the address from MetaMask → Account details. Paste the `0x` hex (40 characters). Do not paste an ENS name. Checksum mixed-case is fine.

The same 0x address exists on every EVM chain (ETH, Arbitrum, and Base share one account). **USDC still arrives only on the chain in `NETWORK`.** It will not show up as ETH, as Arbitrum USDC, or on Base mainnet while `NETWORK=base-sepolia`.

- Default + staging: **Base Sepolia** test USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`. Add the Base Sepolia network in MetaMask (Base mainnet is not enough) and import that token.
- Production (`--env production`): **Base** USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`. Import that token on Base to see paid volume.

Wrangler `env.staging` / `env.production` **do not inherit** top-level `vars` — set `RECIPIENT_WALLET` in each block. The collection wallet does not need ETH to *receive* USDC; the *payer* needs Base USDC + Base ETH for gas. A MetaMask account is a valid payer if you export **one account’s private key** (`0x` + 64 hex) into local `.dev.vars` as `TEST_PAYER_PRIVATE_KEY`. Do not paste the public 40-hex address there. Avoid centralized-exchange deposit addresses unless that exchange credits **Base USDC**.

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

Does **not** auto-list until a real 402/paid flow runs. After deploy, `PAY_ONCE=1 npm run seed-bazaar` seeds `research_mentions` (MCP payload object in `_meta["x402/payment"]`). See [go-live](go-live.md).
