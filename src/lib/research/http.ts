import { SOURCE_TIMEOUT_MS, USER_AGENT } from "../constants";
import { FetchPool, abortMs } from "../fetch-pool";
import { allowedFetch, cancelBody } from "../allowlist";
import { isoNow } from "../crypto";
import type { SourceResult } from "./types";

export type SourceCtx = {
  env: Env;
  pool: FetchPool;
  query: string;
  lang?: string;
};

const DEFAULT_HEADERS = {
  "user-agent": USER_AGENT,
  "api-user-agent": USER_AGENT,
} as const;

export async function getJson<T>(
  ctx: SourceCtx,
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = SOURCE_TIMEOUT_MS,
): Promise<T | null> {
  try {
    const res = await allowedFetch(url, {
      pool: ctx.pool,
      signal: abortMs(timeoutMs),
      headers: { ...DEFAULT_HEADERS, accept: "application/json", ...headers },
    });
    if (!res.ok) {
      cancelBody(res);
      return null;
    }
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function getText(ctx: SourceCtx, url: string): Promise<string | null> {
  try {
    const res = await allowedFetch(url, {
      pool: ctx.pool,
      signal: abortMs(SOURCE_TIMEOUT_MS),
      headers: { ...DEFAULT_HEADERS, accept: "application/rss+xml, application/xml, text/xml, text/html" },
    });
    if (!res.ok) {
      cancelBody(res);
      return null;
    }
    return await res.text();
  } catch {
    return null;
  }
}

export function cite(url: string, title: string, source: string): SourceResult["citations"][number] {
  return { url, title, source, accessed_at: isoNow() };
}

export function emptyResult(source: string, degraded = false, error?: string): SourceResult {
  return { source, mentions: [], citations: [], degraded, error };
}
