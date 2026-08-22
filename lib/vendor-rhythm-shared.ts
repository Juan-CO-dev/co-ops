/**
 * Vendor delivery rhythm — PURE (client-safe, zero I/O, no server imports; the
 * `*-shared.ts` pattern, AGENTS.md). THE one authority for "when is the next truck,
 * and what must a par survive until the one after that".
 *
 * ── WHY THIS IS NOT `governingCutoffTime` (head ruling R3-A) ────────────────────
 * lib/ordering.ts's `governingCutoffTime` answers a DISPLAY question — "what deadline
 * chip do I put on this vendor's header today?" — and its earliest-of-today tiebreak
 * is right for that and wrong for this. The rhythm needs the cutoff for a SPECIFIC
 * candidate order day, which may not be today. `cutoffForOrderDay` is dow-parameterised
 * and shares only the location-most-specific rule. The two never call each other.
 *
 * ── THE COVERAGE WINDOW ENDS AT THE SECOND-NEXT DELIVERY (plan D3) ─────────────
 * Order-up-to-par is a base-stock policy. At the walk the shelf is raised to `par`; the
 * order placed now arrives at D1; the NEXT chance to replenish is D2. So `par` must cover
 * consumption over [walk, D2) — lead time PLUS the review interval. Covering only
 * [walk, D1) under-orders by the whole inter-delivery gap (~50% on the main path).
 *
 * Two stated modelling assumptions, both pinned by tests:
 *   · the walk happens AFTER the walk day's service (shops walk in the evening), so the
 *     walk date itself is not a covered day;
 *   · a delivery lands in the morning, before service, so the coverage tail stops the day
 *     BEFORE coverThrough.
 * Covered days are therefore exactly { d : walkDate < d < coverThrough }.
 */
import { etDayFromDate } from "@/lib/et-day-shared";

/** One authored order→delivery pair, per (vendor, location). */
export interface RhythmRow {
  vendorId: string;
  locationId: string;
  /** JS getDay convention: 0 = Sunday … 6 = Saturday. */
  orderDow: number;
  /** Calendar days from order to truck. 0 = same-day. */
  leadDays: number;
}

/** A `vendor_cutoffs` row as the rhythm reads it. `locationId` null = both shops. */
export interface CutoffRow {
  locationId: string | null;
  orderDay: number;
  /** Bare "HH:MM[:SS]" ET wall clock. */
  cutoffTime: string;
}

/** An active outage window; inclusive on both ends. */
export interface RhythmSkip {
  vendorId: string;
  /** "YYYY-MM-DD" */
  skipFrom: string;
  /** "YYYY-MM-DD" */
  skipThrough: string;
}

export interface CoverageWindow {
  /** The delivery the order placed at this walk will arrive on. */
  nextDeliveryDate: string;
  /** The delivery AFTER that — what this par must carry the shop to. */
  coverThroughDate: string;
  /** Every ET calendar day strictly between the walk date and coverThroughDate. */
  coveredDays: string[];
  /** The order day the walk is placing against (may be a later day than the walk). */
  orderDateEt: string;
}

/** Add n days to a "YYYY-MM-DD" ET calendar date. Pure grid math — DST-safe. */
export function addDaysEt(dateEt: string, n: number): string {
  const [y, m, d] = dateEt.split("-").map(Number);
  if (!y || !m || !d) return dateEt;
  const t = Date.UTC(y, m - 1, d) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * A reference week, Sunday-first, whose dows are 0..6 by construction (2026-08-23 is a
 * Sunday). It exists so the dow arithmetic below can run through `addDaysEt` rather than
 * inventing a second modulo.
 */
const REFERENCE_WEEK_SUNDAY = "2026-08-23";

/**
 * The delivery dow an authored pair produces — the SAME arithmetic the DB's
 * `vendor_delivery_rhythm.delivery_dow` GENERATED column performs, expressed once here so
 * the authoring UI can preview it live and the loader can hydrate it without either one
 * re-deriving it. Routed through addDaysEt + etDayFromDate so there is exactly one place
 * in this module that knows how a calendar advances.
 */
export function deliveryDowFor(orderDow: number, leadDays: number): number {
  const orderDate = addDaysEt(REFERENCE_WEEK_SUNDAY, orderDow);
  return etDayFromDate(addDaysEt(orderDate, leadDays)).dow;
}

/**
 * The governing cutoff for a SPECIFIC order dow at a location. Location-scoped rows beat
 * all-shops rows; among the survivors the EARLIEST time governs (it is the binding
 * deadline). Returns the bare time string, or null when nothing governs that dow.
 * Pure over the passed rows — deliberately NOT lib/ordering.ts's governingCutoffTime.
 */
export function cutoffForOrderDay(
  rows: ReadonlyArray<CutoffRow>,
  locationId: string,
  dow: number,
): string | null {
  const onDay = rows.filter((r) => r.orderDay === dow);
  if (onDay.length === 0) return null;
  const scoped = onDay.filter((r) => r.locationId === locationId);
  const pool = scoped.length > 0 ? scoped : onDay;
  return [...pool].sort((a, b) => a.cutoffTime.localeCompare(b.cutoffTime))[0]?.cutoffTime ?? null;
}

/** Minutes-of-day for a bare "HH:MM[:SS]". Malformed → null (never fabricate a deadline). */
export function cutoffMinutes(time: string): number | null {
  const parts = time.split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1] ?? "0");
  if (!Number.isInteger(h) || h < 0 || h > 23) return null;
  if (!Number.isFinite(m) || m < 0 || m > 59) return null;
  return h * 60 + Math.floor(m);
}

