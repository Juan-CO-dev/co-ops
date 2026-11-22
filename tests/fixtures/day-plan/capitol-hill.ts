/**
 * Capitol Hill, spec 3.5 on the shipped defaults (plan r4, 11.2). No saved structure (`source: "defaults"`), no marked
 * station (the trigger is Crunchy Boi by earliest usual time), the live usual times (Crunchy Boi 14:00, 3rd Party 15:30,
 * the rest none), Prep Area a floor station and Closing Manager not. Its own, earlier events; a shop-only Vendor B cutoff
 * at 13:00 beside the both-shops row at 21:00; its own rhythm; a heavy day by TOTAL (three orders of 20).
 */
import type { ShopFacts } from "@/lib/day-plan-shared";
import type { VendorCutoff, VendorFact } from "@/lib/report-digests-v2-shared";
import { SCHEDULE_STRUCTURE_DEFAULTS } from "@/lib/scheduling/structure-shared";
import { assignment, checklist, hm, iso, ok, order, PLAN_DATE, report, station } from "./build";
import { po, STATION_IDS } from "./p-street";

export const C_SHOP = { id: "shop-c", code: "C" } as const;

const C_VENDORS: readonly VendorFact[] = [
  { id: "v-a", name: "Vendor A", sourceKind: "vendor", active: true },
  { id: "v-b", name: "Vendor B", sourceKind: "vendor", active: true },
  { id: "v-d", name: "Vendor D", sourceKind: "vendor", active: true },
];
/** Vendor A's row is P Street's own (never governs here); Vendor B has a shop row and the both-shops row. */
const C_CUTOFFS: readonly VendorCutoff[] = [
  { vendorId: "v-a", locationId: "shop-p", orderDay: 3, cutoffTime: "14:00:00" },
  { vendorId: "v-b", locationId: C_SHOP.id, orderDay: 3, cutoffTime: "13:00:00" },
  { vendorId: "v-b", locationId: null, orderDay: 3, cutoffTime: "21:00:00" },
];

const EVENTS = { crunchy: "13:10", third: "14:50", walk: "17:40", expo: "18:20", prepArea: "18:40" } as const;

export interface CapitolOptions { events?: boolean; vendorBOrdered?: string | null }

export function capitolHill(min: number, opts: CapitolOptions = {}): ShopFacts {
  const date = PLAN_DATE;
  const events = opts.events ?? true;
  const has = (t: string | null | undefined): t is string => t != null && min >= hm(t);
  const closeAt = (k: keyof typeof STATION_IDS) => {
    const t = events ? (EVENTS as Partial<Record<string, string>>)[k] : undefined;
    return has(t) ? iso(date, t) : null;
  };
  const s = (k: keyof typeof STATION_IDS, name: string, sort: number, floor: boolean, usual: string | null = null) =>
    station({ id: STATION_IDS[k], name, sort, floor, usuallyClosesAt: usual, closedAt: closeAt(k) });
  const out = (id: string, eventQ: number, outT: string) =>
    order({ id, eventQ, headcount: 20, ...(has(outT) ? { state: "out" as const, outAt: iso(date, outT) } : {}) });
  const bOrdered = opts.vendorBOrdered === undefined ? "12:30" : opts.vendorBOrdered;
  const poD = po({ id: "po-d", vendorId: "v-d", status: "placed", createdAt: iso("2026-11-17", "10:00"), placedAt: iso("2026-11-17", "10:00") });
  const closingDone = events && has("19:10");
  const done = (t: string) => (has(t) ? { state: "submitted" as const, at: iso(date, t), byName: "Mia" } : {});
  return {
    kind: "shop", shop: C_SHOP,
    hours: ok({ source: "defaults", shopDay: SCHEDULE_STRUCTURE_DEFAULTS.shopDay, catering: SCHEDULE_STRUCTURE_DEFAULTS.catering,
      dayPrepStartQ: {} }),
    stations: ok({ stationDate: date, stations: [
      s("crunchy", "Crunchy Boi Station", 1, true, "14:00:00"),
      s("third", "3rd Party Station", 2, true, "15:30:00"),
      s("walk", "Walk Ins Station", 3, true),
      s("expo", "Expo Station", 4, true),
      s("prepFridge", "Prep Fridge", 5, false),
      s("backLine", "Shut Down Back Line", 6, false),
      s("frontHouse", "Clean front of house", 7, false),
      s("prepArea", "Prep Area", 8, true),
      s("closingManager", "Closing Manager", 9, false),
      s("walkOut", "Walk-Out Verification", 10, false),
    ] }),
    opening: ok(checklist(date, {
      status: has("09:30") ? "confirmed" : has("07:20") ? "phase1_complete" : null,
      phase1At: has("07:20") ? iso(date, "07:20") : null, finishedAt: has("09:30") ? iso(date, "09:30") : null, finishedByName: has("09:30") ? "Mia" : null,
    })),
    closing: ok(checklist(date, {
      status: closingDone ? "confirmed" : has("12:00") ? "open" : null,
      finishedAt: closingDone ? iso(date, "19:10") : null, finishedByName: closingDone ? "Mia" : null, sectionsLeft: 3,
    })),
    amPrep: ok(checklist(date, has("18:50") ? { status: "confirmed", finishedAt: iso(date, "18:50"), finishedByName: "Mia" } : {})),
    midDay: ok({ forDate: date, instances: has("14:10") ? [{ status: "confirmed", finishedAt: iso(date, "14:10"), finishedByName: "Mia" }] : [] }),
    cash: ok(report(date, done("18:55"))),
    pm: ok(report(date, done("19:05"))),
    ordering: ok({ forDate: date, vendors: C_VENDORS, cutoffs: C_CUTOFFS, pos: [
      poD,
      ...(has(bOrdered) ? [po({ id: "po-b", vendorId: "v-b", status: "confirmed", createdAt: iso(date, bOrdered), confirmedAt: iso(date, bOrdered) })] : []),
    ] }),
    rhythm: ok({ rows: [{ vendorId: "v-d", locationId: C_SHOP.id, orderDow: 2, leadDays: 1 }, { vendorId: "v-b", locationId: C_SHOP.id, orderDow: 3, leadDays: 1 }], skips: [] }),
    receiving: ok({ forDate: date, vendors: C_VENDORS, openOrders: has("11:00") ? [] : [poD], halfLogged: [],
      completedToday: has("11:00") ? [{ id: "del-d", vendorId: "v-d", at: iso(date, "11:00") }] : [] }),
    cateringToday: ok({ forDate: date, orders: [out("c-1", 46, "11:20"), out("c-2", 50, "12:20"), out("c-3", 52, "12:50")] }),
    cateringTomorrow: ok({ forDate: "2026-11-19", orders: [] }),
    flaggedLines: ok({ today: 0, tomorrow: 0 }),
    assignments: ok({ forDate: date, scope: "all_tasks", rows: [assignment("c-open", "opening_report", "u-mia", "Mia")] }),
    myStation: ok(null),
    counts: ok({ inProgress: false }),
    yesterdayClosing: ok(checklist("2026-11-17", { status: "confirmed" })),
    holdsStationOnStationDay: false,
  };
}
