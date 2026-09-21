import { z } from "zod";
import { MAX_QUERY_CHARS, MAX_TIMEFRAME_DAYS, PLATFORMS, SAMPLE_QUERY, type Platform } from "../lib/constants";

/** Shared with OpenAPI `researchJsonSchema()` so REST and MCP stay aligned. */
export const REQUEST_FIELD_DESC = {
  query:
    "Natural-language or structured query about a product, company, brand, topic, or competitor. Required. Max 200 characters.",
  platforms:
    "Which surfaces to search. Default all of x, reddit, web, reviews, news. x and reddit use public/web adapters unless the operator enabled native APIs — this is not a guarantee of official Reddit or X search.",
  timeframe:
    "Lookback window: 24h, 7d, 30d, or 90d, or a {from,to} ISO-8601 range (max 90 days). Default 7d.",
  timeframe_named: "Named lookback: 24h, 7d, 30d, or 90d.",
  timeframe_from: "Custom range start (ISO-8601). Must be earlier than `to`.",
  timeframe_to: "Custom range end (ISO-8601). Must be later than `from`. Window max 90 days.",
  limit: "Maximum mentions to return (integer 1–50). Default 20. Does not change the $0.02 USDC price.",
  include_summary: "When true (default), include an executive `summary` string. Set false for mentions-only payloads.",
  min_engagement: "Optional minimum engagement score. Omit to include all mentions in the window.",
  language: "Optional ISO 639-1 two-letter code (e.g. en). Omit for mixed-language results.",
  view:
    "Optional response size. `full` (default when omitted) returns the complete mention list; `compact` returns at most 8 mentions and 8 citations. Does not change the $0.02 USDC price or aggregates.",
  focus:
    "Optional intent filter applied only to returned `mentions` (praise, complaint, question, buying, news, other). Volume and sentiment stay on the full fused set.",
  include_markdown:
    "When true, add a deterministic `markdown` brief for pasting into an agent context. Does not change the $0.02 USDC price.",
} as const;

export const intentSchema = z
  .enum(["praise", "complaint", "question", "buying", "news", "other"])
  .describe("Mention intent class derived from text and sentiment");

export const aspectSchema = z
  .enum(["pricing", "support", "reliability", "security", "performance"])
  .describe("Product aspect tagged from mention text");

export const platformSchema = z
  .enum(["x", "reddit", "web", "reviews", "news"])
  .describe("Mention surface id: x, reddit, web, reviews, or news");

export const timeframeEnumSchema = z.enum(["24h", "7d", "30d", "90d"]).describe(REQUEST_FIELD_DESC.timeframe_named);

const isoStamp = z
  .string()
  .refine((s) => Number.isFinite(Date.parse(s)), { message: "Must be an ISO-8601 timestamp" })
  .describe("ISO-8601 timestamp");

export const isoRangeSchema = z
  .object({
    from: isoStamp.describe(REQUEST_FIELD_DESC.timeframe_from),
    to: isoStamp.describe(REQUEST_FIELD_DESC.timeframe_to),
  })
  .refine((v) => Date.parse(v.from) < Date.parse(v.to), {
    message: "`from` must be earlier than `to`",
  })
  .refine(
    (v) => Date.parse(v.to) - Date.parse(v.from) <= MAX_TIMEFRAME_DAYS * 86400000,
    { message: `Custom range cannot exceed ${MAX_TIMEFRAME_DAYS} days` },
  )
  .describe("Custom inclusive ISO-8601 from/to window, maximum 90 days");

export const timeframeSchema = z
  .union([timeframeEnumSchema, isoRangeSchema])
  .describe(REQUEST_FIELD_DESC.timeframe);

export const researchRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(MAX_QUERY_CHARS).describe(REQUEST_FIELD_DESC.query),
    platforms: z.array(platformSchema).min(1).max(5).describe(REQUEST_FIELD_DESC.platforms).default([...PLATFORMS]),
    timeframe: timeframeSchema.describe(REQUEST_FIELD_DESC.timeframe).default("7d"),
    limit: z.number().int().min(1).max(50).describe(REQUEST_FIELD_DESC.limit).default(20),
    include_summary: z.boolean().describe(REQUEST_FIELD_DESC.include_summary).default(true),
    min_engagement: z.number().min(0).describe(REQUEST_FIELD_DESC.min_engagement).optional(),
    language: z
      .string()
      .regex(/^[a-z]{2}$/, "ISO 639-1 two-letter code")
      .describe(REQUEST_FIELD_DESC.language)
      .optional(),
    view: z.enum(["full", "compact"]).describe(REQUEST_FIELD_DESC.view).optional(),
    focus: intentSchema.describe(REQUEST_FIELD_DESC.focus).optional(),
    include_markdown: z.boolean().describe(REQUEST_FIELD_DESC.include_markdown).optional(),
  })
  .strip();

