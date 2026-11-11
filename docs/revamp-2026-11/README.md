# Website revamp — November 2026

Record of the website revamp: what changed, how it was measured, and what was deliberately left
alone. The design system itself is documented in [../DESIGN-SYSTEM.md](../DESIGN-SYSTEM.md).

## Scope

Front end only: the landing page, About, Privacy, Terms, Support, the API key claim page, the
browser views of machine-readable surfaces (`/health`, `/llms.txt`, `/openapi.json`, …), and the
404 page. No change to pricing, payments, API or MCP behaviour, tool schemas or descriptions,
`wrangler.jsonc`, `server.json`, migrations, or scripts other than the new
`scripts/render-static-pages.mjs`.

## Lighthouse

Scores are performance / accessibility / best practices / SEO. Every run uses Lighthouse 13 with
headless Chrome 156 and default throttling (mobile = Moto G Power emulation, desktop =
`--preset=desktop`). "Live production" is `https://mentionforge.mentionforge.workers.dev` before
this change (build `6d62435`, which predates `main`). "Local `main`" and "This branch" run the
same Worker and assets under `wrangler dev` with the default testnet vars and no secrets, so they
compare like for like.

#### Mobile

| Page | Live production (before) | Local `main` (before) | This branch (after) |
| --- | --- | --- | --- |
| / | 100 / 100 / 100 / 100 · LCP 1.1 s · CLS 0 | 100 / 100 / 100 / 100 · LCP 0.8 s · CLS 0 | 100 / 100 / 100 / 100 · LCP 1.3 s · CLS 0 |
| /about | 100 / 100 / 100 / 100 · LCP 1.2 s · CLS 0 | 100 / 100 / 100 / 100 · LCP 1.0 s · CLS 0 | 100 / 100 / 100 / 100 · LCP 0.8 s · CLS 0 |
| /support | 100 / 100 / 100 / 69 · LCP 1.2 s · CLS 0 | 100 / 100 / 100 / 69 · LCP 0.9 s · CLS 0 | 100 / 100 / 100 / 69 · LCP 1.1 s · CLS 0 |
| /privacy | 100 / 100 / 100 / 100 · LCP 1.2 s · CLS 0 | 100 / 100 / 100 / 100 · LCP 1.0 s · CLS 0 | 100 / 100 / 100 / 100 · LCP 1.1 s · CLS 0 |
| /terms | 100 / 100 / 100 / 100 · LCP 1.3 s · CLS 0 | 100 / 100 / 100 / 100 · LCP 0.9 s · CLS 0 | 100 / 100 / 100 / 100 · LCP 0.8 s · CLS 0 |
| Claim page (error state) | n/a | 100 / 100 / 96 / 50 · LCP 0.9 s · CLS 0 | 100 / 100 / 96 / 58 · LCP 1.1 s · CLS 0 |
| 404 page | n/a | 100 / 100 / 96 / 92 · LCP 1.7 s · CLS 0 | 100 / 100 / 96 / 92 · LCP 0.8 s · CLS 0 |
| /health (browser view) | n/a | 100 / 100 / 100 / 100 · LCP 1.7 s · CLS 0 | 100 / 100 / 100 / 100 · LCP 1.1 s · CLS 0 |

#### Desktop

| Page | Live production (before) | Local `main` (before) | This branch (after) |
| --- | --- | --- | --- |
| / | 100 / 100 / 100 / 100 · LCP 0.3 s · CLS 0 | 93 / 100 / 100 / 100 · LCP 0.4 s · CLS 0.17 | 100 / 100 / 100 / 100 · LCP 0.4 s · CLS 0 |
| /about | 100 / 100 / 100 / 100 · LCP 0.4 s · CLS 0 | 100 / 100 / 100 / 100 · LCP 0.2 s · CLS 0 | 100 / 100 / 100 / 100 · LCP 0.3 s · CLS 0 |
| /support | 100 / 100 / 100 / 69 · LCP 0.3 s · CLS 0 | 100 / 100 / 100 / 69 · LCP 0.2 s · CLS 0 | 100 / 100 / 100 / 69 · LCP 0.2 s · CLS 0 |
| /privacy | 100 / 100 / 100 / 100 · LCP 0.4 s · CLS 0 | 100 / 100 / 100 / 100 · LCP 0.2 s · CLS 0 | 100 / 100 / 100 / 100 · LCP 0.3 s · CLS 0 |
| /terms | 100 / 100 / 100 / 100 · LCP 0.3 s · CLS 0 | 100 / 100 / 100 / 100 · LCP 0.2 s · CLS 0 | 100 / 100 / 100 / 100 · LCP 0.3 s · CLS 0 |
| Claim page (error state) | n/a | 100 / 100 / 96 / 50 · LCP 0.3 s · CLS 0 | 100 / 100 / 96 / 58 · LCP 0.3 s · CLS 0 |
| 404 page | n/a | 100 / 100 / 96 / 92 · LCP 0.4 s · CLS 0 | 100 / 100 / 96 / 92 · LCP 0.3 s · CLS 0 |
| /health (browser view) | n/a | 100 / 100 / 100 / 100 · LCP 0.4 s · CLS 0 | 100 / 100 / 100 / 100 · LCP 0.3 s · CLS 0 |

