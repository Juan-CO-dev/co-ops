/**
 * Unit spine — lib/vendor-rhythm-shared.ts (Dynamic Pars Phase 1, Task 1.2).
 * PURE: zero I/O, no server imports. The ONE authority for "when is the next
 * truck, and what must a par survive until the one after that".
 *
 * The calendar these fixtures walk (all ET calendar dates, JS getDay convention):
 *   2026-08-24 Mon · 08-25 Tue · 08-26 Wed · 08-27 Thu · 08-28 Fri · 08-29 Sat
 *   08-30 Sun · 08-31 Mon · 09-01 Tue
 *
 * The two rules under test that are easy to get wrong, both pinned here:
 *   · R3-A — the cutoff is evaluated at the instant the walk is handed in, for the
 *     SPECIFIC candidate order day. A 9:58 walk and a 10:02 walk legitimately render
 *     different, both-correct horizons. `governingCutoffTime` is NOT reused.
 *   · plan D3 — the coverage horizon ENDS at the SECOND-next delivery, because
 *     order-up-to-par is a base-stock policy: the target covers lead time PLUS the
 *     review interval. Covered days are exactly { d : walkDate < d < coverThrough }.
 */
import { describe, it, expect } from "vitest";
import {
  addDaysEt,
  cutoffForOrderDay,
  cutoffMinutes,
  deliveryDowFor,
  minutesOfDayEt,
  nextDeliveryAfter,
  coverageWindow,
  optimizationWalkDate,
  type CutoffRow,
  type RhythmRow,
  type RhythmSkip,
} from "../lib/vendor-rhythm-shared";
import { etDayFromDate } from "../lib/et-day-shared";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VENDOR = "vendor-pfg";
const LOC_A = "loc-cap-hill";
const LOC_B = "loc-p-street";

const MON = "2026-08-24";
const TUE = "2026-08-25";
const WED = "2026-08-26";
const THU = "2026-08-27";
const FRI = "2026-08-28";
const SAT = "2026-08-29";
const SUN = "2026-08-30";

/** Minutes-of-day helper for the walk instant. */
const at = (h: number, m: number) => h * 60 + m;

/** PFG's real shape: orders Mon/Wed/Fri, one-day lead, at LOC_A. */
const PFG_RHYTHM: RhythmRow[] = [
  { vendorId: VENDOR, locationId: LOC_A, orderDow: 1, leadDays: 1 },
  { vendorId: VENDOR, locationId: LOC_A, orderDow: 3, leadDays: 1 },
  { vendorId: VENDOR, locationId: LOC_A, orderDow: 5, leadDays: 1 },
];

/** A 10:00 deadline on every one of PFG's order days, scoped to LOC_A. */
const PFG_CUTOFFS: CutoffRow[] = [
  { locationId: LOC_A, orderDay: 1, cutoffTime: "10:00" },
  { locationId: LOC_A, orderDay: 3, cutoffTime: "10:00" },
  { locationId: LOC_A, orderDay: 5, cutoffTime: "10:00" },
];

const NO_SKIPS: RhythmSkip[] = [];

const walk = (walkDateEt: string, walkMinutesEt: number, over?: Partial<{
  rhythm: RhythmRow[];
  cutoffs: CutoffRow[];
  skips: RhythmSkip[];
}>) => ({
  rhythm: over?.rhythm ?? PFG_RHYTHM,
  cutoffs: over?.cutoffs ?? PFG_CUTOFFS,
  skips: over?.skips ?? NO_SKIPS,
  locationId: LOC_A,
  walkDateEt,
  walkMinutesEt,
});

// ── addDaysEt — the pure calendar grid ────────────────────────────────────────

describe("addDaysEt", () => {
  it("walks the ET calendar grid forwards and backwards", () => {
    expect(addDaysEt(MON, 1)).toBe(TUE);
    expect(addDaysEt(MON, 7)).toBe("2026-08-31");
    expect(addDaysEt(MON, 0)).toBe(MON);
    expect(addDaysEt(TUE, -1)).toBe(MON);
  });

  it("crosses a month boundary and a DST-free UTC grid without drifting", () => {
    expect(addDaysEt("2026-08-31", 1)).toBe("2026-09-01");
    // US DST ends 2026-11-01; pure UTC grid math must not lose or gain a day.
    expect(addDaysEt("2026-10-31", 2)).toBe("2026-11-02");
  });

  it("returns the input unchanged when it is not a parseable date", () => {
    expect(addDaysEt("not-a-date", 1)).toBe("not-a-date");
  });
});

