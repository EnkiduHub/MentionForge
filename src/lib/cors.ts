import { cors } from "hono/cors";

export const PAYMENT_ALLOW_HEADERS = [
  "Content-Type",
  "PAYMENT-SIGNATURE",
  "X-PAYMENT",
  "Idempotency-Key",
  "X-Sandbox-Key",
  "X-Wallet",
  "Authorization",
  "X-Request-Id",
];

export const PAYMENT_EXPOSE_HEADERS = [
  "PAYMENT-REQUIRED",
  "PAYMENT-RESPONSE",
  "X-Request-Id",
  "Retry-After",
];

export function corsMiddleware(allowedOrigins: string | undefined) {
  const origin =
    !allowedOrigins || allowedOrigins.trim() === "*"
      ? "*"
      : allowedOrigins.split(",").map((s) => s.trim());
  return cors({
    origin,
    allowMethods: ["GET", "POST", "HEAD", "OPTIONS"],
    allowHeaders: PAYMENT_ALLOW_HEADERS,
    exposeHeaders: PAYMENT_EXPOSE_HEADERS,
    maxAge: 86400,
  });
}
