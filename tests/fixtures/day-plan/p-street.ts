/**
 * P Street, spec 3.4 as the amended engine reads it (plan r4, 11.1): the normal day and the heavy day, every event as a
 * timeline. `pStreet(min, opts)` returns the facts as they stand at that minute (events after it are not yet true), so a
 * test sweeps the clock by calling it. Illustrative values (the live ones are in p-street-late-close.ts).
 */
import { planDay, type CateringOrder, type DayPlan, type DayStation, type DayViewer, type ShopFacts } from "@/lib/day-plan-shared";
import type { PoFact, VendorCutoff, VendorFact } from "@/lib/report-digests-v2-shared";
import type { RhythmRow } from "@/lib/vendor-rhythm-shared";
import { assignment, checklist, forViewer, hm, iso, ok, order, PLAN_DATE, report, station } from "./build";

export const P_SHOP = { id: "shop-p", code: "P" } as const;

export const STATION_IDS = {
  crunchy: "st-crunchy", third: "st-third", walk: "st-walk", expo: "st-expo",
  prepFridge: "st-prep-fridge", backLine: "st-back-line", frontHouse: "st-front-house", prepArea: "st-prep-area",
  closingManager: "st-closing-manager", walkOut: "st-walk-out",
} as const;
type StationKey = keyof typeof STATION_IDS;

/** Who holds which station (myStation as PR 6 fills it). Ana holds none. */
export const P_STATION_BY_USER: Readonly<Record<string, string>> = { "u-luis": STATION_IDS.walk, "u-rosa": STATION_IDS.crunchy };

export const VENDORS: readonly VendorFact[] = [
  { id: "v-a", name: "Vendor A", sourceKind: "vendor", active: true },
  { id: "v-b", name: "Vendor B", sourceKind: "vendor", active: true },
  { id: "v-c", name: "Vendor C", sourceKind: "vendor", active: true },
];
const P_CUTOFFS: readonly VendorCutoff[] = [
  { vendorId: "v-a", locationId: P_SHOP.id, orderDay: 3, cutoffTime: "14:00:00" },
  { vendorId: "v-b", locationId: null, orderDay: 3, cutoffTime: "21:00:00" },
];
const P_RHYTHM: readonly RhythmRow[] = [
  { vendorId: "v-a", locationId: P_SHOP.id, orderDow: 3, leadDays: 1 },
  { vendorId: "v-b", locationId: P_SHOP.id, orderDow: 3, leadDays: 2 },
  { vendorId: "v-c", locationId: P_SHOP.id, orderDow: 2, leadDays: 1 },
];

export function po(p: Partial<PoFact> & Pick<PoFact, "id" | "vendorId" | "status" | "createdAt">): PoFact {
  return { displayCode: p.id.toUpperCase(), confirmedAt: null, placedAt: null, placedByName: null, totalCents: null, unpricedLines: 0, ...p };
}
/** Vendor C's order, placed yesterday afternoon: due today by its pair (Tuesday, lead 1). */
const PO_C = po({ id: "po-c", vendorId: "v-c", status: "placed", createdAt: iso("2026-11-17", "15:00"), confirmedAt: iso("2026-11-17", "15:00"), placedAt: iso("2026-11-17", "15:05") });

/** The event times of the normal day (spec 3.4). `null` = never happens. */
export interface PStreetTimeline {
  checkIn: string | null; morningPrep: string | null; vendorCLogged: string | null; cateringOut: string | null;
  vendorAOrdered: string | null; midDayPrep: string | null; closingFinished: string | null; closingStarted: string | null;
  stationClose: Partial<Record<StationKey, string | null>>;
}
export const TIMELINE: PStreetTimeline = {
  checkIn: "07:35", morningPrep: "09:50", vendorCLogged: "10:15", cateringOut: "11:40", vendorAOrdered: "13:55",
  midDayPrep: "14:50", closingFinished: "21:40", closingStarted: "13:00",
  stationClose: { crunchy: "13:40", third: "15:55", walk: "19:58", expo: "20:05" },
};
export const NO_EVENTS: PStreetTimeline = {
  checkIn: null, morningPrep: null, vendorCLogged: null, cateringOut: null, vendorAOrdered: null, midDayPrep: null,
  closingFinished: null, closingStarted: null, stationClose: {},
};

