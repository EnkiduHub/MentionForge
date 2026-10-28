import { AgentError } from "../schemas/errors";
import { timingSafeEqualString } from "./crypto";
import { hashApiKey, lookupApiKeyBySession, mintApiKey, type ApiKeyRecord } from "./api-key";
import { logRequest } from "./logger";

const SIG_TOLERANCE_S = 300;

/** Statuses for which a new key may be minted. past_due stays usable until period_end. */
const KEY_ISSUABLE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due"]);

/**
 * Checkout Session ids are `cs_test_` or `cs_live_` plus an alphanumeric token.
 * Rejects empty values, non-cs_ ids, and path/query injection such as
 * `cs_x/../../../../v1/customers`.
 */
const CHECKOUT_SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]+$/;

const UNPAID_CHECKOUT_MSG = "Checkout session is not paid and complete.";
const UNPAID_CHECKOUT_HINT =
  "Finish checkout payment, then reopen this page with the same session_id. No API key was issued.";
const REFUND_OR_DISPUTE_MSG = "Checkout payment is refunded or disputed.";
const REFUND_OR_DISPUTE_HINT = "This checkout was refunded or disputed. No API key was issued.";

export async function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  nowMs = Date.now(),
): Promise<boolean> {
  if (!header || !secret) return false;
  let timestamp = "";
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === "t") timestamp = v;
    if (k === "v1") v1.push(v);
  }
  if (!timestamp || v1.length === 0) return false;
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(nowMs / 1000 - ts) > SIG_TOLERANCE_S) return false;
  const signed = `${timestamp}.${payload}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(signed));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return v1.some((sig) => sig.length === hex.length && timingSafeEqualString(sig, hex));
}

const STRIPE_UNAVAILABLE_HINT = "Stripe is temporarily unavailable. Retry in 30s with the same session_id.";

export async function stripeGet(env: Env, path: string, requestId = "stripe"): Promise<unknown> {
  const secret = env.STRIPE_SECRET_KEY ?? "";
  if (!secret) {
    throw new AgentError("PAYMENT_UNAVAILABLE", "Stripe is not configured.", {
      request_id: requestId,
      hint: STRIPE_UNAVAILABLE_HINT,
    });
  }
  let res: Response;
  try {
    res = await fetch(`https://api.stripe.com${path}`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
  } catch {
    throw new AgentError("PAYMENT_UNAVAILABLE", "Stripe API request failed.", {
      request_id: requestId,
      hint: STRIPE_UNAVAILABLE_HINT,
      details: { status: 0 },
    });
  }
  if (!res.ok) {
    throw new AgentError("PAYMENT_UNAVAILABLE", "Stripe API request failed.", {
      request_id: requestId,
      hint: STRIPE_UNAVAILABLE_HINT,
      details: { status: res.status },
    });
  }
  return res.json();
}

