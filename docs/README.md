# Docs

Operator and protocol notes for the hosted Worker. Agent-facing copy lives on the origin (`GET /llms.txt`, `GET /skill.md`) and in [skill.md](../skill.md). Directory paste is under [listings/](../listings/).

| Doc | Use |
| --- | --- |
| [use-cases.md](use-cases.md) | Five MCP jobs (one tool or prompt each) |
| [api.md](api.md) | REST paths, overlays, paid lenses, errors |
| [mcp.md](mcp.md) | Streamable HTTP tools, resources, [MCP prompts](mcp.md#mcp-prompts), x402 wrapper |
| [payments.md](payments.md) | $0.02 USDC, trial, idempotency, Bazaar |
| [architecture.md](architecture.md) | Engine, cache, sources, SSRF, budget |
| [operations.md](operations.md) | Secrets, D1, health, deploy |
| [go-live.md](go-live.md) | Production checklist |
| [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) | Website tokens, components, motion, SEO, page architecture |
| [revamp-2026-11/](revamp-2026-11/README.md) | November 2026 website revamp: Lighthouse before/after, screenshots, verification |

Version is `1.2.2` ([CHANGELOG](../CHANGELOG.md), same as `package.json`). Default CI is `npm test` (unit). Do not enable the Miniflare worker project in default CI.