function isSkipped(dateEt: string, skips: ReadonlyArray<RhythmSkip>): boolean {
  return skips.some((s) => dateEt >= s.skipFrom && dateEt <= s.skipThrough);
}

export interface NextDeliveryInput {
  rhythm: ReadonlyArray<RhythmRow>;
  cutoffs: ReadonlyArray<CutoffRow>;
  skips: ReadonlyArray<RhythmSkip>;
  locationId: string;
  /** The ET calendar date of the walk. */
  walkDateEt: string;
  /** Minutes-of-day of the walk in ET. Compared against the day's cutoff. */
  walkMinutesEt: number;
  /** How far to look before giving up. 21 days covers every sane weekly rhythm. */
  horizonDays?: number;
}

/**
 * The next order opportunity ON OR AFTER the walk instant, and the delivery it produces.
 *
 * A candidate order day qualifies when (a) an active rhythm pair exists for that dow and
 * (b) either the day is in the future, or it is today AND the walk is at or before that
 * dow's cutoff. No cutoff row for a qualifying dow means the deadline is unknown — we treat
 * TODAY as already missed (the conservative read: never promise a truck we cannot prove
 * the shop can still catch) and future days as available.
 *
 * Returns null when no rhythm is authored, or when nothing qualifies inside the horizon —
 * the caller then degrades to honest delta-nudging with NO coverage claim.
 */
export function nextDeliveryAfter(
  input: NextDeliveryInput,
): { orderDateEt: string; deliveryDateEt: string } | null {
  const horizon = input.horizonDays ?? 21;
  if (input.rhythm.length === 0) return null;
  const byDow = new Map<number, RhythmRow>();
  for (const r of input.rhythm) if (!byDow.has(r.orderDow)) byDow.set(r.orderDow, r);

  for (let offset = 0; offset <= horizon; offset += 1) {
    const orderDateEt = addDaysEt(input.walkDateEt, offset);
    const { dow } = etDayFromDate(orderDateEt);
    const pair = byDow.get(dow);
    if (pair == null) continue;
    if (offset === 0) {
      const bare = cutoffForOrderDay(input.cutoffs, input.locationId, dow);
      const mins = bare != null ? cutoffMinutes(bare) : null;
      // Unknown or passed deadline → today's order day is not available.
      if (mins == null || input.walkMinutesEt > mins) continue;
    }
    const deliveryDateEt = addDaysEt(orderDateEt, pair.leadDays);
    if (isSkipped(deliveryDateEt, input.skips)) continue;
    return { orderDateEt, deliveryDateEt };
  }
  return null;
}

/**
 * The full coverage window for a walk: the delivery this order lands on, the delivery AFTER
 * it (what the par must carry the shop to — plan D3), and every ET day in between.
 *
 * Implemented as two chained nextDeliveryAfter calls, so there is exactly one place that
 * knows about cutoffs, skips and leads. The second call is anchored the day AFTER the first
 * delivery with a walk time of 00:00, because by then the shop is unambiguously ordering
 * against a future day (the cutoff question only ever applies to the walk day itself).
 */
export function coverageWindow(input: NextDeliveryInput): CoverageWindow | null {
  const first = nextDeliveryAfter(input);
  if (first == null) return null;
  const second = nextDeliveryAfter({
    ...input,
    walkDateEt: addDaysEt(first.orderDateEt, 1),
    walkMinutesEt: 0,
  });
  // A single-order-day vendor still has a second truck: one week later.
  const coverThroughDate = second?.deliveryDateEt ?? addDaysEt(first.deliveryDateEt, 7);
  const coveredDays: string[] = [];
  for (let d = addDaysEt(input.walkDateEt, 1); d < coverThroughDate; d = addDaysEt(d, 1)) {
    coveredDays.push(d);
  }
  return {
    orderDateEt: first.orderDateEt,
    nextDeliveryDate: first.deliveryDateEt,
    coverThroughDate,
    coveredDays,
  };
}

/**
 * Which walk day a day-class's NIGHTLY suggestion should optimise for.
 *
 * The weekend slot is ONE number governing three walks (Fri/Sat/Sun) whose horizons differ,
 * and the machine gets one move per week — so it optimises the LONGEST gap, which is the
 * Friday walk (r3). Per-walk-day nuance is not lost: the rendered suggestion re-selects the
 * horizon live at walk time (R3-A), so a Sunday walker sees Sunday's answer.
 */
export function optimizationWalkDate(dayClass: "weekday" | "weekend", runDateEt: string): string {
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = addDaysEt(runDateEt, offset);
    const { dow, weekend } = etDayFromDate(candidate);
    if (dayClass === "weekend" && dow === 5) return candidate; // Friday — the longest gap.
    if (dayClass === "weekday" && !weekend) return candidate;
  }
  return runDateEt;
}
