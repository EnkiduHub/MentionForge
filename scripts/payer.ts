/// <reference types="node" />
/**
 * Shared guards for live Base mainnet x402 smoke / Bazaar seed.
 * Never logs TEST_PAYER_PRIVATE_KEY.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

export const MAINNET_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const MAINNET = "eip155:8453";
export const DEFAULT_ORIGIN = "https://mentionforge.mentionforge.workers.dev";

export function serviceOrigin(): string {
  return process.env["ORIGIN"] ?? DEFAULT_ORIGIN;
}

export function wantPayOnce(): boolean {
  return process.env["PAY_ONCE"] === "1";
}

export function loadDevVars(): Record<string, string> {
  const out: Record<string, string> = {};
  const p = resolve(".dev.vars");
  if (!existsSync(p)) return out;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    out[t.slice(0, i)] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/** Write or replace a .dev.vars key. Never logs the value. */
export function upsertDevVar(key: string, value: string): void {
  const p = resolve(".dev.vars");
  const existing = existsSync(p) ? readFileSync(p, "utf8") : "";
  const lines = existing.length ? existing.split(/\r?\n/) : [];
  let found = false;
  const next = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) {
    if (next.length && next[next.length - 1] !== "") next.push("");
    next.push(`${key}=${value}`);
  }
  const body = `${next.join("\n").replace(/\n+$/, "")}\n`;
  writeFileSync(p, body, { encoding: "utf8" });
}

export function encodePaymentHeader(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
}

export type Pricing = {
  network?: string;
  asset_address?: string;
  amount_atomic?: string;
  pay_to?: string;
  eip712?: { name?: string };
  payments_ready?: boolean;
};

export async function assertProductionReady(origin: string): Promise<Pricing> {
  const health = await fetch(`${origin}/health`);
  const healthBody = (await health.json()) as {
    payments_ready?: boolean;
    network?: string;
    facilitator_ok?: boolean;
  };
  console.log("health", health.status, {
    payments_ready: healthBody.payments_ready,
    network: healthBody.network,
    facilitator_ok: healthBody.facilitator_ok,
  });

  const pricing = await fetch(`${origin}/v1/pricing`);
  const price = (await pricing.json()) as Pricing;
  console.log("pricing", {
    network: price.network,
    asset: price.asset_address,
    amount: price.amount_atomic,
    eip712: price.eip712?.name,
    payments_ready: price.payments_ready,
  });

  if (price.network !== MAINNET) {
    throw new Error("Refusing to pay: origin is not Base mainnet (eip155:8453). Staging is Sepolia.");
  }
  if ((price.asset_address ?? "").toLowerCase() !== MAINNET_USDC.toLowerCase()) {
    throw new Error("Refusing to pay: asset is not Base mainnet USDC.");
  }
  if (price.amount_atomic !== "20000") {
    throw new Error("Refusing to pay: amount is not 20000 atomic (0.02 USDC).");
  }
  if (price.eip712?.name !== "USD Coin") {
    throw new Error("Refusing to pay: EIP-712 name must be USD Coin on mainnet.");
  }
  return price;
}

