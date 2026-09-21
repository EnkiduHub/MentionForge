import { describe, expect, it } from "vitest";
import { escapeHtml, cleanSnippet, absolutizePublicHtml, discoveryDocumentHtml } from "../../src/lib/html";
import { hydrateLandingHtml } from "../../src/lib/landing";
import { mockEnv } from "../helpers/env";

describe("html helpers", () => {
  it("escapes markup in operator strings", () => {
    expect(escapeHtml(`<img src=x onerror="alert(1)">`)).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
  });

  it("strips snippet markup so themes are not HTML artifacts", () => {
    expect(cleanSnippet("Cloudflare&#x27;s <strong>network</strong>")).toBe("Cloudflare's network");
  });

  it("rewrites relative Open Graph tags to this origin", () => {
    const html = `<meta property="og:image" content="/og.png"/>
<meta name="twitter:image" content="/og.png"/>
<meta property="og:url" content="https://mentionforge.mentionforge.workers.dev/"/>
<link rel="canonical" href="https://mentionforge.mentionforge.workers.dev/"/>`;
    const out = absolutizePublicHtml(html, "https://mentionforge-staging.mentionforge.workers.dev");
    expect(out).toContain('content="https://mentionforge-staging.mentionforge.workers.dev/og.png"');
    expect(out).toContain('<meta property="og:url" content="https://mentionforge-staging.mentionforge.workers.dev/"/>');
    expect(out).toContain('<link rel="canonical" href="https://mentionforge-staging.mentionforge.workers.dev/"/>');
    expect(out).not.toContain('content="/og.png"');
  });

  it("renders discovery chrome with escaped payload and current nav", () => {
    const html = discoveryDocumentHtml({
      title: "Health",
      hint: 'Live worker status.',
      path: "/health",
      body: `{"status":"<script>"}`,
    });
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/health"');
    expect(html).toContain('href="/skill.md"');
    expect(html).toContain('href="/logo-128x128.png"');
    expect(html).toContain('src="/logo-256x256.png"');
    expect(html).toContain('id="facts"');
    expect(html).toContain('href="/health?raw=1"');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain(`{"status":"<script>"}`);
  });

  it("hydrates landing chrome with live backends and the Cloudflare Workers snapshot", () => {
    const src = `<span class="dot" data-ready></span>
<span id="live-label"> Base · $0.02 USDC</span>
<span class="chip" id="network-chip">Base</span>
<ul class="backends" id="backends"><li>Loading from GET /health…</li></ul>
<p class="stat" id="calls">—</p>
<div id="fixture-root"><p class="muted">Loading snapshot…</p></div>`;
    const out = hydrateLandingHtml(src, mockEnv({ BRAVE_API_KEY: "brave" }), 15);
    expect(out).toContain('data-ready="true"');
    expect(out).toContain("web: brave+wiki");
    expect(out).toContain("reddit: public");
    expect(out).toContain('<p class="stat" id="calls">15</p>');
    expect(out).toContain("Cloudflare Workers");
    expect(out).not.toContain("Loading snapshot");
    expect(out).not.toContain("ForgeCo");
    expect(out).not.toMatch(/0x[a-fA-F0-9]{40}/);
  });
});
