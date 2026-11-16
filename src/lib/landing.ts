/**
 * Server-side hydration for the static landing page (`public/index.html`).
 *
 * The Worker fills the page's loading markers with this deployment's live status, the frozen
 * Cloudflare Workers example, and the MCP tool catalog before first paint, so there is no
 * loading shell and no layout shift. `public/app.js` keeps the same markup fresh client-side.
 */
import { escapeHtml } from "./escape";
import { sourceBackends } from "./source-backends";
import { networkPublicName, paymentsReady, paymentConfig } from "./x402";
import { EXAMPLE_RESPONSE } from "./example";
import { mcpToolCards } from "./discoverability";
import { DEFAULT_TRIAL_CALLS } from "./constants";
import { MIT_LICENSE_URL, REPO_URL, SITE_ORIGIN, siteGraphNodes } from "./site-chrome";
import { BRAND_ASSETS } from "./brand-assets";

export function barRow(label: string, pct: number): string {
  const p = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  const bucket = Math.round(p / 5) * 5;
  return `<div class="bar-row"><span>${escapeHtml(label)}</span><div class="bar" role="img" aria-label="${escapeHtml(label)} ${p} percent"><span data-pct="${p}" data-w="${bucket}"></span></div><span class="bar-n">${p.toFixed(0)}%</span></div>`;
}

/** Friendly names for `GET /health` `source_backends` keys, in display order. */
export const SOURCE_LABELS: Record<string, string> = {
  web: "Web search",
  news: "News",
  reviews: "Review sites",
  reddit: "Reddit (native)",
  x: "X (native)",
};
const SOURCE_ORDER = Object.keys(SOURCE_LABELS);

function sourceRank(name: string): number {
  const i = SOURCE_ORDER.indexOf(name);
  return i === -1 ? SOURCE_ORDER.length : i;
}

/** Same markup as `paintBackends` in public/app.js so a client refresh never shifts layout. */
export function backendItemsHtml(backends: Record<string, string>): string {
  return Object.entries(backends)
    .sort(([a], [b]) => sourceRank(a) - sourceRank(b))
    .map(([name, mode]) => {
      const state = mode === "disabled" ? "off" : "on";
      const label = SOURCE_LABELS[name] ?? name;
      return `<li class="src" data-state="${state}"><span class="src-dot" aria-hidden="true"></span><span class="src-name">${escapeHtml(label)}</span><code>${escapeHtml(name)}: ${escapeHtml(String(mode))}</code></li>`;
    })
    .join("");
}

/** Buyer-facing one-liners for the tool gallery. Facts mirror the README tool table. */
export const TOOL_COPY: Record<string, string> = {
  get_health: "Check that the service is up and that paid research can settle.",
  get_pricing: "Get the price, the free-trial terms, and the payment network.",
  get_example: "Inspect a real, frozen research result before you pay for one.",
  suggest_tool: "Describe your goal and get the one tool that fits it.",
  get_entity_profile: "An identity card for a company or product from Wikipedia and Wikidata.",
  research_mentions: "The full cited brief: mentions, volume, themes, and sentiment.",
  compare_brands: "Share of voice for your brand against up to two competitors.",
  get_digest: "Mentions grouped into praise, pain, news, reviews, and reply-worthy.",
  detect_risk: "Flags volume spikes and concentrated negative sentiment.",
  draft_reply: "Drafts unsent public-reply copy from cited mentions. Never posts.",
  list_mentions: "A flat, cited mention list, ready to export or iterate over.",
  get_trends: "Mention volume and sentiment over time, without mention rows.",
};

function trialCalls(env: Env): number {
  const n = Number.parseInt(env.FREE_TRIAL_CALLS || String(DEFAULT_TRIAL_CALLS), 10);
  return Number.isFinite(n) ? n : DEFAULT_TRIAL_CALLS;
}

