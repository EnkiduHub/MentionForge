/// <reference types="node" />
/**
 * Hero query preview: presets mirror the query builder, every card is built only from the frozen
 * example (no requests of any kind), non-matching presets say so honestly, and the markup is
 * accessible and layout-stable.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXAMPLE_RESPONSE } from "../../src/lib/example";
import { formatUtc, heroPreviewHtml, hydrateLandingHtml, QUERY_PRESETS } from "../../src/lib/landing";
import { mockEnv } from "../helpers/env";
import { PUBLIC_DIR } from "../helpers/pages";

const index = readFileSync(new URL("index.html", PUBLIC_DIR), "utf8");
const appJs = readFileSync(new URL("app.js", PUBLIC_DIR), "utf8");
const css = readFileSync(new URL("../../src/styles/site.css", import.meta.url), "utf8");
const ex = EXAMPLE_RESPONSE;

function card(html: string, value: string): string {
  const m = html.match(new RegExp(`<div class="hq-card" id="hq-card-${value}"[\\s\\S]*?(?=<div class="hq-card" id="hq-card-|<p class="hq-foot">)`));
  expect(m, value).not.toBeNull();
  return m![0];
}

describe("hero query preview", () => {
  it("sits directly under the h1 with one radio per query-builder preset, same wording and order", () => {
    const hero = index.match(/<section class="hero"[\s\S]*?<\/section>/)![0];
    expect(hero.indexOf("</h1>")).toBeLessThan(hero.indexOf('<fieldset class="hq-bar">'));
    expect(hero.indexOf('<fieldset class="hq-bar">')).toBeLessThan(hero.indexOf('<div class="hq-stage" id="hq-stage">'));
    expect(hero.indexOf('<div class="hq-stage" id="hq-stage">')).toBeLessThan(hero.indexOf('<p class="lede">'));

    const radios = [...hero.matchAll(/<input class="hq-radio" type="radio" name="hq" id="hq-([a-z]+)" value="([a-z]+)"[^>]*\/><label for="hq-([a-z]+)">([^<]+)<\/label>/g)];
    const builder = [...index.matchAll(/<button type="button" class="preset" data-preset="([a-z]+)" aria-pressed="(?:true|false)">([^<]+)<\/button>/g)];
    expect(radios.map((m) => [m[2], m[4]])).toEqual(QUERY_PRESETS.map((p) => [p.value, p.label]));
    expect(builder.map((m) => [m[1], m[2]])).toEqual(QUERY_PRESETS.map((p) => [p.value, p.label]));
    for (const m of radios) {
      expect(m[1]).toBe(m[2]);
      expect(m[3]).toBe(m[2]);
    }
    expect([...hero.matchAll(/name="hq"[^>]*\schecked/g)]).toHaveLength(1);
    expect(hero).toMatch(/id="hq-brand" value="brand" aria-describedby="hq-flag" checked\/>/);
  });

  it("uses the same query and timeframe as the builder presets in app.js", () => {
    const block = appJs.match(/const PRESETS = \{([\s\S]*?)\};/)![1]!;
    const parsed = [...block.matchAll(/(\w+): \{ query: "([^"]+)", timeframe: "([^"]+)" \}/g)].map((m) => ({ value: m[1], query: m[2], timeframe: m[3] }));
    expect(parsed).toEqual(QUERY_PRESETS.map(({ value, query, timeframe }) => ({ value, query, timeframe })));
  });

  it("is labelled “Frozen example. No call made.” and every radio is described by that label", () => {
    expect(index).toContain('<p class="hq-flag" id="hq-flag"><span class="hq-flag-dot" aria-hidden="true"></span>Frozen example. No call made.</p>');
    expect([...index.matchAll(/aria-describedby="hq-flag"/g)]).toHaveLength(QUERY_PRESETS.length);
    expect(index).toContain('<legend class="hq-legend">Query preview</legend>');
  });

  it("hydration fills the cards server-side, one per preset", () => {
    const out = hydrateLandingHtml(index, mockEnv(), 0);
    expect(out).not.toContain('<div class="hq-cards" id="hq-cards"></div>');
    expect(out).toContain(`<div class="hq-cards" id="hq-cards">${heroPreviewHtml()}</div>`);
    for (const p of QUERY_PRESETS) {
      const c = card(out, p.value);
      expect(c).toContain(`data-hq="${p.value}" role="group" aria-labelledby="hq-req-${p.value}"`);
      expect(c).toContain(`<span class="hq-v">${p.query}</span>`);
      expect(c).toContain(`<span class="hq-v">${p.timeframe}</span>`);
    }
  });

  it("calls a card an exact match only when the preset is the frozen query and window; the rest say so", () => {
    const html = heroPreviewHtml();
    for (const p of QUERY_PRESETS) {
      const c = card(html, p.value);
      const exact = p.query === ex.query && p.timeframe === ex.timeframe;
      if (exact) {
        expect(c, p.value).toContain('data-match="exact">Exact match: this is the frozen run.');
      } else {
        expect(c, p.value).toContain(`data-match="closest">No frozen run for this query. Closest frozen example: “${ex.query}” · ${ex.timeframe}.`);
      }
    }
    expect(QUERY_PRESETS.filter((p) => p.query === ex.query && p.timeframe === ex.timeframe).map((p) => p.value)).toEqual(["brand"]);
  });

  it("shows only values from the frozen example", () => {
    const html = heroPreviewHtml();
    const kpi = (k: string, v: string) => `<li><span>${k}</span><strong>${v}</strong></li>`;
    const brand = card(html, "brand");
    expect(brand).toContain(kpi("Mentions", String(ex.volume.total)));
    expect(brand).toContain(kpi("Sentiment", ex.sentiment.overall.toFixed(2)));
    expect(brand).toContain(kpi("Risk", ex.signals!.risk));
    expect(brand).toContain(kpi("Confidence", String(ex.meta.confidence)));
    expect(brand).toContain(`aria-label="neutral ${ex.sentiment.neutral} percent"`);
    for (const t of ex.themes.slice(0, 3)) expect(brand).toContain(`<li>${t.theme}</li>`);

    const vs = card(html, "vs");
    for (const r of ex.share_of_voice!) {
      expect(vs).toContain(kpi(r.brand, String(r.mentions)));
      expect(vs).toContain(`aria-label="${r.brand} ${r.share * 100} percent"`);
    }
    expect(vs).not.toMatch(/AWS Lambda<\/span><div class="bar"/);

    const reviews = card(html, "reviews");
    const byPlatform = ex.volume.by_platform as Record<string, number>;
    expect(reviews).toContain(kpi("Review sites", String(byPlatform.reviews)));
    expect(reviews).toContain(kpi("Web", String(byPlatform.web)));
    const opinion = ex.mentions.find((m) => m.intent === "complaint" || m.intent === "praise")!;
    expect(reviews).toContain(`href="${opinion.url}"`);
    expect(reviews).toContain(`sentiment ${opinion.sentiment.toFixed(2)}`);

    const risk = card(html, "risk");
    expect(risk).toContain(kpi("Risk", ex.signals!.risk));
    expect(risk).toContain(kpi("Spike", ex.signals!.spike ? "yes" : "no"));
    expect(risk).toContain(kpi("Negative", `${ex.sentiment.negative}%`));
    expect(risk).toContain(ex.signals!.reasons[0]!);

    expect(html).toContain(`Captured ${formatUtc(ex.meta.as_of)} · sources: ${ex.meta.sources_used.join(", ")}`);
  });

  it("loads nothing: no resources in the cards and no network calls in the preview script", () => {
    const html = heroPreviewHtml();
    expect(html).not.toMatch(/<(?:img|script|link|iframe|form|video|audio|source|object|embed)\b|\s(?:src|srcset|action|formaction|poster|data)=/i);
    const hrefs = [...html.matchAll(/\shref="([^"]+)"/g)].map((m) => m[1]!);
    const allowed = new Set(["#example", ...ex.mentions.map((m) => m.url)]);
    for (const href of hrefs) expect(allowed.has(href), href).toBe(true);

    const script = appJs.slice(appJs.indexOf("hero query preview"), appJs.indexOf("scroll reveals"));
    expect(script.length).toBeGreaterThan(100);
    expect(script).not.toMatch(/\bfetch\b|XMLHttpRequest|sendBeacon|EventSource|WebSocket|import\(|\.src\s*=|location\.(?:href|assign|replace)/);
  });

  it("keeps the stage height fixed and the motion optional", () => {
    expect(css).toMatch(/\.hq-card \{ grid-area: 1 \/ 1;/);
    const motion = css.slice(css.indexOf("@layer motion"));
    const noPref = motion.indexOf("@media (prefers-reduced-motion: no-preference)");
    const reduce = motion.indexOf("@media (prefers-reduced-motion: reduce)");
    const hqMotion = motion.indexOf(".hq-card { transform");
    expect(noPref).toBeGreaterThan(-1);
    expect(hqMotion).toBeGreaterThan(noPref);
    expect(hqMotion).toBeLessThan(reduce);
    // outside the motion layer the cards only toggle visibility and opacity
    const pages = css.slice(0, css.indexOf("@layer motion {"));
    expect(pages).not.toMatch(/\.hq-card[^{]*\{[^}]*(?:transition|animation)/);
  });
});
