/**
 * DYNAMIC PARS — the SERVER layer: the batched nightly loader, the shadow engine, and
 * THE ONE PAR-WRITE AUTHORITY.
 *
 * SERVER-ONLY. Service-role client throughout; authorization is app-layer and re-checked
 * here per action (the lib is the authority, mirroring lib/vendor-rhythm.ts).
 *
 * ── WHAT RUNS WHEN, AND WHY IT IS NOT ON A READ PATH ───────────────────────────
 * `runParShadowForLocation` is chained inside the NIGHTLY cron, immediately after
 * `materializeDailyDepletion` (app/api/cron/toast-sales-pull). It never runs on the
 * walker's read path — the WRITE-ON-READ law (AGENTS.md). The walker re-selects a horizon
 * over the terms this engine PERSISTED, which is a pure selection, not a computation
 * (head ruling R3-A), and that is why a 9:58 and a 10:02 walk legitimately differ.
 *
 * ── IT APPLIES NOTHING ─────────────────────────────────────────────────────────
 * `PAR_AUTO_APPLY_ENABLED` is false and `mode` is hard-coded "shadow". Every night the
 * FULL guard stack is simulated and the verdict — would-apply vs suppressed-by-WHICH-guard
 * — is written to `par_auto_moves`, so every guard is battle-tested on real data before
 * the write bit is ever flipped (r2-7). Flipping it is a code change with a PR,
 * deliberately: no env var, no admin toggle, no route.
 *
 * ── THE REASON LANE IS THE PRODUCT ─────────────────────────────────────────────
 * Live, the engine can honestly speak for ~14 rows of ~282 per location. The other ~268
 * are not failures: each one is written with the closed reason code naming the errand that
 * would wake it. A silent par is a WRITE, never a skip.
 *
 * ── THE DOUBLE-COUNT LAW IS NOT IN PLAY ────────────────────────────────────────
 * Consumed oz = production_inputs.input_oz + toast_daily_depletion.direct_oz, and nothing
 * here sums flattened_oz — it is read only to DETECT prep-mediation (a dark production
 * lane means a half-seen base). No ledger is re-keyed and no ledger row is rewritten.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import type { AuditAction } from "@/lib/audit-actions";
import { etCalendarDate } from "@/lib/operational-day";
import { loadMeasures, loadSkuPackChains } from "@/lib/prep-consumption";
import type { MeasureUnitFactor, RecipeInputSku } from "@/lib/recipe-math";
import { loadProductIndex } from "@/lib/products";
import { rollupUsageByProduct } from "@/lib/products-shared";
import { WALKER_SKU_COLUMNS, perOrderUnitOz } from "@/lib/ordering";
import { resolveActive, resolveParSlot, type LocationSkuOverlay } from "@/lib/location-sku-shared";
import {
  loadRhythmByVendor, loadRhythmSkips, loadAllCutoffsByVendor,
} from "@/lib/vendor-rhythm";
import {
  coverageWindow, optimizationWalkDate, addDaysEt,
  type CutoffRow, type RhythmRow, type RhythmSkip,
} from "@/lib/vendor-rhythm-shared";
import {
  DYNAMIC_PARS, SILENCING_REASONS, PAR_WRITE_MIN,
  applyGuardStack, classifyParReason, computeBaseRate, computeCoverage, dayClassForDate,
  computeVelocityRatio, cushionFor, observedPeakCoverageOz, parStepFor,
  parWriteColumns, roundToStep,
  type DayClass, type GuardOutcome, type ParReasonCode, type ParWriteActorKind,
  type VelocityDay, type WindowDay,
} from "@/lib/dynamic-pars-shared";
import {
  derivePriorAndBudget, directionConfirmed, normalizePerOrderUnitOz, perSkuSeries,
  rollupPerDate, slotKey, tallyRun,
  type LedgerPrior, type ParRunCounts,
} from "@/lib/dynamic-pars-run-shared";
import {
  parAutoLaneReady, parAutoMovesReady, parSuggestionActionsReady, salesSignalsReady,
} from "@/lib/dynamic-pars-probes";

/**
 * THE PROBES LIVE IN A LEAF (lib/dynamic-pars-probes.ts) AND ARE RE-EXPORTED HERE.
 *
 * The plan names `lib/dynamic-pars.ts` as their home and every consumer it names reaches
 * them at this path. They are DEFINED one module down because two of their consumers —
 * lib/ordering.ts and lib/catering/toast-sales.ts — sit upstream of this module in the
 * import graph (this module imports both), so hosting them here would make three pairs of
 * modules mutually recursive for the sake of one boolean. Same shape as the `*-shared.ts`
 * re-export idiom: define in the leaf, re-export from the server module.
 */
export { parAutoMovesReady, parAutoLaneReady, parSuggestionActionsReady, salesSignalsReady };

/**
 * THE WALKER'S READ PATH LIVES IN A LEAF TOO (lib/dynamic-pars-walker.ts), AND FOR THE
 * SAME REASON AS THE PROBES: its one caller is `lib/ordering.ts`, which THIS module
 * imports (WALKER_SKU_COLUMNS, perOrderUnitOz). Defining it here would make the walker and
 * the engine mutually recursive. The plan names this file as its home, so it is re-exported
 * at this path — define in the leaf, re-export from the module the plan names.
 */
export { loadParSuggestions, loadParSilence } from "@/lib/dynamic-pars-walker";
export type { WalkInstant, ParSkuIndexEntry } from "@/lib/dynamic-pars-walker";

type ServiceClient = ReturnType<typeof getServiceRoleClient>;

/** Typed error the (Phase-4) routes map to jsonError(status, code). */
export class DynamicParsError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "DynamicParsError";
  }
}

function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) {
    throw new DynamicParsError(403, "forbidden", "Insufficient role level for this action");
  }
}

function actorLoc(actor: AuthContext): LocationActor {
  return { role: actor.user.role, locations: actor.locations };
}

/**
 * THE LOCATION BIND, IN THE LIB (LEAD RULING F7, Phase-4 close).
 *
 * A par write floors the ROLE at 7, and 7 is NOT all-locations — `lockLocationContext`'s
 * all-locations grant starts at level 9 (lib/locations.ts), so a GM is bound to their
 * assignment list. Without this, a level-7 manager at one shop could move the other
 * shop's par: the role gate would pass and nothing else would object.
 *
 * It lives HERE and not only on the route because the lib is the authority (AGENTS.md),
 * and that law outranks Task 4.4's silence about it. The route's own bind stays as the
 * outer layer — defence in depth, not redundancy — but a future caller (the Phase-5 sim
 * harness, a fleet route, an admin affordance) that forgets it now fails closed instead
 * of quietly crossing shops. Same shape and same 404 as `loadOnHandDerived` and every
 * other location-scoped reader in lib/counts.ts.
 *
 * IT RUNS BEFORE THE ARBITER, AND BEFORE ANY I/O. A bind failure must not consume a
 * suggestion generation — that would let a wrong-shop tap burn the right shop's offer.
 */
function requireLocation(actor: AuthContext, locationId: string): void {
  if (!lockLocationContext(actorLoc(actor), locationId)) {
    throw new DynamicParsError(404, "not_found", "Location not found");
  }
}

/** PostgREST numerics arrive as number | string | null. */
function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE WRITE BIT. False in v1, and the two conditions that would flip it are:
 *   ① the location is GRADUATED (`trustRampState` met — N accepted DISTINCT generations
 *      plus a physical count anchor with `allocated_from_product_id IS NULL`), and
 *   ② an explicit lead decision, taken with the shadow ledger's guard histogram in hand.
 * There is no env var and no admin toggle on purpose: the flip is a code change with a PR.
 * Live today the auto tier's whole population is ONE SKU at two locations, and
 * `sku_count_events` is 0, so no location can graduate regardless.
 */
export const PAR_AUTO_APPLY_ENABLED = false;

/**
 * The nightly run evaluates the horizon AS IF walking at the start of the optimisation
 * day, so every cutoff on that day is still catchable. That is the LONGEST-reach reading
 * and it is what `detail.horizon_basis` records; the walker always overrides it with the
 * real instant, which is exactly R3-A. An "end of order day" spelling would be a lie
 * about the value.
 */
export const NIGHTLY_HORIZON_WALK_MINUTES = 0;

/** Ledger inserts are chunked so one night's batch never becomes one giant request. */
const LEDGER_INSERT_CHUNK = 500;

/**
 * How many production ids may ride ONE `.in()` filter. 150 uuids is ~5.6 KB of request line
 * (`requestLineBytesForInList`, lib/supabase-paginate.ts) against an 8 KB budget that also
 * has to hold the select list, the order clause and the range — comfortably inside the
 * ~220-uuid 414 cliff with room for the rest of the request.
 */
