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
    expect(out).not.toMatch(/\sstyle\s*=/i);
    expect(out).toContain('data-pct="90.9"');
    expect(out).toContain('aria-label="neutral 90.9 percent"');
    expect(out).toContain('class="bar-n">91%</span>');
  });

  it("injects exactly one JSON-LD graph: honest SoftwareApplication price, no ratings or reviews", async () => {
    const src = `<head>
<title>MentionForge — Social listening API &amp; MCP server for AI agents</title>
<meta name="description" content="Cited social listening for AI agents and developers. One REST or MCP call returns mentions, sentiment, themes, and sources."/>
<meta property="og:url" content="https://mentionforge.mentionforge.workers.dev/"/>
<link rel="canonical" href="https://mentionforge.mentionforge.workers.dev/"/>
</head>
<body>
<span class="dot" data-ready></span>
<span id="live-label"> Base · $0.02 USDC</span>
<span class="chip" id="network-chip">Base</span>
<ul class="backends" id="backends"><li>Loading from GET /health…</li></ul>
<p class="stat" id="calls">—</p>
<div id="fixture-root"><p class="muted">Loading snapshot…</p></div>
<details class="faq-item"><summary>What does a paid call cost?</summary><div class="faq-a"><p>$0.02 USDC per successful paid call on Base.</p></div></details>
</body>`;
    const out = hydrateLandingHtml(src, mockEnv({ BRAVE_API_KEY: "brave" }), 0);
    const blocks = [...out.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    expect(blocks).toHaveLength(1);
    expect(blocks[0]![1]).not.toContain("<");
    expect(blocks[0]![1]).not.toContain("</script>");
    const parsed = JSON.parse(blocks[0]![1]!) as { "@context": string; "@graph": Array<Record<string, unknown>> };
    expect(parsed["@context"]).toBe("https://schema.org");
    const byType = (t: string) => parsed["@graph"].filter((n) => n["@type"] === t);
    for (const t of ["Organization", "WebSite", "WebPage", "SoftwareApplication", "SoftwareSourceCode", "WebAPI", "FAQPage"]) {
      expect(byType(t), t).toHaveLength(1);
    }
    const app = byType("SoftwareApplication")[0]!;
    expect(app.name).toBe("MentionForge");
    expect(app.url).toBe("https://mentionforge.mentionforge.workers.dev/");
    const offer = app.offers as { price: string; priceCurrency: string };
    expect(offer.price).toBe(mockEnv().PRICE_USDC);
    expect(offer.priceCurrency).toBe("USDC");
    const faq = byType("FAQPage")[0]! as { mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }> };
    expect(faq.mainEntity).toEqual([
      expect.objectContaining({ name: "What does a paid call cost?", acceptedAnswer: expect.objectContaining({ text: "$0.02 USDC per successful paid call on Base." }) }),
    ]);
    const json = JSON.stringify(parsed);
    expect(json).not.toMatch(/aggregateRating|"review"|ratingValue/);
    expect(json).not.toMatch(/0x[a-fA-F0-9]{40}/);
  });
});
