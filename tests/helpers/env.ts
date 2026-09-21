import type { ResearchRequest } from "../../src/schemas/research";

export function executionCtx(): ExecutionContext {
  return {
    waitUntil(promise: Promise<unknown>) {
      void promise;
    },
    passThroughOnException() {},
    props: {},
  } as ExecutionContext;
}

type TrialRow = { used: number; updated_at: string };
type IdemRow = { key: string; body_hash: string; status: string; response: string; billing: string; created_at: string };
type StatsRow = { day: string; calls: number; paid: number; usdc_micros: number; errors: number; trial: number };

export function memoryD1() {
  const trial = new Map<string, TrialRow>();
  const idem = new Map<string, IdemRow>();
  const stats = new Map<string, StatsRow>();

  return {
    trial,
    idem,
    stats,
    prepare(sql: string) {
      const binds: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          binds.push(...args);
          return stmt;
        },
        async run() {
          if (sql.includes("INSERT INTO trial_wallets")) {
            const wallet = String(binds[0]);
            if (!trial.has(wallet)) trial.set(wallet, { used: 0, updated_at: String(binds[1]) });
            return { meta: { changes: trial.has(wallet) ? 0 : 1 } };
          }
          if (sql.includes("UPDATE trial_wallets")) {
            const wallet = String(binds[1]);
            const cap = Number(binds[2]);
            const row = trial.get(wallet);
            if (row && row.used < cap) {
              row.used += 1;
              row.updated_at = String(binds[0]);
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }
          if (sql.includes("INSERT INTO idempotency")) {
            idem.set(String(binds[0]), {
              key: String(binds[0]),
              body_hash: String(binds[1]),
              status: "complete",
              response: String(binds[2]),
              billing: String(binds[3]),
              created_at: String(binds[4]),
            });
            return { meta: { changes: 1 } };
          }
          if (sql.includes("DELETE FROM idempotency")) {
            idem.delete(String(binds[0]));
            return { meta: { changes: 1 } };
          }
          if (sql.includes("INSERT INTO stats_daily")) {
            const day = String(binds[0]);
            const cur = stats.get(day) ?? { day, calls: 0, paid: 0, usdc_micros: 0, errors: 0, trial: 0 };
            cur.calls += 1;
            cur.paid += Number(binds[1]);
            cur.usdc_micros += Number(binds[2]);
            cur.errors += Number(binds[3]);
            cur.trial += Number(binds[4]);
            stats.set(day, cur);
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
        async first<T>() {
          if (sql.includes("FROM trial_wallets")) {
            const row = trial.get(String(binds[0]));
            return (row as T) ?? null;
          }
          if (sql.includes("FROM idempotency")) {
            const row = idem.get(String(binds[0]));
            return (row as T) ?? null;
          }
          if (sql.includes("SUM(calls)")) {
            let n = 0;
            for (const r of stats.values()) n += r.calls;
            return { n } as T;
          }
          if (sql.includes("SELECT 1")) {
            return { ok: 1 } as T;
          }
          return null;
        },
        async all<T>() {
          if (sql.includes("FROM stats_daily")) {
            return { results: [...stats.values()] as T[] };
          }
          return { results: [] as T[] };
        },
      };
      return stmt;
    },
  };
}

export function mockEnv(over: Partial<Env> = {}): Env {
  const limiter = { async limit() { return { success: true }; } };
  const db = memoryD1();
  return {
    DB: db as unknown as D1Database,
    METRICS: { writeDataPoint() {} },
    ASSETS: { fetch: async () => new Response("not found", { status: 404 }) } as unknown as Env["ASSETS"],
    PAID_LIMIT: limiter,
    UNPAID_LIMIT: limiter,
    TRIAL_LIMIT: limiter,
    DISCOVERY_LIMIT: limiter,
    NETWORK: "base-sepolia",
    PRICE_USDC: "0.02",
    FREE_TRIAL_CALLS: "10",
    FACILITATOR_URL: "https://x402.org/facilitator",
    RECIPIENT_WALLET: "0x1111111111111111111111111111111111111111",
    ALLOWED_ORIGINS: "*",
    SERVICE_VERSION: "1.0.0",
    SANDBOX_KEY: "test-sandbox",
    OPERATOR_TOKEN: "test-operator",
    ...over,
  } as Env;
}

export const sampleReq: ResearchRequest = {
  query: "ForgeCo",
  platforms: ["reddit", "news", "web", "reviews", "x"],
  timeframe: "7d",
  limit: 20,
  include_summary: true,
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type FetchFn = typeof fetch;

function fetchHolder(): { fetch: FetchFn } {
  return globalThis as unknown as { fetch: FetchFn };
}

export function getGlobalFetch(): FetchFn {
  return fetchHolder().fetch;
}

export function setGlobalFetch(fn: FetchFn): FetchFn {
  const g = fetchHolder();
  const prev = g.fetch;
  g.fetch = fn;
  return prev;
}

export function stubCaches() {
  const store = new Map<string, Response>();
  const api = {
    async match(req: Request) {
      const hit = store.get(req.url);
      return hit ? hit.clone() : undefined;
    },
    async put(req: Request, res: Response) {
      store.set(req.url, res.clone());
    },
  };
  Object.defineProperty(globalThis, "caches", { value: { default: api }, configurable: true });
  return store;
}

export type SourceFetchStub = { settleCount: number };

export function stubSourcesFetch(opts: { failSources?: boolean; failVerify?: boolean } = {}): SourceFetchStub {
  const state: SourceFetchStub = { settleCount: 0 };
  const now = Math.floor(Date.now() / 1000);
  setGlobalFetch(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/supported")) {
      return jsonResponse({
        kinds: [
          { x402Version: 2, scheme: "exact", network: "eip155:84532" },
          { x402Version: 2, scheme: "exact", network: "eip155:8453" },
        ],
      });
    }
    if (url.includes("/verify")) {
      if (opts.failVerify) {
        return jsonResponse({ isValid: false, invalidReason: "invalid_payload", invalidMessage: "stub verify fail" }, 400);
      }
      return jsonResponse({ isValid: true, payer: "0x1111111111111111111111111111111111111111" });
    }
    if (url.includes("/settle")) {
      state.settleCount += 1;
      return jsonResponse({ success: true, transaction: "0xabc", network: "eip155:84532" });
    }
    if (opts.failSources) {
      throw new Error("offline");
    }
    if (url.includes("reddit.com")) {
      return jsonResponse({
        data: {
          children: [
            {
              data: {
                id: "abc",
                author: "ops",
                title: "ForgeCo API is great",
                selftext: "latency dropped",
                permalink: "/r/saas/comments/abc/forgeco/",
                created_utc: now - 3600,
                score: 12,
                num_comments: 3,
              },
            },
          ],
        },
      });
    }
    if (url.includes("wikipedia.org/w/api.php")) {
      return jsonResponse({ query: { search: [{ title: "ForgeCo", snippet: "A fictional brand" }] } });
    }
    if (url.includes("wikipedia.org/api/rest_v1")) {
      return jsonResponse({
        title: "ForgeCo",
        extract: "ForgeCo is a fictional research brand used in tests.",
        content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/ForgeCo" } },
      });
    }
    if (url.includes("wikidata.org")) {
      return jsonResponse({ search: [{ id: "Q1", label: "ForgeCo", description: "fictional", concepturi: "https://www.wikidata.org/entity/Q1" }] });
    }
    if (url.includes("news.google.com")) {
      const d = new Date().toUTCString();
      return new Response(`<rss><item><title>ForgeCo ships</title><link>https://example.com/n</link><pubDate>${d}</pubDate></item></rss>`, {
        headers: { "content-type": "application/xml" },
      });
    }
    if (url.includes("gdeltproject.org") || url.includes("algolia.com") || url.includes("duckduckgo.com") || url.includes("brave.com") || url.includes("x.com")) {
      return jsonResponse({});
    }
    return jsonResponse({}, 404);
  });
  return state;
}
