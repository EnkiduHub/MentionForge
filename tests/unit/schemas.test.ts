import { describe, expect, it } from "vitest";
import { parseResearchInput, researchResponseSchema } from "../../src/schemas/research";
import { EXAMPLE_RESPONSE } from "../../src/lib/example";
import { SAMPLE_QUERY } from "../../src/lib/constants";
import { AgentError } from "../../src/schemas/errors";

describe("research schemas", () => {
  it("strips unknown keys", () => {
    const parsed = parseResearchInput({ query: "ForgeCo", extra_llm_field: true, timeframe: "7d" });
    expect(parsed.query).toBe("ForgeCo");
    expect("extra_llm_field" in parsed).toBe(false);
  });

  it("rejects empty query", () => {
    expect(() => parseResearchInput({ query: "  " })).toThrow();
  });

  it("validates the live Cloudflare Workers snapshot", () => {
    expect(researchResponseSchema.parse(EXAMPLE_RESPONSE).query).toBe(SAMPLE_QUERY);
  });

  it("maps PAYMENT_REQUIRED to 402", () => {
    const err = new AgentError("PAYMENT_REQUIRED", "pay", { request_id: "r1" });
    expect(err.status()).toBe(402);
    expect(err.body().error.recoverable).toBe(true);
  });

  it("maps UNAUTHORIZED to 401", () => {
    const err = new AgentError("UNAUTHORIZED", "nope", { request_id: "r1" });
    expect(err.status()).toBe(401);
    expect(err.body().error.recoverable).toBe(true);
  });
});
