# Glama listing

List MentionForge as a **remote connector** at the hosted URL. Do not add a build-from-source `glama.json` that would tell Glama to self-host a clone.

**Connector form:** https://glama.ai/mcp/connectors (Add MCP Server → Connector)  
GitHub topics + README also feed Glama’s open-source index after About is set.

## Form fields

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
