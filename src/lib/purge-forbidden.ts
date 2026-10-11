/**
 * Scan / sanitize stored research JSON for hosts and X fields that must not
 * remain in cache or D1 idempotency payloads.
 *
 * Allowed on an X row: `id`, handle-free `url` of the form
 * `https://x.com/i/status/<id>`, and `created_bucket`.
 */

/** Hosts that must not remain in cache/D1. Google News and HN are live sources. */
export const FORBIDDEN_HOSTS = [] as const;

const X_FIELD_HITS = new Set([
  "text",
  "author",
  "handle",
  "username",
  "user",
  "users",
  "screen_name",
  "user_object",
]);

const URL_RE = /https?:\/\/[^\s"'<>\\]+/gi;
const ALLOWED_X_ROW_URL = /^https:\/\/x\.com\/i\/status\/(\d+)$/;
const X_STATUS_ID = /(?:https:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/(?:i\/(?:web\/)?status(?:es)?|([A-Za-z0-9_]+)\/status(?:es)?)\/(\d+)/i;

export type PurgeHit = {
  field: string;
  host?: string;
  reason: string;
};

export type SanitizeResult = {
  hits: PurgeHit[];
  action: "keep" | "update" | "delete";
  value: unknown;
};

export function hostOfUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function isForbiddenHost(host: string): boolean {
  const h = host.replace(/^www\./, "").toLowerCase();
  if ((FORBIDDEN_HOSTS as readonly string[]).includes(h)) return true;
  if (h === "reddit.com" || h.endsWith(".reddit.com")) return true;
  if (h === "redd.it" || h.endsWith(".redd.it")) return true;
  return false;
}

export function isXTwitterHost(host: string): boolean {
  const h = host.replace(/^www\./, "").toLowerCase();
  return h === "x.com" || h === "twitter.com" || h.endsWith(".x.com") || h.endsWith(".twitter.com");
}

export function isAllowedXRowUrl(url: string): boolean {
  return ALLOWED_X_ROW_URL.test(url);
}

/** Parse a status id from handle or /i/status forms. */
export function parseXStatusId(url: string): string | null {
  const allowed = ALLOWED_X_ROW_URL.exec(url);
  if (allowed?.[1]) return allowed[1];
  const m = X_STATUS_ID.exec(url);
  if (m?.[2]) return m[2];
  return null;
}

export function canonicalXRowUrl(id: string): string {
  return `https://x.com/i/status/${id}`;
}

export function extractUrls(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(URL_RE);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[0].replace(/[),.;]+$/, "");
    out.push(raw);
  }
  const trimmed = text.trim();
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(trimmed) && !trimmed.includes(" ")) {
    out.push(`https://${trimmed}`);
  }
  return out;
}

function pathKey(path: string[]): string {
  return path.length ? path.join(".") : "$";
}

function nonempty(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "object") return true;
  return true;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function isXMentionRow(obj: unknown): obj is Record<string, unknown> {
  if (!isPlainObject(obj)) return false;
  if (obj.platform === "x") return true;
  if (typeof obj.created_bucket === "string" && typeof obj.url === "string" && typeof obj.id === "string") {
    const host = hostOfUrl(obj.url);
    return !host || isXTwitterHost(host);
  }
  return false;
}

function hostHitsForString(text: string, field: string): PurgeHit[] {
  const hits: PurgeHit[] = [];
  for (const url of extractUrls(text)) {
    const host = hostOfUrl(url);
    if (!host) continue;
    if (isForbiddenHost(host)) {
      hits.push({ field, host, reason: `forbidden host ${host}` });
    } else if (isXTwitterHost(host)) {
      hits.push({ field, host, reason: "x/twitter url outside allowed X row url" });
    }
  }
  return hits;
}

