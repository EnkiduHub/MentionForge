/**
 * Shared website chrome: <head> metadata, site header, footer, page hero, and inline icons.
 *
 * Every HTML page uses these helpers so navigation, metadata, and branding stay identical:
 * the server-rendered pages in `src/lib/html.ts`, their static twins in `public/*.html`
 * (regenerated with `npm run pages:render`), and the hand-written `public/index.html`,
 * whose header and footer a unit test compares byte-for-byte with `siteHeaderHtml("/")`
 * and `siteFooterHtml("/")`. Design notes: `docs/DESIGN-SYSTEM.md`.
 */
import { BRAND_ASSETS } from "./brand-assets";
import { DIRECTORY_LINKS } from "./discoverability";
import { escapeHtml, jsonLdScript } from "./escape";

/** Production origin. Canonical/OG URLs are rewritten to the serving origin by `absolutizePublicHtml`. */
export const SITE_ORIGIN = "https://mentionforge.mentionforge.workers.dev";
export const SITE_NAME = "MentionForge";
export const SITE_HOST = new URL(SITE_ORIGIN).host;
export const REPO_URL = DIRECTORY_LINKS.github;
export const ISSUES_URL = `${REPO_URL}/issues`;
export const SECURITY_POLICY_URL = `${REPO_URL}/blob/main/SECURITY.md`;
export const TRADEMARK_URL = `${REPO_URL}/blob/main/TRADEMARK.md`;
export const MIT_LICENSE_URL = "https://opensource.org/licenses/MIT";
export const THEME_COLOR = "#0B0C0F";
export const COPYRIGHT_YEAR = 2026;

type Link = { href: string; label: string };
type ResourceLink = Link & { desc: string };

/** Machine-readable product surfaces, listed in the header menu, footer, and resource tabs. */
export const RESOURCE_LINKS: readonly ResourceLink[] = [
  { href: "/llms.txt", label: "llms.txt", desc: "Agent install guide" },
  { href: "/llms-full.txt", label: "llms-full.txt", desc: "Full agent guide" },
  { href: "/skill.md", label: "skill.md", desc: "Agent skill" },
  { href: "/openapi.json", label: "OpenAPI", desc: "REST API schema" },
  { href: "/server-card.json", label: "MCP server card", desc: "Tools and install" },
  { href: "/.well-known/x402", label: "x402", desc: "Payment discovery" },
  { href: "/v1/pricing", label: "Pricing API", desc: "Price and trial terms" },
  { href: "/v1/research/example", label: "Example", desc: "Free sample response" },
  { href: "/v1/entity?query=Cloudflare", label: "Entity", desc: "Free identity card" },
  { href: "/v1/suggest?need=compare%20two%20brands", label: "Suggest", desc: "Free tool picker" },
  { href: "/health", label: "Status", desc: "Live service status" },
  { href: "/stats", label: "Usage", desc: "Completed research calls" },
] as const;

/** The subset shown in the header "Developers" menu (same set the header has always linked). */
const HEADER_RESOURCES = ["/llms.txt", "/skill.md", "/openapi.json", "/.well-known/x402", "/v1/pricing", "/v1/research/example", "/health"];

