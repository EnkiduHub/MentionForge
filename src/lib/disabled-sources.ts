import { PLATFORMS, type Platform } from "./constants";

const PLATFORM_SET = new Set<string>(PLATFORMS);
const EXTRA_SET = new Set(["brave"]);

/** Production default: X, Reddit, Brave, and review-site adapters off. */
export const DEFAULT_DISABLED_SOURCES = "x,reddit,brave,reviews";

/** Comma-separated platform ids from `DISABLED_SOURCES` (e.g. `x,reddit`). Extra token: `brave`. */
export function parseDisabledSources(raw: string | undefined): Set<Platform> {
  return parseDisabledList(raw).platforms;
}

export function parseDisabledList(raw: string | undefined): { platforms: Set<Platform>; extra: Set<string> } {
  const disabled = new Set<Platform>();
  const extra = new Set<string>();
  const source = raw === undefined ? DEFAULT_DISABLED_SOURCES : raw;
  if (!source.trim()) return { platforms: disabled, extra };
  for (const part of source.split(",")) {
    const id = part.trim().toLowerCase();
    if (PLATFORM_SET.has(id)) disabled.add(id as Platform);
    if (EXTRA_SET.has(id)) extra.add(id);
  }
  return { platforms: disabled, extra };
}

export function disabledSourcesFromEnv(env: Env): Set<Platform> {
  return parseDisabledList(env.DISABLED_SOURCES).platforms;
}

export function isBraveDisabled(env: Env): boolean {
  return parseDisabledList(env.DISABLED_SOURCES).extra.has("brave");
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