export function toolGalleryHtml(env: Env): string {
  const price = escapeHtml(paymentConfig(env).price);
  const cards = mcpToolCards();
  const list = (kind: "free" | "paid") =>
    cards
      .filter((t) => t.kind === kind)
      .map((t) => {
        const badge = kind === "paid" ? `$${price}` : "Free";
        const copy = TOOL_COPY[t.name] ?? t.when_to_use;
        return `<li class="tool-card" data-kind="${kind}"><div class="tool-top"><h4><code>${escapeHtml(t.name)}</code></h4><span class="badge badge-${kind}">${badge}</span></div><p>${escapeHtml(copy)}</p></li>`;
      })
      .join("");
  return `<div class="tool-group"><div class="tool-group-head"><h3>Free tools</h3><p>Always $0. Explore, route, and ground your agent before it spends anything.</p></div><ul class="tool-list" role="list">${list("free")}</ul></div><div class="tool-group tool-group-paid"><div class="tool-group-head"><h3>Paid research tools</h3><p>$${price} USDC per successful call after a ${trialCalls(env)}-call free trial shared across all paid tools. Call exactly one per question.</p></div><ul class="tool-list" role="list">${list("paid")}</ul></div>`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-20T04:04:59.148Z" → "20 Sep 2026, 04:04 UTC" (locale-independent). */
export function formatUtc(iso: string | undefined): string {
  const ms = Date.parse(iso ?? "");
  if (!Number.isFinite(ms)) return iso ?? "";
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

function httpUrl(raw: string | undefined): string {
  try {
    const u = new URL(raw ?? "");
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : "";
  } catch {
    return "";
  }
}

/** The frozen example rendered as a report card. Real data only: every value comes from EXAMPLE_RESPONSE. */
export function fixtureHtml(): string {
  const ex = EXAMPLE_RESPONSE;
  const sent = ex.sentiment;
  const sentBars = [
    barRow("positive", sent.positive),
    barRow("neutral", sent.neutral),
    barRow("negative", sent.negative),
  ].join("");
  const sovBars = (ex.share_of_voice ?? []).map((r) => barRow(r.brand, r.share * 100)).join("");
  const themes = (ex.themes ?? []).map((t) => `<li>${escapeHtml(t.theme)}</li>`).join("");
  const overall = Number(sent.overall);
  const kpis = [
    ["Mentions", String(ex.volume?.total ?? 0)],
    ["Sentiment", Number.isFinite(overall) ? overall.toFixed(2) : "—"],
    ["Risk", ex.signals?.risk ?? "—"],
    ["Confidence", String(ex.meta?.confidence ?? "—")],
  ]
    .map(([k, v]) => `<li><span>${escapeHtml(k!)}</span><strong>${escapeHtml(v!)}</strong></li>`)
    .join("");
  const mentions = (ex.mentions ?? [])
    .slice(0, 4)
    .map((m) => {
      const intent = m.intent ? `<span class="intent">${escapeHtml(m.intent)}</span>` : "";
      const text = m.text.length > 180 ? `${m.text.slice(0, 177).trimEnd()}…` : m.text;
      const href = httpUrl(m.url);
      const body = href
        ? `<a class="mention-link" href="${escapeHtml(href)}" rel="nofollow noopener">${escapeHtml(text)}</a>`
        : escapeHtml(text);
      return `<article class="mention"><header><span>${escapeHtml(m.platform)} · ${escapeHtml(m.author)}</span>${intent}</header><p>${body}</p></article>`;
    })
    .join("");
  const cites = (ex.citations ?? [])
    .slice(0, 6)
    .map((c) => {
      const href = httpUrl(c.url);
      if (!href) return "";
      return `<li><a href="${escapeHtml(href)}" rel="nofollow noopener">${escapeHtml(c.title || href)}</a><span class="cite-src">${escapeHtml(c.source ?? "")}</span></li>`;
    })
    .join("");
  const totalCites = (ex.citations ?? []).length;
  const totalMentions = (ex.mentions ?? []).length;
  const sources = (ex.meta?.sources_used ?? []).join(", ");
  return `<article class="fixture-summary report"><header class="report-head"><div><p class="report-kicker"><code>research_mentions</code> · ${escapeHtml(typeof ex.timeframe === "string" ? ex.timeframe : "custom range")} · sources: ${escapeHtml(sources)}</p><h3>${escapeHtml(ex.query)} · ${escapeHtml(String(ex.volume?.total ?? 0))} mentions</h3></div><ul class="kpis" role="list">${kpis}</ul></header><p class="report-summary">${escapeHtml(ex.summary ?? "")}</p><div class="report-grid"><div class="report-col"><h4>Sentiment mix</h4><div class="bars" role="group" aria-label="Sentiment mix">${sentBars}</div>${sovBars ? `<h4>Share of voice</h4><div class="bars" role="group" aria-label="Share of voice">${sovBars}</div>` : ""}<h4>Themes</h4><ul class="themes" role="list">${themes}</ul></div><div class="report-col"><h4>Top mentions <span class="count">4 of ${totalMentions}</span></h4>${mentions}<h4>Citations <span class="count">6 of ${totalCites}</span></h4><ul class="cite-list" role="list">${cites}</ul></div></div><footer class="report-foot"><span>Captured ${escapeHtml(formatUtc(ex.meta?.as_of))} · <code>as_of ${escapeHtml(String(ex.meta?.as_of ?? "—"))}</code></span><a class="link-arrow" href="/v1/research/example">See the full JSON response</a></footer></article>`;
}

/**
 * Query presets: the hero preview radios and the "Query builder" buttons in public/index.html use
 * these labels, and PRESETS in public/app.js uses these parameters. A unit test keeps all three in sync.
 */
export const QUERY_PRESETS: ReadonlyArray<{ value: string; label: string; query: string; timeframe: string }> = [
  { value: "brand", label: "Brand", query: "Cloudflare Workers", timeframe: "7d" },
  { value: "vs", label: "Vs competitor", query: "Cloudflare Workers vs AWS Lambda", timeframe: "7d" },
  { value: "reviews", label: "Reviews", query: "Cloudflare Workers reviews", timeframe: "30d" },
  { value: "risk", label: "24h risk", query: "Cloudflare Workers", timeframe: "24h" },
];

/** "2026-09-20T00:00:00.000Z" → "20 Sep 2026" (UTC, locale-independent). */
function formatDay(iso: string | undefined): string {
  const ms = Date.parse(iso ?? "");
  if (!Number.isFinite(ms)) return iso ?? "";
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function kpiListHtml(rows: Array<[string, string]>): string {
  const items = rows.map(([k, v]) => `<li><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></li>`).join("");
  return `<ul class="hq-kpis" role="list">${items}</ul>`;
}

function pct(n: number | undefined): string {
  const v = Number(n);
  return Number.isFinite(v) ? `${Number(v.toFixed(1))}%` : "—";
}

/**
 * The hero query preview: one compact card per preset, built only from the frozen example
 * (EXAMPLE_RESPONSE, the same data as GET /v1/research/example). Nothing is fetched. When a preset
 * is not the frozen query and window, the card says so and shows the closest frozen data instead.
 */
export function heroPreviewHtml(): string {
  const ex = EXAMPLE_RESPONSE;
  const total = ex.volume?.total ?? 0;
  const timeframe = typeof ex.timeframe === "string" ? ex.timeframe : "custom range";
  const overall = Number(ex.sentiment?.overall);
  const mentions = ex.mentions ?? [];
  const byPlatform = (ex.volume?.by_platform ?? {}) as Record<string, number>;
  const sov = ex.share_of_voice ?? [];

  const bodies: Record<string, () => string> = {
    brand: () => {
      const themes = (ex.themes ?? []).slice(0, 3).map((t) => `<li>${escapeHtml(t.theme)}</li>`).join("");
      return `${kpiListHtml([
        ["Mentions", String(total)],
        ["Sentiment", Number.isFinite(overall) ? overall.toFixed(2) : "—"],
        ["Risk", ex.signals?.risk ?? "—"],
        ["Confidence", String(ex.meta?.confidence ?? "—")],
      ])}<div class="bars" role="group" aria-label="Sentiment mix">${barRow("positive", ex.sentiment.positive)}${barRow("neutral", ex.sentiment.neutral)}${barRow("negative", ex.sentiment.negative)}</div><ul class="themes" role="list" aria-label="Top themes">${themes}</ul>`;
    },
    vs: () => {
      const brand = sov.find((r) => r.brand !== "other");
      const others = sov.filter((r) => r.brand === "other");
      const rows: Array<[string, string]> = [["Mentions", String(total)]];
      for (const r of sov) rows.push([r.brand, String(r.mentions)]);
      const note = brand && others.length
        ? `<p class="hq-note">“other” counts mentions that do not name ${escapeHtml(brand.brand)}.</p>`
        : "";
      return `${kpiListHtml(rows)}<div class="bars" role="group" aria-label="Share of voice">${sov.map((r) => barRow(r.brand, r.share * 100)).join("")}</div>${note}`;
    },
    reviews: () => {
      const rows: Array<[string, string]> = [
        ["Review sites", String(byPlatform.reviews ?? 0)],
        ["Web", String(byPlatform.web ?? 0)],
        ["News", String(byPlatform.news ?? 0)],
      ];
      const opinion = mentions.find((m) => m.intent === "complaint" || m.intent === "praise") ?? mentions[0];
      if (!opinion) return kpiListHtml(rows);
      const head = opinion.text.split(" — ")[0] ?? opinion.text;
      const text = head.length > 110 ? `${head.slice(0, 107).trimEnd()}…` : head;
      const href = httpUrl(opinion.url);
      const quote = href
        ? `<a class="mention-link" href="${escapeHtml(href)}" rel="nofollow noopener">${escapeHtml(text)}</a>`
        : escapeHtml(text);
      const meta = [
        opinion.platform,
        opinion.intent ? `intent ${opinion.intent}` : "",
        opinion.aspects?.length ? `aspect ${opinion.aspects.join(", ")}` : "",
        `sentiment ${Number(opinion.sentiment).toFixed(2)}`,
      ].filter(Boolean).join(" · ");
      return `${kpiListHtml(rows)}<div class="hq-quote"><p class="hq-quote-k">Closest opinion in the run</p><p class="hq-quote-t">${quote}</p><p class="hq-quote-m">${escapeHtml(meta)}</p></div>`;
    },
    risk: () => {
      const reasons = (ex.signals?.reasons ?? []).join("; ");
      const trend = (ex.volume?.trend ?? [])
        .map((b) => `${formatDay(b.t)}: ${b.count} ${b.count === 1 ? "mention" : "mentions"}`)
        .join(" · ");
      return `${kpiListHtml([
        ["Risk", ex.signals?.risk ?? "—"],
        ["Spike", ex.signals?.spike ? "yes" : "no"],
        ["Negative", pct(ex.sentiment?.negative)],
      ])}<dl class="hq-facts"><div><dt>Reason</dt><dd>${escapeHtml(reasons || "—")}</dd></div><div><dt>Volume</dt><dd>${escapeHtml(trend || "—")}</dd></div></dl>`;
    },
  };

  const cards = QUERY_PRESETS.map((p) => {
    const exact = p.query === ex.query && p.timeframe === ex.timeframe;
    const match = exact
      ? `<p class="hq-match" data-match="exact">Exact match: this is the frozen run.</p>`
      : `<p class="hq-match" data-match="closest">No frozen run for this query. Closest frozen example: “${escapeHtml(ex.query)}” · ${escapeHtml(timeframe)}.</p>`;
    const body = (bodies[p.value] ?? bodies.brand!)();
    return `<div class="hq-card" id="hq-card-${escapeHtml(p.value)}" data-hq="${escapeHtml(p.value)}" role="group" aria-labelledby="hq-req-${escapeHtml(p.value)}"><p class="hq-req" id="hq-req-${escapeHtml(p.value)}"><span class="hq-k">query</span> <span class="hq-v">${escapeHtml(p.query)}</span> <span class="hq-k">timeframe</span> <span class="hq-v">${escapeHtml(p.timeframe)}</span></p>${match}${body}</div>`;
  }).join("");
  const sources = (ex.meta?.sources_used ?? []).join(", ");
  return `${cards}<p class="hq-foot"><span>Captured ${escapeHtml(formatUtc(ex.meta?.as_of))}${sources ? ` · sources: ${escapeHtml(sources)}` : ""}</span><a class="link-arrow" href="#example">Full report</a></p>`;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?)])/g, "$1")
    .trim();
}