const PRIMARY_NAV: readonly Link[] = [
  { href: "/#how", label: "How it works" },
  { href: "/#tools", label: "Tools" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
  { href: "/about", label: "About" },
];

const FOOTER_COLUMNS: ReadonlyArray<{ id: string; title: string; links: readonly Link[] }> = [
  {
    id: "foot-product",
    title: "Product",
    links: [
      { href: "/", label: "Home" },
      { href: "/#how", label: "How it works" },
      { href: "/#example", label: "Live example" },
      { href: "/#tools", label: "Tools" },
      { href: "/#pricing", label: "Pricing" },
      { href: "/#faq", label: "FAQ" },
    ],
  },
  {
    id: "foot-developers",
    title: "Developers",
    links: [
      { href: "/#install", label: "Quickstart" },
      { href: "/llms.txt", label: "Agent install guide" },
      { href: "/llms-full.txt", label: "Full agent guide" },
      { href: "/skill.md", label: "Agent skill" },
      { href: "/openapi.json", label: "OpenAPI schema" },
      { href: "/server-card.json", label: "MCP server card" },
      { href: "/.well-known/x402", label: "x402 discovery" },
      { href: "/v1/pricing", label: "Pricing API" },
      { href: "/health", label: "Service status" },
      { href: "/stats", label: "Usage stats" },
    ],
  },
  {
    id: "foot-company",
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/support", label: "Support" },
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
      { href: SECURITY_POLICY_URL, label: "Security policy" },
    ],
  },
  {
    id: "foot-listings",
    title: "Find us",
    links: [
      { href: DIRECTORY_LINKS.github, label: "GitHub" },
      { href: DIRECTORY_LINKS.glama, label: "Glama" },
      { href: DIRECTORY_LINKS.official_registry, label: "Official MCP Registry" },
      { href: DIRECTORY_LINKS.x402scan, label: "x402scan" },
    ],
  },
];

const ICON_PATHS = {
  github:
    '<path fill="currentColor" stroke="none" d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  external: '<path d="M7 17 17 7M9 7h8v8"/>',
} as const;

export type IconName = keyof typeof ICON_PATHS;

/** Decorative inline SVG icon (CSP-safe: presentation attributes only, no inline style). */
export function icon(name: IconName, className = "icon"): string {
  const box = name === "github" ? "0 0 16 16" : "0 0 24 24";
  return `<svg class="${className}" viewBox="${box}" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name]}</svg>`;
}

/** Copy-to-clipboard button for the `<pre id="…">` named by `target`. Hidden until JS is available. */
export function copyButtonHtml(target: string, label = "Copy"): string {
  return `<button type="button" class="copy" data-copy="${escapeHtml(target)}">${icon("copy")}<span class="copy-label">${escapeHtml(label)}</span></button>`;
}

export type PageMeta = {
  /** Full document title. */
  title: string;
  description: string;
  /** Canonical path (e.g. "/about"). Pages with a path get canonical, Open Graph, and Twitter tags. */
  path?: string;
  robots?: string;
  /** Social title; defaults to `title`. */
  socialTitle?: string;
  script?: "/app.js" | "/claim.js";
  /** Structured data object(s), serialized safely into one JSON-LD block. */
  jsonLd?: unknown;
};

/** Everything inside <head>, indented for a two-space document. */
export function siteHeadHtml(meta: PageMeta): string {
  const lines = [
    '<meta charset="utf-8"/>',
    '<meta name="viewport" content="width=device-width, initial-scale=1"/>',
    '<meta name="color-scheme" content="dark"/>',
    `<meta name="theme-color" content="${THEME_COLOR}"/>`,
  ];
  if (meta.robots) lines.push(`<meta name="robots" content="${escapeHtml(meta.robots)}"/>`);
  lines.push(`<title>${escapeHtml(meta.title)}</title>`);
  lines.push(`<meta name="description" content="${escapeHtml(meta.description)}"/>`);
  if (meta.path) {
    const url = `${SITE_ORIGIN}${meta.path}`;
    const social = escapeHtml(meta.socialTitle ?? meta.title);
    const desc = escapeHtml(meta.description);
    lines.push(
      `<meta property="og:title" content="${social}"/>`,
      `<meta property="og:description" content="${desc}"/>`,
      '<meta property="og:type" content="website"/>',
      `<meta property="og:site_name" content="${SITE_NAME}"/>`,
      '<meta property="og:locale" content="en_US"/>',
      `<meta property="og:url" content="${url}"/>`,
      `<meta property="og:image" content="${BRAND_ASSETS.og}"/>`,
      `<meta property="og:image:type" content="${BRAND_ASSETS.ogType}"/>`,
      `<meta property="og:image:width" content="${BRAND_ASSETS.ogWidth}"/>`,
      `<meta property="og:image:height" content="${BRAND_ASSETS.ogHeight}"/>`,
      `<meta property="og:image:alt" content="${escapeHtml(BRAND_ASSETS.ogAlt)}"/>`,
      '<meta name="twitter:card" content="summary_large_image"/>',
      `<meta name="twitter:title" content="${social}"/>`,
      `<meta name="twitter:description" content="${desc}"/>`,
      `<meta name="twitter:image" content="${BRAND_ASSETS.og}"/>`,
      `<link rel="canonical" href="${url}"/>`,
    );
  }
  lines.push(
    `<link rel="icon" href="${BRAND_ASSETS.faviconIco}" sizes="any"/>`,
    `<link rel="icon" href="${BRAND_ASSETS.favicon}" type="image/png" sizes="128x128"/>`,
    `<link rel="apple-touch-icon" href="${BRAND_ASSETS.appleTouch}"/>`,
    '<link rel="stylesheet" href="/styles.css"/>',
    `<script src="${meta.script ?? "/app.js"}" defer></script>`,
  );
  if (meta.jsonLd !== undefined) lines.push(jsonLdScript(meta.jsonLd));
  return lines.map((l) => `  ${l}`).join("\n");
}

