import { escapeHtml } from "./escape";
import {
  copyButtonHtml,
  icon,
  ISSUES_URL,
  MIT_LICENSE_URL,
  pageDocumentHtml,
  pageHeroHtml,
  REPO_URL,
  RESOURCE_LINKS,
  siteGraphNodes,
  SITE_ORIGIN,
  TRADEMARK_URL,
} from "./site-chrome";
import { DIRECTORY_LINKS } from "./discoverability";
import { BRAND_ASSETS } from "./brand-assets";

export { escapeHtml } from "./escape";

/** Brave/Wikipedia snippets often include <strong> and numeric entities. */
export function cleanSnippet(s: string): string {
  const stripped = s.replace(/<[^>]*>/g, " ");
  const decoded = stripped
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const n = Number.parseInt(hex, 16);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    })
    .replace(/&#(\d+);/g, (_, num: string) => {
      const n = Number(num);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    });
  return decoded.replace(/\s+/g, " ").trim();
}

/**
 * Resolve relative Open Graph tags, canonical/og:url, and JSON-LD URLs so crawlers see
 * this deployment's origin.
 */
export function absolutizePublicHtml(html: string, origin: string): string {
  const base = origin.replace(/\/$/, "");
  const rewriteUrl = (raw: string): string => {
    if (!raw) return `${base}/`;
    try {
      const pathname = new URL(raw, `${base}/`).pathname || "/";
      return `${base}${pathname}`;
    } catch {
      return `${base}/`;
    }
  };
  return html
    .replaceAll(`content="${BRAND_ASSETS.og}"`, `content="${base}${BRAND_ASSETS.og}"`)
    .replace(
      /<meta property="og:url" content="([^"]*)"\s*\/?>/,
      (_, u: string) => `<meta property="og:url" content="${rewriteUrl(u)}"/>`,
    )
    .replace(
      /<link rel="canonical" href="([^"]*)"\s*\/?>/,
      (_, u: string) => `<link rel="canonical" href="${rewriteUrl(u)}"/>`,
    )
    .replace(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
      (_, json: string) => `<script type="application/ld+json">${json.replaceAll(SITE_ORIGIN, base)}</script>`,
    );
}

function networkLabel(caip: string): string {
  if (caip === "eip155:8453") return "Base";
  if (caip === "eip155:84532") return "Base Sepolia";
  return caip;
}

/** Summary chips for a discovery payload. Mirrors `paintFacts` in public/app.js (its no-SSR fallback). */
export function discoveryFacts(body: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return [];
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const d = data as Record<string, unknown>;
  const chips: string[] = [];
  if (typeof d.status === "string") chips.push(`status ${d.status}`);
  if (typeof d.payments_ready === "boolean") chips.push(d.payments_ready ? "payments ready" : "payments degraded");
  if (typeof d.network === "string") {
    const named = networkLabel(d.network);
    chips.push(named === d.network ? d.network : `${named} · ${d.network}`);
  }
  if (d.price_usdc != null) chips.push(`$${String(d.price_usdc)} ${typeof d.asset === "string" ? d.asset : "USDC"}`);
  if (d.free_trial_calls != null) chips.push(`${String(d.free_trial_calls)} trial calls`);
  if (typeof d.query === "string") chips.push(d.query);
  const volume = d.volume as { total?: unknown } | undefined;
  if (volume && volume.total != null) chips.push(`${String(volume.total)} mentions`);
  const info = d.info as { title?: unknown } | undefined;
  if (info && typeof info.title === "string") chips.push(info.title);
  if (typeof d.calls === "number") chips.push(`${d.calls} calls`);
  if (typeof d.paid === "number") chips.push(`${d.paid} paid`);
  if (typeof d.trial === "number") chips.push(`${d.trial} trial`);
  if (d.source_backends && typeof d.source_backends === "object") {
    for (const [name, mode] of Object.entries(d.source_backends as Record<string, unknown>)) {
      chips.push(`${name}: ${String(mode)}`);
    }
  }
  return chips;
}

/**
 * Browser view of a machine-readable surface (JSON, llms.txt, skill.md) and the branded 404.
 * Agents that ask for JSON never see this; `?raw=1` returns the original bytes.
 */