export interface PStreetOptions {
  timeline?: PStreetTimeline;
  /** Per-station overrides of the event time (null = no event) and of the usual time. */
  close?: Partial<Record<StationKey, string | null>>;
  usual?: Partial<Record<StationKey, string | null>>;
  heavy?: boolean;
  /** The plan date is the evening BEFORE the heavy day: tomorrow's catering is the heavy day's orders. */
  nightBefore?: boolean;
  planDate?: string;
}

/** The spec's stations (illustrative usual times; Crunchy Boi marked as the mid-day trigger). */
function pStreetStations(closeAt: (k: StationKey) => string | null, usual: Partial<Record<StationKey, string | null>> = {}): DayStation[] {
  const u = (k: StationKey, d: string | null) => (k in usual ? usual[k]! : d);
  const s = (k: StationKey, name: string, nameEs: string | null, sort: number, floor: boolean, d: string | null, startsMidDay = false) =>
    station({ id: STATION_IDS[k], name, nameEs, sort, floor, startsMidDay, usuallyClosesAt: u(k, d), closedAt: closeAt(k) });
  return [
    s("crunchy", "Crunchy Boi Station", "Estación Crunchy Boi", 1, true, "13:30:00", true),
    s("third", "3rd Party Station", "Estación de terceros", 2, true, "15:30:00"),
    s("walk", "Walk Ins Station", null, 3, true, "20:00:00"),
    s("expo", "Expo Station", null, 4, true, "20:00:00"),
    s("prepFridge", "Prep Fridge", null, 5, false, null),
    s("backLine", "Shut Down Back Line", null, 6, false, null),
    s("frontHouse", "Clean front of house", null, 7, false, null),
    s("prepArea", "Prep Area", null, 8, false, null),
    s("closingManager", "Closing Manager", null, 9, false, null),
    s("walkOut", "Walk-Out Verification", null, 10, false, null),
  ];
}

/** The 12:00 order of 25 guests, and on the heavy day a 9:00 order of 120 (145 in total). */
function pStreetOrders(date: string, min: number, cateringOut: string | null, heavy: boolean): CateringOrder[] {
  const out = (t: string | null) => (t !== null && min >= hm(t) ? { state: "out" as const, outAt: iso(date, t) } : {});
  const orders = [order({ id: "cat-noon", eventQ: 48, headcount: 25, ...out(cateringOut) })];
  if (heavy) orders.unshift(order({ id: "cat-nine", eventQ: 36, headcount: 120, ...out(cateringOut === null ? null : "08:55") }));
  return orders;
}

