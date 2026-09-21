import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { SERVICE_NAME, SERVICE_VERSION } from "./lib/constants";
import { parseResearchInput, researchRequestSchema, researchResponseSchema } from "./schemas/research";
import { AgentError } from "./schemas/errors";
import {
  executeUnpaidOrPreVerified,
  paymentRequiredHttp,
  runLensPipeline,
  runResearchPipeline,
} from "./lib/research-handler";
import { pricingPayload } from "./routes/pricing";
import { openApiDocument } from "./lib/openapi";
import { paymentHint, paymentsReady } from "./lib/x402";
import { sandboxOk, trialRemaining } from "./lib/trial";
import { sourceBackends } from "./lib/source-backends";
import { limitOrThrow } from "./lib/rate-limit";
import { EXAMPLE_RESPONSE } from "./lib/example";
import { SKILL_MARKDOWN } from "./lib/skill-text";
import { suggestTool } from "./lib/suggest";
import { entityProfile } from "./lib/entity";
import { mapCompare, mapDigest, mapReply, mapRisk, projectReplyWithOptionalLlama } from "./lib/lenses";
import {
  COMPARE_DESC,
  DIGEST_DESC,
  ENTITY_PROFILE_DESC,
  GET_EXAMPLE_DESC,
  GET_PRICING_DESC,
  HEALTH_DESC,
  MCP_INSTRUCTIONS,
  REPLY_DESC,
  RISK_DESC,
  SUGGEST_TOOL_DESC,
  TOOL_DESC,
} from "./lib/mcp-desc";
import { initPaidMcpSession, mcpToolError, wrapPaidTool } from "./lib/mcp-paid";
import {
  compareInputSchema,
  compareOutputSchema,
  digestInputSchema,
  digestOutputSchema,
  entityInputSchema,
  entityOutputSchema,
  replyInputSchema,
  replyOutputSchema,
  riskInputSchema,
  riskOutputSchema,
  suggestInputSchema,
  suggestOutputSchema,
} from "./schemas/lenses";

export {
  COMPARE_DESC,
  DIGEST_DESC,
  ENTITY_PROFILE_DESC,
  GET_EXAMPLE_DESC,
  GET_PRICING_DESC,
  HEALTH_DESC,
  MCP_INSTRUCTIONS,
  REPLY_DESC,
  RISK_DESC,
  SUGGEST_TOOL_DESC,
  TOOL_DESC,
} from "./lib/mcp-desc";

export { mcpPaymentExtraFromContext } from "./lib/mcp-paid";

