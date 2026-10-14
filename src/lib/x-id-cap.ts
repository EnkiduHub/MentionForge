import { AgentError } from "../schemas/errors";

const DEFAULT_CAP = 1_500_000;
const WINDOW_DAYS = 30;

let nowOverride: number | undefined;

export function setXIdUsageNow(ms: number | undefined): void {
  nowOverride = ms;
}

export function xIdUsageNow(): number {
  return nowOverride ?? Date.now();
}

export function xIdCap(env: Env): number {
  const n = Number.parseInt(env.X_ID_CAP ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CAP;
}

export function usageDayKey(ms = xIdUsageNow()): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function windowStartDay(ms = xIdUsageNow()): string {
  return new Date(ms - (WINDOW_DAYS - 1) * 86400000).toISOString().slice(0, 10);
}

/** Successful reads return the rolling sum. Query failures throw so callers can deny the request. */
export async function rollingXIdSum(env: Env, ms = xIdUsageNow()): Promise<number> {
  const row = await env.DB.prepare("SELECT COALESCE(SUM(ids), 0) AS n FROM x_id_usage WHERE day >= ?")
    .bind(windowStartDay(ms))
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export async function incrementXIdUsage(env: Env, n: number, ms = xIdUsageNow()): Promise<void> {
  if (n <= 0) return;
  await env.DB.prepare(
    "INSERT INTO x_id_usage (day, ids) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET ids = ids + excluded.ids",
  )
    .bind(usageDayKey(ms), n)
    .run();
}

/**
 * IDs disclosed by a paid response. `/v1/risk` is the `negatives` batch:
 * each id counts, including zero when the batch is empty.
 */
export function quotaUnitsForResponse(response: unknown): number {
  if (!response || typeof response !== "object") return 0;
  const rec = response as Record<string, unknown>;
  const ids = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && value) ids.add(value);
  };
  const addItem = (item: unknown) => {
    if (typeof item === "string") {
      add(item);
      return;
    }
    if (!item || typeof item !== "object") return;
    const row = item as Record<string, unknown>;
    add(row.id);
    add(row.mention_id);
  };
  if (Array.isArray(rec.negatives)) {
    for (const item of rec.negatives) addItem(item);
    return ids.size;
  }
  if (Array.isArray(rec.x_post_ids)) {
    for (const item of rec.x_post_ids) add(item);
  }
  if (Array.isArray(rec.mentions)) {
    for (const item of rec.mentions) addItem(item);
  }
  if (Array.isArray(rec.drafts)) {
    for (const item of rec.drafts) addItem(item);
  }
  if (rec.groups && typeof rec.groups === "object") {
    for (const group of Object.values(rec.groups as Record<string, unknown>)) {
      if (Array.isArray(group)) {
        for (const item of group) addItem(item);
        continue;
      }
      if (!group || typeof group !== "object") continue;
      const row = group as Record<string, unknown>;
      if (Array.isArray(row.x_post_ids)) {
        for (const item of row.x_post_ids) add(item);
      }
      if (Array.isArray(row.mentions)) {
        for (const item of row.mentions) addItem(item);
      }
    }
  }
  return ids.size;
}

/** Read the plan cap before trial consumption or x402 settle. Lookup errors deny the request. */
export async function assertQuotaAllows(env: Env, units: number, requestId: string): Promise<void> {
  if (units <= 0) return;
  let used: number;
  try {
    used = await rollingXIdSum(env);
  } catch {
    throw new AgentError("QUOTA_UNAVAILABLE", "Usage ledger unavailable. Request denied; nothing was charged.", {
      request_id: requestId,
      details: { reason: "usage_lookup_failed" },
    });
  }
  if (used + units > xIdCap(env)) {
    throw new AgentError("X_ID_CAP_REACHED", "Plan quota reached. Request denied; nothing was charged.", {
      request_id: requestId,
      details: { retry_after_days: WINDOW_DAYS, units, used },
    });
  }
}
