import { describe, expect, it } from "vitest";
import { isPlaceholderWallet, isWallet, normalizePayTo, SERVICE_NAME } from "../../src/lib/constants";
import { attachBazaarCatalog, bazaarCatalogLog, bazaarHttpExtension, BAZAAR_RESOURCE_DESC, BAZAAR_TAGS, BAZAAR_TOOL_DESC, buildPaymentRequired, discoveryResource, paymentConfig, paymentsReady, probeFacilitator } from "../../src/lib/x402";
import { generateCdpJwt } from "../../src/lib/cdp-jwt";
import { jsonResponse, mockEnv, setGlobalFetch } from "../helpers/env";

describe("recipient wallet + EIP-712 extras", () => {
  it("accepts a MetaMask-style checksummed EOA", () => {
    // EIP-55 example from the checksum spec — same format MetaMask copies.
    expect(isWallet("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toBe(true);
    expect(isPlaceholderWallet("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toBe(false);
    expect(normalizePayTo("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toBe(
      "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    );
    expect(normalizePayTo("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed")).toBe(
      "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    );
    const env = mockEnv({ RECIPIENT_WALLET: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" });
    expect(paymentConfig(env).payTo).toBe("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed");
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

  it("REST 402 advertises HTTPS HTTP bazaar metadata without wallets", () => {
    const doc = buildPaymentRequired(mockEnv(), "https://mentionforge.test");
    expect(doc.resource.url).toBe("https://mentionforge.test/v1/research");
    expect(doc.resource.url).not.toMatch(/^mcp:/);
    expect(doc.resource.serviceName).toBe("MentionForge");
    expect(doc.resource.tags).toContain("social listening");
    expect(doc.resource.tags).toContain("brand sentiment");
    expect(doc.resource.tags).toContain("research_mentions");
    expect(doc.resource.description).toBe(BAZAAR_RESOURCE_DESC);
    expect(doc.resource.description.length).toBeLessThanOrEqual(480);
    expect(doc.resource.description).toMatch(/brand sentiment/);
    expect(doc.resource.description).toMatch(/social listening/);
    expect(doc.resource.description).toMatch(/research_mentions/);
    expect(doc.resource.description).toMatch(/MentionForge/);
    expect(doc.resource.description).toMatch(/web_search/);
    expect(doc.resource.description).toMatch(/\$0\.02 USDC/);
    expect(doc.resource.description).not.toMatch(/0x[a-fA-F0-9]{40}/);
    expect(doc.resource.description).toMatch(/not a native Reddit or X feed/);
    expect(doc.resource.description).not.toMatch(/native Reddit\/X APIs are the default/);
    const input = (doc.extensions as { bazaar?: { info?: { input?: { type?: string; method?: string; bodyType?: string } } } } | undefined)
      ?.bazaar?.info?.input;
    expect(input?.type).toBe("http");
    expect(input?.method).toBe("POST");
    expect(input?.bodyType).toBe("json");
    expect(SERVICE_NAME.length).toBeLessThanOrEqual(32);
    expect(BAZAAR_TAGS).toHaveLength(5);
    for (const tag of BAZAAR_TAGS) {
      expect(tag.length).toBeGreaterThan(0);
      expect(tag.length).toBeLessThanOrEqual(32);
      expect(tag).toMatch(/^[\x20-\x7e]+$/);
    }
    expect(BAZAAR_TOOL_DESC).toMatch(/MentionForge/);
    expect(BAZAAR_TOOL_DESC).toMatch(/social listening/);
    expect(BAZAAR_TOOL_DESC).toMatch(/brand sentiment/);
    expect(BAZAAR_TOOL_DESC).toMatch(/research_mentions/);
    expect(BAZAAR_TOOL_DESC).toMatch(/web_search/);
    expect(BAZAAR_TOOL_DESC).toMatch(/\$0\.02 USDC/);
    expect(BAZAAR_TOOL_DESC.length).toBeLessThanOrEqual(480);
    expect(BAZAAR_TOOL_DESC).toMatch(/not a native Reddit or X feed/);
  });

  it("research_mentions alias keeps the HTTP bazaar type and a distinct resource URL", () => {
    const doc = buildPaymentRequired(mockEnv(), "https://mentionforge.test", "Payment required for research.", "research_mentions");
    expect(doc.resource.url).toBe("https://mentionforge.test/v1/research_mentions");
    expect(doc.resource.url).toContain("research_mentions");
    expect(doc.resource.description).toBe(BAZAAR_RESOURCE_DESC);
    expect(doc.accepts[0]?.amount).toBe(buildPaymentRequired(mockEnv(), "https://mentionforge.test").accepts[0]?.amount);
    const input = (doc.extensions as { bazaar?: { info?: { input?: { type?: string; method?: string } } } } | undefined)
      ?.bazaar?.info?.input;
    expect(input?.type).toBe("http");
    expect(input?.method).toBe("POST");
  });

  it("attachBazaarCatalog fills missing resource and bazaar without copying signatures into logs", () => {
    const attached = attachBazaarCatalog(
      { x402Version: 2, payload: { signature: "0xsecret" } },
      discoveryResource("https://mentionforge.test", "http"),
      bazaarHttpExtension,
    ) as { resource?: { url?: string }; extensions?: { bazaar?: { info?: { input?: { type?: string } } } } };
    expect(attached.resource?.url).toBe("https://mentionforge.test/v1/research");
    expect(attached.extensions?.bazaar?.info?.input?.type).toBe("http");
    const replaced = attachBazaarCatalog(
      { x402Version: 2, resource: { url: "mcp://tool/research_mentions" } },
      discoveryResource("https://mentionforge.test", "mcp"),
    ) as { resource?: { url?: string } };
    expect(replaced.resource?.url).toBe("https://mentionforge.test/mcp");
    const log = bazaarCatalogLog({
      x402Version: 2,
      payload: { signature: "0xsecret" },
      resource: attached.resource,
      extensions: attached.extensions,
    });
    expect(JSON.stringify(log)).not.toMatch(/0xsecret/);
    expect(JSON.stringify(log)).not.toMatch(/private/i);
    expect(log.resource_url).toBe("https://mentionforge.test/v1/research");
    expect(log.bazaar_type).toBe("http");
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
