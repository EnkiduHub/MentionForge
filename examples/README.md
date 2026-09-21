# Examples

Local copies of the agent-facing install snippets. Live origin: `https://mentionforge.mentionforge.workers.dev`.

| File | Use |
| --- | --- |
| [agent-prompt.md](agent-prompt.md) | Copy-paste system prompt (one paid tool, shared trial) |
| [mcp.json](mcp.json) | Cursor / Claude MCP URL (replace `YOUR_WORKER` for forks) |
| [curl.sh](curl.sh) | Local 402 + trial smoke; also hits free `/v1/suggest` and `/v1/entity` |

Paid specialty REST is POST-only. Do not GET `/v1/compare` `/v1/digest` `/v1/risk` `/v1/reply`.
