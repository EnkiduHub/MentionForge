/// <reference types="node" />
/**
 * Create a distinct Base seed payer and fund it with USDC from TEST_PAYER_PRIVATE_KEY.
 *
 * The CDP facilitator returns `self_send_not_allowed` when payer === payTo.
 * Keep RECIPIENT_WALLET as the revenue address. This script never logs private keys.
 *
 * Usage: npm run fund-seed-payer
 */
import { createPublicClient, createWalletClient, erc20Abi, formatEther, formatUnits, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import {
  MAINNET_USDC,
  normalizePayerKeyInput,
  readFunderPrivateKey,
  upsertDevVar,
  loadDevVars,
} from "./payer.js";

/** 0.10 USDC — covers REST + MCP seeds plus a retry. */
const FUND_ATOMIC = 100_000n;
const MIN_ETH_WEI = 50_000_000_000_000n; // 0.00005 ETH for the ERC-20 transfer gas
const RPCS = [
  process.env["BASE_RPC_URL"],
  "https://mainnet.base.org",
  "https://base.llamarpc.com",
  "https://base-rpc.publicnode.com",
].filter((u): u is string => Boolean(u));

function asPrefixedKey(raw: string): `0x${string}` | null {
  const compact = normalizePayerKeyInput(raw);
  const key = compact.startsWith("0x") ? compact : compact ? `0x${compact}` : "";
  return /^0x[0-9a-fA-F]{64}$/.test(key) ? (key as `0x${string}`) : null;
}

async function pickRpc(): Promise<string> {
  let last: unknown;
  for (const url of RPCS) {
    try {
      const publicClient = createPublicClient({ chain: base, transport: http(url) });
      await publicClient.getBlockNumber();
      console.log("rpc", url);
      return url;
    } catch (err) {
      last = err;
    }
  }
  throw new Error(`No Base RPC responded. Last error: ${String(last)}`);
}

async function main() {
  const funderKey = readFunderPrivateKey();
  const funder = privateKeyToAccount(funderKey);
  const existingSeed = asPrefixedKey(loadDevVars()["TEST_SEED_PAYER_PRIVATE_KEY"] || process.env["TEST_SEED_PAYER_PRIVATE_KEY"] || "");
  let seedKey = existingSeed;
  let seed = seedKey ? privateKeyToAccount(seedKey) : null;
  if (!seed || seed.address.toLowerCase() === funder.address.toLowerCase()) {
    seedKey = generatePrivateKey();
    seed = privateKeyToAccount(seedKey);
    upsertDevVar("TEST_SEED_PAYER_PRIVATE_KEY", seedKey);
    console.log("wrote TEST_SEED_PAYER_PRIVATE_KEY to .dev.vars (value not printed)");
  }
  if (!seed) throw new Error("seed payer missing");
  const rpc = await pickRpc();
  const publicClient = createPublicClient({ chain: base, transport: http(rpc) });
  const wallet = createWalletClient({ account: funder, chain: base, transport: http(rpc) });

  const [funderEth, funderUsdc, seedUsdc] = await Promise.all([
    publicClient.getBalance({ address: funder.address }),
    publicClient.readContract({
      address: MAINNET_USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [funder.address],
    }),
    publicClient.readContract({
      address: MAINNET_USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [seed.address],
    }),
  ]);

  console.log("funder", funder.address, "eth", formatEther(funderEth), "usdc", formatUnits(funderUsdc, 6));
  console.log("seed_payer", seed.address, "usdc", formatUnits(seedUsdc, 6));

  if (seedUsdc >= FUND_ATOMIC) {
    console.log("seed payer already funded; no transfer");
    return;
  }
  if (funderEth < MIN_ETH_WEI) {
    throw new Error("Funder needs a little Base ETH to transfer USDC to the seed payer (x402 itself is facilitator-gas).");
  }
  if (funderUsdc < FUND_ATOMIC) {
    throw new Error(`Funder USDC ${formatUnits(funderUsdc, 6)} is below ${formatUnits(FUND_ATOMIC, 6)} needed to fund the seed payer.`);
  }

  const hash = await wallet.writeContract({
    address: MAINNET_USDC,
    abi: erc20Abi,
    functionName: "transfer",
    args: [seed.address, FUND_ATOMIC],
  });
  console.log("usdc_transfer", hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`USDC transfer failed: ${receipt.status}`);
  }
  let after = 0n;
  for (let i = 0; i < 10; i++) {
    after = await publicClient.readContract({
      address: MAINNET_USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [seed.address],
    });
    if (after >= FUND_ATOMIC) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log("seed_payer_usdc", formatUnits(after, 6));
  if (after < FUND_ATOMIC) {
    throw new Error("Transfer mined but seed USDC not visible yet; wait and re-run npm run fund-seed-payer.");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
