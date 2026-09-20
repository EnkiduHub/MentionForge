const API_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Permitted-Cross-Domain-Policies": "none",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};

const HTML_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "object-src 'none'",
].join("; ");

export const WWW_AUTHENTICATE = 'Bearer realm="mentionforge"';

export function apiSecurityHeaders(): Record<string, string> {
  return { ...API_HEADERS };
}

export function htmlSecurityHeaders(): Record<string, string> {
  return {
    ...API_HEADERS,
    "Content-Security-Policy": HTML_CSP,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Frame-Options": "DENY",
  };
}

export function applySecurityHeaders(res: Response, kind: "html" | "asset"): Response {
  const headers = new Headers(res.headers);
  const extra = kind === "html" ? htmlSecurityHeaders() : apiSecurityHeaders();
  for (const [k, v] of Object.entries(extra)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  if (kind === "html" && !headers.has("Cache-Control")) {
    headers.set("Cache-Control", "public, max-age=60");
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export function assetKind(pathname: string, contentType: string | null): "html" | "asset" {
  const path = pathname === "" ? "/" : pathname;
  if (path === "/" || path === "/index.html") return "html";
  if ((contentType ?? "").toLowerCase().includes("text/html")) return "html";
  return "asset";
}