const PRODUCTION_ID_CHUNK = 150;

/**
 * How far back the hysteresis prior is sought. Longer than the budget window so a
 * location that missed a few nights still has a direction to confirm against; short
 * enough that one read serves both the prior and the budget.
 */
const PRIOR_LOOKBACK_DAYS = 14;

/** The audit actions this engine may emit. Named so the mode→action map is total. */
const RUN_AUDIT_ACTION: Record<"shadow" | "live", AuditAction> = {
  shadow: "par.auto_tune_shadow",
  live: "par.auto_tune",
};

/**
 * Recipe-edit oracle for the velocity reset (r1-6): the actions that change what a SKU
 * MEANS inside a recipe, so the series before one of them is a different signal.
 *
 * The plan names "`recipe_input.*` / `recipe.update`"; live, `recipe_input.*` is three
 * spellings — add + remove sit in DESTRUCTIVE_ACTIONS, update in NON_DESTRUCTIVE — and
 * all three change the flatten. Verified against both registries rather than assumed: an
 * action name that does not exist here would not error, it would silently never match,
 * and the reset would quietly stop working.
 *
 * `occurred_at`, NEVER `created_at` — audit_log has no `created_at` column and that exact
 * misspelling silently 400'd for weeks (SIM-PI-4, lib/catering/toast-sales.ts).
 */
const RECIPE_EDIT_ACTIONS = [
  "recipe_input.add", "recipe_input.remove", "recipe_input.update", "recipe.update",
] as const satisfies ReadonlyArray<AuditAction>;

// ─────────────────────────────────────────────────────────────────────────────
// Task 3.5 — the batched nightly loader
// ─────────────────────────────────────────────────────────────────────────────

/** One par'd SKU, with everything the engine needs about it resolved ONCE. */
export interface DemandSku {
  skuId: string;
  name: string;
  vendorId: string;
  productId: string | null;
  /** The key the demand series is rolled to: the product when there is one, else the
   *  SKU itself (a SKU with product_id NULL is an implicit singleton — AGENTS.md). */
  grainKey: string;
  inventoryOnly: boolean;
  productRetired: boolean;
  cushionClass: string | null;
  parStep: number;
  globalWeekdayPar: number | null;
  globalWeekendPar: number | null;
  perOrderUnitOz: number | null;
  hasPackChain: boolean;
  /**
   * R3-B: auto values are conceptually product-grain but physically home on the STABLE
   * PRIMARY's slot — the DESIGNATED primary (`product_primaries`, location row over
   * global), never the ladder's transient runtime answer. A write to a backup carrier
   * orphans on restore, taking the tuned par with it.
   */
  writeHomeSkuId: string;
}

export interface DemandInputs {
  locationId: string;
  runDateEt: string;
  window: WindowDay[];
  skus: DemandSku[];
  overlayBySku: Map<string, ParOverlayRow>;
  /** date → (skuId → oz), already rolled to product grain. */
  directOzByDate: Map<string, Map<string, number>>;
  productionOzByDate: Map<string, Map<string, number>>;
  flattenedOzByDate: Map<string, Map<string, number>>;
  /** grainKey → the first ET date any of this SKU's three lanes was alive here
   *  (`deriveLaneStart`). Null = none of them ever was. */
  laneStartByGrain: Map<string, string | null>;
  /** ET dates the catering detector flagged (plan D4). */
  suspectDays: Set<string>;
  signalsStartAt: string | null;
  rhythmByVendor: Map<string, RhythmRow[]>;
  skipsByVendor: Map<string, RhythmSkip[]>;
  cutoffsByVendor: Map<string, CutoffRow[]>;
  /** `${skuId}:${dayClass}` → the previous run's rendered opinion. */
  priorBySlot: Map<string, LedgerPrior>;
  /** `${skuId}:${dayClass}` → non-manual par writes inside the budget window. */
  budgetSpentBySlot: Set<string>;
  recipeEditedAt: string | null;
  /** No observed day at all at this location — the cold-start seam (not wired in v1). */
  noLocalHistory: boolean;
}

/** The per-slot overlay the engine reads: the human lane, the machine lane, the pin. */
export interface ParOverlayRow extends LocationSkuOverlay {
  /** The per-location activation override. Read for the SAME reason loadWalkerData reads
   *  it: `resolveActive(activeOverride, sku.active)` decides whether this SKU is part of
   *  THIS shop's walk at all, and the ledger's universe must be the walker's universe. */
  activeOverride: boolean | null;
  pinnedWeekdayAt: string | null;
  pinnedWeekendAt: string | null;
}

interface DbSkuRow {
  id: string; name: string; vendor_id: string | null; active: boolean;
  pack_format: string | null; weekday_par: number | string | null;
  weekend_par: number | string | null; each_container_label: string | null;
  units_per_pack: number | null; each_size: number | string | null;
  each_measure: string | null; avg_oz_per_each: number | string | null;
  product_id: string | null; inventory_only: boolean | null;
  cushion_class: string | null; par_step: number | string | null;
}

/**
 * THE LONGITUDINAL CLAMP'S INPUT (r2-5), PURE SO IT CAN BE PINNED.
 *
 * The earliest window day on which this identity's lane EXISTED at this location — the day
 * before which every zero is STRUCTURAL (the recipe was not wired yet, so the register could
 * not have depleted this SKU) rather than a measurement. `computeBaseRate` drops those days
 * from both the numerator and the denominator; everything at or after this date is a real
 * observation, including a zero one. Null = no lane has ever produced here → `no_lane_start`.
 *
 * ── THREE LANES, BECAUSE A DEPLETION ROW HAS THREE WAYS TO BE LIT ────────────────
 * `materializeDailyDepletion` writes a `toast_daily_depletion` row when EITHER `direct_oz`
 * or `flattened_oz` is positive (lib/catering/toast-sales.ts), so a prep-mediated SKU — one
 * the shop never sells directly, only through a prep recipe — has a lit lane every trading
 * day while `direct_oz` stays 0.00 on every one of them. Testing only direct + production
 * therefore called those SKUs `no_lane_start` ("no lane has EVER produced data for this SKU
 * here"), which is false about the kitchen and, worse, aims the wrong errand: the reason
 * lane is the product, and the errand that would wake a prep-mediated SKU is PRODUCTION
 * CAPTURE, not "this SKU has never moved". `classifyParReason` ranks `laneNeverStarted`
 * above `laneComplete`, so the wrong name won every time. Reading the flattened lane here is
 * the SAME non-summing use the base rate already makes of it — detecting that a SKU's demand
 * is prep-mediated — and the double-count law is untouched: `flattened_oz` still enters no
 * sum anywhere, it only answers "was this lane alive that day".
 *
 * ── THE RESIDUAL APPROXIMATION, STATED RATHER THAN PAPERED OVER ──────────────────
 * "First day a lane produced" is still a PROXY for "first day the lane existed". For a SKU
 * whose demand is direct and whose first window days happen to be genuine no-sale days, those
 * days are TRUE ZEROS by this arc's own law and they are nonetheless clamped away — the
 * numerator is unchanged and the denominator shrinks, so the base rate reads high, and the
 * sparser the SKU the larger the bias. Distinguishing the two cases needs a fact this loader
 * does not have: the date the recipe/crosswalk line that connects this SKU to a sold menu
 * item was authored. That is a NAMED ENABLER for v2 (the same posture the arc takes with the
 * productions↔quote link), not something to guess at here — a guessed lane start would fake
 * demand history, which is worse than a bias that is written down.
 */
export function deriveLaneStart(input: {
  window: ReadonlyArray<{ dateEt: string }>;
  /** The SKU key the rolled-up maps are keyed by (product-grain totals ride on every member). */
  skuId: string;
  directOzByDate: ReadonlyMap<string, ReadonlyMap<string, number>>;
  productionOzByDate: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** READ AS A PREDICATE ONLY — never summed. The double-count law. */
  flattenedOzByDate: ReadonlyMap<string, ReadonlyMap<string, number>>;
}): string | null {
  for (const day of input.window) {
    const direct = input.directOzByDate.get(day.dateEt)?.get(input.skuId) ?? 0;
    const production = input.productionOzByDate.get(day.dateEt)?.get(input.skuId) ?? 0;
    const flattened = input.flattenedOzByDate.get(day.dateEt)?.get(input.skuId) ?? 0;
    if (direct > 0 || production > 0 || flattened > 0) return day.dateEt;
  }
  return null;
}