// ── deliveryDowFor — the same arithmetic as the DB's GENERATED column ─────────

describe("deliveryDowFor", () => {
  it("matches ((order_dow + lead_days) % 7) for every legal pair", () => {
    for (let dow = 0; dow <= 6; dow += 1) {
      for (let lead = 0; lead <= 14; lead += 1) {
        expect(deliveryDowFor(dow, lead)).toBe((dow + lead) % 7);
      }
    }
  });

  it("reads the way the card renders it: Monday order + 1-day lead arrives Tuesday", () => {
    expect(deliveryDowFor(1, 1)).toBe(2);
    expect(deliveryDowFor(5, 0)).toBe(5); // same-day delivery stays on Friday
    expect(deliveryDowFor(6, 1)).toBe(0); // Saturday order wraps to Sunday
  });
});

// ── cutoffForOrderDay — dow-parameterised, location-most-specific ─────────────

describe("cutoffForOrderDay", () => {
  it("picks a location-scoped row over an all-shops row for the same dow", () => {
    const rows: CutoffRow[] = [
      { locationId: null, orderDay: 1, cutoffTime: "08:00" },
      { locationId: LOC_A, orderDay: 1, cutoffTime: "11:00" },
    ];
    // The all-shops row is EARLIER, and still loses: specificity beats time.
    expect(cutoffForOrderDay(rows, LOC_A, 1)).toBe("11:00");
  });

  it("falls back to the all-shops row when the location has none for that dow", () => {
    const rows: CutoffRow[] = [
      { locationId: null, orderDay: 1, cutoffTime: "08:00" },
      { locationId: LOC_B, orderDay: 1, cutoffTime: "11:00" },
    ];
    expect(cutoffForOrderDay(rows, LOC_A, 1)).toBe("08:00");
  });

  it("takes the EARLIEST time among equally-specific rows (the binding deadline)", () => {
    const rows: CutoffRow[] = [
      { locationId: LOC_A, orderDay: 1, cutoffTime: "14:30" },
      { locationId: LOC_A, orderDay: 1, cutoffTime: "09:15" },
      { locationId: LOC_A, orderDay: 1, cutoffTime: "11:00" },
    ];
    expect(cutoffForOrderDay(rows, LOC_A, 1)).toBe("09:15");
  });

  it("returns null when no row matches THAT dow — not today's dow", () => {
    // Rows exist for Monday only; the question is about Tuesday.
    expect(cutoffForOrderDay(PFG_CUTOFFS, LOC_A, 2)).toBeNull();
    expect(cutoffForOrderDay([], LOC_A, 1)).toBeNull();
  });
});

describe("cutoffMinutes", () => {
  it("parses HH:MM and HH:MM:SS", () => {
    expect(cutoffMinutes("10:00")).toBe(600);
    expect(cutoffMinutes("10:00:00")).toBe(600);
    expect(cutoffMinutes("00:00")).toBe(0);
    expect(cutoffMinutes("23:59")).toBe(1439);
  });

  it("refuses to fabricate a deadline from a malformed time", () => {
    expect(cutoffMinutes("24:00")).toBeNull();
    expect(cutoffMinutes("10:99")).toBeNull();
    expect(cutoffMinutes("banana")).toBeNull();
    expect(cutoffMinutes("-1:00")).toBeNull();
  });
});

// ── nextDeliveryAfter — R3-A, the cutoff evaluated at the walk instant ────────