Notes:

- Mobile LCP on `/` varies between runs on the shared test machine (0.8–1.3 s); the median of the
  later runs is 0.9 s, with 100/100/100/100 and CLS 0 every time.
- `/support` and the claim page are `noindex` by design (meta tag and `X-Robots-Tag`), so
  Lighthouse's "page is blocked from indexing" audit always costs them SEO points. The claim page
  gained a meta description (50 → 58). Locally it renders the Stripe-unavailable error state (HTTP
  503) because no Stripe secret exists here.
- The claim and 404 pages lose 4 best-practice points to the browser's console error for a
  non-200 document, which is expected for those statuses. The 404 page keeps 92 SEO for the same
  reason.
- Desktop CLS on `/` drops from 0.17 to 0: client refreshes now reuse the server-rendered markup
  instead of re-rendering the example and rewriting hero text.

## Screenshots

Full-page captures at 1440 px (desktop, stored at 2/3 scale) and 390 px (mobile), served under the
production hostname from a local Worker with production-shaped vars. They are compressed WebP files
in [screenshots/](screenshots/); the long mobile landing is split into two parts.

| Page | Desktop | Mobile |
| --- | --- | --- |
| Landing | [after-home-desktop-1440.webp](screenshots/after-home-desktop-1440.webp) | [part 1](screenshots/after-home-mobile-390-part1.webp), [part 2](screenshots/after-home-mobile-390-part2.webp) |
| About | [after-about-desktop-1440.webp](screenshots/after-about-desktop-1440.webp) | [after-about-mobile-390.webp](screenshots/after-about-mobile-390.webp) |
| Support | [after-support-desktop-1440.webp](screenshots/after-support-desktop-1440.webp) | [after-support-mobile-390.webp](screenshots/after-support-mobile-390.webp) |
| Privacy (legal) | [after-privacy-desktop-1440.webp](screenshots/after-privacy-desktop-1440.webp) | [after-privacy-mobile-390.webp](screenshots/after-privacy-mobile-390.webp) |
| Landing before (for comparison) | [before-home-desktop-1440.webp](screenshots/before-home-desktop-1440.webp) | |

## Verification

- **Behaviour parity with `main`:** 55 URLs × 3 `Accept` modes (browser, JSON, `*/*`) returned
  the same status and content type on both builds. 123 machine responses compared byte for byte
  after normalising request IDs, UUIDs, and timestamps, with no differences: discovery JSON and
  text, `/sitemap.xml`, `/robots.txt`, unpaid `POST` 402 responses including the
  `PAYMENT-REQUIRED` header, and MCP `initialize`, `tools/list`, `resources/list`, `prompts/list`,
  and free and paid `tools/call`. Only the HTML views changed.
- **Links:** a crawl from every page reached 47 internal URLs and 450 in-page anchors with none
  broken, and all 15 external links returned 200. `tests/unit/site-pages.test.ts` repeats the
  internal check in CI through the Worker entry point.
- **No-JS:** every section renders server-side (example report, 12 tools, 5 source rows); menus
  and FAQ open natively; copy buttons stay hidden because they need JavaScript.
- **Mobile overflow:** no element exceeds a 390 px viewport on any page.
- **Leftover text:** `tests/unit/public-copy.test.ts` scans 29 rendered page variants and the shipped
  scripts and styles.

## Deliberately unchanged

- Prices, trial size, payment network, facilitator, `payTo`, Stripe price and quota, and all
  settle/verify logic.
- MCP tool names, descriptions, and schemas; `VALUE_PROP` and every discovery payload.
- The landing and About pages still do not market the API key plan (no public checkout link
  exists; existing tests enforce this).
- `/support` stays `noindex` and out of the sitemap; the claim page stays `noindex` and `no-store`.
- `robots.txt` and `sitemap.xml` were already correct and are unchanged.
- The operator dashboard (`/operator`) keeps its markup; the new stylesheet still supports it.
- The hero still uses the existing logo files (`logo-512x512.png` with the `logo-440w.webp`
  `srcset`); no new image assets were added.

## Found during the revamp (not changed here)

`POST /v1/keys/claim` responses with status 404 (for example a malformed `session_id`) fall
through in `src/index.ts` to `env.ASSETS.fetch(request)` with a body that has already been read,
which throws, so the client receives a 500 instead of the intended 404. `main` behaves the same way.
A minimal fix would skip the asset fallback for non-GET/HEAD requests; it changes API behaviour,
so it is left for a separate change.
