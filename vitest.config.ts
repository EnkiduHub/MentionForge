/// <reference types="node" />
import { defineConfig } from "vitest/config";
import { defineWorkersProject } from "@cloudflare/vitest-pool-workers/config";

// Unit tests run in Node (default `npm test`). The workers pool project is
// configured as required, but miniflare currently breaks under the repo-wide
// Zod 4.5 override (`z.ostring`). Use `npm run test:worker` after that is fixed.

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
