const inflight = new Map<string, Promise<unknown>>();

/** Isolate-local single-flight. Not request-scoped user state — a Promise cache. */
export function coalesce<T>(key: string, work: () => Promise<T>): Promise<T> {
  const hit = inflight.get(key);
  if (hit) return hit as Promise<T>;
  const p = work().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}

export function _resetCoalesceForTests(): void {
  inflight.clear();
}
