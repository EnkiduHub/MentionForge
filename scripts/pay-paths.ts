/** Paid bazaar seed routes. Order matches the historical three-settlement heartbeat. */
export const PAY_PATH_IDS = ["mcp", "rest-research", "rest-research-mentions"] as const;
export type PayPath = (typeof PAY_PATH_IDS)[number];

export const PAY_PATH_HELP = PAY_PATH_IDS.join(", ");

/** Empty or unset keeps all three paths. Unknown tokens throw before any settlement. */
export function parsePayPaths(raw: string | undefined): PayPath[] {
  if (raw == null || raw.trim() === "") return [...PAY_PATH_IDS];
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return [...PAY_PATH_IDS];
  const allowed = new Set<string>(PAY_PATH_IDS);
  const unknown = parts.filter((part) => !allowed.has(part));
  if (unknown.length > 0) {
    throw new Error(`PAY_PATHS has unknown value(s): ${unknown.join(", ")}. Allowed: ${PAY_PATH_HELP}`);
  }
  const selected: PayPath[] = [];
  for (const part of parts) {
    const path = part as PayPath;
    if (!selected.includes(path)) selected.push(path);
  }
  return selected;
}

/** One settlement callback per selected path. Callers pass mocks in tests. */
export async function settlePayPaths(
  paths: readonly PayPath[],
  settle: (path: PayPath) => Promise<void>,
): Promise<number> {
  let count = 0;
  for (const path of paths) {
    await settle(path);
    count += 1;
  }
  return count;
}

export function payPathCostLabel(paths: readonly PayPath[]): string {
  const dollars = (paths.length * 0.02).toFixed(2);
  return `$${dollars} (${paths.join(", ")})`;
}
