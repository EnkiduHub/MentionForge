import { matchFlag, putFlag } from "../cache";

const OPEN_TTL = 60;

export async function isOpen(name: string): Promise<boolean> {
  return matchFlag(`circuit:${name}`);
}

export async function recordFailure(name: string, fails: Map<string, number>): Promise<void> {
  const n = (fails.get(name) ?? 0) + 1;
  fails.set(name, n);
  if (n >= 5) await putFlag(`circuit:${name}`, OPEN_TTL);
}

export async function recordSuccess(name: string, fails: Map<string, number>): Promise<void> {
  fails.delete(name);
}

const SOURCE_CIRCUITS = ["reddit", "news", "web", "reviews", "x"] as const;

/** Cached circuit flags only — never probe GDELT or other upstreams from /health. */
export async function circuitStatus(): Promise<Record<(typeof SOURCE_CIRCUITS)[number], "open" | "closed">> {
  const out = {} as Record<(typeof SOURCE_CIRCUITS)[number], "open" | "closed">;
  for (const name of SOURCE_CIRCUITS) {
    out[name] = (await isOpen(name)) ? "open" : "closed";
  }
  return out;
}
