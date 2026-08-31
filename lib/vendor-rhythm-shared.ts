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
 *
 * ── THE HORIZON IS SELECTED IN ARRIVAL ORDER (Juan's ruling, 2026-08-31) ───────
 * *"we def need to build for mixed lead times… no cut corners."* The shelf is a physical
 * thing: it is replenished when a TRUCK LANDS, not when an order is phoned in. So the two
 * delivery instants that bound the horizon are chosen by ARRIVAL date over the set of
 * order opportunities this walk can still catch — never by order date. With equal leads
 * everywhere the two orders coincide (arrival is order + a constant, so the orderings are
 * identical), which is why CO's real rhythm — 50 live pairs, every one lead 1, live-verified
 * 2026-08-29 — does not move by a single day. With UNEQUAL leads on one vendor they do NOT
 * coincide: a Monday order at lead 3 lands Thursday while Tuesday's order at lead 1 lands
 * Wednesday, so the orders CROSS in transit. Selecting in order-date space then produced a
 * `coverThroughDate` EARLIER than `nextDeliveryDate` and a covered-day set that understated
 * the shelf. Arrival-order selection makes that inversion structurally impossible:
 * `coverThroughDate` is the earliest arrival STRICTLY AFTER `nextDeliveryDate`, so it is
 * always the later of the two.
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
  /**
   * The next truck to LAND — the earliest arrival among the order opportunities this walk
   * can still catch. Under equal leads that is the arrival of `orderDateEt`'s own order;
   * under CROSSING leads it may be a later order's truck that overtakes it, which is the
   * whole point of selecting in arrival order.
   */
  nextDeliveryDate: string;
  /** The truck AFTER that — strictly later, always — and what this par must carry the shop to. */
  coverThroughDate: string;
  /** Every ET calendar day strictly between the walk date and coverThroughDate. */
  coveredDays: string[];
  /**
   * The order day the walk is placing against (may be a later day than the walk) — ORDER
   * space, and deliberately not re-homed by the arrival-order selection above: this is the
   * deadline the walker is working to, not a truck. With crossing leads it can be the order
   * of a LATER arrival than `nextDeliveryDate`.
   */
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

/**
 * Minutes-of-day of an INSTANT in ET — the walk-time half of the cutoff comparison.
 *
 * It lives beside `cutoffMinutes` (its inverse-shaped twin) deliberately: one of them
 * reads a stored deadline and the other reads the clock, they are compared against each
 * other on every walk, and split across two modules they would drift. `en-GB` + hour12
 * false gives a stable zero-padded "HH:MM:SS" in the operational zone, which is exactly
 * the shape `cutoffMinutes` already parses — so there is still ONE parser.
 */
export function minutesOfDayEt(instant: Date): number {
  const hhmmss = instant.toLocaleTimeString("en-GB", {
    timeZone: "America/New_York", hour12: false,
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  return cutoffMinutes(hhmmss) ?? 0;
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

/** One catchable order opportunity and the truck it produces. */
export interface DeliveryOpportunity {
  orderDateEt: string;
  deliveryDateEt: string;
}

/**
 * EVERY order opportunity this walk can still catch inside the horizon, with the delivery
 * each one produces, in ORDER-DATE order. The ONE place that knows about cutoffs, skips and
 * leads; `nextDeliveryAfter` and `coverageWindow` are two different SELECTIONS over it.
 *
 * A candidate order day qualifies when (a) an active rhythm pair exists for that dow and
 * (b) either the day is in the future, or it is today AND the walk is at or before that
 * dow's cutoff. No cutoff row for a qualifying dow means the deadline is unknown — we treat
 * TODAY as already missed (the conservative read: never promise a truck we cannot prove
 * the shop can still catch) and future days as available.
 *
 * A pair whose truck falls inside an active skip window is DROPPED, not deferred: the
 * outage cancels that delivery, and the coverage the shop loses is absorbed by the later
 * arrivals this list still contains.
 */
export function upcomingDeliveries(input: NextDeliveryInput): DeliveryOpportunity[] {
  const out: DeliveryOpportunity[] = [];
  const horizon = input.horizonDays ?? 21;
  if (input.rhythm.length === 0) return out;
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
    out.push({ orderDateEt, deliveryDateEt });
  }
  return out;
}

/**
 * The next order opportunity ON OR AFTER the walk instant, and the delivery it produces.
 * ORDER space by definition — this is the deadline question ("what am I ordering against
 * right now?"), and it is deliberately NOT the arrival question `coverageWindow` asks.
 *
 * Returns null when no rhythm is authored, or when nothing qualifies inside the horizon —
 * the caller then degrades to honest delta-nudging with NO coverage claim.
 */
export function nextDeliveryAfter(input: NextDeliveryInput): DeliveryOpportunity | null {
  return upcomingDeliveries(input)[0] ?? null;
}

/**
 * The full coverage window for a walk: the next truck to land, the truck AFTER it (what the
 * par must carry the shop to — plan D3), and every ET day in between.
 *
 * ── THE SELECTION IS IN ARRIVAL ORDER (Juan's ruling, 2026-08-31) ─────────────────
 * *"we def need to build for mixed lead times… no cut corners."* `upcomingDeliveries` is
 * enumerated in ORDER-date order; this function re-sorts it by ARRIVAL and takes:
 *   · `nextDeliveryDate` — the earliest arrival;
 *   · `coverThroughDate` — the earliest arrival STRICTLY AFTER it, whenever its own order
 *     was placed. Strictly-after is doing two jobs: it makes the inversion impossible, and
 *     it collapses two trucks landing the SAME day into one replenishment instant, which is
 *     what a shelf actually experiences.
 *
 * ── THIS IS STILL "THE NEXT CHANCE TO REPLENISH", NOT "THE DAY AFTER THE TRUCK" ───
 * The next-day vendors — Boar's Head, Trimark, Cardinal, Leonard Paper all order Mon–Fri (or
 * daily) at lead 1, the bulk of CO's authored rhythm — are exactly why the old
 * implementation searched from the first ORDER day + 1 rather than the first DELIVERY + 1:
 * a Monday walk's D1 is Tuesday and its true D2 is Wednesday (Tuesday's order), and
 * anchoring on the truck would have skipped Tuesday's order day and returned Thursday,
 * padding every one of those pars by a full extra day of demand. Arrival-order selection
 * keeps that answer, because Tuesday's order is the second ARRIVAL too. What it fixes is
 * the case the old anchor got wrong.
 *
 * ── WHAT CHANGED, AND WHY NOTHING AT CO MOVES ────────────────────────────────────
 * When every lead on a vendor is equal, arrival = order + a constant, so arrival order and
 * order order are the SAME order and this function returns byte-identical windows to the
 * chained-`nextDeliveryAfter` implementation it replaces — pinned by a differential
 * regression over the uniform-lead fixture matrix in tests/vendor-rhythm-shared.test.ts.
 * CO's live rhythm is 50 pairs, every one lead 1 (verified against prod 2026-08-29 and
 * again 2026-08-31), so the walker does not move by a single day for any real vendor.
 *
 * With UNEQUAL leads the orders CROSS in transit — Mon at lead 3 lands Thursday while
 * Tuesday's lead-1 order lands Wednesday — and order-space selection then returned
 * `coverThroughDate` (Wed) EARLIER than `nextDeliveryDate` (Thu), understating the covered
 * set to a single day when the shelf really has to survive two. It is now Wed → Thu, in
 * that order, covering Tue and Wed. The schema has always permitted this (`lead_days` is
 * 0..14, authored per order day on the vendor page); it is now MODELLED rather than stated.
 */
export function coverageWindow(input: NextDeliveryInput): CoverageWindow | null {
  const pairs = upcomingDeliveries(input);
  const firstCatchable = pairs[0];
  if (firstCatchable == null) return null;

  // Ties (two trucks the same day) resolve to the EARLIER order — the one this walk can
  // actually place — so the tiebreak never invents a deadline later than the real one.
  const byArrival = [...pairs].sort(
    (a, b) =>
      a.deliveryDateEt.localeCompare(b.deliveryDateEt) ||
      a.orderDateEt.localeCompare(b.orderDateEt),
  );
  const nextDeliveryDate = byArrival[0]!.deliveryDateEt;
  const second = byArrival.find((p) => p.deliveryDateEt > nextDeliveryDate);
  // A single-order-day vendor still has a second truck: one week later.
  const coverThroughDate = second?.deliveryDateEt ?? addDaysEt(nextDeliveryDate, 7);

  const coveredDays: string[] = [];
  for (let d = addDaysEt(input.walkDateEt, 1); d < coverThroughDate; d = addDaysEt(d, 1)) {
    coveredDays.push(d);
  }
  return {
    // ORDER space — the deadline the walk is working to, not a truck. See CoverageWindow.
    orderDateEt: firstCatchable.orderDateEt,
    nextDeliveryDate,
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
