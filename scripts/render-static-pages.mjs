#!/usr/bin/env node
/**
 * Regenerates the static HTML twins in public/ from the server renderers in src/lib/html.ts,
 * and syncs the shared site header/footer into the hand-written public/index.html.
 *
 *   npm run pages:render          # write files
 *   npm run pages:render -- --check   # exit 1 if any file is stale (no writes)
 *
 * Unit tests enforce the same parity, so CI fails if this was not run after a change.
 * Runs under tsx so it can import the TypeScript sources directly.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { supportPageHtml, trustPageHtml, TRUST_PAGE_SLUGS } from "../src/lib/html.ts";
import { siteFooterHtml, siteHeaderHtml } from "../src/lib/site-chrome.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
let stale = 0;

function emit(rel, html) {
  const file = join(root, rel);
  let current = "";
  try {
    current = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  } catch {
    /* new file */
  }
  if (current === html) return;
  stale += 1;
  if (check) {
    console.error(`stale: ${rel}`);
    return;
  }
  writeFileSync(file, html);
  console.log(`wrote: ${rel}`);
}

for (const slug of TRUST_PAGE_SLUGS) emit(`public/${slug}.html`, trustPageHtml(slug));
emit("public/support.html", supportPageHtml());

const indexPath = join(root, "public/index.html");
const index = readFileSync(indexPath, "utf8").replace(/\r\n/g, "\n");
const header = /  <header class="site-header">[\s\S]*?\n  <\/header>/;
const footer = /  <footer class="site-footer">[\s\S]*?\n  <\/footer>/;
if (!header.test(index) || !footer.test(index)) {
  console.error("public/index.html is missing the site header or footer block");
  process.exit(1);
}
emit(
  "public/index.html",
  index.replace(header, () => siteHeaderHtml("/")).replace(footer, () => siteFooterHtml("/")),
);

if (check && stale) process.exit(1);
if (!stale) console.log("static pages are up to date");