describe("nextDeliveryAfter", () => {
  it("at 9:58 on Monday with a 10:00 Monday cutoff: Monday's order, Tuesday's truck", () => {
    expect(nextDeliveryAfter(walk(MON, at(9, 58)))).toEqual({
      orderDateEt: MON,
      deliveryDateEt: TUE,
    });
  });

  it("at 10:02 the SAME Monday rolls to the next order day — Wednesday's order, Thursday's truck", () => {
    expect(nextDeliveryAfter(walk(MON, at(10, 2)))).toEqual({
      orderDateEt: WED,
      deliveryDateEt: THU,
    });
  });

  it("exactly AT the cutoff still catches the truck (the deadline is inclusive)", () => {
    expect(nextDeliveryAfter(walk(MON, at(10, 0)))?.orderDateEt).toBe(MON);
  });

  it("a vendor with NO rhythm rows returns null — never a fabricated horizon", () => {
    expect(nextDeliveryAfter(walk(MON, at(9, 0), { rhythm: [] }))).toBeNull();
  });

  it("treats TODAY as already missed when no cutoff is authored for that dow", () => {
    // Conservative read: never promise a truck we cannot prove the shop can catch.
    // Monday's deadline is unknown, so Monday is skipped and Wednesday governs.
    const cutoffs = PFG_CUTOFFS.filter((c) => c.orderDay !== 1);
    expect(nextDeliveryAfter(walk(MON, at(6, 0), { cutoffs }))).toEqual({
      orderDateEt: WED,
      deliveryDateEt: THU,
    });
  });

  it("does NOT require a cutoff for a FUTURE order day", () => {
    // Only Monday has a cutoff; walking Tuesday must still find Wednesday's order.
    const cutoffs: CutoffRow[] = [{ locationId: LOC_A, orderDay: 1, cutoffTime: "10:00" }];
    expect(nextDeliveryAfter(walk(TUE, at(23, 0), { cutoffs }))).toEqual({
      orderDateEt: WED,
      deliveryDateEt: THU,
    });
  });

  it("returns null when nothing qualifies inside the horizon", () => {
    expect(nextDeliveryAfter({ ...walk(MON, at(10, 2)), horizonDays: 1 })).toBeNull();
  });
});

// ── coverageWindow — plan D3: the END is the SECOND-next delivery ─────────────

describe("coverageWindow", () => {
  it("PFG Mon/Wed/Fri +1 lead, walked Monday 9:58: Tue truck, covers to Thu, TWO covered days", () => {
    const w = coverageWindow(walk(MON, at(9, 58)));
    expect(w).not.toBeNull();
    expect(w?.orderDateEt).toBe(MON);
    expect(w?.nextDeliveryDate).toBe(TUE);
    // NOT Tuesday. The order placed Monday IS Tuesday's truck; the next chance to
    // replenish is Thursday's, so the par must survive until then (builder r3 SC1).
    expect(w?.coverThroughDate).toBe(THU);
    expect(w?.coveredDays).toEqual([TUE, WED]);
    expect(w?.coveredDays).toHaveLength(2);
  });

  it("the same walk at 10:02 renders a DIFFERENT, equally correct window", () => {
    const w = coverageWindow(walk(MON, at(10, 2)));
    expect(w?.orderDateEt).toBe(WED);
    expect(w?.nextDeliveryDate).toBe(THU);
    expect(w?.coverThroughDate).toBe(SAT);
    expect(w?.coveredDays).toEqual([TUE, WED, THU, FRI]);
  });

  it("excludes the walk day itself and the arrival day (both stated assumptions)", () => {
    const w = coverageWindow(walk(MON, at(9, 58)));
    expect(w?.coveredDays).not.toContain(MON); // evening walk, after service
    expect(w?.coveredDays).not.toContain(THU); // morning delivery, before service
  });

  it("a window straddling Thursday→Friday carries BOTH day-classes, so the caller sums per class", () => {
    const w = coverageWindow(walk(MON, at(10, 2)));
    const classes = new Set((w?.coveredDays ?? []).map((d) => (etDayFromDate(d).weekend ? "weekend" : "weekday")));
    expect(classes).toEqual(new Set(["weekday", "weekend"]));
    // Thu is the weekday side, Fri the weekend side of the same list.
    expect(etDayFromDate(THU).weekend).toBe(false);
    expect(etDayFromDate(FRI).weekend).toBe(true);
  });

  it("an active skip over Tuesday pushes the delivery out and LENGTHENS the covered days", () => {
    const skips: RhythmSkip[] = [{ vendorId: VENDOR, skipFrom: TUE, skipThrough: TUE }];
    const w = coverageWindow(walk(MON, at(9, 58), { skips }));
    // Monday's order would have landed Tuesday; that truck is cancelled.
    expect(w?.nextDeliveryDate).toBe(THU);
    expect(w?.coverThroughDate).toBe(SAT);
    expect(w?.coveredDays).toEqual([TUE, WED, THU, FRI]);
    // Four, where the un-skipped walk had two — the outage is absorbed as coverage,
    // never as par disagreement.
    expect(w?.coveredDays.length).toBeGreaterThan(2);
  });

  it("a single-order-day vendor covers through nextDelivery + 7", () => {
    const rhythm: RhythmRow[] = [{ vendorId: VENDOR, locationId: LOC_A, orderDow: 1, leadDays: 1 }];
    const cutoffs: CutoffRow[] = [{ locationId: LOC_A, orderDay: 1, cutoffTime: "10:00" }];
    const w = coverageWindow(walk(MON, at(9, 58), { rhythm, cutoffs }));
    expect(w?.nextDeliveryDate).toBe(TUE);
    expect(w?.coverThroughDate).toBe(addDaysEt(TUE, 7));
    expect(w?.coveredDays).toHaveLength(7);
  });

  it("a NEXT-DAY vendor anchors D2 on the next ORDER day, not the day after the truck", () => {
    // Boar's Head / Trimark / Cardinal / Leonard Paper all order Mon–Fri (or daily) at lead
    // 1 — the majority of CO's authored rhythm. Walked Monday: the order goes in Monday and
    // lands Tuesday, and the next chance to REPLENISH is Tuesday's order, landing Wednesday.
    // The review interval of a base-stock policy is the gap between ORDER opportunities.
    const rhythm: RhythmRow[] = [1, 2, 3, 4, 5].map((d) => ({
      vendorId: VENDOR, locationId: LOC_A, orderDow: d, leadDays: 1,
    }));
    const cutoffs: CutoffRow[] = [1, 2, 3, 4, 5].map((d) => ({
      locationId: LOC_A, orderDay: d, cutoffTime: "10:00",
    }));
    const w = coverageWindow(walk(MON, at(9, 58), { rhythm, cutoffs }));
    expect(w?.orderDateEt).toBe(MON);
    expect(w?.nextDeliveryDate).toBe(TUE);
    expect(w?.coverThroughDate).toBe(WED);
    expect(w?.coveredDays).toEqual([TUE]);
    // Anchoring the second search at the first DELIVERY + 1 (Wednesday) would skip Tuesday's
    // order day entirely and return Thursday — a full extra day of demand in every one of
    // these pars. That answer must not appear.
    expect(w?.coverThroughDate).not.toBe(THU);
    expect(w?.coveredDays).not.toContain(WED);
  });

  it("returns null when there is no rhythm at all", () => {
    expect(coverageWindow(walk(MON, at(9, 58), { rhythm: [] }))).toBeNull();
  });
});