function isStripeResourceMissing(err: unknown): boolean {
  return (
    err instanceof AgentError &&
    err.code === "PAYMENT_UNAVAILABLE" &&
    err.details.status === 404
  );
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function sessionPriceIds(session: Record<string, unknown>): string[] {
  const ids: string[] = [];
  const addPrice = (p: unknown) => {
    if (typeof p === "string" && p) ids.push(p);
    else if (p && typeof p === "object") {
      const id = (p as { id?: unknown }).id;
      if (typeof id === "string") ids.push(id);
    }
  };
  const items = asRecord(session.line_items).data;
  if (Array.isArray(items)) {
    for (const item of items) {
      const rec = asRecord(item);
      addPrice(rec.price);
    }
  }
  const display = session.display_items;
  if (Array.isArray(display)) {
    for (const item of display) {
      const rec = asRecord(item);
      addPrice(asRecord(rec.price).id);
      addPrice(rec.price);
    }
  }
  return ids;
}

function subscriptionPriceIds(sub: Record<string, unknown>): string[] {
  const ids: string[] = [];
  const addPrice = (p: unknown) => {
    if (typeof p === "string" && p) ids.push(p);
    else if (p && typeof p === "object") {
      const id = (p as { id?: unknown }).id;
      if (typeof id === "string" && id) ids.push(id);
    }
  };
  const items = asRecord(sub.items).data;
  if (Array.isArray(items)) {
    for (const item of items) {
      const rec = asRecord(item);
      addPrice(rec.price);
      addPrice(rec.plan);
    }
  }
  addPrice(sub.plan);
  return ids;
}

export function periodFromSubscription(sub: Record<string, unknown>): { start: number; end: number } {
  const items = asRecord(sub.items).data;
  const first = Array.isArray(items) ? asRecord(items[0]) : {};
  const start = Number(sub.current_period_start ?? first.current_period_start ?? 0);
  const end = Number(sub.current_period_end ?? first.current_period_end ?? 0);
  return { start, end };
}

async function eventAlreadyHandled(env: Env, eventId: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT event_id FROM stripe_events WHERE event_id = ?")
    .bind(eventId)
    .first<{ event_id: string }>();
  return Boolean(row);
}

async function recordEvent(env: Env, eventId: string): Promise<boolean> {
  const res = await env.DB.prepare(
    `INSERT INTO stripe_events (event_id, received_at) VALUES (?, ?)
     ON CONFLICT(event_id) DO NOTHING`,
  )
    .bind(eventId, Math.floor(Date.now() / 1000))
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

async function upsertKeyFromSubscription(
  env: Env,
  opts: {
    customerId: string;
    subscriptionId: string;
    status: string;
    periodStart: number;
    periodEnd: number;
    checkoutSessionId?: string;
    pendingKey?: string | null;
  },
): Promise<void> {
  const existing = await env.DB.prepare("SELECT key_hash FROM api_keys WHERE stripe_subscription_id = ?")
    .bind(opts.subscriptionId)
    .first<{ key_hash: string }>();
  if (existing) {
    await env.DB.prepare(
      `UPDATE api_keys SET status = ?, period_start = ?, period_end = ?, stripe_customer_id = ?, checkout_session_id = COALESCE(checkout_session_id, ?)
       WHERE stripe_subscription_id = ?`,
    )
      .bind(
        opts.status,
        opts.periodStart,
        opts.periodEnd,
        opts.customerId,
        opts.checkoutSessionId ?? null,
        opts.subscriptionId,
      )
      .run();
    return;
  }
  const plaintext = opts.pendingKey ?? mintApiKey();
  const keyHash = await hashApiKey(plaintext);
  await env.DB.prepare(
    `INSERT INTO api_keys (
       key_hash, stripe_customer_id, stripe_subscription_id, status, period_start, period_end,
       created_at, checkout_session_id, claimed, pending_key
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  )
    .bind(
      keyHash,
      opts.customerId,
      opts.subscriptionId,
      opts.status,
      opts.periodStart,
      opts.periodEnd,
      Math.floor(Date.now() / 1000),
      opts.checkoutSessionId ?? null,
      plaintext,
    )
    .run();
}

async function loadSubscription(env: Env, id: string, requestId = "stripe"): Promise<Record<string, unknown>> {
  const sub = await stripeGet(env, `/v1/subscriptions/${encodeURIComponent(id)}`, requestId);
  return asRecord(sub);
}

export async function handleStripeEvent(env: Env, event: Record<string, unknown>, requestId: string): Promise<void> {
  const id = String(event.id ?? "");
  if (!id) return;
  if (await eventAlreadyHandled(env, id)) return;
  await applyStripeEvent(env, event, requestId);
  await recordEvent(env, id);
}

async function applyStripeEvent(env: Env, event: Record<string, unknown>, requestId: string): Promise<void> {
  const type = String(event.type ?? "");
  const obj = asRecord(event.data).object as Record<string, unknown> | undefined;
  const data = asRecord(obj);

  if (type === "checkout.session.completed" || type === "checkout.session.async_payment_succeeded") {
    if (data.mode !== "subscription") return;
    // checkout.session.completed can fire while payment_status is still "unpaid"
    // (delayed notification methods). Issue only after the session is paid.
    if (data.payment_status !== "paid") return;
    const priceId = env.STRIPE_KEY_PRICE_ID ?? "";
    let prices = sessionPriceIds(data);
    if (prices.length === 0 && typeof data.id === "string") {
      try {
        const expanded = asRecord(
          await stripeGet(env, `/v1/checkout/sessions/${encodeURIComponent(data.id)}?expand[]=line_items`),
        );
        prices = sessionPriceIds(expanded);
      } catch {
        logRequest({ msg: "stripe_session_expand_failed", request_id: requestId });
        return;
      }
    }
    if (!priceId || !prices.includes(priceId)) return;
    const subId = typeof data.subscription === "string" ? data.subscription : String(asRecord(data.subscription).id ?? "");
    const customerId = typeof data.customer === "string" ? data.customer : String(asRecord(data.customer).id ?? "");
    if (!subId || !customerId) return;
    let status = "";
    let periodStart = Math.floor(Date.now() / 1000);
    let periodEnd = periodStart + 30 * 86400;
    let loadedSub: Record<string, unknown> | null = null;
    try {
      const sub = await loadSubscription(env, subId, requestId);
      loadedSub = sub;
      status = String(sub.status ?? "");
      const period = periodFromSubscription(sub);
      if (period.start) periodStart = period.start;
      if (period.end) periodEnd = period.end;
    } catch (err) {
      // Do not mint with a default "active" status, and do not ack the event.
      // Stripe retries 5xx; the event id is recorded only after apply returns.
      logRequest({ msg: "stripe_subscription_load_failed", request_id: requestId });
      throw err;
    }
    if (!KEY_ISSUABLE_SUBSCRIPTION_STATUSES.has(status)) return;
    try {
      if (loadedSub && (await refundOrDisputeBlocks(env, loadedSub, requestId))) return;
      if (await refundOrDisputeBlocks(env, data, requestId)) return;
    } catch (err) {
      logRequest({ msg: "stripe_refund_check_failed", request_id: requestId });
      throw err;
    }
    await upsertKeyFromSubscription(env, {
      customerId,
      subscriptionId: subId,
      status,
      periodStart,
      periodEnd,
      checkoutSessionId: typeof data.id === "string" ? data.id : undefined,
    });
    return;
  }

  if (type === "customer.subscription.updated" || type === "invoice.paid") {
    const subId =
      type === "invoice.paid"
        ? typeof data.subscription === "string"
          ? data.subscription
          : String(
              asRecord(data.subscription).id ??
                asRecord(asRecord(data.parent).subscription_details).subscription ??
                "",
            )
        : typeof data.id === "string"
          ? data.id
          : "";
    if (!subId) return;
    let sub = data;
    if (type === "invoice.paid") {
      try {
        sub = await loadSubscription(env, subId, requestId);
      } catch {
        return;
      }
    }
    const customerId = typeof sub.customer === "string" ? sub.customer : String(asRecord(sub.customer).id ?? "");
    const period = periodFromSubscription(sub);
    const status = String(sub.status ?? "");
    if (!customerId || !period.start || !period.end) return;
    const existing = await env.DB.prepare("SELECT key_hash FROM api_keys WHERE stripe_subscription_id = ?")
      .bind(subId)
      .first<{ key_hash: string }>();
    const prices = subscriptionPriceIds(sub);
    const priceId = env.STRIPE_KEY_PRICE_ID ?? "";
    // Updates to an existing row still apply. A new key requires the Key price and an issuable status.
    if (!existing && (!priceId || !prices.includes(priceId) || !KEY_ISSUABLE_SUBSCRIPTION_STATUSES.has(status))) {
      return;
    }
    await upsertKeyFromSubscription(env, {
      customerId,
      subscriptionId: subId,
      status,
      periodStart: period.start,
      periodEnd: period.end,
    });
    return;
  }

  if (type === "customer.subscription.deleted") {
    const subId = typeof data.id === "string" ? data.id : "";
    if (!subId) return;
    await env.DB.prepare("UPDATE api_keys SET status = ? WHERE stripe_subscription_id = ?")
      .bind("canceled", subId)
      .run();
  }
}

export const KEY_ALREADY_CLAIMED_MSG =
  "This key was already shown. If you lost it, see /support to have it reissued.";

function chargeLikeBlocked(obj: Record<string, unknown>): boolean {
  if (obj.refunded === true || obj.disputed === true) return true;
  const amountRefunded = Number(obj.amount_refunded ?? 0);
  if (Number.isFinite(amountRefunded) && amountRefunded > 0) return true;
  const dispute = obj.dispute;
  if (typeof dispute === "string" && dispute.length > 0) return true;
  if (dispute && typeof dispute === "object") return true;
  return false;
}

function nestedMoneyBlocked(root: Record<string, unknown>): boolean {
  if (chargeLikeBlocked(root)) return true;
  const charge = root.charge ?? root.latest_charge;
  if (charge && typeof charge === "object" && chargeLikeBlocked(asRecord(charge))) return true;
  const paymentIntent = root.payment_intent;
  if (paymentIntent && typeof paymentIntent === "object") {
    const intent = asRecord(paymentIntent);
    if (chargeLikeBlocked(intent)) return true;
    const latest = intent.latest_charge;
    if (latest && typeof latest === "object" && chargeLikeBlocked(asRecord(latest))) return true;
    const charges = asRecord(intent.charges).data;
    if (Array.isArray(charges)) {
      for (const item of charges) {
        if (chargeLikeBlocked(asRecord(item))) return true;
      }
    }
  }
  const invoice = root.invoice ?? root.latest_invoice;
  if (invoice && typeof invoice === "object" && nestedMoneyBlocked(asRecord(invoice))) return true;
  return false;
}

/** True when a session or subscription we already fetched shows a refund or dispute.
 * String invoice / payment_intent / charge ids are loaded. Missing ids are not guessed. */
async function refundOrDisputeBlocks(
  env: Env,
  root: Record<string, unknown>,
  requestId: string,
): Promise<boolean> {
  if (nestedMoneyBlocked(root)) return true;
  const invoice = root.invoice ?? root.latest_invoice;
  if (typeof invoice === "string" && invoice) {
    const loaded = asRecord(
      await stripeGet(env, `/v1/invoices/${encodeURIComponent(invoice)}?expand[]=charge&expand[]=payment_intent`, requestId),
    );
    if (nestedMoneyBlocked(loaded)) return true;
    const charge = loaded.charge;
    if (
      typeof charge === "string" &&
      charge &&
      chargeLikeBlocked(asRecord(await stripeGet(env, `/v1/charges/${encodeURIComponent(charge)}`, requestId)))
    ) {
      return true;
    }
  }
  const paymentIntent = root.payment_intent;
  if (typeof paymentIntent === "string" && paymentIntent) {
    const loaded = asRecord(
      await stripeGet(
        env,
        `/v1/payment_intents/${encodeURIComponent(paymentIntent)}?expand[]=latest_charge`,
        requestId,
      ),
    );
    if (nestedMoneyBlocked(loaded)) return true;
  }
  return false;
}

function unpaidCheckoutError(requestId: string): AgentError {
  return new AgentError("PAYMENT_REQUIRED", UNPAID_CHECKOUT_MSG, {
    request_id: requestId,
    hint: UNPAID_CHECKOUT_HINT,
  });
}

function refundOrDisputeError(requestId: string): AgentError {
  return new AgentError("PAYMENT_REQUIRED", REFUND_OR_DISPUTE_MSG, {
    request_id: requestId,
    hint: REFUND_OR_DISPUTE_HINT,
  });
}

async function selfHealKeyFromSession(
  env: Env,
  session: Record<string, unknown>,
  sessionId: string,
  requestId: string,
): Promise<boolean> {
  if (session.mode !== "subscription") return false;
  const priceId = env.STRIPE_KEY_PRICE_ID ?? "";
  if (!priceId) return false;

  const subId =
    typeof session.subscription === "string" ? session.subscription : String(asRecord(session.subscription).id ?? "");
  let customerId =
    typeof session.customer === "string" ? session.customer : String(asRecord(session.customer).id ?? "");
  if (!subId) return false;

  let prices = sessionPriceIds(session);
  if (prices.length === 0) {
    try {
      const expanded = asRecord(
        await stripeGet(env, `/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=line_items`, requestId),
      );
      prices = sessionPriceIds(expanded);
    } catch {
      logRequest({ msg: "stripe_claim_session_expand_failed", request_id: requestId });
    }
  }

  let sub: Record<string, unknown>;
  try {
    sub = await loadSubscription(env, subId, requestId);
  } catch {
    logRequest({ msg: "stripe_claim_sub_load_failed", request_id: requestId });
    if (!prices.includes(priceId)) return false;
    // This path used to ignore the failure and mint status "active". Claim refuses
    // with 402 and inserts nothing. A 5xx/network error on the Checkout Session
    // request itself still surfaces as 503 before self-heal.
    throw unpaidCheckoutError(requestId);
  }

  for (const p of subscriptionPriceIds(sub)) {
    if (!prices.includes(p)) prices.push(p);
  }
  if (!prices.includes(priceId)) return false;

  if (await refundOrDisputeBlocks(env, sub, requestId)) return true;
  if (await refundOrDisputeBlocks(env, session, requestId)) return true;

  if (!customerId) {
    customerId = typeof sub.customer === "string" ? sub.customer : String(asRecord(sub.customer).id ?? "");
  }
  if (!customerId) return false;

  const status = String(sub.status ?? "");
  if (!KEY_ISSUABLE_SUBSCRIPTION_STATUSES.has(status)) {
    throw unpaidCheckoutError(requestId);
  }
  const period = periodFromSubscription(sub);
  const now = Math.floor(Date.now() / 1000);
  const periodStart = period.start || now;
  const periodEnd = period.end || periodStart + 30 * 86400;

  await upsertKeyFromSubscription(env, {
    customerId,
    subscriptionId: subId,
    status,
    periodStart,
    periodEnd,
    checkoutSessionId: sessionId,
  });
  return false;
}

async function assertStoredSubscriptionAllowsReveal(env: Env, subId: string, requestId: string): Promise<void> {
  try {
    const sub = await loadSubscription(env, subId, requestId);
    if (await refundOrDisputeBlocks(env, sub, requestId)) throw refundOrDisputeError(requestId);
  } catch (err) {
    if (isStripeResourceMissing(err)) return;
    throw err;
  }
}

async function resolveClaimableKey(env: Env, sessionId: string, requestId: string): Promise<ApiKeyRecord> {
  if (!CHECKOUT_SESSION_ID.test(sessionId)) {
    throw new AgentError("KEY_SESSION_NOT_FOUND", "No checkout session found for this id.", {
      request_id: requestId,
    });
  }
  let session: Record<string, unknown>;
  try {
    session = asRecord(await stripeGet(env, `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, requestId));
  } catch (err) {
    if (isStripeResourceMissing(err)) {
      throw new AgentError("KEY_SESSION_NOT_FOUND", "No checkout session found for this id.", {
        request_id: requestId,
      });
    }
    throw err;
  }
  if (session.payment_status !== "paid" || session.status !== "complete") {
    throw unpaidCheckoutError(requestId);
  }
  if (await refundOrDisputeBlocks(env, session, requestId)) {
    throw refundOrDisputeError(requestId);
  }
  const subId =
    typeof session.subscription === "string" ? session.subscription : String(asRecord(session.subscription).id ?? "");
  let row = await lookupApiKeyBySession(env, sessionId);
  if (!row) {
    const blocked = await selfHealKeyFromSession(env, session, sessionId, requestId);
    if (blocked) throw refundOrDisputeError(requestId);
    row = await lookupApiKeyBySession(env, sessionId);
  } else if (subId) {
    // A key stored before the refund must not be shown. A missing subscription
    // (404) leaves the session-level check as the decision; Stripe 5xx still throws.
    await assertStoredSubscriptionAllowsReveal(env, subId, requestId);
  }
  if (!row) {
    throw new AgentError("NOT_FOUND", "No API key for this checkout session.", { request_id: requestId });
  }
  if (subId && row.stripe_subscription_id !== subId) {
    throw new AgentError("UNAUTHORIZED", "Checkout session does not match this subscription.", {
      request_id: requestId,
    });
  }
  if (row.claimed || !row.pending_key) {
    throw new AgentError("KEY_ALREADY_CLAIMED", KEY_ALREADY_CLAIMED_MSG, {
      request_id: requestId,
      hint: KEY_ALREADY_CLAIMED_MSG,
    });
  }
  return row;
}