export type Intent = z.infer<typeof intentSchema>;
export type Aspect = z.infer<typeof aspectSchema>;
export type ResearchRequest = z.infer<typeof researchRequestSchema>;
export type Timeframe = z.infer<typeof timeframeSchema>;

export const mentionSchema = z
  .object({
    id: z.string().describe("Stable mention id within this response"),
    platform: platformSchema.describe("Surface this mention was gathered from"),
    url: z.string().describe("Canonical URL of the mention, or empty when the source had no permalink"),
    author: z.string().describe("Display name or handle; may be empty"),
    timestamp: z.string().describe("When the mention was published or accessed (ISO-8601 when known)"),
    text: z.string().describe("Mention body, truncated to the engine cap"),
    engagement: z.number().describe("Relative engagement score (0 when unknown)"),
    sentiment: z.number().min(-1).max(1).describe("Per-mention sentiment from -1 (negative) to 1 (positive)"),
    intent: intentSchema.optional().describe("Optional intent class for this mention"),
    aspects: z.array(aspectSchema).optional().describe("Optional product aspects tagged on this mention"),
    relevance: z.number().min(0).max(1).optional().describe("Optional 0–1 overlap with the query"),
  })
  .strict();

export const themeSchema = z.object({
  theme: z.string().describe("Short theme label clustered from mention text"),
  count: z.number().int().describe("How many mentions support this theme"),
  examples: z.array(z.string()).describe("Short supporting snippets"),
});

export const citationSchema = z.object({
  url: z.string().describe("Source URL"),
  title: z.string().describe("Source title"),
  source: z.string().describe("Publisher or site label"),
  accessed_at: z.string().describe("When MentionForge fetched this source (ISO-8601)"),
});

export const volumeSchema = z.object({
  total: z.number().int().describe("Total mentions in the window after filtering"),
  by_platform: z
    .object({
      x: z.number().int().describe("Mentions attributed to x"),
      reddit: z.number().int().describe("Mentions attributed to reddit"),
      web: z.number().int().describe("Mentions attributed to web"),
      reviews: z.number().int().describe("Mentions attributed to reviews"),
      news: z.number().int().describe("Mentions attributed to news"),
    })
    .describe("Per-platform mention counts (zeros when a surface returned nothing)"),
  trend: z
    .array(
      z.object({
        t: z.string().describe("Bucket start (ISO-8601)"),
        count: z.number().int().describe("Mentions in this bucket"),
      }),
    )
    .describe("Time-bucketed mention counts across the window"),
});

export const sentimentSchema = z.object({
  overall: z.number().min(-1).max(1).describe("Aggregate sentiment from -1 to 1"),
  positive: z.number().describe("Share of positive mentions (percent)"),
  neutral: z.number().describe("Share of neutral mentions (percent)"),
  negative: z.number().describe("Share of negative mentions (percent)"),
  distribution: z
    .object({
      positive: z.number().describe("Positive share (percent)"),
      neutral: z.number().describe("Neutral share (percent)"),
      negative: z.number().describe("Negative share (percent)"),
      by_platform: z.record(z.string(), z.number()).describe("Mention counts keyed by platform id"),
    })
    .describe("Breakdown of sentiment classes"),
  by_platform: z
    .record(z.string(), z.number())
    .optional()
    .describe("Optional per-platform sentiment from -1 to 1"),
});

export const shareOfVoiceSchema = z.object({
  brand: z.string().describe("Brand or `other` when no brand token matched"),
  mentions: z.number().int().describe("Mentions attributed to this brand"),
  engagement: z.number().describe("Sum of engagement for attributed mentions"),
  share: z.number().min(0).max(1).describe("Fraction of fused mentions (0–1)"),
});

export const signalsSchema = z.object({
  risk: z.enum(["low", "elevated", "high"]).describe("Crisis-style risk from volume spike and negatives"),
  spike: z.boolean().describe("True when the latest trend bucket is elevated vs earlier mean"),
  reasons: z.array(z.string()).describe("Short reasons the agent can quote"),
});

export const voiceSchema = z.object({
  author: z.string().describe("Display name or handle"),
  platform: platformSchema.describe("Surface this voice was seen on"),
  mentions: z.number().int().describe("How many fused mentions this author has"),
  engagement: z.number().describe("Sum of engagement"),
});