export function pStreet(min: number, opts: PStreetOptions = {}): ShopFacts {
  const date = opts.planDate ?? (opts.nightBefore ? "2026-11-17" : PLAN_DATE);
  const tl = opts.timeline ?? TIMELINE;
  const has = (t: string | null | undefined): t is string => t != null && min >= hm(t);
  const closeAt = (k: StationKey): string | null => {
    const t = opts.close && k in opts.close ? opts.close[k]! : tl.stationClose[k] ?? null;
    return has(t) ? iso(date, t) : null;
  };
  const yesterday = "2026-11-17";
  const tomorrow = date === PLAN_DATE ? "2026-11-19" : PLAN_DATE;
  const aOrdered = has(tl.vendorAOrdered)
    ? [po({ id: "po-a", vendorId: "v-a", status: "confirmed", createdAt: iso(date, "13:50"), confirmedAt: iso(date, tl.vendorAOrdered) })] : [];
  const cLogged = has(tl.vendorCLogged);
  const opening = checklist(date, {
    status: has(tl.morningPrep) ? "confirmed" : has(tl.checkIn) ? "phase1_complete" : min >= 7 * 60 ? "open" : null,
    phase1At: has(tl.checkIn) ? iso(date, tl.checkIn) : null,
    finishedAt: has(tl.morningPrep) ? iso(date, tl.morningPrep) : null,
    finishedByName: has(tl.morningPrep) ? "Ana" : null,
  });
  const closingDone = has(tl.closingFinished);
  return {
    kind: "shop", shop: P_SHOP,
    hours: ok({ source: "saved", shopDay: { prepStartQ: 28, serviceStartQ: 42 }, dayPrepStartQ: 28,
      catering: { minHeadcount: 30, leadMinutes: 210, defaultStartQ: 34, defaultEndQ: 52, extraPrepDishHeads: 1 } }),
    stations: ok({ stationDate: date, stations: pStreetStations(closeAt, opts.usual) }),
    opening: ok(opening),
    closing: ok(checklist(date, {
      status: closingDone ? "confirmed" : has(tl.closingStarted) ? "open" : null,
      finishedAt: closingDone ? iso(date, tl.closingFinished!) : null, finishedByName: closingDone ? "Ana" : null,
      sectionsLeft: min >= hm("20:10") ? 4 : 6,
    })),
    amPrep: ok(checklist(date)),
    midDay: ok({ forDate: date, instances: has(tl.midDayPrep) ? [{ status: "confirmed", finishedAt: iso(date, tl.midDayPrep), finishedByName: "Luis" }] : [] }),
    cash: ok(report(date)),
    pm: ok(report(date)),
    ordering: ok({ forDate: date, vendors: VENDORS, cutoffs: P_CUTOFFS, pos: [PO_C, ...aOrdered] }),
    rhythm: ok({ rows: P_RHYTHM, skips: [] }),
    receiving: ok({
      forDate: date, vendors: VENDORS, openOrders: cLogged || date !== PLAN_DATE ? [] : [PO_C], halfLogged: [],
      completedToday: cLogged && date === PLAN_DATE ? [{ id: "del-c", vendorId: "v-c", at: iso(date, tl.vendorCLogged!) }] : [],
    }),
    cateringToday: ok({ forDate: date, orders: pStreetOrders(date, min, tl.cateringOut, !!opts.heavy && !opts.nightBefore) }),
    cateringTomorrow: ok({ forDate: tomorrow, orders: opts.nightBefore ? pStreetOrders(tomorrow, -1, null, true) : [] }),
    flaggedLines: ok({ today: opts.heavy && !opts.nightBefore ? 4 : 0, tomorrow: opts.nightBefore ? 4 : 0 }),
    assignments: ok({ forDate: date, scope: "all_tasks", rows: [
      assignment("as-open", "opening_report", "u-ana", "Ana"),
      assignment("as-cash", "cash_report", "u-ana", "Ana"),
      assignment("as-mid", "mid_day_prep", "u-luis", "Luis"),
    ] }),
    myStation: ok(null),
    counts: ok({ inProgress: false }),
    yesterdayClosing: ok(checklist(yesterday, { status: "confirmed" })),
    holdsStationOnStationDay: false,
  };
}

/** The plan for one viewer at one minute (their own station filled as PR 6 would). */
export function pStreetPlan(v: DayViewer, min: number, opts: PStreetOptions = {}): DayPlan {
  const facts = forViewer(pStreet(min, opts), P_STATION_BY_USER, v.userId);
  const plan = planDay({ planDate: opts.planDate ?? (opts.nightBefore ? "2026-11-17" : PLAN_DATE), nowMin: min, viewer: v, facts });
  if (plan.kind !== "shop") throw new Error("expected a shop plan");
  return plan;
}
