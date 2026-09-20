/// <reference types="node" />
/**
 * Shared guards for live Base mainnet x402 smoke / Bazaar seed.
 * Never logs TEST_PAYER_PRIVATE_KEY.
 */
import { existsSync, readFileSync } from "node:fs";
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
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    out[t.slice(0, i)] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
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

export function describePayerKey(): { kind: "missing" | "address" | "private_key" | "invalid"; hexChars: number } {
  const raw = (process.env["TEST_PAYER_PRIVATE_KEY"] || loadDevVars()["TEST_PAYER_PRIVATE_KEY"] || "").trim();
  if (!raw) return { kind: "missing", hexChars: 0 };
  if (/^0x[0-9a-fA-F]{64}$/.test(raw)) return { kind: "private_key", hexChars: 64 };
  if (/^0x[0-9a-fA-F]{40}$/.test(raw)) return { kind: "address", hexChars: 40 };
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
  return { kind: "invalid", hexChars: hex.length };
}

export function readPayerPrivateKey(): `0x${string}` {
  const key = (process.env["TEST_PAYER_PRIVATE_KEY"] || loadDevVars()["TEST_PAYER_PRIVATE_KEY"] || "").trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(key)) {
    throw new Error(
      "TEST_PAYER_PRIVATE_KEY is a 40-character public address (same shape as RECIPIENT_WALLET / payTo). Put the funded Base account private key: 0x + 64 hex (MetaMask Account details → Show private key). Never the recipient address or a seed phrase.",
    );
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("PAY_ONCE=1 requires TEST_PAYER_PRIVATE_KEY (0x + 64 hex). Export one MetaMask account key, not a seed phrase.");
  }
  return key as `0x${string}`;
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
