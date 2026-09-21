import { MAX_QUERY_CHARS, SAMPLE_QUERY } from "./constants";
import { parseResearchInput, type Mention, type ResearchRequest, type ResearchResponse } from "../schemas/research";
import {
  compareInputSchema,
  digestInputSchema,
  listInputSchema,
  replyInputSchema,
  riskInputSchema,
  trendsInputSchema,
  type CompareInput,
  type DigestInput,
  type ListInput,
  type ReplyInput,
  type RiskInput,
  type TrendsInput,
} from "../schemas/lenses";
import { AgentError } from "../schemas/errors";
import { brandHits } from "./research/sov";
import { sanitizeAgentText } from "./suggest";
import { AI_TIMEOUT_MS } from "./constants";

type Compact = {
  id: string;
  platform: Mention["platform"];
  url: string;
  author: string;
  text: string;
  sentiment: number;
  intent?: Mention["intent"];
};

function compactOf(m: Mention): Compact {
  return {
    id: m.id,
    platform: m.platform,
    url: m.url,
    author: m.author,
    text: m.text,
    sentiment: m.sentiment,
    intent: m.intent,
  };
}

function take(list: Mention[], n: number): Compact[] {
  return list.slice(0, n).map(compactOf);
}

function lensMeta(full: ResearchResponse) {
  return {
    request_id: full.meta.request_id,
    latency_ms: full.meta.latency_ms,
    sources_used: full.meta.sources_used,
    billing: full.meta.billing,
    as_of: full.meta.as_of,
    freshness: full.meta.freshness,
    next_queries: full.meta.next_queries,
  };
}

function researchFromQuery(
  query: string,
  extra: { timeframe?: ResearchRequest["timeframe"]; platforms?: ResearchRequest["platforms"]; limit?: number },
): ResearchRequest {
  return parseResearchInput({
    query,
    timeframe: extra.timeframe,
    platforms: extra.platforms,
    limit: extra.limit,
    include_summary: true,
  });
}

export function mapCompare(raw: unknown): {
  input: CompareInput;
  research: ResearchRequest;
  hashObject: unknown;
  project: (full: ResearchResponse) => Record<string, unknown>;
} {
  const input = compareInputSchema.parse(raw);
  const brand = sanitizeAgentText(input.brand, 80);
  const competitors = input.competitors.map((c) => sanitizeAgentText(c, 80)).filter(Boolean);
  if (!brand || competitors.length < 1) {
    throw new AgentError("VALIDATION_ERROR", "Brand and at least one competitor are required.", {
      request_id: "compare",
    });
  }
  const query = [brand, ...competitors].join(" vs ");
  if (query.length > MAX_QUERY_CHARS) {
    throw new AgentError("VALIDATION_ERROR", "Combined compare query exceeds 200 characters.", {
      request_id: "compare",
      hint: "Shorten brand or competitor names.",
    });
  }
  const research = researchFromQuery(query, input);
  const hashObject = {
    tool: "compare_brands",
    brand,
    competitors,
    timeframe: input.timeframe,
    platforms: input.platforms,
    limit: input.limit,
  };
  return {
    input,
    research,
    hashObject,
    project: (full) => projectCompare(full, [brand, ...competitors]),
  };
}

export function mapDigest(raw: unknown): {
  input: DigestInput;
  research: ResearchRequest;
  hashObject: unknown;
  project: (full: ResearchResponse) => Record<string, unknown>;
} {
  const input = digestInputSchema.parse(raw);
  const query = sanitizeAgentText(input.query);
  const research = researchFromQuery(query, input);
  return {
    input,
    research,
    hashObject: { tool: "get_digest", ...input, query },
    project: (full) => projectDigest(full),
  };
}

export function mapRisk(raw: unknown): {
  input: RiskInput;
  research: ResearchRequest;
  hashObject: unknown;
  project: (full: ResearchResponse) => Record<string, unknown>;
} {
  const input = riskInputSchema.parse(raw);
  const query = sanitizeAgentText(input.query);
  const research = researchFromQuery(query, input);
  return {
    input,
    research,
    hashObject: { tool: "detect_risk", ...input, query },
    project: (full) => projectRisk(full),
  };
}

