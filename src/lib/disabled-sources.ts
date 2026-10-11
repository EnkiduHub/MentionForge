import { PLATFORMS, type Platform } from "./constants";

const PLATFORM_SET = new Set<string>(PLATFORMS);

/** Sub-sources that are not platform ids. GDELT stays on the `news` platform. */
export const SUBSOURCE_IDS = ["gnews", "hn"] as const;
export type SubsourceId = (typeof SUBSOURCE_IDS)[number];
const SUBSOURCE_SET = new Set<string>(SUBSOURCE_IDS);

/** Google News stays fail-closed. HN is a normal sub-source (off only when listed). */
export const ALWAYS_DISABLED_SUBSOURCES: readonly SubsourceId[] = ["gnews"];

/**
 * Production / staging / top-level wrangler value. Platforms `x` and `reddit`
 * plus always-off sub-source `gnews`. Do not add `news` — that would disable
 * GDELT. Do not add `hn` — Hacker News Algolia is on.
 */
export const WRANGLER_DISABLED_SOURCES = "x,reddit,gnews";

/** Comma-separated platform ids from `DISABLED_SOURCES` (e.g. `x,reddit`). */
export function parseDisabledSources(raw: string | undefined): Set<Platform> {
  const disabled = new Set<Platform>();
  if (!raw?.trim()) return disabled;
  for (const part of raw.split(",")) {
    const id = part.trim().toLowerCase();
    if (PLATFORM_SET.has(id)) disabled.add(id as Platform);
  }
  return disabled;
}

/**
 * `gnews` is fail-closed: disabled when `DISABLED_SOURCES` is unset, empty, or
 * lists it. `hn` is enabled unless the comma list includes `hn`.
 */
export function parseDisabledSubsources(raw: string | undefined): Set<SubsourceId> {
  const disabled = new Set<SubsourceId>(ALWAYS_DISABLED_SUBSOURCES);
  if (!raw?.trim()) return disabled;
  for (const part of raw.split(",")) {
    const id = part.trim().toLowerCase();
    if (SUBSOURCE_SET.has(id)) disabled.add(id as SubsourceId);
  }
  return disabled;
}

export function disabledSourcesFromEnv(env: Env): Set<Platform> {
  return parseDisabledSources(env.DISABLED_SOURCES);
}

export function isSubsourceDisabled(env: Env, id: SubsourceId): boolean {
  return parseDisabledSubsources(env.DISABLED_SOURCES).has(id);
}

export function isSocialHostDisabled(hostname: string, disabled: Set<Platform>): boolean {
  const h = hostname.replace(/^www\./, "").toLowerCase();
  if (disabled.has("x") && (h === "x.com" || h === "twitter.com" || h.endsWith(".x.com") || h.endsWith(".twitter.com"))) {
    return true;
  }
  if (disabled.has("reddit") && (h === "reddit.com" || h.endsWith(".reddit.com"))) return true;
  return false;
}

export function urlUsesDisabledSocial(url: string, disabled: Set<Platform>): boolean {
  if (disabled.size === 0) return false;
  try {
    return isSocialHostDisabled(new URL(url).hostname, disabled);
  } catch {
    return false;
  }
}

/** True when a fetch URL hits a disabled social host or a Brave `site:` query for one. */
export function fetchTargetsDisabledSocial(url: string, disabled: Set<Platform>): boolean {
  if (disabled.size === 0) return false;
  if (urlUsesDisabledSocial(url, disabled)) return true;
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    /* keep raw */
  }
  if (disabled.has("x") && /\bsite:\s*(?:www\.)?(?:x\.com|twitter\.com)\b/i.test(decoded)) return true;
  if (disabled.has("reddit") && /\bsite:\s*(?:www\.)?(?:reddit\.com)\b/i.test(decoded)) return true;
  return false;
}
