/// <reference types="node" />
/** Renders every public HTML page for the site-wide page tests. */
import { readdirSync, readFileSync } from "node:fs";
import { expect } from "vitest";
import { createApp } from "../../src/app";
import { claimPageHtml, supportPageHtml, TRUST_PAGE_SLUGS, trustPageHtml } from "../../src/lib/html";
import { hydrateLandingHtml } from "../../src/lib/landing";
import { RESOURCE_LINKS } from "../../src/lib/site-chrome";
import { executionCtx, mockEnv } from "./env";

export const PUBLIC_DIR = new URL("../../public/", import.meta.url);

/** Production-shaped env: Base mainnet, CDP facilitator configured, X and Reddit disabled. */
export const prodEnv = () =>
  mockEnv({
    NETWORK: "base",
    FACILITATOR_URL: "https://api.cdp.coinbase.com/platform/v2/x402",
    CDP_API_KEY_ID: "id",
    CDP_API_KEY_SECRET: "secret",
    DISABLED_SOURCES: "x,reddit",
    BRAVE_API_KEY: "brave",
  });

const app = createApp();

/** Browser (document) view of a route, as a visitor clicking a link would get it. */
export async function documentView(path: string): Promise<string> {
  const res = await app.fetch(
    new Request(`https://mentionforge.mentionforge.workers.dev${path}`, {
      headers: { Accept: "text/html", "Sec-Fetch-Dest": "document" },
    }),
    prodEnv(),
    executionCtx(),
  );
  expect(res.headers.get("content-type") ?? "", path).toMatch(/text\/html/);
  return res.text();
}

/** Every public HTML page a visitor can reach, keyed by a readable label. */
export async function allPublicPages(): Promise<Array<[string, string]>> {
  const pages: Array<[string, string]> = [];
  for (const name of readdirSync(PUBLIC_DIR).filter((n) => n.endsWith(".html"))) {
    pages.push([`public/${name}`, readFileSync(new URL(name, PUBLIC_DIR), "utf8")]);
  }
  const index = readFileSync(new URL("index.html", PUBLIC_DIR), "utf8");
  pages.push(["/ (hydrated, production)", hydrateLandingHtml(index, prodEnv(), 1234)]);
  pages.push(["/ (hydrated, degraded)", hydrateLandingHtml(index, mockEnv({ RECIPIENT_WALLET: "0x0000000000000000000000000000000000000000" }), 0)]);
  for (const slug of TRUST_PAGE_SLUGS) pages.push([`/${slug} (SUPPORT_EMAIL set)`, trustPageHtml(slug, { SUPPORT_EMAIL: "harbor-ops@mail.grokbot.com" })]);
  pages.push(["/support (SUPPORT_EMAIL set)", supportPageHtml({ SUPPORT_EMAIL: "harbor-ops@mail.grokbot.com" })]);
  pages.push(["claim: ready", claimPageHtml({ mode: "ready", sessionId: "cs_live_a1b2c3" })]);
  pages.push(["claim: revealed", claimPageHtml({ mode: "revealed", key: "mfk_0123456789abcdef0123456789abcdef0123456789abcdef" })]);
  pages.push(["claim: error", claimPageHtml({ mode: "error", code: "KEY_ALREADY_CLAIMED", message: "Already claimed.", hint: "Visit /support." })]);
  const views = new Set([...RESOURCE_LINKS.map((r) => r.href), "/.well-known/mcp", "/.well-known/mcp/server-card.json"]);
  for (const path of views) pages.push([`view ${path}`, await documentView(path)]);
  pages.push(["404 page", await documentView("/this-page-does-not-exist")]);
  return pages;
}

