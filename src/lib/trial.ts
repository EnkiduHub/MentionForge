import { isWallet } from "./constants";
import { isoNow, timingSafeEqualString } from "./crypto";
import { AgentError } from "../schemas/errors";

export function sandboxOk(env: Env, header: string | null): boolean {
  const expected = env.SANDBOX_KEY ?? "";
  const got = header ?? "";
  if (!expected || !got) return false;
  return timingSafeEqualString(got, expected);
}

export function operatorOk(env: Env, header: string | null): boolean {
  const expected = env.OPERATOR_TOKEN ?? "";
  if (!expected) return false;
  const raw = header ?? "";
  const token = raw.startsWith("Bearer ") ? raw.slice(7) : raw;
  return timingSafeEqualString(token, expected);
}

export async function trialRemaining(env: Env, wallet: string | undefined): Promise<number | null> {
  if (!isWallet(wallet)) return 0;
  const cap = Number.parseInt(env.FREE_TRIAL_CALLS || "10", 10) || 10;
  try {
    const row = await env.DB.prepare("SELECT used FROM trial_wallets WHERE wallet = ?")
      .bind(wallet.toLowerCase())
      .first<{ used: number }>();
    if (!row) return cap;
    return Math.max(0, cap - Number(row.used ?? 0));
  } catch {
    return null;
  }
}

export async function consumeTrial(
  env: Env,
  wallet: string | undefined,
  requestId: string,
): Promise<boolean> {
  if (!isWallet(wallet)) return false;
  const cap = Number.parseInt(env.FREE_TRIAL_CALLS || "10", 10) || 10;
  const w = wallet.toLowerCase();
  const now = isoNow();
  try {
    await env.DB.prepare(
      `INSERT INTO trial_wallets (wallet, used, updated_at) VALUES (?, 0, ?)
       ON CONFLICT(wallet) DO NOTHING`,
    )
      .bind(w, now)
      .run();
    const res = await env.DB.prepare(
      `UPDATE trial_wallets SET used = used + 1, updated_at = ?
       WHERE wallet = ? AND used < ?`,
    )
      .bind(now, w, cap)
      .run();
    return (res.meta?.changes ?? 0) === 1;
  } catch (err) {
    throw new AgentError("PAYMENT_UNAVAILABLE", "Trial ledger unavailable; payment required.", {
      request_id: requestId,
      details: { reason: String(err) },
    });
  }
}
