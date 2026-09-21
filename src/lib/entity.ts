import { SOURCE_TIMEOUT_MS } from "./constants";
import { wikipediaHost } from "./allowlist";
import { FetchPool } from "./fetch-pool";
import { parseResearchInput } from "../schemas/research";
import { planQuery, windowFor } from "./research/query-plan";
import { fetchWikidata } from "./research/sources/wikidata";
import { getJson } from "./research/http";
import { cleanSnippet } from "./html";
import { sanitizeAgentText } from "./suggest";
import type { SourceCtx } from "./research/http";

type WikiSearch = { query?: { search?: Array<{ title: string; snippet?: string }> } };
type WikiSummary = { title?: string; extract?: string; content_urls?: { desktop?: { page?: string } } };

export type EntityCard = {
  query: string;
  title: string;
  description: string;
  wikipedia_url?: string;
  wikidata_url?: string;
  official_url?: string;
  as_of: string;
};

export async function entityProfile(env: Env, queryRaw: string, language?: string): Promise<EntityCard> {
  const query = sanitizeAgentText(queryRaw);
  const lang = language && /^[a-z]{2}$/.test(language) ? language : undefined;
  const pool = new FetchPool();
  const ctx: SourceCtx = { env, pool, query, lang };
  const req = parseResearchInput({ query, platforms: ["web"], include_summary: false, language: lang });
  const plan = planQuery(req);
  const win = windowFor("7d");
  const host = wikipediaHost(lang);

  const loaded = await Promise.race([
    loadCard(ctx, plan, win, host),
    sleep(SOURCE_TIMEOUT_MS).then(() => null),
  ]);

  if (!loaded) {
    return { query, title: query, description: query, as_of: new Date().toISOString() };
  }
  return { query, ...loaded, as_of: new Date().toISOString() };
}

async function loadCard(
  ctx: SourceCtx,
  plan: ReturnType<typeof planQuery>,
  win: ReturnType<typeof windowFor>,
  host: string,
): Promise<Omit<EntityCard, "query" | "as_of">> {
  const wikiSearchUrl = `https://${host}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(plan.web)}&format=json&srlimit=3&utf8=1`;
  const [wikiSearch, wd] = await Promise.all([
    getJson<WikiSearch>(ctx, wikiSearchUrl),
    fetchWikidata(ctx, plan, win),
  ]);

  const top = wikiSearch?.query?.search?.[0]?.title;
  let wikipedia_url: string | undefined;
  let title = top ?? plan.brand;
  let description = cleanSnippet(wikiSearch?.query?.search?.[0]?.snippet ?? "");
  if (top) {
    const sum = await getJson<WikiSummary>(ctx, `https://${host}/api/rest_v1/page/summary/${encodeURIComponent(top)}`);
    wikipedia_url =
      sum?.content_urls?.desktop?.page ?? `https://${host}/wiki/${encodeURIComponent(top.replace(/ /g, "_"))}`;
    title = sum?.title ?? top;
    description = cleanSnippet((sum?.extract ?? description) || title);
  }

  const wdMention = wd.mentions.find((m) => m.author === "wikidata");
  const official = wd.mentions.find((m) => m.author === "official");
  if (!description && wdMention?.text) description = wdMention.text;
  if (!title && wdMention?.title) title = wdMention.title;

  return {
    title: title || ctx.query,
    description: description || title || ctx.query,
    wikipedia_url,
    wikidata_url: wdMention?.url,
    official_url: official?.url,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
