# x402scan listing

Bazaar seed for production **already settled**. Do not re-run `PAY_ONCE`.

| Field | Value |
| --- | --- |
| Origin | `https://mentionforge.mentionforge.workers.dev` |
| REST resource | `POST /v1/research` |
| MCP resource | `POST /mcp` tool `research_mentions` |
| Amount | `20000` atomic USDC (`$0.02`) |
| Network | `eip155:8453` (Base). Staging remains `eip155:84532` (Base Sepolia). |
| Asset | Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| payTo | `0xBe578a4543904b4af3F27E3B0db73BC1B1e58F77` |
| Discovery card | `GET /.well-known/x402` (origin from `request.url`) |
| REST seed tx | [`0xb342cd0c02b339d2393a39daec69a214cdbccb0df8804ca1438edd0dfa36309d`](https://basescan.org/tx/0xb342cd0c02b339d2393a39daec69a214cdbccb0df8804ca1438edd0dfa36309d) |
| MCP seed tx | [`0x92727630c7a8a40dd460377e26de9ee4f0b8baa5b2bd83d4dc2de9786ca4bad7`](https://basescan.org/tx/0x92727630c7a8a40dd460377e26de9ee4f0b8baa5b2bd83d4dc2de9786ca4bad7) |

Optional extra origin register (SIWX wallet login, not required for Bazaar): https://www.x402scan.com/resources/register

CDP may show `bazaar.status: processing` until the catalog indexes `research_mentions`.
