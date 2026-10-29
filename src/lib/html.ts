import { BRAND_ASSETS } from "./brand-assets";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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

/** Resolve relative Open Graph tags so crawlers hit this deployment's origin. */
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
    );
}

const DISCOVERY_NAV: Array<[string, string]> = [
  ["/llms.txt", "llms.txt"],
  ["/skill.md", "skill.md"],
  ["/openapi.json", "OpenAPI"],
  ["/.well-known/x402", "x402"],
  ["/v1/pricing", "pricing"],
  ["/v1/research/example", "example"],
  ["/v1/entity", "entity"],
  ["/v1/suggest", "suggest"],
  ["/health", "health"],
];

export const TRUST_PAGE_SLUGS = ["privacy", "terms", "about"] as const;
export type TrustPageSlug = (typeof TRUST_PAGE_SLUGS)[number];

const TRUST_NAV: Array<[string, string]> = [
  ["/", "Home"],
  ["/about", "About"],
  ["/privacy", "Privacy"],
  ["/terms", "Terms"],
];

/** Same chrome as the landing so header links open real pages, not a raw dump. */
export function discoveryDocumentHtml(opts: {
  title: string;
  hint: string;
  path: string;
  body: string;
}): string {
  const pathOnly = opts.path.split("?")[0] ?? opts.path;
  const rawHref = `${pathOnly}?raw=1`;
  const nav = DISCOVERY_NAV.map(([href, label]) => {
    const current = pathOnly === href ? ' aria-current="page"' : "";
    return `<a href="${href}"${current}>${escapeHtml(label)}</a>`;
  }).join("\n        ");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="color-scheme" content="dark"/>
  <meta name="theme-color" content="#0B0C0F"/>
  <title>MENTION//FORGE — ${escapeHtml(opts.title)}</title>
  <meta name="description" content="${escapeHtml(opts.hint)}"/>
  <link rel="icon" href="${BRAND_ASSETS.favicon}" type="image/png" sizes="128x128"/>
  <link rel="stylesheet" href="/styles.css"/>
  <script src="/app.js" defer></script>
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <div class="aurora" aria-hidden="true"></div>
  <div class="wrap">
    <header class="top">
      <p class="eyebrow"><a class="brand-link" href="/">MENTION//FORGE</a></p>
      <nav aria-label="Discovery">
        ${nav}
      </nav>
    </header>
    <main id="main">
      <header class="hero hero-compact">
        <div>
          <h1>${escapeHtml(opts.title)}</h1>
          <p class="lede muted">${escapeHtml(opts.hint)}</p>
          <ul class="facts" id="facts" hidden></ul>
        </div>
        <div class="mark-wrap">
          <img class="mark mark-sm" src="${BRAND_ASSETS.chrome}" width="96" height="96" alt=""/>
        </div>
      </header>
      <section aria-labelledby="payload-title">
        <div class="section-head">
          <h2 id="payload-title"><code>${escapeHtml(pathOnly)}</code></h2>
          <div class="section-actions">
            <a class="copy raw-link" href="${escapeHtml(rawHref)}">Raw</a>
            <button type="button" class="copy" data-copy="payload">Copy</button>
          </div>
        </div>
        <pre id="payload">${escapeHtml(opts.body)}</pre>
      </section>
    </main>
    <footer class="site-foot">
      <p><a href="/">Public landing</a> · <a href="/about">About</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · MIT · <a href="https://github.com/EnkiduHub/MentionForge">source</a> · <a href="/" id="origin-link">this deployment</a></p>
    </footer>
  </div>
</body>
</html>`;
}

type TrustPageSpec = {
  title: string;
  description: string;
  sectionsHtml: string;
};

const TRUST_PAGES: Record<TrustPageSlug, TrustPageSpec> = {
  privacy: {
    title: "Privacy",
    description:
      "Plain-language summary of what MentionForge stores in Cloudflare D1, Analytics Engine, and Cache API; how on-chain x402 payments work; and what Stripe collects.",
    sectionsHtml: `      <section aria-labelledby="privacy-accounts">
        <h2 id="privacy-accounts">Accounts, email, and payments</h2>
        <p>Free trial and pay-per-call use need no account, sign-up, password, or tracking cookies. If you subscribe to an API key plan, Stripe (our payment processor) collects your email address and payment details under <a href="https://stripe.com/privacy">Stripe&rsquo;s privacy policy</a>. MentionForge does not receive card numbers. Stripe emails receipts and invoices to the subscriber.</p>
      </section>

      <section aria-labelledby="privacy-d1">
        <h2 id="privacy-d1">What is stored in Cloudflare D1</h2>
        <div class="grid">
          <article class="card">
            <h3><code>trial_wallets</code></h3>
            <p>When a caller sends the <code>X-Wallet</code> header to use the 10-call free trial, the Worker stores the lowercased wallet address (<code>wallet</code>), the number of trial calls used (<code>used</code>, up to 10), and the last update timestamp (<code>updated_at</code>).</p>
          </article>
          <article class="card">
            <h3><code>idempotency</code></h3>
            <p>When a paid or trial call includes an <code>Idempotency-Key</code> header, the Worker stores the key, a SHA-256 hash of the canonical request body (<code>body_hash</code>), status, the JSON response, billing metadata (<code>amount_usdc</code>, <code>tx_hash</code>, <code>free_trial</code>), and <code>created_at</code>. Entries expire after 24 hours and are deleted on lookup after expiry.</p>
          </article>
          <article class="card">
            <h3><code>stats_daily</code></h3>
            <p>The Worker records daily aggregate totals (<code>day</code>, <code>calls</code>, <code>paid</code>, <code>usdc_micros</code>, <code>errors</code>, <code>trial</code>). No wallet addresses, IP addresses, or raw query strings are stored in this table.</p>
          </article>
          <article class="card">
            <h3><code>x_id_usage</code></h3>
            <p>The Worker records daily counts (<code>day</code>, <code>ids</code>) of disclosed mention and post IDs over a rolling 30-day window to enforce the global 30-day quota.</p>
          </article>
        </div>
        <p>In plain words: if you subscribe, we keep a fingerprint (hash) of your API key, your Stripe customer and subscription IDs, billing dates and how many calls you&rsquo;ve used. We never see your card number.</p>
        <div class="grid">
          <article class="card">
            <h3><code>api_keys</code></h3>
            <p>If you subscribe to an API key plan, the Worker stores a SHA-256 hash of your API key (<code>key_hash</code>; the plain key is shown once on the claim page and is not retained after claim), Stripe customer ID (<code>stripe_customer_id</code>), Stripe subscription ID (<code>stripe_subscription_id</code>), plan status (<code>status</code>), billing-period dates (<code>period_start</code>, <code>period_end</code>), row creation time (<code>created_at</code>), Checkout session ID (<code>checkout_session_id</code>), whether the key has been claimed (<code>claimed</code>), and a temporary <code>pending_key</code> that is cleared after claim.</p>
          </article>
          <article class="card">
            <h3><code>plan_usage</code></h3>
            <p>Per-key usage counts for quota: API key hash (<code>key_hash</code>), billing period start (<code>period_start</code>), and calls used in that period (<code>calls</code>).</p>
          </article>
          <article class="card">
            <h3><code>stripe_events</code></h3>
            <p>Webhook event IDs (<code>event_id</code>) and receive timestamps (<code>received_at</code>) so the same Stripe event is not applied twice. This table does not store email addresses or card numbers.</p>
          </article>
        </div>
      </section>

      <section aria-labelledby="privacy-metrics">
        <h2 id="privacy-metrics">Metrics, caching, and rate limits</h2>
        <p><strong>Analytics Engine (<code>METRICS</code>):</strong> On completed or errored research calls, the Worker writes an event kind (<code>paid</code>, <code>trial</code>, or <code>error</code>), the UTC date, a SHA-256 hash of the normalized query string (not the raw query text), a count of <code>1</code>, and <code>usdc_micros</code>.</p>
        <p><strong>Cloudflare Cache API:</strong> Research responses (excluding billing metadata, <code>request_id</code>, and latency) are cached by a SHA-256 hash of the query parameters for 10 minutes (<code>24h</code> timeframe), 30 minutes (<code>7d</code> timeframe), or 2 hours (<code>30d</code> or custom timeframe).</p>
        <p><strong>Rate limiting and logs:</strong> Cloudflare rate limiters key on wallet address (for paid and trial requests) or client IP address (<code>cf-connecting-ip</code> for unpaid and discovery requests) over 60-second windows. Structured operational logs record <code>request_id</code> and status codes and never log payment signatures or secrets.</p>
      </section>

      <section aria-labelledby="privacy-onchain">
        <h2 id="privacy-onchain">On-chain payments are public</h2>
        <p>Paid calls settle $0.02 USDC per call on Base (or Base Sepolia on staging) via the configured x402 facilitator. Blockchain transactions, wallet addresses, and transaction hashes (<code>tx_hash</code>) are permanently public on the Base blockchain.</p>
      </section>

      <section aria-labelledby="privacy-retention">
        <h2 id="privacy-retention">Retention and data requests</h2>
        <p>Rows in <code>api_keys</code> and <code>plan_usage</code> are kept while the subscription exists and afterwards until you ask us to delete them via <a href="/support">/support</a>. MentionForge does not automatically delete those rows when a subscription ends. Stripe keeps its own payment records under its policy; deleting our rows does not delete Stripe&rsquo;s.</p>
        <p>Private requests (access or deletion): email harbor-ops@mail.grokbot.com.</p>
        <p>Questions or bug reports: <a href="https://github.com/EnkiduHub/MentionForge/issues">https://github.com/EnkiduHub/MentionForge/issues</a>.</p>
      </section>`,
  },
  terms: {
    title: "Terms",
    description:
      "Plain-language terms for using the MentionForge REST API and MCP server: as-is service, $0.02 USDC x402 settlement, 10-call wallet trial, API key subscription.",
    sectionsHtml: `      <section aria-labelledby="terms-as-is">
        <h2 id="terms-as-is">Service provided as-is</h2>
        <p>MentionForge is provided &ldquo;AS IS&rdquo; and &ldquo;AS AVAILABLE&rdquo; without warranties of any kind, express or implied, including accuracy, completeness, availability, or fitness for a particular purpose.</p>
        <p>Responses aggregate snippets and links from public sources such as news (Google News RSS, GDELT, Hacker News), web sources (Wikipedia, Wikidata, and Brave Search when configured), and review sites. Do not use MentionForge for live trading execution or automated high-stakes decisions without human review.</p>
      </section>

      <section aria-labelledby="terms-payments">
        <h2 id="terms-payments">Pricing, free trial, and on-chain finality</h2>
        <p>Free discovery and grounding endpoints (<code>GET /health</code>, <code>GET /v1/pricing</code>, <code>GET /v1/research/example</code>, <code>GET /v1/entity</code>, <code>GET /v1/suggest</code>) cost $0.</p>
        <p>Each wallet address receives 10 free trial calls shared across paid research endpoints and MCP tools by sending the <code>X-Wallet</code> header.</p>
        <p>Paid calls cost $0.02 USDC per call on Base (or Base Sepolia on staging) via the x402 payment protocol (<code>PAYMENT-SIGNATURE</code> header) and settle on-chain through the configured facilitator. Once an on-chain payment settles, the blockchain transaction is final and irreversible.</p>
        <p>Nothing is charged when a request is denied before settlement (for example validation errors, rate limits, upstream source failures, or rolling quota limits). Replaying the same request body with the same <code>Idempotency-Key</code> within 24 hours returns the stored response without charging again.</p>
      </section>

      <section aria-labelledby="terms-use">
        <h2 id="terms-use">Rate limits and acceptable use</h2>
        <p>Requests are subject to per-minute rate limits (<code>HTTP 429</code> with <code>Retry-After</code>) and a rolling 30-day disclosed-ID quota. Do not flood endpoints or attempt to bypass rate limits or payment verification.</p>
      </section>

      <section aria-labelledby="terms-key-subscription">
        <h2 id="terms-key-subscription">API key subscription</h2>
        <p>An API key subscription is a monthly subscription billed in advance by Stripe. It renews automatically until cancelled. Each billing period includes a quota of 1,500 research calls. The price and billing interval are shown at Stripe Checkout before you pay.</p>
        <p>Cancel anytime via the Stripe billing portal (<code>POST /v1/keys/portal</code>) or <a href="/support">/support</a>. Cancellation takes effect at the end of the current billing period; you keep access until then. There are no pro-rated refunds by default. Refund requests are reviewed case by case via <a href="/support">/support</a>.</p>
        <p>If a renewal payment fails, access continues until the end of the current billing period, then stops until payment succeeds.</p>
        <p>Your API key is shown once. Keep it safe.</p>
        <p>When your 1,500 calls for the billing period are used up, further key requests are denied until the next billing period, and nothing is charged. The service&rsquo;s global rate limits and rolling 30-day ID quota also apply to key plans.</p>
        <p>Keys may be revoked for abuse. The service is provided as-is.</p>
      </section>

      <section aria-labelledby="terms-license">
        <h2 id="terms-license">Open-source license and contact</h2>
        <p>The repository code is licensed under the <a href="https://opensource.org/licenses/MIT">MIT License</a>. Product names (MentionForge, MENTION//FORGE) and brand marks are covered by <code>TRADEMARK.md</code> in the repository.</p>
        <p class="muted">Private requests: email harbor-ops@mail.grokbot.com.</p>
        <p class="muted">GitHub Issues (bugs and non-private questions only): <a href="https://github.com/EnkiduHub/MentionForge/issues">https://github.com/EnkiduHub/MentionForge/issues</a>.</p>
      </section>`,
  },
  about: {
    title: "About",
    description:
      "About MentionForge: MIT-licensed agent social listening and brand research over REST and MCP, citing public news, web, and review sources.",
    sectionsHtml: `      <section aria-labelledby="about-what">
        <h2 id="about-what">What MentionForge is</h2>
        <p>MentionForge is a social listening and company/product research service for software agents and developers. It runs on Cloudflare Workers and exposes both a REST API (<code>POST /v1/research</code> and specialized lenses) and a Streamable HTTP Model Context Protocol server (<code>/mcp</code>, primary tool <code>research_mentions</code>).</p>
        <p>For a brand, product, competitor, or topic query, MentionForge searches public sources &mdash; news (Google News RSS, GDELT, Hacker News), web (Wikipedia, Wikidata, and Brave Search when configured; plus GitHub Issues and Stack Overflow for developer queries), and review sites (via web search targeting Trustpilot, G2, and Capterra) &mdash; and returns structured volume, sentiment breakdown, themes, cited mentions, and an extractive summary.</p>
        <p>Official Reddit and X API adapters are optional upgrades and are disabled by default (<code>DISABLED_SOURCES=x,reddit</code>). Live adapter status is published at <a href="/health">GET /health</a>.</p>
      </section>

      <section aria-labelledby="about-pricing">
        <h2 id="about-pricing">How pricing and trials work</h2>
        <p>Discovery and grounding endpoints are free. Paid research calls cost $0.02 USDC per completed call on Base via the x402 payment standard, with 10 free trial calls per wallet via the <code>X-Wallet</code> header. Denied requests (such as rate-limit or quota errors) do not settle and are not charged.</p>
      </section>

      <section aria-labelledby="about-open-source">
        <h2 id="about-open-source">Open source &amp; MIT license</h2>
        <p>MentionForge source code is released under the <a href="https://opensource.org/licenses/MIT">MIT License</a>.</p>
        <p>Repository: <a href="https://github.com/EnkiduHub/MentionForge">https://github.com/EnkiduHub/MentionForge</a> · Issues: <a href="https://github.com/EnkiduHub/MentionForge/issues">https://github.com/EnkiduHub/MentionForge/issues</a>.</p>
      </section>`,
  },
};

function supportMailtoAnchor(email: string): string {
  const safe = escapeHtml(email.trim());
  return `<a href="mailto:${safe}">${safe}</a>`;
}

export function trustPageHtml(slug: TrustPageSlug, env?: Pick<Env, "SUPPORT_EMAIL">): string {
  const spec = TRUST_PAGES[slug];
  const path = `/${slug}`;
  const canonicalUrl = `https://mentionforge.mentionforge.workers.dev${path}`;
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
  const headerNav = (
    [
      ["/llms.txt", "llms.txt"],
      ["/skill.md", "skill.md"],
      ["/openapi.json", "OpenAPI"],
      ["/.well-known/x402", "x402"],
      ["/v1/pricing", "pricing"],
      ["/v1/research/example", "example"],
      ["/health", "health"],
      ["https://github.com/EnkiduHub/MentionForge", "GitHub"],
    ] satisfies Array<[string, string]>
  )
    .map(([href, label]) => `<a href="${href}">${escapeHtml(label)}</a>`)
    .join("\n        ");
  const footerNav = TRUST_NAV.map(([href, label]) => {
    const current = href === path ? ' aria-current="page"' : "";
    return `<a href="${href}"${current}>${escapeHtml(label)}</a>`;
  }).join("\n        ");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="color-scheme" content="dark"/>
  <meta name="theme-color" content="#0B0C0F"/>
  <title>MENTION//FORGE — ${escapeHtml(spec.title)}</title>
  <meta name="description" content="${escapeHtml(spec.description)}"/>
  <meta property="og:title" content="MENTION//FORGE — ${escapeHtml(spec.title)}"/>
  <meta property="og:description" content="${escapeHtml(spec.description)}"/>
  <meta property="og:type" content="website"/>
  <meta property="og:site_name" content="MentionForge"/>
  <meta property="og:locale" content="en_US"/>
  <meta property="og:url" content="${canonicalUrl}"/>
  <meta property="og:image" content="${BRAND_ASSETS.og}"/>
  <link rel="canonical" href="${canonicalUrl}"/>
  <link rel="icon" href="${BRAND_ASSETS.faviconIco}" sizes="any"/>
  <link rel="icon" href="${BRAND_ASSETS.favicon}" type="image/png" sizes="128x128"/>
  <link rel="apple-touch-icon" href="${BRAND_ASSETS.appleTouch}"/>
  <link rel="stylesheet" href="/styles.css"/>
  <script src="/app.js" defer></script>
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <div class="aurora" aria-hidden="true"></div>
  <div class="wrap">
    <header class="top">
      <p class="eyebrow"><a class="brand-link" href="/">MENTION//FORGE</a></p>
      <nav aria-label="Discovery">
        ${headerNav}
      </nav>
    </header>
    <main id="main">
      <header class="hero hero-compact">
        <div>
          <h1>${escapeHtml(spec.title)}</h1>
          <p class="lede muted">${escapeHtml(spec.description)}</p>
        </div>
        <div class="mark-wrap">
          <img class="mark mark-sm" src="${BRAND_ASSETS.chrome}" width="96" height="96" alt=""/>
        </div>
      </header>

${sectionsHtml}
    </main>
    <footer class="site-foot">
      <nav aria-label="Footer">
        ${footerNav}
      </nav>
      <p>REST <code>POST /v1/research</code> · MCP <code>research_mentions</code> · <a href="/stats">volume</a> · <a href="/about">About</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · MIT · <a href="https://github.com/EnkiduHub/MentionForge">source</a> · <a href="/" id="origin-link">this deployment</a></p>
      <p class="dirs"><a href="https://github.com/EnkiduHub/MentionForge">GitHub</a> · <a href="https://glama.ai/mcp/servers/@EnkiduHub/MentionForge">Glama</a> · <a href="https://smithery.ai/servers/enkiduhub/mentionforge">Smithery</a> · <a href="https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.EnkiduHub/MentionForge">Official Registry</a> · <a href="https://www.x402scan.com">x402scan</a></p>
    </footer>
  </div>
</body>
</html>
`;
}

export type ClaimPageView =
  | { mode: "ready"; sessionId: string }
  | { mode: "revealed"; key: string }
  | { mode: "error"; code: string; message: string; hint: string };

const CLAIM_CURL_EXAMPLE = `curl -X POST https://mentionforge.mentionforge.workers.dev/v1/research -H 'Authorization: Bearer YOUR_KEY' -H 'content-type: application/json' -d '{"query":"Cloudflare Workers"}'`;

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
    mainContent = `      <section aria-labelledby="claim-ready-title">
        <h2 id="claim-ready-title">One-time key reveal</h2>
        <p><strong>Save this key now - it is shown once</strong> after you click the button below. Refreshing this page before clicking does not consume your key.</p>
        <form method="post" action="/v1/keys/claim">
          <input type="hidden" name="session_id" value="${escapeHtml(view.sessionId)}"/>
          <div class="cta">
            <button type="submit" class="btn">Reveal my API key</button>
          </div>
        </form>
        <p class="muted">Quota: 1,500 calls per billing period · Need help? Visit <a href="/support">/support</a>.</p>
      </section>`;
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
    mainContent = `      <section aria-labelledby="claim-key-title">
        <div class="section-head">
          <h2 id="claim-key-title">API key</h2>
          <button type="button" class="copy" data-copy="api-key">Copy</button>
        </div>
        <p><strong>Save this key now - it is shown once</strong>. MentionForge stores only the SHA-256 hash after this page is served. If you lose it, see <a href="/support">/support</a> to have it reissued.</p>
        <pre id="api-key">${escapeHtml(view.key)}</pre>
      </section>

      <section aria-labelledby="claim-howto-title">
        <div class="section-head">
          <h2 id="claim-howto-title">Quickstart (REST)</h2>
          <button type="button" class="copy" data-copy="claim-curl">Copy</button>
        </div>
        <p>Send <code>Authorization: Bearer YOUR_KEY</code> (or <code>X-Api-Key</code>) on any paid endpoint (<code>/v1/research</code>, <code>/v1/compare</code>, <code>/v1/digest</code>, <code>/v1/risk</code>, <code>/v1/reply</code>, <code>/v1/mentions</code>, <code>/v1/trends</code>):</p>
        <pre id="claim-curl">${CLAIM_CURL_EXAMPLE}</pre>
      </section>

      <section aria-labelledby="claim-mcp-title">
        <div class="section-head">
          <h2 id="claim-mcp-title">MCP header note</h2>
          <button type="button" class="copy" data-copy="claim-mcp">Copy</button>
        </div>
        <p>For Streamable HTTP MCP (<code>/mcp</code>), pass your key in the <code>Authorization: Bearer YOUR_KEY</code> (or <code>X-Api-Key</code>) request header:</p>
        <pre id="claim-mcp">${mcpExample}</pre>
      </section>

      <section aria-labelledby="claim-manage-title">
        <h2 id="claim-manage-title">Quota, usage, billing portal, and support</h2>
        <div class="grid">
          <article class="card">
            <h3>Quota</h3>
            <p><strong>1,500 calls per billing period</strong> across paid research endpoints and MCP tools. Calls stop at 1,500 with HTTP 429 <code>PLAN_QUOTA_REACHED</code> and reset automatically when your next billing period renews.</p>
          </article>
          <article class="card">
            <h3>Check usage (<code>/v1/keys/me</code>)</h3>
            <p>Call <code>GET /v1/keys/me</code> with <code>Authorization: Bearer YOUR_KEY</code> to see <code>calls_used</code>, <code>calls_limit</code>, <code>calls_remaining</code>, <code>period_start</code>, and <code>period_end</code>.</p>
          </article>
          <article class="card">
            <h3>Manage or cancel (<code>/v1/keys/portal</code>)</h3>
            <p>Call <code>POST /v1/keys/portal</code> with <code>Authorization: Bearer YOUR_KEY</code> to receive a Stripe Billing Portal <code>{ url }</code> where you can update payment methods or cancel anytime.</p>
          </article>
          <article class="card">
            <h3>Support (<code>/support</code>)</h3>
            <p>Lost your key, need it reissued, or need billing help? Visit <a href="/support">/support</a>.</p>
          </article>
        </div>
      </section>`;
  } else {
    mainContent = `      <section aria-labelledby="claim-error-title">
        <h2 id="claim-error-title"><code>${escapeHtml(view.code)}</code></h2>
        <p>${escapeHtml(view.hint)}</p>
        <p>Need assistance or lost your key? See <a href="/support">/support</a> to have it reissued or manage your subscription.</p>
      </section>`;
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="color-scheme" content="dark"/>
  <meta name="theme-color" content="#0B0C0F"/>
  <meta name="robots" content="noindex, nofollow"/>
  <title>MENTION//FORGE — ${escapeHtml(title)}</title>
  <link rel="icon" href="${BRAND_ASSETS.faviconIco}" sizes="any"/>
  <link rel="icon" href="${BRAND_ASSETS.favicon}" type="image/png" sizes="128x128"/>
  <link rel="apple-touch-icon" href="${BRAND_ASSETS.appleTouch}"/>
  <link rel="stylesheet" href="/styles.css"/>
  <script src="/claim.js" defer></script>
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <div class="aurora" aria-hidden="true"></div>
  <div class="wrap">
    <header class="top">
      <p class="eyebrow"><a class="brand-link" href="/">MENTION//FORGE</a></p>
      <nav aria-label="Discovery">
        <a href="/">Home</a>
        <a href="/llms.txt">llms.txt</a>
        <a href="/openapi.json">OpenAPI</a>
        <a href="/support">support</a>
      </nav>
    </header>
    <main id="main">
      <header class="hero hero-compact">
        <div>
          <h1>${escapeHtml(title)}</h1>
          <p class="lede muted">${escapeHtml(lede)}</p>
        </div>
        <div class="mark-wrap">
          <img class="mark mark-sm" src="${BRAND_ASSETS.chrome}" width="96" height="96" alt=""/>
        </div>
      </header>

${mainContent}
    </main>
    <footer class="site-foot">
      <p><a href="/">Home</a> · <a href="/support">Support</a> · <a href="/about">About</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · MIT · <a href="https://github.com/EnkiduHub/MentionForge">source</a> · <a href="/" id="origin-link">this deployment</a></p>
    </footer>
  </div>
</body>
</html>
`;
}

export function supportPageHtml(env?: Pick<Env, "SUPPORT_EMAIL">): string {
  const email = (env?.SUPPORT_EMAIL ?? "").trim();
  const canonicalUrl = "https://mentionforge.mentionforge.workers.dev/support";
  const description =
    "Support for MentionForge API keys and subscriptions: lost key reissue, checking usage, billing portal cancellation, refunds, and contact.";
  const headerNav = (
    [
      ["/llms.txt", "llms.txt"],
      ["/skill.md", "skill.md"],
      ["/openapi.json", "OpenAPI"],
      ["/.well-known/x402", "x402"],
      ["/v1/pricing", "pricing"],
      ["/v1/research/example", "example"],
      ["/health", "health"],
      ["https://github.com/EnkiduHub/MentionForge", "GitHub"],
    ] satisfies Array<[string, string]>
  )
    .map(([href, label]) => `<a href="${href}">${escapeHtml(label)}</a>`)
    .join("\n        ");
  const footerNav = (
    [
      ["/", "Home"],
      ["/about", "About"],
      ["/privacy", "Privacy"],
      ["/terms", "Terms"],
      ["/support", "Support"],
    ] satisfies Array<[string, string]>
  )
    .map(([href, label]) => {
      const current = href === "/support" ? ' aria-current="page"' : "";
      return `<a href="${href}"${current}>${escapeHtml(label)}</a>`;
    })
    .join("\n        ");

  const lostKeyParagraph = email
    ? `Plaintext API keys (<code>mfk_...</code>) are shown once on the post-checkout claim page; only the SHA-256 hash is stored afterwards. Email ${supportMailtoAnchor(email)} from your checkout email address (do not post your email address, Stripe session ID or API key in a public GitHub issue). We reissue a replacement key after verifying your checkout email or session ID.`
    : `Plaintext API keys (<code>mfk_...</code>) are shown once on the post-checkout claim page; only the SHA-256 hash is stored afterwards. Private requests: email harbor-ops@mail.grokbot.com.`;
  const contactHtml = email
    ? `<p>Email: ${supportMailtoAnchor(email)}</p>
        <p>GitHub Issues (bugs and non-private questions only): <a href="https://github.com/EnkiduHub/MentionForge/issues">https://github.com/EnkiduHub/MentionForge/issues</a></p>`
    : `<p>Private requests: email harbor-ops@mail.grokbot.com.</p>
        <p>GitHub Issues (bugs and non-private questions only): <a href="https://github.com/EnkiduHub/MentionForge/issues">https://github.com/EnkiduHub/MentionForge/issues</a></p>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="color-scheme" content="dark"/>
  <meta name="theme-color" content="#0B0C0F"/>
  <meta name="robots" content="noindex, nofollow"/>
  <title>MENTION//FORGE — Support</title>
  <meta name="description" content="${escapeHtml(description)}"/>
  <meta property="og:title" content="MENTION//FORGE — Support"/>
  <meta property="og:description" content="${escapeHtml(description)}"/>
  <meta property="og:type" content="website"/>
  <meta property="og:site_name" content="MentionForge"/>
  <meta property="og:locale" content="en_US"/>
  <meta property="og:url" content="${canonicalUrl}"/>
  <meta property="og:image" content="${BRAND_ASSETS.og}"/>
  <link rel="canonical" href="${canonicalUrl}"/>
  <link rel="icon" href="${BRAND_ASSETS.faviconIco}" sizes="any"/>
  <link rel="icon" href="${BRAND_ASSETS.favicon}" type="image/png" sizes="128x128"/>
  <link rel="apple-touch-icon" href="${BRAND_ASSETS.appleTouch}"/>
  <link rel="stylesheet" href="/styles.css"/>
  <script src="/app.js" defer></script>
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <div class="aurora" aria-hidden="true"></div>
  <div class="wrap">
    <header class="top">
      <p class="eyebrow"><a class="brand-link" href="/">MENTION//FORGE</a></p>
      <nav aria-label="Discovery">
        ${headerNav}
      </nav>
    </header>
    <main id="main">
      <header class="hero hero-compact">
        <div>
          <h1>Support</h1>
          <p class="lede muted">${escapeHtml(description)}</p>
        </div>
        <div class="mark-wrap">
          <img class="mark mark-sm" src="${BRAND_ASSETS.chrome}" width="96" height="96" alt=""/>
        </div>
      </header>

      <section aria-labelledby="support-lost-key">
        <h2 id="support-lost-key">Lost API key</h2>
        <p>${lostKeyParagraph}</p>
      </section>

      <section aria-labelledby="support-manage">
        <h2 id="support-manage">Check usage &amp; cancel anytime</h2>
        <p>Check your current billing period and remaining quota at any time with <code>GET /v1/keys/me</code>:</p>
        <pre>curl -sS https://mentionforge.mentionforge.workers.dev/v1/keys/me \\
  -H 'Authorization: Bearer YOUR_KEY'</pre>
        <p>Cancel anytime or update your payment method through the Stripe Billing Portal by calling <code>POST /v1/keys/portal</code> with your API key:</p>
        <pre>curl -sS -X POST https://mentionforge.mentionforge.workers.dev/v1/keys/portal \\
  -H 'Authorization: Bearer YOUR_KEY'</pre>
        <p>Open the returned <code>url</code> in your browser to manage or cancel your subscription. If you no longer have your API key or cannot access the billing portal, contact support below with your checkout email and we will cancel it for you.</p>
      </section>

      <section aria-labelledby="support-refunds">
        <h2 id="support-refunds">Cancellations &amp; refunds</h2>
        <p>Cancelled subscriptions stop renewing and remain active until the end of the current billing period (<code>period_end</code>). Refund requests are handled case by case via support.</p>
      </section>

      <section aria-labelledby="support-contact">
        <h2 id="support-contact">Contact</h2>
        ${contactHtml}
      </section>
    </main>
    <footer class="site-foot">
      <nav aria-label="Footer">
        ${footerNav}
      </nav>
      <p>REST <code>POST /v1/research</code> · MCP <code>research_mentions</code> · <a href="/stats">volume</a> · <a href="/about">About</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/support">Support</a> · MIT · <a href="https://github.com/EnkiduHub/MentionForge">source</a> · <a href="/" id="origin-link">this deployment</a></p>
      <p class="dirs"><a href="https://github.com/EnkiduHub/MentionForge">GitHub</a> · <a href="https://glama.ai/mcp/servers/@EnkiduHub/MentionForge">Glama</a> · <a href="https://smithery.ai/servers/enkiduhub/mentionforge">Smithery</a> · <a href="https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.EnkiduHub/MentionForge">Official Registry</a> · <a href="https://www.x402scan.com">x402scan</a></p>
    </footer>
  </div>
</body>
</html>
`;
}
