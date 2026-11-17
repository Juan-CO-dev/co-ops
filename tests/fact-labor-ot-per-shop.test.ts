// Juan 2026-11-17: the two shops are SEPARATE employers (separate LLCs) and the payroll week turns over at
// calendar MIDNIGHT Saturday -> Sunday, ET. Overtime = hours past 40 in a Sunday-Saturday week, counted
// PER SHOP: a person working at both shops gets overtime only from hours past 40 within ONE shop. The scope
// is an explicit build-time constant (LABOR_OT_SCOPE, `per_shop`); `company` stays available for a future
// multi-shop employer. Pure builder only (no I/O); the SQL side is tests/fact-labor-0339-migration.test.ts.
import { describe, expect, it } from "vitest";
import { buildLaborWeek, type LaborWeekSource, type FrameDay } from "@/lib/facts/labor-week-shared";
import type { WageVersion } from "@/lib/facts/labor-wages-shared";
import { LABOR_BUILDER_VERSION, LABOR_OT_SCOPE } from "@/lib/facts/labor-config-shared";

const A = "00000000-0000-4000-8000-00000000000a", B = "00000000-0000-4000-8000-00000000000b";
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const EV = "11111111-1111-4111-8111-111111111111";

const addDays = (ymd: string, n: number) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const frame = (loc: string, week: string): FrameDay[] =>
  Array.from({ length: 7 }, (_, i) => ({ location_id: loc, business_date: addDays(week, i), linked: true, evidence_run_id: EV, settled: true }));
let pid = 1;
/** A punch by explicit instants (ISO with offset), so DST weeks say exactly which wall time they mean. */
const punchAt = (user: string, loc7: string, inIso: string, outIso: string) => ({
  id: String(pid++), user_id: user, location_id: loc7, role_id: null, clocked_in: new Date(inIso).toISOString(),
  clocked_out: new Date(outIso).toISOString(), break_minutes: 0, deleted: false });
/** October 2026 is EDT (UTC-4). */
const edt = (date: string, hhmm: string) => `${date}T${hhmm}:00-04:00`;
const wage = (user: string, cents: number): WageVersion => ({ user_id: user, wage_id: String(pid++), upcoming: false,
  effective_date: "2026-01-01", wage_type: "hourly", wage_cents: cents, role_id: null, active: true, seq: pid++ });

const BOTH_SHOPS = [{ sevenshifts_user_id: "7", user_id: ALICE, linked_at_location_id: A }, { sevenshifts_user_id: "8", user_id: ALICE, linked_at_location_id: B }];
function src(week: string, o: Partial<LaborWeekSource> = {}): LaborWeekSource {
  return {
    weekStart: week, builtThrough: addDays(week, 6), floorDay: "2026-07-23",
    days: [...frame(A, week), ...frame(B, week)],
    locationLinks: [{ location_id: A, sevenshifts_location_id: "501" }, { location_id: B, sevenshifts_location_id: "502" }],
    userLinks: BOTH_SHOPS, toastLinks: [], punches: [], toastEntries: [], wages: [wage("7", 2000), wage("8", 2200)], laborSettings: [], ...o,
  };
}
const sum = (rows: { minutes: number; ot_minutes: number }[]) => rows.reduce((s, r) => ({ m: s.m + r.minutes, ot: s.ot + r.ot_minutes }), { m: 0, ot: 0 });
const at = (out: ReturnType<typeof buildLaborWeek>, loc: string) => sum(out.quarters.filter((q) => q.location_id === loc));

const OCT = "2026-10-04"; // Sunday
// 30 h at A (Mon, Tue 06:00-21:00), 20 h at B (Thu 06:00-21:00, Fri 06:00-11:00).
const A30 = [punchAt("7", "501", edt("2026-10-05", "06:00"), edt("2026-10-05", "21:00")), punchAt("7", "501", edt("2026-10-06", "06:00"), edt("2026-10-06", "21:00"))];
const B20 = [punchAt("8", "502", edt("2026-10-08", "06:00"), edt("2026-10-08", "21:00")), punchAt("8", "502", edt("2026-10-09", "06:00"), edt("2026-10-09", "11:00"))];
const A45 = [...A30, punchAt("7", "501", edt("2026-10-07", "06:00"), edt("2026-10-07", "21:00"))];

describe("the scope is an explicit constant, per_shop ships, and the builder version moved", () => {
  it("LABOR_OT_SCOPE is per_shop and the week row records the scope it was built with", () => {
    expect(LABOR_OT_SCOPE).toBe("per_shop");
    expect(buildLaborWeek(src(OCT)).week.ot_scope).toBe("per_shop");
    expect(buildLaborWeek(src(OCT), { otScope: "company" }).week.ot_scope).toBe("company");
  });
  it("LABOR_BUILDER_VERSION is no longer labor-v1, so every week built company-wide is rebuilt", () => {
    expect(LABOR_BUILDER_VERSION).toMatch(/^labor-v[0-9]+$/);
    expect(LABOR_BUILDER_VERSION).not.toBe("labor-v1");
  });
});

