# Official MCP Registry

Namespace: `io.github.EnkiduHub/mentionforge`  
Remote: `https://mentionforge.mentionforge.workers.dev/mcp` (streamable HTTP)  
Source: `https://github.com/EnkiduHub/mentionforge`

The Official Registry accepts **remote** servers. We publish `server.json` `remotes`, not an npm package, so agents install the **hosted** paid origin rather than a self-hosted fork.

After the public GitHub repo exists:

```bash
# https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx
mcp-publisher login github
mcp-publisher publish
```

`server.json` `name` must stay `io.github.EnkiduHub/mentionforge` so GitHub OAuth can publish that namespace. Do not add an npm `packages` entry unless we also publish a package whose `mcpName` matches — that would send agents to `npx` instead of the paid Worker.
