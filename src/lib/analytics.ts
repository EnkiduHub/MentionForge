import { logRequest } from "./logger";
import { isoNow } from "./crypto";

type StatsBump = { paid: boolean; trial: boolean; error: boolean; usdcMicros: number; queryHash?: string };

export type PublicUsage = { calls: number; paid: number; trial: number };

export async function bumpStats(
  env: Env,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  row: StatsBump,
): Promise<void> {
  ctx.waitUntil(writeStats(env, row));
}

async function writeStats(env: Env, row: StatsBump): Promise<void> {
  // One completion per successful persist (paid or trial). Error-only bumps must not inflate `calls`.
  const callInc = row.paid || row.trial ? 1 : 0;
  const errorInc = row.error ? 1 : 0;
  if (callInc === 0 && errorInc === 0 && row.usdcMicros === 0) return;

  const day = new Date().toISOString().slice(0, 10);
  try {
    await env.DB.prepare(
      `INSERT INTO stats_daily (day, calls, paid, usdc_micros, errors, trial)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET
         calls = calls + excluded.calls,
         paid = paid + excluded.paid,
         usdc_micros = usdc_micros + excluded.usdc_micros,
         errors = errors + excluded.errors,
         trial = trial + excluded.trial`,
    )
      .bind(day, callInc, row.paid ? 1 : 0, row.usdcMicros, errorInc, row.trial ? 1 : 0)
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

/** Successful product usage. `calls` is paid + trial, not the raw `stats_daily.calls` counter. */
export async function publicUsage(env: Env): Promise<PublicUsage> {
  try {
    const r = await env.DB.prepare(
      "SELECT COALESCE(SUM(paid), 0) AS paid, COALESCE(SUM(trial), 0) AS trial FROM stats_daily",
    ).first<{ paid: number; trial: number }>();
    const paid = Number(r?.paid ?? 0);
    const trial = Number(r?.trial ?? 0);
    return { calls: paid + trial, paid, trial };
  } catch {
    return { calls: 0, paid: 0, trial: 0 };
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
