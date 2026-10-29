import { SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";

/**
 * Reserved 2026-07-28 per-request envelope key.
 * https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
 * (legacy clients send the negotiated version on MCP-Protocol-Version;
 * some also copy it into this `_meta` key, which the 2026 entry treats as a
 * modern claim and then rejects).
 */
export const PROTOCOL_VERSION_META_KEY = "io.modelcontextprotocol/protocolVersion";

/** First modern-era revision. ISO dates compare in chronological order. */
const FIRST_MODERN_PROTOCOL_VERSION = "2026-07-28";

export const LEGACY_PROTOCOL_VERSIONS: readonly string[] = SUPPORTED_PROTOCOL_VERSIONS.filter(
  (version) => version < FIRST_MODERN_PROTOCOL_VERSION,
);

const UNSUPPORTED_PROTOCOL_CODE = -32022;

export function isLegacyProtocolVersion(version: string): boolean {
  return LEGACY_PROTOCOL_VERSIONS.includes(version);
}

function isModernProtocolVersion(version: string): boolean {
  return version >= FIRST_MODERN_PROTOCOL_VERSION;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonRpcError(id: unknown, message: string, data?: JsonRecord): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      id: typeof id === "string" || typeof id === "number" ? id : null,
      error: {
        code: UNSUPPORTED_PROTOCOL_CODE,
        message,
        ...(data ? { data } : {}),
      },
    },
    {
      status: 400,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "mcp-session-id, MCP-Protocol-Version",
        "Cache-Control": "no-store",
      },
    },
  );
}

/**
 * 2025-era clients that stamp `params._meta["io.modelcontextprotocol/protocolVersion"]`
 * with a legacy revision (commonly `2025-06-18`) are classified as modern by the
 * SDK entry and rejected with `Unsupported protocol version: <that version>`,
 * even though `initialize` with the same version succeeds.
 *
 * Drop that legacy claim so the request stays on the 2025 stateless lane, and
 * copy it onto `MCP-Protocol-Version` when the client omitted the header the
 * 2025-06-18 transport spec requires after initialize.
 *
 * A modern claim (`2026-07-28` or later) is left untouched. An unsupported
 * version, or a modern header paired with a legacy claim, returns a JSON-RPC
 * error instead of being served under the wrong era.
 */
export async function adaptLegacyProtocolClaim(request: Request): Promise<Request | Response> {
  if (request.method.toUpperCase() !== "POST") return request;
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return request;

  let parsed: unknown;
  try {
    parsed = await request.clone().json();
  } catch {
    return request;
  }
  if (!isRecord(parsed) || !isRecord(parsed.params) || !isRecord(parsed.params._meta)) return request;

  const claimed = parsed.params._meta[PROTOCOL_VERSION_META_KEY];
  if (typeof claimed !== "string") return request;
  if (isModernProtocolVersion(claimed)) return request;

  const header = request.headers.get("mcp-protocol-version")?.trim() ?? "";
  if (header && isModernProtocolVersion(header)) {
    return jsonRpcError(
      parsed.id,
      `Unsupported protocol version: MCP-Protocol-Version ${header} does not match legacy protocol ${claimed}`,
      { supported: [...LEGACY_PROTOCOL_VERSIONS], requested: claimed, header },
    );
  }
  if (header && !isLegacyProtocolVersion(header)) {
    return jsonRpcError(parsed.id, `Unsupported protocol version: ${header}`, {
      supported: [...LEGACY_PROTOCOL_VERSIONS],
      requested: header,
    });
  }
  if (!isLegacyProtocolVersion(claimed)) {
    return jsonRpcError(parsed.id, `Unsupported protocol version: ${claimed}`, {
      supported: [...LEGACY_PROTOCOL_VERSIONS],
      requested: claimed,
    });
  }

  const meta = { ...parsed.params._meta };
  delete meta[PROTOCOL_VERSION_META_KEY];
  const params = { ...parsed.params };
  if (Object.keys(meta).length === 0) delete params._meta;
  else params._meta = meta;

  const headers = new Headers(request.headers);
  if (!header) headers.set("MCP-Protocol-Version", claimed);

  return new Request(request, {
    headers,
    body: JSON.stringify({ ...parsed, params }),
  });
}