function sanitizeXRow(row: Record<string, unknown>, path: string[]): { row: Record<string, unknown> | null; hits: PurgeHit[] } {
  const hits: PurgeHit[] = [];
  const prefix = pathKey(path);

  for (const key of Object.keys(row)) {
    if (X_FIELD_HITS.has(key) && nonempty(row[key])) {
      hits.push({ field: `${prefix}.${key}`, reason: `X/Twitter field ${key}` });
    }
    if (key === "includes" && isPlainObject(row.includes) && "users" in row.includes) {
      hits.push({ field: `${prefix}.includes.users`, reason: "X/Twitter user-object field" });
    }
  }

  const url = typeof row.url === "string" ? row.url : "";
  if (!url) {
    hits.push({ field: `${prefix}.url`, reason: "X row missing url; drop" });
    return { row: null, hits };
  }
  if (isAllowedXRowUrl(url)) {
    // keep
  } else {
    const id = parseXStatusId(url) ?? (typeof row.id === "string" && /^\d+$/.test(row.id) ? row.id : null);
    const host = hostOfUrl(url);
    if (id && host && isXTwitterHost(host)) {
      hits.push({
        field: `${prefix}.url`,
        host,
        reason: "X row url has a handle or non-canonical form; rewrite to /i/status/<id>",
      });
      row = { ...row, url: canonicalXRowUrl(id) };
    } else {
      hits.push({
        field: `${prefix}.url`,
        host: host ?? undefined,
        reason: "X row url is not a parseable status URL; drop row",
      });
      return { row: null, hits };
    }
  }

  const kept: Record<string, unknown> = {};
  if (typeof row.id === "string") kept.id = row.id;
  kept.url = row.url;
  if (typeof row.created_bucket === "string") kept.created_bucket = row.created_bucket;
  // Drop every other key (text, author, platform extras, handles).
  return { row: kept, hits };
}

function sanitizeCitation(obj: Record<string, unknown>, path: string[]): { keep: boolean; hits: PurgeHit[] } {
  const hits: PurgeHit[] = [];
  const prefix = pathKey(path);
  const url = typeof obj.url === "string" ? obj.url : "";
  if (url) {
    const host = hostOfUrl(url);
    if (host && isForbiddenHost(host)) {
      hits.push({ field: `${prefix}.url`, host, reason: `citation forbidden host ${host}` });
    } else if (host && isXTwitterHost(host)) {
      hits.push({ field: `${prefix}.url`, host, reason: "x.com/twitter.com status URL in citations array" });
    }
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === "url" || typeof v !== "string") continue;
    hits.push(...hostHitsForString(v, `${prefix}.${k}`));
  }
  return { keep: hits.length === 0, hits };
}

function sanitizeUnknown(node: unknown, path: string[]): { value: unknown; hits: PurgeHit[] } {
  if (typeof node === "string") {
    return { value: node, hits: hostHitsForString(node, pathKey(path)) };
  }
  if (Array.isArray(node)) {
    const last = path[path.length - 1];
    const out: unknown[] = [];
    const hits: PurgeHit[] = [];
    for (let i = 0; i < node.length; i++) {
      const item = node[i];
      const itemPath = [...path, String(i)];
      if (last === "citations" && isPlainObject(item)) {
        const c = sanitizeCitation(item, itemPath);
        hits.push(...c.hits);
        if (c.keep) out.push(item);
        continue;
      }
      if (isXMentionRow(item)) {
        const x = sanitizeXRow({ ...item }, itemPath);
        hits.push(...x.hits);
        if (x.row) out.push(x.row);
        continue;
      }
      if (isPlainObject(item) && (item.platform === "reddit" || (typeof item.url === "string" && hostOfUrl(item.url) && isForbiddenHost(hostOfUrl(item.url)!)))) {
        const host = typeof item.url === "string" ? hostOfUrl(item.url) ?? undefined : undefined;
        hits.push({ field: pathKey(itemPath), host, reason: "row URL on a forbidden host" });
        continue;
      }
      const inner = sanitizeUnknown(item, itemPath);
      hits.push(...inner.hits);
      out.push(inner.value);
    }
    return { value: out, hits };
  }
  if (isPlainObject(node)) {
    if (isXMentionRow(node) && path[path.length - 1] !== undefined && path.includes("mentions")) {
      const x = sanitizeXRow({ ...node }, path);
      return { value: x.row, hits: x.hits };
    }
    const out: Record<string, unknown> = {};
    const hits: PurgeHit[] = [];
    for (const [k, v] of Object.entries(node)) {
      const inner = sanitizeUnknown(v, [...path, k]);
      hits.push(...inner.hits);
      out[k] = inner.value;
    }
    return { value: out, hits };
  }
  return { value: node, hits: [] };
}

export function sanitizeStoredRecord(value: unknown): SanitizeResult {
  const { value: next, hits } = sanitizeUnknown(value, []);
  if (hits.length === 0) return { hits, action: "keep", value };
  const leftover = sanitizeUnknown(next, []);
  if (leftover.hits.length > 0) {
    return { hits: [...hits, ...leftover.hits], action: "delete", value };
  }
  if (next == null) return { hits, action: "delete", value };
  return { hits, action: "update", value: next };
}