/**
 * Everything one location's nightly run needs, in a fixed number of batched reads.
 *
 * BATCH LAW (AGENTS.md, `loadRecipeGraph`): one query per KIND, never per SKU. Every
 * unbounded read is PAGED under a stable total order (the PR #63 lesson) and no read
 * spends an id list in the GET request line unless that list is bounded by the catalog
 * (the 414 cliff, lib/products.ts DELIVERY_AT_LOCATION_EMBED).
 *
 * ONLY CALLED WHEN 0182 IS APPLIED — `runParShadowForLocation` probes first, so nothing
 * in here has to defend against a missing rhythm/ledger/signals table.
 */
export async function loadDemandInputs(
  sb: ServiceClient,
  locationId: string,
  runDateEt: string,
): Promise<DemandInputs> {
  const windowStart = addDaysEt(runDateEt, -(DYNAMIC_PARS.BASE_WINDOW_DAYS - 1));
  const priorFrom = addDaysEt(runDateEt, -PRIOR_LOOKBACK_DAYS);
  const budgetFrom = addDaysEt(runDateEt, -DYNAMIC_PARS.BUDGET_WINDOW_DAYS);

  // ① The par'd SKU universe. Same column list the walker reads (one spelling), plus the
  //    three per-SKU data columns this arc added. No `.in()` id list.
  const { data: skuRows, error: sErr } = await sb.from("vendor_items")
    .select(`${WALKER_SKU_COLUMNS}, cushion_class, par_step, sku_class`)
    .or("weekday_par.not.is.null,weekend_par.not.is.null")
    .returns<DbSkuRow[]>();
  if (sErr) throw new Error(`loadDemandInputs skus: ${sErr.message}`);

  // THE LEDGER'S UNIVERSE MUST BE THE WALKER'S UNIVERSE. The activation filter needs the
  // overlay, so it runs after the overlay read below; these three id lists are only used to
  // scope the batch reads, where a few extra ids cost nothing and dropping one would lose
  // data. The `vendor_id != null` cut is safe here — loadWalkerData makes the identical one
  // (a par'd SKU nobody can be asked for is unorderable) before it builds any id list.
  const routable = (skuRows ?? []).filter((s) => s.vendor_id != null);
  const skuIds = routable.map((s) => s.id);
  const vendorIds = [...new Set(routable.map((s) => s.vendor_id as string))];
  const productIds = [...new Set(routable.map((s) => s.product_id).filter((v): v is string => v != null))];

  const autoLane = await parAutoLaneReady(sb);

  const [
    overlayBySku, depletionRows, salesEventDates, signalRows,
    productionHeaders, productIndex, chainsBySku, measures,
    rhythmByVendor, skipsByVendor, cutoffsByVendor, ledgerRows, actionRows, recipeEditedAt,
  ] = await Promise.all([
    // ② the per-location overlay, machine lane + pins included when 0183 has landed.
    loadParOverlay(sb, locationId, autoLane),
    // ③ the direct + flattened lanes, paged under `id`.
    selectAllRows<{ sku_id: string; business_date: string; direct_oz: number | string | null; flattened_oz: number | string | null }>(
      async (from, to) => {
        const { data, error } = await sb.from("toast_daily_depletion")
          .select("sku_id, business_date, direct_oz, flattened_oz")
          .eq("location_id", locationId)
          .gte("business_date", windowStart)
          .lte("business_date", runDateEt)
          .order("id", { ascending: true })
          .range(from, to)
          .returns<Array<{ sku_id: string; business_date: string; direct_oz: number | string | null; flattened_oz: number | string | null }>>();
        if (error) throw new Error(`loadDemandInputs depletion: ${error.message}`);
        return { data };
      },
    ),
    // ④ THE FULL-GAP ORACLE (plan D10): the register RAN that day. A day with events but
    //    no depletion row for a SKU is a TRUE ZERO; a day with no events at all is a GAP
    //    and leaves the denominator entirely.
    selectAllRows<{ business_date: string }>(
      async (from, to) => {
        const { data, error } = await sb.from("toast_sales_events")
          .select("business_date")
          .eq("location_id", locationId)
          .gte("business_date", windowStart)
          .lte("business_date", runDateEt)
          .order("id", { ascending: true })
          .range(from, to)
          .returns<Array<{ business_date: string }>>();
        if (error) throw new Error(`loadDemandInputs sales events: ${error.message}`);
        return { data };
      },
    ),
    // ⑤ the day-grain catering marker + its start clamp.
    sb.from("toast_daily_sales_signals")
      .select("business_date, suspect_check_count")
      .eq("location_id", locationId)
      .gte("business_date", windowStart)
      .lte("business_date", runDateEt)
      .returns<Array<{ business_date: string; suspect_check_count: number }>>(),
    // ⑥ live productions in the window — mirrors loadSkuUsageRank exactly.
    selectAllRows<{ id: string; produced_at: string }>(
      async (from, to) => {
        const { data, error } = await sb.from("productions")
          .select("id, produced_at")
          .eq("location_id", locationId)
          .is("superseded_at", null).is("revoked_at", null)
          .gte("produced_at", `${windowStart}T00:00:00Z`)
          .order("id", { ascending: true })
          .range(from, to)
          .returns<Array<{ id: string; produced_at: string }>>();
        if (error) throw new Error(`loadDemandInputs productions: ${error.message}`);
        return { data };
      },
    ),
    // ⑧ THE SAME loader the recipe graph uses — one resolution ladder, not two.
    loadProductIndex(productIds, locationId),
    // ⑩ the perOrderUnitOz inputs, exactly as loadWalkerData assembles them.
    loadSkuPackChains(skuIds),
    loadMeasures(),
    // ⑨ Phase 1's rhythm loaders + the all-dows cutoff read (plan D5).
    loadRhythmByVendor(sb, vendorIds, locationId),
    loadRhythmSkips(sb, vendorIds, locationId, windowStart),
    loadAllCutoffsByVendor(sb, vendorIds),
    // ⑪+⑫ ONE read serves the hysteresis prior AND the budget. Both want recent
    //      par_auto_moves rows at this location; two reads of one window would be two
    //      round trips for one fact.
    selectAllRows<DbLedgerPriorRow>(
      async (from, to) => {
        const { data, error } = await sb.from("par_auto_moves")
          .select("sku_id, day_class, run_date, outcome, current_par, suggested_par, generation_id")
          .eq("location_id", locationId)
          .gte("run_date", priorFrom)
          .order("run_date", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to)
          .returns<DbLedgerPriorRow[]>();
        if (error) throw new Error(`loadDemandInputs par_auto_moves: ${error.message}`);
        return { data };
      },
    ),
    // ⑬ reverts also consume the budget (r2-8 final form), and they are recorded as
    //    human actions, not ledger rows — so the budget's other half reads from here.
    sb.from("par_suggestion_actions")
      .select("sku_id, day_class, action, acted_at")
      .eq("location_id", locationId)
      .gte("acted_at", `${budgetFrom}T00:00:00Z`)
      .returns<Array<{ sku_id: string; day_class: string; action: string; acted_at: string }>>(),
    // ⑭ the velocity recipe-edit reset.
    loadLatestRecipeEditAt(sb),
  ]);

  if (signalRows.error) throw new Error(`loadDemandInputs signals: ${signalRows.error.message}`);
  if (actionRows.error) throw new Error(`loadDemandInputs suggestion actions: ${actionRows.error.message}`);

  // ⑦ the production lane. Bounded by the window's production ids, so the `.in()` list is
  //    the same shape loadSkuUsageRank already spends.
  const prodDateById = new Map<string, string>();
  for (const p of productionHeaders) prodDateById.set(p.id, etCalendarDate(p.produced_at));
  const prodIds = productionHeaders
    .filter((p) => {
      const d = prodDateById.get(p.id);
      return d != null && d >= windowStart && d <= runDateEt;
    })
    .map((p) => p.id);
  //
  // ⚠ THE ID LIST IS WINDOWED, NOT SPENT WHOLE. `prodIds` is every live production at this
  // location over 21 days and is unbounded by design, so a single `.in()` would put the
  // 414 request-line cliff (~220 uuids against the 8 KB budget — lib/supabase-paginate.ts
  // requestLineBytesForInList) on an UNATTENDED nightly path, where it fails on page 0 with
  // zero rows and surfaces only as a swallowed console line in the cron's catch.
  // `selectAllRows` pages the RESPONSE and cannot help with the REQUEST. The house doctrine
  // names two remedies — a server-side embed or a windowed id set — and this is the second:
  // the filter is identical, just split into disjoint chunks whose union is exactly the
  // one-shot result, so there is no parity question to verify (which matters: production_
  // inputs has 0 rows in prod today, so a semantic change could not be parity-checked).
  // loadSkuUsageRank (lib/ordering.ts) still spends the whole list; that is pre-existing and
  // is NOT fixed here, but this path does not inherit it.
  const productionInputs: Array<{ production_id: string; input_sku_id: string; input_oz: number | string | null }> = [];
  for (let i = 0; i < prodIds.length; i += PRODUCTION_ID_CHUNK) {
    const chunk = prodIds.slice(i, i + PRODUCTION_ID_CHUNK);
    const page = await selectAllRows<{ production_id: string; input_sku_id: string; input_oz: number | string | null }>(
      async (from, to) => {
        const { data, error } = await sb.from("production_inputs")
          .select("production_id, input_sku_id, input_oz")
          .in("production_id", chunk)
          .order("id", { ascending: true })
          .range(from, to)
          .returns<Array<{ production_id: string; input_sku_id: string; input_oz: number | string | null }>>();
        if (error) throw new Error(`loadDemandInputs production_inputs: ${error.message}`);
        return { data };
      },
    );
    productionInputs.push(...page);
  }

  // ── The window, with both observability oracles resolved per day ──────────────
  const salesDays = new Set(salesEventDates.map((r) => r.business_date));
  const productionDays = new Set([...prodDateById.values()]);
  const window: WindowDay[] = [];
  for (let d = windowStart; d <= runDateEt; d = addDaysEt(d, 1)) {
    window.push({
      dateEt: d,
      dayClass: dayClassForDate(d),
      salesObserved: salesDays.has(d),
      productionObserved: productionDays.has(d),
    });
  }

  // ── PRODUCT-GRAIN ROLLUP, per date, through the ONE pure rollup ───────────────
  // r1-3: depletion rows are stamped with the RESOLVED member, so at SKU grain a primary
  // flip reads as demand collapse on one twin and a spike on the other. `rollupUsageByProduct`
  // is the shipped, test-pinned rollup (lib/products-shared.ts) — applied once per date so
  // there is no second opinion about how twins net, and the maps stay SKU-keyed.
  //
  // STATED CONSEQUENCE, and it is the intended one: when TWO members of one product both
  // carry pars, both read the PRODUCT's demand and both therefore compute against the same
  // rate. That is what product-grain means — the identity's demand does not halve because
  // two vendors can supply it. The ledger still writes one row per (sku, day_class),
  // because that is the table's grain and the walker renders per SKU; `detail.write_home_sku_id`
  // names the single slot a GRADUATED write would ever target (R3-B), so the two rows can
  // never become two auto-writes for one identity.
  const productBySku = productIndex.productBySku;
  const directOzByDate = rollupPerDate(depletionRows, (r) => r.business_date, (r) => r.sku_id, (r) => num(r.direct_oz) ?? 0, productBySku);
  const flattenedOzByDate = rollupPerDate(depletionRows, (r) => r.business_date, (r) => r.sku_id, (r) => num(r.flattened_oz) ?? 0, productBySku);
  const productionOzByDate = rollupPerDate(
    productionInputs,
    (r) => prodDateById.get(r.production_id) ?? "",
    (r) => r.input_sku_id,
    (r) => num(r.input_oz) ?? 0,
    productBySku,
  );

  // ── The SKU views, over the WALKER'S universe ─────────────────────────────────
  // resolveActive(overlay.activeOverride, sku.active) is the SAME rule loadWalkerData
  // applies (lib/ordering.ts), and applying it here is not cosmetic:
  //   · a locally-deactivated SKU that still ledgered would inflate the run-level
  //     reason_counts — i.e. pollute the errand list this phase is measured by, with rows
  //     no walk will ever show;
  //   · once the write bit flips, the machine would auto-write pars on SKUs this shop has
  //     switched off.
  // Note the filter is deliberately NOT `.eq("active", true)` in SQL, for the reason
  // loadWalkerData spells out: a promotional overlay (active_override true on a globally
  // inactive SKU) is genuinely part of this shop's walk, and a SQL filter would drop it.
  const rows = routable.filter((s) =>
    resolveActive(overlayBySku.get(s.id)?.activeOverride, s.active),
  );
  const skus: DemandSku[] = rows.map((s) => {
    const chain = chainsBySku.get(s.id) ?? null;
    const skuShape: RecipeInputSku = {
      packFormat: s.pack_format, eachContainerLabel: s.each_container_label,
      unitsPerPack: s.units_per_pack, eachSize: num(s.each_size), eachMeasure: s.each_measure,
      avgOzPerEach: num(s.avg_oz_per_each), packChain: chain,
    };
    const entry = s.product_id != null ? productIndex.byProduct.get(s.product_id) : undefined;
    return {
      skuId: s.id,
      name: s.name,
      vendorId: s.vendor_id as string,
      productId: s.product_id,
      grainKey: s.product_id ?? s.id,
      inventoryOnly: s.inventory_only === true,
      // #283: a retired product's par'd members are SUPPRESSED from the walk, so the
      // engine must not offer them a number either. Never mutated — only silenced.
      productRetired: entry != null && entry.active === false,
      cushionClass: s.cushion_class,
      parStep: parStepFor({
        parStep: num(s.par_step),
        weekdayPar: num(s.weekday_par),
        weekendPar: num(s.weekend_par),
      }),
      globalWeekdayPar: num(s.weekday_par),
      globalWeekendPar: num(s.weekend_par),
      // Normalized to positive-or-null (LEAD RULING F5) — parity with the walker's own
      // `perUnitOz != null && perUnitOz > 0` use site. A 0-oz denominator is a pack-data
      // errand, and it must reach the reason ladder as `no_weight_basis`, not slip through
      // as a null coverage that gets miscaused as thin history.
      perOrderUnitOz: normalizePerOrderUnitOz(
        perOrderUnitOz(skuShape, chain, measures as Map<string, MeasureUnitFactor>),
      ),
      hasPackChain: chain != null && chain.length > 0,
      // R3-B — the DESIGNATED primary, not the ladder's runtime answer.
      writeHomeSkuId: entry?.primarySkuId ?? s.id,
    };
  });

  // ── laneStartAt, per GRAIN, in memory ─────────────────────────────────────────
  const laneStartByGrain = new Map<string, string | null>();
  for (const sku of skus) {
    laneStartByGrain.set(
      sku.grainKey,
      deriveLaneStart({
        window, skuId: sku.skuId, directOzByDate, productionOzByDate, flattenedOzByDate,
      }),
    );
  }

  // ── Signals ───────────────────────────────────────────────────────────────────
  const suspectDays = new Set<string>();
  let signalsStartAt: string | null = null;
  for (const r of signalRows.data ?? []) {
    if (r.suspect_check_count > 0) suspectDays.add(r.business_date);
    if (signalsStartAt == null || r.business_date < signalsStartAt) signalsStartAt = r.business_date;
  }

  // ── The hysteresis prior + the simulated budget ───────────────────────────────
  // Both rules — including the two exclusions a re-invocation's idempotence rests on —
  // live in the pure module so they are test-pinned (tests/dynamic-pars-run.test.ts).
  const { priorBySlot, budgetSpentBySlot } = derivePriorAndBudget(
    ledgerRows.map((r) => ({
      skuId: r.sku_id, dayClass: r.day_class, runDate: r.run_date, outcome: r.outcome,
      currentPar: num(r.current_par), suggestedPar: num(r.suggested_par),
      generationId: r.generation_id,
    })),
    (actionRows.data ?? []).map((a) => ({
      skuId: a.sku_id, dayClass: a.day_class, action: a.action,
    })),
    { runDateEt, budgetFrom },
  );

  return {
    locationId,
    runDateEt,
    window,
    skus,
    overlayBySku,
    directOzByDate,
    productionOzByDate,
    flattenedOzByDate,
    laneStartByGrain,
    suspectDays,
    signalsStartAt,
    rhythmByVendor,
    skipsByVendor,
    cutoffsByVendor,
    priorBySlot,
    budgetSpentBySlot,
    recipeEditedAt,
    noLocalHistory: window.every((d) => !d.salesObserved && !d.productionObserved),
  };
}

