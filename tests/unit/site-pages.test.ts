/// <reference types="node" />
/**
 * Site-wide quality gates for every public HTML page: semantic structure, accessibility basics,
 * CSP-safe markup, SEO metadata, structured data, shared chrome, design-token sync, and an
 * internal link check that resolves every href/src through the real Worker entry point.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../../src/index";
import { DESIGN_TOKENS } from "../../src/brand/tokens";
import { mcpToolCards } from "../../src/lib/discoverability";
import { faqEntries, TOOL_COPY } from "../../src/lib/landing";
import { siteFooterHtml, siteHeaderHtml } from "../../src/lib/site-chrome";
import { executionCtx, stubCaches, stubSourcesFetch } from "../helpers/env";
import { allPublicPages, prodEnv, PUBLIC_DIR } from "../helpers/pages";

const ORIGIN = "https://mentionforge.mentionforge.workers.dev";
const INDEXABLE: Record<string, string> = {
  "public/index.html": `${ORIGIN}/`,
  "public/about.html": `${ORIGIN}/about`,
  "public/privacy.html": `${ORIGIN}/privacy`,
  "public/terms.html": `${ORIGIN}/terms`,
};
/** The 404 needs no robots meta: its HTTP status already keeps it out of search indexes. */
const NOINDEX = ["public/support.html", "claim: ready", "claim: revealed", "claim: error"];

const attr = (html: string, re: RegExp) => html.match(re)?.[1];

function headingLevels(html: string): number[] {
  return [...html.replace(/<pre[\s\S]*?<\/pre>/g, "").matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
}

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  png: "image/png",
  webp: "image/webp",
  ico: "image/x-icon",
};

/** ASSETS binding backed by public/ on disk, like the real static-asset handler. */
function diskAssets(): Env["ASSETS"] {
  return {
    fetch: async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const file = new URL(`.${decodeURIComponent(url.pathname)}`, PUBLIC_DIR);
      if (!file.pathname.startsWith(PUBLIC_DIR.pathname) || !existsSync(file) || statSync(file).isDirectory() || url.pathname === "/_headers") {
        return new Response("not found", { status: 404 });
      }
      const ext = url.pathname.split(".").pop() ?? "";
      return new Response(readFileSync(file), { headers: { "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream" } });
    },
  } as unknown as Env["ASSETS"];
}