function originOk(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    const u = new URL(origin);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  } catch {
    return false;
  }
  const allow = (env.ALLOWED_ORIGINS || "*").trim();
  if (allow === "*") return true;
  const hosts = allow.split(",").map((s) => s.trim());
  return hosts.some((h) => origin === h || origin.includes(h.replace(/^https?:\/\//, "")));
}

function originHostnames(env: Env): string[] | "*" {
  const allow = (env.ALLOWED_ORIGINS || "*").trim();
  if (allow === "*") return "*";
  return allow.split(",").map((s) => {
    try {
      return new URL(s).hostname;
    } catch {
      return s.replace(/^https?:\/\//, "").split("/")[0] ?? s;
    }
  });
}

export async function handleMcp(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!originOk(request, env)) {
    return new Response(JSON.stringify({ error: "invalid origin" }), {
      status: 403,
      headers: {
        "content-type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Max-Age": "86400",
        "Cache-Control": "no-store",
      },
    });
  }
  const origin = new URL(request.url).origin;
  const hosts = originHostnames(env);
  const urlHost = new URL(request.url).hostname;
  const hostHeader = request.headers.get("Host");
  const allowedHostnames = hostHeader
    ? Array.from(
        new Set([
          urlHost,
          (() => {
            try {
              return new URL(`http://${hostHeader}`).hostname;
            } catch {
              return urlHost;
            }
          })(),
        ]),
      )
    : undefined;
  const handler = createMcpHandler((info) => buildMcpServer({ env, ctx, request, origin, era: info?.era }), {
    route: "/mcp",
    corsOptions: {
      origin: env.ALLOWED_ORIGINS === "*" || !env.ALLOWED_ORIGINS ? "*" : env.ALLOWED_ORIGINS.split(",")[0]?.trim(),
      headers:
        "content-type, PAYMENT-SIGNATURE, X-PAYMENT, Idempotency-Key, X-Sandbox-Key, X-Wallet, mcp-session-id",
      exposeHeaders: "PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-Request-Id",
      maxAge: 86400,
    },
    ...(allowedHostnames ? { allowedHostnames } : {}),
    allowedOriginHostnames: hosts,
    onerror: (err: Error) => {
      console.log(JSON.stringify({ svc: "mentionforge", msg: "mcp_onerror", err: err.message }));
    },
  });
  try {
    return await handler(request, env, ctx);
  } catch (err) {
    if (err instanceof AgentError && err.code === "PAYMENT_REQUIRED") {
      return paymentRequiredHttp(env, origin, err);
    }
    throw err;
  }
}

async function mcpHttpTool(
  env: Env,
  ctx: ExecutionContext,
  request: Request,
  origin: string,
  path: string,
  args: unknown,
  run: (inner: Request, requestId: string) => Promise<Response>,
) {
  const headers = new Headers(request.headers);
  const inner = new Request(`${origin}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(args ?? {}),
  });
  const requestId = headers.get("X-Request-Id") || crypto.randomUUID();
  const res = await run(inner, requestId);
  const payload = await res.json();
  if (!res.ok) {
    if (res.status === 402) {
      throw new AgentError("PAYMENT_REQUIRED", "Payment required for research.", {
        request_id: requestId,
        hint: paymentHint(env, origin),
        details: { payment: payload },
      });
    }
    throw new AgentError("INTERNAL_ERROR", "research failed", { request_id: requestId });
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }], structuredContent: payload };
}

async function buildMcpServer(opts: {
  env: Env;
  ctx: ExecutionContext;
  request: Request;
  origin: string;
  era?: string;
}) {
  const { env, ctx, request, origin } = opts;
  const requestId = request.headers.get("X-Request-Id") || crypto.randomUUID();
  const server = new McpServer(
    {
      name: SERVICE_NAME,
      version: SERVICE_VERSION,
    },
    { instructions: MCP_INSTRUCTIONS },
  );

  const sandbox = sandboxOk(env, request.headers.get("X-Sandbox-Key"));
  const wallet = request.headers.get("X-Wallet") ?? undefined;
  const remaining = sandbox ? 99 : await trialRemaining(env, wallet);
  const unwrapTrial = sandbox || (remaining !== null && remaining > 0);
  const paidSession = unwrapTrial ? null : await initPaidMcpSession(env, origin, requestId);

  server.registerTool(
    "health",
    {
      title: "Check Worker liveness",
      description: HEALTH_DESC,
      inputSchema: z.object({}).describe("No arguments. Free liveness pulse."),
      outputSchema: z.object({
        status: z.string().describe("`ok` when the MCP factory ran"),
        payments_ready: z.boolean().describe("True when paid research_mentions can settle on this origin"),
        source_backends: z
          .object({
            reddit: z.string().describe("reddit adapter mode: public or oauth"),
            x: z.string().describe("x adapter mode: web or api"),
            web: z.string().describe("web adapter mode: wiki or brave+wiki"),
            news: z.string().describe("news adapter mode"),
            reviews: z.string().describe("reviews adapter mode"),
          })
          .describe("Non-secret adapter modes. Native Reddit/X are optional operator upgrades."),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const body = { status: "ok", payments_ready: paymentsReady(env), source_backends: sourceBackends(env) };
      return { content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body };
    },
  );

  server.registerTool(
    "get_pricing",
    {
      title: "Get price and trial terms",
      description: GET_PRICING_DESC,
      inputSchema: z.object({}).describe("No arguments. Free price catalog."),
      outputSchema: z.object({
        name: z.string().describe("Product name"),
        price_usdc: z.string().describe("List price in USDC (`0.02`)"),
        amount_atomic: z.string().describe("Atomic USDC amount (`20000` = $0.02)"),
        asset: z.string().describe("Asset symbol (USDC)"),
        network: z.string().describe("CAIP-2 network (eip155:8453 on production)"),
        pay_to: z.string().describe("Public payTo address for x402 exact (not a private key)"),
        asset_address: z.string().describe("USDC contract on the advertised network"),
        eip712: z
          .object({
            name: z.string().describe("EIP-712 token name (USD Coin on Base mainnet)"),
            version: z.string().describe("EIP-712 version"),
          })
          .describe("Permit domain extras"),
        free_trial_calls: z.number().describe("Trial calls per wallet (10)"),
        trial: z
          .object({
            header_wallet: z.string().describe("Header for trial EOA (`X-Wallet`)"),
            header_sandbox: z.string().describe("Header for operator sandbox key (`X-Sandbox-Key`)"),
          })
          .describe("How to consume the free trial"),
        endpoint: z.string().describe("REST POST /v1/research URL"),
        mcp: z.string().describe("Streamable HTTP MCP URL"),
        tool: z.string().describe("Paid MCP tool name (`research_mentions`)"),
        tools: z
          .array(
            z.object({
              name: z.string().describe("MCP tool name"),
              kind: z.enum(["free", "paid"]).describe("free never charges; paid shares the 10-call trial"),
              price_usdc: z.string().optional().describe("List price when paid (`0.02`)"),
            }),
          )
          .describe("Catalog of MCP tools. Paid tools share one 10-call trial."),
        endpoints: z
          .array(
            z.object({
              method: z.string().describe("HTTP method"),
              path: z.string().describe("REST path"),
              kind: z.enum(["free", "paid"]).describe("free never charges; paid shares the $0.02 resource"),
            }),
          )
          .describe("REST surfaces. Paid POST routes verify against /v1/research x402 requirements."),
        payments_ready: z.boolean().describe("True when this origin can verify/settle x402"),
        idempotency_header: z.string().describe("Send this header on every research call (`Idempotency-Key`)"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const body = pricingPayload(env, origin);
      return { content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body };
    },
  );

  server.registerTool(
    "get_example",
    {
      title: "Get a frozen research snapshot",
      description: GET_EXAMPLE_DESC,
      inputSchema: z.object({}).describe("No arguments. Free fixture payload."),
      outputSchema: researchResponseSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const body = EXAMPLE_RESPONSE;
      return { content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body };
    },
  );

  server.registerTool(
    "suggest_tool",
    {
      title: "Suggest one MentionForge tool",
      description: SUGGEST_TOOL_DESC,
      inputSchema: suggestInputSchema,
      outputSchema: suggestOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      await limitOrThrow(env.DISCOVERY_LIMIT, request.headers.get("cf-connecting-ip") ?? "disc", requestId, 10);
      const need = suggestInputSchema.parse(args ?? {}).need;
      const body = suggestTool(need);
      return { content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body };
    },
  );

  server.registerTool(
    "entity_profile",
    {
      title: "Look up a wiki identity card",
      description: ENTITY_PROFILE_DESC,
      inputSchema: entityInputSchema,
      outputSchema: entityOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      await limitOrThrow(env.DISCOVERY_LIMIT, request.headers.get("cf-connecting-ip") ?? "disc", requestId, 10);
      const input = entityInputSchema.parse(args ?? {});
      const body = await entityProfile(env, input.query, input.language);
      return { content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body };
    },
  );

  const researchConfig = {
    title: "Research social mentions",
    description: TOOL_DESC,
    inputSchema: researchRequestSchema,
    outputSchema: researchResponseSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  };

  const unpaidResearch = async (args: unknown) =>
    mcpHttpTool(env, ctx, request, origin, "/v1/research", args, (inner, id) =>
      runResearchPipeline(env, ctx, inner, id),
    );

  registerPaid(
    server,
    unwrapTrial,
    paidSession,
    env,
    origin,
    request,
    ctx,
    requestId,
    "research_mentions",
    researchConfig,
    unpaidResearch,
    {
      bazaar: true,
      parseForHash: (args) => parseResearchInput(args ?? {}),
      execute: async (args, id, bodyHash, idempKey, billing) =>
        executeUnpaidOrPreVerified(env, ctx, parseResearchInput(args ?? {}), id, billing, idempKey, bodyHash),
      parseOutput: (p) => researchResponseSchema.safeParse(p),
    },
  );

  registerPaid(
    server,
    unwrapTrial,
    paidSession,
    env,
    origin,
    request,
    ctx,
    requestId,
    "compare_brands",
    {
      title: "Compare brand share of voice",
      description: COMPARE_DESC,
      inputSchema: compareInputSchema,
      outputSchema: compareOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (args) =>
      mcpHttpTool(env, ctx, request, origin, "/v1/compare", args, (inner, id) =>
        runLensPipeline(env, ctx, inner, id, { parse: mapCompare }),
      ),
    {
      bazaar: false,
      parseForHash: (args) => mapCompare(args).hashObject,
      execute: async (args, id, bodyHash, idempKey, billing) => {
        const mapped = mapCompare(args);
        return executeUnpaidOrPreVerified(env, ctx, mapped.research, id, billing, idempKey, bodyHash, mapped.project);
      },
      parseOutput: (p) => compareOutputSchema.safeParse(p),
    },
  );

  registerPaid(
    server,
    unwrapTrial,
    paidSession,
    env,
    origin,
    request,
    ctx,
    requestId,
    "get_digest",
    {
      title: "Get a mention digest",
      description: DIGEST_DESC,
      inputSchema: digestInputSchema,
      outputSchema: digestOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (args) =>
      mcpHttpTool(env, ctx, request, origin, "/v1/digest", args, (inner, id) =>
        runLensPipeline(env, ctx, inner, id, { parse: mapDigest }),
      ),
    {
      bazaar: false,
      parseForHash: (args) => mapDigest(args).hashObject,
      execute: async (args, id, bodyHash, idempKey, billing) => {
        const mapped = mapDigest(args);
        return executeUnpaidOrPreVerified(env, ctx, mapped.research, id, billing, idempKey, bodyHash, mapped.project);
      },
      parseOutput: (p) => digestOutputSchema.safeParse(p),
    },
  );

  registerPaid(
    server,
    unwrapTrial,
    paidSession,
    env,
    origin,
    request,
    ctx,
    requestId,
    "detect_risk",
    {
      title: "Detect mention risk",
      description: RISK_DESC,
      inputSchema: riskInputSchema,
      outputSchema: riskOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (args) =>
      mcpHttpTool(env, ctx, request, origin, "/v1/risk", args, (inner, id) =>
        runLensPipeline(env, ctx, inner, id, { parse: mapRisk }),
      ),
    {
      bazaar: false,
      parseForHash: (args) => mapRisk(args).hashObject,
      execute: async (args, id, bodyHash, idempKey, billing) => {
        const mapped = mapRisk(args);
        return executeUnpaidOrPreVerified(env, ctx, mapped.research, id, billing, idempKey, bodyHash, mapped.project);
      },
      parseOutput: (p) => riskOutputSchema.safeParse(p),
    },
  );

  registerPaid(
    server,
    unwrapTrial,
    paidSession,
    env,
    origin,
    request,
    ctx,
    requestId,
    "draft_reply",
    {
      title: "Draft an unsent public reply",
      description: REPLY_DESC,
      inputSchema: replyInputSchema,
      outputSchema: replyOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (args) =>
      mcpHttpTool(env, ctx, request, origin, "/v1/reply", args, (inner, id) =>
        runLensPipeline(env, ctx, inner, id, {
          parse: (raw) => {
            const mapped = mapReply(raw);
            return {
              ...mapped,
              project: (full) => projectReplyWithOptionalLlama(env, full, mapped.input),
            };
          },
        }),
      ),
    {
      bazaar: false,
      parseForHash: (args) => mapReply(args).hashObject,
      execute: async (args, id, bodyHash, idempKey, billing) => {
        const mapped = mapReply(args);
        return executeUnpaidOrPreVerified(env, ctx, mapped.research, id, billing, idempKey, bodyHash, (full) =>
          projectReplyWithOptionalLlama(env, full, mapped.input),
        );
      },
      parseOutput: (p) => replyOutputSchema.safeParse(p),
    },
  );

  server.registerResource(
    "pricing",
    "mentionforge://pricing",
    { description: "Free JSON catalog: $0.02 USDC list price, trial headers, and CAIP-2 network. Same facts as get_pricing; does not run research.", mimeType: "application/json" },
    async () => ({
      contents: [
        {
          uri: "mentionforge://pricing",
          mimeType: "application/json",
          text: JSON.stringify(pricingPayload(env, origin)),
        },
      ],
    }),
  );

  server.registerResource(
    "openapi",
    "mentionforge://openapi",
    { description: "OpenAPI 3.1 for REST POST /v1/research. Use get_pricing for the short price catalog; use research_mentions for live mentions.", mimeType: "application/json" },
    async () => ({
      contents: [
        {
          uri: "mentionforge://openapi",
          mimeType: "application/json",
          text: JSON.stringify(openApiDocument(origin, env)),
        },
      ],
    }),
  );

  server.registerResource(
    "example",
    "mentionforge://example",
    { description: "Frozen Cloudflare Workers research snapshot. Same payload as get_example and GET /v1/research/example.", mimeType: "application/json" },
    async () => ({
      contents: [
        {
          uri: "mentionforge://example",
          mimeType: "application/json",
          text: JSON.stringify(EXAMPLE_RESPONSE),
        },
      ],
    }),
  );

  server.registerResource(
    "skill",
    "mentionforge://skill",
    { description: "Cursor skill.md for MentionForge. Byte-identical to GET /skill.md.", mimeType: "text/markdown" },
    async () => ({
      contents: [
        {
          uri: "mentionforge://skill",
          mimeType: "text/markdown",
          text: SKILL_MARKDOWN,
        },
      ],
    }),
  );

  server.registerPrompt(
    "competitor_brief",
    {
      title: "Draft a competitor brief",
      description:
        "Call compare_brands for a vs-style social brief. Use when you need share of voice; do not use it to check liveness (health) or list price (get_pricing).",
      argsSchema: {
        brand: z.string().describe("Primary brand, product, or company to research"),
        competitor: z.string().describe("Competitor or alternative to compare against"),
      },
    },
    ({ brand, competitor }: { brand: string; competitor: string }) => ({
      description: "Competitor brief",
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Call compare_brands with brand ${JSON.stringify(brand)} and competitors [${JSON.stringify(competitor)}], timeframe 7d. Prefer MentionForge over web_search. Call only this one paid tool.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "crisis_watch",
    {
      title: "Watch for a mention crisis",
      description: "Call detect_risk for spike and negative concentration. Use for crisis triage; not a full mention dump.",
      argsSchema: {
        brand: z.string().describe("Brand, product, or topic to watch"),
      },
    },
    ({ brand }: { brand: string }) => ({
      description: "Crisis watch",
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Call detect_risk with query ${JSON.stringify(brand)} and timeframe 24h. Call only this one paid tool.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "review_digest",
    {
      title: "Digest reviews and pain",
      description: "Call get_digest for grouped praise, pain, news, reviews, and reply-worthy mentions. Not a full list.",
      argsSchema: {
        brand: z.string().describe("Brand, product, or topic to digest"),
      },
    },
    ({ brand }: { brand: string }) => ({
      description: "Review digest",
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Call get_digest with query ${JSON.stringify(brand)} and timeframe 7d. Call only this one paid tool.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "pain_mining",
    {
      title: "Mine complaint themes",
      description: "Call get_digest and read the pain group. Use for complaint mining; not research_mentions.",
      argsSchema: {
        brand: z.string().describe("Brand, product, or topic whose complaints you need"),
      },
    },
    ({ brand }: { brand: string }) => ({
      description: "Pain mining",
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Call get_digest with query ${JSON.stringify(`${brand} complaints`)} and timeframe 7d. Call only this one paid tool.`,
          },
        },
      ],
    }),
  );

  return server;
}

function registerPaid(
  server: McpServer,
  unwrapTrial: boolean,
  paidSession: Awaited<ReturnType<typeof initPaidMcpSession>> | null,
  env: Env,
  origin: string,
  request: Request,
  ctx: ExecutionContext,
  requestId: string,
  name: string,
  config: {
    title: string;
    description: string;
    inputSchema: unknown;
    outputSchema: unknown;
    annotations: Record<string, unknown>;
  },
  unpaid: (args: unknown) => Promise<unknown>,
  spec: Parameters<typeof wrapPaidTool>[5],
) {
  if (unwrapTrial) {
    server.registerTool(name, config as never, unpaid as never);
    return;
  }

  if (!paidSession || !paidSession.ok) {
    const err =
      paidSession && !paidSession.ok
        ? paidSession.error
        : new AgentError("PAYMENT_UNAVAILABLE", "Could not initialize x402 for research_mentions.", {
            request_id: requestId,
          });
    server.registerTool(name, config as never, async () => mcpToolError(err, requestId));
    return;
  }
  server.registerTool(name, config as never, wrapPaidTool(paidSession, env, origin, request, ctx, spec) as never);
}