interface DbLedgerPriorRow {
  sku_id: string; day_class: string; run_date: string; outcome: string;
  current_par: number | string | null; suggested_par: number | string | null;
  generation_id: string | null;
}

/** The per-location overlay with the machine lane + pins, probe-gated exactly like
 *  lib/ordering.ts's loadOverlayBySku. Pre-0183 the auto fields are ABSENT (not null),
 *  so `resolveParSlot` falls through to the global par. */
async function loadParOverlay(
  sb: ServiceClient,
  locationId: string,
  autoLane: boolean,
): Promise<Map<string, ParOverlayRow>> {
  const human = "sku_id, active_override, weekday_par, weekend_par";
  const auto =
    "auto_weekday_par, auto_weekend_par, auto_weekday_baseline_par, auto_weekend_baseline_par, pinned_weekday_at, pinned_weekend_at";
  const { data, error } = await sb.from("location_sku_settings")
    .select(autoLane ? `${human}, ${auto}` : human)
    .eq("location_id", locationId)
    .returns<Array<{
      sku_id: string; active_override: boolean | null;
      weekday_par: number | string | null; weekend_par: number | string | null;
      auto_weekday_par?: number | string | null; auto_weekend_par?: number | string | null;
      auto_weekday_baseline_par?: number | string | null;
      auto_weekend_baseline_par?: number | string | null;
      pinned_weekday_at?: string | null; pinned_weekend_at?: string | null;
    }>>();
  if (error) throw new Error(`loadParOverlay: ${error.message}`);
  const out = new Map<string, ParOverlayRow>();
  for (const r of data ?? []) {
    const row: ParOverlayRow = {
      activeOverride: r.active_override,
      weekdayPar: num(r.weekday_par),
      weekendPar: num(r.weekend_par),
      pinnedWeekdayAt: autoLane ? (r.pinned_weekday_at ?? null) : null,
      pinnedWeekendAt: autoLane ? (r.pinned_weekend_at ?? null) : null,
    };
    if (autoLane) {
      row.autoWeekdayPar = num(r.auto_weekday_par ?? null);
      row.autoWeekendPar = num(r.auto_weekend_par ?? null);
      row.autoWeekdayBaselinePar = num(r.auto_weekday_baseline_par ?? null);
      row.autoWeekendBaselinePar = num(r.auto_weekend_baseline_par ?? null);
    }
    out.set(r.sku_id, row);
  }
  return out;
}

