import { createPaymentWrapper } from "@x402/mcp";
import { SAMPLE_QUERY } from "./constants";
import { AgentError } from "../schemas/errors";
import { canonicalJson, sha256Hex } from "./crypto";
import {
  bazaarExtension,
  decodeHeader,
  discoveryResource,
  getResourceServer,
  paymentConfig,
  paymentsReady,
} from "./x402";
import { lookupIdempotency, storeIdempotency } from "./idempotency";
import { limitOrThrow } from "./rate-limit";
import { logRequest } from "./logger";
import type { Billing } from "./x402";

export type McpToolErrorResult = {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
};

type PaidToolResult<TOut> = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: TOut;
  isError?: boolean;
};

export type PaidMcpSession =
  | {
      ok: true;
      resourceServer: ReturnType<typeof getResourceServer>;
      accepts: unknown;
    }
  | { ok: false; error: AgentError };

type ToolCtx = {
  _meta?: Record<string, unknown>;
  mcpReq?: { _meta?: Record<string, unknown> };
  http?: { req?: Request };
};

export type PaidToolSpec<TOut> = {
  /** Bazaar `{ info, schema }` only for research_mentions. */
  bazaar: boolean;
  parseForHash: (args: unknown) => unknown;
  execute: (
    args: unknown,
    requestId: string,
    bodyHash: string,
    idempKey: string | null,
    billing: Billing,
  ) => Promise<unknown>;
  parseOutput: (
    payload: unknown,
  ) => { success: true; data: TOut } | { success: false; error: { message: string; issues?: unknown } };
};

/** MCP matching throws on a non-numeric `x402Version`; REST `asPayload` already coerces this. */
function normalizeMcpPaymentPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const obj = { ...(raw as Record<string, unknown>) };
  if (typeof obj.x402Version !== "number") {
    if (obj.x402Version == null || obj.x402Version === "2" || obj.x402Version === "1") {
      obj.x402Version = obj.x402Version === "1" ? 1 : 2;
    }
  }
  return obj;
}

/** MCP SDK v2 puts request `_meta` on `ctx.mcpReq._meta`; `@x402/mcp` still reads `extra._meta`. */
export function mcpPaymentExtraFromContext(ctx: ToolCtx, request?: Request): { _meta: Record<string, unknown> } {
  const meta: Record<string, unknown> = {
    ...(ctx._meta && typeof ctx._meta === "object" ? ctx._meta : {}),
    ...(ctx.mcpReq?._meta ?? {}),
  };
  if (meta["x402/payment"] == null) {
    const req = ctx.http?.req ?? request;
    const header = req?.headers.get("PAYMENT-SIGNATURE") ?? req?.headers.get("X-PAYMENT");
    if (header) {
      try {
        meta["x402/payment"] = decodeHeader(header);
      } catch {
        /* wrapper returns payment-required */
      }
    }
  }
  if (meta["x402/payment"] != null) {
    meta["x402/payment"] = normalizeMcpPaymentPayload(meta["x402/payment"]);
  }
  return { _meta: meta };
}

function publicErr(err: unknown): string {
  return String(err)
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, "[jwt]")
    .slice(0, 240);
}

export function mcpToolError(err: unknown, requestId: string): McpToolErrorResult {
  if (err instanceof AgentError) {
    return { isError: true, content: [{ type: "text", text: JSON.stringify(err.body()) }] };
  }
  const issues = (err as { issues?: unknown }).issues;
  if (issues) {
    const agent = new AgentError("VALIDATION_ERROR", "Invalid research request.", {
      request_id: requestId,
      details: { issues },
      hint: `Example: ${JSON.stringify({ query: SAMPLE_QUERY, timeframe: "7d", limit: 20, include_summary: true })}`,
    });
    return { isError: true, content: [{ type: "text", text: JSON.stringify(agent.body()) }] };
  }
  const agent = new AgentError("INTERNAL_ERROR", "research failed", {
    request_id: requestId,
    details: { cause: "uncaught", err: publicErr(err) },
  });
  return { isError: true, content: [{ type: "text", text: JSON.stringify(agent.body()) }] };
}

