import { describe, expect, it } from "vitest";
import { isPlaceholderWallet, isWallet, normalizePayTo } from "../../src/lib/constants";
import { buildPaymentRequired, paymentConfig, paymentsReady, probeFacilitator } from "../../src/lib/x402";
import { generateCdpJwt } from "../../src/lib/cdp-jwt";
import { jsonResponse, mockEnv, setGlobalFetch } from "../helpers/env";

describe("recipient wallet + EIP-712 extras", () => {
  it("accepts a MetaMask-style checksummed EOA", () => {
    // EIP-55 example from the checksum spec — same format MetaMask copies.
    expect(isWallet("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toBe(true);
    expect(isPlaceholderWallet("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toBe(false);
    expect(normalizePayTo("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toBe(
      "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed",
    );
    const env = mockEnv({ RECIPIENT_WALLET: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" });
    expect(paymentConfig(env).payTo).toBe("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed");
  });

  it("rejects ENS and the zero placeholder", () => {
    expect(isWallet("alice.eth")).toBe(false);
    expect(isWallet("0x0")).toBe(false);
    expect(isPlaceholderWallet("0x0000000000000000000000000000000000000000")).toBe(true);
  });

  it("uses USDC EIP-712 name on Base Sepolia", () => {
    const cfg = paymentConfig(mockEnv());
    expect(cfg.network).toBe("eip155:84532");
    expect(cfg.extra).toEqual({ name: "USDC", version: "2" });
    expect(buildPaymentRequired(mockEnv(), "https://mentionforge.test").accepts[0]?.extra.name).toBe("USDC");
  });

  it("uses USD Coin EIP-712 name on Base mainnet", () => {
    const env = mockEnv({
      NETWORK: "base",
      FACILITATOR_URL: "https://api.cdp.coinbase.com/platform/v2/x402",
      CDP_API_KEY_ID: "id",
      CDP_API_KEY_SECRET: "secret",
    });
    const cfg = paymentConfig(env);
    expect(cfg.network).toBe("eip155:8453");
    expect(cfg.asset).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(cfg.extra).toEqual({ name: "USD Coin", version: "2" });
    expect(buildPaymentRequired(env, "https://mentionforge.test").accepts[0]?.extra.name).toBe("USD Coin");
    expect(paymentsReady(env)).toBe(true);
  });

  it("refuses Base mainnet while pointed at the testnet-only x402.org facilitator", () => {
    const env = mockEnv({ NETWORK: "base", FACILITATOR_URL: "https://x402.org/facilitator" });
    expect(paymentsReady(env)).toBe(false);
  });

  it("refuses CDP mainnet facilitator without API keys", () => {
    const env = mockEnv({
      NETWORK: "base",
      FACILITATOR_URL: "https://api.cdp.coinbase.com/platform/v2/x402",
    });
    expect(paymentsReady(env)).toBe(false);
  });

  it("JWT payload uses CDP SDK uris claim", async () => {
    const seedBytes = crypto.getRandomValues(new Uint8Array(32));
    let seedBin = "";
    for (const b of seedBytes) seedBin += String.fromCharCode(b);
    const seed = btoa(seedBin);
    const jwt = await generateCdpJwt({
      apiKeyId: "key-id",
      apiKeySecret: seed,
      requestMethod: "GET",
      requestHost: "api.cdp.coinbase.com",
      requestPath: "/platform/v2/x402/supported",
    });
    const part = jwt.split(".")[1] ?? "";
    const pad = part.length % 4 === 0 ? "" : "=".repeat(4 - (part.length % 4));
    const payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/") + pad)) as {
      iss: string;
      uris: string[];
      uri: string;
    };
    expect(payload.iss).toBe("cdp");
    expect(payload.uris).toEqual(["GET api.cdp.coinbase.com/platform/v2/x402/supported"]);
    expect(payload.uri).toBe("GET api.cdp.coinbase.com/platform/v2/x402/supported");
  });

  it("probeFacilitator is false when kinds omit the env network", async () => {
    const prev = setGlobalFetch(async () =>
      jsonResponse({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453" }] }),
    );
    try {
      const env = mockEnv();
      const probe = await probeFacilitator(env);
      expect(probe.ok).toBe(false);
      expect(probe.network_supported).toBe(false);
    } finally {
      setGlobalFetch(prev);
    }
  });
});