/**
 * The most recent recipe edit ANYWHERE — the velocity series reset (r1-6). One row for the
 * whole run, not one per SKU.
 *
 * ⚠ STATED v1 LIMITATION (LEAD RULING F6): this is COARSER than the reset the pure core's
 * `VelocityInput.recipeEditedAt` would ideally receive. Any recipe edit anywhere resets
 * velocity for EVERY SKU for `VELOCITY_MIN_PERSISTENCE_DAYS` — including SKUs the edited
 * recipe has never touched.
 *
 * ACCEPTED for v1 on three grounds: the error direction is CONSERVATIVE (an over-reset can
 * only withhold a velocity nudge, never fabricate one); velocity is suggestion-lane-only in
 * v1, so the blast radius is a number not rendered rather than a par moved; and per-SKU
 * attribution needs flatten-aware audit parsing — resolving each `recipe_input.*` row's
 * component to a SKU *through the product ladder*, for edits whose recipe may reach the SKU
 * only transitively — which is a real piece of work for a term that is already the arc's
 * named drop-candidate.
 *
 * THE UPGRADE PATH, when it is worth it: return a Map<skuId, string> here and pass the
 * per-SKU entry at the call site. `VelocityInput` needs no signature change.
 */
async function loadLatestRecipeEditAt(sb: ServiceClient): Promise<string | null> {
  const { data, error } = await sb.from("audit_log")
    .select("occurred_at")
    .in("action", RECIPE_EDIT_ACTIONS as unknown as string[])
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ occurred_at: string }>();
  if (error) throw new Error(`loadLatestRecipeEditAt: ${error.message}`);
  return data?.occurred_at != null ? etCalendarDate(data.occurred_at) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 3.6 — the shadow engine
// ─────────────────────────────────────────────────────────────────────────────

export type { ParRunCounts } from "@/lib/dynamic-pars-run-shared";

export interface ParRunResult {
  rows: number;
  skipped?: "schema_pending" | "stale_depletion";
  counts?: ParRunCounts;
}

/** One `par_auto_moves` row, exactly as the table spells it. */
interface LedgerRow {
  run_date: string;
  location_id: string;
  sku_id: string;
  day_class: DayClass;
  mode: "shadow" | "live";
  tier: "auto" | "suggestion" | "none";
  outcome: "would_apply" | "applied" | "suppressed" | "advisory_null";
  suppressed_by: string | null;
  reason_code: ParReasonCode;
  generation_id: string | null;
  current_par: number | null;
  target_par: number | null;
  suggested_par: number | null;
  par_step: number | null;
  slot_creation: boolean;
  base_rate_oz_per_day: number | null;
  observed_days: number | null;
  gap_days: number | null;
  velocity_ratio: number | null;
  cushion_pct: number | null;
  per_order_unit_oz: number | null;
  peak_floor_oz: number | null;
  coverage_days: number | null;
  next_delivery_date: string | null;
  cover_through_date: string | null;
  detail: Record<string, unknown>;
}

/**
 * THE NIGHTLY RUN for one location. Orchestration only — every rule it applies lives in
 * the pure core, and this function's job is the ORDER and the SHORT-CIRCUITS.
 *
 * ── THE SIMULATED BUDGET READS THE RECOMPUTABLE LEDGER, NOT A COUNTER ──────────
 * The budget is a COUNT over `par_auto_moves` (applied + earlier would_apply) plus the
 * reverts in `par_suggestion_actions`. In shadow that is a genuine longitudinal
 * simulation of the guard. On the day a location goes live the counter is not
 * phantom-spent: live mode's `applied` rows are the only ones that will exist going
 * forward, and the simulated `would_apply` rows age out of the 7-day window inside a week.
 *
 * ── IDEMPOTENT (plan D13) ──────────────────────────────────────────────────────
 * The nightly recompute DELETEs its own prior opinions for (run_date, location) WHERE
 * `outcome <> 'applied'` and re-inserts — the `materializeDailyDepletion` pattern, and the
 * ONE documented exception to the append-only law. An `applied` row records a real par
 * write and is never deleted and never updated.
 */