export async function previewKeyClaim(
  env: Env,
  sessionId: string,
  requestId: string,
): Promise<{ plan: "key"; session_id: string; claimed: false }> {
  await resolveClaimableKey(env, sessionId, requestId);
  return { plan: "key", session_id: sessionId, claimed: false };
}

export async function claimKey(env: Env, sessionId: string, requestId: string): Promise<{ key: string; plan: "key" }> {
  const row = await resolveClaimableKey(env, sessionId, requestId);
  const plaintext = row.pending_key;
  if (!plaintext) {
    throw new AgentError("KEY_ALREADY_CLAIMED", KEY_ALREADY_CLAIMED_MSG, {
      request_id: requestId,
      hint: KEY_ALREADY_CLAIMED_MSG,
    });
  }
  const res = await env.DB.prepare("UPDATE api_keys SET claimed = 1, pending_key = NULL WHERE key_hash = ? AND claimed = 0")
    .bind(row.key_hash)
    .run();
  if ((res.meta?.changes ?? 0) === 0) {
    throw new AgentError("KEY_ALREADY_CLAIMED", KEY_ALREADY_CLAIMED_MSG, {
      request_id: requestId,
      hint: KEY_ALREADY_CLAIMED_MSG,
    });
  }
  return { key: plaintext, plan: "key" };
}

