// Item 2 PR 2c (labor plan r6 §3 P1 #2, r3 P1 #3/#4/#5): the PURE labor week builder. One row per
// (shop, quarter, person, source, role); overtime assigned per minute in instant order BEFORE grouping,
// company-wide across both shops; coverage first; minutes, never money.
import { describe, expect, it } from "vitest";
import { buildLaborWeek, type LaborWeekSource, type FrameDay } from "@/lib/facts/labor-week-shared";
import type { WageVersion } from "@/lib/facts/labor-wages-shared";

const A = "00000000-0000-4000-8000-00000000000a", B = "00000000-0000-4000-8000-00000000000b";
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const WEEK = "2026-10-04"; // a Sunday (EDT, UTC-4)
const days = (loc: string, o: Partial<FrameDay> = {}): FrameDay[] => Array.from({ length: 7 }, (_, i) => ({
  location_id: loc, business_date: `2026-10-${String(4 + i).padStart(2, "0")}`, linked: true, evidence_run_id: "11111111-1111-4111-8111-111111111111", settled: true, ...o }));
const et = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-04:00`).toISOString();
let pid = 1;
const punch = (user: string, loc7: string, role: string | null, date: string, from: string, to: string | null, brk = 0, endDate = date) => ({
  id: String(pid++), user_id: user, location_id: loc7, role_id: role, clocked_in: et(date, from), clocked_out: to === null ? null : et(endDate, to),
  break_minutes: brk, deleted: false });
const wage = (user: string, cents: number, o: Partial<WageVersion> = {}): WageVersion => ({ user_id: user, wage_id: String(pid++), upcoming: false,
  effective_date: "2026-01-01", wage_type: "hourly", wage_cents: cents, role_id: null, active: true, seq: pid++, ...o });

function src(o: Partial<LaborWeekSource> = {}): LaborWeekSource {
  return {
    weekStart: WEEK, builtThrough: "2026-10-10", floorDay: "2026-07-23",
    days: [...days(A), ...days(B)],
    locationLinks: [{ location_id: A, sevenshifts_location_id: "501" }, { location_id: B, sevenshifts_location_id: "502" }],
    userLinks: [], toastLinks: [], punches: [], toastEntries: [], wages: [], laborSettings: [], ...o,
  };
}
const totals = (rows: { minutes: number; ot_minutes: number }[]) => rows.reduce((s, r) => ({ m: s.m + r.minutes, ot: s.ot + r.ot_minutes }), { m: 0, ot: 0 });

describe("quarter x role rows (P1 #2)", () => {
  it("10:00-10:05 role A at $18 and 10:05-10:15 role B at $24 are two rows of one quarter, each with its own rate", () => {
    const out = buildLaborWeek(src({
      punches: [punch("7", "501", "31", "2026-10-05", "10:00", "10:05"), punch("7", "501", "32", "2026-10-05", "10:05", "10:15")],
      wages: [wage("7", 1800, { role_id: "31" }), wage("7", 2400, { role_id: "32" })],
    }));
    expect(out.quarters.map((q) => [q.role_key, q.minutes, q.rate_cents, q.rate_basis, q.quarter_start_at])).toEqual([
      ["31", 5, 1800, "known", et("2026-10-05", "10:00")],
      ["32", 10, 2400, "known", et("2026-10-05", "10:00")],
    ]);
    expect(out.quarters.every((q) => q.person_key === "ss:7" && q.source === "7shifts" && q.wall_quarter === 40 && q.fold === 0)).toBe(true);
  });
  it("the same role switch before the first known wage: each role carries its own first wage back", () => {
    const out = buildLaborWeek(src({
      punches: [punch("7", "501", "31", "2026-10-05", "10:00", "10:05"), punch("7", "501", "32", "2026-10-05", "10:05", "10:15")],
      wages: [wage("7", 1900, { role_id: "31", effective_date: "2026-11-01" }), wage("7", 2500, { role_id: "32", effective_date: "2026-12-01" })],
    }));
    expect(out.quarters.map((q) => [q.role_key, q.rate_basis, q.rate_cents, q.carry_back_rate_cents])).toEqual([
      ["31", "before_first_known", null, 1900], ["32", "before_first_known", null, 2500]]);
  });
  it("an overtime boundary at 10:07 lands per minute: A has 0 overtime minutes, B has 8", () => {
    // 2393 minutes earlier in the week, then 10:00-10:05 A and 10:05-10:15 B on Saturday.
    const before = ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"].map((d, i) => punch("7", "501", "31", d, "08:00", i === 3 ? "17:59" : "17:58"));
    const out = buildLaborWeek(src({
      punches: [...before, punch("7", "501", "31", "2026-10-10", "10:00", "10:05"), punch("7", "501", "32", "2026-10-10", "10:05", "10:15")],
      wages: [wage("7", 1800)],
    }));
    expect(totals(out.quarters.filter((q) => q.business_date < "2026-10-10"))).toEqual({ m: 2393, ot: 0 });
    const sat = out.quarters.filter((q) => q.business_date === "2026-10-10");
    expect(sat.map((q) => [q.role_key, q.minutes, q.ot_minutes])).toEqual([["31", 5, 0], ["32", 10, 8]]);
  });
});

describe("company-wide overtime (P1 #4)", () => {
  it("one person with an account at each shop is one person: 30 h at A then 15 h at B = 5 h overtime at B", () => {
    const out = buildLaborWeek(src({
      userLinks: [{ sevenshifts_user_id: "7", user_id: ALICE, linked_at_location_id: A }, { sevenshifts_user_id: "8", user_id: ALICE, linked_at_location_id: B }],
      punches: [punch("7", "501", null, "2026-10-05", "06:00", "21:00"), punch("7", "501", null, "2026-10-06", "06:00", "21:00"),
        punch("8", "502", null, "2026-10-08", "06:00", "21:00")],
      wages: [wage("7", 2000), wage("8", 2200)],
    }));
    expect(totals(out.quarters.filter((q) => q.location_id === A))).toEqual({ m: 1800, ot: 0 });
    expect(totals(out.quarters.filter((q) => q.location_id === B))).toEqual({ m: 900, ot: 300 });
    expect(new Set(out.quarters.map((q) => q.person_key))).toEqual(new Set([`u:${ALICE}`]));
    expect(out.quarters.filter((q) => q.location_id === B).every((q) => q.rate_cents === 2200 && q.user_id === ALICE)).toBe(true);
    expect(out.week).toMatchObject({ ot_state: "assessed", ot_identity_partial: 0 });
  });
  it("two unlinked accounts are never combined (never by name): identity partial, counted", () => {
    const out = buildLaborWeek(src({
      punches: [punch("7", "501", null, "2026-10-05", "06:00", "21:00"), punch("8", "502", null, "2026-10-08", "06:00", "21:00")],
      wages: [wage("7", 2000), wage("8", 2200)],
    }));
    expect(totals(out.quarters)).toEqual({ m: 1800, ot: 0 });
    expect(out.week.ot_identity_partial).toBe(2);
  });
  it("salaried minutes are stored as presence, never priced and never overtime", () => {
    const out = buildLaborWeek(src({
      punches: [1, 2, 3, 4, 5].map((i) => punch("9", "501", null, `2026-10-0${4 + i}`, "06:00", "17:00")),
      wages: [wage("9", 150000, { wage_type: "weekly_salary" })],
    }));
    expect(totals(out.quarters)).toEqual({ m: 3300, ot: 0 });
    expect(out.quarters.every((q) => q.pay_class === "salaried" && q.rate_cents === null && q.carry_back_rate_cents === null)).toBe(true);
  });
  it("7shifts daily / premium thresholds set: an advisory, not a refusal (Juan's rule is the rule)", () => {
    const out = buildLaborWeek(src({ laborSettings: [{ daily_ot_threshold: 8, premium_ot_threshold: null, consecutive_days_threshold: null }] }));
    expect(out.week).toMatchObject({ ot_settings_disagree: true, ot_threshold_minutes: 2400, ot_multiplier: 1.5 });
  });
});

describe("coverage first (P1 #3)", () => {
  it("covered / pending_settle / incomplete -> Toast fallback / incomplete, one source per shop-day", () => {
    const frame = [
      ...days(A).map((d) => d.business_date === "2026-10-06" ? { ...d, evidence_run_id: null } // settled, no evidence -> incomplete
        : d.business_date === "2026-10-07" ? { ...d, evidence_run_id: null, settled: false } : d),
      ...days(B, { linked: false, evidence_run_id: null }),
    ];
    const out = buildLaborWeek(src({
      days: frame,
      punches: [punch("7", "501", null, "2026-10-05", "10:00", "11:00"), punch("7", "501", null, "2026-10-06", "10:00", "11:00"),
        punch("7", "501", null, "2026-10-07", "10:00", "11:00")],
      toastEntries: [
        { location_id: A, time_entry_guid: "t1", employee_guid: "g1", user_id: null, in_at: et("2026-10-06", "10:00"), out_at: et("2026-10-06", "12:00"), deleted: false },
        { location_id: B, time_entry_guid: "t2", employee_guid: "g2", user_id: null, in_at: et("2026-10-08", "10:00"), out_at: et("2026-10-08", "11:00"), deleted: false },
      ],
      wages: [wage("7", 2000)],
    }));
    const day = (loc: string, d: string) => out.days.find((x) => x.location_id === loc && x.business_date === d)!;
    expect(day(A, "2026-10-05")).toMatchObject({ state: "covered", source: "7shifts", ss_minutes: 60, toast_minutes: 0 });
    expect(day(A, "2026-10-06")).toMatchObject({ state: "fallback_unverified", source: "toast", ss_minutes: 60, toast_minutes: 120, evidence_run_id: null });
    expect(day(A, "2026-10-07")).toMatchObject({ state: "pending_settle", source: "7shifts" });
    expect(day(A, "2026-10-09")).toMatchObject({ state: "covered", ss_minutes: 0 });
    expect(day(B, "2026-10-08")).toMatchObject({ state: "fallback_unverified", source: "toast", toast_minutes: 60 });
    expect(day(B, "2026-10-09")).toMatchObject({ state: "incomplete", source: null });
    // Toast replaces 7shifts on the fallback day: 120 minutes, never 60 + 120.
    expect(totals(out.quarters.filter((q) => q.business_date === "2026-10-06"))).toEqual({ m: 120, ot: 0 });
    expect(out.quarters.filter((q) => q.business_date === "2026-10-06").every((q) => q.source === "toast" && q.person_key === "toast:g1" && q.rate_basis === "none")).toBe(true);
    expect(out.week.ot_state).toBe("lower_bound");
  });
  it("a linked Toast employee is the same person and prices from their 7shifts account at that shop", () => {
    const frame = days(A).map((d) => ({ ...d, evidence_run_id: null }));
    const out = buildLaborWeek(src({
      days: frame,
      userLinks: [{ sevenshifts_user_id: "7", user_id: ALICE, linked_at_location_id: A }],
      toastLinks: [{ location_id: A, employee_guid: "g1", user_id: ALICE }],
      toastEntries: [{ location_id: A, time_entry_guid: "t1", employee_guid: "g1", user_id: null, in_at: et("2026-10-06", "10:00"), out_at: et("2026-10-06", "11:00"), deleted: false }],
      wages: [wage("7", 2100)],
    }));
    expect(out.quarters.map((q) => [q.person_key, q.rate_cents, q.role_key])).toEqual(Array(4).fill([`u:${ALICE}`, 2100, "0"]));
  });
  it("open punches carry no minutes and are counted; deleted punches and unlinked 7shifts locations are ignored", () => {
    const out = buildLaborWeek(src({
      punches: [punch("7", "501", null, "2026-10-05", "10:00", null), { ...punch("7", "501", null, "2026-10-05", "12:00", "13:00"), deleted: true },
        punch("7", "999", null, "2026-10-05", "12:00", "13:00")],
    }));
    expect(out.quarters).toEqual([]);
    expect(out.days.find((d) => d.location_id === A && d.business_date === "2026-10-05")).toMatchObject({ open_punches: 1, ss_minutes: 0 });
  });
  it("fix r1 P1: an open punch on a settled, evidenced week leaves overtime a LOWER BOUND (its hours are unknown), never assessed", () => {
    const out = buildLaborWeek(src({ punches: [punch("7", "501", null, "2026-10-05", "10:00", null), punch("7", "501", null, "2026-10-06", "10:00", "11:00")],
      wages: [wage("7", 2000)] }));
    expect(out.days.every((d) => d.state === "covered")).toBe(true);
    expect(out.week.ot_state).toBe("lower_bound");
    expect(buildLaborWeek(src({ punches: [punch("7", "501", null, "2026-10-06", "10:00", "11:00")], wages: [wage("7", 2000)] })).week.ot_state).toBe("assessed");
  });
  it("fix r1 P1: a day counts the open punches of ITS source only (a Toast open entry on a 7shifts-covered day leaves its hours known)", () => {
    const out = buildLaborWeek(src({
      toastEntries: [{ location_id: A, time_entry_guid: "t1", employee_guid: "e1", user_id: null, in_at: et("2026-10-05", "10:00"), out_at: null, deleted: false }],
    }));
    expect(out.days.find((d) => d.location_id === A && d.business_date === "2026-10-05")).toMatchObject({ source: "7shifts", open_punches: 0 });
    expect(out.week.ot_state).toBe("assessed");
    const fb = buildLaborWeek(src({ days: [...days(A, { linked: false, evidence_run_id: null }), ...days(B)],
      toastEntries: [{ location_id: A, time_entry_guid: "t1", employee_guid: "e1", user_id: null, in_at: et("2026-10-05", "10:00"), out_at: null, deleted: false },
        { location_id: A, time_entry_guid: "t2", employee_guid: "e2", user_id: null, in_at: et("2026-10-05", "11:00"), out_at: et("2026-10-05", "12:00"), deleted: false }] }));
    expect(fb.days.find((d) => d.location_id === A && d.business_date === "2026-10-05")).toMatchObject({ source: "toast", open_punches: 1 });
  });
  it("a break is unpaid: its minutes come out of the middle of the punch", () => {
    const out = buildLaborWeek(src({ punches: [punch("7", "501", null, "2026-10-05", "10:00", "11:00", 30)], wages: [wage("7", 2000)] }));
    expect(out.quarters.map((q) => [q.wall_quarter, q.minutes])).toEqual([[40, 15], [43, 15]]);
  });
});

describe("weeks and time", () => {
  it("the floor week builds nothing before 2026-07-23 and its overtime is a lower bound", () => {
    const out = buildLaborWeek(src({
      weekStart: "2026-07-19", builtThrough: "2026-07-25",
      days: [{ location_id: A, business_date: "2026-07-23", linked: true, evidence_run_id: "11111111-1111-4111-8111-111111111111", settled: true }],
      punches: [punch("7", "501", null, "2026-07-21", "10:00", "11:00"), punch("7", "501", null, "2026-07-23", "10:00", "11:00")],
      wages: [wage("7", 2000)],
    }));
    expect(out.quarters.map((q) => q.business_date)).toEqual(Array(4).fill("2026-07-23"));
    expect(out.week.ot_state).toBe("lower_bound");
  });
  it("the current week is built through yesterday as week_open; nothing on or after the built-through day + 1", () => {
    const out = buildLaborWeek(src({
      builtThrough: "2026-10-06", days: days(A).slice(0, 3),
      punches: [punch("7", "501", null, "2026-10-06", "10:00", "11:00"), punch("7", "501", null, "2026-10-07", "10:00", "11:00")],
      wages: [wage("7", 2000)],
    }));
    expect(new Set(out.quarters.map((q) => q.business_date))).toEqual(new Set(["2026-10-06"]));
    expect(out.week).toMatchObject({ ot_state: "week_open", built_through: "2026-10-06" });
  });
  it("a Saturday close past midnight splits at Sunday 00:00 ET: the next week's minutes are not this week's", () => {
    const out = buildLaborWeek(src({ punches: [punch("7", "501", null, "2026-10-10", "23:00", "01:00", 0, "2026-10-11")], wages: [wage("7", 2000)] }));
    expect(totals(out.quarters)).toEqual({ m: 60, ot: 0 });
  });
  it("DST fall back: 00:30-02:30 on 2026-11-01 is 180 minutes, the repeated hour folds", () => {
    const frame = Array.from({ length: 7 }, (_, i) => ({ location_id: A, business_date: `2026-11-0${1 + i}`, linked: true,
      evidence_run_id: "11111111-1111-4111-8111-111111111111", settled: true }));
    const out = buildLaborWeek(src({ weekStart: "2026-11-01", builtThrough: "2026-11-07", days: frame,
      punches: [{ id: "x", user_id: "7", location_id: "501", role_id: null, clocked_in: "2026-11-01T04:30:00Z", clocked_out: "2026-11-01T07:30:00Z", break_minutes: 0, deleted: false }],
      wages: [wage("7", 2000)] }));
    expect(totals(out.quarters)).toEqual({ m: 180, ot: 0 });
    expect(out.quarters.filter((q) => q.fold === 1).map((q) => q.wall_quarter)).toEqual([4, 5, 6, 7]);
  });
  it("is deterministic and order-invariant", () => {
    const s = src({
      userLinks: [{ sevenshifts_user_id: "7", user_id: ALICE, linked_at_location_id: A }],
      punches: [punch("7", "501", "31", "2026-10-05", "06:00", "21:00"), punch("7", "501", "32", "2026-10-06", "06:00", "21:00"),
        punch("7", "501", "31", "2026-10-07", "06:00", "21:00"), punch("8", "502", null, "2026-10-08", "06:00", "09:00")],
      wages: [wage("7", 2000, { role_id: "31" }), wage("7", 2300), wage("8", 1900)],
    });
    const rev = { ...s, punches: [...s.punches].reverse(), wages: [...s.wages].reverse(), days: [...s.days].reverse() };
    expect(buildLaborWeek(rev)).toEqual(buildLaborWeek(s));
  });
});

describe("salaried weekly cost from wages (estimate_first reads it only when the shop estimate is blank)", () => {
  it("weekly and annual salaries per shop; one 7shifts account linked at both shops is split equally", () => {
    const out = buildLaborWeek(src({
      userLinks: [{ sevenshifts_user_id: "9", user_id: ALICE, linked_at_location_id: A }, { sevenshifts_user_id: "9", user_id: ALICE, linked_at_location_id: B },
        { sevenshifts_user_id: "10", user_id: B, linked_at_location_id: B }, { sevenshifts_user_id: "11", user_id: A, linked_at_location_id: A }],
      wages: [wage("9", 200000, { wage_type: "weekly_salary" }), wage("10", 5200000, { wage_type: "annual_salary" }), wage("11", 2000)],
    }));
    expect(out.salaried).toEqual([
      { location_id: A, salaried_cents: 100000, salaried_people: 1 },
      { location_id: B, salaried_cents: 200000, salaried_people: 2 },
    ]);
  });
  it("a linked shop with no salaried wage reports none (null), never 0", () => {
    expect(buildLaborWeek(src()).salaried).toEqual([
      { location_id: A, salaried_cents: null, salaried_people: 0 }, { location_id: B, salaried_cents: null, salaried_people: 0 }]);
  });
});