// ── MIXED LEAD TIMES — Juan's ruling, 2026-08-31 ──────────────────────────────
//
// *"we def need to build for mixed lead times… no cut corners."*
//
// This block replaces a test that PINNED the crossing case as a stated limitation. The
// limitation was real: with unequal leads on one vendor the orders cross in transit, and
// the old order-space selection returned `coverThroughDate` EARLIER than
// `nextDeliveryDate`, understating the covered set. The selection is now made in ARRIVAL
// order, so the inversion is structurally impossible and the covered set is the honest one.
//
//   · nextDeliveryDate  = the earliest ARRIVAL among the orders this walk can still catch
//   · coverThroughDate  = the earliest arrival STRICTLY AFTER it, whenever it was ordered
//   · coveredDays       = { d : walkDate < d < coverThrough }, unchanged by the ruling
//   · orderDateEt       = still ORDER space — the deadline the walk works to, not a truck

/** The crossing shape: Monday orders arrive Thursday, Tuesday's arrive Wednesday. */
const CROSSING_RHYTHM: RhythmRow[] = [
  { vendorId: VENDOR, locationId: LOC_A, orderDow: 1, leadDays: 3 },
  { vendorId: VENDOR, locationId: LOC_A, orderDow: 2, leadDays: 1 },
];
const CROSSING_CUTOFFS: CutoffRow[] = [
  { locationId: LOC_A, orderDay: 1, cutoffTime: "10:00" },
  { locationId: LOC_A, orderDay: 2, cutoffTime: "10:00" },
];

