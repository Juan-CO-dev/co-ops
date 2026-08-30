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

  it("CROSSING LEAD TIMES: D2 can land before D1, and that is the stated limitation", () => {
    // Monday orders at lead 3 (Thursday truck) while Tuesday orders at lead 1 (Wednesday
    // truck). The next chance to order is still Tuesday, so `coverThroughDate` comes out
    // EARLIER than `nextDeliveryDate` and the covered set is the short one. Correct in
    // inventory POSITION, under-stated on the physical shelf, which waits for Thursday.
    // No such rhythm has been authored here (scripts/seed/29-vendor-rhythm.ts writes lead 1
    // on every pair) and the schema permits it, so it is pinned rather than guarded — the
    // first unequal-lead pair an admin authors is the trigger to design for it.
    const rhythm: RhythmRow[] = [
      { vendorId: VENDOR, locationId: LOC_A, orderDow: 1, leadDays: 3 },
      { vendorId: VENDOR, locationId: LOC_A, orderDow: 2, leadDays: 1 },
    ];
    const cutoffs: CutoffRow[] = [
      { locationId: LOC_A, orderDay: 1, cutoffTime: "10:00" },
      { locationId: LOC_A, orderDay: 2, cutoffTime: "10:00" },
    ];
    const w = coverageWindow(walk(MON, at(9, 58), { rhythm, cutoffs }));
    expect(w).not.toBeNull();
    expect(w?.orderDateEt).toBe(MON);
    expect(w?.nextDeliveryDate).toBe(THU);
    expect(w?.coverThroughDate).toBe(WED);
    // The inversion itself, stated as an assertion: D2's truck lands BEFORE D1's.
    expect(w!.coverThroughDate < w!.nextDeliveryDate).toBe(true);
    expect(w?.coveredDays).toEqual([TUE]);
  });

  it("returns null when there is no rhythm at all", () => {
    expect(coverageWindow(walk(MON, at(9, 58), { rhythm: [] }))).toBeNull();
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