function navLink(link: Link, current: string | undefined, className?: string): string {
  const here = current !== undefined && link.href === current ? ' aria-current="page"' : "";
  const cls = className ? ` class="${className}"` : "";
  return `<a${cls} href="${escapeHtml(link.href)}"${here}>${escapeHtml(link.label)}</a>`;
}

function resourceMenuItems(indent: string): string {
  return RESOURCE_LINKS.filter((r) => HEADER_RESOURCES.includes(r.href))
    .map(
      (r) =>
        `${indent}<li><a href="${escapeHtml(r.href)}"><span class="menu-label">${escapeHtml(r.label)}</span><span class="menu-desc">${escapeHtml(r.desc)}</span></a></li>`,
    )
    .join("\n");
}

/**
 * Sticky site header. `current` is the page path; it marks the matching primary link with
 * aria-current. Menus are native <details> elements, so they work without JavaScript.
 */
export function siteHeaderHtml(current?: string): string {
  const primary = PRIMARY_NAV.map((l) => `        ${navLink(l, current)}`).join("\n");
  const mobilePrimary = PRIMARY_NAV.map((l) => `            <li>${navLink(l, current)}</li>`).join("\n");
  return `  <header class="site-header">
    <div class="container header-inner">
      <a class="brand" href="/">
        <img class="brand-mark" src="/logo-96w.webp" width="28" height="28" alt=""/>
        <span class="brand-word">MENTION//FORGE</span>
      </a>
      <nav class="nav-primary" aria-label="Primary">
${primary}
        <details class="menu menu-dev">
          <summary>Developers ${icon("chevron", "icon icon-sm")}</summary>
          <ul class="menu-panel" role="list">
${resourceMenuItems("            ")}
          </ul>
        </details>
      </nav>
      <div class="header-actions">
        <a class="icon-link" href="${REPO_URL}">${icon("github")}<span class="sr-only">MentionForge on GitHub</span></a>
        <a class="btn btn-primary btn-sm header-cta" href="/#install">Get started</a>
        <details class="menu menu-mobile">
          <summary>${icon("menu")}<span class="sr-only">Menu</span></summary>
          <nav class="menu-panel menu-sheet" aria-label="Mobile">
            <ul role="list">
${mobilePrimary}
            </ul>
            <p class="menu-heading">Developers</p>
            <ul role="list">
${resourceMenuItems("              ")}
            </ul>
            <a class="btn btn-primary" href="/#install">Get started free</a>
          </nav>
        </details>
      </div>
    </div>
  </header>`;
}

