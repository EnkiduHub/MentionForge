import type { CachedResearch } from "../schemas/research";

const CACHE_HOST = "https://mentionforge.cache/research";

export type TtlPolicy = { ttlSec: number; swrSec: number };

export function ttlForTimeframe(tf: unknown): TtlPolicy {
  if (tf === "24h") return { ttlSec: 10 * 60, swrSec: 20 * 60 };
  if (tf === "7d") return { ttlSec: 30 * 60, swrSec: 60 * 60 };
  return { ttlSec: 2 * 60 * 60, swrSec: 4 * 60 * 60 };
}

export function cacheRequest(keyHex: string): Request {
  return new Request(`${CACHE_HOST}?k=${keyHex}`, { method: "GET" });
}

export type CacheHit = {
  body: CachedResearch;
  ageSec: number;
  freshness: "live" | "cached";
  stale: boolean;
};

export async function matchResearch(keyHex: string): Promise<CacheHit | null> {
  try {
    const res = await caches.default.match(cacheRequest(keyHex));
    if (!res) return null;
    const raw = (await res.json()) as CachedResearch & { cached_at?: string };
    const body = researchOnly(raw);
    const cachedAt = Date.parse(raw.cached_at ?? body.meta?.as_of ?? "") || Date.now();
    const ageSec = Math.max(0, (Date.now() - cachedAt) / 1000);
    const cc = res.headers.get("Cache-Control") ?? "";
    const maxAge = Number(/max-age=(\d+)/.exec(cc)?.[1] ?? 1800);
    return {
      body,
      ageSec,
      freshness: "cached",
      stale: ageSec > maxAge,
    };
  } catch {
    return null;
  }
}

export async function putResearch(keyHex: string, body: CachedResearch, ttlSec: number): Promise<void> {
  const payload = researchOnly(body);
  const res = new Response(JSON.stringify({ ...payload, cached_at: new Date().toISOString() }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `private, max-age=${ttlSec}`,
    },
  });
  try {
    await caches.default.put(cacheRequest(keyHex), res);
  } catch {
    // Cache API may reject in some test environments.
  }
}

/** Never persist billing, request_id, or latency — those are per payer. */
export function researchOnly(body: CachedResearch): CachedResearch {
  const meta = body.meta ?? { sources_used: [] };
  return {
    query: body.query,
    timeframe: body.timeframe,
    volume: body.volume,
    sentiment: body.sentiment,
    themes: body.themes,
    mentions: body.mentions,
    summary: body.summary,
    citations: body.citations,
    meta: {
      sources_used: meta.sources_used,
      confidence: meta.confidence,
      degraded: meta.degraded,
      as_of: meta.as_of,
    },
  };
}

export async function matchFlag(name: string): Promise<boolean> {
  try {
    const res = await caches.default.match(new Request(`https://mentionforge.cache/flag/${name}`, { method: "GET" }));
    return !!res;
  } catch {
    return false;
  }
}

export async function putFlag(name: string, ttlSec: number): Promise<void> {
  try {
    await caches.default.put(
      new Request(`https://mentionforge.cache/flag/${name}`, { method: "GET" }),
          new Response("1", { headers: { "Cache-Control": `private, max-age=${ttlSec}` } }),
    );
  } catch {
    /* ignore */
  }
}
