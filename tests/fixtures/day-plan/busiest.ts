/**
 * The busiest day (plan r4, 11.4), for the social media manager test (group 13): heavy catering, eight vendors with
 * cutoffs and drafts, three deliveries (one half logged), a full team of named assignees, a past-due station, and a
 * social media manager whose own assignments are Opening plus a refused `cash_report`. FORBIDDEN_STRINGS lists every
 * guest count, order count, vendor name, time string and other person's name the shop facts hold.
 */
import type { ShopFacts, SmmFacts } from "@/lib/day-plan-shared";
import type { VendorCutoff, VendorFact } from "@/lib/report-digests-v2-shared";
import { assignment, iso, ok, PLAN_DATE, viewer } from "./build";
import { P_SHOP, pStreet, po } from "./p-street";

export const SMM = viewer("social_media_mgr", "u-smm");

const NAMES = ["Alpha Provisions", "Bravo Produce", "Charlie Dairy", "Delta Breads", "Echo Meats", "Foxtrot Paper", "Golf Beverages", "Hotel Spices"];
const BUSY_VENDORS: readonly VendorFact[] = NAMES.map((name, i) => ({ id: `bv-${i}`, name, sourceKind: "vendor", active: true }));
const TIMES = ["09:15:00", "10:45:00", "11:20:00", "13:05:00", "14:35:00", "16:10:00", "17:25:00", "21:40:00"];
const BUSY_CUTOFFS: readonly VendorCutoff[] = BUSY_VENDORS.map((v, i) => ({ vendorId: v.id, locationId: P_SHOP.id, orderDay: 3, cutoffTime: TIMES[i]! }));
const TEAM = ["Ana", "Luis", "Rosa", "Marco", "Delphine", "Samir", "Yolanda", "Tobias"];

export function busiestFacts(min: number): ShopFacts {
  const base = pStreet(min, { heavy: true, close: { crunchy: null } });
  return {
    ...base,
    ordering: ok({ forDate: PLAN_DATE, vendors: BUSY_VENDORS, cutoffs: BUSY_CUTOFFS,
      pos: BUSY_VENDORS.slice(0, 4).map((v, i) => po({ id: `draft-${i}`, vendorId: v.id, status: "draft", createdAt: iso(PLAN_DATE, "06:30") })) }),
    receiving: ok({ forDate: PLAN_DATE, vendors: BUSY_VENDORS,
      openOrders: [
        po({ id: "bpo-1", vendorId: "bv-0", status: "placed", createdAt: iso("2026-11-17", "16:00"), placedAt: iso("2026-11-17", "16:00") }),
        po({ id: "bpo-2", vendorId: "bv-1", status: "placed", createdAt: iso("2026-11-17", "16:30"), placedAt: iso("2026-11-17", "16:30") }),
      ],
      halfLogged: [{ id: "bdel-3", vendorId: "bv-2", startedAt: iso(PLAN_DATE, "08:10") }], completedToday: [] }),
    rhythm: ok({ rows: BUSY_VENDORS.map((v) => ({ vendorId: v.id, locationId: P_SHOP.id, orderDow: 2, leadDays: 1 })), skips: [] }),
    assignments: ok({ forDate: PLAN_DATE, scope: "all_tasks", rows: [
      assignment("b1", "opening_report", "u-ana", TEAM[0]!), assignment("b2", "mid_day_prep", "u-luis", TEAM[1]!),
      assignment("b3", "am_prep", "u-rosa", TEAM[2]!), assignment("b4", "cash_report", "u-marco", TEAM[3]!),
      assignment("b5", "pm_report", "u-delphine", TEAM[4]!), assignment("b6", "ordering", "u-samir", TEAM[5]!),
      assignment("b7", "receiving", "u-yolanda", TEAM[6]!), assignment("b8", "counts", "u-tobias", TEAM[7]!),
      assignment("b9", "opening_report", "u-smm", "Smm"), assignment("b10", "cash_report", "u-smm", "Smm"),
    ] }),
    flaggedLines: ok({ today: 7, tomorrow: 3 }),
  };
}

/** The social media manager's own facts, loaded successfully: Opening and Mid-day prep (allowed), cash and ordering (refused). */
export const SMM_OK: SmmFacts = {
  kind: "smm",
  ownTasks: ok([
    { task: "cash_report", status: "not_started" },
    { task: "mid_day_prep", status: "in_progress" },
    { task: "ordering", status: "not_started" },
    { task: "opening_report", status: "done" },
  ]),
  ownStation: ok({ name: "Expo Station", nameEs: "Estación Expo" }),
};
export const SMM_FAILED_TASKS: SmmFacts = { ...SMM_OK, ownTasks: { kind: "failed" } };
export const SMM_FAILED_STATION: SmmFacts = { ...SMM_OK, ownStation: { kind: "failed" } };

export const FORBIDDEN_STRINGS: readonly string[] = [
  // guest counts and the day's total; flagged-line counts
  "120", "25", "145",
  // vendor names (the busiest day's and the worked example's)
  ...NAMES, "Vendor A", "Vendor B", "Vendor C",
  // time strings
  ...TIMES.map((t) => t.slice(0, 5)), "13:30", "15:30", "20:00", "12:00", "09:00",
  // other people's names
  ...TEAM,
  // other stations' names
  "Crunchy Boi", "3rd Party", "Walk Ins",
];
