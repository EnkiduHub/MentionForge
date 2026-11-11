# Website design system

How the public website served by this Worker is built, styled, and kept honest. It covers the
landing page, About, Privacy, Terms, Support, the API key claim page, the browser views of
machine-readable surfaces (`/health`, `/llms.txt`, `/openapi.json`, …), and the 404 page.

The brand is **MENTION//FORGE**: a dark, premium developer product. Forge warmth (ember, gold) meets
signal clarity (cyan rings), on a near-black canvas. The aim is a Linear/Vercel/Stripe-calibre
page: calm typography, generous space, precise detail, and motion that never gets in the way.

## Principles

1. **Honest by construction.** Every number and claim comes from the code or the README: price
   (`$0.02 USDC`), trial (10 calls), sources, limits. The landing never shows testimonials, logos,
   ratings, or usage claims beyond the live `GET /stats` counter. Native Reddit and X feeds are
   described as off by default. The landing and About pages do not market the API key plan (tests
   enforce this).
2. **Plain language first, exact details second.** Lead with what a buyer gets, then name the
   endpoint or header in `code` for developers.
3. **Works without JavaScript.** All content is server-rendered. Scripts only add copy buttons,
   menu polish, presets, live refreshes, and scroll reveals.
4. **Fast and stable.** System fonts, one stylesheet, one deferred script, small WebP marks,
   no layout shift (CLS 0) from client updates.
5. **Accessible.** WCAG 2.2 AA colour contrast, visible focus, one `<h1>` per page, ordered
   headings, skip link, keyboard-operable menus, `prefers-reduced-motion` respected.
6. **CSP-safe.** The HTML CSP is `default-src 'none'; script-src 'self'; style-src 'self'; img-src
   'self' data:; …` (`src/lib/security-headers.ts`). No inline styles, no inline event handlers,
   and no inline scripts other than JSON-LD data blocks. Scripts only change styles through the
   CSSOM (bar widths).

## Page architecture

| URL | Rendered by | Static twin in `public/` | Notes |
| --- | --- | --- | --- |
| `/` | `public/index.html` (hand-written) hydrated by `hydrateLandingHtml()` in `src/lib/landing.ts` | (itself) | Worker fills live status, sources, usage, the example report, the tool gallery, and JSON-LD before first paint |
| `/about` | `trustPageHtml("about")` in `src/lib/html.ts` | `about.html` | Served from the static twin |
| `/privacy`, `/terms` | `trustPageHtml(slug, env)` | `privacy.html`, `terms.html` | Server-rendered with a `mailto:` link when `SUPPORT_EMAIL` is set; twin is the no-email fallback |
| `/support` | `supportPageHtml(env)` | `support.html` | `noindex`; same `SUPPORT_EMAIL` rule |
| `/v1/keys/claim` | `claimPageHtml(view)` | none | Ready, revealed, and error states; `noindex`, `no-store` |
| Browser views of `/health`, `/llms.txt`, `/openapi.json`, … | `discoveryDocumentHtml()` via `sendPublic()` | none | Agents asking for JSON or text get the original bytes; `?raw=1` forces them |
| Unknown paths (browser) | `discoveryDocumentHtml({ status: 404 })` | none | Branded 404 with the JSON error under "Technical details" |
| `/operator` | `src/routes/operator.ts` | none | Operator-only (401 for everyone else); uses the legacy `.wrap`/`.card` classes |

Shared chrome lives in `src/lib/site-chrome.ts`:

- `siteHeadHtml(meta)`: charset, viewport, theme colour, title, description, canonical, Open Graph,
  Twitter card, icons, stylesheet, script, and optional JSON-LD.
- `siteHeaderHtml(current)`: sticky header, primary nav, "Developers" menu, GitHub link, CTA, and
  mobile menu. Menus are native `<details>`, so they work without JavaScript.
- `siteFooterHtml(current)`: product, developer, company, and directory links.
- `pageHeroHtml()`, `pageDocumentHtml()`, `copyButtonHtml()`, `icon()`, `RESOURCE_LINKS`.

### Changing a page

1. Edit `src/lib/html.ts` (or `site-chrome.ts`, or `public/index.html` for the landing).
2. Run `npm run pages:render` to regenerate `public/{about,privacy,terms,support}.html` and to
   sync the shared header and footer into `public/index.html`. `npm run pages:render -- --check`
   fails if anything is stale.
3. Run `npm test`. Unit tests fail if a twin, the landing chrome, or a token drifts.

### Landing hydration markers

`hydrateLandingHtml()` replaces these exact strings in `public/index.html`. Keep them verbatim:

