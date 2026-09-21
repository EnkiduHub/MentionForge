import { getAddress } from "viem";

export const SERVICE_NAME = "MentionForge";
export const SERVICE_VERSION = "1.2.2";
export const DEFAULT_PRICE_USDC = "0.02";
export const DEFAULT_TRIAL_CALLS = 10;
export const USDC_DECIMALS = 6;
export const DEFAULT_ATOMIC = "20000";
export const MAX_BODY_BYTES = 8 * 1024;
export const MAX_QUERY_CHARS = 200;
export const MAX_MENTION_CHARS = 500;
export const MAX_TIMEFRAME_DAYS = 90;
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/** Per-upstream abort. 600ms was shorter than Wikipedia/Wikidata RTT from Workers, so gather returned nothing and paid calls never reached settle. */
export const SOURCE_TIMEOUT_MS = 2500;
/** Unauthenticated Reddit search is often blocked from Workers; fail fast so news/web keep the engine budget. */
export const UNAUTH_SOURCE_TIMEOUT_MS = 800;
/** Wall-clock budget for all adapters. Must exceed one web path (wiki ∥ wikidata + optional summary). Fetch wait is not isolate CPU. */
export const ENGINE_BUDGET_MS = 8000;
export const AI_TIMEOUT_MS = 250;
export const FETCH_POOL_MAX = 5;
export const GDELT_THROTTLE_S = 5;
export const USER_AGENT = "MentionForge/1.2.2 (research; +https://mentionforge.mentionforge.workers.dev)";
/** Public sample query — a real product, used in docs, OpenAPI, and GET /v1/research/example. */
export const SAMPLE_QUERY = "Cloudflare Workers";

export const USDC = {
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
} as const;

/** EIP-712 token domain. Mainnet Base USDC is "USD Coin", not "USDC" — a wrong name invalidates permits. */
export const USDC_EIP712 = {
  "eip155:84532": { name: "USDC", version: "2" },
  "eip155:8453": { name: "USD Coin", version: "2" },
} as const;

export const NETWORK_CAIP: Record<string, keyof typeof USDC> = {
  "base-sepolia": "eip155:84532",
  "base": "eip155:8453",
  "eip155:84532": "eip155:84532",
  "eip155:8453": "eip155:8453",
};

export type Platform = "x" | "reddit" | "web" | "reviews" | "news";
export const PLATFORMS: Platform[] = ["x", "reddit", "web", "reviews", "news"];

export function normalizeNetwork(raw: string | undefined): keyof typeof USDC {
  const key = (raw ?? "base-sepolia").trim();
  return NETWORK_CAIP[key] ?? "eip155:84532";
}

export function priceToAtomic(priceUsdc: string | undefined): string {
  const n = Number.parseFloat(priceUsdc || DEFAULT_PRICE_USDC);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_ATOMIC;
  return String(Math.round(n * 10 ** USDC_DECIMALS));
}

export function isPlaceholderWallet(addr: string | undefined): boolean {
  if (!addr) return true;
  return /^0x0{40}$/i.test(addr.trim());
}

export function isWallet(addr: string | undefined): addr is `0x${string}` {
  return !!addr && /^0x[a-fA-F0-9]{40}$/.test(addr.trim());
}

/**
 * EIP-55 checksum. CDP documents payTo as a checksummed 0x address.
 * Invalid mixed-case checksums fall back to lowercase so a typo cannot take the Worker down.
 */
export function normalizePayTo(addr: string): string {
  const t = addr.trim();
  if (!isWallet(t)) return t;
  try {
    return getAddress(t);
  } catch {
    return t.toLowerCase();
  }
}
