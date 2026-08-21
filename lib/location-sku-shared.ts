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

/**
 * Why a par'd SKU is (or is not) suggested on today's par pass — the walk's CAUSE
 * LADDER, extracted pure so the order can be test-pinned (AGENTS.md: a mixed module
 * separates its pure decision so it CAN be tested).
 *
 * `"walk"` is the only non-exclusion. The other four are the P4 law in one place:
 * every exclusion is COUNTED, never silently skipped, because a dropped par is
 * deleted demand and the manager has to be able to see it.
 */
export type WalkDisposition =
  | "walk"
  | "productRetired"
  | "vendorInactive"
  | "skuInactive"
  | "parNull";

export interface WalkDispositionInput {
  /** The SKU's PRODUCT is retired (`products.active = false` — resolution rung ⓪). */
  productRetired: boolean;
  /** The SKU's vendor exists and is active — somebody can actually be asked for it. */
  vendorKnown: boolean;
  /** `resolveActive(overlay, global)` — the location-resolved activation. */
  skuActive: boolean;
  /** `resolvePar(...)` for today. null = neither par applies (normal on a weekend). */
  par: number | null;
}

/**
 * FIRST CAUSE WINS, and the order is the whole point of this function.
 *
 *  ⓪ productRetired — Juan's ruling (2026-08-21): "discontinuation is about stopping
 *    the SKU from being ordered… pars should be affected if less demand for that SKU
 *    is happening." Pars are DOWNSTREAM of demand, so a retired product's pars are
 *    stale by definition. It ranks FIRST because it is the only cause that is not a
 *    fault: reporting "turn the vendor back on" for a product Juan discontinued sends
 *    him on an errand he already decided against. Suppressed, never MUTATED — the par
 *    columns are untouched, so bringing the product back restores the exact prior walk.
 *  ① vendorInactive — nobody to ask.
 *  ② skuInactive    — the deactivated-twin case.
 *  ③ parNull        — no par applies today. Normal, not a fault.
 *
 * ①–③ are unchanged from the pre-retirement walk, and a SKU with no retired product
 * classifies byte-identically to before.
 */
export function walkDisposition(input: WalkDispositionInput): WalkDisposition {
  if (input.productRetired) return "productRetired";
  if (!input.vendorKnown) return "vendorInactive";
  if (!input.skuActive) return "skuInactive";
  if (input.par == null) return "parNull";
  return "walk";
}

/**
 * PAR-REVIEW ADVISORIES — "the system recognizes what's going on before the human
 * does" (Juan, 2026-08-21).
 *
 * A par is a standing number a manager set when demand looked a certain way. When
 * demand LOSES A SOURCE — a product is discontinued, a recipe stops using an
 * ingredient, a recipe is retired — that par silently becomes too high and nothing
 * says so until someone notices the walk-in filling up. These advisories say it on
 * the ordering surface, at the moment the walk runs, WITH THE CAUSE NAMED.
 *
 * ── SCOPE: EVENT-ATTRIBUTED, NEVER A NUMBER ─────────────────────────────────────
 * This says WHY a par wants review and points at the par edit. It does NOT compute a
 * suggested par: that needs demand-rate math over a velocity window, which is the
 * DYNAMIC PARS arc (docs/ROADMAP.md) and is deliberately reserved. An advisory that
 * invented "try 3 instead of 5" from one removed recipe line would be a confident
 * number with nothing behind it — the exact failure mode the costing board's
 * `unweighed` status exists to refuse.
 *
 * ── WHY "HAS NO ACTIVE RECIPE" IS *NOT* ON ITS OWN A TRIGGER ────────────────────
 * Verified live 2026-08-21 before this rule was written: of 84 par'd, non-inventory
 * SKUs, **20 have zero active-recipe references — and 16 of them are correct**. They
 * are RESALE goods (Coke, Saratoga, Frooties, Gluten Free Bread…) sold as-is, which
 * legitimately no recipe consumes. Firing on the static state would have cried wolf on
 * 80% of its own first run, and a lane that cries wolf is a lane managers learn to
 * scroll past. So a STATE never triggers an advisory here — only a CHANGE does. The
 * static set is a data-hygiene question for a human, not an alert.
 * (If a resale marker ever lands on vendor_items, the static sweep becomes viable.)
 */
export type ParAdvisoryCode =
  /** The SKU's PRODUCT was discontinued — the par is stale by definition. */
  | "product_retired"
  /** A recipe that used this SKU no longer does, and NOTHING active does now. */
  | "no_demand_source"
  /** A recipe that used this SKU no longer does; other active recipes still do. */
  | "demand_source_removed";

export interface ParAdvisory {
  code: ParAdvisoryCode;
  /** The recipes that STOPPED creating demand — the attribution, named not counted. */
  removedSources: string[];
  /** How many active recipes still reference it. 0 = nothing uses this any more. */
  activeRecipeRefs: number;
}

export interface ParAdvisoryInput {
  /** Packaging / cleaning supplies. Their pars were NEVER recipe-derived. */
  inventoryOnly: boolean;
  /** The SKU's product is retired (resolution rung ⓪). */
  productRetired: boolean;
  /** Active recipes still referencing this SKU (directly, or through its product). */
  activeRecipeRefs: number;
  /** Recipe names that STOPPED referencing it — the change that triggers this. */
  removedSources: ReadonlyArray<string>;
}

/**
 * Should this par be reviewed, and WHY? null = nothing to say.
 *
 * Precedence, strongest first:
 *   ① inventoryOnly → NEVER. A par on to-go cups was never recipe-derived, so
 *     "no recipe uses this" is a category error, not a finding. (Live: 57 of the
 *     141 par'd SKUs are inventory-only and every one has zero recipe refs —
 *     without this rung they would be 57 false alarms on day one.)
 *   ② product_retired → the strongest cause: we stopped buying the identity.
 *   ③ no_demand_source → a source was removed AND nothing active is left.
 *   ④ demand_source_removed → a source was removed; others remain, so the par is
 *     probably too high rather than entirely stale.
 *
 * PURE and total. `removedSources` empty ⇒ no advisory (rungs ③/④ need the event).
 */
export function parReviewAdvisory(input: ParAdvisoryInput): ParAdvisory | null {
  if (input.inventoryOnly) return null;
  const removedSources = [...input.removedSources];
  const activeRecipeRefs = input.activeRecipeRefs;
  if (input.productRetired) {
    return { code: "product_retired", removedSources, activeRecipeRefs };
  }
  if (removedSources.length === 0) return null;
  return {
    code: activeRecipeRefs === 0 ? "no_demand_source" : "demand_source_removed",
    removedSources,
    activeRecipeRefs,
  };
}