/** Question/answer pairs from the landing FAQ (`<details class="faq-item">`), as plain text. */
export function faqEntries(html: string): Array<{ question: string; answer: string }> {
  const out: Array<{ question: string; answer: string }> = [];
  const re = /<details class="faq-item"[^>]*>\s*<summary>([\s\S]*?)<\/summary>\s*<div class="faq-a">([\s\S]*?)<\/div>\s*<\/details>/g;
  for (const m of html.matchAll(re)) {
    const question = stripTags(m[1] ?? "");
    const answer = stripTags(m[2] ?? "");
    if (question && answer) out.push({ question, answer });
  }
  return out;
}

/**
 * One schema.org JSON-LD graph for the landing: Organization, WebSite, WebPage,
 * SoftwareApplication (with the real per-call price from env), its source code, the WebAPI,
 * and the on-page FAQ. Never ratings or reviews. Serialized with "<" escaped.
 */
export function landingJsonLdScript(html: string, env?: Env): string {
  const url = html.match(/<meta property="og:url" content="([^"]*)"/)?.[1] || `${SITE_ORIGIN}/`;
  const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "";
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "MentionForge";
  let origin = SITE_ORIGIN;
  try {
    origin = new URL(url).origin;
  } catch {
    /* keep production origin */
  }
  const price = env ? paymentConfig(env).price : "0.02";
  const trial = env ? trialCalls(env) : DEFAULT_TRIAL_CALLS;
  const faq = faqEntries(html);
  const graph: Array<Record<string, unknown>> = [
    ...siteGraphNodes(origin),
    {
      "@type": "WebPage",
      "@id": `${url}#webpage`,
      url,
      name: stripTags(title),
      description: stripTags(description),
      inLanguage: "en",
      isPartOf: { "@id": `${origin}/#website` },
      about: { "@id": `${origin}/#software` },
      primaryImageOfPage: { "@type": "ImageObject", url: `${origin}${BRAND_ASSETS.og}`, width: BRAND_ASSETS.ogWidth, height: BRAND_ASSETS.ogHeight },
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${origin}/#software`,
      name: "MentionForge",
      url,
      description: stripTags(description),
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Any",
      license: MIT_LICENSE_URL,
      sameAs: REPO_URL,
      image: `${origin}${BRAND_ASSETS.hero}`,
      publisher: { "@id": `${origin}/#organization` },
      featureList: [
        "Mention volume and trend by source",
        "Sentiment mix and overall score",
        "Recurring themes",
        "Cited mentions with source links",
        "Share of voice against up to two competitors",
        "Volume-spike and negative-concentration risk signals",
        "REST API and Streamable HTTP MCP server",
      ],
      offers: {
        "@type": "Offer",
        price,
        priceCurrency: "USDC",
        description: `Per successful paid research call, settled in USDC on Base via x402. The first ${trial} paid calls per wallet are free; free tools never charge.`,
        url: `${origin}/#pricing`,
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price,
          priceCurrency: "USDC",
          referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitText: "API call" },
        },
      },
    },
    {
      "@type": "SoftwareSourceCode",
      "@id": `${origin}/#source`,
      name: "MentionForge source code",
      codeRepository: REPO_URL,
      license: MIT_LICENSE_URL,
      programmingLanguage: "TypeScript",
      targetProduct: { "@id": `${origin}/#software` },
    },
    {
      "@type": "WebAPI",
      "@id": `${origin}/#api`,
      name: "MentionForge API",
      description: "REST and MCP endpoints for cited social listening and brand research.",
      url: `${origin}/v1/research`,
      documentation: `${origin}/openapi.json`,
      termsOfService: `${origin}/terms`,
      provider: { "@id": `${origin}/#organization` },
    },
  ];
  if (faq.length) {
    graph.push({
      "@type": "FAQPage",
      "@id": `${url}#faq`,
      mainEntity: faq.map((f) => ({
        "@type": "Question",
        name: f.question,
        acceptedAnswer: { "@type": "Answer", text: f.answer },
      })),
    });
  }
  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