describe("coverageWindow — mixed (crossing) lead times", () => {
  it("selects BOTH bounds in arrival order when a later order overtakes an earlier one", () => {
    // Monday's order (lead 3) lands Thursday; Tuesday's (lead 1) lands Wednesday and
    // OVERTAKES it. The shelf is replenished Wednesday, then Thursday — so the par has to
    // survive Tuesday AND Wednesday, not Tuesday alone as the order-space answer said.
    const w = coverageWindow(walk(MON, at(9, 58), { rhythm: CROSSING_RHYTHM, cutoffs: CROSSING_CUTOFFS }));
    expect(w).not.toBeNull();
    expect(w?.nextDeliveryDate).toBe(WED); // Tuesday's truck, though ordered LATER
    expect(w?.coverThroughDate).toBe(THU); // Monday's own truck, the second arrival
    expect(w?.coveredDays).toEqual([TUE, WED]);
    // The old answer, named so a regression is unmistakable: THU/WED inverted, [TUE] only.
    expect(w?.coveredDays).not.toEqual([TUE]);
  });

  it("keeps orderDateEt in ORDER space — the deadline the walk is working to", () => {
    // The walk is Monday and Monday's order is catchable, so that is what the manager is
    // placing, even though the truck they will see first is Tuesday's order's.
    const w = coverageWindow(walk(MON, at(9, 58), { rhythm: CROSSING_RHYTHM, cutoffs: CROSSING_CUTOFFS }));
    expect(w?.orderDateEt).toBe(MON);
    // And nextDeliveryAfter — the ORDER-space question — is untouched by the ruling.
    expect(nextDeliveryAfter(walk(MON, at(9, 58), { rhythm: CROSSING_RHYTHM, cutoffs: CROSSING_CUTOFFS })))
      .toEqual({ orderDateEt: MON, deliveryDateEt: THU });
  });

  it("the inversion is now structurally impossible: coverThrough is ALWAYS strictly later", () => {
    // Every lead pairing 0..4 on Mon/Tue, at both cutoff boundaries. The old selection
    // produced coverThrough < nextDelivery for the whole crossing half of this grid.
    for (let monLead = 0; monLead <= 4; monLead += 1) {
      for (let tueLead = 0; tueLead <= 4; tueLead += 1) {
        for (const mins of [at(9, 58), at(10, 2)]) {
          const rhythm: RhythmRow[] = [
            { vendorId: VENDOR, locationId: LOC_A, orderDow: 1, leadDays: monLead },
            { vendorId: VENDOR, locationId: LOC_A, orderDow: 2, leadDays: tueLead },
          ];
          const w = coverageWindow(walk(MON, mins, { rhythm, cutoffs: CROSSING_CUTOFFS }));
          expect(w, `leads ${monLead}/${tueLead} @ ${mins}`).not.toBeNull();
          expect(w!.coverThroughDate > w!.nextDeliveryDate, `leads ${monLead}/${tueLead} @ ${mins}`).toBe(true);
        }
      }
    }
  });

  it("PRE-cutoff and POST-cutoff walks on the crossing rhythm render different, both-correct windows", () => {
    // 9:58 — Monday is catchable, so both Monday's Thursday truck and Tuesday's Wednesday
    // truck are in play.
    const pre = coverageWindow(walk(MON, at(9, 58), { rhythm: CROSSING_RHYTHM, cutoffs: CROSSING_CUTOFFS }));
    expect(pre?.orderDateEt).toBe(MON);
    expect(pre?.nextDeliveryDate).toBe(WED);
    expect(pre?.coverThroughDate).toBe(THU);

    // 10:02 — Monday's deadline is gone. The only catchable orders are Tuesday's (Wed
    // truck) and next week's, so the shelf's next two arrivals are Wed and the FOLLOWING
    // Wednesday: next Monday's order (lead 3) lands Thursday 09-03, AFTER it.
    const post = coverageWindow(walk(MON, at(10, 2), { rhythm: CROSSING_RHYTHM, cutoffs: CROSSING_CUTOFFS }));
    expect(post?.orderDateEt).toBe(TUE);
    expect(post?.nextDeliveryDate).toBe(WED);
    expect(post?.coverThroughDate).toBe("2026-09-02");
    expect(post?.coveredDays).toHaveLength(8); // TUE 08-25 … 09-01
  });

  it("exactly AT the cutoff the crossing walk still catches Monday (the deadline is inclusive)", () => {
    const w = coverageWindow(walk(MON, at(10, 0), { rhythm: CROSSING_RHYTHM, cutoffs: CROSSING_CUTOFFS }));
    expect(w?.orderDateEt).toBe(MON);
    expect(w?.coverThroughDate).toBe(THU);
  });

  it("a skip that cancels the OVERTAKING truck hands the horizon back to the slower order", () => {
    // Tuesday's Wednesday truck is cancelled. What is left is Monday's Thursday truck and
    // next Tuesday's Wednesday truck (09-02) — Monday-next's lands 09-03, after it.
    const skips: RhythmSkip[] = [{ vendorId: VENDOR, skipFrom: WED, skipThrough: WED }];
    const w = coverageWindow(walk(MON, at(9, 58), { rhythm: CROSSING_RHYTHM, cutoffs: CROSSING_CUTOFFS, skips }));
    expect(w?.nextDeliveryDate).toBe(THU);
    expect(w?.coverThroughDate).toBe("2026-09-02");
    expect(w?.coveredDays).toEqual([TUE, WED, THU, FRI, SAT, SUN, "2026-08-31", "2026-09-01"]);
  });

  it("a skip that cancels the SLOWER truck leaves the overtaking one as the first arrival", () => {
    // Monday's Thursday truck is cancelled; Wednesday's (from Tuesday's order) stands, and
    // the next arrival is the following Wednesday 09-02 — next Monday's lands 09-03.
    const skips: RhythmSkip[] = [{ vendorId: VENDOR, skipFrom: THU, skipThrough: THU }];
    const w = coverageWindow(walk(MON, at(9, 58), { rhythm: CROSSING_RHYTHM, cutoffs: CROSSING_CUTOFFS, skips }));
    expect(w?.nextDeliveryDate).toBe(WED);
    expect(w?.coverThroughDate).toBe("2026-09-02");
    // orderDateEt stays Monday: the ORDER is still catchable, it is the TRUCK that is gone.
    // (upcomingDeliveries drops the pair, so the first catchable order becomes Tuesday.)
    expect(w?.orderDateEt).toBe(TUE);
  });

  it("two trucks landing the SAME day are ONE replenishment instant, not two", () => {
    // Mon lead 2 and Tue lead 1 both land Wednesday. A shelf restocked twice on Wednesday
    // is still a shelf that must survive until the NEXT day a truck comes.
    const rhythm: RhythmRow[] = [
      { vendorId: VENDOR, locationId: LOC_A, orderDow: 1, leadDays: 2 },
      { vendorId: VENDOR, locationId: LOC_A, orderDow: 2, leadDays: 1 },
    ];
    const w = coverageWindow(walk(MON, at(9, 58), { rhythm, cutoffs: CROSSING_CUTOFFS }));
    expect(w?.nextDeliveryDate).toBe(WED);
    // NOT Wednesday again — the next DISTINCT arrival is next Wednesday (09-02), because
    // next Monday's lead-2 order also lands 09-02 and ties resolve to the earlier order.
    expect(w?.coverThroughDate).toBe("2026-09-02");
    expect(w?.coverThroughDate).not.toBe(WED);
  });

  it("a three-way crossing orders the horizon by arrival, not by order day", () => {
    // Mon lead 4 (Fri), Tue lead 3 (Fri), Wed lead 1 (Thu). Arrivals: Thu, Fri, Fri.
    const rhythm: RhythmRow[] = [
      { vendorId: VENDOR, locationId: LOC_A, orderDow: 1, leadDays: 4 },
      { vendorId: VENDOR, locationId: LOC_A, orderDow: 2, leadDays: 3 },
      { vendorId: VENDOR, locationId: LOC_A, orderDow: 3, leadDays: 1 },
    ];
    const cutoffs: CutoffRow[] = [1, 2, 3].map((d) => ({ locationId: LOC_A, orderDay: d, cutoffTime: "10:00" }));
    const w = coverageWindow(walk(MON, at(9, 58), { rhythm, cutoffs }));
    expect(w?.orderDateEt).toBe(MON);
    expect(w?.nextDeliveryDate).toBe(THU); // Wednesday's order, the LAST one placed
    expect(w?.coverThroughDate).toBe(FRI);
    expect(w?.coveredDays).toEqual([TUE, WED, THU]);
  });
});