export const billingSchema = z.object({
  amount_usdc: z.string().describe("USDC charged for this call (`0` on trial/sandbox/replay)"),
  tx_hash: z.string().nullable().describe("Settlement transaction hash, or null until settle / on trial"),
  free_trial: z.boolean().describe("True when this call used trial or sandbox and was not settled"),
});

export const metaSchema = z.object({
  request_id: z.string().describe("Request correlation id"),
  latency_ms: z.number().describe("Engine wall time in milliseconds (not billed)"),
  sources_used: z.array(z.string()).describe("Adapter ids that contributed data"),
  billing: billingSchema.describe("Charge record for this call (never cached)"),
  confidence: z.number().min(0).max(1).optional().describe("Optional 0–1 confidence in the aggregate"),
  degraded: z.array(z.string()).optional().describe("Optional list of degraded or skipped adapters"),
  as_of: z.string().optional().describe("When this intelligence was produced (ISO-8601)"),
  freshness: z.enum(["live", "cached"]).optional().describe("live = this call; cached = research body reused, new billing"),
  next_queries: z.array(z.string()).max(3).optional().describe("Up to three follow-up queries the agent can issue"),
});

export const researchResponseSchema = z.object({
  query: z.string().describe("Echo of the researched query"),
  timeframe: z
    .union([z.string().describe("Named window echoed back"), isoRangeSchema])
    .describe("Echo of the requested window"),
  volume: volumeSchema.describe("Mention counts and trend for the window"),
  sentiment: sentimentSchema.describe("Aggregate and per-class sentiment"),
  themes: z.array(themeSchema).describe("Ranked themes extracted from mentions"),
  mentions: z.array(mentionSchema).describe("Cited mention rows (may be empty — empty windows still succeed)"),
  summary: z.string().optional().describe("Executive summary when include_summary was true"),
  citations: z.array(citationSchema).describe("Sources used to build the brief"),
  share_of_voice: z.array(shareOfVoiceSchema).optional().describe("Present when the query is a vs / multi-brand compare"),
  signals: signalsSchema.optional().describe("Spike and negative-concentration flags for this window"),
  voices: z.array(voiceSchema).optional().describe("Top non-placeholder authors by engagement"),
  markdown: z.string().optional().describe("Deterministic pasteable brief when include_markdown was true"),
  meta: metaSchema.describe("Request metadata including billing and freshness"),
});

export type ResearchResponse = z.infer<typeof researchResponseSchema>;
export type Mention = z.infer<typeof mentionSchema>;
export type CachedResearch = Omit<ResearchResponse, "meta"> & {
  meta: Pick<ResearchResponse["meta"], "sources_used" | "confidence" | "degraded" | "as_of">;
};

export function emptyPlatformCounts(): Record<Platform, number> {
  return { x: 0, reddit: 0, web: 0, reviews: 0, news: 0 };
}

export function parseResearchInput(raw: unknown): ResearchRequest {
  return researchRequestSchema.parse(raw);
}

export function researchJsonSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "MentionForgeResearchRequest",
    type: "object",
    additionalProperties: false,
    required: ["query"],
    properties: {
      query: {
        type: "string",
        minLength: 1,
        maxLength: MAX_QUERY_CHARS,
        description: REQUEST_FIELD_DESC.query,
      },
      platforms: {
        type: "array",
        items: { type: "string", enum: PLATFORMS },
        default: PLATFORMS,
        description: REQUEST_FIELD_DESC.platforms,
      },
      timeframe: {
        description: REQUEST_FIELD_DESC.timeframe,
        default: "7d",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 50,
        default: 20,
        description: REQUEST_FIELD_DESC.limit,
      },
      include_summary: {
        type: "boolean",
        default: true,
        description: REQUEST_FIELD_DESC.include_summary,
      },
      min_engagement: {
        type: "number",
        minimum: 0,
        description: REQUEST_FIELD_DESC.min_engagement,
      },
      language: {
        type: "string",
        pattern: "^[a-z]{2}$",
        description: REQUEST_FIELD_DESC.language,
      },
      view: {
        type: "string",
        enum: ["full", "compact"],
        description: REQUEST_FIELD_DESC.view,
      },
      focus: {
        type: "string",
        enum: ["praise", "complaint", "question", "buying", "news", "other"],
        description: REQUEST_FIELD_DESC.focus,
      },
      include_markdown: {
        type: "boolean",
        description: REQUEST_FIELD_DESC.include_markdown,
      },
    },
    example: {
      query: SAMPLE_QUERY,
      platforms: ["reddit", "news", "web"],
      timeframe: "7d",
      limit: 20,
      include_summary: true,
    },
  };
}
