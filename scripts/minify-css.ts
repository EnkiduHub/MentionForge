#!/usr/bin/env node
/// <reference types="node" />
/**
 * Minifies src/styles/site.css into public/styles.css (the file served at /styles.css).
 *
 *   npm run css:minify          # write public/styles.css
 *   npm run css:minify -- --check   # exit 1 if the committed file is stale
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "lightningcss";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(root, "src/styles/site.css");
const destPath = join(root, "public/styles.css");

export function minifySiteCss(source: string): string {
  const { code } = transform({
    filename: "site.css",
    code: Buffer.from(source),
    minify: true,
  });
  return Buffer.from(code).toString("utf8");
}

const invokedDirectly = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const check = process.argv.includes("--check");
  const source = readFileSync(sourcePath, "utf8");
  const minified = minifySiteCss(source);
  let current = "";
  try {
    current = readFileSync(destPath, "utf8");
  } catch {
    /* new file */
  }

  if (current === minified) {
    console.log("public/styles.css is up to date");
    process.exit(0);
  }

  if (check) {
    console.error("stale: public/styles.css (run npm run css:minify)");
    process.exit(1);
  }

  writeFileSync(destPath, minified);
  console.log(`wrote: public/styles.css (${Buffer.byteLength(source)} → ${Buffer.byteLength(minified)} bytes)`);
}
