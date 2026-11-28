/**
 * Digests round 3, PR 2: shared FACT fixtures for the staffing lines (the composers' side; the reader has its own).
 * Synthetic only: people "Person A" … "Person F", shops "Shop A" / "Shop B", made-up ids. Day D = 2026-10-07 (EDT),
 * D+1 = 2026-10-08. The shop digest's window is [D, D+1]; the catering digest of D has the same window.
 */
import { ok, failed, unavailable, type Loaded, type ShopV2Facts } from "@/lib/report-digests-v2-shared";
import type { DayRoster, RosterPerson, ShopSchedule } from "@/lib/report-digests-schedule-shared";
import type { LaborSummary } from "@/lib/toast/labor-shared";
import type { CateringFacts, CateringLeadFact, ShopDayFacts } from "@/lib/report-digests-compose";
import { etWallTime } from "@/lib/report-digests-shared";
import { v2Fixture } from "./digest-v2";

export const BASE = "https://ops.example.com";
export const A = "aaaaaaaa-0000-4000-8000-000000000001";
export const B = "bbbbbbbb-0000-4000-8000-000000000002";
export const D = "2026-10-07";
export const D1 = "2026-10-08";
export const SHOP_A = { id: A, name: "Shop A" };
export const SHOP_B = { id: B, name: "Shop B" };

/** An ET wall time on `day` as an ISO instant ("7:30" → 450 minutes). Minutes past 24 h land on the next day. */
export const at = (day: string, hh: number, mm = 0) => etWallTime(day, hh * 60 + mm).toISOString();

export function person(userId: string, firstName: string | null, day: string, start: [number, number?], end: [number, number?], over: Partial<RosterPerson> = {}): RosterPerson {
  return { userId, firstName, roleName: null, startAt: at(day, start[0], start[1] ?? 0), endAt: at(day, end[0], end[1] ?? 0), extraShifts: 0, ...over };
}

/** A day's roster from its people (each person's first shift; `extraMinutes` = the length of their extra shifts). */
export function roster(day: string, people: RosterPerson[], opts: { openShifts?: number; extraMinutes?: number; scheduledMinutes?: number } = {}): DayRoster {
  const firstStart = people.length === 0 ? null : people.map((p) => p.startAt).sort()[0]!;
  const lastEnd = people.length === 0 ? null : people.map((p) => p.endAt).sort().at(-1)!;
  const minutes = people.reduce((a, p) => a + (Date.parse(p.endAt) - Date.parse(p.startAt)) / 60_000, 0) + (opts.extraMinutes ?? 0);
  return {
    day, people,
    assignedShifts: people.reduce((a, p) => a + 1 + p.extraShifts, 0),
    openShifts: opts.openShifts ?? 0,
    firstStart, lastEnd,
    scheduledMinutes: opts.scheduledMinutes ?? minutes,
  };
}

export const schedule = (...days: DayRoster[]): Loaded<ShopSchedule> => ok({ days });

/** Six people on D (5 named + " +1"), Person B on two shifts; two on D+1 with one open shift. */
export function fullDay(day = D): DayRoster {
  return roster(day, [
    person("101", "Person A", day, [7], [15], { roleName: "Line" }),
    person("102", "Person B", day, [8], [16], { extraShifts: 1 }),
    person("103", "Person C", day, [9], [17], { roleName: "Prep" }),
    person("104", "Person D", day, [10], [18]),
    person("105", "Person E", day, [11], [19]),
    person("106", "Person F", day, [13, 30], [21, 30]),
  ], { extraMinutes: 120 });
}
export function tomorrowDay(day = D1, openShifts = 0): DayRoster {
  return roster(day, [person("201", "Person A", day, [7], [15], { roleName: "Line" }), person("202", null, day, [11], [19])], { openShifts });
}

/** The five schedule fact shapes every byte-equality test runs over (plus "absent" = no key at all). */
export const SCHEDULE_VARIANTS: Array<[string, Loaded<ShopSchedule> | undefined]> = [
  ["absent", undefined],
  ["present", schedule(fullDay(D), tomorrowDay(D1))],
  ["present with an open shift", schedule(roster(D, [person("101", "Person A", D, [7], [15])], { openShifts: 2 }), tomorrowDay(D1, 1))],
  ["unavailable", unavailable("not_linked")],
  ["error", failed()],
];

export function labor(over: Partial<LaborSummary> = {}): LaborSummary {
  return {
    totalHours: 62.5, openEntries: 0, byJob: [{ job: "Line", hours: 62.5 }],
    people: [{ employeeGuid: "g1", firstName: "Person A", hours: 8, unknownShifts: 0 }],
    unknownHoursEntries: 0, partial: false, salesPerLaborHourCents: 1500,
    overtimeAssessed: true, dayOvertimeAssessed: true, weekOvertimeAssessed: true, dayOvertime: [], weekOvertime: [],
    ...over,
  };
}

/** A shop day with v2 facts; `schedule` only when given (absent = the key is not there). */
export function shopFacts(shop: { id: string; name: string }, over: Partial<ShopV2Facts> = {}, sched?: Loaded<ShopSchedule>): ShopDayFacts {
  return {
    location: shop, day: D, reports: [],
    receiving: { deliveries: 0, discrepant: 0, missingReceipt: 0 }, tosses: 0, storeRunsPending: 0, tasks: [], pmFindings: null,
    v2: v2Fixture({ ...over, ...(sched ? { schedule: sched } : {}) }),
  };
}

export function lead(id: string, locationId: string | null, eventDate: string, over: Partial<CateringLeadFact> = {}): CateringLeadFact {
  return {
    id, contactName: `Customer ${id}`, company: null, eventDate, timeWindow: "11:30", headcount: 20, stage: "confirmed",
    leadSource: "phone", locationId, createdDay: "2026-10-01", followUpDate: null, externalRef: null, isDelivery: false,
    valueCents: 30000, dueCents: 0, prep: null, ...over,
  };
}

/**
 * The catering facts of D: `leads` as given, stations at Shop A (one person on a station), no readiness. `schedule`
 * by shop only when given.
 */
export function cateringFacts(leads: CateringLeadFact[], sched?: Record<string, Loaded<ShopSchedule>>, over: Partial<CateringFacts> = {}): CateringFacts {
  return {
    today: D, leads, lostYesterdayIds: [], quotesSentYesterday: [], openQuotes: [], refundsYesterday: [],
    staff: {
      [A]: ok({ source: "stations", scheduleConnected: false, onStation: [{ firstName: "Person A", station: "Grill", source: "claimed" }] }),
      [B]: ok({ source: "stations", scheduleConnected: false, onStation: [] }),
    },
    ...over,
    ...(sched ? { schedule: sched } : {}),
  };
}