export function mapList(raw: unknown): {
  input: ListInput;
  research: ResearchRequest;
  hashObject: unknown;
  project: (full: ResearchResponse) => Record<string, unknown>;
} {
  const input = listInputSchema.parse(raw);
  const query = sanitizeAgentText(input.query);
  const research = researchFromQuery(query, input);
  return {
    input,
    research,
    hashObject: { tool: "list_mentions", ...input, query },
    project: (full) => projectList(full),
  };
}

export function mapTrends(raw: unknown): {
  input: TrendsInput;
  research: ResearchRequest;
  hashObject: unknown;
  project: (full: ResearchResponse) => Record<string, unknown>;
} {
  const input = trendsInputSchema.parse(raw);
  const query = sanitizeAgentText(input.query);
  const research = researchFromQuery(query, input);
  return {
    input,
    research,
    hashObject: { tool: "get_trends", ...input, query },
    project: (full) => projectTrends(full),
  };
}

export function mapReply(raw: unknown): {
  input: ReplyInput;
  research: ResearchRequest;
  hashObject: unknown;
  project: (full: ResearchResponse) => Record<string, unknown>;
} {
  const input = replyInputSchema.parse(raw);
  const query = sanitizeAgentText(input.query);
  const research = researchFromQuery(query, input);
  return {
    input,
    research,
    hashObject: { tool: "draft_reply", ...input, query },
    project: (full) => projectReply(full, input),
  };
}

function themesForBrand(full: ResearchResponse, attributed: Mention[]): string[] {
  const fromMentions = attributed.flatMap((m) => m.aspects ?? []);
  const hay = attributed.map((m) => m.text.toLowerCase()).join(" ");
  const fromCatalog = full.themes.filter((t) => hay.includes(t.theme.toLowerCase())).map((t) => t.theme);
  return [...new Set([...fromMentions, ...fromCatalog])].slice(0, 3);
}

export function projectCompare(full: ResearchResponse, brands: string[]): Record<string, unknown> {
  const sov = full.share_of_voice ?? brands.map((brand) => ({ brand, mentions: 0, engagement: 0, share: 0 }));
  const brands_detail = brands.map((brand) => {
    const attributed = full.mentions.filter((m) => brandHits(`${m.text} ${m.url}`, brand));
    const sentiment =
      attributed.length === 0
        ? 0
        : Number((attributed.reduce((s, m) => s + m.sentiment, 0) / attributed.length).toFixed(4));
    const themes = themesForBrand(full, attributed);
    return { brand, sentiment, mention_count: attributed.length, themes };
  });
  return {
    query: full.query,
    brands,
    share_of_voice: sov,
    brands_detail,
    citations: full.citations.slice(0, 8).map((c) => ({ url: c.url, title: c.title, source: c.source })),
    signals: full.signals,
    meta: lensMeta(full),
  };
}

export function projectDigest(full: ResearchResponse): Record<string, unknown> {
  const praise = take(
    full.mentions.filter((m) => m.intent === "praise" || m.sentiment > 0.12),
    5,
  );
  const pain = take(
    full.mentions.filter((m) => m.intent === "complaint" || m.sentiment < -0.12),
    5,
  );
  const news = take(
    full.mentions.filter((m) => m.intent === "news" || m.platform === "news"),
    5,
  );
  const reviews = take(
    full.mentions.filter((m) => m.platform === "reviews"),
    5,
  );
  const reply_worthy = take(
    full.mentions.filter((m) => m.intent === "question" || m.intent === "complaint" || m.sentiment < -0.12),
    5,
  );
  return {
    query: full.query,
    groups: { praise, pain, news, reviews, reply_worthy },
    meta: lensMeta(full),
  };
}

function exportOf(m: Mention) {
  return {
    id: m.id,
    platform: m.platform,
    url: m.url,
    author: m.author,
    text: m.text,
    timestamp: m.timestamp,
    engagement: m.engagement,
    sentiment: m.sentiment,
    intent: m.intent,
  };
}

