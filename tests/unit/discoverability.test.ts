import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { GET_PRICING_DESC, HEALTH_DESC, TOOL_DESC } from "../../src/mcp";
import { BRAND_ASSETS } from "../../src/lib/brand-assets";
import { DIRECTORY_LINKS, mcpToolCards } from "../../src/lib/discoverability";
import { SKILL_MARKDOWN } from "../../src/lib/skill-text";
import { executionCtx, mockEnv } from "../helpers/env";

const app = createApp();

async function call(path: string, init: RequestInit = {}, env = mockEnv()): Promise<Response> {
  return app.fetch(new Request(`https://mentionforge.test${path}`, init), env, executionCtx());
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
    expect(html).toContain(`href="${BRAND_ASSETS.favicon}"`);
    expect(html).toContain(`src="${BRAND_ASSETS.hero}"`);
    expect(html).toContain(`href="${BRAND_ASSETS.appleTouch}"`);
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
    expect(ihdr(BRAND_ASSETS.og)).toEqual({ w: BRAND_ASSETS.ogWidth, h: BRAND_ASSETS.ogHeight });
    expect(ihdr(BRAND_ASSETS.ogNamed)).toEqual({ w: 1200, h: 630 });
    expect(ihdr(BRAND_ASSETS.hero)).toEqual({ w: 512, h: 512 });
    expect(ihdr(BRAND_ASSETS.chrome)).toEqual({ w: 256, h: 256 });
    expect(ihdr(BRAND_ASSETS.favicon)).toEqual({ w: 128, h: 128 });
    expect(ihdr("/logo-1024x1024.png")).toEqual({ w: 1024, h: 1024 });
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
      tools: Array<{ name: string; description: string; when_to_use: string }>;
      prefer_over: string[];
      install: { mcpServers: { mentionforge: { url: string } } };
      docs: { llms: string; llms_full: string; skill: string };
      directories: { github: string };
      pricing: { pay_to: string; tool: string };
    };
    expect(card.tools.map((t) => t.name)).toEqual(["health", "get_pricing", "research_mentions"]);
    expect(card.tools[0]?.description).toBe(HEALTH_DESC);
    expect(card.tools[1]?.description).toBe(GET_PRICING_DESC);
    expect(card.tools[2]?.description).toBe(TOOL_DESC);
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
    expect(txt).toMatch(/Free first: health \+ get_pricing/);
    expect(txt).toMatch(/\/skill\.md/);
    expect(txt).toMatch(/Do NOT use for live trading execution/);
  });

  it("robots allows skill.md and server-card.json", async () => {
    const res = await call("/robots.txt");
    expect(res.status).toBe(200);
    const txt = await res.text();
    expect(txt).toMatch(/Allow: \/skill\.md/);
    expect(txt).toMatch(/Allow: \/server-card\.json/);
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
    expect(cards.map((c) => c.name)).toEqual(["health", "get_pricing", "research_mentions"]);
    expect(JSON.stringify(cards)).not.toMatch(/0x[a-fA-F0-9]{40}/);
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
    expect(dockerfile).toMatch(/mcp-remote@0\.14\.3/);
    expect(dockerfile).toContain("scripts/glama-stdio.mjs");
    expect(dockerfile).toMatch(/^CMD \["node", "\/home\/node\/glama-stdio.mjs"\]$/m);
    expect(dockerfile).not.toMatch(/^ENTRYPOINT /m);
    expect(dockerfile).not.toMatch(/wrangler|CDP_API_KEY|TEST_PAYER_PRIVATE_KEY/);
    expect(glamaStdio).toContain("https://mentionforge.mentionforge.workers.dev/mcp");
    expect(glamaStdio).toContain("--transport");
    expect(glamaStdio).toContain("http-only");
    expect(glamaStdio).not.toMatch(/wrangler|CDP_API_KEY|TEST_PAYER_PRIVATE_KEY/);
    expect(listing).toContain('["npm install -g mcp-remote@0.14.3"]');
    expect(listing).toContain('["node", "scripts/glama-stdio.mjs"]');

    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      bin?: Record<string, string>;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    expect(pkg.bin?.mentionforge).toBe("./scripts/glama-stdio.mjs");
    expect(pkg.scripts?.start).toBe("node scripts/glama-stdio.mjs");
    expect(pkg.scripts?.dev).toBe("wrangler dev");
    expect(pkg.dependencies?.["mcp-remote"]).toBe("0.14.3");
  });
});