export const PORTAL_RETURN_URL = "https://mentionforge.mentionforge.workers.dev/support";

export async function createBillingPortalSession(
  env: Env,
  customerId: string,
  requestId: string,
): Promise<{ url: string }> {
  const secret = env.STRIPE_SECRET_KEY ?? "";
  if (!secret || !customerId) {
    throw new AgentError("PORTAL_UNAVAILABLE", "Stripe Billing Portal is not configured.", {
      request_id: requestId,
      hint: "Contact /support to manage or cancel your subscription.",
    });
  }
  const body = new URLSearchParams({
    customer: customerId,
    return_url: PORTAL_RETURN_URL,
  }).toString();
  let res: Response;
  try {
    res = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
  } catch {
    throw new AgentError("PORTAL_UNAVAILABLE", "Stripe Billing Portal request failed.", {
      request_id: requestId,
      hint: "Contact /support to manage or cancel your subscription.",
      details: { status: 0, support_url: "/support" },
    });
  }
  if (!res.ok) {
    throw new AgentError(
      "PORTAL_UNAVAILABLE",
      "Stripe Billing Portal is not configured or temporarily unavailable.",
      {
        request_id: requestId,
        hint: "Contact /support to manage or cancel your subscription.",
        details: { status: res.status, support_url: "/support" },
      },
    );
  }
  const payload = asRecord(await res.json());
  const url = typeof payload.url === "string" ? payload.url : "";
  if (!url) {
    throw new AgentError("PORTAL_UNAVAILABLE", "Stripe Billing Portal did not return a session URL.", {
      request_id: requestId,
      hint: "Contact /support to manage or cancel your subscription.",
      details: { support_url: "/support" },
    });
  }
  return { url };
}

export type { ApiKeyRecord };
