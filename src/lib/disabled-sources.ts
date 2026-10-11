import { PLATFORMS, type Platform } from "./constants";

const PLATFORM_SET = new Set<string>(PLATFORMS);

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

export function disabledSourcesFromEnv(env: Env): Set<Platform> {
  return parseDisabledSources(env.DISABLED_SOURCES);
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