export function projectList(full: ResearchResponse): Record<string, unknown> {
  return {
    query: full.query,
    mentions: full.mentions.map(exportOf),
    meta: lensMeta(full),
  };
}

export function projectTrends(full: ResearchResponse): Record<string, unknown> {
  return {
    query: full.query,
    timeframe: full.timeframe,
    volume: full.volume,
    sentiment: full.sentiment,
    signals: full.signals,
    meta: lensMeta(full),
  };
}

export function projectRisk(full: ResearchResponse): Record<string, unknown> {
  const negatives = [...full.mentions]
    .filter((m) => m.sentiment < 0 || m.intent === "complaint")
    .sort((a, b) => a.sentiment - b.sentiment)
    .slice(0, 5)
    .map(compactOf);
  return {
    query: full.query,
    signals: full.signals ?? { risk: "low", spike: false, reasons: ["no mentions in window"] },
    negatives,
    next_queries: full.meta.next_queries ?? [],
    meta: lensMeta(full),
  };
}

function pickReplyMentions(full: ResearchResponse, input: ReplyInput): Mention[] {
  if (input.mention_id) {
    const hit = full.mentions.find((m) => m.id === input.mention_id);
    if (hit) return [hit];
  }
  if (input.mention_url) {
    const hit = full.mentions.find((m) => m.url === input.mention_url);
    if (hit) return [hit];
  }
  if (input.quote) {
    const q = input.quote.toLowerCase().slice(0, 80);
    const hit = full.mentions.find((m) => m.text.toLowerCase().includes(q));
    if (hit) return [hit];
  }
  const worthy = full.mentions.filter((m) => m.intent === "question" || m.intent === "complaint" || m.sentiment < -0.12);
  return (worthy.length ? worthy : full.mentions).slice(0, 3);
}

function templateReply(m: Mention, stance: ReplyInput["stance"]): string {
  const tone = stance === "supportive" ? "Thanks for the note" : stance === "defensive" ? "We hear the concern" : "Thank you for raising this";
  const aspect = m.aspects?.[0] ?? "this topic";
  return `${tone} about ${aspect}. We reviewed the public thread and want to help. This draft is unsent — review before sending.`;
}

export function projectReply(full: ResearchResponse, input: ReplyInput): Record<string, unknown> {
  const picks = pickReplyMentions(full, input);
  const drafts = picks.slice(0, 3).map((m) => ({
    text: templateReply(m, input.stance),
    source_url: m.url,
    mention_id: m.id,
    unsent: true as const,
  }));
  if (!drafts.length) {
    drafts.push({
      text: `No cited mention matched this gather. Review the query ${input.query || SAMPLE_QUERY} before sending anything. This draft is unsent.`,
      source_url: "",
      mention_id: "",
      unsent: true,
    });
  }
  return { drafts, meta: lensMeta(full) };
}

export async function polishReplyText(env: Env, text: string): Promise<string | undefined> {
  if (!env.AI) return undefined;
  try {
    const out = await Promise.race([
      env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [
          {
            role: "system",
            content: "Rewrite this public-reply draft in 2 short sentences. Do not tell the reader to post it. No markdown.",
          },
          { role: "user", content: text },
        ],
      }),
      new Promise<null>((r) => setTimeout(() => r(null), AI_TIMEOUT_MS)),
    ]);
    if (!out || typeof out !== "object") return undefined;
    const resp = (out as { response?: string }).response?.trim();
    if (!resp) return undefined;
    if (/\b(post this|go ahead and post|publish now)\b/i.test(resp)) return undefined;
    return resp;
  } catch {
    return undefined;
  }
}

export async function projectReplyWithOptionalLlama(
  env: Env,
  full: ResearchResponse,
  input: ReplyInput,
): Promise<Record<string, unknown>> {
  const base = projectReply(full, input) as { drafts: Array<{ text: string; source_url: string; mention_id: string; unsent: true }>; meta: unknown };
  const drafts = await Promise.all(
    base.drafts.slice(0, 3).map(async (d) => {
      const polished = await polishReplyText(env, d.text);
      return { ...d, text: polished ?? d.text };
    }),
  );
  return { drafts, meta: base.meta };
}
