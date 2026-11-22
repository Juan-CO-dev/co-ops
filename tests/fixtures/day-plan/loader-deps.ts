/**
 * Nav PR 6 (plan r3, 8.1): fake `DayFactDeps` for the loader's composition tests. Every read answers a small, varied,
 * all-ok day at P Street (2026-11-18, a Wednesday); `withDeps` swaps any read for a failing, hanging or recording one.
 */
import type { ShiftBoard, Station, StationEvent, TaskAssignment } from "@/lib/assignments-shared";
import type { DayFactDeps, DayFactsArgs } from "@/lib/day-plan";
import type { InstanceRow } from "@/lib/day-plan-load-shared";
import type { DayViewer } from "@/lib/day-plan-shared";
import { etWallMinutesInstant } from "@/lib/operational-day";
import { addDaysEt } from "@/lib/vendor-rhythm-shared";
import { ANA, hm } from "./build";

export const PLAN = "2026-11-18";
export const YESTERDAY = addDaysEt(PLAN, -1);
export const TOMORROW = addDaysEt(PLAN, 1);
export const SHOP = { id: "11111111-1111-4111-8111-111111111111", code: "P" };
export const at = (t: string, date = PLAN): Date => etWallMinutesInstant(date, hm(t));

const pos = (stationId: string, active = true) => ({ id: `${stationId}-p`, stationId, name: "Spot", nameEs: null, duty: null, dutyEs: null, sort: 1, active });
const st = (id: string, name: string, sort: number, p: Partial<Station> = {}): Station =>
  ({ id, name, nameEs: `${name} ES`, sort, active: true, staffed: true, positions: [pos(id)], usuallyClosesAt: null, closedAt: null, ...p });

export const STATIONS: Station[] = [
  st("crunchy", "Crunchy Boi Station", 1, { usuallyClosesAt: "14:00:00" }),
  st("expo", "Expo Station", 2, { closedAt: "2026-11-18T18:30:00.000Z" }),
  st("fridge", "Prep Fridge", 3, { staffed: false }),
  st("cm", "Closing Manager", 4),
  st("gone", "Old Station", 5, { active: false }),
];
export function ev(sequence: string, p: Partial<StationEvent>): StationEvent {
  return { id: `e${sequence}`, sequence, locationId: SHOP.id, businessDate: PLAN, userId: ANA.userId, stationId: null, kind: "claim",
    actorId: null, actorName: null, at: "2026-11-18T15:00:00.000Z", source: "claimed", ...p };
}
const TASKS: TaskAssignment[] = [
  { id: "t1", task: "am_prep", assigneeId: "u-luis", assignerId: "u-gm", assignerName: "Gina", note: null, assigneeName: "Luis Diaz", source: "assigned", available: true },
  { id: "t2", task: "counts", assigneeId: "u-rosa", assignerId: "u-rosa", assignerName: null, note: null, assigneeName: "Rosa", source: "taken", available: false },
];
export function board(p: Partial<ShiftBoard> = {}): ShiftBoard {
  return { stationDate: PLAN, locationId: SHOP.id, date: PLAN, viewerId: ANA.userId, viewerLevel: 4, stations: STATIONS,
    people: [{ id: ANA.userId, name: "Ana Ruiz", level: 4, hasWork: true }], events: [ev("1", { stationId: "crunchy" })], tasks: TASKS, ...p };
}

const CLOSING: InstanceRow = { id: "close-1", template_id: "tpl-close-v1", status: "open", created_at: "2026-11-18T22:00:00.000Z", confirmed_at: null, confirmed_by: null };
export const OPENING: InstanceRow = { id: "open-1", template_id: "tpl-open", status: "confirmed", created_at: "2026-11-18T11:00:00.000Z", confirmed_at: "2026-11-18T15:10:00.000Z", confirmed_by: "u-ana" };
const YESTERDAY_CLOSING: InstanceRow = { id: "close-0", template_id: "tpl-close-v1", status: "confirmed", created_at: "2026-11-17T22:00:00.000Z", confirmed_at: "2026-11-18T03:00:00.000Z", confirmed_by: "u-mia" };
const AM_PREP: InstanceRow[] = [{ id: "am-1", template_id: "tpl-am", status: "open", created_at: "2026-11-17T23:00:00.000Z", confirmed_at: null, confirmed_by: null }];
export const MID_DAY: InstanceRow[] = [{ id: "md-1", template_id: "tpl-md", status: "confirmed", created_at: "2026-11-18T19:00:00.000Z", confirmed_at: "2026-11-18T20:00:00.000Z", confirmed_by: "u-luis" }];
const CLOSING_ITEMS = [
  { id: "i1", station: "Crunchy Boi Station", active: true }, { id: "i2", station: "Expo Station", active: true },
  { id: "i3", station: "Closing Manager", active: true }, { id: "i4", station: null, active: true },
];

