/// <reference types="node" />
/**
 * Guards every public HTML page (static files, server-rendered pages, and the browser views of
 * machine-readable surfaces) against leftovers visitors should never see: developer notes,
 * placeholder text, local/staging hosts, debug output, PR and branch references, internal backlog
 * ids, operator-only config, wallet addresses, and internal jargon.
 *
 * Machine-readable payloads (`<pre id="payload">` on discovery views and JSON-LD blocks) are
 * product surfaces for agents and are excluded from the copy scan; JSON-LD is validated in
 * tests/unit/site-pages.test.ts instead.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { stubCaches, stubSourcesFetch } from "../helpers/env";
import { allPublicPages, PUBLIC_DIR } from "../helpers/pages";

/** Patterns checked against the raw HTML of every page (markup, attributes, and text). */
const RAW_FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ["developer marker (TODO/FIXME/XXX/HACK/TBD/WIP)", /\b(?:TODO|FIXME|XXX|HACK|TBD|WIP)\b/],
  ["lorem ipsum", /\blorem\b|\bipsum\b/i],
  ["placeholder", /\bplaceholder\b/i],
  ["localhost or loopback host", /\blocalhost\b|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/i],
  ["staging", /\bstaging\b/i],
  ["console or debugger call", /console\.(?:log|debug|info|warn|error|trace)\s*\(|\bdebugger\b/],
  ["debug wording", /\bdebug(?:ging)?\b/i],
  ["pull request reference", /\bPR\s*#?\d+\b|\(#\d+\)|\/pull\/\d+/i],
  ["git branch name", /\b(?:claude|feature|feat|fix|bugfix|hotfix|chore|release|dependabot)\/[A-Za-z0-9][\w.-]*/i],
  ["internal backlog id", /\bMF-[A-Z]*\d+\b/],
  ["operator-only config name", /\b(?:OPERATOR_TOKEN|SANDBOX_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|CDP_API_KEY_ID|CDP_API_KEY_SECRET|CLOUDFLARE_API_TOKEN|TEST_PAYER_PRIVATE_KEY|RECIPIENT_WALLET|DISABLED_SOURCES)\b/],
  ["local dev tooling", /\.dev\.vars|\bnpm run\b|\bwrangler (?:dev|deploy)\b/i],
  ["HTML comment (developer note)", /<!--/],
  ["unrendered template value", /\$\{|\{\{|\bundefined\b|\bNaN\b|\[object Object\]/],
  ["wallet address", /0x[a-fA-F0-9]{40}/],
];

/** Patterns checked against visible text only: internal process notes and engineering jargon. */
const TEXT_FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ["internal process note", /\b(?:internal only|do not ship|not for production|ops note|backlog|sprint|runbook)\b/i],
  ["internal jargon: fixture", /\bfixture\b/i],
  ["internal jargon: sandbox call", /\bsandbox\b/i],
  ["internal jargon: gather", /\bgathers?\b/i],
  ["internal jargon: lenses", /\blens(?:es)?\b/i],
  ["internal jargon: the Worker", /\bthe Worker\b/],
  ["internal jargon: this deployment", /\bthis deployment\b/i],
  ["internal jargon: marketing landing", /\bmarketing landing\b/i],
];

/**
 * Explicit allowlist: the only GitHub URLs a public page may link to. Any other github.com link
 * (a pull request, commit, branch, fork, or personal profile) is flagged as a leftover.
 * Product vocabulary such as "agent", "MCP", "x402", and "USDC" is never flagged by the rules
 * above, so it needs no entry here. Keep this list small.
 */
const ALLOWLIST: ReadonlyArray<{ url: string; why: string }> = [
  { url: "https://github.com/EnkiduHub/MentionForge", why: "Public MIT-licensed source repository." },
  { url: "https://github.com/EnkiduHub/MentionForge/issues", why: "Public bug reports and questions." },
  { url: "https://github.com/EnkiduHub/MentionForge/blob/main/SECURITY.md", why: "Published security policy." },
  { url: "https://github.com/EnkiduHub/MentionForge/blob/main/TRADEMARK.md", why: "Published trademark policy." },
];
const GITHUB_LINK = /https?:\/\/github\.com\/[^\s"'<>)]*/g;

function withoutMachinePayloads(html: string): string {
  return html
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, "")
    .replace(/<pre id="payload"[^>]*>[\s\S]*?<\/pre>/g, "");
}

function visibleText(html: string): string {
  return withoutMachinePayloads(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .replace(/\s+/g, " ");
}

function leftovers(html: string): string[] {
  const problems: string[] = [];
  const raw = withoutMachinePayloads(html);
  for (const [label, re] of RAW_FORBIDDEN) {
    const m = raw.match(re);
    if (m) problems.push(`${label}: …${raw.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + 60)}…`);
  }
  const text = visibleText(html);
  for (const [label, re] of TEXT_FORBIDDEN) {
    const m = text.match(re);
    if (m) problems.push(`${label}: …${text.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + 60)}…`);
  }
  const allowed = new Set(ALLOWLIST.map((a) => a.url));
  for (const link of raw.match(GITHUB_LINK) ?? []) {
    if (!allowed.has(link)) problems.push(`GitHub link not on the allowlist: ${link}`);
  }
  return problems;
}

describe("public pages contain no leftovers", () => {
  beforeEach(() => {
    stubCaches();
    stubSourcesFetch();
  });

  it("scans every public HTML page and finds no developer notes, placeholders, debug output, or internal ids", async () => {
    const pages = await allPublicPages();
    expect(pages.length).toBeGreaterThanOrEqual(25);
    const failures = pages.flatMap(([label, html]) => leftovers(html).map((p) => `${label}: ${p}`));
    expect(failures).toEqual([]);
  });

  it("shipped scripts and styles contain no console output, debugger statements, or developer markers", () => {
    for (const name of ["app.js", "claim.js", "styles.css"]) {
      const src = readFileSync(new URL(name, PUBLIC_DIR), "utf8");
      expect(src, name).not.toMatch(/console\.(?:log|debug|info|warn|error|trace)\s*\(|\bdebugger\b/);
      expect(src, name).not.toMatch(/\b(?:TODO|FIXME|XXX|HACK)\b/);
      expect(src, name).not.toMatch(/\blocalhost\b|127\.0\.0\.1|\bstaging\b(?!\.)|\bMF-[A-Z]*\d+\b/i);
    }
  });

  it("the allowlist stays small and every entry is still needed", async () => {
    expect(ALLOWLIST.length).toBeLessThanOrEqual(5);
    const corpus = (await allPublicPages()).map(([, html]) => html).join("\n");
    for (const { url } of ALLOWLIST) expect(corpus, url).toContain(`href="${url}"`);
  });

  it("the guard itself catches representative leftovers", () => {
    const samples = [
      "<p>TODO: tighten copy</p>",
      "<p>Lorem ipsum dolor</p>",
      '<a href="http://localhost:8787/">dev</a>',
      '<a href="https://mentionforge-staging.mentionforge.workers.dev">x</a>',
      "<p>Shipped in PR #89</p>",
      "<p>branch claude/mf-revamp-2026-11</p>",
      "<p>Fixes MF-B06</p>",
      "<!-- remove before launch -->",
      "<p>Set OPERATOR_TOKEN first</p>",
      "<p>Captured with a sandbox call</p>",
      "<p>pay 0x1111111111111111111111111111111111111111</p>",
      '<a href="https://github.com/EnkiduHub/MentionForge/pull/90">pr</a>',
      '<a href="https://github.com/someone-else/fork">fork</a>',
    ];
    for (const html of samples) expect(leftovers(html), html).not.toEqual([]);
    expect(leftovers('<p>MIT source on <a href="https://github.com/EnkiduHub/MentionForge">GitHub</a> for AI agents over MCP.</p>')).toEqual([]);
  });
});