export async function runParShadowForLocation(
  locationId: string,
  runDateEt: string,
): Promise<ParRunResult> {
  const sb = getServiceRoleClient();

  // PRE-0182: no ledger to write to. Return silently and write NO audit row — a nightly
  // "I did nothing" row is noise, not evidence (Task 3.9).
  if (!(await parAutoMovesReady(sb))) return { rows: 0, skipped: "schema_pending" };

  const mode: "shadow" | "live" = PAR_AUTO_APPLY_ENABLED ? "live" : "shadow";
  const inputs = await loadDemandInputs(sb, locationId, runDateEt);
  const ledger: LedgerRow[] = [];

  for (const sku of inputs.skus) {
    // The demand terms are computed ONCE per SKU — they are day-class-split internally,
    // and they are the expensive half (21 days x 2 lanes).
    const base = computeBaseRate({
      window: inputs.window,
      directOzByDate: perSkuSeries(inputs.directOzByDate, sku.skuId),
      productionOzByDate: perSkuSeries(inputs.productionOzByDate, sku.skuId),
      flattenedOzByDate: perSkuSeries(inputs.flattenedOzByDate, sku.skuId),
      laneStartAt: inputs.laneStartByGrain.get(sku.grainKey) ?? null,
    });

    const velocitySeries: VelocityDay[] = base.series.map((d) => ({
      dateEt: d.dateEt,
      dayClass: d.dayClass,
      oz: d.oz,
      suspect: inputs.suspectDays.has(d.dateEt),
    }));
    const velocity = computeVelocityRatio({
      series: velocitySeries,
      baseByDayClass: {
        weekday: base.byDayClass.weekday.ozPerDay,
        weekend: base.byDayClass.weekend.ozPerDay,
      },
      perOrderUnitOz: sku.perOrderUnitOz,
      recipeEditedAt: inputs.recipeEditedAt,
      signalsStartAt: inputs.signalsStartAt,
    });

    const rhythm = inputs.rhythmByVendor.get(sku.vendorId) ?? [];
    const overlay = inputs.overlayBySku.get(sku.skuId) ?? null;

    for (const dayClass of ["weekday", "weekend"] as const) {
      const rate = base.byDayClass[dayClass];
      const slot = resolveParSlot(
        overlay,
        { weekdayPar: sku.globalWeekdayPar, weekendPar: sku.globalWeekendPar },
        dayClass,
      );
      const currentPar = slot.value;
      const push = (row: LedgerRow) => ledger.push(row);
      const shell = (): LedgerRow => ({
        run_date: runDateEt, location_id: locationId, sku_id: sku.skuId, day_class: dayClass,
        mode, tier: "none", outcome: "advisory_null", suppressed_by: null,
        reason_code: "ok", generation_id: null,
        current_par: currentPar, target_par: null, suggested_par: null, par_step: sku.parStep,
        slot_creation: currentPar == null,
        base_rate_oz_per_day: rate.ozPerDay, observed_days: rate.observedDays,
        gap_days: rate.gapDays, velocity_ratio: velocity.ratio,
        cushion_pct: null, per_order_unit_oz: sku.perOrderUnitOz, peak_floor_oz: null,
        coverage_days: null, next_delivery_date: null, cover_through_date: null,
        detail: {
          lane: slot.lane,
          lane_complete: base.laneComplete,
          lane_start_at: inputs.laneStartByGrain.get(sku.grainKey) ?? null,
          velocity_reason: velocity.reason,
          velocity_applied: velocity.applied,
          write_home_sku_id: sku.writeHomeSkuId,
          grain_key: sku.grainKey,
          horizon_basis: "nightly_start_of_order_day",
        },
      });
      const advisoryNullRow = (reason: ParReasonCode): LedgerRow => ({
        ...shell(), reason_code: reason,
      });

      // ① THE REASON LADDER RUNS FIRST AND SHORT-CIRCUITS. A silenced row still gets a
      //    FULL ledger row — the reason lane IS the product, so a silent par is a WRITE.
      const reason = classifyParReason({
        inventoryOnly: sku.inventoryOnly,
        productRetired: sku.productRetired,
        depletionCurrent: true, // the cron gates on the watermark BEFORE calling this.
        laneNeverStarted: base.laneNeverStarted,
        laneComplete: base.laneComplete,
        perOrderUnitOz: sku.perOrderUnitOz,
        hasPackChain: sku.hasPackChain,
        hasRhythm: rhythm.length > 0,
        thin: rate.thin,
        slotExists: currentPar != null,
        noLocalHistory: inputs.noLocalHistory,
      });
      // THE ONE CARVE-OUT, and it is D16's: `slot_creation` is a SILENCING reason on the
      // WALKER (never a row-level number) but it is NOT a reason to stop computing. D16
      // requires the weekend day-class to be "always computed and always ledgered with
      // slot_creation = true" so the aggregate can say "N SKUs look like they want a
      // separate weekend par" — and applyGuardStack already carries a slot-creation branch
      // that produces exactly that number. Short-circuiting here would make that branch
      // dead code and blind the aggregate to its own subject.
      if (SILENCING_REASONS.has(reason) && reason !== "slot_creation") {
        push(advisoryNullRow(reason));
        continue;
      }

      // ② The horizon THIS RUN computes with. The weekend day-class optimises the FRIDAY
      //    walk (the longest gap, r3); the rendered suggestion re-selects live (R3-A).
      const walkDateEt = optimizationWalkDate(dayClass, runDateEt);
      const window = coverageWindow({
        rhythm,
        cutoffs: inputs.cutoffsByVendor.get(sku.vendorId) ?? [],
        skips: inputs.skipsByVendor.get(sku.vendorId) ?? [],
        locationId,
        walkDateEt,
        walkMinutesEt: NIGHTLY_HORIZON_WALK_MINUTES,
      });
      if (window == null) { push(advisoryNullRow("no_vendor_rhythm")); continue; }

      // ③ + ④ the terms and the coverage — all pure, all persisted.
      const cushion = cushionFor(
        { cushionClass: sku.cushionClass },
        { id: locationId },
        { ozPerDay: rate.ozPerDay, observedDays: rate.observedDays },
      );
      const peakFloorOz = observedPeakCoverageOz(
        base.series.map((d) => d.oz),
        window.coveredDays.length,
      );
      const coverage = computeCoverage({
        coveredDays: window.coveredDays,
        baseOzPerDay: {
          weekday: base.byDayClass.weekday.ozPerDay,
          weekend: base.byDayClass.weekend.ozPerDay,
        },
        velocityRatio: velocity.ratio,
        cushionPct: cushion.pct,
        perOrderUnitOz: sku.perOrderUnitOz,
        peakFloorOz,
      });
      const horizon = {
        cushion_class: cushion.classUsed,
        cushion_is_default: cushion.isDefault,
        optimisation_walk_date: walkDateEt,
        order_date: window.orderDateEt,
      };
      if (coverage == null) {
        // CAUSE ATTRIBUTION, not a default (LEAD RULING F3's principle: the ledger's
        // reasons are read as ERRANDS, so a wrong cause is a wrong errand). The ladder
        // already proved perOrderUnitOz is non-null, so a null coverage here means a day
        // in the horizon belongs to a day-class with NO rate — which is thin history in
        // the OTHER day-class, not a missing weight.
        const cause: ParReasonCode = sku.perOrderUnitOz == null ? "no_weight_basis" : "thin_history";
        push({
          ...advisoryNullRow(cause),
          cushion_pct: cushion.pct,
          peak_floor_oz: peakFloorOz,
          coverage_days: window.coveredDays.length,
          next_delivery_date: window.nextDeliveryDate,
          cover_through_date: window.coverThroughDate,
          detail: { ...shell().detail, ...horizon },
        });
        continue;
      }

      // ⑤ the guard stack — the SAME code live mode runs, with a mode flag (r2-7).
      const prior = inputs.priorBySlot.get(slotKey(sku.skuId, dayClass)) ?? null;
      const roundedTarget = roundToStep(coverage.targetUnits, sku.parStep);
      const verdict: GuardOutcome = applyGuardStack({
        locationId,
        skuId: sku.skuId,
        dayClass,
        currentPar,
        targetUnits: coverage.targetUnits,
        parStep: sku.parStep,
        priorSuggestedPar: prior?.suggestedPar ?? null,
        priorGenerationId: prior?.generationId ?? null,
        // Two consecutive runs must agree on the DIRECTION, or step-rounding of a
        // continuous target oscillates 2.49 <-> 2.51 forever (r1-6).
        directionConfirmed: directionConfirmed(prior, currentPar, roundedTarget),
        budgetSpent: inputs.budgetSpentBySlot.has(slotKey(sku.skuId, dayClass)),
        pinned: (dayClass === "weekend" ? overlay?.pinnedWeekendAt : overlay?.pinnedWeekdayAt) != null,
        mode,
      });

      push({
        ...shell(),
        tier: verdict.tier,
        outcome: verdict.outcome,
        suppressed_by: verdict.suppressedBy,
        reason_code: verdict.reasonCode,
        generation_id: verdict.generationId,
        target_par: coverage.targetUnits,
        suggested_par: verdict.suggestedPar,
        slot_creation: verdict.slotCreation,
        cushion_pct: cushion.pct,
        peak_floor_oz: peakFloorOz,
        coverage_days: window.coveredDays.length,
        next_delivery_date: window.nextDeliveryDate,
        cover_through_date: window.coverThroughDate,
        detail: {
          ...shell().detail,
          ...horizon,
          demand_oz: coverage.demandOz,
          covered_oz: coverage.coveredOz,
          floored_by_peak: coverage.flooredByPeak,
          prior_suggested_par: prior?.suggestedPar ?? null,
          prior_direction: prior?.direction ?? 0,
        },
      });
    }
  }

  await writeLedger(sb, locationId, runDateEt, ledger);
  const counts = tallyRun(toTallyRows(ledger));
  await auditRun(locationId, runDateEt, mode, counts, runDateEt);
  return { rows: ledger.length, counts };
}

/** The ledger's DB-shaped rows in the tally's camelCase shape. The pure tally must not
 *  learn the column spellings — that is what keeps it testable without a database. */
function toTallyRows(ledger: ReadonlyArray<LedgerRow>) {
  return ledger.map((r) => ({
    outcome: r.outcome, tier: r.tier, suppressedBy: r.suppressed_by, reasonCode: r.reason_code,
  }));
}

/**
 * Delete-then-insert, scoped to this run's own recomputable opinions (plan D13).
 * `outcome <> 'applied'` is the whole append-only reconciliation: a would_apply /
 * suppressed / advisory_null row is a re-derivable opinion, an `applied` row is the
 * record of a real par write and is sacred.
 */
async function writeLedger(
  sb: ServiceClient,
  locationId: string,
  runDateEt: string,
  ledger: ReadonlyArray<LedgerRow>,
): Promise<void> {
  const { error: delErr } = await sb.from("par_auto_moves")
    .delete()
    .eq("run_date", runDateEt)
    .eq("location_id", locationId)
    .neq("outcome", "applied");
  if (delErr) throw new Error(`par_auto_moves delete-run: ${delErr.message}`);

  // An `applied` row for this (run_date, sku, day_class) survived the delete, so re-inserting
  // its slot would hit the UNIQUE. Drop those from the batch: the real write outranks a
  // simulated re-opinion about the same slot on the same night.
  const applied = await loadAppliedSlots(sb, locationId, runDateEt);
  const batch = ledger.filter((r) => !applied.has(slotKey(r.sku_id, r.day_class)));

  for (let i = 0; i < batch.length; i += LEDGER_INSERT_CHUNK) {
    const chunk = batch.slice(i, i + LEDGER_INSERT_CHUNK);
    const { error } = await sb.from("par_auto_moves").insert(chunk);
    if (error) throw new Error(`par_auto_moves insert: ${error.message}`);
  }
}