/** Site footer with product, developer, company, and listing links. */
export function siteFooterHtml(current?: string): string {
  const columns = FOOTER_COLUMNS.map((col) => {
    const items = col.links.map((l) => `            <li>${navLink(l, current)}</li>`).join("\n");
    return `        <div class="foot-col">
          <p class="foot-title" id="${col.id}">${escapeHtml(col.title)}</p>
          <ul role="list" aria-labelledby="${col.id}">
${items}
          </ul>
        </div>`;
  }).join("\n");
  return `  <footer class="site-footer">
    <div class="container">
      <div class="foot-grid">
        <div class="foot-brand">
          <a class="brand" href="/">
            <img class="brand-mark" src="/logo-96w.webp" width="28" height="28" alt=""/>
            <span class="brand-word">MENTION//FORGE</span>
          </a>
          <p>Cited social listening and brand research for AI agents and the people who build them.</p>
          <p class="foot-endpoints">REST <code>POST /v1/research</code> · MCP <code>research_mentions</code></p>
        </div>
        <nav class="foot-nav" aria-label="Footer">
${columns}
        </nav>
      </div>
      <div class="foot-bottom">
        <p>© ${COPYRIGHT_YEAR} ${SITE_NAME}. Source code under the <a href="${MIT_LICENSE_URL}">MIT License</a>.</p>
        <p><a href="/" id="origin-link">${SITE_HOST}</a></p>
      </div>
    </div>
  </footer>`;
}

export type PageMark = "webp" | "chrome";

/** Small brand mark used in page heroes. `webp` = 96/192 WebP; `chrome` keeps the 256px PNG as src. */
export function pageMarkHtml(mark: PageMark): string {
  const src = mark === "webp" ? "/logo-96w.webp" : BRAND_ASSETS.chrome;
  return `<img class="mark mark-sm" src="${src}" srcset="/logo-96w.webp 1x, /logo-192w.webp 2x" width="96" height="96" alt=""/>`;
}

/** Hero band for secondary pages: eyebrow, the page's only <h1>, and a lede. */
export function pageHeroHtml(opts: { eyebrow: string; title: string; lede: string; mark: PageMark; extra?: string }): string {
  return `      <header class="page-hero">
        <div class="container page-hero-inner">
          <div class="page-hero-copy">
            <p class="eyebrow">${escapeHtml(opts.eyebrow)}</p>
            <h1>${escapeHtml(opts.title)}</h1>
            <p class="lede">${escapeHtml(opts.lede)}</p>${opts.extra ? `\n${opts.extra}` : ""}
          </div>
          <div class="page-hero-mark">
            ${pageMarkHtml(opts.mark)}
          </div>
        </div>
      </header>`;
}

/** Complete HTML document with shared chrome around page-specific `<main>` content. */
export function pageDocumentHtml(opts: { meta: PageMeta; current?: string; bodyClass: string; main: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
${siteHeadHtml(opts.meta)}
</head>
<body class="${escapeHtml(opts.bodyClass)}">
  <a class="skip" href="#main">Skip to content</a>
  <div class="aurora" aria-hidden="true"></div>
${siteHeaderHtml(opts.current)}
    <main id="main">
${opts.main}
    </main>
${siteFooterHtml(opts.current)}
</body>
</html>
`;
}

/** schema.org Organization + WebSite nodes shared by page-level JSON-LD graphs. */
export function siteGraphNodes(origin = SITE_ORIGIN) {
  return [
    {
      "@type": "Organization",
      "@id": `${origin}/#organization`,
      name: SITE_NAME,
      alternateName: "MENTION//FORGE",
      url: `${origin}/`,
      logo: { "@type": "ImageObject", url: `${origin}${BRAND_ASSETS.hero}`, width: 512, height: 512 },
      sameAs: [DIRECTORY_LINKS.github, DIRECTORY_LINKS.glama],
    },
    {
      "@type": "WebSite",
      "@id": `${origin}/#website`,
      name: SITE_NAME,
      url: `${origin}/`,
      inLanguage: "en",
      publisher: { "@id": `${origin}/#organization` },
    },
  ];
}
