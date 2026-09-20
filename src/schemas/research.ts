import { z } from "zod";
import { MAX_QUERY_CHARS, MAX_TIMEFRAME_DAYS, PLATFORMS, SAMPLE_QUERY, type Platform } from "../lib/constants";

export const platformSchema = z.enum(["x", "reddit", "web", "reviews", "news"]);

export const timeframeEnumSchema = z.enum(["24h", "7d", "30d", "90d"]);

const isoStamp = z
  .string()
  .refine((s) => Number.isFinite(Date.parse(s)), { message: "Must be an ISO-8601 timestamp" });

export const isoRangeSchema = z
  .object({
    from: isoStamp,
    to: isoStamp,
  })
  .refine((v) => Date.parse(v.from) < Date.parse(v.to), {
    message: "`from` must be earlier than `to`",
  })
  .refine(
    (v) => Date.parse(v.to) - Date.parse(v.from) <= MAX_TIMEFRAME_DAYS * 86400000,
    { message: `Custom range cannot exceed ${MAX_TIMEFRAME_DAYS} days` },
  );

export const timeframeSchema = z.union([timeframeEnumSchema, isoRangeSchema]);

export const researchRequestSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(MAX_QUERY_CHARS)
      .describe("Natural-language or structured query about a product, company, brand, topic, or competitor"),
    platforms: z.array(platformSchema).min(1).max(5).default([...PLATFORMS]),
    timeframe: timeframeSchema.default("7d"),
    limit: z.number().int().min(1).max(50).default(20),
    include_summary: z.boolean().default(true),
    min_engagement: z.number().min(0).optional(),
    language: z
      .string()
      .regex(/^[a-z]{2}$/, "ISO 639-1 two-letter code")
      .optional(),
  })
  .strip();

export type ResearchRequest = z.infer<typeof researchRequestSchema>;
export type Timeframe = z.infer<typeof timeframeSchema>;

export const mentionSchema = z
  .object({
    id: z.string(),
    platform: platformSchema,
    url: z.string(),
    author: z.string(),
    timestamp: z.string(),
    text: z.string(),
    engagement: z.number(),
    sentiment: z.number().min(-1).max(1),
  })
  .strict();

export const themeSchema = z.object({
  theme: z.string(),
  count: z.number().int(),
  examples: z.array(z.string()),
});

export const citationSchema = z.object({
  url: z.string(),
  title: z.string(),
  source: z.string(),
  accessed_at: z.string(),
});

export const volumeSchema = z.object({
  total: z.number().int(),
  by_platform: z.object({
    x: z.number().int(),
    reddit: z.number().int(),
    web: z.number().int(),
    reviews: z.number().int(),
    news: z.number().int(),
  }),
  trend: z.array(z.object({ t: z.string(), count: z.number().int() })),
});

export const sentimentSchema = z.object({
  overall: z.number().min(-1).max(1),
  positive: z.number(),
  neutral: z.number(),
  negative: z.number(),
  distribution: z.object({
    positive: z.number(),
    neutral: z.number(),
    negative: z.number(),
    by_platform: z.record(z.string(), z.number()),
  }),
});

export const billingSchema = z.object({
  amount_usdc: z.string(),
  tx_hash: z.string().nullable(),
  free_trial: z.boolean(),
});

export const metaSchema = z.object({
  request_id: z.string(),
  latency_ms: z.number(),
  sources_used: z.array(z.string()),
  billing: billingSchema,
  confidence: z.number().min(0).max(1).optional(),
  degraded: z.array(z.string()).optional(),
  as_of: z.string().optional(),
  freshness: z.enum(["live", "cached"]).optional(),
  next_queries: z.array(z.string()).max(3).optional(),
});

export const researchResponseSchema = z.object({
  query: z.string(),
  timeframe: z.union([z.string(), isoRangeSchema]),
  volume: volumeSchema,
  sentiment: sentimentSchema,
  themes: z.array(themeSchema),
  mentions: z.array(mentionSchema),
  summary: z.string().optional(),
  citations: z.array(citationSchema),
  meta: metaSchema,
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
        description: "Product, company, brand, topic, or competitor",
      },
      platforms: {
        type: "array",
        items: { type: "string", enum: PLATFORMS },
        default: PLATFORMS,
      },
      timeframe: {
        description: '24h | 7d | 30d | 90d or { from, to } ISO range (max 90d)',
        default: "7d",
      },
      limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      include_summary: { type: "boolean", default: true },
      min_engagement: { type: "number", minimum: 0 },
      language: { type: "string", pattern: "^[a-z]{2}$" },
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
