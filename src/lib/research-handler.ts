import { SAMPLE_QUERY, isWallet, MAX_BODY_BYTES } from "./constants";
import { canonicalJson, sha256Hex } from "./crypto";
import { parseResearchInput, type ResearchRequest, type ResearchResponse } from "../schemas/research";
import { consumeTrial, sandboxOk } from "./trial";
import { lookupIdempotency, storeIdempotency } from "./idempotency";
import { limitOrThrow } from "./rate-limit";
import { overlayBilling, runResearch } from "./research/engine";
import { projectResearch } from "./research/project";
import { nextQueries } from "./next-queries";
import {
  bazaarSurfaceForPath,
  buildPaymentRequired,
  encodeHeader,
  extractPayer,
  paymentConfig,
  paymentHint,
  paymentResponseHeader,
  paymentsReady,
  settlePayment,
  verifyPayment,
  type BazaarSurface,
  type Billing,
} from "./x402";
import { AgentError } from "../schemas/errors";
import { bumpStats } from "./analytics";
import { PAYMENT_EXPOSE_HEADERS } from "./cors";
import { logRequest } from "./logger";

type Waiter = { waitUntil(promise: Promise<unknown>): void };

export async function runResearchPipeline(
  env: Env,
  executionCtx: Waiter,
  request: Request,
  requestId: string,
): Promise<Response> {
  const started = Date.now();
  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;
  const surface = bazaarSurfaceForPath(requestUrl.pathname);
  const sandbox = sandboxOk(env, request.headers.get("X-Sandbox-Key"));
  const paymentHeader = request.headers.get("PAYMENT-SIGNATURE") ?? request.headers.get("X-PAYMENT");
  const trialWallet = request.headers.get("X-Wallet") ?? undefined;
  const payer = extractPayer(paymentHeader);
  const ip = request.headers.get("cf-connecting-ip") ?? "anon";
  const paidKey = sandbox ? "sandbox" : isWallet(payer) ? payer.toLowerCase() : ip;

  // Rate-limit from headers before reading the body (unpaid 402 floods).
  if (sandbox || paymentHeader) {
    await limitOrThrow(env.PAID_LIMIT, paidKey, requestId);
  } else if (isWallet(trialWallet)) {
    await limitOrThrow(env.TRIAL_LIMIT, trialWallet.toLowerCase(), requestId);
  } else {
    await limitOrThrow(env.UNPAID_LIMIT, ip, requestId, 30);
  }

  // CDP Bazaar probes GET/empty POST without payment. Body validation 400 before 402 blocks indexing.
  if (!sandbox && !paymentHeader && !isWallet(trialWallet)) {
    if (!paymentsReady(env)) {
      throw new AgentError("PAYMENT_UNAVAILABLE", "Set RECIPIENT_WALLET to a real Base address before charging.", {
        request_id: requestId,
      });
    }
    const doc = buildPaymentRequired(env, origin);
    throw new AgentError("PAYMENT_REQUIRED", "Payment required for research.", {
      request_id: requestId,
      hint: paymentHint(env, origin),
      details: { payment: doc },
    });
  }

  const req = await parseFromRequest(request, requestId);
  const bodyHash = await sha256Hex(canonicalJson(req));
  const idempKey = request.headers.get("Idempotency-Key");

  const existing = await lookupIdempotency(env, idempKey, bodyHash, requestId);
  if (existing?.response) {
    return json(existing.response, 200, {
      ...receiptHeaders(existing.billing, env),
      "X-Request-Id": requestId,
    });
  }

  let billing: Billing;
  let paymentPayload: unknown = null;

  if (sandbox) {
    billing = { amount_usdc: "0", tx_hash: null, free_trial: true };
  } else {
    let trial = false;
    // Trial is only X-Wallet (or sandbox above). Never infer trial from PAYMENT-SIGNATURE `from`.
    if (isWallet(trialWallet)) {
      try {
        trial = await consumeTrial(env, trialWallet, requestId);
      } catch (err) {
        if (!paymentHeader) throw err;
      }
    }
    if (trial) {
      billing = { amount_usdc: "0", tx_hash: null, free_trial: true };
    } else if (!paymentHeader) {
      if (!paymentsReady(env)) {
        throw new AgentError("PAYMENT_UNAVAILABLE", "Set RECIPIENT_WALLET to a real Base address before charging.", {
          request_id: requestId,
        });
      }
      const doc = buildPaymentRequired(env, origin, "PAYMENT-SIGNATURE header is required", surface);
      throw new AgentError("PAYMENT_REQUIRED", "Payment required for research.", {
        request_id: requestId,
        hint: paymentHint(env, origin),
        details: { payment: doc },
      });
    } else {
      if (!paymentsReady(env)) {
        throw new AgentError("PAYMENT_UNAVAILABLE", "Payments are not configured.", { request_id: requestId });
      }
      paymentPayload = await verifyPayment(env, origin, paymentHeader, requestId);
      billing = { amount_usdc: paymentConfig(env).price, tx_hash: null, free_trial: false };
    }
  }

  const { body: research, freshness } = await runResearch(env, req, requestId, executionCtx);

  if (paymentPayload) {
    const settled = await settlePayment(env, origin, paymentPayload, requestId, surface);
    billing = { ...billing, tx_hash: settled.txHash };
  }

  try {
    const response = await persistResearch(env, executionCtx, req, requestId, started, research, freshness, billing, idempKey, bodyHash);
    return json(response, 200, {
      ...receiptHeaders(billing, env),
      "X-Request-Id": requestId,
    });
  } catch (err) {
    // Settlement already happened. Never convert that into a 5xx that looks like "try a new payment".
    logRequest({ msg: "persist_after_settle_fail", err: String(err), request_id: requestId });
    const response = projectResearch(
      overlayBilling(
        research,
        {
          request_id: requestId,
          latency_ms: Date.now() - started,
          sources_used: research.meta.sources_used,
          billing,
          next_queries: nextQueries(req),
          as_of: research.meta.as_of,
          confidence: research.meta.confidence,
          degraded: research.meta.degraded,
        },
        freshness,
      ),
      req,
    );
    return json(response, 200, {
      ...receiptHeaders(billing, env),
      "X-Request-Id": requestId,
    });
  }
}

