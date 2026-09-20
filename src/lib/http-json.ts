import type { Context } from "hono";
import { discoveryDocumentHtml } from "./html";
import { htmlSecurityHeaders } from "./security-headers";

/** Browsers send text/html. Agents typically send application/json or a wildcard Accept. */
export function wantsPrettyJson(accept: string | undefined): boolean {
  const a = accept ?? "";
  return /\btext\/html\b/i.test(a) && !/\bapplication\/json\b/i.test(a);
}

/** Top-level clicks set Sec-Fetch-Dest: document. Same-origin fetch() uses empty. */
export function wantsHtmlDocument(c: Context): boolean {
  const dest = (c.req.header("Sec-Fetch-Dest") ?? "").toLowerCase();
  if (dest === "document") return true;
  if (dest === "empty" || dest === "cors" || dest === "script") return false;
  return wantsPrettyJson(c.req.header("Accept"));
}

const VARY_PUBLIC = "Accept, Sec-Fetch-Dest";

export function sendJson(
  c: Context<{ Bindings: Env }>,
  data: unknown,
  status: 200 | 401,
  headers: Record<string, string> = {},
): Response {
  const pretty = wantsPrettyJson(c.req.header("Accept")) && !wantsHtmlDocument(c);
  return c.body(JSON.stringify(data, null, pretty ? 2 : undefined), status, {
    "Content-Type": "application/json; charset=utf-8",
    Vary: VARY_PUBLIC,
    ...headers,
  });
}

export function sendPublic(
  c: Context<{ Bindings: Env }>,
  data: unknown,
  status: 200 | 401,
  headers: Record<string, string>,
  view: { title: string; hint: string },
): Response {
  if (status === 200 && c.req.query("raw") === "1") {
    const next = { Vary: VARY_PUBLIC, ...headers };
    if (typeof data === "string") {
      return c.text(data, status, { "Content-Type": "text/plain; charset=utf-8", ...next });
    }
    return sendJson(c, data, status, next);
  }
  if (status === 200 && wantsHtmlDocument(c)) {
    const url = new URL(c.req.url);
    const body = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    const requested = headers["Cache-Control"];
    const cache = requested?.includes("no-store") ? requested : "private, max-age=30";
    return c.html(
      discoveryDocumentHtml({
        title: view.title,
        hint: view.hint,
        path: `${url.pathname}${url.search}`,
        body,
      }),
      200,
      { ...htmlSecurityHeaders(), ...headers, "Cache-Control": cache, Vary: VARY_PUBLIC },
    );
  }
  const next = { Vary: VARY_PUBLIC, ...headers };
  if (typeof data === "string") {
    return c.text(data, status, { "Content-Type": "text/plain; charset=utf-8", ...next });
  }
  return sendJson(c, data, status, next);
}