/** Fill the static landing with this deployment's live status so first paint is not a loading shell. */
export function hydrateLandingHtml(html: string, env: Env, calls: number): string {
  const backends = sourceBackends(env);
  const ready = paymentsReady(env);
  const named = networkPublicName(env);
  const items = backendItemsHtml(backends);
  const label = ready ? ` Live · ${escapeHtml(named)}` : ` Degraded · ${escapeHtml(named)}`;
  const count = Number.isFinite(calls) ? Math.max(0, Math.trunc(calls)).toLocaleString("en-US") : "0";

  let out = html
    .replace('<span class="dot" data-ready></span>', `<span class="dot" data-ready="${ready ? "true" : "false"}"></span>`)
    .replace("> Base · $0.02 USDC</span>", `>${label}</span>`)
    .replace('<span class="chip" id="network-chip">Base</span>', `<span class="chip" id="network-chip">${escapeHtml(named)}</span>`)
    .replaceAll('<span class="net-name">Base</span>', `<span class="net-name">${escapeHtml(named)}</span>`)
    .replace("<li>Loading from GET /health…</li>", items || "<li>Loading from GET /health…</li>")
    .replace('<p class="stat" id="calls">—</p>', `<p class="stat" id="calls">${count}</p>`)
    .replace('<div class="hq-cards" id="hq-cards"></div>', `<div class="hq-cards" id="hq-cards">${heroPreviewHtml()}</div>`)
    .replace('<p class="muted">Loading snapshot…</p>', fixtureHtml())
    .replace('<div id="tool-gallery" class="tool-gallery"></div>', `<div id="tool-gallery" class="tool-gallery">${toolGalleryHtml(env)}</div>`);
  if (!out.includes('type="application/ld+json"')) {
    const block = landingJsonLdScript(out, env);
    out = out.includes("</head>") ? out.replace("</head>", `${block}\n</head>`) : `${out}\n${block}`;
  }
  return out;
}