export function discoveryDocumentHtml(opts: {
  title: string;
  hint: string;
  path: string;
  body: string;
  status?: 404;
}): string {
  const [pathOnly = opts.path, search = ""] = opts.path.split("?");
  if (opts.status === 404) return notFoundDocumentHtml(opts.title, opts.hint, pathOnly, opts.body);
  const rawParams = new URLSearchParams(search);
  rawParams.set("raw", "1");
  const rawHref = `${pathOnly}?${rawParams.toString()}`;
  const tabs = RESOURCE_LINKS.map((r) => {
    const target = r.href.split("?")[0];
    const current = pathOnly === target ? ' aria-current="page"' : "";
    return `            <li><a href="${escapeHtml(r.href)}"${current}>${escapeHtml(r.label)}</a></li>`;
  }).join("\n");
  const facts = discoveryFacts(opts.body);
  const factsHtml = facts.length
    ? `<ul class="facts" id="facts" role="list">${facts.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>`
    : '<ul class="facts" id="facts" role="list" hidden></ul>';
  const main = `${pageHeroHtml({
    eyebrow: "Developer resource",
    title: opts.title,
    lede: opts.hint,
    mark: "chrome",
    extra: `            ${factsHtml}`,
  })}
      <div class="container doc-page">
        <nav class="resource-tabs" aria-label="Developer resources">
          <ul role="list">
${tabs}
          </ul>
        </nav>
        <section class="code-card" aria-labelledby="payload-title">
          <div class="code-head">
            <h2 id="payload-title"><code>${escapeHtml(pathOnly)}</code></h2>
            <div class="code-actions">
              <a class="btn btn-ghost btn-xs raw-link" href="${escapeHtml(rawHref)}">Raw</a>
              ${copyButtonHtml("payload")}
            </div>
          </div>
          <pre id="payload" tabindex="0">${escapeHtml(opts.body)}</pre>
        </section>
      </div>`;
  return pageDocumentHtml({
    meta: { title: `${opts.title} — MentionForge`, description: opts.hint },
    current: pathOnly,
    bodyClass: "page-resource",
    main,
  });
}

function notFoundDocumentHtml(title: string, hint: string, path: string, body: string): string {
  const main = `      <section class="container error-page" aria-labelledby="error-title">
        <p class="eyebrow">Error 404 · ${escapeHtml(title)}</p>
        <h1 id="error-title">We can’t find that page</h1>
        <p class="lede">${escapeHtml(hint)}</p>
        <p class="error-path"><code>${escapeHtml(path)}</code></p>
        <div class="cta-row">
          <a class="btn btn-primary" href="/">Back to home ${icon("arrow")}</a>
          <a class="btn btn-ghost" href="/llms.txt">Agent install guide</a>
        </div>
        <ul class="error-links" role="list">
          <li><a href="/#how">How it works</a></li>
          <li><a href="/#pricing">Pricing</a></li>
          <li><a href="/about">About</a></li>
          <li><a href="/support">Support</a></li>
        </ul>
        <details class="tech-details">
          <summary>Technical details for developers</summary>
          <pre id="payload" tabindex="0">${escapeHtml(body)}</pre>
        </details>
      </section>`;
  return pageDocumentHtml({
    meta: { title: "Page not found — MentionForge", description: hint },
    bodyClass: "page-error",
    main,
  });
}

export const TRUST_PAGE_SLUGS = ["privacy", "terms", "about"] as const;
export type TrustPageSlug = (typeof TRUST_PAGE_SLUGS)[number];

type TrustPageSpec = {
  /** The page's <h1>. */
  heading: string;
  /** Document <title>. */
  title: string;
  eyebrow: string;
  /** Meta and social description (≤160 characters). */
  description: string;
  /** Hero lede shown under the heading. */
  lede: string;
  /** In-page table of contents (section heading id → label). Omitted for About. */
  toc?: ReadonlyArray<readonly [string, string]>;
  sectionsHtml: string;
};

const ISSUES_LINK = `<a href="${ISSUES_URL}">${ISSUES_URL}</a>`;