export function isOpaqueIse(result: { isError?: boolean; content?: Array<{ type?: string; text?: string }> }): boolean {
  if (!result?.isError) return false;
  const text = result.content?.find((c) => c.type === "text")?.text ?? "";
  return text === "Internal Server Error";
}

function patchBillingTx(payload: unknown, tx: string): boolean {
  if (!payload || typeof payload !== "object") return false;
  const meta = (payload as { meta?: { billing?: { tx_hash?: string | null } } }).meta;
  if (!meta?.billing) return false;
  meta.billing.tx_hash = tx;
  return true;
}

/** One resource-server initialize per MCP request. Shared by every paid tool wrapper. */
export async function initPaidMcpSession(env: Env, origin: string, requestId: string): Promise<PaidMcpSession> {
  if (!paymentsReady(env)) {
    return {
      ok: false,
      error: new AgentError("PAYMENT_UNAVAILABLE", "Set RECIPIENT_WALLET to a real Base address before charging.", {
        request_id: requestId,
      }),
    };
  }
  try {
    const cfg = paymentConfig(env);
    const resourceServer = getResourceServer(env, origin);
    const fallbackAccepts = [
      {
        scheme: "exact" as const,
        network: cfg.network,
        amount: cfg.amount,
        asset: cfg.asset,
        payTo: cfg.payTo,
        maxTimeoutSeconds: 60,
        extra: cfg.extra,
      },
    ];
    try {
      await resourceServer.initialize();
    } catch {
      /* verify/settle still work via the facilitator client; extras come from fallback */
    }
    const accepts = await Promise.resolve(
      resourceServer.buildPaymentRequirements({
        scheme: "exact",
        network: cfg.network as typeof cfg.network,
        payTo: cfg.payTo,
        price: `$${cfg.price}`,
        maxTimeoutSeconds: 60,
      }),
    ).catch(() => fallbackAccepts);
    return { ok: true, resourceServer, accepts };
  } catch (err) {
    logRequest({
      msg: "mcp_paid_stage",
      stage: "init",
      request_id: requestId,
      err: String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    const agent =
      err instanceof AgentError
        ? err
        : new AgentError("PAYMENT_UNAVAILABLE", "Could not initialize x402 for research_mentions.", {
            request_id: requestId,
          });
    return { ok: false, error: agent };
  }
}

export function wrapPaidTool<TOut>(
  session: Extract<PaidMcpSession, { ok: true }>,
  env: Env,
  origin: string,
  request: Request,
  _ctx: ExecutionContext,
  spec: PaidToolSpec<TOut>,
) {
  const requestId = request.headers.get("X-Request-Id") || crypto.randomUUID();
  let lastPaid:
    | {
        payload: TOut & { meta?: { billing?: Billing } };
        result: PaidToolResult<TOut>;
        bodyHash: string;
        idempKey: string | null;
      }
    | undefined;

  const paid = createPaymentWrapper(session.resourceServer, {
    accepts: session.accepts as never,
    resource: discoveryResource(origin, "mcp"),
    extensions: (spec.bazaar ? bazaarExtension : {}) as Record<string, unknown>,
    hooks: {
      onAfterExecution: async ({ result }: { result: { isError?: boolean } }) => {
        if (result?.isError) {
          logRequest({ msg: "mcp_paid_skip_settle", request_id: requestId });
        }
      },
      onAfterSettlement: async ({ settlement }: { settlement?: { transaction?: string } }) => {
        try {
          const tx = settlement?.transaction;
          if (!lastPaid || !tx) return;
          if (!patchBillingTx(lastPaid.payload, tx)) return;
          lastPaid.result.content[0]!.text = JSON.stringify(lastPaid.payload);
          await storeIdempotency(
            env,
            lastPaid.idempKey,
            lastPaid.bodyHash,
            lastPaid.payload,
            lastPaid.payload.meta?.billing ?? { amount_usdc: paymentConfig(env).price, tx_hash: tx, free_trial: false },
          );
        } catch (err) {
          logRequest({
            msg: "mcp_paid_stage",
            stage: "after_settlement",
            request_id: requestId,
            err: String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
        }
      },
    },
  });

  const engineOnly = async (args: unknown) => {
    try {
      logRequest({ msg: "mcp_paid_stage", stage: "parse", request_id: requestId });
      const hashed = spec.parseForHash(args ?? {});
      logRequest({ msg: "mcp_paid_stage", stage: "limit", request_id: requestId });
      await limitOrThrow(env.PAID_LIMIT, request.headers.get("X-Wallet") ?? request.headers.get("cf-connecting-ip") ?? "mcp", requestId);
      const bodyHash = await sha256Hex(canonicalJson(hashed));
      const billing: Billing = { amount_usdc: paymentConfig(env).price, tx_hash: null, free_trial: false };
      logRequest({ msg: "mcp_paid_stage", stage: "research", request_id: requestId });
      const payload = await spec.execute(
        args ?? {},
        requestId,
        bodyHash,
        request.headers.get("Idempotency-Key"),
        billing,
      );
      const parsed = spec.parseOutput(payload);
      if (!parsed.success) {
        logRequest({
          msg: "mcp_paid_stage",
          stage: "output_schema",
          request_id: requestId,
          err: parsed.error.message,
          issues: parsed.error.issues,
        });
        return mcpToolError(
          new AgentError("INTERNAL_ERROR", "research failed", {
            request_id: requestId,
            details: { cause: "output_schema" },
          }),
          requestId,
        );
      }
      logRequest({ msg: "mcp_paid_stage", stage: "return", request_id: requestId });
      const result: PaidToolResult<TOut> = {
        content: [{ type: "text", text: JSON.stringify(parsed.data) }],
        structuredContent: parsed.data,
      };
      lastPaid = {
        payload: parsed.data as TOut & { meta?: { billing?: Billing } },
        result,
        bodyHash,
        idempKey: request.headers.get("Idempotency-Key"),
      };
      return result;
    } catch (err) {
      logRequest({
        msg: "mcp_paid_stage",
        stage: "fail",
        request_id: requestId,
        err: String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      return mcpToolError(err, requestId);
    }
  };

  const wrapped = paid(engineOnly as never);
  return async (args: unknown, toolCtx: ToolCtx) => {
    try {
      try {
        const hashed = spec.parseForHash(args ?? {});
        const bodyHash = await sha256Hex(canonicalJson(hashed));
        const existing = await lookupIdempotency(env, request.headers.get("Idempotency-Key"), bodyHash, requestId);
        if (existing?.response) {
          logRequest({ msg: "mcp_paid_idempotent_replay", request_id: requestId });
          return {
            content: [{ type: "text" as const, text: JSON.stringify(existing.response) }],
            structuredContent: existing.response,
          };
        }
      } catch (err) {
        if (err instanceof AgentError && err.code === "IDEMPOTENCY_CONFLICT") {
          return mcpToolError(err, requestId);
        }
      }
      const result = await wrapped(args as Record<string, unknown>, mcpPaymentExtraFromContext(toolCtx, request));
      if (isOpaqueIse(result as { isError?: boolean; content?: Array<{ type?: string; text?: string }> })) {
        logRequest({ msg: "mcp_paid_wrapper_ise", request_id: requestId });
        return mcpToolError(
          new AgentError("INTERNAL_ERROR", "research failed", {
            request_id: requestId,
            details: { cause: "x402_wrapper" },
          }),
          requestId,
        );
      }
      return result;
    } catch (err) {
      logRequest({
        msg: "mcp_paid_stage",
        stage: "wrapper",
        request_id: requestId,
        err: String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      return mcpToolError(err, requestId);
    }
  };
}