describe("per employer overtime (Juan 2026-11-17: separate LLCs)", () => {
  it("30 h at shop A + 20 h at shop B in one week = 0 overtime anywhere", () => {
    const out = buildLaborWeek(src(OCT, { punches: [...A30, ...B20] }));
    expect(at(out, A)).toEqual({ m: 1800, ot: 0 });
    expect(at(out, B)).toEqual({ m: 1200, ot: 0 });
    expect(out.week).toMatchObject({ ot_state: "assessed", ot_scope: "per_shop" });
  });
  it("45 h at shop A = 5 h overtime at A, and they are the LAST 300 minutes in instant order (Wednesday 16:00-21:00)", () => {
    const out = buildLaborWeek(src(OCT, { punches: A45 }));
    expect(at(out, A)).toEqual({ m: 2700, ot: 300 });
    const ot = out.quarters.filter((q) => q.ot_minutes > 0);
    expect(new Set(ot.map((q) => q.business_date))).toEqual(new Set(["2026-10-07"]));
    expect(ot.map((q) => q.quarter_start_at).sort()[0]).toBe(new Date(edt("2026-10-07", "16:00")).toISOString());
  });
  it("45 h at A + 20 h at B = 5 h overtime at A and none at B (B's own week is 20 h)", () => {
    const out = buildLaborWeek(src(OCT, { punches: [...A45, ...B20] }));
    expect(at(out, A)).toEqual({ m: 2700, ot: 300 });
    expect(at(out, B)).toEqual({ m: 1200, ot: 0 });
  });
  it("the same person is still ONE person (u:<id>) at both shops: per shop is a counter scope, never an identity split", () => {
    const out = buildLaborWeek(src(OCT, { punches: [...A30, ...B20] }));
    expect(new Set(out.quarters.map((q) => q.person_key))).toEqual(new Set([`u:${ALICE}`]));
    expect(out.week.ot_identity_partial).toBe(0);
  });
  it("a Toast-fallback day and a 7shifts day at the SAME shop share that shop's counter", () => {
    const days = [...frame(A, OCT).map((d) => d.business_date === "2026-10-07" ? { ...d, linked: false, evidence_run_id: null } : d), ...frame(B, OCT)];
    const out = buildLaborWeek(src(OCT, { days, punches: A30,
      toastLinks: [{ location_id: A, employee_guid: "g-1", user_id: ALICE }],
      toastEntries: [{ location_id: A, time_entry_guid: "t-1", employee_guid: "g-1", user_id: null, in_at: edt("2026-10-07", "06:00"), out_at: edt("2026-10-07", "21:00"), deleted: false }] }));
    expect(at(out, A)).toEqual({ m: 2700, ot: 300 });
  });
  it("company scope (a future multi-shop employer) still counts both shops together: 30 h A + 20 h B = 10 h overtime, at B", () => {
    const out = buildLaborWeek(src(OCT, { punches: [...A30, ...B20] }), { otScope: "company" });
    expect(at(out, A)).toEqual({ m: 1800, ot: 0 });
    expect(at(out, B)).toEqual({ m: 1200, ot: 600 });
  });
});

describe("the payroll week turns over at calendar midnight Saturday -> Sunday ET", () => {
  const NEXT = "2026-10-11";
  // 40 h at A Monday-Thursday (06:00-16:00), then a Saturday close that runs past midnight.
  const A40 = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"].map((d) => punchAt("7", "501", edt(d, "06:00"), edt(d, "16:00")));
  const close = punchAt("7", "501", edt("2026-10-10", "23:00"), edt("2026-10-11", "01:00"));
  it("Saturday 23:59 is this week (overtime after 40 h); Sunday 00:00 is the next week, whose counter starts at 0", () => {
    const thisWeek = buildLaborWeek(src(OCT, { punches: [...A40, close] }));
    const sat = thisWeek.quarters.filter((q) => q.business_date === "2026-10-10");
    expect(sum(sat)).toEqual({ m: 60, ot: 60 });
    const last = sat.find((q) => q.quarter_start_at === new Date(edt("2026-10-10", "23:45")).toISOString());
    expect(last).toMatchObject({ minutes: 15, ot_minutes: 15 }); // 23:45-23:59 is the week's last quarter
    expect(thisWeek.quarters.some((q) => q.business_date > "2026-10-10")).toBe(false);
    // The next week's source reads the same punch (it intersects the week): only Sunday's 60 minutes, no overtime.
    const nextWeek = buildLaborWeek(src(NEXT, { punches: [close] }));
    expect(sum(nextWeek.quarters)).toEqual({ m: 60, ot: 0 });
    expect(nextWeek.quarters.map((q) => q.business_date)).toEqual(Array(4).fill("2026-10-11"));
    expect(nextWeek.quarters[0]!.quarter_start_at).toBe(new Date(edt("2026-10-11", "00:00")).toISOString());
  });
  it("a minute is filed by its ET calendar date, never a business day: a 00:30 Sunday minute is never Saturday's", () => {
    const p = punchAt("7", "501", edt("2026-10-10", "23:59"), edt("2026-10-11", "00:01"));
    expect(sum(buildLaborWeek(src(OCT, { punches: [p] })).quarters)).toEqual({ m: 1, ot: 0 });
    expect(sum(buildLaborWeek(src(NEXT, { punches: [p] })).quarters)).toEqual({ m: 1, ot: 0 });
  });
});

