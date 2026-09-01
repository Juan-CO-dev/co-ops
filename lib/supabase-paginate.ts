/**
 * Page a PostgREST query past the 1000-row default cap. `build(from, to)` must
 * return a query with `.range(from, to)` (and a stable `.order(...)`). Without
 * this, an all-rows scan silently truncates at 1000 (the PR #63 lesson).
 * Extracted from lib/team-metrics.ts so multiple loaders can share it.
 *
 * A PAGE ERROR THROWS (audit v2 P2-12, BC-032). It used to take `data ?? []` and
 * return whatever it had collected, which made a FAILED read indistinguishable from
 * an EMPTY table at ~110 call sites — the fabrication this function sat at the root
 * of, and the exact shape of the P-Street truncation that hid for a month. Two ways
 * it lied, and the second is the nastier one:
 *
 *   page 0 fails   → `[]`, read downstream as "this table is empty"
 *   page N fails   → the first N pages, read downstream as "this is all of it"
 *
 * Neither is detectable by a consumer, and consumers compute costs, pars, ranks and
 * readiness badges on the answer. So the contract is now: this function returns the
 * WHOLE set or it throws. A caller that genuinely must tolerate a failed read catches
 * it locally, with a comment saying what the human sees instead.
 *
 * `error` is OPTIONAL in the build signature on purpose: ~38 call sites already check
 * `error` inside their own build fn and hand back a bare `{ data }`. Those keep working
 * unchanged, and their local throw simply wins the race to report the same failure.
 */
export async function selectAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error?: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(`selectAllRows page ${from}-${from + pageSize - 1}: ${error.message}`);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

// ── The OTHER scale ceiling: the request LINE, not the row count ─────────────
//
// selectAllRows solves truncation — a read that returns too many ROWS. It cannot
// help with the failure below, which happens on page 0 with zero rows returned:
// a filter list so long the GET request line itself is rejected by the proxy in
// front of PostgREST. Paging the response is the wrong lever; the fix is always
// to stop spending the list in the URL at all.

/**
 * The request-line ceiling of the proxy in front of PostgREST (Kong: 8 KB by
 * default, 16 KB on some builds). Over it the request is refused with a 414 /
 * 400 BEFORE any SQL runs, so no amount of paging or retrying helps.
 *
 * Deliberately the CONSERVATIVE 8 KB: a guard that only fires at the generous
 * limit is a guard that lets the incident happen on the strict deployment.
 */
export const REQUEST_LINE_BUDGET_BYTES = 8192;

/** A v4 UUID's text length — the unit an id list is billed in. */
export const UUID_TEXT_LENGTH = 36;

/**
 * Bytes a `column=in.(id,id,…)` filter adds to a PostgREST GET request line.
 *
 * This exists to answer ONE question — "can a list of this size ever fit?" — not
 * to predict an exact byte count, so it is deliberately a floor: real requests
 * also pay percent-encoding for the parens and commas, plus the select list, the
 * order clause and the range headers. A list this function already calls too big
 * is definitively too big.
 */
export function requestLineBytesForInList(
  column: string,
  idCount: number,
  idLength: number = UUID_TEXT_LENGTH,
): number {
  if (idCount <= 0) return 0;
  // `column` + `=in.(` + ids joined by `,` + `)`
  return column.length + 5 + idCount * idLength + (idCount - 1) + 1;
}

/**
 * True when an `.in()` list of `idCount` ids still fits the request line.
 *
 * Use it to REFUSE a design, not to branch at runtime: a loader whose id list can
 * outgrow the line needs a different mechanism (an embedded join that scopes
 * server-side, or a windowed id set), because a runtime fallback still leaves the
 * unbounded path one busy month away from firing.
 */
export function inListFitsRequestLine(
  column: string,
  idCount: number,
  budget: number = REQUEST_LINE_BUDGET_BYTES,
): boolean {
  return requestLineBytesForInList(column, idCount) <= budget;
}