export async function persistResearch(
  env: Env,
  executionCtx: Waiter,
  req: ResearchRequest,
  requestId: string,
  started: number,
  research: Awaited<ReturnType<typeof runResearch>>["body"],
  freshness: "live" | "cached",
  billing: Billing,
  idempKey: string | null,
  bodyHash: string,
  project?: (
    full: ResearchResponse,
  ) => ResearchResponse | Record<string, unknown> | Promise<ResearchResponse | Record<string, unknown>>,
): Promise<ResearchResponse | Record<string, unknown>> {
  const billed = overlayBilling(
    research,
    {
      request_id: requestId,
      latency_ms: Date.now() - started,
      sources_used: research.meta.sources_used,
      billing,
      next_queries: nextQueries(req),
      as_of: research.meta.as_of,
      confidence: research.meta.confidence,
      degraded: research.meta.degraded,
    },
    freshness,
  );
  const overlaid = projectResearch(billed, req);
  const response = project ? await project(overlaid) : overlaid;

  await storeIdempotency(env, idempKey, bodyHash, response, billing);
  const queryHash = await sha256Hex(req.query.normalize("NFC").trim().toLowerCase());
  await bumpStats(env, executionCtx, {
    paid: !billing.free_trial,
    trial: billing.free_trial,
    error: false,
    usdcMicros: billing.free_trial ? 0 : Number.parseInt(paymentConfig(env).amount, 10),
    queryHash,
  });
  return response;
}

export async function executeUnpaidOrPreVerified(
  env: Env,
  executionCtx: Waiter,
  req: ResearchRequest,
  requestId: string,
  billing: Billing,
  idempKey: string | null,
  bodyHash: string,
  project?: (
    full: ResearchResponse,
  ) => ResearchResponse | Record<string, unknown> | Promise<ResearchResponse | Record<string, unknown>>,
): Promise<ResearchResponse | Record<string, unknown>> {
  const started = Date.now();
  const existing = await lookupIdempotency(env, idempKey, bodyHash, requestId);
  if (existing?.response) return existing.response;
  const { body: research, freshness } = await runResearch(env, req, requestId, executionCtx);
  return persistResearch(env, executionCtx, req, requestId, started, research, freshness, billing, idempKey, bodyHash, project);
}