| Marker | Replaced with |
| --- | --- |
| `<span class="dot" data-ready></span>` | `data-ready="true"` or `"false"` from `paymentsReady()` |
| `<span id="live-label"> Base · $0.02 USDC</span>` | ` Live · Base` / ` Degraded · Base` |
| `<span class="chip" id="network-chip">Base</span>` | Network name for this deployment |
| `<span class="net-name">Base</span>` (every one) | Network name for this deployment |
| `<li>Loading from GET /health…</li>` | Source status rows from `sourceBackends()` |
| `<p class="stat" id="calls">—</p>` | Completed research calls from `GET /stats` |
| `<p class="muted">Loading snapshot…</p>` | The example report from `EXAMPLE_RESPONSE` |
| `<div id="tool-gallery" class="tool-gallery"></div>` | Free and paid tool cards from `mcpToolCards()` |

`public/app.js` refreshes the same elements with identical markup, so a refresh never shifts layout.

## Tokens

Defined once in `src/brand/tokens.ts` (`BRAND`, `DESIGN_TOKENS`) and declared as CSS custom
properties at the top of `public/styles.css`. `tests/unit/site-pages.test.ts` fails if they drift.

### Colour

| Token | CSS | Hex | Use |
| --- | --- | --- | --- |
| canvas | `--mf-canvas` | `#0B0C0F` | Page background |
| surface1 | `--mf-surface-1` | `#111318` | Cards, panels |
| surface2 | `--mf-surface-2` | `#161920` | Raised cards, report header |
| surface3 | `--mf-surface-3` | `#1C2029` | Highest elevation |
| code | `--mf-code` | `#08090C` | Code blocks |
| paper | `--mf-paper` | `#F4EFE6` | Primary text, headings |
| text2 | `--mf-text-2` | `#CFC9BD` | Body copy on dark |
| muted | `--mf-muted` | `#9A9488` | Secondary text, labels |
| ember | `--mf-ember` | `#E8A87C` | Primary action, eyebrows, prices |
| gold | `--mf-gold` | `#D4A017` | Stats, themes |
| signal | `--mf-signal` | `#5CE1E6` | Links, focus ring, live state |
| ok | `--mf-ok` | `#7EE0A1` | Free badges, success, live sources |
| warn | `--mf-warn` | `#F2C46D` | One-time key warnings |
| danger | `--mf-danger` | `#F08A7E` | Reserved for errors |

Every text colour clears 4.5:1 on every surface (lowest pairing: muted on surface3 at 5.4:1).
Dark text on ember, signal, and gold buttons is 8:1 or better. The signature gradient
`--grad-forge` runs ember → gold → signal and is used for the hero highlight, bars, and hairlines.

### Type

System fonts only (no font downloads): `--font-sans` prefers a locally installed Inter, then the
platform UI font. `--font-mono` is used for code, eyebrows, chips, and labels.

| Token | Size |
| --- | --- |
| `--text-xs` / `sm` / `base` / `md` / `lg` | 0.75 / 0.875 / 1 / 1.125 / 1.25 rem |
| `--text-xl` | `clamp(1.375rem, 1.2rem + 0.6vw, 1.625rem)` |
| `--text-2xl` (h2) | `clamp(1.75rem, 1.35rem + 1.5vw, 2.5rem)` |
| `--text-3xl` (h1) | `clamp(2.125rem, 1.5rem + 2.6vw, 3.5rem)` |
| `--text-display` (landing h1) | `clamp(2.5rem, 1.45rem + 4.4vw, 4.75rem)` |

Headings use weight 650 and tight negative tracking with `text-wrap: balance`; body copy uses
`text-wrap: pretty`.

### Space, radius, layout

- Spacing is a 4px grid: `--space-1` (0.25rem) to `--space-24` (6rem). Sections use `--section-y`.
- Radius: `--radius-sm` 6px (inline code), `md` 10px (chips, inputs), `lg` 16px (cards), `xl`
  24px (report, CTA band), `pill` for buttons and badges.
- Layout: `--container` 72rem, `--prose` 68ch, `--header-h` 4rem (also the scroll padding, so
  focused or linked targets are never hidden under the sticky header).

### Motion

| Token | Value | Use |
| --- | --- | --- |
| `--dur-fast` | 140ms | Hover colour changes |
| `--dur-base` | 220ms | Card lift, menu open |
| `--dur-slow` | 420ms | FAQ expand |
| `--ease-out` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Entrances |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | Ambient loops |

## Components

