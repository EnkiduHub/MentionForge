import { z } from "zod";
import packageJson from "../../package.json" with { type: "json" };
import { SERVICE_NAME } from "./constants";
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

export function directoryLinks() {
  return {
    github: DIRECTORY_LINKS.github,
    official_registry: DIRECTORY_LINKS.official_registry,
    glama: DIRECTORY_LINKS.glama,
    smithery: DIRECTORY_LINKS.smithery,
  };
}