const TRUST_PAGES: Record<TrustPageSlug, TrustPageSpec> = {
  privacy: {
    heading: "Privacy policy",
    title: "Privacy policy — MentionForge",
    eyebrow: "Legal",
    description:
      "What MentionForge stores and why: free-trial and usage records, short-lived caches, public on-chain payments, and what Stripe handles for subscriptions.",
    lede: "A plain-language account of what MentionForge stores, why, and for how long. No account or tracking cookies are needed to use the service.",
    toc: [
      ["privacy-summary", "The short version"],
      ["privacy-accounts", "Accounts, email, and payments"],
      ["privacy-d1", "What we store"],
      ["privacy-metrics", "Metrics, caching, and rate limits"],
      ["privacy-onchain", "On-chain payments are public"],
      ["privacy-retention", "Retention and data requests"],
    ],
    sectionsHtml: `          <section aria-labelledby="privacy-summary">
            <h2 id="privacy-summary">The short version</h2>
            <ul class="check-list" role="list">
              <li>Free tools, the free trial, and pay-per-call use need no account, sign-up, password, or tracking cookies.</li>
              <li>We keep a small set of records to run the free trial, prevent double charges, enforce quotas, and count usage. Every one is listed below.</li>
              <li>Payments made on-chain are public on the Base blockchain.</li>
              <li>If you subscribe to an API key plan, Stripe handles your email address and card details. MentionForge never receives card numbers.</li>
            </ul>
          </section>

          <section aria-labelledby="privacy-accounts">
            <h2 id="privacy-accounts">Accounts, email, and payments</h2>
            <p>Free trial and pay-per-call use need no account, sign-up, password, or tracking cookies. If you subscribe to an API key plan, Stripe (our payment processor) collects your email address and payment details under <a href="https://stripe.com/privacy">Stripe&rsquo;s privacy policy</a>. MentionForge does not receive card numbers. Stripe emails receipts and invoices to the subscriber.</p>
          </section>

          <section aria-labelledby="privacy-d1">
            <h2 id="privacy-d1">What we store</h2>
            <p>MentionForge keeps the records below in Cloudflare D1, the database behind the service.</p>
            <div class="data-grid">
              <article class="data-card">
                <h3>Free-trial usage <code>trial_wallets</code></h3>
                <p>When you send the <code>X-Wallet</code> header to use the 10-call free trial, we store the wallet address in lowercase (<code>wallet</code>), how many trial calls it has used (<code>used</code>, up to 10), and when it was last updated (<code>updated_at</code>).</p>
              </article>
              <article class="data-card">
                <h3>Double-charge protection <code>idempotency</code></h3>
                <p>When a paid or trial call includes an <code>Idempotency-Key</code> header, we store the key, a SHA-256 hash of the canonical request body (<code>body_hash</code>), the status, the JSON response, billing details (<code>amount_usdc</code>, <code>tx_hash</code>, <code>free_trial</code>), and <code>created_at</code>. Entries expire after 24 hours and are deleted the next time they are looked up after expiry.</p>
              </article>
              <article class="data-card">
                <h3>Daily totals <code>stats_daily</code></h3>
                <p>Daily aggregate totals (<code>day</code>, <code>calls</code>, <code>paid</code>, <code>usdc_micros</code>, <code>errors</code>, <code>trial</code>). No wallet addresses, IP addresses, or raw query strings are stored in this table.</p>
              </article>
              <article class="data-card">
                <h3>Quota counter <code>x_id_usage</code></h3>
                <p>Daily counts (<code>day</code>, <code>ids</code>) of disclosed mention and post IDs over a rolling 30-day window, used to enforce the global 30-day quota.</p>
              </article>
            </div>
            <p class="callout">In plain words: if you subscribe, we keep a fingerprint (hash) of your API key, your Stripe customer and subscription IDs, billing dates and how many calls you&rsquo;ve used. We never see your card number.</p>
            <div class="data-grid">
              <article class="data-card">
                <h3>API key records <code>api_keys</code></h3>
                <p>If you subscribe to an API key plan, we store a SHA-256 hash of your API key (<code>key_hash</code>; the plain key is shown once on the claim page and is not retained after claim), your Stripe customer ID (<code>stripe_customer_id</code>), Stripe subscription ID (<code>stripe_subscription_id</code>), plan status (<code>status</code>), billing-period dates (<code>period_start</code>, <code>period_end</code>), when the record was created (<code>created_at</code>), the Checkout session ID (<code>checkout_session_id</code>), whether the key has been claimed (<code>claimed</code>), and a temporary <code>pending_key</code> that is cleared after claim.</p>
              </article>
              <article class="data-card">
                <h3>Plan usage <code>plan_usage</code></h3>
                <p>Per-key usage counts for your quota: the API key hash (<code>key_hash</code>), the billing period start (<code>period_start</code>), and calls used in that period (<code>calls</code>).</p>
              </article>
              <article class="data-card">
                <h3>Billing event log <code>stripe_events</code></h3>
                <p>Stripe webhook event IDs (<code>event_id</code>) and when they arrived (<code>received_at</code>), so the same Stripe event is never applied twice. This table does not store email addresses or card numbers.</p>
              </article>
            </div>
          </section>

          <section aria-labelledby="privacy-metrics">
            <h2 id="privacy-metrics">Metrics, caching, and rate limits</h2>
            <p><strong>Usage metrics (Cloudflare Analytics Engine, <code>METRICS</code>):</strong> for each completed or failed research call we record the event type (<code>paid</code>, <code>trial</code>, or <code>error</code>), the UTC date, a SHA-256 hash of the normalized query (never the raw query text), a count of <code>1</code>, and <code>usdc_micros</code>.</p>
            <p><strong>Response caching (Cloudflare Cache API):</strong> research results, without billing details, <code>request_id</code>, or latency, are cached by a SHA-256 hash of the query parameters for 10 minutes (<code>24h</code> timeframe), 30 minutes (<code>7d</code> timeframe), or 2 hours (<code>30d</code> or custom timeframe).</p>
            <p><strong>Rate limits and logs:</strong> rate limits are counted per wallet address (paid and trial requests) or per client IP address (<code>cf-connecting-ip</code>, for unpaid and discovery requests) over 60-second windows. Operational logs record <code>request_id</code> and status codes and never record payment signatures or secrets.</p>
          </section>

          <section aria-labelledby="privacy-onchain">
            <h2 id="privacy-onchain">On-chain payments are public</h2>
            <p>Paid calls settle $0.02 USDC per call on the Base blockchain through an x402 payment facilitator. Blockchain transactions, wallet addresses, and transaction hashes (<code>tx_hash</code>) are permanently public on Base.</p>
          </section>

          <section aria-labelledby="privacy-retention">
            <h2 id="privacy-retention">Retention and data requests</h2>
            <p>Rows in <code>api_keys</code> and <code>plan_usage</code> are kept while the subscription exists and afterwards until you ask us to delete them via <a href="/support">Support</a>. MentionForge does not automatically delete those rows when a subscription ends. Stripe keeps its own payment records under its policy; deleting our rows does not delete Stripe&rsquo;s.</p>
            <p>Private requests (access or deletion): email harbor-ops@mail.grokbot.com.</p>
            <p>Questions or bug reports: ${ISSUES_LINK}.</p>
          </section>`,
  },
  terms: {
    heading: "Terms of service",
    title: "Terms of service — MentionForge",
    eyebrow: "Legal",
    description:
      "Terms for the MentionForge API and MCP server: as-is service, $0.02 USDC per paid call via x402, a 10-call free trial per wallet, and API key subscriptions.",
    lede: "The terms for using the MentionForge REST API and MCP server, written to be read: pricing, the free trial, acceptable use, and subscriptions.",
    toc: [
      ["terms-as-is", "Service provided as-is"],
      ["terms-payments", "Pricing, free trial, and finality"],
      ["terms-use", "Rate limits and acceptable use"],
      ["terms-key-subscription", "API key subscription"],
      ["terms-license", "License and contact"],
    ],
    sectionsHtml: `          <section aria-labelledby="terms-as-is">
            <h2 id="terms-as-is">Service provided as-is</h2>
            <p>MentionForge is provided &ldquo;AS IS&rdquo; and &ldquo;AS AVAILABLE&rdquo; without warranties of any kind, express or implied, including accuracy, completeness, availability, or fitness for a particular purpose.</p>
            <p>Responses aggregate snippets and links from public sources such as news (Google News RSS, GDELT, Hacker News), web sources (Wikipedia, Wikidata, and Brave Search when configured), and review sites. Do not use MentionForge for live trading execution or automated high-stakes decisions without human review.</p>
          </section>

          <section aria-labelledby="terms-payments">
            <h2 id="terms-payments">Pricing, free trial, and on-chain finality</h2>
            <p>Free discovery and grounding endpoints (<code>GET /health</code>, <code>GET /v1/pricing</code>, <code>GET /v1/research/example</code>, <code>GET /v1/entity</code>, <code>GET /v1/suggest</code>) cost $0.</p>
            <p>Each wallet address receives 10 free trial calls shared across paid research endpoints and MCP tools by sending the <code>X-Wallet</code> header.</p>
            <p>Paid calls cost $0.02 USDC per call on the Base blockchain via the x402 payment protocol (<code>PAYMENT-SIGNATURE</code> header) and settle on-chain through an x402 payment facilitator. Once an on-chain payment settles, the blockchain transaction is final and irreversible.</p>
            <p>Nothing is charged when a request is denied before settlement (for example validation errors, rate limits, upstream source failures, or rolling quota limits). Replaying the same request body with the same <code>Idempotency-Key</code> within 24 hours returns the stored response without charging again.</p>
          </section>

          <section aria-labelledby="terms-use">
            <h2 id="terms-use">Rate limits and acceptable use</h2>
            <p>Requests are subject to per-minute rate limits (<code>HTTP 429</code> with <code>Retry-After</code>) and a rolling 30-day disclosed-ID quota. Do not flood endpoints or attempt to bypass rate limits or payment verification.</p>
          </section>

          <section aria-labelledby="terms-key-subscription">
            <h2 id="terms-key-subscription">API key subscription</h2>
            <p>An API key subscription is a monthly subscription billed in advance by Stripe. It renews automatically until cancelled. Each billing period includes a quota of 1,500 research calls. The price and billing interval are shown at Stripe Checkout before you pay.</p>
            <p>Cancel anytime via the Stripe billing portal (<code>POST /v1/keys/portal</code>) or <a href="/support">Support</a>. Cancellation takes effect at the end of the current billing period; you keep access until then. There are no pro-rated refunds by default. Refund requests are reviewed case by case via <a href="/support">Support</a>.</p>
            <p>If a renewal payment fails, access continues until the end of the current billing period, then stops until payment succeeds.</p>
            <p>Your API key is shown once. Keep it safe.</p>
            <p>When your 1,500 calls for the billing period are used up, further key requests are denied until the next billing period, and nothing is charged. The service&rsquo;s global rate limits and rolling 30-day ID quota also apply to key plans.</p>
            <p>Keys may be revoked for abuse. The service is provided as-is.</p>
          </section>

          <section aria-labelledby="terms-license">
            <h2 id="terms-license">Open-source license and contact</h2>
            <p>The repository code is licensed under the <a href="${MIT_LICENSE_URL}">MIT License</a>. Product names (MentionForge, MENTION//FORGE) and brand marks are covered by <a href="${TRADEMARK_URL}"><code>TRADEMARK.md</code></a> in the repository.</p>
            <p>Private requests: email harbor-ops@mail.grokbot.com.</p>
            <p>GitHub Issues (bugs and non-private questions only): ${ISSUES_LINK}.</p>
          </section>`,
  },
  about: {
    heading: "About MentionForge",
    title: "About MentionForge — open-source social listening for agents",
    eyebrow: "Company",
    description:
      "MentionForge is MIT-licensed social listening and brand research for AI agents and developers, over REST and MCP, citing public news, web, and review sources.",
    lede: "Cited social listening and brand research for AI agents and the people who build them, delivered over REST and the Model Context Protocol.",
    sectionsHtml: `          <section aria-labelledby="about-what">
            <h2 id="about-what">What MentionForge does</h2>
            <p>Ask about a brand, product, competitor, or topic and MentionForge returns one structured, cited brief: how much it is being discussed, the sentiment mix, recurring themes, and the individual mentions, each linked to its source.</p>
            <p>It runs on Cloudflare Workers and offers two ways in: a REST API (<code>POST /v1/research</code> plus focused endpoints for comparisons, digests, risk, replies, mention exports, and trends) and a Streamable HTTP Model Context Protocol server at <code>/mcp</code> whose main tool is <code>research_mentions</code>.</p>
          </section>

          <section aria-labelledby="about-who">
            <h2 id="about-who">Who it&rsquo;s for</h2>
            <div class="data-grid">
              <article class="data-card">
                <h3>Agent builders</h3>
                <p>Give your agent one dependable tool for brand, product, and competitor questions instead of stitching together raw web searches.</p>
              </article>
              <article class="data-card">
                <h3>Developers</h3>
                <p>Call one REST endpoint and get structured JSON with citations, request IDs, and retries that never charge twice.</p>
              </article>
              <article class="data-card">
                <h3>Founders</h3>
                <p>See how your product and your competitors are discussed across news, the web, and review sites.</p>
              </article>
              <article class="data-card">
                <h3>Marketers</h3>
                <p>Get share of voice, recurring themes, and early warning of negative spikes, with every mention linked to its source.</p>
              </article>
            </div>
          </section>

          <section aria-labelledby="about-sources">
            <h2 id="about-sources">Where the data comes from</h2>
            <p>MentionForge searches public sources only:</p>
            <ul class="check-list" role="list">
              <li><strong>News:</strong> Google News RSS, GDELT, and Hacker News.</li>
              <li><strong>Web:</strong> Wikipedia, Wikidata, and Brave Search when configured, plus GitHub Issues and Stack Overflow for developer topics.</li>
              <li><strong>Review sites:</strong> Trustpilot, G2, and Capterra, found through web search.</li>
            </ul>
            <p>Native Reddit and X feeds are optional upgrades that need official API access, and they are off by default. Which sources are live right now is always published at <a href="/health">GET /health</a>.</p>
          </section>

          <section aria-labelledby="about-pricing">
            <h2 id="about-pricing">How pricing and trials work</h2>
            <p>Discovery and grounding endpoints are free. Paid research calls cost $0.02 USDC per completed call on Base via the x402 payment standard, with 10 free trial calls per wallet via the <code>X-Wallet</code> header. Denied requests (such as rate-limit or quota errors) do not settle and are not charged. See <a href="/#pricing">pricing</a> for worked examples.</p>
          </section>

          <section aria-labelledby="about-open-source">
            <h2 id="about-open-source">Open source &amp; MIT license</h2>
            <p>MentionForge source code is released under the <a href="${MIT_LICENSE_URL}">MIT License</a>: read it, fork it, and suggest improvements. The names MentionForge and MENTION//FORGE and the logo are covered by the <a href="${TRADEMARK_URL}">trademark policy</a>.</p>
            <p>Repository: <a href="${REPO_URL}">${REPO_URL}</a> · Issues: ${ISSUES_LINK}.</p>
          </section>

          <section aria-labelledby="about-listings">
            <h2 id="about-listings">Find MentionForge</h2>
            <p>MentionForge is listed on <a href="${DIRECTORY_LINKS.glama}">Glama</a> and the <a href="${DIRECTORY_LINKS.official_registry}">Official MCP Registry</a> (<code>io.github.EnkiduHub/MentionForge</code>), and its paid endpoints are discoverable through x402 indexes such as <a href="${DIRECTORY_LINKS.x402scan}">x402scan</a>.</p>
            <p>Questions, ideas, or bugs? Open a <a href="${ISSUES_URL}">GitHub issue</a>. For help with an account or billing, visit <a href="/support">Support</a>.</p>
          </section>`,
  },
};

