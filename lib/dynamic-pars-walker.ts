/**
 * DYNAMIC PARS — the WALKER'S read path: the suggestion payload and the reason lane.
 *
 * SERVER-ONLY. Service-role throughout; authorization is the CALLER'S (the walker resolves
 * `canAct` from its own actor and hands it in — plan D1).
 *
 * ── WHY THIS IS ITS OWN MODULE AND NOT PART OF lib/dynamic-pars.ts ─────────────
 * The plan names `lib/dynamic-pars.ts` as these two functions' home, and it re-exports
 * both so every consumer the plan names reaches them at that path. They are DEFINED here
 * because their one caller is `lib/ordering.ts` — which `lib/dynamic-pars.ts` IMPORTS
 * (WALKER_SKU_COLUMNS, perOrderUnitOz). Hosting them in the server module would make the
 * walker and the engine mutually recursive for the sake of two reads. This is the exact
 * shape, and the exact reasoning, of lib/dynamic-pars-probes.ts one phase earlier: define
 * in a module that imports no consumer, re-export from the one the plan names.
 *
 * ── NOTHING HERE WRITES ────────────────────────────────────────────────────────
 * The write-on-read law (AGENTS.md) forbids MUTATIONS on a read path, not selection. The
 * horizon re-selection below is a pure selection over persisted terms (head ruling R3-A);
 * every rule it applies lives in lib/dynamic-pars-shared.ts. If a change to this file ever
 * needs an INSERT or an UPDATE, it belongs in the nightly engine instead.
 */
import "server-only";

