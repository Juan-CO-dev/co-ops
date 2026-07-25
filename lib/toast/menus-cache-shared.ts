/**
 * Pure decision helper for the Toast menu cache (2026-07-24; Toast's menus/v2
 * is aggressively rate-limited — the cache re-pulls only on real change).
 */

/** Fresh iff both sides carry a lastUpdated and they agree exactly. */
export function isCacheFresh(cachedLastUpdated: string | null, metadataLastUpdated: string | null): boolean {
  return (
    cachedLastUpdated != null &&
    cachedLastUpdated.length > 0 &&
    metadataLastUpdated != null &&
    metadataLastUpdated === cachedLastUpdated
  );
}

/** Extract lastUpdated from a metadata (or full menus) payload; null when absent/odd. */
export function extractLastUpdated(json: unknown): string | null {
  const v = (json as { lastUpdated?: unknown } | null)?.lastUpdated;
  return typeof v === "string" && v.length > 0 ? v : null;
}
