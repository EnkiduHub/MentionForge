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

export async function rollingXIdSum(env: Env, ms = xIdUsageNow()): Promise<number> {
  try {
    const row = await env.DB.prepare("SELECT COALESCE(SUM(ids), 0) AS n FROM x_id_usage WHERE day >= ?")
      .bind(windowStartDay(ms))
      .first<{ n: number }>();
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}

export async function incrementXIdUsage(env: Env, n: number, ms = xIdUsageNow()): Promise<void> {
  if (n <= 0) return;
  try {
    await env.DB.prepare(
      "INSERT INTO x_id_usage (day, ids) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET ids = ids + excluded.ids",
    )
      .bind(usageDayKey(ms), n)
      .run();
  } catch {
    /* D1 may be absent in some unit fixtures */
  }
}

export function retryAfterDays(ms = xIdUsageNow()): number {
  return WINDOW_DAYS;
}

export type CapDecision =
  | { ok: true; n: number }
  | { ok: false; n: number; retry_after_days: number };

export async function decideXIdCap(env: Env, n: number): Promise<CapDecision> {
  if (n <= 0) return { ok: true, n: 0 };
  const sum = await rollingXIdSum(env);
  if (sum + n > xIdCap(env)) {
    return { ok: false, n, retry_after_days: retryAfterDays() };
  }
  return { ok: true, n };
}
