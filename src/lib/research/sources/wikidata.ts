import type { QueryPlan } from "../query-plan";
import { stampInWindow } from "../query-plan";
import type { SourceCtx } from "../http";
import { cite, getJson } from "../http";
import type { SourceMention, SourceResult, TimeWindow } from "../types";

type WikidataSearch = {
  search?: Array<{ id?: string; label?: string; description?: string; concepturi?: string }>;
};

type Sparql = {
  results?: {
    bindings?: Array<{
      site?: { value?: string };
      label?: { value?: string };
    }>;
  };
};

/** Entity + official website (P856). Not a web-search substitute. */
export async function fetchWikidata(ctx: SourceCtx, plan: QueryPlan, win: TimeWindow): Promise<SourceResult> {
  const mentions: SourceMention[] = [];
  const citations: SourceResult["citations"] = [];

  const wd = await getJson<WikidataSearch>(
    ctx,
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(plan.brand)}&language=en&format=json&limit=3`,
  );

  const entities = wd?.search ?? [];
  for (const e of entities) {
    if (!e.concepturi) continue;
    const entityUrl = asHttpsWikidata(e.concepturi);
    mentions.push({
      platform: "web",
      url: entityUrl,
      author: "wikidata",
      timestamp: stampInWindow(win),
      text: [e.label, e.description].filter(Boolean).join(" — "),
      engagement: 5,
      title: e.label,
    });
    citations.push(cite(entityUrl, e.label ?? "wikidata", "wikidata"));
  }

  const officialEntity = entities.find((e) => e.id && /^Q\d+$/i.test(e.id));
  const qid = officialEntity?.id?.match(/^Q\d+$/i)?.[0];
  if (qid) {
    const sparql = encodeURIComponent(
      `SELECT ?site ?label WHERE { wd:${qid} wdt:P856 ?site. OPTIONAL { wd:${qid} rdfs:label ?label FILTER(LANG(?label)="en") } } LIMIT 1`,
    );
    const official = await getJson<Sparql>(
      ctx,
      `https://query.wikidata.org/sparql?format=json&query=${sparql}`,
      { accept: "application/sparql-results+json" },
    );
    const site = officialHttpUrl(official?.results?.bindings?.[0]?.site?.value);
    if (site) {
      mentions.push({
        platform: "web",
        url: site,
        author: "official",
        timestamp: stampInWindow(win),
        text: `${officialEntity?.label ?? plan.brand} official site`,
        engagement: 9,
        title: officialEntity?.label,
      });
      citations.push(cite(site, `${officialEntity?.label ?? plan.brand} official site`, "wikidata-official"));
    }
  }

  return {
    source: "wikidata",
    mentions,
    citations,
    degraded: !wd,
    error: wd ? undefined : "wikidata_unavailable",
  };
}

/** Wikidata entity URIs are often `http://`; the same resource is served on HTTPS. */
function asHttpsWikidata(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol === "http:" && (host === "wikidata.org" || host.endsWith(".wikidata.org"))) {
      parsed.protocol = "https:";
      return parsed.toString();
    }
  } catch {
    return url;
  }
  return url;
}

function officialHttpUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}
