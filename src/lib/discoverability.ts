import { z } from "zod";
import packageJson from "../../package.json" with { type: "json" };
import officialServer from "../../server.json" with { type: "json" };
import { SERVICE_NAME, SERVICE_VERSION } from "./constants";
import { ACCEPTED_MCP_PROTOCOL_VERSIONS } from "./mcp-protocol";
import { researchRequestSchema } from "../schemas/research";
import {
  compareInputSchema,
  digestInputSchema,
  entityInputSchema,
  exampleInputSchema,
  healthInputSchema,
  listInputSchema,
  pricingInputSchema,
  replyInputSchema,
  riskInputSchema,
  suggestInputSchema,
  trendsInputSchema,
} from "../schemas/lenses";
import {
  COMPARE_DESC,
  DIGEST_DESC,
  ENTITY_PROFILE_DESC,
  GET_EXAMPLE_DESC,
  GET_PRICING_DESC,
  HEALTH_DESC,
  LIST_DESC,
  REPLY_DESC,
  RISK_DESC,
  SUGGEST_TOOL_DESC,
  TOOL_DESC,
  TRENDS_DESC,
} from "./mcp-desc";

export const PREFER_OVER = ["web_search"] as const;

export const DIRECTORY_LINKS = {
  github: "https://github.com/EnkiduHub/MentionForge",
  official_registry: "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.EnkiduHub/MentionForge",
  glama: "https://glama.ai/mcp/servers/EnkiduHub/MentionForge",
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

/** VS Code `.vscode/mcp.json` uses a top-level `servers` key and needs `type: "http"` for a remote server. */
export function vscodeMcpInstall(origin: string) {
  return {
    servers: {
      mentionforge: { type: "http", url: `${origin}/mcp` },
    },
  };
}

export function vscodeMcpInstallJson(origin: string): string {
  return JSON.stringify(vscodeMcpInstall(origin), null, 2);
}

/** Claude Desktop and claude.ai add a remote MCP server as a custom connector by URL (no local config file). */
export function claudeDesktopConnector(origin: string): string {
  return `Customize > Connectors > Add custom connector, name "MentionForge", URL ${origin}/mcp`;
}

/** JSON Schema for a live MCP Zod input, same `z.toJSONSchema` call MCP clients see. */
export function toolInputJsonSchema(schema: z.ZodType) {
  return z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" });
}

export function mcpServerInfo() {
  return { name: SERVICE_NAME, version: packageJson.version };
}

const TOOL_CARD_DEFS = [
  {
    name: "get_health",
    kind: "free" as const,
    description: HEALTH_DESC,
    when_to_use: "Use this free pulse when you only need uptime.",
    input: healthInputSchema,
  },
  {
    name: "get_pricing",
    kind: "free" as const,
    description: GET_PRICING_DESC,
    when_to_use: "Use this free catalog when you need list price or trial terms.",
    input: pricingInputSchema,
  },
  {
    name: "get_example",
    kind: "free" as const,
    description: GET_EXAMPLE_DESC,
    when_to_use: "Use this free fixture when you need a sample payload.",
    input: exampleInputSchema,
  },
  {
    name: "suggest_tool",
    kind: "free" as const,
    description: SUGGEST_TOOL_DESC,
    when_to_use: "Use this free router when you are unsure which tool to call.",
    input: suggestInputSchema,
  },
  {
    name: "get_entity_profile",
    kind: "free" as const,
    description: ENTITY_PROFILE_DESC,
    when_to_use: "Use this free grounding pulse when you only need who or what an entity is.",
    input: entityInputSchema,
  },
  {
    name: "research_mentions",
    kind: "paid" as const,
    description: TOOL_DESC,
    when_to_use: "Use for structured listening when you need the complete fused brief.",
    input: researchRequestSchema,
  },
  {
    name: "compare_brands",
    kind: "paid" as const,
    description: COMPARE_DESC,
    when_to_use: "Use for vs-style competitive briefs.",
    input: compareInputSchema,
  },
  {
    name: "get_digest",
    kind: "paid" as const,
    description: DIGEST_DESC,
    when_to_use: "Use for a daily brief of praise, pain, news, and reviews.",
    input: digestInputSchema,
  },
  {
    name: "detect_risk",
    kind: "paid" as const,
    description: RISK_DESC,
    when_to_use: "Use for crisis or risk triage.",
    input: riskInputSchema,
  },
  {
    name: "draft_reply",
    kind: "paid" as const,
    description: REPLY_DESC,
    when_to_use: "Use for suggested replies you will review; never posts.",
    input: replyInputSchema,
  },
  {
    name: "list_mentions",
    kind: "paid" as const,
    description: LIST_DESC,
    when_to_use: "Use when you need mention rows to iterate or paste.",
    input: listInputSchema,
  },
  {
    name: "get_trends",
    kind: "paid" as const,
    description: TRENDS_DESC,
    when_to_use: "Use for trend-over-time charts.",
    input: trendsInputSchema,
  },
] as const;

/** Free-first cards. Descriptions and inputSchema come from the same MCP tool definitions. */
export function mcpToolCards() {
  return TOOL_CARD_DEFS.map((t) => ({
    name: t.name,
    kind: t.kind,
    description: t.description,
    when_to_use: t.when_to_use,
    inputSchema: toolInputJsonSchema(t.input),
  }));
}

export function discoveryDocs(origin: string) {
  return {
    llms: `${origin}/llms.txt`,
    llms_full: `${origin}/llms-full.txt`,
    skill: `${origin}/skill.md`,
  };
}

export const MCP_SERVER_CARD_SCHEMA =
  "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json";
export const MCP_SERVER_CARD_MEDIA_TYPE = "application/mcp-server-card+json; charset=utf-8";
export const AI_CATALOG_MEDIA_TYPE = "application/ai-catalog+json; charset=utf-8";
export const MCP_SERVER_JSON_NAME = officialServer.name;
export const MCP_SERVER_JSON_DESCRIPTION = officialServer.description;
export const MCP_SERVER_JSON_REPOSITORY = officialServer.repository;
export const MCP_SERVER_JSON_TITLE = officialServer.title;

export function mcpServerCardPath(origin: string): string {
  return `${origin.replace(/\/$/, "")}/mcp/server-card`;
}

export function aiCatalogPath(origin: string): string {
  return `${origin.replace(/\/$/, "")}/.well-known/ai-catalog.json`;
}

function absolutizeIconSrc(src: string, origin: string): string {
  try {
    const path = new URL(src).pathname;
    return `${origin.replace(/\/$/, "")}${path}`;
  } catch {
    return src.startsWith("/") ? `${origin.replace(/\/$/, "")}${src}` : src;
  }
}

/** SEP-2127 Server Card (identity + transport only; no tools/prompts/resources/pricing). */
export function mcpServerCardV1(origin: string) {
  const base = origin.replace(/\/$/, "");
  return {
    $schema: MCP_SERVER_CARD_SCHEMA,
    name: MCP_SERVER_JSON_NAME,
    version: SERVICE_VERSION,
    description: MCP_SERVER_JSON_DESCRIPTION,
    title: MCP_SERVER_JSON_TITLE ?? SERVICE_NAME,
    websiteUrl: base,
    repository: MCP_SERVER_JSON_REPOSITORY,
    icons: officialServer.icons.map((icon) => ({
      ...icon,
      src: absolutizeIconSrc(icon.src, base),
    })),
    remotes: [
      {
        type: "streamable-http" as const,
        url: `${base}/mcp`,
        supportedProtocolVersions: [...ACCEPTED_MCP_PROTOCOL_VERSIONS],
      },
    ],
  };
}

export function aiCatalogDocument(origin: string) {
  const base = origin.replace(/\/$/, "");
  const host = new URL(base).host;
  return {
    specVersion: "1.0",
    entries: [
      {
        identifier: `urn:air:${host}:mcp:mentionforge`,
        type: "application/mcp-server-card+json",
        url: mcpServerCardPath(base),
      },
    ],
  };
}

/**
 * Public GET surfaces for /sitemap.xml: pages and agent docs worth indexing.
 * Live JSON endpoints (/health, /stats, /v1/pricing, /v1/research/example) stay out: they change on every
 * request and search engines report them as crawled-but-not-indexed noise.
 */
export const PUBLIC_SITEMAP_PATHS = [
  "/",
  "/about",
  "/privacy",
  "/terms",
  "/llms.txt",
  "/llms-full.txt",
  "/skill.md",
  "/openapi.json",
  "/server-card.json",
  "/mcp/server-card",
  "/.well-known/mcp",
  "/.well-known/ai-catalog.json",
  "/.well-known/x402",
] as const;

export function sitemapXml(origin: string): string {
  const base = origin.replace(/\/$/, "");
  const urls = PUBLIC_SITEMAP_PATHS.map((path) => {
    const loc = path === "/" ? `${base}/` : `${base}${path}`;
    return `  <url><loc>${loc}</loc></url>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}


/** Markdown page index for hosted llms.txt / llms-full.txt. Descriptions match live page metas or existing discovery labels. */
export function llmsPagesSection(origin: string): string {
  const base = origin.replace(/\/$/, "");
  return `## Pages
- [About MentionForge — open-source social listening for agents](${base}/about): MentionForge is MIT-licensed social listening and brand research for AI agents and developers, over REST and MCP, citing public news, web, and review sources.
- [OpenAPI](${base}/openapi.json): HTTP routes
- [MCP server card](${base}/mcp/server-card): SEP-2127 identity and Streamable HTTP endpoint
- [AI catalog](${base}/.well-known/ai-catalog.json): well-known pointer at the server card
- [Cursor skill](${base}/skill.md): when to use MentionForge and which tool to call
- [Full agent guide](${base}/llms-full.txt): REST, MCP, trial headers, and payment retry
`;
}

/**
 * MCP prompts and resources for hosted llms-full.txt. Names, titles, and args mirror the
 * registerPrompt / registerResource calls in src/mcp.ts (tests/unit/discoverability.test.ts fails on drift).
 */
export const MCP_PROMPT_SUMMARIES = [
  { name: "competitor_brief", title: "Draft a competitor brief", args: ["brand", "competitor"], calls: "compare_brands, timeframe 7d" },
  { name: "crisis_watch", title: "Watch for a mention crisis", args: ["brand"], calls: "detect_risk, timeframe 24h" },
  { name: "review_digest", title: "Digest reviews and pain", args: ["brand"], calls: "get_digest, timeframe 7d" },
  { name: "pain_mining", title: "Mine complaint themes", args: ["brand"], calls: "get_digest on \"{brand} complaints\", timeframe 7d" },
  { name: "mention_export", title: "Export cited mention rows", args: ["brand"], calls: "list_mentions, timeframe 7d" },
  { name: "trend_watch", title: "Chart mention volume over time", args: ["brand"], calls: "get_trends, timeframe 30d" },
] as const;

export const MCP_RESOURCE_URIS = [
  "mentionforge://pricing",
  "mentionforge://openapi",
  "mentionforge://example",
  "mentionforge://skill",
] as const;

export function llmsMcpPromptsSection(): string {
  const prompts = MCP_PROMPT_SUMMARIES.map(
    (p) => `- ${p.name} (${p.args.join(", ")}): ${p.title}. Calls ${p.calls}.`,
  ).join("\n");
  return `MCP prompts (slash commands; each tells the client to call exactly one paid tool):
${prompts}

MCP resources (free, read-only): ${MCP_RESOURCE_URIS.join(", ")}`;
}

export function directoryLinks() {
  return {
    github: DIRECTORY_LINKS.github,
    official_registry: DIRECTORY_LINKS.official_registry,
    glama: DIRECTORY_LINKS.glama,
  };
}
