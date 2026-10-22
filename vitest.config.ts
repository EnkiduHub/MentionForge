/// <reference types="node" />
import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";

// Unit tests run in Node (`npm test`). Worker tests: `npm run test:worker`.
// remoteBindings:false keeps the pool from opening a wrangler remote proxy
// (Workers AI is paid). @cloudflare/vitest-plugin is the vitest-pool-workers
// successor (0.23.0+ / v1) and peers vitest ^4.1.

export default defineConfig({
  test: {
    restoreMocks: true,
    clearMocks: true,
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        plugins: [
          cloudflareTest({
            remoteBindings: false,
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              bindings: {
                SANDBOX_KEY: "test-sandbox",
                OPERATOR_TOKEN: "test-operator",
                RECIPIENT_WALLET: "0x0000000000000000000000000000000000000000",
              },
            },
          }),
        ],
        test: {
          name: "worker",
          include: ["tests/worker/**/*.test.ts"],
        },
      },
    ],
  },
});
