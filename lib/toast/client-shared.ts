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
  { prefix: "/config/v2/diningOptions", key: "dining-options-sample" },
];

export function resolveFixtureKey(path: string): string | null {
  for (const { prefix, key } of FIXTURE_KEYS) {
    if (path.startsWith(prefix)) return key;
  }
  return null;
}

/**
 * Fixture endpoints the CALLER pages with `?page=N` (today: only ordersBulk, whose
 * loop in lib/toast/orders.ts walks pages until a short one).
 *
 * A checked-in fixture is a SINGLE page. `resolveFixtureKey` matches on the path
 * prefix and ignores the query string, so without this every page of a paged endpoint
 * resolved to the same file — page 2 served page 1 again, forever. orders.ts's own
 * doc comment already promised "[] afterwards"; nothing implemented it.
 *
 * Harmless only by luck until now: the checked-in orders fixture holds 3 orders, so
 * `rawCount < PAGE_SIZE` breaks the loop after page 1 anyway. The moment someone adds
 * a ≥100-order fixture — which is precisely what testing the pagination loop requires
 * — the SAME page would be counted up to 50 times before the hard cap stopped it, and
 * the test written to prove paging works would instead prove it silently duplicates.
 */
export const PAGED_FIXTURE_PREFIXES: ReadonlyArray<string> = ["/orders/v2/ordersBulk"];

/** True when `path` addresses a paged fixture endpoint past its single page → serve []. */
export function isExhaustedFixturePage(path: string): boolean {
  const q = path.indexOf("?");
  const base = q === -1 ? path : path.slice(0, q);
  if (!PAGED_FIXTURE_PREFIXES.some((p) => base.startsWith(p))) return false;
  const raw = q === -1 ? null : new URLSearchParams(path.slice(q + 1)).get("page");
  const page = raw == null ? 1 : Number(raw);
  // An absent or unparseable page is page 1 — the fixture, never a silent empty.
  return Number.isFinite(page) && page > 1;
}