import type { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import {
  loadRhythmByVendor, loadRhythmSkips, loadAllCutoffsByVendor,
} from "@/lib/vendor-rhythm";
import { addDaysEt, coverageWindow } from "@/lib/vendor-rhythm-shared";
import {
  DYNAMIC_PARS, EMPTY_PAR_SILENCE, resolveWalkerSuggestion, rollupParSilence,
  type DayClass, type GuardName, type ParReasonCode, type ParSilenceSummary,
  type PersistedDemandTerms, type SilenceLedgerRow, type WalkerParSuggestion,
} from "@/lib/dynamic-pars-shared";
import { parAutoMovesReady, parSuggestionActionsReady } from "@/lib/dynamic-pars-probes";

type ServiceClient = ReturnType<typeof getServiceRoleClient>;

/** PostgREST numerics arrive as number | string | null. */
function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 4.1 — the walker's payload: one batched read, the horizon re-selected live
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A ledger row this many days old is treated as ABSENT, not as an opinion.
 *
 * A suggestion computed from a week-old base is not a current opinion about tonight's
 * shelf. 3 days clears the Friday→Monday gap — the same reasoning, and the same span,
 * `loadShrinkageSignals`' 72h window already uses (lib/ordering.ts).
 */
const SUGGESTION_STALE_DAYS = 3;

/** How many days back the aggregate looks for auto-moves. Matches the budget window. */
const AUTO_MOVE_WEEK_DAYS = DYNAMIC_PARS.BUDGET_WINDOW_DAYS;

/**
 * The two facts about a SKU that the LEDGER does not carry: which vendor's rhythm governs
 * it, and what to call it in an errand row. `loadWalkerData` already has both from its own
 * `vendor_items` read and passes them in; a standalone caller (the accept/dismiss route)
 * omits it and the loader fetches the same two columns for itself.
 */
export interface ParSkuIndexEntry {
  vendorId: string | null;
  name: string;
}

/** The par'd-SKU universe, exactly as the walker defines it. NO id list in the request
 *  line: the `.or(...)` par filter is the same predicate `loadWalkerData` uses. */
async function loadParSkuIndex(sb: ServiceClient): Promise<Map<string, ParSkuIndexEntry>> {
  const { data, error } = await sb.from("vendor_items")
    .select("id, name, vendor_id")
    .or("weekday_par.not.is.null,weekend_par.not.is.null")
    .returns<Array<{ id: string; name: string; vendor_id: string | null }>>();
  if (error) throw new Error(`loadParSkuIndex: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.id, { vendorId: r.vendor_id, name: r.name }]));
}

/** The `par_auto_moves` columns the walk-time re-selection reads. One spelling. */
const WALKER_LEDGER_COLUMNS =
  "sku_id, day_class, run_date, tier, outcome, suppressed_by, reason_code, " +
  "current_par, par_step, base_rate_oz_per_day, velocity_ratio, cushion_pct, " +
  "per_order_unit_oz, peak_floor_oz, detail";

interface DbWalkerLedgerRow {
  sku_id: string;
  day_class: DayClass;
  run_date: string;
  tier: "auto" | "suggestion" | "none";
  outcome: string;
  suppressed_by: string | null;
  reason_code: ParReasonCode;
  current_par: number | string | null;
  par_step: number | string | null;
  base_rate_oz_per_day: number | string | null;
  velocity_ratio: number | string | null;
  cushion_pct: number | string | null;
  per_order_unit_oz: number | string | null;
  peak_floor_oz: number | string | null;
  detail: Record<string, unknown> | null;
}

/** The guard names the ledger may hold. A value outside the union is dropped rather than
 *  cast — an unknown guard must not silently read as "no guard fired". */
const GUARD_NAMES: ReadonlySet<string> = new Set<GuardName>([
  "band", "budget", "hysteresis", "pin", "slot_creation", "below_band_resolution",
]);

export interface WalkInstant {
  walkDateEt: string;
  walkMinutesEt: number;
  dayClass: DayClass;
  /**
   * The level-7 check, resolved from the REQUEST'S ACTOR by the caller (plan D1). It rides
   * in rather than being computed here because this module has no session; `loadWalkerData`
   * knows the actor and the component must never know the role model.
   */
  canAct: boolean;
}

/**
 * The walker's par-suggestion payload. ONE batched round of reads, then a PURE
 * re-selection of the horizon at the walk instant.
 *
 * ── R3-A, IMPLEMENTED ──────────────────────────────────────────────────────────
 * The nightly row carries the DEMAND TERMS (base rate per day-class, velocity ratio,
 * cushion, per-order-unit oz, peak floor) and the horizon IT computed with. This function
 * recomputes ONLY the horizon — a pure selection over cutoff state at the walk instant —
 * and re-runs computeCoverage + applyGuardStack over the persisted terms. So:
 *   · a 9:58 walk and a 10:02 walk render DIFFERENT, both-correct numbers from ONE row;
 *   · the reason string names the delivery this par is being asked to reach;
 *   · nothing is written on a read (the write-on-read law forbids mutations, not selection);
 *   · the read costs a fixed handful of indexed queries, not 21 days of history.
 *
 * `nextDeliveryAfter` is called with the walk's own cutoff state and NEVER reuses
 * `governingCutoffTime`, whose earliest-of-today tiebreak is a display rule (R3-A).
 *
 * ── TWO DEVIATIONS FROM TASK 4.1's LETTER, BOTH FORCED BY THE ARITHMETIC ───────
 * (1) BOTH day-classes are read, not just the walk's. `computeCoverage` sums PER COVERED
 *     DAY, and a Thursday walk's horizon reaches into Friday — so it needs the WEEKEND
 *     rate, which is persisted only on the weekend row. Filtering the read to one
 *     day-class would silently null every horizon that crosses the boundary. Still one
 *     indexed query; the walk's own row supplies every other term.
 * (2) A fifth read (`vendor_items` id + name + vendor) resolves which rhythm governs each
 *     SKU — `par_auto_moves` carries no vendor. `loadWalkerData` already holds those rows
 *     and passes them in, so the walker path pays nothing for it.
 *
 * PRE-`0182`: returns an EMPTY MAP; `loadWalkerData` then behaves exactly as today.
 */
export async function loadParSuggestions(
  sb: ServiceClient,
  locationId: string,
  walkInstant: WalkInstant,
  skuIndex?: ReadonlyMap<string, ParSkuIndexEntry>,
): Promise<Map<string, WalkerParSuggestion>> {
  const out = new Map<string, WalkerParSuggestion>();
  if (!(await parAutoMovesReady(sb))) return out;

  // STALENESS AS A FILTER, not a post-hoc discard: a row older than the window is absent,
  // and bounding the scan on the (location, run_date) index is what keeps this read cheap.
  const staleFrom = addDaysEt(walkInstant.walkDateEt, -SUGGESTION_STALE_DAYS);
  const [ledgerRows, index] = await Promise.all([
    selectAllRows<DbWalkerLedgerRow>(async (from, to) => {
      const { data, error } = await sb.from("par_auto_moves")
        .select(WALKER_LEDGER_COLUMNS)
        .eq("location_id", locationId)
        .gte("run_date", staleFrom)
        .lte("run_date", walkInstant.walkDateEt)
        // Newest first, `id` as the tiebreak ONLY — a total order, so a page boundary
        // cannot reshuffle rows and hand a stale row the first-seen slot (the PR #63
        // lesson, and the `loadLatestOrderQtyBySku` idiom).
        .order("run_date", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to)
        .returns<DbWalkerLedgerRow[]>();
      if (error) throw new Error(`loadParSuggestions ledger: ${error.message}`);
      return { data };
    }),
    skuIndex != null ? Promise.resolve(skuIndex) : loadParSkuIndex(sb),
  ]);
  if (ledgerRows.length === 0) return out;

  // First-seen-per-(sku, day-class) wins — the rows arrive newest-first.
  const latest = new Map<string, DbWalkerLedgerRow>();
  for (const r of ledgerRows) {
    const key = `${r.sku_id}:${r.day_class}`;
    if (!latest.has(key)) latest.set(key, r);
  }

  const vendorIds = [...new Set(
    [...latest.values()]
      .map((r) => index.get(r.sku_id)?.vendorId)
      .filter((v): v is string => v != null),
  )];
  const [rhythmByVendor, skipsByVendor, cutoffsByVendor] = await Promise.all([
    loadRhythmByVendor(sb, vendorIds, locationId),
    loadRhythmSkips(sb, vendorIds, locationId, walkInstant.walkDateEt),
    loadAllCutoffsByVendor(sb, vendorIds),
  ]);

  for (const row of latest.values()) {
    if (row.day_class !== walkInstant.dayClass) continue; // the pair's other half is a term.
    const skuId = row.sku_id;
    const vendorId = index.get(skuId)?.vendorId ?? null;
    if (vendorId == null) continue; // a par'd SKU with no vendor is unorderable anyway.
    const rhythm = rhythmByVendor.get(vendorId) ?? [];
    if (rhythm.length === 0) continue; // no rhythm at walk time → no coverage claim.

    // THE HORIZON, RE-SELECTED AT THE REAL INSTANT. This is the whole of R3-A.
    const window = coverageWindow({
      rhythm,
      cutoffs: cutoffsByVendor.get(vendorId) ?? [],
      skips: skipsByVendor.get(vendorId) ?? [],
      locationId,
      walkDateEt: walkInstant.walkDateEt,
      walkMinutesEt: walkInstant.walkMinutesEt,
    });
    if (window == null) continue;

    // THE OTHER DAY-CLASS'S RATE, FROM THE SAME RUN. A horizon that crosses Thursday into
    // Friday needs both rates, and the weekend rate is persisted only on the weekend row.
    // Pairing on run_date is the point: the engine writes both halves in one pass, so a
    // half from a different night means the ledger is partially written — and blending two
    // runs' terms into one number is a second opinion. Honest null instead.
    const other = latest.get(
      `${skuId}:${walkInstant.dayClass === "weekend" ? "weekday" : "weekend"}`,
    );
    const otherRate = other?.run_date === row.run_date
      ? num(other.base_rate_oz_per_day)
      : null;
    const ownRate = num(row.base_rate_oz_per_day);
    const detail = row.detail ?? {};
    const suppressedBy =
      row.suppressed_by != null && GUARD_NAMES.has(row.suppressed_by)
        ? (row.suppressed_by as GuardName)
        : null;

    const terms: PersistedDemandTerms = {
      currentPar: num(row.current_par),
      parStep: num(row.par_step) ?? 1,
      baseOzPerDay:
        walkInstant.dayClass === "weekend"
          ? { weekday: otherRate, weekend: ownRate }
          : { weekday: ownRate, weekend: otherRate },
      velocityRatio: num(row.velocity_ratio) ?? 1,
      velocityApplied: detail.velocity_applied === true,
      cushionPct: num(row.cushion_pct),
      perOrderUnitOz: num(row.per_order_unit_oz),
      peakFloorOz: num(row.peak_floor_oz),
      priorSuggestedPar: num((detail.prior_suggested_par as number | string | null) ?? null),
      priorDirection: num((detail.prior_direction as number | string | null) ?? null) ?? 0,
      reasonCode: row.reason_code,
      ledgerTier: row.tier,
      suppressedBy,
    };

    const suggestion = resolveWalkerSuggestion({
      locationId,
      skuId,
      dayClass: walkInstant.dayClass,
      terms,
      coveredDays: window.coveredDays,
      coverThroughDate: window.coverThroughDate,
      canAct: walkInstant.canAct,
    });
    if (suggestion != null) out.set(skuId, suggestion);
  }
  return out;
}

/**
 * The APPLIED auto-move on one slot, if the machine really moved that par.
 *
 * A revert exists to undo a real write. Without this read a revert would happily set the
 * PIN — the one column whose job is to stand until a human clears it — on a slot the
 * machine never touched, blocking a future auto-move as punishment for a move that never
 * happened. In v1 this ALWAYS returns null (`PAR_AUTO_APPLY_ENABLED` is false, so no
 * `applied` row can exist), which is exactly why the walker renders the revert affordance
 * DISABLED; the server refuses independently, because a disabled button is not a guard.
 */
export async function loadAppliedAutoMove(
  sb: ServiceClient,
  args: { locationId: string; skuId: string; dayClass: DayClass; generationId: string },
): Promise<{ parBefore: number | null; parAfter: number | null } | null> {
  if (!(await parAutoMovesReady(sb))) return null;
  const { data, error } = await sb.from("par_auto_moves")
    .select("current_par, suggested_par")
    .eq("location_id", args.locationId)
    .eq("sku_id", args.skuId)
    .eq("day_class", args.dayClass)
    .eq("generation_id", args.generationId)
    .eq("outcome", "applied")
    .order("run_date", { ascending: false })
    .limit(1)
    .maybeSingle<{ current_par: number | string | null; suggested_par: number | string | null }>();
  if (error) throw new Error(`loadAppliedAutoMove: ${error.message}`);
  if (data == null) return null;
  return { parBefore: num(data.current_par), parAfter: num(data.suggested_par) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 4.6 — the reason lane: the aggregate line + the errand list
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WHY ~268 OF ~282 PARS ARE QUIET, as a payload. The flagship deliverable.
 *
 * One grouped read of the LATEST run's rows plus the two counters the aggregate line
 * quotes. Pre-`0182`, or before the engine has ever run here, this returns the empty
 * summary — which honestly claims nothing rather than reporting zero silence.
 *
 * The rollup itself is pure and test-pinned (`rollupParSilence`); this function's whole
 * job is the reads and the ordering they arrive in.
 */
export async function loadParSilence(
  sb: ServiceClient,
  locationId: string,
  runDateEt: string,
  skuIndex?: ReadonlyMap<string, ParSkuIndexEntry>,
): Promise<ParSilenceSummary> {
  if (!(await parAutoMovesReady(sb))) return EMPTY_PAR_SILENCE;

  // The latest run AT OR BEFORE the walk date. Asking for `= runDateEt` would report
  // "no silence" on any morning the cron has not landed yet, which is a lie by omission.
  const { data: head, error: hErr } = await sb.from("par_auto_moves")
    .select("run_date, mode")
    .eq("location_id", locationId)
    .lte("run_date", runDateEt)
    .order("run_date", { ascending: false })
    .limit(1)
    .maybeSingle<{ run_date: string; mode: string }>();
  if (hErr) throw new Error(`loadParSilence head: ${hErr.message}`);
  if (head == null) return EMPTY_PAR_SILENCE;
  const runDate = head.run_date;
  // OBSERVED, not asserted: the banner says what the engine DID here, and the ledger's own
  // mode column is the only honest source for that (a build constant is a claim about the
  // deployment, not about this shop's last night).
  const shadowMode = head.mode === "shadow";

  const weekFrom = addDaysEt(runDate, -(AUTO_MOVE_WEEK_DAYS - 1));
  const [rows, weekRows, actions, index] = await Promise.all([
    selectAllRows<{ sku_id: string; day_class: DayClass; reason_code: ParReasonCode; tier: string; generation_id: string | null }>(
      async (from, to) => {
        const { data, error } = await sb.from("par_auto_moves")
          .select("sku_id, day_class, reason_code, tier, generation_id")
          .eq("location_id", locationId)
          .eq("run_date", runDate)
          .order("id", { ascending: true })
          .range(from, to)
          .returns<Array<{ sku_id: string; day_class: DayClass; reason_code: ParReasonCode; tier: string; generation_id: string | null }>>();
        if (error) throw new Error(`loadParSilence rows: ${error.message}`);
        return { data };
      },
    ),
    selectAllRows<{ sku_id: string; day_class: DayClass }>(async (from, to) => {
      const { data, error } = await sb.from("par_auto_moves")
        .select("sku_id, day_class")
        .eq("location_id", locationId)
        .gte("run_date", weekFrom)
        .lte("run_date", runDate)
        .in("outcome", ["applied", "would_apply"])
        .order("id", { ascending: true })
        .range(from, to)
        .returns<Array<{ sku_id: string; day_class: DayClass }>>();
      if (error) throw new Error(`loadParSilence week: ${error.message}`);
      return { data };
    }),
    (async () => {
      if (!(await parSuggestionActionsReady(sb))) return new Set<string>();
      const rowsA = await selectAllRows<{ generation_id: string }>(async (from, to) => {
        const { data, error } = await sb.from("par_suggestion_actions")
          .select("generation_id")
          .eq("location_id", locationId)
          .order("id", { ascending: true })
          .range(from, to)
          .returns<Array<{ generation_id: string }>>();
        if (error) throw new Error(`loadParSilence actions: ${error.message}`);
        return { data };
      });
      return new Set(rowsA.map((r) => r.generation_id));
    })(),
    skuIndex != null ? Promise.resolve(skuIndex) : loadParSkuIndex(sb),
  ]);

  // OFFERED AND UNANSWERED, counted in DISTINCT GENERATIONS (r2-2 + r3): a standing
  // suggestion re-offered fourteen nights is ONE waiting suggestion, not fourteen.
  const waiting = new Set<string>();
  for (const r of rows) {
    if (r.tier !== "suggestion" || r.generation_id == null) continue;
    if (actions.has(r.generation_id)) continue;
    waiting.add(r.generation_id);
  }
  // Auto-moves are counted per SLOT, not per row: seven nightly re-affirmations of one
  // standing move are one move, and in shadow they are all `would_apply`.
  const autoSlots = new Set(weekRows.map((r) => `${r.sku_id}:${r.day_class}`));

  const silenceRows: SilenceLedgerRow[] = rows.map((r) => ({
    skuId: r.sku_id,
    reasonCode: r.reason_code,
    skuName: index.get(r.sku_id)?.name ?? null,
  }));
  return rollupParSilence(silenceRows, {
    suggestionsWaiting: waiting.size,
    autoMovesThisWeek: autoSlots.size,
    runDate,
    shadowMode,
  });
}
