/// <reference path="./node_modules/@cloudflare/workers-types/index.d.ts" />
// Generated-style Env bindings. Re-run `npm run types` after wrangler.jsonc changes.
// Path-reference workers-types so the IDE still loads URL/crypto/fetch when
// compilerOptions.types cannot resolve the package (common on WSL + Windows TS).

interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface AnalyticsEngineDataset {
  writeDataPoint(event: {
    blobs?: string[];
    doubles?: number[];
    indexes?: string[];
  }): void;
}

interface Ai {
  run(model: string, inputs: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
}

interface Env {
  DB: D1Database;
  METRICS?: AnalyticsEngineDataset;
  AI?: Ai;
  ASSETS: Fetcher;
  PAID_LIMIT: RateLimit;
  UNPAID_LIMIT: RateLimit;
  TRIAL_LIMIT: RateLimit;
  DISCOVERY_LIMIT: RateLimit;
  NETWORK: string;
  PRICE_USDC: string;
  FREE_TRIAL_CALLS: string;
  FACILITATOR_URL: string;
  RECIPIENT_WALLET: string;
  ALLOWED_ORIGINS: string;
  SERVICE_VERSION: string;
  DISABLED_SOURCES?: string;
  /** Rolling 30-day cap on disclosed IDs. Default 1500000 when unset. */
  X_ID_CAP?: string;
  /** Stripe Price id for the $29/mo Key plan (public). */
  STRIPE_KEY_PRICE_ID?: string;
  /** Monthly call quota for the Key plan. Default 1500. */
  PLAN_KEY_MONTHLY_CALLS?: string;
  /** Optional support email rendered as a mailto link on /support when non-empty. */
  SUPPORT_EMAIL?: string;
  /** Stripe secret key. Worker secret, never a wrangler var. */
  STRIPE_SECRET_KEY?: string;
  /** Stripe webhook signing secret. Worker secret, never a wrangler var. */
  STRIPE_WEBHOOK_SECRET?: string;
  SANDBOX_KEY?: string;
  OPERATOR_TOKEN?: string;
  BRAVE_API_KEY?: string;
  REDDIT_CLIENT_ID?: string;
  REDDIT_CLIENT_SECRET?: string;
  X_BEARER_TOKEN?: string;
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
}

declare namespace Cloudflare {
  interface Env extends Env {}
}