// ── The UNIFORM-LEAD regression: CO's real data must not move one day ─────────
//
// Every rhythm pair live in prod is lead 1 (50 pairs, 5 vendors — verified 2026-08-29 and
// re-verified 2026-08-31), and every one of them has an authored cutoff on its order day.
// So the arrival-order rewrite must be a NO-OP for every real vendor. Rather than assert
// that by inspection, this block re-implements the OLD order-space selection — two chained
// `nextDeliveryAfter` calls, which is untouched by the ruling — and asserts the two agree
// across a fixture matrix. Arrival = order + a constant when the leads are equal, so the
// two orderings are the same ordering; this is the executable statement of that.

/** The pre-ruling selection, verbatim: D2 searched from the first ORDER day + 1 at 00:00. */
function legacyCoverageWindow(input: Parameters<typeof coverageWindow>[0]) {
  const first = nextDeliveryAfter(input);
  if (first == null) return null;
  const second = nextDeliveryAfter({
    ...input,
    walkDateEt: addDaysEt(first.orderDateEt, 1),
    walkMinutesEt: 0,
  });
  const coverThroughDate = second?.deliveryDateEt ?? addDaysEt(first.deliveryDateEt, 7);
  const coveredDays: string[] = [];
  for (let d = addDaysEt(input.walkDateEt, 1); d < coverThroughDate; d = addDaysEt(d, 1)) {
    coveredDays.push(d);
  }
  return { orderDateEt: first.orderDateEt, nextDeliveryDate: first.deliveryDateEt, coverThroughDate, coveredDays };
}