async function loadAppliedSlots(
  sb: ServiceClient,
  locationId: string,
  runDateEt: string,
): Promise<Set<string>> {
  const { data, error } = await sb.from("par_auto_moves")
    .select("sku_id, day_class")
    .eq("run_date", runDateEt)
    .eq("location_id", locationId)
    .eq("outcome", "applied")
    .returns<Array<{ sku_id: string; day_class: DayClass }>>();
  if (error) throw new Error(`par_auto_moves applied-slots: ${error.message}`);
  return new Set((data ?? []).map((r) => slotKey(r.sku_id, r.day_class)));
}

/** ONE audit row per (location, night). 282 per-SKU rows a night would be ~21x the entire
 *  audit log annually (r3) — the per-SKU detail lives in par_auto_moves. */
async function auditRun(
  locationId: string,
  runDateEt: string,
  mode: "shadow" | "live",
  counts: ParRunCounts,
  watermark: string | null,
): Promise<void> {
  await audit({
    actorId: null, actorRole: null,             // system observation — actor IS null.
    action: RUN_AUDIT_ACTION[mode],             // v1 = par.auto_tune_shadow.
    resourceTable: "par_auto_moves", resourceId: locationId,
    metadata: {
      run_date: runDateEt, actor_context: "cron", mode,
      rows: counts.rows, would_apply: counts.wouldApply, applied: counts.applied,
      suggestions: counts.suggestion, advisory_null: counts.advisoryNull,
      suppressed_by: counts.suppressedBy,
      reason_counts: counts.byReason,           // the reason lane, in one row, every night.
      depletion_through: watermark,
    },
    ipAddress: null, userAgent: null,
  });
}

/**
 * A location whose depletion is not current through this business date is SKIPPED — and
 * SAYING SO IS A WRITE, not a silence.
 *
 * r3: "materialize-failed locations get advisory-null, never stale-computed." Writing
 * nothing would leave last night's numbers standing as the walker's latest ledger row,
 * which is exactly the stale-computed read the rule forbids. So the run writes a full
 * advisory-null row per (SKU, day-class) with reason `stale_depletion`, using ONE cheap
 * read of the par'd SKU list — no demand loading, no rhythm, no product index.
 */
export async function recordParRunSkipped(
  locationId: string,
  runDateEt: string,
  watermark: string | null,
): Promise<ParRunResult> {
  const sb = getServiceRoleClient();
  if (!(await parAutoMovesReady(sb))) return { rows: 0, skipped: "schema_pending" };

  // THE SAME UNIVERSE THE FULL RUN WOULD HAVE COVERED — routable AND active at this shop.
  // Two paths emitting different row counts for one catalog on one night would make the
  // ledger's own row count meaningless as evidence, so the skip path pays for the overlay
  // read too. Still only two reads: no demand, no rhythm, no product index.
  const [{ data, error }, overlayBySku] = await Promise.all([
    sb.from("vendor_items")
      .select("id, vendor_id, active, weekday_par, weekend_par, par_step")
      .or("weekday_par.not.is.null,weekend_par.not.is.null")
      .returns<Array<{ id: string; vendor_id: string | null; active: boolean; weekday_par: number | string | null; weekend_par: number | string | null; par_step: number | string | null }>>(),
    loadParOverlay(sb, locationId, await parAutoLaneReady(sb)),
  ]);
  if (error) throw new Error(`recordParRunSkipped skus: ${error.message}`);

  const mode: "shadow" | "live" = PAR_AUTO_APPLY_ENABLED ? "live" : "shadow";
  const ledger: LedgerRow[] = [];
  const universe = (data ?? []).filter(
    (s) => s.vendor_id != null && resolveActive(overlayBySku.get(s.id)?.activeOverride, s.active),
  );
  for (const s of universe) {
    const parStep = parStepFor({
      parStep: num(s.par_step), weekdayPar: num(s.weekday_par), weekendPar: num(s.weekend_par),
    });
    for (const dayClass of ["weekday", "weekend"] as const) {
      ledger.push({
        run_date: runDateEt, location_id: locationId, sku_id: s.id, day_class: dayClass,
        mode, tier: "none", outcome: "advisory_null", suppressed_by: null,
        reason_code: "stale_depletion", generation_id: null,
        current_par: null, target_par: null, suggested_par: null, par_step: parStep,
        slot_creation: false,
        base_rate_oz_per_day: null, observed_days: null, gap_days: null,
        velocity_ratio: null, cushion_pct: null, per_order_unit_oz: null, peak_floor_oz: null,
        coverage_days: null, next_delivery_date: null, cover_through_date: null,
        detail: { depletion_through: watermark, skipped: "stale_depletion" },
      });
    }
  }
  await writeLedger(sb, locationId, runDateEt, ledger);
  await auditRun(locationId, runDateEt, mode, tallyRun(toTallyRows(ledger)), watermark);
  return { rows: ledger.length, skipped: "stale_depletion" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 3.8 — THE one par-write authority
// ─────────────────────────────────────────────────────────────────────────────

export interface ParWriteInput {
  /** null ONLY for actorKind "machine". */
  actor: AuthContext | null;
  /**
   * "admin" is absent DELIBERATELY. The SKU admin's overlay editor owns its own row —
   * it writes `active_override` and BOTH par slots in one upsert, and it must decide
   * insert-vs-update — so forcing it through this per-slot async writer would mean two
   * UPDATEs racing on one row and two `vendor_item.update` audit rows for one edit, for
   * zero safety gain. It routes through the SAME authority at the layer that matters:
   * `parWriteColumns({ kind: "admin", … })` in the pure core decides its machine-lane and
   * pin effects, exactly as it decides this function's. One place decides; two places
   * execute, on rows with genuinely different shapes.
   */
  actorKind: Exclude<ParWriteActorKind, "admin">;
  locationId: string;
  skuId: string;
  dayClass: DayClass;
  /** The new HUMAN-lane value for this slot ("accept" / "revert"). */
  value: number | null;
  /** "machine" only: the number being applied. */
  autoValue?: number | null;
  /** The suggestion generation this write answers ("accept" / "revert"). */
  generationId?: string | null;
  /** "machine" only: the global par it was computed against (r2-6 baseline). */
  baselinePar?: number | null;
}

/**
 * THE ONE PAR-WRITE AUTHORITY (r3 authz).
 *
 * Accepting a suggestion used to be a privilege escalation waiting to happen: the walker's
 * floor is KH (4) and a par write is GM (7). One function, one actor-kind, one role check.
 *
 * WHAT EACH KIND DOES, and why the differences are not arbitrary:
 *
 *   "accept"  — the walker's one-tap. Writes the HUMAN lane at this slot, records the
 *               generation in par_suggestion_actions, CLEARS the pin (a direct human write
 *               at this grain IS the human re-engaging), and DOES NOT CONSUME THE BUDGET:
 *               the incentive must never punish engagement (r2-8). Level 7, NO step-up
 *               (plan D2 — a password prompt at 6 AM on a shelf walk is the affordance's
 *               death, and the blast radius is one slot on one SKU at one shop).
 *
 *   "revert"  — an "accept"-class human write (it moves the par back) that additionally
 *               SETS the pin and DOES consume the budget: reverts are non-manual-origin
 *               par writes and the budget is what stops a revert war (r2-8 final form).
 *
 *   "machine" — the graduated nightly engine. Writes the AUTO lane ONLY, records the
 *               baseline, stamps applied_at, and NEVER touches the human lane, the pin, or
 *               the global vendor_items par. actor null. UNREACHABLE in v1
 *               (PAR_AUTO_APPLY_ENABLED is false).
 *
 * SILENT-UPDATE-DENIAL LAW: the UPDATE passes { count: "exact" } and raises an explicit
 * 404 on 0 rows. A denied or missed UPDATE is silent on Supabase (UPDATE 0, no error).
 */
export async function writeParFromSuggestion(input: ParWriteInput): Promise<void> {
  if (input.actorKind === "machine") {
    if (input.actor != null) {
      throw new DynamicParsError(400, "machine_write_has_actor", "A machine write carries no actor");
    }
    if (!PAR_AUTO_APPLY_ENABLED) {
      // Belt AND braces (Task 3.9): "the write bit is off" and "the columns do not exist"
      // must both be true, and must be true INDEPENDENTLY. This is the first of the two.
      throw new DynamicParsError(503, "auto_apply_disabled", "Auto-apply is off in this build");
    }
  } else {
    if (input.actor == null) throw new DynamicParsError(401, "unauthorized", "Actor required");
    requireLevel(input.actor, PAR_WRITE_MIN);
    // Level 7 is not all-locations (that grant starts at 9), so the role gate alone does
    // NOT say which shop's par this actor may move. Before the arbiter, before any I/O.
    requireLocation(input.actor, input.locationId);
  }
  // The MACHINE kind is exempt by design: it carries no actor at all, and the nightly cron
  // iterates every location on purpose. There is no session to bind it to.

  const sb = getServiceRoleClient();
  // Refuse UP FRONT, before anything is read or written: a human verdict that cannot be
  // recorded may not move a par (0182 carries par_suggestion_actions).
  if (input.actorKind !== "machine" && !(await parSuggestionActionsReady(sb))) {
    throw new DynamicParsError(503, "par_ledger_pending", "Migration 0182 (GATE M1) is not applied");
  }
  const autoLaneReady = await parAutoLaneReady(sb);
  const nowIso = new Date().toISOString();
  const effect = parWriteColumns({
    kind: input.actorKind,
    dayClass: input.dayClass,
    value: input.value,
    autoValue: input.autoValue ?? null,
    baselinePar: input.baselinePar ?? null,
    appliedAt: nowIso,
  });

  // Pre-0183 the auto columns do not exist, so only the human half may be written. A
  // machine write is impossible then by construction: its patch is entirely auto-lane.
  if (!autoLaneReady && input.actorKind === "machine") {
    throw new DynamicParsError(503, "par_auto_lane_pending", "Migration 0183 (GATE M2) is not applied");
  }
  const patch: Record<string, number | string | null> = {
    ...effect.human,
    ...(autoLaneReady ? effect.autoLane : {}),
  };

  const before = await loadSlotValue(sb, input.locationId, input.skuId, input.dayClass, autoLaneReady);

  // ⚠ THE ARBITER RUNS BEFORE THE MUTATION, AND THE ORDER IS THE GUARANTEE.
  //
  // par_suggestion_actions' UNIQUE (location, sku, day_class, generation_id) is what makes
  // "one human verdict per generation" true, so it has to be claimed BEFORE the par moves.
  // Writing first and claiming second loses both halves of its job:
  //   · two taps on one generation would BOTH land their UPDATE and only then would one
  //     get 23505 — a 409 telling the caller nothing happened after something did, and an
  //     accept racing a revert settling on whichever UPDATE committed last;
  //   · pre-0182 an accept would move the par and THEN throw `par_ledger_pending`, leaving
  //     a changed par with no action row and no audit row.
  //
  // STATED TRADE-OFF: if the par write below fails after the claim lands, the generation is
  // consumed and a retry gets 409 with the par unmoved. That is the RIGHT failure — the
  // manager sees the number did not change and can edit it directly, and nothing altered
  // the kitchen without an accountability record. The reverse orphan (a moved par with no
  // audit row) is the one AGENTS.md's "who changed the kitchen?" filter exists to prevent.
  if (input.actorKind !== "machine") {
    await recordSuggestionAction(sb, {
      locationId: input.locationId, skuId: input.skuId, dayClass: input.dayClass,
      generationId: input.generationId ?? null,
      action: input.actorKind === "revert" ? "revert" : "accept",
      parBefore: before.humanPar, parAfter: input.value,
      actorId: input.actor!.user.id,
    });
  }

  if (before.rowId == null) {
    const { error } = await sb.from("location_sku_settings").insert({
      location_id: input.locationId, sku_id: input.skuId, ...patch,
    });
    if (error) throw new Error(`writeParFromSuggestion insert: ${error.message}`);
  } else {
    const { error, count } = await sb.from("location_sku_settings")
      .update(patch, { count: "exact" })
      .eq("id", before.rowId);
    if (error) throw new Error(`writeParFromSuggestion update: ${error.message}`);
    if (count === 0) throw new DynamicParsError(404, "not_found", "Overlay row vanished");
  }

  if (input.actorKind !== "machine") {
    await audit({
      actorId: input.actor!.user.id,
      actorRole: input.actor!.user.role,
      action: (input.actorKind === "revert" ? "par.auto_tune_revert" : "par.suggestion_accept") satisfies AuditAction,
      resourceTable: "location_sku_settings",
      resourceId: input.skuId,
      metadata: {
        location_id: input.locationId,
        day_class: input.dayClass,
        generation_id: input.generationId ?? null,
        before: before.humanPar,
        after: input.value,
        auto_before: before.autoPar,
      },
      ipAddress: null, userAgent: null,
    });
  }
}

/** Undo an applied auto-move: writes the human lane back, SETS the pin, burns the budget. */
export async function revertAutoMove(
  actor: AuthContext,
  args: { locationId: string; skuId: string; dayClass: DayClass; value: number | null; generationId: string | null },
): Promise<void> {
  await writeParFromSuggestion({ actor, actorKind: "revert", ...args });
}

/**
 * Decline a suggestion. NOTHING changes — no par write, no pin, no budget. It exists so
 * the trust ramp has a denominator and the ledger can tell "offered and refused" from
 * "offered and ignored" (r2-2). Same level-7 floor as accept, deliberately: dismiss feeds
 * the ramp's denominator, so a level-4 dismiss would let a key-holder starve a graduation
 * gate they cannot see the consequences of (plan D1).
 */
export async function dismissSuggestion(
  actor: AuthContext,
  args: { locationId: string; skuId: string; dayClass: DayClass; generationId: string | null; currentPar: number | null },
): Promise<void> {
  requireLevel(actor, PAR_WRITE_MIN);
  // A dismiss writes no par, but it DOES consume a generation and feed the trust ramp's
  // denominator — so a wrong-shop dismiss would let one shop's manager starve another
  // shop's graduation gate. Bound before the arbiter, exactly like the write path.
  requireLocation(actor, args.locationId);
  const sb = getServiceRoleClient();
  await recordSuggestionAction(sb, {
    locationId: args.locationId, skuId: args.skuId, dayClass: args.dayClass,
    generationId: args.generationId, action: "dismiss",
    parBefore: args.currentPar, parAfter: args.currentPar, actorId: actor.user.id,
  });
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "par.suggestion_dismiss",
    resourceTable: "par_suggestion_actions", resourceId: args.skuId,
    metadata: {
      location_id: args.locationId, day_class: args.dayClass,
      generation_id: args.generationId, before: args.currentPar, after: args.currentPar,
    },
    ipAddress: null, userAgent: null,
  });
}