/** Strip quotes/whitespace and accept 64 hex with or without a 0x prefix. Never log the value. */
export function normalizePayerKeyInput(raw: string): string {
  const compact = raw.trim().replace(/^["']|["']$/g, "").replace(/\s+/g, "");
  if (!compact) return "";
  return compact.toLowerCase().startsWith("0x") ? `0x${compact.slice(2)}` : compact;
}

function rawKey(name: "TEST_SEED_PAYER_PRIVATE_KEY" | "TEST_PAYER_PRIVATE_KEY"): string {
  const vars = loadDevVars();
  return normalizePayerKeyInput(process.env[name] || vars[name] || "");
}

/** Prefer the distinct seed payer. CDP rejects payer === payTo (`self_send_not_allowed`). */
export function rawSigningKey(): { raw: string; source: "TEST_SEED_PAYER_PRIVATE_KEY" | "TEST_PAYER_PRIVATE_KEY" | "missing" } {
  const seed = rawKey("TEST_SEED_PAYER_PRIVATE_KEY");
  if (seed) return { raw: seed, source: "TEST_SEED_PAYER_PRIVATE_KEY" };
  const payer = rawKey("TEST_PAYER_PRIVATE_KEY");
  if (payer) return { raw: payer, source: "TEST_PAYER_PRIVATE_KEY" };
  return { raw: "", source: "missing" };
}

export function describePayerKey(): {
  kind: "missing" | "address" | "private_key" | "invalid";
  hexChars: number;
  source?: "TEST_SEED_PAYER_PRIVATE_KEY" | "TEST_PAYER_PRIVATE_KEY";
  derivedAddress?: string;
} {
  const { raw, source } = rawSigningKey();
  if (!raw || source === "missing") return { kind: "missing", hexChars: 0 };
  const prefixed = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (/^0x[0-9a-fA-F]{64}$/.test(prefixed)) {
    const account = privateKeyToAccount(prefixed as `0x${string}`);
    return { kind: "private_key", hexChars: 64, source, derivedAddress: account.address };
  }
  if (/^0x[0-9a-fA-F]{40}$/.test(prefixed)) return { kind: "address", hexChars: 40, source };
  const hex = prefixed.startsWith("0x") ? prefixed.slice(2) : prefixed;
  return { kind: "invalid", hexChars: hex.length, source };
}

export function readFunderPrivateKey(): `0x${string}` {
  return parsePrivateKey(rawKey("TEST_PAYER_PRIVATE_KEY"), "TEST_PAYER_PRIVATE_KEY");
}

export function readPayerPrivateKey(): `0x${string}` {
  const { raw, source } = rawSigningKey();
  return parsePrivateKey(raw, source === "missing" ? "TEST_PAYER_PRIVATE_KEY" : source);
}

function parsePrivateKey(raw: string, label: string): `0x${string}` {
  const key = raw.startsWith("0x") ? raw : raw ? `0x${raw}` : "";
  if (/^0x[0-9a-fA-F]{40}$/.test(key)) {
    throw new Error(
      `${label} is a 40-character public address (same shape as RECIPIENT_WALLET / payTo). Put a Base account private key: 0x + 64 hex (MetaMask Account details → Show private key). Never the recipient address or a seed phrase.`,
    );
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      `PAY_ONCE=1 requires a 0x + 64 hex buyer key. CDP rejects payer === payTo (self_send_not_allowed). Run npm run fund-seed-payer, or set TEST_SEED_PAYER_PRIVATE_KEY to a different funded Base account than RECIPIENT_WALLET.`,
    );
  }
  return key as `0x${string}`;
}

/** CDP facilitator returns self_send_not_allowed when authorization.from === payTo. */
export function assertPayerDiffersFromPayTo(payer: string, payTo: string | undefined): void {
  if (!payTo) return;
  if (payer.toLowerCase() === payTo.toLowerCase()) {
    throw new Error(
      `CDP rejects self_send_not_allowed: payer ${payer} equals payTo. Keep RECIPIENT_WALLET as the revenue address. Fund a different EOA with npm run fund-seed-payer (writes TEST_SEED_PAYER_PRIVATE_KEY) and retry PAY_ONCE.`,
    );
  }
}

export function payerClient(key: `0x${string}`) {
  const account = privateKeyToAccount(key);
  const client = new x402Client().register(MAINNET, new ExactEvmScheme(account));
  return { account, client };
}

export function assertAcceptsMainnet(acc: { network?: string; asset?: string; extra?: { name?: string } } | undefined): void {
  if (!acc) throw new Error("402 accepts are missing");
  if (acc.network !== MAINNET || (acc.asset ?? "").toLowerCase() !== MAINNET_USDC.toLowerCase()) {
    throw new Error(`402 accepts are not Base mainnet USDC: ${JSON.stringify(acc)}`);
  }
  if (acc.extra?.name !== "USD Coin") {
    throw new Error(`402 extra.name is not USD Coin: ${JSON.stringify(acc.extra)}`);
  }
}