export function paymentRequiredHttp(
  env: Env,
  origin: string,
  err: AgentError,
  surface: BazaarSurface = "http",
): Response {
  const doc = buildPaymentRequired(env, origin, err.message, surface);
  return json(
    { ...err.body(), payment: doc },
    402,
    {
      "PAYMENT-REQUIRED": encodeHeader(doc),
      "X-Request-Id": err.request_id,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": PAYMENT_EXPOSE_HEADERS.join(", "),
      "Access-Control-Max-Age": "86400",
    },
  );
}

async function parseFromRequest(request: Request, requestId: string): Promise<ResearchRequest> {
  if (request.method === "GET") {
    const u = new URL(request.url);
    const from = u.searchParams.get("from");
    const to = u.searchParams.get("to");
    const platforms = u.searchParams.get("platforms");
    try {
      return parseResearchInput({
        query: u.searchParams.get("query") ?? "",
        platforms: platforms ? platforms.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
        timeframe: from && to ? { from, to } : u.searchParams.get("timeframe") ?? "7d",
        limit: u.searchParams.get("limit") ? Number(u.searchParams.get("limit")) : undefined,
        include_summary:
          u.searchParams.get("include_summary") === null
            ? undefined
            : u.searchParams.get("include_summary") === "true",
        min_engagement: u.searchParams.get("min_engagement")
          ? Number(u.searchParams.get("min_engagement"))
          : undefined,
        language: u.searchParams.get("language") ?? undefined,
        view: (u.searchParams.get("view") as "full" | "compact" | null) ?? undefined,
        focus: u.searchParams.get("focus") ?? undefined,
        include_markdown:
          u.searchParams.get("include_markdown") === null
            ? undefined
            : u.searchParams.get("include_markdown") === "true",
      });
    } catch (err) {
      throw zodErr(err, requestId);
    }
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    throw new AgentError("PAYLOAD_TOO_LARGE", "Body exceeds 8KB.", { request_id: requestId });
  }
  let buf: ArrayBuffer;
  try {
    buf = await request.arrayBuffer();
  } catch {
    throw new AgentError("VALIDATION_ERROR", "Body must be JSON.", { request_id: requestId });
  }
  if (buf.byteLength > MAX_BODY_BYTES) {
    throw new AgentError("PAYLOAD_TOO_LARGE", "Body exceeds 8KB.", { request_id: requestId });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    throw new AgentError("VALIDATION_ERROR", "Body must be JSON.", { request_id: requestId });
  }
  try {
    return parseResearchInput(raw);
  } catch (err) {
    throw zodErr(err, requestId);
  }
}

function zodErr(err: unknown, requestId: string): AgentError {
  const issues = (err as { issues?: unknown }).issues;
  return new AgentError("VALIDATION_ERROR", "Invalid research request.", {
    request_id: requestId,
    details: { issues: issues ?? String(err) },
    hint: `Example: ${JSON.stringify({ query: SAMPLE_QUERY, timeframe: "7d", limit: 20, include_summary: true })}`,
  });
}

