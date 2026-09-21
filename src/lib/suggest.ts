import { MAX_QUERY_CHARS, SAMPLE_QUERY } from "./constants";
import { splitBrands } from "./research/query-plan";

export function sanitizeAgentText(raw: string, max = MAX_QUERY_CHARS): string {
  return raw
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/\b(PAYMENT-SIGNATURE|X-PAYMENT|X-Wallet|X-Sandbox-Key|Idempotency-Key)\b\S*/gi, "")
    .replace(/0x[a-fA-F0-9]{40}/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function suggestTool(needRaw: string): {
  tool: string;
  reason: string;
  example_args: Record<string, unknown>;
} {
  const need = sanitizeAgentText(needRaw);
  const n = need.toLowerCase();
  const q = need || SAMPLE_QUERY;
  if (/\b(compare|vs|versus|competitor|share of voice|sov)\b/.test(n)) {
    const brands = splitBrands(q);
    return {
      tool: "compare_brands",
      reason: "Need is a competitive or vs-style brief. Call exactly one paid tool.",
      example_args: {
        brand: brands?.[0] || q.split(/\s+vs\.?\s+/i)[0] || q,
        competitors: brands && brands.length > 1 ? brands.slice(1, 3) : ["competitor"],
      },
    };
  }
  if (/\b(digest|daily brief|praise|pain|review digest)\b/.test(n)) {
    return {
      tool: "get_digest",
      reason: "Need is a grouped brief, not a full mention dump. Call exactly one paid tool.",
      example_args: { query: q, timeframe: "7d" },
    };
  }
  if (/\b(risk|crisis|spike|outage|incident)\b/.test(n)) {
    return {
      tool: "detect_risk",
      reason: "Need is crisis or spike triage. Call exactly one paid tool.",
      example_args: { query: q, timeframe: "24h" },
    };
  }
  if (/\b(reply|respond|draft)\b/.test(n)) {
    return {
      tool: "draft_reply",
      reason: "Need is unsent reply copy. Call exactly one paid tool. This never posts.",
      example_args: { query: q, stance: "neutral" },
    };
  }
  if (/\b(who is|what is|wikipedia|wikidata|entity|identity)\b/.test(n)) {
    return {
      tool: "entity_profile",
      reason: "Need is identity grounding, not social listening.",
      example_args: { query: q },
    };
  }
  if (/\b(example|sample|snapshot|fixture)\b/.test(n)) {
    return { tool: "get_example", reason: "Need is a frozen payload, not a live gather.", example_args: {} };
  }
  if (/\b(price|pricing|cost|trial|how much)\b/.test(n)) {
    return { tool: "get_pricing", reason: "Need is list price or trial terms.", example_args: {} };
  }
  if (/\b(health|uptime|liveness|ping)\b/.test(n)) {
    return { tool: "health", reason: "Need is Worker liveness, not research.", example_args: {} };
  }
  return {
    tool: "research_mentions",
    reason: "Default structured listening. Call exactly one paid tool for this question.",
    example_args: { query: q, timeframe: "7d" },
  };
}