/** The all-ok reads. Each is a plain async function so a test can replace it. */
export function okDeps(): DayFactDeps {
  return {
    shopDay: async () => ({ source: "saved", shopDay: { prepStartQ: 28, serviceStartQ: 42 },
      catering: { minHeadcount: 30, leadMinutes: 210, defaultStartQ: 34, defaultEndQ: 52, extraPrepDishHeads: 1 } }),
    // PR SCH: by default no schedule holds the dates (the saved start applies); tests/day-plan-load.test.ts builds the others.
    scheduleStarts: async () => ({ weeks: [], days: [], starts: {} }),
    stationFlags: async () => ({ installed: false }),
    closingClassification: async () => [
      ...["opening_report", "am_prep", "mid_day_prep", "cash_report", "pm_report", null, null].map((ref) => ({ station: "Closing Manager", active: true, report_reference_type: ref })),
      { station: "Crunchy Boi Station", active: true, report_reference_type: null },
    ],
    templateItems: async () => CLOSING_ITEMS,
    dayInstance: async (_sb, a) => (a.type === "opening" ? OPENING : a.date === PLAN ? CLOSING : YESTERDAY_CLOSING),
    completedItems: async () => ["i2"],
    phase1At: async () => "2026-11-18T12:40:00.000Z",
    prepInstances: async (_sb, a) => (a.subtype === "am_prep" ? AM_PREP : MID_DAY),
    userNames: async () => new Map([["u-ana", "Ana Ruiz"], ["u-luis", "Luis Diaz"], ["u-mia", "Mia Lopez"]]),
    cashReport: async () => null,
    pmReport: async () => ({ status: "open", submitted_at: null, submitted_by: null }),
    vendors: async () => [{ id: "v-a", name: "Vendor A", source_kind: "vendor", active: true }],
    cutoffs: async () => [{ vendor_id: "v-a", location_id: null, order_day: 3, cutoff_time: "15:00:00" }],
    recentPos: async () => [{ id: "po-1", display_code: "PO-1", vendor_id: "v-a", status: "placed", created_at: "2026-11-17T15:00:00.000Z", confirmed_at: null, placed_at: "2026-11-17T15:00:00.000Z" }],
    rhythm: async () => ({ rows: [{ vendor_id: "v-a", location_id: SHOP.id, order_dow: 2, lead_days: 1 }], skips: [] }),
    halfLogged: async () => [],
    openOrders: async () => [{ id: "po-1", display_code: "PO-1", vendor_id: "v-a", status: "placed", created_at: "2026-11-17T15:00:00.000Z", confirmed_at: null, placed_at: "2026-11-17T15:00:00.000Z" }],
    completedOn: async () => [],
    booked: async () => [
      { id: "lead-1", eventDate: PLAN, timeWindow: "12:00 PM", headcount: 20, stage: "out" },
      { id: "lead-2", eventDate: TOMORROW, timeWindow: "11:00 AM", headcount: 40, stage: "confirmed" },
    ],
    ezcater: async () => [{ id: "ez-1", event_date: PLAN, event_timestamp: null, handoff_time: "1:00 PM", headcount: 10, status: "Cancelled" }],
    outEvents: async () => [{ pipeline_id: "lead-1", to_stage: "out", created_at: "2026-11-18T16:20:00.000Z" }],
    flaggedLines: async () => ({ [PLAN]: 2, [TOMORROW]: 1 }),
    ownTasks: async () => [],
    stationBusinessDate: async () => PLAN,
    ownStationEvents: async () => [],
    stationWithPositions: async () => null,
  };
}
export function withDeps(over: Partial<DayFactDeps>): DayFactDeps {
  return { ...okDeps(), ...over };
}
export function args(viewer: DayViewer, p: Partial<DayFactsArgs> = {}): DayFactsArgs {
  return { viewer, shop: SHOP, now: at("13:45"), board: async () => board(), locations: [SHOP.id], ...p };
}
export const NO_CLIENT = {} as never;
