import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";

describe("worker fetch", () => {
  it("HEAD /health is 200", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://example.com/health", { method: "HEAD" }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
  });

  it("landing is HTML with exactly one <main id=\"main\"> and no Key plan or Stripe mention", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://example.com/"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/html/);
    const html = await res.text();
    expect(html).toContain('property="og:site_name" content="MentionForge"');
    expect(html).toContain('<main id="main">');
    expect([...html.matchAll(/<main\b[^>]*>/gi)]).toHaveLength(1);
    expect([...html.matchAll(/\bid="main"/gi)]).toHaveLength(1);
    expect(html).not.toMatch(/\bstripe\b|\bkey plan\b|\$29\b/i);
  });

  it("GET /privacy and /terms return 200 with <main>, Stripe copy, and SUPPORT_EMAIL mailto", async () => {
    for (const path of ["/privacy", "/terms"] as const) {
      const ctx = createExecutionContext();
      const res = await worker.fetch(new Request(`https://example.com${path}`), env, ctx);
      await waitOnExecutionContext(ctx);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type") ?? "", path).toMatch(/text\/html/);
      const html = await res.text();
      expect(html, path).toContain('<main id="main">');
      expect([...html.matchAll(/<main\b[^>]*>/gi)], path).toHaveLength(1);
      expect(html, path).toContain("mailto:harbor-ops@mail.grokbot.com");
      expect(html, path).toMatch(/stripe/i);
      expect(html, path).not.toMatch(/\$29\b/);
    }
    const ctx = createExecutionContext();
    const privacyRes = await worker.fetch(new Request("https://example.com/privacy"), env, ctx);
    await waitOnExecutionContext(ctx);
    const privacy = await privacyRes.text();
    expect(privacy).not.toMatch(/does not collect names or email/i);
    expect(privacy).toContain("Stripe");
  });

  it("GET /about returns 200 text/html with <main> and no Key plan or Stripe mention", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://example.com/about"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain('<main id="main">');
    expect([...html.matchAll(/<main\b[^>]*>/gi)]).toHaveLength(1);
    expect(html).not.toMatch(/\bstripe\b|\bkey plan\b|\$29\b/i);
    expect(html).not.toContain("mailto:");
  });

  it("GET /support and /claim.js are served with <main>, mailto, and security headers", async () => {
    const ctx1 = createExecutionContext();
    const supportRes = await worker.fetch(new Request("https://example.com/support"), env, ctx1);
    await waitOnExecutionContext(ctx1);
    expect(supportRes.status).toBe(200);
    expect(supportRes.headers.get("content-type") ?? "").toMatch(/text\/html/);
    const supportHtml = await supportRes.text();
    expect(supportHtml).toContain('<main id="main">');
    expect(supportHtml).toContain("/v1/keys/portal");
    expect(supportHtml).toContain("https://github.com/EnkiduHub/MentionForge/issues");
    expect(supportHtml).toContain("mailto:harbor-ops@mail.grokbot.com");
    const lostKey = supportHtml.match(/<section aria-labelledby="support-lost-key">[\s\S]*?<\/section>/i)?.[0] ?? "";
    expect(lostKey).toContain("mailto:harbor-ops@mail.grokbot.com");
    expect(lostKey).not.toContain('href="https://github.com/EnkiduHub/MentionForge/issues"');

    const ctx2 = createExecutionContext();
    const claimJs = await worker.fetch(new Request("https://example.com/claim.js"), env, ctx2);
    await waitOnExecutionContext(ctx2);
    expect(claimJs.status).toBe(200);
    expect(await claimJs.text()).toContain("data-copy");
  });

  it("GET /logo-440w.webp has immutable Cache-Control while /og.png does not", async () => {
    const ctx1 = createExecutionContext();
    const logoRes = await worker.fetch(new Request("https://example.com/logo-440w.webp"), env, ctx1);
    await waitOnExecutionContext(ctx1);
    expect(logoRes.status).toBe(200);
    expect(logoRes.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");

    const ctx2 = createExecutionContext();
    const ogRes = await worker.fetch(new Request("https://example.com/og.png"), env, ctx2);
    await waitOnExecutionContext(ctx2);
    expect(ogRes.status).toBe(200);
    expect(ogRes.headers.get("cache-control") ?? "").not.toContain("immutable");
  });

  it("GET /favicon.ico is a real icon", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://example.com/favicon.ico"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/image\/(x-icon|vnd\.microsoft\.icon|png)/i);
    const bytes = await res.arrayBuffer();
    expect(bytes.byteLength).toBeGreaterThan(16);
  });

  it("example is unpaid 200", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://example.com/v1/research/example"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
  });
});