describe("coverageWindow — uniform-lead parity with the pre-ruling selection", () => {
  it("agrees BYTE-FOR-BYTE on every uniform-lead rhythm, walk day and cutoff boundary", () => {
    const WEEK = [MON, TUE, WED, THU, FRI, SAT, SUN];
    let compared = 0;
    // All 127 non-empty order-day subsets × leads 0..3 × 7 walk days × both sides of the
    // deadline. Every order dow carries a cutoff, which is CO's live shape.
    for (let mask = 1; mask < 128; mask += 1) {
      const dows = [0, 1, 2, 3, 4, 5, 6].filter((d) => (mask & (1 << d)) !== 0);
      const cutoffs: CutoffRow[] = dows.map((d) => ({ locationId: LOC_A, orderDay: d, cutoffTime: "10:00" }));
      for (const lead of [0, 1, 2, 3]) {
        const rhythm: RhythmRow[] = dows.map((d) => ({
          vendorId: VENDOR, locationId: LOC_A, orderDow: d, leadDays: lead,
        }));
        for (const day of WEEK) {
          for (const mins of [at(9, 58), at(10, 2)]) {
            const args = walk(day, mins, { rhythm, cutoffs });
            expect(coverageWindow(args), `mask=${mask} lead=${lead} day=${day} mins=${mins}`)
              .toEqual(legacyCoverageWindow(args));
            compared += 1;
          }
        }
      }
    }
    expect(compared).toBe(127 * 4 * 7 * 2);
  });

  it("agrees on uniform-lead rhythms under an active skip window too", () => {
    const skipCases: RhythmSkip[][] = [
      [{ vendorId: VENDOR, skipFrom: TUE, skipThrough: TUE }],
      [{ vendorId: VENDOR, skipFrom: TUE, skipThrough: THU }],
      [{ vendorId: VENDOR, skipFrom: WED, skipThrough: SUN }],
    ];
    for (const skips of skipCases) {
      for (const lead of [0, 1, 2]) {
        const rhythm: RhythmRow[] = [1, 3, 5].map((d) => ({
          vendorId: VENDOR, locationId: LOC_A, orderDow: d, leadDays: lead,
        }));
        for (const day of [MON, TUE, WED, THU, FRI]) {
          const args = walk(day, at(9, 58), { rhythm, cutoffs: PFG_CUTOFFS, skips });
          expect(coverageWindow(args), `lead=${lead} day=${day}`).toEqual(legacyCoverageWindow(args));
        }
      }
    }
  });

  it("DIVERGENCE, deliberate and unreachable at CO: an order day with no authored cutoff", () => {
    // The old selection re-entered `nextDeliveryAfter` with walkDate = firstOrder + 1, which
    // put that day at offset 0 — where a MISSING cutoff row reads as "today, already missed"
    // and the day is skipped. That contradicted the module's own stated law ("future days
    // are available" regardless of cutoff) and was an artifact of the chained call, not a
    // decision. The single enumeration has no offset-0 for a future day, so the law now
    // holds uniformly. Unreachable in prod: all 50 live pairs carry a cutoff on their own
    // order day (probed 2026-08-31), so no real vendor sees this difference.
    const rhythm: RhythmRow[] = [
      { vendorId: VENDOR, locationId: LOC_A, orderDow: 1, leadDays: 1 },
      { vendorId: VENDOR, locationId: LOC_A, orderDow: 2, leadDays: 1 },
    ];
    const cutoffs: CutoffRow[] = [{ locationId: LOC_A, orderDay: 1, cutoffTime: "10:00" }]; // no Tuesday row
    const args = walk(MON, at(9, 58), { rhythm, cutoffs });
    // Correct: Tuesday's order is a FUTURE day, so it is available and its truck is D2.
    expect(coverageWindow(args)?.coverThroughDate).toBe(WED);
    // What the chained call used to answer — Tuesday dropped, so D2 slid a whole week.
    expect(legacyCoverageWindow(args)?.coverThroughDate).toBe("2026-09-01");
  });
});