/**
 * ONE HUMAN VERDICT PER GENERATION, ARBITRATED BY THE UNIQUE INDEX (plan D14).
 *
 * Two taps on one suggestion race; the loser gets 23505 and the route maps it to
 * 409 `suggestion_already_actioned` — exactly the move the display-code unique index makes
 * for the double-generate race (lib/ordering.ts noCodeSuffixRetry), proven on this exact
 * surface by SIM-22. The index IS the guard; there is no read-then-write window to lose.
 */
async function recordSuggestionAction(
  sb: ServiceClient,
  args: {
    locationId: string; skuId: string; dayClass: DayClass; generationId: string | null;
    action: "accept" | "dismiss" | "revert"; parBefore: number | null; parAfter: number | null;
    actorId: string;
  },
): Promise<void> {
  if (!(await parSuggestionActionsReady(sb))) {
    throw new DynamicParsError(503, "par_ledger_pending", "Migration 0182 (GATE M1) is not applied");
  }
  if (args.generationId == null) {
    throw new DynamicParsError(400, "missing_generation", "A suggestion verdict needs its generation");
  }
  const { error } = await sb.from("par_suggestion_actions").insert({
    location_id: args.locationId, sku_id: args.skuId, day_class: args.dayClass,
    generation_id: args.generationId, action: args.action,
    par_before: args.parBefore, par_after: args.parAfter, actor_id: args.actorId,
  });
  if (error) {
    if (error.code === "23505") {
      throw new DynamicParsError(409, "suggestion_already_actioned", "This suggestion was already actioned");
    }
    throw new Error(`par_suggestion_actions insert: ${error.message}`);
  }
}

async function loadSlotValue(
  sb: ServiceClient,
  locationId: string,
  skuId: string,
  dayClass: DayClass,
  autoLaneReady: boolean,
): Promise<{ rowId: string | null; humanPar: number | null; autoPar: number | null }> {
  const humanCol = dayClass === "weekend" ? "weekend_par" : "weekday_par";
  const autoCol = `auto_${dayClass}_par`;
  const { data, error } = await sb.from("location_sku_settings")
    .select(autoLaneReady ? `id, ${humanCol}, ${autoCol}` : `id, ${humanCol}`)
    .eq("location_id", locationId)
    .eq("sku_id", skuId)
    .maybeSingle<Record<string, string | number | null>>();
  if (error) throw new Error(`loadSlotValue: ${error.message}`);
  if (!data) return { rowId: null, humanPar: null, autoPar: null };
  return {
    rowId: (data.id as string | null) ?? null,
    humanPar: num(data[humanCol] as number | string | null),
    autoPar: autoLaneReady ? num(data[autoCol] as number | string | null) : null,
  };
}
