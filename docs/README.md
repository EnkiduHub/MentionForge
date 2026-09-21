# Docs

Operator and protocol notes for the hosted Worker. Agent-facing copy lives on the origin (`GET /llms.txt`, `GET /skill.md`) and in [skill.md](../skill.md). Directory paste is under [listings/](../listings/).

| Doc | Use |
| --- | --- |
| [api.md](api.md) | REST paths, overlays, paid lenses, errors |
| [mcp.md](mcp.md) | Streamable HTTP tools, resources, prompts, x402 wrapper |
| [payments.md](payments.md) | $0.02 USDC, trial, idempotency, Bazaar |
| [architecture.md](architecture.md) | Engine, cache, sources, SSRF, budget |
| [operations.md](operations.md) | Secrets, D1, health, deploy |
| [go-live.md](go-live.md) | Production checklist |

Version is `1.1.0` ([CHANGELOG](../CHANGELOG.md)). Default CI is `npm test` (unit). Do not enable the Miniflare worker project in default CI.