// ── optimizationWalkDate — the weekend slot optimises the FRIDAY walk ─────────

describe("optimizationWalkDate", () => {
  it("weekend resolves to the Friday of the coming weekend block (the longest gap)", () => {
    expect(optimizationWalkDate("weekend", MON)).toBe(FRI);
    expect(optimizationWalkDate("weekend", FRI)).toBe(FRI); // already Friday
    // Saturday and Sunday are inside the block; the NEXT Friday is the optimisation point.
    expect(optimizationWalkDate("weekend", SAT)).toBe("2026-09-04");
    expect(optimizationWalkDate("weekend", SUN)).toBe("2026-09-04");
  });

  it("weekday resolves to the next Mon–Thu day", () => {
    expect(optimizationWalkDate("weekday", MON)).toBe(MON);
    expect(optimizationWalkDate("weekday", THU)).toBe(THU);
    // Fri/Sat/Sun are all weekend-par days — the next weekday is Monday.
    expect(optimizationWalkDate("weekday", FRI)).toBe("2026-08-31");
    expect(optimizationWalkDate("weekday", SAT)).toBe("2026-08-31");
    expect(optimizationWalkDate("weekday", SUN)).toBe("2026-08-31");
  });
});

// ── minutesOfDayEt — the WALK side of the cutoff comparison (Task 4.2) ────────
//
// The cutoff side is `cutoffMinutes`; these two are compared against each other on
// every walk, so they live and are tested together. Every instant below is an ABSOLUTE
// UTC timestamp, so the assertions are independent of the machine's own zone.

describe("minutesOfDayEt", () => {
  it("reads the operational zone, not the host's — EDT (UTC-4) in August", () => {
    // 13:58Z on 2026-08-25 is 09:58 ET.
    expect(minutesOfDayEt(new Date("2026-08-25T13:58:00Z"))).toBe(9 * 60 + 58);
    expect(minutesOfDayEt(new Date("2026-08-25T14:02:00Z"))).toBe(10 * 60 + 2);
  });

  it("straddles the 10:00 cutoff exactly where nextDeliveryAfter does", () => {
    const bare = "10:00";
    expect(minutesOfDayEt(new Date("2026-08-25T13:58:00Z"))).toBeLessThan(cutoffMinutes(bare)!);
    expect(minutesOfDayEt(new Date("2026-08-25T14:00:00Z"))).toBe(cutoffMinutes(bare));
    expect(minutesOfDayEt(new Date("2026-08-25T14:02:00Z"))).toBeGreaterThan(cutoffMinutes(bare)!);
  });

  it("is DST-correct — EST (UTC-5) in January", () => {
    expect(minutesOfDayEt(new Date("2026-01-15T15:00:00Z"))).toBe(10 * 60);
  });

  it("handles midnight and the last minute of the ET day without wrapping", () => {
    expect(minutesOfDayEt(new Date("2026-08-25T04:00:00Z"))).toBe(0);
    expect(minutesOfDayEt(new Date("2026-08-26T03:59:00Z"))).toBe(23 * 60 + 59);
  });
});
