/**
 * Per-location SKU overlay resolution — PURE (client-safe, zero I/O, no server imports;
 * fully unit-testable). The `*-shared.ts` pattern (AGENTS.md): the ordering server lib
 * (lib/ordering.ts) and its vitest suite both import from here.
 *
 * D1 (spec 2026-08-06): global `vendor_items` is the registry; `location_sku_settings`
 * carries per-location activation + par overrides (migration 0174). Resolution rules:
 *
 *   resolvePar:    overlay field ?? global field, THEN apply the IDENTICAL weekend-par day
 *                  rule that lib/ordering.ts parForDay uses (locked semantics):
 *                    weekend && resolvedWeekendPar != null → resolvedWeekendPar
 *                    else resolvedWeekdayPar
 *                  Returns null only when NEITHER resolved value is applicable (such a SKU
 *                  is excluded from the walk by the caller — same as today's behavior).
 *
 *   resolveActive: overlayActive ?? globalActive  (null/undefined = inherit).
 *
 * Day-one behavior is IDENTICAL until a location_sku_settings row is written: null overlay
 * reduces to the global value in both cases, matching the current single-layer reads.
 */

/** Shape of a location_sku_settings row as loaded from the DB (camelCase, JS side). */
export interface LocationSkuOverlay {
  weekdayPar: number | null;
  weekendPar: number | null;
}

/** Shape of global vendor_items par fields (camelCase, JS side). */
export interface GlobalSkuPar {
  weekdayPar: number | null;
  weekendPar: number | null;
}

/**
 * Resolve the effective par for a SKU on the given walk day, applying the two-layer
 * overlay (overlay field ?? global field) THEN the weekend-par day rule that
 * lib/ordering.ts's parForDay uses — mirrored EXACTLY:
 *   if (weekend && resolvedWeekendPar != null) → resolvedWeekendPar
 *   else → resolvedWeekdayPar
 *
 * Returns null when the resolved applicable par is null (SKU excluded from the walk).
 * Callers must pass overlay = null when no location_sku_settings row exists for this SKU.
 */
export function resolvePar(
  overlay: LocationSkuOverlay | null,
  global: GlobalSkuPar,
  weekend: boolean,
): number | null {
  // Two-layer field resolution: overlay value ?? global value.
  const resolvedWeekdayPar = overlay?.weekdayPar ?? global.weekdayPar;
  const resolvedWeekendPar = overlay?.weekendPar ?? global.weekendPar;

  // Weekend-par day rule — byte-identical to lib/ordering.ts parForDay:
  //   weekend && weekendPar != null → weekendPar, else weekdayPar.
  if (weekend && resolvedWeekendPar != null) return resolvedWeekendPar;
  return resolvedWeekdayPar;
}

/**
 * Resolve the effective active flag for a SKU at a location.
 * overlayActive ?? globalActive — null or undefined overlay = inherit.
 * false = deactivated at this shop (even when globally active).
 * true  = active at this shop (promotional / location-specific, even when globally inactive).
 */
export function resolveActive(
  overlayActive: boolean | null | undefined,
  globalActive: boolean,
): boolean {
  return overlayActive ?? globalActive;
}