describe("DST weeks: the boundary is wall-clock midnight and overtime counts REAL minutes", () => {
  it("spring forward (week of Sun 2027-03-14; history starts 2026-07-23): Sat 22:00 EST -> Sun 04:00 EDT gives 2 h to the old week and 3 real h to the new one", () => {
    const W = "2027-03-14", PREV = "2027-03-07";
    const p = punchAt("7", "501", "2027-03-13T22:00:00-05:00", "2027-03-14T04:00:00-04:00");
    expect(sum(buildLaborWeek(src(PREV, { punches: [p] })).quarters)).toEqual({ m: 120, ot: 0 });
    const next = buildLaborWeek(src(W, { punches: [p] }));
    expect(sum(next.quarters)).toEqual({ m: 180, ot: 0 });
    expect(next.quarters[0]!.quarter_start_at).toBe("2027-03-14T05:00:00.000Z"); // 00:00 EST
    // 3 h Sunday + 38 h (Mon-Thu 06:00-15:30 EDT) = 41 real hours at A: 60 overtime minutes, Thursday's last hour.
    const week = ["2027-03-15", "2027-03-16", "2027-03-17", "2027-03-18"].map((d) => punchAt("7", "501", `${d}T06:00:00-04:00`, `${d}T15:30:00-04:00`));
    const out = buildLaborWeek(src(W, { punches: [p, ...week] }));
    expect(at(out, A)).toEqual({ m: 2460, ot: 60 });
    expect(new Set(out.quarters.filter((q) => q.ot_minutes > 0).map((q) => q.business_date))).toEqual(new Set(["2027-03-18"]));
  });
  it("fall back (week of Sun 2026-11-01): the week starts 00:00 EDT; Sun 00:00 EDT -> 10:00 EST is 11 real h, and 30 h more at A is 1 h overtime", () => {
    const W = "2026-11-01";
    const sun = punchAt("7", "501", "2026-11-01T00:00:00-04:00", "2026-11-01T10:00:00-05:00");
    const week = ["2026-11-02", "2026-11-03", "2026-11-04"].map((d) => punchAt("7", "501", `${d}T06:00:00-05:00`, `${d}T16:00:00-05:00`));
    const out = buildLaborWeek(src(W, { punches: [sun, ...week] }));
    expect(at(out, A)).toEqual({ m: 2460, ot: 60 });
    expect(out.quarters[0]!.quarter_start_at).toBe("2026-11-01T04:00:00.000Z");
    // The Saturday-night close before it: 23:00 EDT Sat -> 00:30 EDT Sun = 60 min old week, 30 min new week.
    const close = punchAt("7", "501", "2026-10-31T23:00:00-04:00", "2026-11-01T00:30:00-04:00");
    expect(sum(buildLaborWeek(src("2026-10-25", { punches: [close] })).quarters)).toEqual({ m: 60, ot: 0 });
    expect(sum(buildLaborWeek(src(W, { punches: [close] })).quarters)).toEqual({ m: 30, ot: 0 });
  });
  it("per shop holds across a DST week too: 30 h at A + 11 h at B (incl. the fall-back hour) = 0 overtime", () => {
    const W = "2026-11-01";
    const bSun = punchAt("8", "502", "2026-11-01T00:00:00-04:00", "2026-11-01T10:00:00-05:00");
    const a = ["2026-11-02", "2026-11-03", "2026-11-04"].map((d) => punchAt("7", "501", `${d}T06:00:00-05:00`, `${d}T16:00:00-05:00`));
    const out = buildLaborWeek(src(W, { punches: [bSun, ...a] }));
    expect(at(out, A)).toEqual({ m: 1800, ot: 0 });
    expect(at(out, B)).toEqual({ m: 660, ot: 0 });
  });
});
