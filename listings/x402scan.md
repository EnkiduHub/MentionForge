# x402scan listing

Production Bazaar seed must run **after** a Worker deploy that changes settle catalog (resource URL, HTTP/MCP bazaar extensions, or search copy). Dry-run: `npm run seed-bazaar`. Paid: `PAY_ONCE=1 npm run seed-bazaar` ($0.06: MCP, then `/v1/research`, then `/v1/research_mentions`).

| Field | Value |
| --- | --- |
| Origin | `https://mentionforge.mentionforge.workers.dev` |
| REST resource | `POST /v1/research` (type `http`; paid lenses verify against this same URL). `POST /v1/research_mentions` is the same call with a resource URL that contains `research_mentions`. |
| MCP resource | `POST /mcp` (type `mcp`; Bazaar indexes `research_mentions`; specialty tools share this URL) |
| Amount | `20000` atomic USDC (`$0.02`) |
| Network | `eip155:8453` (Base). Staging remains `eip155:84532` (Base Sepolia). |
| Asset | Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Discovery card | `GET /.well-known/x402` (origin from `request.url`) |
| REST seed tx | [`0xb342cd0c02b339d2393a39daec69a214cdbccb0df8804ca1438edd0dfa36309d`](https://basescan.org/tx/0xb342cd0c02b339d2393a39daec69a214cdbccb0df8804ca1438edd0dfa36309d) |
| MCP seed tx | [`0x92727630c7a8a40dd460377e26de9ee4f0b8baa5b2bd83d4dc2de9786ca4bad7`](https://basescan.org/tx/0x92727630c7a8a40dd460377e26de9ee4f0b8baa5b2bd83d4dc2de9786ca4bad7) |

Optional extra origin register (SIWX wallet login, not required for Bazaar): <https://www.x402scan.com/resources/register>

CDP Bazaar indexes on settle when `paymentPayload.resource` is absolute HTTPS and `extensions.bazaar` is present. The Worker re-attaches both on settle. After deploy, confirm:

- `GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=MentionForge`
- `GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=mentionforge`
- `GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=research_mentions`
- `GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=brand%20sentiment`
- `GET https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=social%20listening`

These checks are post-deploy and post-reseed. A result from before that settle is not evidence the new copy is indexed. Ranking can lag the settle by several hours.
