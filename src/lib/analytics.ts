import { logRequest } from "./logger";
import { isoNow } from "./crypto";

export async function bumpStats(
  env: Env,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  row: { paid: boolean; trial: boolean; error: boolean; usdcMicros: number; queryHash?: string },
): Promise<void> {
  ctx.waitUntil(writeStats(env, row));
}

async function writeStats(
  env: Env,
  row: { paid: boolean; trial: boolean; error: boolean; usdcMicros: number; queryHash?: string },
): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  try {
    await env.DB.prepare(
      `INSERT INTO stats_daily (day, calls, paid, usdc_micros, errors, trial)
       VALUES (?, 1, ?, ?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET
         calls = calls + 1,
         paid = paid + excluded.paid,
         usdc_micros = usdc_micros + excluded.usdc_micros,
         errors = errors + excluded.errors,
         trial = trial + excluded.trial`,
    )
      .bind(day, row.paid ? 1 : 0, row.usdcMicros, row.error ? 1 : 0, row.trial ? 1 : 0)
      .run();
  } catch (err) {
    logRequest({ msg: "stats_d1_fail", err: String(err) });
  }
  try {
    env.METRICS?.writeDataPoint({
      blobs: [row.paid ? "paid" : row.trial ? "trial" : row.error ? "error" : "other", day, row.queryHash ?? ""],
      doubles: [1, row.usdcMicros],
      indexes: ["mentionforge"],
    });
  } catch {
    /* AE optional */
  }
}

export async function publicCallCount(env: Env): Promise<number> {
  try {
    const r = await env.DB.prepare("SELECT COALESCE(SUM(calls), 0) AS n FROM stats_daily").first<{ n: number }>();
    return Number(r?.n ?? 0);
  } catch {
    return 0;
  }
}

export async function operatorStats(env: Env) {
  try {
    const rows = await env.DB.prepare(
      "SELECT day, calls, paid, usdc_micros, errors, trial FROM stats_daily ORDER BY day DESC LIMIT 30",
    ).all<{
      day: string;
      calls: number;
      paid: number;
      usdc_micros: number;
      errors: number;
      trial: number;
    }>();
    const totals = (rows.results ?? []).reduce(
      (a, r) => ({
        calls: a.calls + r.calls,
        paid: a.paid + r.paid,
        usdc_micros: a.usdc_micros + r.usdc_micros,
        errors: a.errors + r.errors,
        trial: a.trial + r.trial,
      }),
      { calls: 0, paid: 0, usdc_micros: 0, errors: 0, trial: 0 },
    );
    return { as_of: isoNow(), totals, days: rows.results ?? [] };
  } catch {
    return { as_of: isoNow(), totals: { calls: 0, paid: 0, usdc_micros: 0, errors: 0, trial: 0 }, days: [] };
  }
}
