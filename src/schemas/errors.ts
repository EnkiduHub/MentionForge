import { z } from "zod";
import { SAMPLE_QUERY } from "../lib/constants";

export const errorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "PAYLOAD_TOO_LARGE",
  "PAYMENT_REQUIRED",
  "PAYMENT_UNAVAILABLE",
  "UNAUTHORIZED",
  "RATE_LIMITED",
  "TRIAL_EXHAUSTED",
  "SOURCE_UNAVAILABLE",
  "IDEMPOTENCY_CONFLICT",
  "INTERNAL_ERROR",
]);

export type ErrorCode = z.infer<typeof errorCodeSchema>;

export type AgentErrorBody = {
  error: {
    code: ErrorCode;
    message: string;
    recoverable: boolean;
    hint: string;
    details: Record<string, unknown>;
  };
  request_id: string;
};

const RECOVERABLE: Record<ErrorCode, boolean> = {
  VALIDATION_ERROR: true,
  PAYLOAD_TOO_LARGE: true,
  PAYMENT_REQUIRED: true,
  PAYMENT_UNAVAILABLE: true,
  UNAUTHORIZED: true,
  RATE_LIMITED: true,
  TRIAL_EXHAUSTED: true,
  SOURCE_UNAVAILABLE: true,
  IDEMPOTENCY_CONFLICT: true,
  INTERNAL_ERROR: false,
};

const HTTP: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  PAYLOAD_TOO_LARGE: 413,
  PAYMENT_REQUIRED: 402,
  PAYMENT_UNAVAILABLE: 503,
  UNAUTHORIZED: 401,
  RATE_LIMITED: 429,
  TRIAL_EXHAUSTED: 402,
  SOURCE_UNAVAILABLE: 503,
  IDEMPOTENCY_CONFLICT: 409,
  INTERNAL_ERROR: 500,
};

export class AgentError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;
  readonly hint: string;
  readonly request_id: string;

  constructor(
    code: ErrorCode,
    message: string,
    opts: { hint?: string; details?: Record<string, unknown>; request_id: string },
  ) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.hint = opts.hint ?? defaultHint(code);
    this.details = opts.details ?? {};
    this.request_id = opts.request_id;
  }

  status(): number {
    return HTTP[this.code];
  }

  body(): AgentErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        recoverable: RECOVERABLE[this.code],
        hint: this.hint,
        details: this.details,
      },
      request_id: this.request_id,
    };
  }
}

function defaultHint(code: ErrorCode): string {
  switch (code) {
    case "VALIDATION_ERROR":
      return `Send JSON like ${JSON.stringify({ query: SAMPLE_QUERY, timeframe: "7d", limit: 20 })}. Unknown fields are ignored.`;
    case "PAYLOAD_TOO_LARGE":
      return "Request body must be ≤ 8KB. Shorten query or drop unused fields.";
    case "PAYMENT_REQUIRED":
      return "Retry with PAYMENT-SIGNATURE (x402 exact USDC) or X-Sandbox-Key / X-Wallet for trial. Set Idempotency-Key to a UUID.";
    case "PAYMENT_UNAVAILABLE":
      return "Facilitator or RECIPIENT_WALLET is not configured. Retry in 30s. Do not resend a new payment yet.";
    case "UNAUTHORIZED":
      return "Authorization: Bearer <OPERATOR_TOKEN>.";
    case "RATE_LIMITED":
      return "Wait for Retry-After seconds, then retry with the same Idempotency-Key.";
    case "TRIAL_EXHAUSTED":
      return "Free trial used. Pay $0.02 USDC via x402 PAYMENT-SIGNATURE and retry.";
    case "SOURCE_UNAVAILABLE":
      return "All upstream sources failed. Retry once after 15s with the same Idempotency-Key.";
    case "IDEMPOTENCY_CONFLICT":
      return "This Idempotency-Key was used with a different body. Generate a new UUID key.";
    default:
      return "Retry once. If it persists, include request_id when reporting.";
  }
}

export function statusForCode(code: ErrorCode): number {
  return HTTP[code];
}
