/**
 * Guessed paths with no page of their own (/pricing, /docs, /install) 301 to the landing section
 * that answers them. Writes and the JSON price list are untouched.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PATH_ALIASES, createApp, pathAliasRedirect } from "../../src/app";
import { executionCtx, mockEnv, stubCaches, stubSourcesFetch } from "../helpers/env";

const ORIGIN = "https://mentionforge.test";
const app = createApp();

describe("path aliases", () => {
  beforeEach(() => {
    stubCaches();
    stubSourcesFetch();
  });

  it("GET and HEAD /pricing, /docs, /install 301 to their landing section", async () => {
    for (const [path, location] of [
      ["/pricing", "/#pricing"],
      ["/pricing/", "/#pricing"],
      ["/docs", "/#install"],
      ["/docs/", "/#install"],
      ["/install", "/#install"],
    ] as const) {
      for (const method of ["GET", "HEAD"]) {
        const res = await app.fetch(new Request(`${ORIGIN}${path}`, { method }), mockEnv(), executionCtx());
        expect(res.status, `${method} ${path}`).toBe(301);
        expect(res.headers.get("location"), `${method} ${path}`).toBe(location);
      }
    }
  });

  it("every alias points at a section id that exists on the landing page", async () => {
    const { readFileSync } = await import("node:fs");
    const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
    for (const target of Object.values(PATH_ALIASES)) {
      const id = target.split("#")[1];
      expect(html, target).toContain(`id="${id}"`);
    }
  });

  it("writes, the JSON price list, and other paths are never aliased", () => {
    expect(pathAliasRedirect("POST", `${ORIGIN}/pricing`)).toBeNull();
    expect(pathAliasRedirect("GET", `${ORIGIN}/v1/pricing`)).toBeNull();
    expect(pathAliasRedirect("GET", `${ORIGIN}/pricing/extra`)).toBeNull();
    expect(pathAliasRedirect("GET", `${ORIGIN}/about`)).toBeNull();
  });

  it("no alias shadows a registered route", () => {
    const routes = new Set(createApp().routes.map((r) => r.path));
    for (const path of Object.keys(PATH_ALIASES)) expect(routes.has(path), path).toBe(false);
  });
});
