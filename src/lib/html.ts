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
  return html
    .replaceAll('content="/og.svg"', `content="${base}/og.svg"`)
    .replace(/<meta property="og:url" content="[^"]*"\s*\/?>/, `<meta property="og:url" content="${base}/"/>`)
    .replace(/<link rel="canonical" href="[^"]*"\s*\/?>/, `<link rel="canonical" href="${base}/"/>`);
}

const DISCOVERY_NAV: Array<[string, string]> = [
  ["/llms.txt", "llms.txt"],
  ["/openapi.json", "OpenAPI"],
  ["/.well-known/x402", "x402"],
  ["/v1/pricing", "pricing"],
  ["/v1/research/example", "example"],
  ["/health", "health"],
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
  <link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
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
    <header class="hero hero-compact">
      <div>
        <h1 id="main">${escapeHtml(opts.title)}</h1>
        <p class="lede muted">${escapeHtml(opts.hint)}</p>
        <ul class="facts" id="facts" hidden></ul>
      </div>
      <div class="mark-wrap">
        <img class="mark mark-sm" src="/logo.svg" width="96" height="96" alt=""/>
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
    <footer class="site-foot">
      <p><a href="/">Public landing</a> · MIT · <a href="https://github.com/EnkiduHub/mentionforge">source</a> · <a href="/" id="origin-link">this deployment</a></p>
    </footer>
  </div>
</body>
</html>`;
}
