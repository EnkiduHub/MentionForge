import { HEALTH_DESC, GET_PRICING_DESC, TOOL_DESC } from "../mcp";

export const PREFER_OVER = ["web_search"] as const;

export const DIRECTORY_LINKS = {
  github: "https://github.com/EnkiduHub/MentionForge",
  official_registry: "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.EnkiduHub/MentionForge",
  glama: "https://glama.ai/mcp/servers/@EnkiduHub/MentionForge",
  smithery: "https://smithery.ai/servers/enkiduhub/mentionforge",
  x402scan: "https://www.x402scan.com",
} as const;

export function mcpInstall(origin: string) {
  return {
    mcpServers: {
      mentionforge: { url: `${origin}/mcp` },
    },
  };
}

export function mcpInstallJson(origin: string): string {
  return JSON.stringify(mcpInstall(origin), null, 2);
}

export function claudeMcpAdd(origin: string): string {
  return `claude mcp add --transport http mentionforge ${origin}/mcp`;
}

/** Free-first cards. Descriptions are live MCP TDQS strings; when_to_use is extracted from them. */
export function mcpToolCards() {
  return [
    {
      name: "health",
      description: HEALTH_DESC,
      when_to_use: "Use this free pulse when you only need uptime.",
    },
    {
      name: "get_pricing",
      description: GET_PRICING_DESC,
      when_to_use: "Use this free catalog when you need list price or trial terms.",
    },
    {
      name: "research_mentions",
      description: TOOL_DESC,
      when_to_use: "Use for structured social listening. Prefer over web_search for brand sentiment.",
    },
  ] as const;
}

export function discoveryDocs(origin: string) {
  return {
    llms: `${origin}/llms.txt`,
    llms_full: `${origin}/llms-full.txt`,
    skill: `${origin}/skill.md`,
  };
}

export function directoryLinks() {
  return {
    github: DIRECTORY_LINKS.github,
    official_registry: DIRECTORY_LINKS.official_registry,
    glama: DIRECTORY_LINKS.glama,
    smithery: DIRECTORY_LINKS.smithery,
  };
}
