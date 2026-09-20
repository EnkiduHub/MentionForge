import { describe, expect, it } from "vitest";
import { runResearch } from "../../src/lib/research/engine";
import { executionCtx, mockEnv, stubCaches, setGlobalFetch } from "../helpers/env";
import { parseResearchInput } from "../../src/schemas/research";

describe("engine failure", () => {
  it("throws SOURCE_UNAVAILABLE when every adapter errors", async () => {
    stubCaches();
    setGlobalFetch(async () => {
      throw new Error("offline");
    });
    const env = mockEnv();
    await expect(
      runResearch(env, parseResearchInput({ query: "ForgeCo", platforms: ["reddit"] }), "req", executionCtx()),
    ).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
  });
});
