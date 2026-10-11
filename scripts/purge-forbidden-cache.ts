#!/usr/bin/env tsx
/**
 * Scan (and optionally rewrite/delete) stored research for forbidden hosts and
 * X/Twitter fields. Credentials come from the environment only; this file
 * contains none.
 *
 *   npm run purge:forbidden -- --dry-run --env staging
 *   npm run purge:forbidden -- --dry-run --env production
 *   npm run purge:forbidden -- --apply --env staging
 *
 * Always run --dry-run first. This CLI talks to Cloudflare only when invoked
 * with --env; unit tests never call it.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  bindingsFromWrangler,
  parseJsonc,
  printStoreScan,
  sanitizeStoredRecord,
  scanStoreRecords,
  WORKERS_CACHE_NOTE,
  type StoreRecord,
  type StoreScanResult,
} from "../src/lib/purge-forbidden.js";

type Mode = "dry-run" | "apply";
type EnvName = "staging" | "production";

function usage(msg?: string): never {
  if (msg) console.error(msg);
  console.error(
    "Usage: npm run purge:forbidden -- --dry-run|--apply --env <staging|production>\n" +
      "Credentials: CLOUDFLARE_API_TOKEN (required) and optional CLOUDFLARE_ACCOUNT_ID.\n" +
      "This command is operator-only. Do not run it from tests or CI.",
  );
  process.exit(2);
}

function parseArgs(argv: string[]): { mode: Mode; envName: EnvName } {
  let mode: Mode | undefined;
  let envName: EnvName | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") mode = "dry-run";
    else if (a === "--apply") mode = "apply";
    else if (a === "--env") {
      const v = argv[++i];
      if (v !== "staging" && v !== "production") usage(`invalid --env ${v ?? ""}`);
      envName = v;
    } else if (a?.startsWith("--env=")) {
      const v = a.slice(6);
      if (v !== "staging" && v !== "production") usage(`invalid --env ${v}`);
      envName = v;
    } else {
      usage(`unknown argument ${a}`);
    }
  }
  if (!mode) usage("pass exactly one of --dry-run or --apply");
  if (!envName) usage("pass --env staging or --env production");
  return { mode, envName };
}

function wranglerJsonc(): unknown {
  const raw = readFileSync(resolve("wrangler.jsonc"), "utf8");
  return parseJsonc(raw);
}

function requireToken(): string {
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!token) usage("CLOUDFLARE_API_TOKEN is not set (credentials from env only)");
  return token;
}

function wranglerJson(args: string[]): unknown {
  const result = spawnSync("npx", ["wrangler", ...args], {
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    throw new Error(`wrangler ${args.join(" ")} exited ${result.status}`);
  }
  const text = (result.stdout || "").trim();
  const start = text.indexOf("{") >= 0 && (text.indexOf("[") === -1 || text.indexOf("{") < text.indexOf("["))
    ? text.indexOf("{")
    : text.indexOf("[");
  if (start < 0) return text;
  return JSON.parse(text.slice(start)) as unknown;
}

function d1Select(databaseName: string, envName: EnvName, sql: string): Record<string, unknown>[] {
  const json = wranglerJson([
    "d1",
    "execute",
    databaseName,
    "--env",
    envName,
    "--remote",
    "--json",
    "--command",
    sql,
  ]);
  const rows: Record<string, unknown>[] = [];
  const pack = Array.isArray(json) ? json : [json];
  for (const item of pack) {
    const results = (item as { results?: unknown[] }).results;
    if (Array.isArray(results)) {
      for (const r of results) {
        if (r && typeof r === "object") rows.push(r as Record<string, unknown>);
      }
    }
  }
  return rows;
}

function d1Run(databaseName: string, envName: EnvName, sql: string): void {
  wranglerJson([
    "d1",
    "execute",
    databaseName,
    "--env",
    envName,
    "--remote",
    "--json",
    "--command",
    sql,
  ]);
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function parseMaybeJson(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return raw;
  const t = raw.trim();
  if (!t) return raw;
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return JSON.parse(t) as unknown;
    } catch {
      return raw;
    }
  }
  return raw;
}

async function listKvKeys(accountId: string, namespaceId: string, token: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "";
  for (;;) {
    const url = new URL(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/keys`,
    );
    url.searchParams.set("limit", "1000");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    const body = (await res.json()) as {
      success: boolean;
      result?: Array<{ name: string }>;
      result_info?: { cursor?: string };
      errors?: Array<{ message: string }>;
    };
    if (!res.ok || !body.success) {
      throw new Error(`KV list failed: ${body.errors?.map((e) => e.message).join("; ") || res.status}`);
    }
    for (const k of body.result ?? []) keys.push(k.name);
    const next = body.result_info?.cursor;
    if (!next) break;
    cursor = next;
  }
  return keys;
}

async function getKv(accountId: string, namespaceId: string, key: string, token: string): Promise<unknown> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  const text = await res.text();
  return parseMaybeJson(text);
}

async function deleteKv(accountId: string, namespaceId: string, key: string, token: string): Promise<void> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
    { method: "DELETE", headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`KV delete ${key} failed: ${res.status}`);
}

async function putKv(accountId: string, namespaceId: string, key: string, value: string, token: string): Promise<void> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
    { method: "PUT", headers: { authorization: `Bearer ${token}` }, body: value },
  );
  if (!res.ok) throw new Error(`KV put ${key} failed: ${res.status}`);
}

function scanD1Database(databaseName: string, envName: EnvName): { results: StoreScanResult[]; apply: () => void } {
  const tables = d1Select(
    databaseName,
    envName,
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
  );
  const results: StoreScanResult[] = [];
  const pending: Array<{ table: string; idCol: string; id: string; action: "delete" | "update"; encoded?: string }> = [];

  for (const t of tables) {
    const table = String(t.name ?? "");
    if (!table) continue;
    const cols = d1Select(databaseName, envName, `PRAGMA table_info(${table})`);
    const colNames = cols.map((c) => String(c.name));
    const pk = cols.find((c) => Number(c.pk) === 1);
    const idCol = pk ? String(pk.name) : colNames[0] ?? "rowid";
    const rows = d1Select(databaseName, envName, `SELECT * FROM ${table}`);
    const records: StoreRecord[] = rows.map((row, i) => {
      const payload: Record<string, unknown> = {};
      for (const c of colNames) payload[c] = parseMaybeJson(row[c]);
      const id = row[idCol] != null ? String(row[idCol]) : String(i);
      return { id, store: `d1:${databaseName}.${table}`, value: payload };
    });
    const scanned = scanStoreRecords(`d1:${databaseName}.${table}`, records);
    results.push(scanned);
    for (let i = 0; i < records.length; i++) {
      const rec = records[i]!;
      const action = scanned.actions[i]!;
      if (action.action === "delete") {
        pending.push({ table, idCol, id: rec.id, action: "delete" });
      } else if (action.action === "update") {
        const sanitized = sanitizeStoredRecord(rec.value);
        if (sanitized.action === "update" && sanitized.value && typeof sanitized.value === "object") {
          const obj = sanitized.value as Record<string, unknown>;
          if (table === "idempotency") {
            pending.push({
              table,
              idCol,
              id: rec.id,
              action: "update",
              encoded: `UPDATE idempotency SET response = ${sqlString(JSON.stringify(obj.response ?? null))}, billing = ${sqlString(JSON.stringify(obj.billing ?? null))} WHERE ${idCol} = ${sqlString(rec.id)}`,
            });
          } else {
            pending.push({ table, idCol, id: rec.id, action: "delete" });
          }
        }
      }
    }
  }

  return {
    results,
    apply() {
      for (const p of pending) {
        if (p.action === "delete") {
          d1Run(databaseName, envName, `DELETE FROM ${p.table} WHERE ${p.idCol} = ${sqlString(p.id)}`);
        } else if (p.encoded) {
          d1Run(databaseName, envName, p.encoded);
        }
      }
    },
  };
}

async function main(): Promise<void> {
  const { mode, envName } = parseArgs(process.argv.slice(2));
  const token = requireToken();
  const doc = wranglerJsonc();
  const bindings = bindingsFromWrangler(doc, envName);
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || bindings.account_id;
  if (!accountId) usage("CLOUDFLARE_ACCOUNT_ID is not set and wrangler.jsonc has no account_id");

  console.log(`purge-forbidden  mode=${mode} env=${envName}`);
  console.log(WORKERS_CACHE_NOTE);

  const all: StoreScanResult[] = [];
  const appliers: Array<() => Promise<void> | void> = [];

  if (!bindings.kv_namespaces.length) {
    console.log("store  kv  (none bound in wrangler.jsonc for this env)");
  }
  for (const ns of bindings.kv_namespaces) {
    const names = await listKvKeys(accountId, ns.id, token);
    const records: StoreRecord[] = [];
    for (const name of names) {
      records.push({
        id: name,
        store: `kv:${ns.binding}`,
        value: await getKv(accountId, ns.id, name, token),
      });
    }
    const scanned = scanStoreRecords(`kv:${ns.binding}`, records);
    all.push(scanned);
    console.log(printStoreScan(scanned));
    appliers.push(async () => {
      for (let i = 0; i < records.length; i++) {
        const rec = records[i]!;
        const act = scanned.actions[i]!;
        if (act.action === "delete") await deleteKv(accountId, ns.id, rec.id, token);
        else if (act.action === "update") {
          const next = sanitizeStoredRecord(rec.value);
          if (next.action === "update") {
            await putKv(accountId, ns.id, rec.id, JSON.stringify(next.value), token);
          }
        }
      }
    });
  }

  if (!bindings.d1_databases.length) {
    console.log("store  d1  (none bound in wrangler.jsonc for this env)");
  }
  for (const db of bindings.d1_databases) {
    const { results, apply } = scanD1Database(db.database_name, envName);
    for (const r of results) {
      all.push(r);
      console.log(printStoreScan(r));
    }
    appliers.push(apply);
  }

  const workersCache: StoreScanResult = {
    store: "workers-cache",
    scanned: 0,
    hit_records: 0,
    by_host: {},
    by_field: {},
    actions: [],
  };
  all.push(workersCache);
  console.log(printStoreScan(workersCache));
  console.log(`  note  ${WORKERS_CACHE_NOTE}`);

  const totalHits = all.reduce((n, r) => n + r.hit_records, 0);

  if (mode === "dry-run") {
    console.log(`dry-run  hit_records ${totalHits}`);
    process.exit(totalHits > 0 ? 1 : 0);
  }

  console.log("apply  rewriting/deleting hit records");
  for (const fn of appliers) await fn();

  // Re-scan D1 + KV after apply.
  const again: StoreScanResult[] = [];
  for (const ns of bindings.kv_namespaces) {
    const names = await listKvKeys(accountId, ns.id, token);
    const records: StoreRecord[] = [];
    for (const name of names) {
      records.push({
        id: name,
        store: `kv:${ns.binding}`,
        value: await getKv(accountId, ns.id, name, token),
      });
    }
    again.push(scanStoreRecords(`kv:${ns.binding}`, records));
  }
  for (const db of bindings.d1_databases) {
    const { results } = scanD1Database(db.database_name, envName);
    again.push(...results);
  }
  for (const r of again) console.log(printStoreScan(r));
  const leftover = again.reduce((n, r) => n + r.hit_records, 0);
  console.log(`apply  leftover_hit_records ${leftover}`);
  process.exit(leftover > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(2);
});