describe("site pages", () => {
  beforeEach(() => {
    stubCaches();
    stubSourcesFetch();
  });

  it("every page has lang, one h1, ordered headings, and described images", async () => {
    for (const [label, html] of await allPublicPages()) {
      expect(html, label).toMatch(/<html lang="en">/);
      const levels = headingLevels(html);
      expect(levels.filter((l) => l === 1), label).toHaveLength(1);
      expect(levels[0], label).toBe(1);
      for (let i = 1; i < levels.length; i++) {
        expect(levels[i]! - levels[i - 1]!, `${label}: h${levels[i - 1]} → h${levels[i]}`).toBeLessThanOrEqual(1);
      }
      for (const img of html.match(/<img\b[^>]*>/g) ?? []) {
        expect(img, label).toMatch(/\salt="[^"]*"/);
        expect(img, label).toMatch(/\swidth="\d+"/);
        expect(img, label).toMatch(/\sheight="\d+"/);
      }
      expect([...html.matchAll(/<main\b/g)], label).toHaveLength(1);
      expect(html, label).toContain('<a class="skip" href="#main">Skip to content</a>');
    }
  });

  it("markup is CSP-safe: no inline styles, event handlers, or inline scripts", async () => {
    for (const [label, html] of await allPublicPages()) {
      expect(html, label).not.toMatch(/\sstyle\s*=/i);
      expect(html, label).not.toMatch(/<style\b/i);
      expect(html, label).not.toMatch(/\son[a-z]+\s*=\s*["']/i);
      for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
        expect(tag, label).toMatch(/\ssrc="\/(?:app|claim)\.js" defer|type="application\/ld\+json"/);
      }
      for (const href of html.match(/\s(?:href|src)="(?:javascript|data):/gi) ?? []) {
        expect(href, label).toBeUndefined();
      }
    }
  });

  it("every page has a title and a meta description within search-result limits; indexable pages are unique", async () => {
    const pages = await allPublicPages();
    const titles = new Map<string, string>();
    const descriptions = new Map<string, string>();
    for (const [label, html] of pages) {
      const title = attr(html, /<title>([^<]+)<\/title>/);
      const description = attr(html, /<meta name="description" content="([^"]+)"/);
      expect(title, label).toBeTruthy();
      // Google cuts titles near 60 characters; count entities like &amp; as one character (MF-D1114).
      const visibleTitle = title!.replace(/&(?:amp|lt|gt|quot|#39);/g, "&");
      expect(visibleTitle.length, `${label} title`).toBeLessThanOrEqual(60);
      expect(description, label).toBeTruthy();
      expect(description!.length, `${label} description`).toBeLessThanOrEqual(160);
      expect(description!.length, `${label} description`).toBeGreaterThanOrEqual(50);
      if (label in INDEXABLE) {
        expect(titles.has(title!), `${label} duplicate title`).toBe(false);
        expect(descriptions.has(description!), `${label} duplicate description`).toBe(false);
        titles.set(title!, label);
        descriptions.set(description!, label);
      }
    }
    expect(titles.size).toBe(Object.keys(INDEXABLE).length);
  });

  it("indexable pages have canonical, Open Graph, Twitter, and valid JSON-LD; private pages are noindex", async () => {
    const pages = new Map(await allPublicPages());
    for (const [label, canonical] of Object.entries(INDEXABLE)) {
      const html = pages.get(label)!;
      expect(html, label).toContain(`<link rel="canonical" href="${canonical}"/>`);
      expect(html, label).toContain(`<meta property="og:url" content="${canonical}"/>`);
      for (const prop of ["og:title", "og:description", "og:image", "og:image:alt", "og:type", "og:site_name"]) {
        expect(html, `${label} ${prop}`).toMatch(new RegExp(`<meta property="${prop}" content="[^"]+"`));
      }
      for (const name of ["twitter:card", "twitter:title", "twitter:description", "twitter:image"]) {
        expect(html, `${label} ${name}`).toMatch(new RegExp(`<meta name="${name}" content="[^"]+"`));
      }
      expect(html, label).not.toMatch(/name="robots" content="[^"]*noindex/);
    }
    for (const label of NOINDEX) {
      expect(pages.get(label), label).toMatch(/<meta name="robots" content="noindex/);
    }
    for (const [label, html] of pages) {
      for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
        const data = JSON.parse(m[1]!) as Record<string, unknown>;
        expect(data["@context"], label).toBe("https://schema.org");
        const json = JSON.stringify(data);
        expect(json, label).not.toMatch(/aggregateRating|"review"|ratingValue|"Review"/);
        expect(json, label).not.toMatch(/0x[a-fA-F0-9]{40}/);
      }
    }
    const landing = pages.get("/ (hydrated, production)")!;
    expect([...landing.matchAll(/application\/ld\+json/g)]).toHaveLength(1);
    const graph = JSON.parse(landing.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!) as {
      "@graph": Array<{ "@type": string; mainEntity?: unknown[] }>;
    };
    const faq = graph["@graph"].find((n) => n["@type"] === "FAQPage");
    const index = readFileSync(new URL("index.html", PUBLIC_DIR), "utf8");
    expect(faq?.mainEntity).toHaveLength([...index.matchAll(/<details class="faq-item">/g)].length);
    expect(faqEntries(index).length).toBeGreaterThanOrEqual(6);
  });

  it("the landing header and footer are byte-identical to the shared site chrome", () => {
    const index = readFileSync(new URL("index.html", PUBLIC_DIR), "utf8").replace(/\r\n/g, "\n");
    expect(index).toContain(siteHeaderHtml("/"));
    expect(index).toContain(siteFooterHtml("/"));
  });

  it("styles.css declares every design token from src/brand/tokens.ts", () => {
    const css = readFileSync(new URL("styles.css", PUBLIC_DIR), "utf8");
    const kebab = (k: string) => k.replace(/([a-z])([A-Z0-9])/g, "$1-$2").toLowerCase();
    const expectVar = (name: string, value: string) => {
      const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
      expect(m?.[1]?.trim().toLowerCase(), name).toBe(value.toLowerCase());
    };
    for (const [k, v] of Object.entries(DESIGN_TOKENS.colors)) expectVar(`mf-${kebab(k)}`, v);
    for (const [k, v] of Object.entries(DESIGN_TOKENS.type)) expectVar(k === "display" ? "text-display" : `text-${k}`, v);
    for (const [k, v] of Object.entries(DESIGN_TOKENS.space)) expectVar(`space-${k}`, v);
    for (const [k, v] of Object.entries(DESIGN_TOKENS.radius)) expectVar(`radius-${k}`, v);
    expectVar("dur-fast", DESIGN_TOKENS.motion.fast);
    expectVar("dur-base", DESIGN_TOKENS.motion.base);
    expectVar("dur-slow", DESIGN_TOKENS.motion.slow);
    expectVar("ease-out", DESIGN_TOKENS.motion.easeOut);
    expectVar("ease-in-out", DESIGN_TOKENS.motion.easeInOut);
    expectVar("container", DESIGN_TOKENS.layout.container);
    expectVar("prose", DESIGN_TOKENS.layout.prose);
    expectVar("header-h", DESIGN_TOKENS.layout.header);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it("the landing tool section matches the live MCP catalog", () => {
    const index = readFileSync(new URL("index.html", PUBLIC_DIR), "utf8");
    const cards = mcpToolCards();
    const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen"];
    expect(index).toContain(`${words[cards.length]![0]!.toUpperCase()}${words[cards.length]!.slice(1)} focused tools`);
    expect(Object.keys(TOOL_COPY).sort()).toEqual(cards.map((c) => c.name).sort());
    const free = cards.filter((c) => c.kind === "free").length;
    expect(index).toContain(`${words[free]![0]!.toUpperCase()}${words[free]!.slice(1)} tools never charge`);
  });

  it("every internal link, asset, and in-page anchor resolves", async () => {
    const pages = await allPublicPages();
    const index = readFileSync(new URL("index.html", PUBLIC_DIR), "utf8");
    const landingIds = new Set([...index.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
    const targets = new Set<string>();
    for (const [label, html] of pages) {
      const pageIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
      const refs = [
        ...[...html.matchAll(/\s(?:href|src)="([^"]+)"/g)].map((m) => m[1]!.replaceAll("&amp;", "&")),
        ...[...html.matchAll(/\ssrcset="([^"]+)"/g)].flatMap((m) => m[1]!.split(",").map((c) => c.trim().split(/\s+/)[0]!)),
      ];
      for (const ref of refs) {
        if (ref.startsWith("#")) {
          expect(pageIds.has(ref.slice(1)), `${label}: ${ref}`).toBe(true);
        } else if (ref.startsWith("/#")) {
          expect(landingIds.has(ref.slice(2)), `${label}: ${ref}`).toBe(true);
        } else if (ref.startsWith("/")) {
          targets.add(ref.split("#")[0]!);
        }
      }
    }
    expect(targets.size).toBeGreaterThan(20);
    const env = prodEnv();
    env.ASSETS = diskAssets();
    for (const target of targets) {
      const res = await worker.fetch(
        new Request(`${ORIGIN}${target}`, { headers: { Accept: "text/html", "Sec-Fetch-Dest": "document" } }),
        env,
        executionCtx(),
      );
      expect(res.status, target).toBe(200);
    }
  });
});
