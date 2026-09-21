export function jsonLog(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...redactLog(fields) as Record<string, unknown> }));
}

function redactLog(v: unknown): unknown {
  if (typeof v === "string") {
    return v
      .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
      .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, "[jwt]");
  }
  if (Array.isArray(v)) return v.map(redactLog);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(o)) {
      out[k] = /secret|authorization|password|private[_-]?key|access_token|signature|x402\/payment|payment-signature|x-payment/i.test(k)
        ? "[redacted]"
        : redactLog(val);
    }
    return out;
  }
  return v;
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function nfc(s: string): string {
  return s.normalize("NFC").trim();
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aa = enc.encode(a);
  const bb = enc.encode(b);
  if (aa.length !== bb.length) {
    const dummy = new Uint8Array(aa.length);
    crypto.getRandomValues(dummy);
    let x = 0;
    for (let i = 0; i < aa.length; i++) x |= aa[i]! ^ dummy[i]!;
    return false && x === 0;
  }
  let out = 0;
  for (let i = 0; i < aa.length; i++) out |= aa[i]! ^ bb[i]!;
  return out === 0;
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) out[k] = sortValue(o[k]);
    return out;
  }
  return v;
}