function supportMailtoAnchor(email: string): string {
  const safe = escapeHtml(email.trim());
  return `<a href="mailto:${safe}">${safe}</a>`;
}

function tocHtml(toc: ReadonlyArray<readonly [string, string]>): string {
  const items = toc.map(([id, label]) => `            <li><a href="#${id}">${escapeHtml(label)}</a></li>`).join("\n");
  return `        <nav class="toc" aria-label="On this page">
          <p class="toc-title">On this page</p>
          <ol role="list">
${items}
          </ol>
        </nav>`;
}

function trustJsonLd(slug: TrustPageSlug, spec: TrustPageSpec) {
  const url = `${SITE_ORIGIN}/${slug}`;
  const page = {
    "@type": slug === "about" ? "AboutPage" : "WebPage",
    "@id": `${url}#webpage`,
    url,
    name: spec.title,
    description: spec.description,
    inLanguage: "en",
    isPartOf: { "@id": `${SITE_ORIGIN}/#website` },
    breadcrumb: { "@id": `${url}#breadcrumb` },
    ...(slug === "about" ? { about: { "@id": `${SITE_ORIGIN}/#organization` } } : {}),
  };
  const breadcrumb = {
    "@type": "BreadcrumbList",
    "@id": `${url}#breadcrumb`,
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_ORIGIN}/` },
      { "@type": "ListItem", position: 2, name: spec.heading, item: url },
    ],
  };
  return { "@context": "https://schema.org", "@graph": [...siteGraphNodes(), page, breadcrumb] };
}

export function trustPageHtml(slug: TrustPageSlug, env?: Pick<Env, "SUPPORT_EMAIL">): string {
  const spec = TRUST_PAGES[slug];
  const path = `/${slug}`;
  const email = (env?.SUPPORT_EMAIL ?? "").trim();
  let sectionsHtml = spec.sectionsHtml;
  if (email && slug === "privacy") {
    sectionsHtml = sectionsHtml.replace(
      "Private requests (access or deletion): email harbor-ops@mail.grokbot.com.",
      `Data requests (access or deletion): <a href="/support">/support</a> or ${supportMailtoAnchor(email)}.`,
    );
  }
  if (email && slug === "terms") {
    sectionsHtml = sectionsHtml.replace(
      "Private requests: email harbor-ops@mail.grokbot.com.",
      `Private requests: <a href="/support">/support</a> or ${supportMailtoAnchor(email)}.`,
    );
  }
  const body = spec.toc
    ? `      <div class="container doc-layout">
${tocHtml(spec.toc)}
        <div class="prose">
${sectionsHtml}
        </div>
      </div>`
    : `      <div class="container doc-layout doc-layout-single">
        <div class="prose">
${sectionsHtml}
        </div>
      </div>`;
  const main = `${pageHeroHtml({ eyebrow: spec.eyebrow, title: spec.heading, lede: spec.lede, mark: "webp" })}
${body}`;
  return pageDocumentHtml({
    meta: { title: spec.title, description: spec.description, path, jsonLd: trustJsonLd(slug, spec) },
    current: path,
    bodyClass: `page-${slug}`,
    main,
  });
}

export type ClaimPageView =
  | { mode: "ready"; sessionId: string }
  | { mode: "revealed"; key: string }
  | { mode: "error"; code: string; message: string; hint: string };

const CLAIM_CURL_EXAMPLE = `curl -X POST https://mentionforge.mentionforge.workers.dev/v1/research -H 'Authorization: Bearer YOUR_KEY' -H 'content-type: application/json' -d '{"query":"Cloudflare Workers"}'`;

function claimStepsHtml(active: 1 | 2 | 3): string {
  const steps = ["Subscription confirmed", "Reveal and save your key", "Start making calls"];
  const items = steps
    .map((label, i) => {
      const n = i + 1;
      const state = n < active ? "done" : n === active ? "current" : "next";
      const aria = n === active ? ' aria-current="step"' : "";
      return `<li class="step step-${state}"${aria}><span class="step-n">${n < active ? icon("check", "icon icon-sm") : n}</span><span>${label}</span></li>`;
    })
    .join("");
  return `            <ol class="steps" role="list">${items}</ol>`;
}

export function claimPageHtml(view: ClaimPageView): string {
  const title =
    view.mode === "ready"
      ? "Claim your API key"
      : view.mode === "revealed"
        ? "Your API key"
        : view.code === "KEY_ALREADY_CLAIMED"
          ? "API key already claimed"
          : "Unable to claim API key";

  const lede =
    view.mode === "ready"
      ? "Your Key plan subscription is confirmed. Reveal your API key below when you are ready to copy and store it."
      : view.mode === "revealed"
        ? "Your Key plan API key has been generated and claimed."
        : view.message;

  let mainContent = "";
  if (view.mode === "ready") {
    mainContent = `      <div class="container narrow flow">
        <section class="panel" aria-labelledby="claim-ready-title">
          <h2 id="claim-ready-title">One-time key reveal</h2>
          <p class="notice notice-warn"><strong>Save this key now - it is shown once</strong> after you click the button below. Refreshing this page before clicking does not consume your key.</p>
          <form method="post" action="/v1/keys/claim">
            <input type="hidden" name="session_id" value="${escapeHtml(view.sessionId)}"/>
            <div class="cta-row">
              <button type="submit" class="btn btn-primary btn-lg">Reveal my API key</button>
            </div>
          </form>
          <p class="muted">Quota: 1,500 calls per billing period · Need help? Visit <a href="/support">/support</a>.</p>
        </section>
      </div>`;
  } else if (view.mode === "revealed") {
    const mcpExample = JSON.stringify(
      {
        mcpServers: {
          mentionforge: {
            url: "https://mentionforge.mentionforge.workers.dev/mcp",
            headers: {
              Authorization: "Bearer YOUR_KEY",
            },
          },
        },
      },
      null,
      2,
    );
    mainContent = `      <div class="container narrow flow">
        <section class="code-card code-card-key" aria-labelledby="claim-key-title">
          <div class="code-head">
            <h2 id="claim-key-title">API key</h2>
            <div class="code-actions">${copyButtonHtml("api-key")}</div>
          </div>
          <p class="notice notice-warn"><strong>Save this key now - it is shown once</strong>. MentionForge stores only the SHA-256 hash after this page is served. If you lose it, see <a href="/support">/support</a> to have it reissued.</p>
          <pre id="api-key">${escapeHtml(view.key)}</pre>
        </section>

        <section class="code-card" aria-labelledby="claim-howto-title">
          <div class="code-head">
            <h2 id="claim-howto-title">Quickstart (REST)</h2>
            <div class="code-actions">${copyButtonHtml("claim-curl")}</div>
          </div>
          <p>Send <code>Authorization: Bearer YOUR_KEY</code> (or <code>X-Api-Key</code>) on any paid endpoint (<code>/v1/research</code>, <code>/v1/compare</code>, <code>/v1/digest</code>, <code>/v1/risk</code>, <code>/v1/reply</code>, <code>/v1/mentions</code>, <code>/v1/trends</code>):</p>
          <pre id="claim-curl" tabindex="0">${CLAIM_CURL_EXAMPLE}</pre>
        </section>

        <section class="code-card" aria-labelledby="claim-mcp-title">
          <div class="code-head">
            <h2 id="claim-mcp-title">Use it with MCP</h2>
            <div class="code-actions">${copyButtonHtml("claim-mcp")}</div>
          </div>
          <p>For Streamable HTTP MCP (<code>/mcp</code>), pass your key in the <code>Authorization: Bearer YOUR_KEY</code> (or <code>X-Api-Key</code>) request header:</p>
          <pre id="claim-mcp" tabindex="0">${mcpExample}</pre>
        </section>

        <section aria-labelledby="claim-manage-title">
          <h2 id="claim-manage-title">Quota, usage, billing portal, and support</h2>
          <div class="data-grid">
            <article class="data-card">
              <h3>Quota</h3>
              <p><strong>1,500 calls per billing period</strong> across paid research endpoints and MCP tools. Calls stop at 1,500 with HTTP 429 <code>PLAN_QUOTA_REACHED</code> and reset automatically when your next billing period renews.</p>
            </article>
            <article class="data-card">
              <h3>Check usage <code>/v1/keys/me</code></h3>
              <p>Call <code>GET /v1/keys/me</code> with <code>Authorization: Bearer YOUR_KEY</code> to see <code>calls_used</code>, <code>calls_limit</code>, <code>calls_remaining</code>, <code>period_start</code>, and <code>period_end</code>.</p>
            </article>
            <article class="data-card">
              <h3>Manage or cancel <code>/v1/keys/portal</code></h3>
              <p>Call <code>POST /v1/keys/portal</code> with <code>Authorization: Bearer YOUR_KEY</code> to receive a Stripe Billing Portal <code>{ url }</code> where you can update payment methods or cancel anytime.</p>
            </article>
            <article class="data-card">
              <h3>Support</h3>
              <p>Lost your key, need it reissued, or need billing help? Visit <a href="/support">/support</a>.</p>
            </article>
          </div>
        </section>
      </div>`;
  } else {
    mainContent = `      <div class="container narrow flow">
        <section class="panel" aria-labelledby="claim-error-title">
          <h2 id="claim-error-title">What to do next</h2>
          <p>${escapeHtml(view.hint)}</p>
          <p>Need assistance or lost your key? See <a href="/support">/support</a> to have it reissued or manage your subscription.</p>
          <p class="muted">Error code: <code>${escapeHtml(view.code)}</code></p>
        </section>
      </div>`;
  }

  const steps = view.mode === "ready" ? claimStepsHtml(2) : view.mode === "revealed" ? claimStepsHtml(3) : "";
  const main = `${pageHeroHtml({
    eyebrow: "API key plan",
    title,
    lede,
    mark: "chrome",
    extra: steps || undefined,
  })}
${mainContent}`;
  return pageDocumentHtml({
    meta: {
      title: `${title} — MentionForge`,
      description: "Reveal and save your MentionForge API key after checkout, then start making calls.",
      robots: "noindex, nofollow",
      script: "/claim.js",
    },
    bodyClass: "page-claim",
    main,
  });
}

export function supportPageHtml(env?: Pick<Env, "SUPPORT_EMAIL">): string {
  const email = (env?.SUPPORT_EMAIL ?? "").trim();
  const description =
    "Help with MentionForge API keys and subscriptions: replace a lost key, check usage, manage billing or cancel, request a refund, or contact us.";

  const lostKeyParagraph = email
    ? `For your security, API keys (they start with <code>mfk_</code>) are shown once on the post-checkout claim page; only the SHA-256 hash is stored afterwards, so we cannot look a key up, but we can replace it. Email ${supportMailtoAnchor(email)} from your checkout email address (do not post your email address, Stripe session ID or API key in a public GitHub issue). We reissue a replacement key after verifying your checkout email or session ID.`
    : `For your security, API keys (they start with <code>mfk_</code>) are shown once on the post-checkout claim page; only the SHA-256 hash is stored afterwards, so we cannot look a key up, but we can replace it. Private requests: email harbor-ops@mail.grokbot.com.`;
  const contactHtml = email
    ? `<p>Email: ${supportMailtoAnchor(email)}</p>
            <p>GitHub Issues (bugs and non-private questions only): ${ISSUES_LINK}</p>`
    : `<p>Private requests: email harbor-ops@mail.grokbot.com.</p>
            <p>GitHub Issues (bugs and non-private questions only): ${ISSUES_LINK}</p>`;

  const quick = [
    ["support-lost-key", "Lost API key", "Get a replacement key"],
    ["support-manage", "Usage & billing", "Check quota, update payment, cancel"],
    ["support-refunds", "Refunds", "How cancellations and refunds work"],
    ["support-contact", "Contact", "Email or GitHub Issues"],
  ] as const;
  const quickHtml = quick
    .map(
      ([id, label, desc]) =>
        `            <li><a class="quick-card" href="#${id}"><span class="quick-title">${label}</span><span class="quick-desc">${desc}</span>${icon("arrow", "icon icon-sm")}</a></li>`,
    )
    .join("\n");

  const main = `${pageHeroHtml({
    eyebrow: "Help center",
    title: "Support",
    lede: "Help with API keys and subscriptions: replace a lost key, check usage, manage billing or cancel, request a refund, or get in touch.",
    mark: "webp",
  })}
      <div class="container narrow flow">
        <nav aria-label="Support topics">
          <ul class="quick-grid" role="list">
${quickHtml}
          </ul>
        </nav>

        <section aria-labelledby="support-lost-key">
          <h2 id="support-lost-key">Lost your API key?</h2>
          <p>${lostKeyParagraph}</p>
        </section>

        <section aria-labelledby="support-manage">
          <h2 id="support-manage">Check usage &amp; cancel anytime</h2>
          <p>See your current billing period and remaining quota at any time with <code>GET /v1/keys/me</code>:</p>
          <div class="code-card code-card-inline">
            <div class="code-head"><span class="code-lang">Check usage</span><div class="code-actions">${copyButtonHtml("support-usage-curl")}</div></div>
            <pre id="support-usage-curl" tabindex="0">curl -sS https://mentionforge.mentionforge.workers.dev/v1/keys/me \\
  -H 'Authorization: Bearer YOUR_KEY'</pre>
          </div>
          <p>Cancel anytime or update your payment method in the Stripe Billing Portal by calling <code>POST /v1/keys/portal</code> with your API key:</p>
          <div class="code-card code-card-inline">
            <div class="code-head"><span class="code-lang">Open billing portal</span><div class="code-actions">${copyButtonHtml("support-portal-curl")}</div></div>
            <pre id="support-portal-curl" tabindex="0">curl -sS -X POST https://mentionforge.mentionforge.workers.dev/v1/keys/portal \\
  -H 'Authorization: Bearer YOUR_KEY'</pre>
          </div>
          <p>Open the returned <code>url</code> in your browser to manage or cancel your subscription. If you no longer have your API key or cannot reach the billing portal, contact support below with your checkout email and we will cancel it for you.</p>
        </section>

        <section aria-labelledby="support-refunds">
          <h2 id="support-refunds">Cancellations &amp; refunds</h2>
          <p>Cancelled subscriptions stop renewing and stay active until the end of the current billing period (<code>period_end</code>). Refund requests are handled case by case via support.</p>
        </section>

        <section aria-labelledby="support-contact">
          <h2 id="support-contact">Contact</h2>
            ${contactHtml}
        </section>
      </div>`;
  return pageDocumentHtml({
    meta: { title: "Support — MentionForge", description, path: "/support", robots: "noindex, nofollow" },
    current: "/support",
    bodyClass: "page-support",
    main,
  });
}
