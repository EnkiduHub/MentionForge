/** Test-mode Stripe gate (VERDICTS §8.2/§8.5). Live keys require a non-empty legal-name + street/CMRA disclosure. */

export function assertStripeKeyMode(env: {
  STRIPE_SECRET_KEY?: string;
  LEGAL_DISCLOSURE?: string;
}): void {
  const key = env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (!key) return;
  const live = /^(sk_live_|rk_live_)/.test(key);
  const disclosure = env.LEGAL_DISCLOSURE?.trim() ?? "";
  if (live && !disclosure) {
    throw new Error("STRIPE_LIVE_KEY_BLOCKED: live-prefixed keys require a non-empty LEGAL_DISCLOSURE");
  }
}
