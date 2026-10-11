/// <reference types="node" />
import { defineConfig } from "vitest/config";
import { defineWorkersProject } from "@cloudflare/vitest-pool-workers/config";

// Unit tests run in Node (`npm test`). Worker tests: `npm run test:worker`.
// remoteBindings:false keeps the pool from opening a wrangler remote proxy
// (Workers AI is paid). Pool ^0.12.21 is the last line that peers vitest 3.2.

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
      defineWorkersProject({
        test: {
          name: "worker",
          include: ["tests/worker/**/*.test.ts"],
          poolOptions: {
            workers: {
              remoteBindings: false,
              wrangler: { configPath: "./wrangler.jsonc" },
              miniflare: {
                bindings: {
                  SANDBOX_KEY: "test-sandbox",
                  OPERATOR_TOKEN: "test-operator",
                  RECIPIENT_WALLET: "0x0000000000000000000000000000000000000000",
                },
              },
            },
          },
        },
      }),
    ],
  },
});
