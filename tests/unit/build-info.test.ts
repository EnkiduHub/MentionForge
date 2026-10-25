import { describe, expect, it } from "vitest";
import { getBuildInfo } from "../../src/lib/build-identity";
import { createApp } from "../../src/app";
import { executionCtx, mockEnv, stubCaches, stubSourcesFetch } from "../helpers/env";

const app = createApp();

describe("build identity", () => {
  it("exposes sha and built_at with a local-dev fallback", () => {
    const build = getBuildInfo();
    expect(build).toEqual({
      sha: expect.stringMatching(/^(dev|[0-9a-f]{4,40})$/i),
      built_at: build.sha === "dev" ? null : expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
    if (build.sha === "dev") {
      expect(build.built_at).toBeNull();
    }
  });

  it("GET /health includes build next to version", async () => {
    stubCaches();
    stubSourcesFetch();
    const res = await app.fetch(
      new Request("https://mentionforge.test/health"),
      mockEnv(),
      executionCtx(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      version: string;
      build: { sha: string; built_at: string | null };
      payments_ready: boolean;
    };
    expect(body.version).toBe("1.2.2");
    expect(body.build).toEqual({
      sha: expect.stringMatching(/^(dev|[0-9a-f]{4,40})$/i),
      built_at: body.build.sha === "dev" ? null : expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(Object.keys(body).indexOf("build")).toBe(Object.keys(body).indexOf("version") + 1);
    expect(body.payments_ready).toBeTypeOf("boolean");
  });
});
