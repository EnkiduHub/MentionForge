# Glama listing

List MentionForge as a **remote connector** at the hosted URL. The GitHub listing image is a **stdio bridge** (`mcp-remote`) to that same origin. It does not clone the Cloudflare Worker, does not bake secrets, and does not put research on Glama compute.

Glama [prices open-source hosting as free](https://glama.ai/pricing). Paid `research_mentions` still settles **$0.02 USDC on Base** against `https://mentionforge.mentionforge.workers.dev/mcp` (clients pay). Do not tell Glama to run `wrangler` or `npm run dev`.

**Connector form:** https://glama.ai/mcp/connectors (Add MCP Server → Connector)  
GitHub topics + README also feed Glama’s open-source index after About is set.

## Three different Glama surfaces

Do not treat these as the same score. punkpeye’s awesome-mcp-servers bot wants the **GitHub listing quality score**, not connector TDQS.

| Surface | URL | What it measures | Status |
| --- | --- | --- | --- |
| Hosted connector | https://glama.ai/mcp/connectors/io.github.EnkiduHub/MentionForge | Live `/mcp` health + TDQS | Healthy, TDQS **A 4.9/5.0** — not the quality-score badge |
| GitHub server listing | https://glama.ai/mcp/servers/@EnkiduHub/MentionForge | README scrape / deployability | Landing/server-card stay on this `@` URL unless a quality-score badge requires the non-`@` twin |
| Quality-score badge | `https://glama.ai/mcp/servers/EnkiduHub/MentionForge/badges/score.svg` (same `OWNER/REPO` form the punkpeye bot already accepted) | Numeric quality score | `?` until a Glama **release** succeeds; SVG 500 while unset |

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
| Pinned commit SHA | empty (latest HEAD after Sync) |

Do **not** use `npm ci`, `npm run dev`, or `wrangler`. Those try to boot the Worker and will fail on Glama.

4. **Deploy** (build test: start + `initialize` / `tools/list`).
5. **Make Release** → version → publish. That is when the quality badge becomes a letter, not `?`.

The root `Dockerfile` uses `CMD` (not `ENTRYPOINT`) and starts `scripts/glama-stdio.mjs` so `Cmd` is non-empty. `health` / `get_pricing` stay free; unpaid `research_mentions` is payment-required. Do not leave CMD as `[]`.

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

Do **not** paste private test credentials (CDP, sandbox, or wallet keys) into Glama. `initialize` / `health` / `get_pricing` are free and enough to prove the endpoint is up. Paid `research_mentions` returns HTTP 402 until the client attaches x402.

Official Registry publish (`io.github.EnkiduHub/MentionForge`) is the other Glama ingest path — do not wait for traction before that publish.
