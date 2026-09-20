/**
 * CDP Secret API key JWT (ES256 or Ed25519) for facilitator verify/settle/supported.
 * Matches @coinbase/cdp-sdk generateJwt: iss=cdp, sub=key id, uris=["METHOD host/path"].
 * Older Coinbase App docs used a string `uri` claim; x402 facilitator auth requires `uris`.
 */
export async function generateCdpJwt(opts: {
  apiKeyId: string;
  apiKeySecret: string;
  requestMethod: string;
  requestHost: string;
  requestPath: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const requestUri = `${opts.requestMethod} ${opts.requestHost}${opts.requestPath}`;
  const payload = {
    iss: "cdp",
    nbf: now,
    exp: now + 120,
    sub: opts.apiKeyId,
    uris: [requestUri],
    uri: requestUri,
  };
  const secret = opts.apiKeySecret.replace(/\\n/g, "\n").trim();
  if (secret.includes("BEGIN")) {
    return signEs256(opts.apiKeyId, nonce, secret, payload);
  }
  return signEd25519(opts.apiKeyId, nonce, secret, payload);
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function jsonB64(obj: unknown): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function signEd25519(kid: string, nonce: string, secret: string, payload: object): Promise<string> {
  const raw = Uint8Array.from(atob(secret.replace(/\s/g, "")), (c: string) => c.charCodeAt(0));
  const seed = raw.byteLength >= 32 ? raw.subarray(0, 32) : raw;
  const pkcs8 = new Uint8Array(48);
  pkcs8.set([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20], 0);
  pkcs8.set(seed, 16);
  const key = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, false, ["sign"]);
  const header = jsonB64({ alg: "EdDSA", kid, nonce, typ: "JWT" });
  const body = jsonB64(payload);
  const data = new TextEncoder().encode(`${header}.${body}`);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key, data));
  return `${header}.${body}.${b64url(sig)}`;
}

async function signEs256(kid: string, nonce: string, pem: string, payload: object): Promise<string> {
  const pkcs8 = pemToPkcs8(pem);
  const key = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = jsonB64({ alg: "ES256", kid, nonce, typ: "JWT" });
  const body = jsonB64(payload);
  const data = new TextEncoder().encode(`${header}.${body}`);
  const der = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, data));
  return `${header}.${body}.${b64url(derToJose(der))}`;
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const der = Uint8Array.from(atob(b64), (c: string) => c.charCodeAt(0));
  if (pem.includes("BEGIN PRIVATE KEY")) return der.buffer;
  return wrapSec1P256(der);
}

/** SEC1 EC PRIVATE KEY → PKCS8 for P-256. */
function wrapSec1P256(sec1: Uint8Array): ArrayBuffer {
  const inner = sec1;
  const alg = Uint8Array.from([
    0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03,
    0x01, 0x07,
  ]);
  const seqLen = 1 + 1 + alg.length + 1 + 1 + inner.length;
  const out = new Uint8Array(2 + seqLen);
  out[0] = 0x30;
  out[1] = seqLen;
  out[2] = 0x02;
  out[3] = 0x01;
  out[4] = 0x00;
  out.set(alg, 5);
  const octOff = 5 + alg.length;
  out[octOff] = 0x04;
  out[octOff + 1] = inner.length;
  out.set(inner, octOff + 2);
  return out.buffer;
}

function derToJose(der: Uint8Array): Uint8Array {
  let offset = 2;
  if (der[0] !== 0x30) return der;
  const len0 = der[1];
  if (len0 === undefined) return der;
  if (len0 & 0x80) offset += len0 & 0x7f;
  const readInt = (): Uint8Array => {
    const tag = der[offset];
    const len = der[offset + 1];
    if (tag !== 0x02 || len === undefined) throw new Error("bad ecdsa der");
    offset += 2;
    let bytes = der.subarray(offset, offset + len);
    offset += len;
    while (bytes.length > 32 && bytes[0] === 0) bytes = bytes.subarray(1);
    if (bytes.length > 32) bytes = bytes.subarray(bytes.length - 32);
    if (bytes.length < 32) {
      const padded = new Uint8Array(32);
      padded.set(bytes, 32 - bytes.length);
      return padded;
    }
    return bytes;
  };
  const r = readInt();
  const s = readInt();
  const out = new Uint8Array(64);
  out.set(r, 0);
  out.set(s, 32);
  return out;
}
