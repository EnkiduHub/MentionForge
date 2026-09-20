import { describe, expect, it } from "vitest";
import { lookupIdempotency, storeIdempotency } from "../../src/lib/idempotency";
import { consumeTrial } from "../../src/lib/trial";
import { EXAMPLE_RESPONSE } from "../../src/lib/example";
import { mockEnv } from "../helpers/env";

describe("idempotency + trial", () => {
  it("conflicts when the same key is reused with a different body", async () => {
    const env = mockEnv();
    await storeIdempotency(env, "idem-key-01", "hash-a", EXAMPLE_RESPONSE, {
      amount_usdc: "0.02",
      tx_hash: "0x1",
      free_trial: false,
    });
    await expect(lookupIdempotency(env, "idem-key-01", "hash-b", "req")).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
  });

  it("replays the original billing for the same body", async () => {
    const env = mockEnv();
    await storeIdempotency(env, "idem-key-02", "hash-a", EXAMPLE_RESPONSE, {
      amount_usdc: "0.02",
      tx_hash: "0xdead",
      free_trial: false,
    });
    const hit = await lookupIdempotency(env, "idem-key-02", "hash-a", "req");
    expect(hit?.billing?.tx_hash).toBe("0xdead");
  });

  it("CAS-limits trial to 10", async () => {
    const env = mockEnv();
    const wallet = "0x2222222222222222222222222222222222222222";
    for (let i = 0; i < 10; i++) {
      expect(await consumeTrial(env, wallet, "r")).toBe(true);
    }
    expect(await consumeTrial(env, wallet, "r")).toBe(false);
  });
});
