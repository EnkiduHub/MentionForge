/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../../src/app";
import { GET_PRICING_DESC, HEALTH_DESC, TOOL_DESC, GET_EXAMPLE_DESC, handleMcp } from "../../src/mcp";
import { BRAND_ASSETS } from "../../src/lib/brand-assets";
import { DIRECTORY_LINKS, mcpServerInfo, mcpToolCards, PUBLIC_SITEMAP_PATHS, toolInputJsonSchema } from "../../src/lib/discoverability";
import { supportPageHtml, TRUST_PAGE_SLUGS, trustPageHtml } from "../../src/lib/html";
import { planKeyMonthlyCalls } from "../../src/lib/plan-quota";
import { SKILL_MARKDOWN } from "../../src/lib/skill-text";
import { healthInputSchema } from "../../src/schemas/lenses";
import { researchRequestSchema } from "../../src/schemas/research";
import { executionCtx, mockEnv } from "../helpers/env";

const app = createApp();

async function call(path: string, init: RequestInit = {}, env = mockEnv()): Promise<Response> {
  return app.fetch(new Request(`https://mentionforge.test${path}`, init), env, executionCtx());
}

async function listedMcpToolNames(env = mockEnv()): Promise<string[]> {
  const headers = {
    "content-type": "application/json",
    host: "mentionforge.test",
    accept: "application/json, text/event-stream",
  };
  const init = await handleMcp(
    new Request("https://mentionforge.test/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      }),
    }),
    env,
    executionCtx(),
  );
  expect(init.status).toBe(200);
  const session = init.headers.get("mcp-session-id");
  const listed = await handleMcp(
    new Request("https://mentionforge.test/mcp", {
      method: "POST",
      headers: { ...headers, ...(session ? { "mcp-session-id": session } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    }),
    env,
    executionCtx(),
  );
  expect(listed.status).toBe(200);
  const raw = await listed.text();
  const contentType = listed.headers.get("content-type") ?? "";
  const parsed: unknown = contentType.includes("text/event-stream")
    ? JSON.parse(
        raw
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.replace(/^data:\s?/, "").trim())
          .filter(Boolean)
          .at(-1) ?? "null",
      )
    : JSON.parse(raw);
  const payload = parsed as { result?: { tools?: Array<{ name: string }> } };
  const names = (payload.result?.tools ?? []).map((t) => t.name);
  expect(names.length).toBeGreaterThan(0);
  return names;
}

function mentionsToolName(text: string, name: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(text);
}

