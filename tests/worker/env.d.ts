/// <reference types="@cloudflare/workers-types" />

declare module "cloudflare:test" {
  export const env: Env;
  export function createExecutionContext(): ExecutionContext;
  export function waitOnExecutionContext(ctx: ExecutionContext): Promise<void>;
}
