/**
 * Mid-shift Pulse v2 — the SHORT-LIVED source cache (Astra #2, CC ruling: "one shared load per poll
 * per shop"). Pure, process-local, no I/O.
 *
 * Every viewer polls every section on a 60 s clock, and each section request used to reload its
 * sources (the shift board 4× per cycle per viewer). This cache holds ONE in-flight-or-settled load
 * per (source, shop, day, SCOPE) for just under the poll interval, so a shop's viewers share one
 * read per source per poll whatever their number. SCOPE is part of the key: a source whose rows
 * depend on who is asking (report statuses below KH, handoff audiences) never serves another scope's
 * answer. Rejections are never cached (the next caller retries); writers invalidate their source.
 *
 * On Vercel the cache lives per warm instance — a cold instance pays one load; it can never serve
 * stale data longer than SOURCE_TTL_MS.
 */

/** Just under the 60 s client poll so a poll never serves data from two polls ago. */
export const SOURCE_TTL_MS = 50_000;

interface Entry { at: number; value: Promise<unknown> }
const store = new Map<string, Entry>();

export function sourceKey(parts: { source: string; locationId: string; date: string; scope: string }): string {
  return `${parts.source}|${parts.locationId}|${parts.date}|${parts.scope}`;
}

/** Return the cached (or in-flight) value for `key`, else run `load` and cache its promise for `ttlMs`. */
export function cachedSource<T>(key: string, load: () => Promise<T>, opts: { ttlMs?: number; now?: number } = {}): Promise<T> {
  const ttl = opts.ttlMs ?? SOURCE_TTL_MS;
  const now = opts.now ?? Date.now();
  const hit = store.get(key);
  if (hit && now - hit.at < ttl) return hit.value as Promise<T>;
  const value = load().catch((err: unknown) => {
    // A failure is never shared beyond the callers already waiting on it.
    if (store.get(key)?.value === value) store.delete(key);
    throw err;
  });
  store.set(key, { at: now, value });
  return value;
}

/**
 * `cachedSource` for a source whose freshness is a STAMP (today's sales: the latest COMPLETED Toast
 * capture). The stamp is part of `key`; a new stamp under the same `prefix` first retires every older
 * sibling, so a superseded snapshot is never served again and never lingers in memory. Two instances
 * holding the same stamp hold the same numbers; an instance that learns a newer stamp reloads at once,
 * TTL or not (Juan, 2026-10-10: "needed 2-4 refreshes, and went BACKWARDS" — refresh roulette across
 * warm instances). The TTL still bounds a stamp that did not move (ezCater links, channel map, a
 * modified-order run), so nothing is ever served longer than before.
 */
export function cachedStampedSource<T>(prefix: string, key: string, load: () => Promise<T>, opts: { ttlMs?: number; now?: number } = {}): Promise<T> {
  const ttl = opts.ttlMs ?? SOURCE_TTL_MS;
  const now = opts.now ?? Date.now();
  const hit = store.get(key);
  if (!(hit && now - hit.at < ttl)) {
    for (const k of [...store.keys()]) if (k !== key && k.startsWith(prefix)) store.delete(k);
  }
  return cachedSource(key, load, opts);
}

/** Drop every entry whose key starts with `prefix` (a writer invalidating its own source for a shop). */
export function invalidateSource(prefix: string): number {
  let n = 0;
  for (const key of [...store.keys()]) if (key.startsWith(prefix)) { store.delete(key); n++; }
  return n;
}

export function sourceCacheSize(): number { return store.size; }
/** Tests only. */
export function resetSourceCache(): void { store.clear(); }