describe("agent discoverability", () => {
  it("skill.md twin matches the repo file", () => {
    const onDisk = readFileSync(new URL("../../skill.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    expect(SKILL_MARKDOWN).toBe(onDisk.endsWith("\n") ? onDisk : `${onDisk}\n`);
  });

  it("landing HTML uses the same brand asset paths as BRAND_ASSETS", () => {
    const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
    expect(html).toContain(`content="${BRAND_ASSETS.og}"`);
    expect(html).toContain(`property="og:image:type" content="${BRAND_ASSETS.ogType}"`);
    expect(html).toContain(`property="og:image:width" content="${String(BRAND_ASSETS.ogWidth)}"`);
    expect(html).toContain(`property="og:image:height" content="${String(BRAND_ASSETS.ogHeight)}"`);
    expect(html).toContain(`property="og:image:alt" content="${BRAND_ASSETS.ogAlt}"`);
    expect(html).toContain(`property="og:site_name" content="MentionForge"`);
    expect(html).toContain(`href="${BRAND_ASSETS.faviconIco}"`);
    expect(html).toContain(`href="${BRAND_ASSETS.favicon}"`);
    expect(html).toContain(`src="${BRAND_ASSETS.hero}"`);
    expect(html).toContain('width="220" height="220" alt="MentionForge mark"');
    expect(html).toContain(`href="${BRAND_ASSETS.appleTouch}"`);
    expect(html).toContain('<main id="main">');
    expect([...html.matchAll(/<main\b[^>]*>/gi)]).toHaveLength(1);
    expect([...html.matchAll(/\bid="main"/gi)]).toHaveLength(1);
    expect(html).toContain("<h3>Calls</h3>");
    expect(html).toContain("<h3>Price</h3>");
    expect(html).toContain("<h3>Trial</h3>");
    expect(html).not.toContain("<h2>Calls</h2>");
    expect(html).not.toContain("<h2>Price</h2>");
    expect(html).not.toContain("<h2>Trial</h2>");
    expect(html).toContain("How it works");
    expect(html).toContain("100 calls = $2.00");
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/about"');
    expect(html).not.toMatch(/\bstripe\b|\bkey plan\b|\$29\b/i);
    expect(html).toMatch(/class="prefer"/);
    expect(html).toMatch(/web_search/);
    expect(html).toContain(DIRECTORY_LINKS.github);
    expect(html).toContain(DIRECTORY_LINKS.glama);
    expect(html).toContain(DIRECTORY_LINKS.smithery);
    expect(html).toContain(DIRECTORY_LINKS.official_registry);
    expect(html).toContain(DIRECTORY_LINKS.x402scan);
    expect(html).toContain(" Base · $0.02 USDC");
    expect(html).toContain('id="network-chip">Base');
    expect(html).toContain("Loading from GET /health…");
    expect(html).toContain('id="calls">—');
    expect(html).toContain("Loading snapshot…");
    expect(html).not.toMatch(/0x[a-fA-F0-9]{40}/);
  });

  it("public brand PNGs match BRAND_ASSETS pixel sizes and old marks are gone", () => {
    function ihdr(rel: string) {
      const bytes = Uint8Array.from(readFileSync(new URL(`../../public${rel}`, import.meta.url)));
      expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { w: view.getUint32(16), h: view.getUint32(20) };
    }
    const ogBytes = readFileSync(new URL(`../../public${BRAND_ASSETS.og}`, import.meta.url));
    expect(ogBytes.byteLength).toBeLessThan(150 * 1024);
    expect(ihdr(BRAND_ASSETS.og)).toEqual({ w: BRAND_ASSETS.ogWidth, h: BRAND_ASSETS.ogHeight });
    expect(ihdr(BRAND_ASSETS.ogNamed)).toEqual({ w: 1200, h: 630 });
    expect(ihdr(BRAND_ASSETS.hero)).toEqual({ w: 512, h: 512 });
    const headersFile = readFileSync(new URL("../../public/_headers", import.meta.url), "utf8");
    expect(headersFile).toContain("/logo-440w.webp");
    expect(headersFile).toContain("Cache-Control: public, max-age=31536000, immutable");
    expect(ihdr(BRAND_ASSETS.chrome)).toEqual({ w: 256, h: 256 });
    expect(ihdr(BRAND_ASSETS.favicon)).toEqual({ w: 128, h: 128 });
    expect(ihdr("/logo-1024x1024.png")).toEqual({ w: 1024, h: 1024 });
    expect(existsSync(new URL(`../../public${BRAND_ASSETS.faviconIco}`, import.meta.url))).toBe(true);
    const ico = readFileSync(new URL(`../../public${BRAND_ASSETS.faviconIco}`, import.meta.url));
    expect(ico.byteLength).toBeGreaterThan(16);
    const icoView = new DataView(ico.buffer, ico.byteOffset, ico.byteLength);
    expect(icoView.getUint16(0, true)).toBe(0);
    expect(icoView.getUint16(2, true)).toBe(1);
    expect(existsSync(new URL("../../public/logo.svg", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../../public/favicon.svg", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../../public/og.svg", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../../public/BRIEF.md", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../../BRIEF.md", import.meta.url))).toBe(false);
  });

  it("server-card lists free tools first with live MCP descriptions", async () => {
    const res = await call("/server-card.json");
    expect(res.status).toBe(200);
    const card = await res.json() as {
      tools: Array<{ name: string; description: string; when_to_use: string; inputSchema?: unknown }>;
      prefer_over: string[];
      install: { mcpServers: { mentionforge: { url: string } } };
      docs: { llms: string; llms_full: string; skill: string };
      directories: { github: string };
      pricing: { pay_to: string; tool: string };
      serverInfo?: { name: string; version: string };
    };
    expect(card.tools.map((t) => t.name).slice(0, 5)).toEqual([
      "get_health",
      "get_pricing",
      "get_example",
      "suggest_tool",
      "get_entity_profile",
    ]);
    expect(card.tools.map((t) => t.name)).toContain("research_mentions");
    expect(card.tools[0]?.description).toBe(HEALTH_DESC);
    expect(card.tools[1]?.description).toBe(GET_PRICING_DESC);
    expect(card.tools[2]?.description).toBe(GET_EXAMPLE_DESC);
    const research = card.tools.find((t) => t.name === "research_mentions");
    expect(research?.description).toBe(TOOL_DESC);
    for (const tool of card.tools) {
      expect(tool.when_to_use.length).toBeGreaterThan(8);
      expect(tool.when_to_use).not.toMatch(/0x[a-fA-F0-9]{40}/);
      expect(tool.description).not.toMatch(/0x[a-fA-F0-9]{40}/);
    }
    expect(card.prefer_over).toEqual(["web_search"]);
    expect(card.install.mcpServers.mentionforge.url).toBe("https://mentionforge.test/mcp");
    expect(card.docs.llms).toMatch(/\/llms\.txt$/);
    expect(card.docs.llms_full).toMatch(/\/llms-full\.txt$/);
    expect(card.docs.skill).toMatch(/\/skill\.md$/);
    expect(card.directories.github).toBe(DIRECTORY_LINKS.github);
    expect(card.pricing.tool).toBe("research_mentions");
    expect(card.pricing.pay_to).toMatch(/^0x/i);
  });

  it("well-known mcp points at the rich server card", async () => {
    const res = await call("/.well-known/mcp");
    const body = await res.json() as {
      endpoint: string;
      server_card: string;
      prefer_over: string[];
      docs: { llms: string; skill: string };
    };
    expect(body.endpoint).toBe("https://mentionforge.test/mcp");
    expect(body.server_card).toBe("https://mentionforge.test/.well-known/mcp/server-card.json");
    expect(body.prefer_over).toEqual(["web_search"]);
    expect(body.docs.llms).toMatch(/\/llms\.txt$/);
    expect(body.docs.skill).toMatch(/\/skill\.md$/);
  });

  it("GET /skill.md is markdown for agents and HTML chrome for document navigations", async () => {
    const agent = await call("/skill.md", { headers: { Accept: "*/*" } });
    expect(agent.status).toBe(200);
    expect(agent.headers.get("content-type") ?? "").toMatch(/text\/markdown/);
    expect(await agent.text()).toBe(SKILL_MARKDOWN);

    const doc = await call("/skill.md", { headers: { "Sec-Fetch-Dest": "document", Accept: "text/html" } });
    expect(doc.headers.get("content-type") ?? "").toMatch(/text\/html/);
    const html = await doc.text();
    expect(html).toMatch(/Agent skill/);
    expect(html).toMatch(/mentionforge/);
    expect(html).toContain(`src="${BRAND_ASSETS.chrome}"`);

    const raw = await call("/skill.md?raw=1", { headers: { "Sec-Fetch-Dest": "document", Accept: "text/html" } });
    expect(raw.headers.get("content-type") ?? "").toMatch(/text\/markdown/);
    expect(await raw.text()).toBe(SKILL_MARKDOWN);
  });

  it("llms-full MCP section mirrors Cursor JSON, Claude CLI, free-first, and skill", async () => {
    const res = await call("/llms-full.txt");
    expect(res.status).toBe(200);
    const txt = await res.text();
    expect(txt).toMatch(/## MCP/);
    expect(txt).toMatch(/"mcpServers"/);
    expect(txt).toMatch(/claude mcp add --transport http mentionforge/);
    expect(txt).toMatch(/Free first: get_health \+ get_pricing \+ get_example/);
    expect(txt).toMatch(/\/skill\.md/);
    expect(txt).toMatch(/Do NOT use for live trading execution/);
  });

  it("robots allows skill.md and server-card.json", async () => {
    const res = await call("/robots.txt");
    expect(res.status).toBe(200);
    const txt = await res.text();
    expect(txt).toMatch(/Allow: \/skill\.md/);
    expect(txt).toMatch(/Allow: \/server-card\.json/);
    expect(txt).toMatch(/Allow: \/v1\/entity/);
    expect(txt).toMatch(/Allow: \/v1\/suggest/);
    expect(txt).toMatch(/^Sitemap: https:\/\/mentionforge\.test\/sitemap\.xml$/m);
  });

  it("sitemap.xml lists landing, llms.txt, and existing public docs routes", async () => {
    const res = await call("/sitemap.xml");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/xml/);
    const xml = await res.text();
    expect(xml).toContain("<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">");
    expect(PUBLIC_SITEMAP_PATHS).toContain("/");
    expect(PUBLIC_SITEMAP_PATHS).toContain("/about");
    expect(PUBLIC_SITEMAP_PATHS).toContain("/privacy");
    expect(PUBLIC_SITEMAP_PATHS).toContain("/terms");
    expect(PUBLIC_SITEMAP_PATHS).toContain("/llms.txt");
    expect(PUBLIC_SITEMAP_PATHS).toContain("/llms-full.txt");
    expect(PUBLIC_SITEMAP_PATHS).toContain("/skill.md");
    expect(PUBLIC_SITEMAP_PATHS).toContain("/openapi.json");
    expect(PUBLIC_SITEMAP_PATHS).not.toContain("/v1/entity");
    expect(PUBLIC_SITEMAP_PATHS).not.toContain("/v1/suggest");
    for (const path of PUBLIC_SITEMAP_PATHS) {
      const loc = path === "/" ? "https://mentionforge.test/" : `https://mentionforge.test${path}`;
      expect(xml).toContain(`<loc>${loc}</loc>`);
    }
    expect(xml).not.toMatch(/<loc>[^<]*\/v1\/entity<\/loc>/);
    expect(xml).not.toMatch(/<loc>[^<]*\/v1\/suggest<\/loc>/);
    for (const path of ["/about", "/privacy", "/terms", "/llms.txt", "/llms-full.txt", "/skill.md", "/openapi.json", "/server-card.json"] as const) {
      const live = await call(path);
      expect(live.status, path).toBe(200);
    }
  });

  it("trust pages (/privacy, /terms, /about) return 200 text/html with <main> and match public/*.html twins", async () => {
    const mailto = 'href="mailto:harbor-ops@mail.grokbot.com"';
    for (const slug of TRUST_PAGE_SLUGS) {
      const onDisk = readFileSync(new URL(`../../public/${slug}.html`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
      expect(trustPageHtml(slug)).toBe(onDisk);
      expect(onDisk).not.toContain("mailto:");

      const res = await call(`/${slug}`);
      expect(res.status, slug).toBe(200);
      expect(res.headers.get("content-type") ?? "", slug).toMatch(/text\/html/);
      expect(res.headers.get("content-security-policy") ?? "", slug).toMatch(/script-src 'self'/);
      const html = await res.text();
      expect(html).toContain('<main id="main">');
      expect([...html.matchAll(/<main\b[^>]*>/gi)]).toHaveLength(1);
      expect([...html.matchAll(/\bid="main"/gi)]).toHaveLength(1);
      expect(html).toContain('<a class="skip" href="#main">Skip to content</a>');
      expect(html).toContain('href="/styles.css"');
      expect(html).toContain('href="/about"');
      expect(html).toContain('href="/privacy"');
      expect(html).toContain('href="/terms"');
      expect(html).toContain(`<link rel="canonical" href="https://mentionforge.test/${slug}"/>`);
      expect(html).not.toMatch(/\$29\b/);
      if (slug === "about") {
        expect(html).not.toMatch(/\bstripe\b|\bkey plan\b|\bapi_keys\b|\bplan_usage\b/i);
        expect(html).not.toContain("mailto:");
      } else {
        expect(html).toContain(mailto);
        expect(html).toMatch(/stripe/i);
      }
    }
    const privacy = await (await call("/privacy")).text();
    expect(privacy).not.toMatch(/does not collect names or email/i);
    expect(privacy).toContain("Stripe");
    expect(privacy).toContain("https://stripe.com/privacy");
    expect(privacy).toContain("In plain words:");
    expect(privacy).toContain("We never see your card number.");
    expect(privacy).toContain("deleting our rows does not delete Stripe");
    expect(privacy).toContain("trial_wallets");
    expect(privacy).toContain("idempotency");
    expect(privacy).toContain("stats_daily");
    expect(privacy).toContain("x_id_usage");
    expect(privacy).toContain("api_keys");
    expect(privacy).toContain("plan_usage");
    expect(privacy).toContain("stripe_events");
    const terms = await (await call("/terms")).text();
    expect(terms).toContain("https://github.com/EnkiduHub/MentionForge/issues");
    expect(terms).toContain("API key subscription");
    expect(terms).toContain("1,500");
    expect(terms).toContain("When your 1,500 calls for the billing period are used up");
    expect(terms).toContain("global rate limits and rolling 30-day ID quota also apply to key plans");
    expect(terms).toContain("The price and billing interval are shown at Stripe Checkout before you pay.");
    expect(terms).toContain("If a renewal payment fails, access continues until the end of the current billing period, then stops until payment succeeds.");
    expect(terms).toContain("POST /v1/keys/portal");
    expect(terms).not.toMatch(/GDPR|SOC\s*2/i);
    const about = await (await call("/about")).text();
    expect(about).toContain("MIT License");
    expect(about).toContain("https://github.com/EnkiduHub/MentionForge");
  });

  it("GET /support matches public/support.html, renders SUPPORT_EMAIL mailto, and openapi/llms.txt list API key plan endpoints without marketing the purchase", async () => {
    const onDisk = readFileSync(new URL("../../public/support.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    expect(supportPageHtml()).toBe(onDisk);
    expect(onDisk).not.toContain("mailto:");

    const res = await call("/support");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/text\/html/);
    expect(res.headers.get("content-security-policy") ?? "").toMatch(/script-src 'self'/);
    const html = await res.text();
    expect(html).toContain('<main id="main">');
    expect([...html.matchAll(/<main\b[^>]*>/gi)]).toHaveLength(1);
    expect(html).toContain("/v1/keys/portal");
    expect(html).toContain("/v1/keys/me");
    expect(html).toContain("https://github.com/EnkiduHub/MentionForge/issues");
    expect(html).toContain("case by case");
    expect(html).toContain('href="mailto:harbor-ops@mail.grokbot.com"');

    const withEmail = await call("/support", {}, mockEnv({ SUPPORT_EMAIL: "support@mentionforge.example" }));
    expect(withEmail.status).toBe(200);
    const emailHtml = await withEmail.text();
    expect(emailHtml).toContain('href="mailto:support@mentionforge.example"');

    const withoutEmail = await call("/support", {}, mockEnv({ SUPPORT_EMAIL: "" }));
    expect(withoutEmail.status).toBe(200);
    const withoutHtml = await withoutEmail.text();
    expect(withoutHtml).not.toContain("mailto:");

    const githubIssueHref = 'href="https://github.com/EnkiduHub/MentionForge/issues"';
    const lostKey = (page: string) => {
      const match = page.match(/<section aria-labelledby="support-lost-key">[\s\S]*?<\/section>/i);
      expect(match).toBeTruthy();
      return match![0];
    };
    expect(lostKey(html)).not.toContain(githubIssueHref);
    expect(lostKey(emailHtml)).not.toContain(githubIssueHref);
    expect(lostKey(withoutHtml)).not.toContain(githubIssueHref);
    expect(lostKey(onDisk)).not.toContain(githubIssueHref);
    expect(lostKey(emailHtml)).toContain("do not post your email address, Stripe session ID or API key in a public GitHub issue");
    expect(lostKey(withoutHtml)).toContain("Private requests: use the contact shown on this page when served by the Worker.");

    expect(PUBLIC_SITEMAP_PATHS).not.toContain("/support");

    const llms = await (await call("/llms.txt")).text();
    expect(llms).toContain("API key plan endpoints");
    expect(llms).toContain("/v1/keys/me");
    expect(llms).toContain("/v1/keys/portal");
    expect(llms).not.toMatch(/\$29|buy\.stripe\.com/i);

    const openapi = (await (await call("/openapi.json")).json()) as { paths: Record<string, unknown> };
    expect(openapi.paths["/v1/keys/me"]).toBeTruthy();
    expect(openapi.paths["/v1/keys/portal"]).toBeTruthy();
  });

  it("terms 1,500 quota matches PLAN_KEY_MONTHLY_CALLS in wrangler and the Worker default", () => {
    const raw = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
    const quotas = [...raw.matchAll(/"PLAN_KEY_MONTHLY_CALLS"\s*:\s*"([^"]+)"/g)].map((m) => m[1]!);
    expect(quotas.length).toBeGreaterThanOrEqual(3);
    expect(quotas.every((v) => v === "1500")).toBe(true);
    const emails = [...raw.matchAll(/"SUPPORT_EMAIL"\s*:\s*"([^"]*)"/g)].map((m) => m[1]!);
    expect(emails.length).toBeGreaterThanOrEqual(3);
    expect(emails.every((v) => v === "harbor-ops@mail.grokbot.com")).toBe(true);
    expect(planKeyMonthlyCalls(mockEnv({ PLAN_KEY_MONTHLY_CALLS: undefined }))).toBe(1500);
    expect(planKeyMonthlyCalls(mockEnv({ PLAN_KEY_MONTHLY_CALLS: "" }))).toBe(1500);
    expect(trustPageHtml("terms")).toContain("1,500 research calls");
    expect(trustPageHtml("terms")).toContain("When your 1,500 calls for the billing period are used up");
  });

  it("operator HTML uses the 96px chrome mark and PNG favicon", async () => {
    const denied = await call("/operator");
    expect(denied.status).toBe(401);
    const res = await call("/operator", { headers: { Authorization: "Bearer test-operator" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain(`src="${BRAND_ASSETS.chrome}"`);
    expect(html).toContain(`href="${BRAND_ASSETS.favicon}"`);
    expect(html).toContain('width="96"');
  });

  it("mcp tool cards stay free-first without wallets in when_to_use", () => {
    const cards = mcpToolCards();
    expect(cards.map((c) => c.name).slice(0, 5)).toEqual([
      "get_health",
      "get_pricing",
      "get_example",
      "suggest_tool",
      "get_entity_profile",
    ]);
    expect(cards.map((c) => c.name)).toContain("research_mentions");
    expect(JSON.stringify(cards)).not.toMatch(/0x[a-fA-F0-9]{40}/);
  });

  it("server-card tools and llms.txt list every registered MCP tool name", async () => {
    const registered = await listedMcpToolNames();
    const cardRes = await call("/server-card.json");
    expect(cardRes.status).toBe(200);
    const card = (await cardRes.json()) as { tools: Array<{ name: string }> };
    expect([...card.tools.map((t) => t.name)].sort()).toEqual([...registered].sort());

    const llmsRes = await call("/llms.txt");
    expect(llmsRes.status).toBe(200);
    const llms = await llmsRes.text();
    const missing = registered.filter((name) => !mentionsToolName(llms, name));
    expect(missing).toEqual([]);
  });

  it("server card serverInfo matches package.json and tool inputSchema matches live Zod", async () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    expect(mcpServerInfo()).toEqual({ name: "MentionForge", version: pkg.version });

    const res = await call("/server-card.json");
    expect(res.status).toBe(200);
    const card = (await res.json()) as {
      serverInfo: { name: string; version: string };
      tools: Array<{ name: string; inputSchema: unknown }>;
    };
    expect(card.serverInfo).toEqual(mcpServerInfo());
    expect(card.serverInfo.version).toBe(pkg.version);

    const live = mcpToolCards();
    expect(card.tools.map((t) => t.name)).toEqual(live.map((t) => t.name));
    for (const tool of card.tools) {
      const def = live.find((t) => t.name === tool.name);
      expect(tool.inputSchema, tool.name).toEqual(def?.inputSchema);
      expect(tool.inputSchema).toMatchObject({ type: "object" });
    }
    expect(card.tools.find((t) => t.name === "get_health")?.inputSchema).toEqual(
      toolInputJsonSchema(healthInputSchema),
    );
    expect(card.tools.find((t) => t.name === "research_mentions")?.inputSchema).toEqual(
      z.toJSONSchema(researchRequestSchema, { target: "draft-2020-12", io: "input" }),
    );
  });

  it("Glama stdio bridge is a mcp-remote proxy to the hosted Worker, not a Worker clone", () => {
    const glama = JSON.parse(readFileSync(new URL("../../glama.json", import.meta.url), "utf8")) as {
      $schema?: string;
      maintainers?: string[];
    };
    expect(glama.$schema).toBe("https://glama.ai/mcp/schemas/server.json");
    expect(glama.maintainers).toContain("EnkiduHub");

    const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");
    const glamaStdio = readFileSync(new URL("../../scripts/glama-stdio.mjs", import.meta.url), "utf8");
    const listing = readFileSync(new URL("../../listings/glama.md", import.meta.url), "utf8");
    const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
    expect(readme).toContain("https://glama.ai/mcp/servers/EnkiduHub/MentionForge/badges/score.svg");
    expect(readme).toContain("https://glama.ai/mcp/servers/EnkiduHub/MentionForge/badges/card.svg");
    expect(readme).toContain("https://glama.ai/mcp/servers/EnkiduHub/MentionForge");
    expect(readme).not.toContain("https://glama.ai/mcp/servers/@EnkiduHub/MentionForge");
    expect(readme).toContain(DIRECTORY_LINKS.official_registry);
    expect(readme).not.toContain("registry.modelcontextprotocol.io/v0/servers");
    expect(readme).toContain("MIT License");
    expect(readme).toContain("Copyright (c) 2026 MentionForge");
    expect(readme).toContain("SPDX-License-Identifier: MIT");
    expect(readme).not.toMatch(/score MIT\/Apache as the friendly license grade/);
    expect(readme).toContain("`get_health` — free liveness");
    expect(readme).toContain("`get_pricing` — free catalog");
    expect(readme).toContain("POST-only `/v1/compare` `/v1/digest` `/v1/risk` `/v1/reply` `/v1/mentions` `/v1/trends`");
    expect(dockerfile).toMatch(/mcp-remote@0\.14\.5/);
    expect(dockerfile).toContain("scripts/glama-stdio.mjs");
    expect(dockerfile).toMatch(/^WORKDIR \/app$/m);
    expect(dockerfile).toMatch(/^CMD \["node", "scripts\/glama-stdio\.mjs"\]$/m);
    expect(dockerfile).not.toMatch(/\/home\/node\/glama-stdio/);
    expect(dockerfile).not.toMatch(/^ENTRYPOINT /m);
    expect(dockerfile).not.toMatch(/wrangler|CDP_API_KEY|TEST_PAYER_PRIVATE_KEY/);
    expect(glamaStdio).toContain("https://mentionforge.mentionforge.workers.dev/mcp");
    expect(glamaStdio).toContain("--transport");
    expect(glamaStdio).toContain("http-only");
    expect(glamaStdio).not.toMatch(/process\.env\.RECIPIENT_WALLET/);
    expect(glamaStdio).not.toMatch(/wrangler|CDP_API_KEY|TEST_PAYER_PRIVATE_KEY/);
    expect(listing).toContain('["npm install -g mcp-remote@0.14.5"]');
    expect(listing).toContain('["node", "scripts/glama-stdio.mjs"]');
    expect(listing).toContain('{"type":"object","properties":{},"required":[]}');
    expect(listing).toMatch(/Do \*\*not\*\* add `RECIPIENT_WALLET`/);
    expect(listing).toContain("Sync Server does not update Available Tools");
    expect(readme).toContain("Sync Server does not update Available Tools");

    const official = JSON.parse(readFileSync(new URL("../../server.json", import.meta.url), "utf8")) as {
      version?: string;
      remotes?: Array<{ type?: string; url?: string }>;
    };
    const pkgVersion = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      version?: string;
    };
    const constants = readFileSync(new URL("../../src/lib/constants.ts", import.meta.url), "utf8");
    const serviceVersion = /export const SERVICE_VERSION = "([^"]+)"/.exec(constants)?.[1];
    expect(official.version).toBe(pkgVersion.version);
    expect(official.version).toBe(serviceVersion);
    const docsIndex = readFileSync(new URL("../../docs/README.md", import.meta.url), "utf8");
    const listingsIndex = readFileSync(new URL("../../listings/README.md", import.meta.url), "utf8");
    expect(docsIndex).toContain(`Version is \`${pkgVersion.version}\``);
    expect(listingsIndex).toContain(`version \`${pkgVersion.version}\``);
    expect(official.remotes?.[0]).toEqual({
      type: "streamable-http",
      url: "https://mentionforge.mentionforge.workers.dev/mcp",
    });

    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      bin?: Record<string, string>;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    expect(pkg.bin?.mentionforge).toBe("./scripts/glama-stdio.mjs");
    expect(pkg.scripts?.start).toBe("node scripts/glama-stdio.mjs");
    expect(pkg.scripts?.dev).toBe("wrangler dev");
    expect(pkg.dependencies?.["mcp-remote"]).toBe("0.14.5");
  });
});
