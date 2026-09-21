#!/usr/bin/env node
/**
 * Stdio MCP bridge for Glama. Does not run the Worker, Wrangler, or D1.
 * Proxies initialize / tools/list / health / get_pricing to the hosted origin.
 * Paid research_mentions still settles $0.02 USDC on Base against that origin.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MCP_URL =
  process.env.MENTIONFORGE_MCP_URL ?? "https://mentionforge.mentionforge.workers.dev/mcp";
const PIN = "mcp-remote@0.14.3";
const remoteArgs = [MCP_URL, "--transport", "http-only"];
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const localBin = join(root, "node_modules", ".bin", "mcp-remote");

function run(command, args) {
  return new Promise((_, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      process.exit(signal ? 1 : (code ?? 1));
    });
  });
}

const commands = [];
if (existsSync(localBin)) commands.push([localBin, remoteArgs]);
commands.push(["mcp-remote", remoteArgs]);
commands.push(["npx", ["--yes", PIN, ...remoteArgs]]);

let lastErr;
for (const [command, args] of commands) {
  try {
    await run(command, args);
    lastErr = undefined;
    break;
  } catch (err) {
    lastErr = err;
  }
}
if (lastErr) {
  console.error("glama-stdio: mcp-remote is not installed", lastErr);
  process.exit(1);
}
