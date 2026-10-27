import { AgentError } from "../schemas/errors";
import { sha256Hex } from "./crypto";

export const API_KEY_PREFIX = "mfk_";

export type ApiKeyRecord = {
  key_hash: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  status: string;
  period_start: number;
  period_end: number;
  claimed: number;
  pending_key: string | null;
  checkout_session_id: string | null;
};

export function presentedApiKey(request: Request): string | null {
  const rawAuth = request.headers.get("Authorization") ?? "";
  if (rawAuth.startsWith("Bearer ")) {
    const token = rawAuth.slice(7).trim();
    if (token.startsWith(API_KEY_PREFIX)) return token;
  }
  const header = request.headers.get("X-Api-Key")?.trim() ?? "";
  if (header) return header;
  return null;
}

export async function hashApiKey(plaintext: string): Promise<string> {
  return sha256Hex(plaintext);
}

export function mintApiKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const body = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${API_KEY_PREFIX}${body}`;
}

export async function lookupApiKey(env: Env, keyHash: string): Promise<ApiKeyRecord | null> {
  const row = await env.DB.prepare(
    `SELECT key_hash, stripe_customer_id, stripe_subscription_id, status, period_start, period_end,
            claimed, pending_key, checkout_session_id
     FROM api_keys WHERE key_hash = ?`,
  )
    .bind(keyHash)
    .first<ApiKeyRecord>();
  return row ?? null;
}

export async function lookupApiKeyBySession(env: Env, sessionId: string): Promise<ApiKeyRecord | null> {
  const row = await env.DB.prepare(
    `SELECT key_hash, stripe_customer_id, stripe_subscription_id, status, period_start, period_end,
            claimed, pending_key, checkout_session_id
     FROM api_keys WHERE checkout_session_id = ?`,
  )
    .bind(sessionId)
    .first<ApiKeyRecord>();
  return row ?? null;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function keyIsLive(row: ApiKeyRecord, now = nowSeconds()): boolean {
  const live = row.status === "active" || row.status === "trialing" || row.status === "past_due";
  return live && now < Number(row.period_end);
}

/** Require a valid registered API key regardless of subscription status (for /v1/keys/me and /v1/keys/portal). */
export async function requireRegisteredApiKey(
  env: Env,
  request: Request,
  requestId: string,
): Promise<ApiKeyRecord> {
  const presented = presentedApiKey(request);
  if (!presented || !presented.startsWith(API_KEY_PREFIX) || presented.length < 12) {
    throw new AgentError("UNAUTHORIZED", "Valid API key required.", {
      request_id: requestId,
      hint: "Send Authorization: Bearer mfk_<your_key>.",
    });
  }
  let row: ApiKeyRecord | null;
  try {
    const hash = await hashApiKey(presented);
    row = await lookupApiKey(env, hash);
  } catch (err) {
    if (err instanceof AgentError) throw err;
    throw new AgentError("QUOTA_UNAVAILABLE", "Usage ledger unavailable. Request denied; nothing was charged.", {
      request_id: requestId,
      details: { reason: "api_key_lookup_failed" },
    });
  }
  if (!row) {
    throw new AgentError("UNAUTHORIZED", "Invalid API key.", {
      request_id: requestId,
      hint: "Send Authorization: Bearer mfk_<your_key>.",
    });
  }
  return row;
}

/** Valid key → record. Presented but invalid/unknown → 401. Inactive/expired → 402. */
export async function authenticateApiKey(
  env: Env,
  request: Request,
  requestId: string,
): Promise<ApiKeyRecord | null> {
  const presented = presentedApiKey(request);
  if (!presented) return null;
  if (!presented.startsWith(API_KEY_PREFIX) || presented.length < 12) {
    throw new AgentError("UNAUTHORIZED", "Invalid API key.", { request_id: requestId });
  }
  let row: ApiKeyRecord | null;
  try {
    const hash = await hashApiKey(presented);
    row = await lookupApiKey(env, hash);
  } catch (err) {
    if (err instanceof AgentError) throw err;
    throw new AgentError("QUOTA_UNAVAILABLE", "Usage ledger unavailable. Request denied; nothing was charged.", {
      request_id: requestId,
      details: { reason: "api_key_lookup_failed" },
    });
  }
  if (!row) {
    throw new AgentError("UNAUTHORIZED", "Invalid API key.", { request_id: requestId });
  }
  const now = nowSeconds();
  if (!keyIsLive(row, now)) {
    const periodEnd = Number(row.period_end);
    const retryDate = Number.isFinite(periodEnd) && periodEnd > 0 ? new Date(periodEnd * 1000).toISOString() : "";
    const expired = now >= periodEnd;
    const reason = expired
      ? `Billing period ended at ${retryDate || periodEnd} (status: ${row.status}).`
      : `Subscription status is ${row.status}.`;
    throw new AgentError("PAYMENT_REQUIRED", `API key is inactive or the billing period has ended. ${reason}`, {
      request_id: requestId,
      hint: `Renew or fix payment via POST /v1/keys/portal, check usage and status at GET /v1/keys/me, or see /support. Period end (retry date): ${row.period_end}${retryDate ? ` (${retryDate})` : ""}.`,
      details: {
        status: row.status,
        period_start: row.period_start,
        period_end: row.period_end,
        retry_date: retryDate || row.period_end,
        usage_url: "/v1/keys/me",
        manage_url: "/v1/keys/portal",
        support_url: "/support",
      },
    });
  }
  return row;
}