export function aggregateHitCounts(hits: PurgeHit[]): { by_host: Record<string, number>; by_field: Record<string, number> } {
  const by_host: Record<string, number> = {};
  const by_field: Record<string, number> = {};
  for (const h of hits) {
    if (h.host) by_host[h.host] = (by_host[h.host] ?? 0) + 1;
    const field = h.field.replace(/\.\d+/g, "[]");
    by_field[field] = (by_field[field] ?? 0) + 1;
  }
  return { by_host, by_field };
}

export type StoreRecord = { id: string; store: string; value: unknown };

export type StoreScanResult = {
  store: string;
  scanned: number;
  hit_records: number;
  by_host: Record<string, number>;
  by_field: Record<string, number>;
  actions: Array<{ id: string; action: "keep" | "update" | "delete"; hits: PurgeHit[] }>;
};

export function scanStoreRecords(store: string, records: StoreRecord[]): StoreScanResult {
  const by_host: Record<string, number> = {};
  const by_field: Record<string, number> = {};
  const actions: StoreScanResult["actions"] = [];
  let hit_records = 0;
  for (const rec of records) {
    const result = sanitizeStoredRecord(rec.value);
    if (result.hits.length) {
      hit_records += 1;
      const agg = aggregateHitCounts(result.hits);
      for (const [k, n] of Object.entries(agg.by_host)) by_host[k] = (by_host[k] ?? 0) + n;
      for (const [k, n] of Object.entries(agg.by_field)) by_field[k] = (by_field[k] ?? 0) + n;
    }
    actions.push({ id: rec.id, action: result.action, hits: result.hits });
  }
  return { store, scanned: records.length, hit_records, by_host, by_field, actions };
}

export function printStoreScan(result: StoreScanResult): string {
  const lines = [
    `store  ${result.store}`,
    `  scanned ${result.scanned}`,
    `  hit_records ${result.hit_records}`,
  ];
  const hosts = Object.keys(result.by_host).sort();
  if (!hosts.length) lines.push("  host  (none)");
  for (const h of hosts) lines.push(`  host  ${h}  ${result.by_host[h]}`);
  const fields = Object.keys(result.by_field).sort();
  if (!fields.length) lines.push("  field  (none)");
  for (const f of fields) lines.push(`  field  ${f}  ${result.by_field[f]}`);
  return lines.join("\n");
}

export type WranglerBindings = {
  account_id?: string;
  kv_namespaces: Array<{ binding: string; id: string; title?: string }>;
  d1_databases: Array<{ binding: string; database_name: string; database_id: string }>;
};

/** Strip // and /* comments outside of strings so wrangler.jsonc can be JSON.parse'd. */
export function parseJsonc(text: string): unknown {
  let out = "";
  let i = 0;
  let inStr = false;
  let quote = "";
  while (i < text.length) {
    const c = text[i]!;
    const n = text[i + 1];
    if (inStr) {
      out += c;
      if (c === "\\" && i + 1 < text.length) {
        out += text[i + 1];
        i += 2;
        continue;
      }
      if (c === quote) inStr = false;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === "/" && n === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      while (i + 1 < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return JSON.parse(out) as unknown;
}

export function bindingsFromWrangler(doc: unknown, envName: "staging" | "production"): WranglerBindings {
  const root = (doc ?? {}) as Record<string, unknown>;
  const envBlock = ((root.env as Record<string, unknown> | undefined)?.[envName] ?? {}) as Record<string, unknown>;
  const kv = (envBlock.kv_namespaces as WranglerBindings["kv_namespaces"] | undefined) ??
    (root.kv_namespaces as WranglerBindings["kv_namespaces"] | undefined) ??
    [];
  const d1 = (envBlock.d1_databases as WranglerBindings["d1_databases"] | undefined) ??
    (root.d1_databases as WranglerBindings["d1_databases"] | undefined) ??
    [];
  return {
    account_id: typeof root.account_id === "string" ? root.account_id : undefined,
    kv_namespaces: kv,
    d1_databases: d1,
  };
}

/** Cache API hosts written by src/lib/cache.ts and reddit.ts. Not listable remotely. */
export const WORKERS_CACHE_NOTE = [
  "workers-cache (caches.default) is not enumerable via wrangler or the Cloudflare REST API.",
  "Research keys: https://mentionforge.cache/research?k=<sha256> (TTL 10m–2h).",
  "Flag keys: https://mentionforge.cache/flag/<name>. Reddit OAuth: https://mentionforge.cache/reddit-oauth (token, not citations).",
  "Durable copies of paid research JSON live in D1 table idempotency.response; this script scans that.",
  "--apply cannot content-purge Cache API entries; they expire by TTL.",
].join(" ");
