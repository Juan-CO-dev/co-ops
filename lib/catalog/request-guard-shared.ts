/**
 * A tiny client-safe guard against late responses (catalog Phase 2b). Every preview request runs
 * through `run`; only the NEWEST request's answer is returned — an older one resolves to null and is
 * dropped. `invalidate` drops whatever is in flight (the draft changed, the job was left). Paired with
 * the page keying its client by (SKU, shop), a slow answer for one shop can never land in another.
 */
export interface RequestGuard {
  run<T>(fn: () => Promise<T>): Promise<T | null>;
  invalidate(): void;
}

export function createRequestGuard(): RequestGuard {
  let generation = 0;
  return {
    async run<T>(fn: () => Promise<T>): Promise<T | null> {
      const mine = ++generation;
      const result = await fn();
      return mine === generation ? result : null;
    },
    invalidate() {
      generation += 1;
    },
  };
}
