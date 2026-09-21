import { z } from "zod";
import {
  intentSchema,
  isoRangeSchema,
  platformSchema,
  shareOfVoiceSchema,
  signalsSchema,
  timeframeSchema,
  REQUEST_FIELD_DESC,
} from "./research";
import { MAX_QUERY_CHARS } from "../lib/constants";

const compactMentionSchema = z.object({
  id: z.string().describe("Mention id from this gather"),
  platform: platformSchema.describe("Surface this mention was gathered from"),
  url: z.string().describe("Canonical URL, or empty when the source had no permalink"),
  author: z.string().describe("Display name or handle; may be empty"),
  text: z.string().describe("Mention body, truncated"),
  sentiment: z.number().min(-1).max(1).describe("Per-mention sentiment from -1 to 1"),
  intent: intentSchema.optional().describe("Optional intent class for this mention"),
});

const lensMetaSchema = z.object({
  request_id: z.string().describe("Request correlation id"),
  latency_ms: z.number().describe("Engine wall time in milliseconds (not billed)"),
  sources_used: z.array(z.string()).describe("Adapter ids that contributed data"),
  billing: z
    .object({
      amount_usdc: z.string().describe("USDC charged for this call (`0` on trial/sandbox/replay)"),
      tx_hash: z.string().nullable().describe("Settlement transaction hash, or null until settle / on trial"),
      free_trial: z.boolean().describe("True when this call used trial or sandbox and was not settled"),
    })
    .describe("Charge record for this call (never cached)"),
  as_of: z.string().optional().describe("When this intelligence was produced (ISO-8601)"),
  freshness: z.enum(["live", "cached"]).optional().describe("live = this call; cached = research body reused"),
  next_queries: z.array(z.string()).max(3).optional().describe("Up to three follow-up queries"),
});

export const compareInputSchema = z
  .object({
    brand: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .describe("Primary brand, product, or company to compare. Required. Do not include URLs."),
    competitors: z
      .array(z.string().trim().min(1).max(80))
      .min(1)
      .max(2)
      .describe("One or two competitor names. Combined vs-query cannot exceed 200 characters."),
    timeframe: timeframeSchema.describe(REQUEST_FIELD_DESC.timeframe).optional(),
    platforms: z.array(platformSchema).min(1).max(5).describe(REQUEST_FIELD_DESC.platforms).optional(),
    limit: z.number().int().min(1).max(50).describe(REQUEST_FIELD_DESC.limit).optional(),
  })
  .strip();

export const digestInputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(MAX_QUERY_CHARS)
      .describe("Brand, product, or topic to digest. Required. Max 200 characters."),
    timeframe: timeframeSchema.describe(REQUEST_FIELD_DESC.timeframe).optional(),
    platforms: z.array(platformSchema).min(1).max(5).describe(REQUEST_FIELD_DESC.platforms).optional(),
    limit: z.number().int().min(1).max(50).describe(REQUEST_FIELD_DESC.limit).optional(),
  })
  .strip();

export const riskInputSchema = digestInputSchema;

export const replyInputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(MAX_QUERY_CHARS)
      .describe("Brand or topic whose mentions should seed unsent reply drafts. Required."),
    mention_id: z
      .string()
      .max(80)
      .describe("Optional mention id from this gather only. Ignored when it is not in this response.")
      .optional(),
    quote: z
      .string()
      .max(500)
      .describe("Optional quote to reply to. Never fetched as a URL. Used when mention_id is absent.")
      .optional(),
    mention_url: z
      .string()
      .max(500)
      .describe("Optional mention URL used only as an id match. MentionForge never fetches this URL.")
      .optional(),
    stance: z
      .enum(["supportive", "neutral", "defensive"])
      .describe("Optional tone for the unsent draft. Default neutral. This tool never posts.")
      .optional(),
    timeframe: timeframeSchema.describe(REQUEST_FIELD_DESC.timeframe).optional(),
    platforms: z.array(platformSchema).min(1).max(5).describe(REQUEST_FIELD_DESC.platforms).optional(),
    limit: z.number().int().min(1).max(50).describe(REQUEST_FIELD_DESC.limit).optional(),
  })
  .strip();

export const suggestInputSchema = z
  .object({
    need: z
      .string()
      .trim()
      .min(1)
      .max(MAX_QUERY_CHARS)
      .describe("What you want to learn or do. Required. Max 200 characters. URLs and wallets are stripped."),
  })
  .strip();

