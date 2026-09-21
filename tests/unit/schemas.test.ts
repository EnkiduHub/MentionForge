import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  parseResearchInput,
  researchJsonSchema,
  researchRequestSchema,
  researchResponseSchema,
  REQUEST_FIELD_DESC,
} from "../../src/schemas/research";
import { EXAMPLE_RESPONSE } from "../../src/lib/example";
import { SAMPLE_QUERY } from "../../src/lib/constants";
import { AgentError } from "../../src/schemas/errors";

function jsonProps(schema: z.ZodType, io: "input" | "output" = "input"): Record<string, { description?: string }> {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12", io }) as {
    properties?: Record<string, { description?: string }>;
  };
  return json.properties ?? {};
}

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

  it("describes every research request field for MCP JSON Schema", () => {
    const props = jsonProps(researchRequestSchema);
    for (const key of ["query", "platforms", "timeframe", "limit", "include_summary", "min_engagement", "language"] as const) {
      expect(props[key]?.description?.length ?? 0, key).toBeGreaterThan(20);
    }
    expect(props.query?.description).toBe(REQUEST_FIELD_DESC.query);
  });

  it("describes key research response fields for MCP JSON Schema", () => {
    const props = jsonProps(researchResponseSchema, "output");
    for (const key of ["query", "timeframe", "volume", "sentiment", "themes", "mentions", "summary", "citations", "meta"] as const) {
      expect(props[key]?.description?.length ?? 0, key).toBeGreaterThan(8);
    }
  });

  it("mirrors request field descriptions into researchJsonSchema()", () => {
    const openapi = researchJsonSchema().properties;
    expect(openapi.query.description).toBe(REQUEST_FIELD_DESC.query);
    expect(openapi.platforms.description).toBe(REQUEST_FIELD_DESC.platforms);
    expect(openapi.timeframe.description).toBe(REQUEST_FIELD_DESC.timeframe);
    expect(openapi.limit.description).toBe(REQUEST_FIELD_DESC.limit);
    expect(openapi.include_summary.description).toBe(REQUEST_FIELD_DESC.include_summary);
    expect(openapi.min_engagement.description).toBe(REQUEST_FIELD_DESC.min_engagement);
    expect(openapi.language.description).toBe(REQUEST_FIELD_DESC.language);
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