| Component | Classes | Notes |
| --- | --- | --- |
| Buttons | `.btn` + `.btn-primary` / `.btn-ghost`, sizes `.btn-xs` `.btn-sm` `.btn-lg`, `.btn-block` | Pill shape, at least 32px tall; primary uses the ember gradient with dark text |
| Copy button | `.copy` (`copyButtonHtml(targetId)`) | Copies the `<pre id>` text (or its `data-copy-line`). Space is reserved and the button becomes visible only once a script runs; the result is announced in a polite live region |
| Chips, badges, status | `.chip`, `.badge-free`, `.badge-paid`, `.status-pill` + `.dot[data-ready]` | Mono labels |
| Cards | `.panel`, `.data-card`, `.feature`, `.tool-card`, `.source-card`, `.step-card`, `.plan-card`, `.stat-card`, `.quick-card` | `--mf-surface-1`, 1px hairline, soft depth shadow; hover lifts by 2px |
| Code | `.code-card` > `.code-head` + `pre`; tokens `.tok-k` `.tok-s` `.tok-n` `.tok-c` `.tok-cmd` `.tok-f` `.tok-u` | `app.js` highlights `pre[data-lang="json"|"shell"]` with DOM nodes (no `innerHTML`) |
| Example report | `.report-frame` > `#fixture-root` > `.report` (`.kpis`, `.bars`, `.themes`, `.mention`, `.cite-list`) | Server-rendered from `EXAMPLE_RESPONSE`; bar widths use 5% `data-w` buckets, refined by `app.js` |
| Tables | `.compare-table` (stacks into labelled rows under 40rem), `.cost-table` | Header cells use `scope` |
| Lists | `.check-list`, `.pay-steps`, `.steps` (claim progress, `aria-current="step"`) | |
| Menus | `details.menu` > `summary` + `.menu-panel` | Close on Escape (focus returns to the trigger), outside click, or link click |
| FAQ | `details.faq-item` > `summary` + `.faq-a` | Smooth height animation where `interpolate-size` is supported. The same markup feeds the FAQPage JSON-LD |
| Long-form | `.doc-layout` with `.toc` (sticky on wide screens) + `.prose` | Privacy and Terms |

## Motion rules

- Animate only `transform`, `opacity`, `clip-path`, and `filter`: never layout properties.
- Hero: signal rings breathe, source chips drift, the mark glows, and the install command types
  itself once.
- Header: gains depth as the page scrolls (CSS scroll-driven animation, progressive).
- Scroll reveals: `app.js` adds `.js` to `<html>`, then `.is-in` to `[data-reveal]` elements as
  they enter the viewport (IntersectionObserver, one-shot). Above-the-fold content is never
  hidden, so LCP is unaffected. Without JavaScript, or in print, everything is visible.
- `prefers-reduced-motion: reduce` disables every animation and transition and reveals all
  content immediately.

## SEO

- Unique `<title>` (≤ 70 characters) and meta description (50–160 characters) on every page.
- Indexable pages (`/`, `/about`, `/privacy`, `/terms`) carry a canonical URL, Open Graph, and
  Twitter card tags. `absolutizePublicHtml()` rewrites canonical, `og:url`, OG images, and JSON-LD
  URLs to the serving origin.
- JSON-LD: the landing has one `@graph` with Organization, WebSite, WebPage, SoftwareApplication
  (with the real per-call price from `PRICE_USDC`, in USDC), SoftwareSourceCode, WebAPI, and
  FAQPage built from the visible FAQ. About, Privacy, and Terms add a WebPage/AboutPage and
  BreadcrumbList. Never `aggregateRating` or reviews.
- `/support` and the claim page are `noindex` (meta tag and `X-Robots-Tag`). `/sitemap.xml` lists
  the indexable pages and agent docs; `/robots.txt` points at it.

## Performance budget

| Asset | Budget | Today (gzip) |
| --- | --- | --- |
| `styles.css` (render-blocking) | ≤ 16 KB | ~12 KB |
| `app.js` (deferred) | ≤ 8 KB | ~6 KB |
| Hydrated landing HTML | ≤ 16 KB | ~13 KB |
| Hero mark | WebP via `srcset` | 17 KB (`logo-440w.webp`) |
| Header/footer/page marks | WebP | 1.5 KB / 3.8 KB (`logo-96w`, `logo-192w`) |

All images declare `width` and `height`. The grain texture is a 96px SVG data URI tile.

## Copy guidelines

- Write for buyers first (developers, founders, marketers, agent builders). Prefer "the first 10
  paid calls are free" to "D1 CAS increments per wallet".
- Facts come from the code or README: price, trial, sources, limits, charges. When in doubt,
  link the machine-readable source (`/v1/pricing`, `/health`, `/openapi.json`).
- No internal ids, branch names, environment names, or operator notes on public pages.
  `tests/unit/public-copy.test.ts` enforces this across every page, with a small explicit
  allowlist of GitHub URLs (the public MIT repository).

## Tests that guard the site

| Test | Guards |
| --- | --- |
| `tests/unit/public-copy.test.ts` | No TODO/FIXME, lorem, placeholder, localhost, staging, console/debug, PR or branch refs, backlog ids, operator config, wallet addresses, or internal jargon on any public page |
| `tests/unit/site-pages.test.ts` | One `<h1>`, ordered headings, image alt and dimensions, CSP-safe markup, title/description limits, canonical/OG/Twitter, JSON-LD validity, noindex pages, chrome parity, token sync, tool-catalog parity, and an internal link check through the Worker |
| `tests/unit/discoverability.test.ts` | Static twins match the renderers, brand assets, no Stripe/key-plan marketing on the landing or About, legal copy |
| `tests/unit/html.test.ts` | Escaping, absolutised OG tags, discovery chrome, landing hydration, JSON-LD graph |