export const entityInputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(MAX_QUERY_CHARS)
      .describe("Company, product, or brand to identify on Wikipedia and Wikidata. Required. Max 200 characters."),
    language: z
      .string()
      .regex(/^[a-z]{2}$/, "ISO 639-1 two-letter code")
      .describe("Optional ISO 639-1 two-letter Wikipedia language. Default en.")
      .optional(),
  })
  .strip();

export const compareOutputSchema = z.object({
  query: z.string().describe("Canonical vs-query used for gather"),
  brands: z.array(z.string()).describe("Brand plus competitors in request order"),
  share_of_voice: z.array(shareOfVoiceSchema).describe("Longest-brand-first attribution"),
  brands_detail: z
    .array(
      z.object({
        brand: z.string().describe("Brand name"),
        sentiment: z.number().describe("Mean sentiment of mentions attributed to this brand"),
        mention_count: z.number().int().describe("Attributed mention count"),
        themes: z.array(z.string()).describe("Up to three theme labels"),
      }),
    )
    .describe("Per-brand compact rollup"),
  citations: z
    .array(
      z.object({
        url: z.string().describe("Source URL"),
        title: z.string().describe("Source title"),
        source: z.string().describe("Publisher or site label"),
      }),
    )
    .describe("Compact citations (max 8)"),
  signals: signalsSchema.optional().describe("Spike and negative-concentration flags"),
  meta: lensMetaSchema.describe("Billing and freshness for this call"),
});

export const digestOutputSchema = z.object({
  query: z.string().describe("Echo of the researched query"),
  groups: z
    .object({
      praise: z.array(compactMentionSchema).describe("Up to 5 praise mentions"),
      pain: z.array(compactMentionSchema).describe("Up to 5 complaint mentions"),
      news: z.array(compactMentionSchema).describe("Up to 5 news-intent mentions"),
      reviews: z.array(compactMentionSchema).describe("Up to 5 review-platform mentions"),
      reply_worthy: z.array(compactMentionSchema).describe("Up to 5 questions or complaints worth a human reply"),
    })
    .describe("Grouped mentions, each list capped at 5"),
  meta: lensMetaSchema.describe("Billing and freshness for this call"),
});

export const riskOutputSchema = z.object({
  query: z.string().describe("Echo of the researched query"),
  signals: signalsSchema.describe("Crisis-style risk from volume spike and negatives"),
  negatives: z.array(compactMentionSchema).describe("Up to 5 most negative mentions"),
  next_queries: z.array(z.string()).max(3).describe("Follow-up queries"),
  meta: lensMetaSchema.describe("Billing and freshness for this call"),
});

export const replyOutputSchema = z.object({
  drafts: z
    .array(
      z.object({
        text: z.string().describe("Unsent reply copy. Review before sending. This tool does not post."),
        source_url: z.string().describe("URL of the mention this draft is about"),
        mention_id: z.string().describe("Mention id from this gather"),
        unsent: z.literal(true).describe("Always true. MentionForge never posts replies."),
      }),
    )
    .max(3)
    .describe("One to three unsent drafts"),
  meta: lensMetaSchema.describe("Billing and freshness for this call"),
});

export const suggestOutputSchema = z.object({
  tool: z.string().describe("Single tool to call next"),
  reason: z.string().describe("Why this tool fits the need"),
  example_args: z.record(z.string(), z.unknown()).describe("Sanitized example arguments for that tool"),
});

export const entityOutputSchema = z.object({
  query: z.string().describe("Sanitized entity query"),
  title: z.string().describe("Best Wikipedia or Wikidata label"),
  description: z.string().describe("Short identity blurb"),
  wikipedia_url: z.string().optional().describe("Allowlisted Wikipedia page when found"),
  wikidata_url: z.string().optional().describe("Wikidata entity URL when found"),
  official_url: z.string().optional().describe("Official site from Wikidata P856 when present"),
  as_of: z.string().describe("When this card was produced (ISO-8601)"),
});

export type CompareInput = z.infer<typeof compareInputSchema>;
export type DigestInput = z.infer<typeof digestInputSchema>;
export type RiskInput = z.infer<typeof riskInputSchema>;
export type ReplyInput = z.infer<typeof replyInputSchema>;
export type SuggestInput = z.infer<typeof suggestInputSchema>;
export type EntityInput = z.infer<typeof entityInputSchema>;

export { isoRangeSchema };
