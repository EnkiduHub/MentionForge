import { AgentError } from "../schemas/errors";
import type { ApiKeyRecord } from "./api-key";

const DEFAULT_LIMIT = 1500;

export function planKeyMonthlyCalls(env: Env): number {
  const n = Number.parseInt(env.PLAN_KEY_MONTHLY_CALLS ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LIMIT;
}

export type PlanReservation = {
  key_hash: string;
  period_start: number;
  used: number;
  limit: number;
  period_end: number;
};

export async function readPlanUsage(env: Env, keyHash: string, periodStart: number): Promise<number> {
  const row = await env.DB.prepare("SELECT calls FROM plan_usage WHERE key_hash = ? AND period_start = ?")
    .bind(keyHash, periodStart)
    .first<{ calls: number }>();
  return Number(row?.calls ?? 0);
}

/** Atomically reserve one call. 0 rows changed → PLAN_QUOTA_REACHED. Ledger errors deny. */
export async function reservePlanCall(env: Env, key: ApiKeyRecord, requestId: string): Promise<PlanReservation> {
  const limit = planKeyMonthlyCalls(env);
  try {
    const res = await env.DB.prepare(
      `INSERT INTO plan_usage (key_hash, period_start, calls) VALUES (?, ?, 1)
       ON CONFLICT(key_hash, period_start) DO UPDATE SET calls = calls + 1
       WHERE calls < ?`,
    )
      .bind(key.key_hash, key.period_start, limit)
      .run();
    if ((res.meta?.changes ?? 0) === 0) {
      const used = await readPlanUsage(env, key.key_hash, key.period_start);
      throw new AgentError("PLAN_QUOTA_REACHED", "Monthly plan quota reached. Nothing was charged.", {
        request_id: requestId,
        details: { used, limit, resets_at: key.period_end },
      });
    }
    const used = await readPlanUsage(env, key.key_hash, key.period_start);
    return {
      key_hash: key.key_hash,
      period_start: key.period_start,
      used,
      limit,
      period_end: key.period_end,
    };
  } catch (err) {
    if (err instanceof AgentError) throw err;
    throw new AgentError("QUOTA_UNAVAILABLE", "Usage ledger unavailable. Request denied; nothing was charged.", {
      request_id: requestId,
      details: { reason: "plan_quota_reserve_failed" },
    });
  }
}

export async function releasePlanCall(env: Env, reservation: PlanReservation, requestId: string): Promise<void> {
  try {
    await env.DB.prepare(
      "UPDATE plan_usage SET calls = MAX(0, calls - 1) WHERE key_hash = ? AND period_start = ?",
    )
      .bind(reservation.key_hash, reservation.period_start)
      .run();
  } catch (err) {
    throw new AgentError("QUOTA_UNAVAILABLE", "Usage ledger unavailable. Request denied; nothing was charged.", {
      request_id: requestId,
      details: { reason: "plan_quota_release_failed" },
    });
  }
}