function receiptHeaders(billing: Billing | null, env: Env): Record<string, string> {
  const h: Record<string, string> = { "Cache-Control": "no-store" };
  if (billing && !billing.free_trial) h["PAYMENT-RESPONSE"] = paymentResponseHeader(billing.tx_hash, env);
  return h;
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export async function readJsonBody(request: Request, requestId: string): Promise<unknown> {
  if (request.method !== "POST") {
    throw new AgentError("VALIDATION_ERROR", "Use POST.", {
      request_id: requestId,
      hint: "POST this path with a JSON body. GET is not supported for paid lenses.",
    });
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    throw new AgentError("PAYLOAD_TOO_LARGE", "Body exceeds 8KB.", { request_id: requestId });
  }
  let buf: ArrayBuffer;
  try {
    buf = await request.arrayBuffer();
  } catch {
    throw new AgentError("VALIDATION_ERROR", "Body must be JSON.", { request_id: requestId });
  }
  if (buf.byteLength > MAX_BODY_BYTES) {
    throw new AgentError("PAYLOAD_TOO_LARGE", "Body exceeds 8KB.", { request_id: requestId });
  }
  try {
    return JSON.parse(new TextDecoder().decode(buf)) as unknown;
  } catch {
    throw new AgentError("VALIDATION_ERROR", "Body must be JSON.", { request_id: requestId });
  }
}

export async function runLensPipeline(
  env: Env,
  executionCtx: Waiter,
  request: Request,
  requestId: string,
  opts: {
    parse: (raw: unknown) => {
      research: ResearchRequest;
      hashObject: unknown;
      project: (full: ResearchResponse) => Record<string, unknown> | Promise<Record<string, unknown>>;
    };
  },
): Promise<Response> {
  const started = Date.now();
  const origin = new URL(request.url).origin;
  const sandbox = sandboxOk(env, request.headers.get("X-Sandbox-Key"));
  const paymentHeader = request.headers.get("PAYMENT-SIGNATURE") ?? request.headers.get("X-PAYMENT");
  const trialWallet = request.headers.get("X-Wallet") ?? undefined;
  const payer = extractPayer(paymentHeader);
  const ip = request.headers.get("cf-connecting-ip") ?? "anon";
  const paidKey = sandbox ? "sandbox" : isWallet(payer) ? payer.toLowerCase() : ip;

  if (sandbox || paymentHeader) {
    await limitOrThrow(env.PAID_LIMIT, paidKey, requestId);
  } else if (isWallet(trialWallet)) {
    await limitOrThrow(env.TRIAL_LIMIT, trialWallet.toLowerCase(), requestId);
  } else {
    await limitOrThrow(env.UNPAID_LIMIT, ip, requestId, 30);
  }

  const raw = await readJsonBody(request, requestId);
  let parsed: ReturnType<typeof opts.parse>;
  try {
    parsed = opts.parse(raw);
  } catch (err) {
    if (err instanceof AgentError) throw err;
    throw zodErr(err, requestId);
  }
  const bodyHash = await sha256Hex(canonicalJson(parsed.hashObject));
  const idempKey = request.headers.get("Idempotency-Key");

  const existing = await lookupIdempotency(env, idempKey, bodyHash, requestId);
  if (existing?.response) {
    return json(existing.response, 200, {
      ...receiptHeaders(existing.billing, env),
      "X-Request-Id": requestId,
    });
  }

  let billing: Billing;
  let paymentPayload: unknown = null;

  if (sandbox) {
    billing = { amount_usdc: "0", tx_hash: null, free_trial: true };
  } else {
    let trial = false;
    if (isWallet(trialWallet)) {
      try {
        trial = await consumeTrial(env, trialWallet, requestId);
      } catch (err) {
        if (!paymentHeader) throw err;
      }
    }
    if (trial) {
      billing = { amount_usdc: "0", tx_hash: null, free_trial: true };
    } else if (!paymentHeader) {
      if (!paymentsReady(env)) {
        throw new AgentError("PAYMENT_UNAVAILABLE", "Set RECIPIENT_WALLET to a real Base address before charging.", {
          request_id: requestId,
        });
      }
      const doc = buildPaymentRequired(env, origin);
      throw new AgentError("PAYMENT_REQUIRED", "Payment required for research.", {
        request_id: requestId,
        hint: paymentHint(env, origin),
        details: { payment: doc },
      });
    } else {
      if (!paymentsReady(env)) {
        throw new AgentError("PAYMENT_UNAVAILABLE", "Payments are not configured.", { request_id: requestId });
      }
      paymentPayload = await verifyPayment(env, origin, paymentHeader, requestId);
      billing = { amount_usdc: paymentConfig(env).price, tx_hash: null, free_trial: false };
    }
  }

  const { body: research, freshness } = await runResearch(env, parsed.research, requestId, executionCtx);

  if (paymentPayload) {
    const settled = await settlePayment(env, origin, paymentPayload, requestId);
    billing = { ...billing, tx_hash: settled.txHash };
  }

  try {
    const response = await persistResearch(
      env,
      executionCtx,
      parsed.research,
      requestId,
      started,
      research,
      freshness,
      billing,
      idempKey,
      bodyHash,
      parsed.project,
    );
    return json(response, 200, {
      ...receiptHeaders(billing, env),
      "X-Request-Id": requestId,
    });
  } catch (err) {
    logRequest({ msg: "persist_after_settle_fail", err: String(err), request_id: requestId });
    const response = await parsed.project(
      projectResearch(
        overlayBilling(
          research,
          {
            request_id: requestId,
            latency_ms: Date.now() - started,
            sources_used: research.meta.sources_used,
            billing,
            next_queries: nextQueries(parsed.research),
            as_of: research.meta.as_of,
            confidence: research.meta.confidence,
            degraded: research.meta.degraded,
          },
          freshness,
        ),
        parsed.research,
      ),
    );
    return json(response, 200, {
      ...receiptHeaders(billing, env),
      "X-Request-Id": requestId,
    });
  }
}
