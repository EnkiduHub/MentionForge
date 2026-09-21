import type { ResearchResponse } from "../schemas/research";
import type { Billing } from "./x402";
import { AgentError } from "../schemas/errors";
import { IDEMPOTENCY_TTL_MS } from "./constants";
import { isoNow } from "./crypto";

export type IdempotencyRecord = {
  key: string;
  body_hash: string;
  status: string;
  response: ResearchResponse | Record<string, unknown> | null;
  billing: Billing | null;
};

export async function lookupIdempotency(
  env: Env,
  key: string | null,
  bodyHash: string,
  requestId: string,
): Promise<IdempotencyRecord | null> {
  if (!key) return null;
  if (key.length < 8 || key.length > 128) {
    throw new AgentError("VALIDATION_ERROR", "Idempotency-Key must be 8–128 characters.", { request_id: requestId });
  }
  try {
    const row = await env.DB.prepare(
      "SELECT key, body_hash, status, response, billing, created_at FROM idempotency WHERE key = ?",
    ).bind(key).first<{
      key: string;
      body_hash: string;
      status: string;
      response: string | null;
      billing: string | null;
      created_at: string;
    }>();
    if (!row) return null;
    if (Date.now() - Date.parse(row.created_at) > IDEMPOTENCY_TTL_MS) {
      await env.DB.prepare("DELETE FROM idempotency WHERE key = ?").bind(key).run();
      return null;
    }
    if (row.body_hash !== bodyHash) {
      throw new AgentError("IDEMPOTENCY_CONFLICT", "Idempotency-Key reused with a different body.", {
        request_id: requestId,
        details: { key },
      });
    }
    return {
      key: row.key,
      body_hash: row.body_hash,
      status: row.status,
      response: row.response ? (JSON.parse(row.response) as ResearchResponse | Record<string, unknown>) : null,
      billing: row.billing ? (JSON.parse(row.billing) as Billing) : null,
    };
  } catch (err) {
    if (err instanceof AgentError) throw err;
    return null;
  }
}

export async function storeIdempotency(
  env: Env,
  key: string | null,
  bodyHash: string,
  response: ResearchResponse | Record<string, unknown>,
  billing: Billing,
): Promise<void> {
  if (!key) return;
  try {
    await env.DB.prepare(
      `INSERT INTO idempotency (key, body_hash, status, response, billing, created_at)
       VALUES (?, ?, 'complete', ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         status = 'complete',
         response = excluded.response,
         billing = excluded.billing`,
    )
      .bind(key, bodyHash, JSON.stringify(response), JSON.stringify(billing), isoNow())
      .run();
  } catch {
    /* non-fatal */
  }
}
