# Glama listing

List MentionForge as a **remote connector** at the hosted URL. The GitHub listing image is a **stdio bridge** (`mcp-remote`) to that same origin. It does not clone the Cloudflare Worker, does not bake secrets, and does not put research on Glama compute.

Glama [prices open-source hosting as free](https://glama.ai/pricing). Paid `research_mentions` still settles **$0.02 USDC on Base** against `https://mentionforge.mentionforge.workers.dev/mcp` (clients pay). Do not tell Glama to run `wrangler` or `npm run dev`.

**Connector form:** https://glama.ai/mcp/connectors (Add MCP Server → Connector)  
GitHub topics + README also feed Glama’s open-source index after About is set.

## Three different Glama surfaces

Do not treat these as the same score. punkpeye’s awesome-mcp-servers bot wants the **GitHub listing quality score**, not connector TDQS.

| Surface | URL | What it measures | Status |
| --- | --- | --- | --- |
| Hosted connector | https://glama.ai/mcp/connectors/io.github.EnkiduHub/MentionForge | Live `/mcp` health + TDQS | Healthy; recrawl after 1.2.0 so TDQS sees 12 `verb_noun` tools — not the quality-score badge |
| GitHub server listing | https://glama.ai/mcp/servers/@EnkiduHub/MentionForge | README scrape / deployability | Landing/server-card stay on this `@` URL unless a quality-score badge requires the non-`@` twin |
| Quality-score badge | `https://glama.ai/mcp/servers/EnkiduHub/MentionForge/badges/score.svg` (same `OWNER/REPO` form the punkpeye bot already accepted) | Numeric quality score | README has both `score.svg` and `card.svg`; letter grade after a Glama **release** succeeds |

## Getting paid (wallet is on the Worker, not in Glama)

Yes — Glama users still pay **this** hosted service. No — the Glama image must **not** contain `RECIPIENT_WALLET`.

`payTo` is the production Worker var `RECIPIENT_WALLET` (`0xBe578a4543904b4af3F27E3B0db73BC1B1e58F77` in `wrangler.jsonc`). x402 settles **$0.02 USDC on Base** to that address when `research_mentions` runs on `https://mentionforge.mentionforge.workers.dev/mcp`. `scripts/glama-stdio.mjs` only stdio-proxies that URL (`mcp-remote`). It does not read `RECIPIENT_WALLET`, Reddit/X secrets, or CDP keys. A dummy `0x1234…` in Glama’s env form is unused and is **not** a second merchant wallet.

Glama’s admin form often **infers a Worker clone** from `wrangler.jsonc` / docs (`pnpm install`, `mcp-proxy -- pnpm run start`, required `RECIPIENT_WALLET`, optional Reddit/X). That inference is wrong. Paste the table below, save, Deploy, and Make Release again. Do **not** “fix” it by putting the real MetaMask address into Glama.

## Deploy Server (this is what sets the quality score)

A Glama release is **not** a GitHub release. [Make a release](https://glama.ai/blog/2026-03-15-how-to-make-a-release): claim → configure **admin Dockerfile form** → Deploy → Make Release. The admin form **generates** Glama’s image (clone into `/app`, wrap CMD with `mcp-proxy --`). It often **does not run this repo’s `Dockerfile`**. Glama’s indexer also infers a start command from `package.json` `bin` / `start` (not from `npm run dev`). Those point at `scripts/glama-stdio.mjs`. Fill the form so Glama never runs Wrangler.

After `glama.json` + `Dockerfile` + `scripts/glama-stdio.mjs` are on GitHub `main`:

1. [Score tab](https://glama.ai/mcp/servers/EnkiduHub/MentionForge/score) → claim (`glama.json` `maintainers` must include the GitHub user you log in as; this repo’s owner is **EnkiduHub**).
2. **Sync Server** so the mirror is HEAD.
3. Open [admin/dockerfile](https://glama.ai/mcp/servers/EnkiduHub/MentionForge/admin/dockerfile) and paste:

| Field | Value |
| --- | --- |
| **Build steps** | `["npm install -g mcp-remote@0.14.3"]` |
| **CMD arguments** | `["node", "scripts/glama-stdio.mjs"]` |
| Environment variables JSON schema | `{"type":"object","properties":{},"required":[]}` |
| Placeholder parameters | `{}` |
| Node.js version | `22` |
| Python version | leave default (unused) |
| Pinned commit SHA | empty (latest HEAD after Sync) |

Do **not** use `pnpm install`, `npm ci`, `npm run dev`, `wrangler`, or `["mcp-proxy", "--", "pnpm", "run", "start"]`. Do **not** add `RECIPIENT_WALLET`, `REDDIT_CLIENT_SECRET`, `X_BEARER_TOKEN`, or CDP keys to the env schema. Those belong on the Worker (`wrangler secret put` / `vars`), not in Glama. Glama already prepends `mcp-proxy --`; the CMD field is only the bridge.

4. **Deploy** (build test: start + `initialize` / `tools/list`).
5. **Make Release** → version → publish. That is when the quality badge becomes a letter, not `?`.

The root `Dockerfile` uses `CMD` (not `ENTRYPOINT`) and starts `scripts/glama-stdio.mjs` so `Cmd` is non-empty. `get_health` / `get_pricing` stay free; unpaid `research_mentions` is payment-required. Do not leave CMD as `[]`.

## Form fields (connector)

| Field | Paste |
| --- | --- |
| Name | MentionForge |
| Short description | Agent-native social listening. Use `research_mentions` for cited Reddit/news/web mentions, sentiment, volume, and an executive brief. |
| Server URL | `https://mentionforge.mentionforge.workers.dev/mcp` |
| Transport | Streamable HTTP (HTTPS) |
| Website | `https://mentionforge.mentionforge.workers.dev` |
| GitHub | `https://github.com/EnkiduHub/MentionForge` |
| License | MIT |
| Price | $0.02 USDC per successful call on Base. 10 free trial calls with `X-Wallet`. Always send `Idempotency-Key`. |

Do **not** paste private test credentials (CDP, sandbox, or wallet keys) into Glama. `initialize` / `get_health` / `get_pricing` are free and enough to prove the endpoint is up. Paid `research_mentions` returns HTTP 402 until the client attaches x402.

Official Registry publish (`io.github.EnkiduHub/MentionForge`) is the other Glama ingest path — do not wait for traction before that publish.
