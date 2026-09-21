# Operations

## Secrets

Worker secrets: `SANDBOX_KEY`, `OPERATOR_TOKEN`, optional `BRAVE_API_KEY`, `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `X_BEARER_TOKEN`. Production Base payments also need `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` (CDP Secret API key — not a wallet export).

`.dev.vars` is **local only** (`wrangler dev`). Comments in that file are not deployed. Remote Workers need `npx wrangler secret put NAME --env production` (and staging). Never put `TEST_PAYER_PRIVATE_KEY` on the Worker.

Optional source APIs (not required for agents — production already serves REST + MCP without them):

- Reddit (oauth.reddit.com search): [prefs/apps](https://www.reddit.com/prefs/apps), [developers.reddit.com](https://developers.reddit.com/), [API access request](https://support.reddithelp.com/hc/en-us/requests/new). App type **web app** or **script** (must have a secret). Grant used by the Worker: `client_credentials` (no Reddit password). New apps may need Reddit’s Responsible Builder approval.
- X recent search: [X Developer Console](https://console.x.com/), [Bearer token docs](https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/bearer-tokens). App-only Bearer. Search is pay-per-use; set a low credit cap. Without a working bearer, X falls back to web mentions (`degraded`).
- Brave Search (not Answers): [api.search.brave.com/app/keys](https://api.search.brave.com/app/keys). Already on staging and production.

GitHub and Stack Overflow do **not** need secrets. They are query-gated inside the web adapter (dev-shaped queries, skip `site:` scoped). `GET /health` `sources` stays `reddit`, `news`, `web`, `reviews`, `x`.

`GET /health` reports `source_backends` (no secret values). `GET /health?deep=1` adds `sources_configured` booleans (reddit / x / brave / sandbox / cdp).

Public vars: `RECIPIENT_WALLET` (MetaMask/EVM 0x payTo — public, not a secret), `NETWORK`, `PRICE_USDC`, `FREE_TRIAL_CALLS`, `FACILITATOR_URL`.

## D1

```bash
npx wrangler d1 create mentionforge
npx wrangler d1 migrations apply mentionforge --remote
```

Put the real `database_id` in `wrangler.jsonc` (top-level, `env.staging`, `env.production`).

## Dashboard

`GET /operator` with `Authorization: Bearer $OPERATOR_TOKEN` reads D1 `stats_daily` (calls, paid, USDC micros, trial, errors) and draws a 30-day sparkline from `days` reversed into chronological order. Analytics Engine is not queried from the Worker.

## Health

- `HEAD /health` for uptime probes
- `GET /health` JSON; `payments_ready` false → `degraded` (config only: wallet + facilitator URL + CDP keys on mainnet). Cached `public, max-age=30`.
- `GET /health?deep=1` requires `Authorization: Bearer $OPERATOR_TOKEN`. Adds D1 ping and a live facilitator `GET /supported` (`facilitator_live`). `Cache-Control: private, no-store`. `facilitator_live.ok` false → `degraded` (do not spend USDC until this is true).

## Deploy

```bash
npx wrangler deploy --env staging
npx wrangler deploy --env production
```

`npm run deploy` is staging-only so a bare deploy cannot overwrite production with Sepolia vars. Production is Base + CDP (`https://mentionforge.mentionforge.workers.dev`). Default CI is `npm test` (unit). `npm run test:worker` is not default CI.
