/**
 * Pure, client-safe helpers for the Toast API client (read-track 1). The
 * server-only I/O lives in lib/toast/client.ts; this file is the unit-testable
 * surface (tests/toast-client.test.ts) per the house *-shared pattern.
 */

/** Refresh this long before the token's real expiry (network + clock slack). */
export const TOKEN_EXPIRY_BUFFER_MS = 60_000;

/** True while a cached token is still safely usable. */
export function tokenIsFresh(expiresAtMs: number | null, nowMs: number): boolean {
  if (expiresAtMs == null) return false;
  return nowMs < expiresAtMs - TOKEN_EXPIRY_BUFFER_MS;
}

/** Fixture-mode routing: Toast GET path → checked-in fixture key (tests/fixtures/toast/<key>.json). */
export const FIXTURE_KEYS: ReadonlyArray<{ prefix: string; key: string }> = [
  { prefix: "/menus/v2/menus", key: "menus-v2-sample" },
  { prefix: "/orders/v2/ordersBulk", key: "orders-v2-sample" },
];

export function resolveFixtureKey(path: string): string | null {
  for (const { prefix, key } of FIXTURE_KEYS) {
    if (path.startsWith(prefix)) return key;
  }
  return null;
}
