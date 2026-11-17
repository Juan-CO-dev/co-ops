// Item 2 PR 2c: the 0338 READ side, offline (PGlite, synthetic fixtures). A built week (real reconciler,
// real builder, real writer), then fact_labor_cost (components only) through the pure two-view pricer,
// the burden setting and its one writer, and SPLH summed per quarter before the sales join.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { buildLaborWeek, laborWeekSourceFromJson } from "@/lib/facts/labor-week-shared";
import { LABOR_BUILDER_VERSION } from "@/lib/facts/labor-config-shared";
import { laborWeekViews, toLaborCostRow, type LaborCostRow } from "@/lib/facts/labor-cost-shared";
import { M0338, freshLaborParents } from "./helpers/fact-0338-parents";

let db: PGlite;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
async function refuses(p: Promise<unknown>, code: string) {
  try { await expect(p).rejects.toThrow(code); }
  finally { if (db.isInTransaction()) await db.exec("rollback"); }
}
const A = "00000000-0000-4000-8000-0000000000aa", B = "00000000-0000-4000-8000-0000000000bb";
const MGR = "00000000-0000-4000-8000-0000000000f1", ALICE = "00000000-0000-4000-8000-0000000000f2", GM = "00000000-0000-4000-8000-0000000000f3";
const WEEK = "2026-10-04";
const etIso = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-04:00`).toISOString();
let pid = 9000;
const punch = (user: number, loc7: number, date: string, from: string, to: string) =>
  q("insert into sevenshifts_time_punches(id, user_id, location_id, clocked_in, clocked_out, break_minutes) values($1,$2,$3,$4,$5,0)",
    [++pid, user, loc7, etIso(date, from), etIso(date, to)]);
async function wage(user: number, cents: number, effective = "2026-01-01") {
  const run = randomUUID();
  await q("insert into sevenshifts_sync_run_ids(id, trigger) values($1, 'cron')", [run]);
  await q("select reconcile_sevenshifts_user_snapshot($1, $2, 'wages', true, $3::jsonb)", [run, user,
    JSON.stringify([{ user_id: String(user), wage_id: String(user * 10), upcoming: false, effective_date: effective, wage_type: "hourly", wage_cents: cents, role_id: null }])]);
}
async function build(week: string) {
  const j = (await q<{ s: Record<string, unknown> }>("select fact_labor_week_source($1, $2) s", [week, LABOR_BUILDER_VERSION]))[0]!.s;
  const { source, fingerprint } = laborWeekSourceFromJson(j);
  const p = buildLaborWeek(source);
  await q("select fact_replace_labor_week($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb)", [week, LABOR_BUILDER_VERSION, fingerprint,
    JSON.stringify(p.quarters), JSON.stringify(p.days), JSON.stringify(p.week), JSON.stringify(p.salaried)]);
}
const cost = async (loc: string | null, from = WEEK, to = "2026-10-10", fallback = "first_known") =>
  q<LaborCostRow>("select * from fact_labor_cost($1, $2, $3, $4)", [loc, from, to, fallback]);

beforeAll(async () => {
  db = await freshLaborParents();
  await db.exec(M0338);
  await q("insert into locations(id) values($1),($2)", [A, B]);
  await q("insert into users(id, role) values($1,'moo'),($2,'employee'),($3,'gm')", [MGR, ALICE, GM]);
  await q("insert into sevenshifts_location_links(location_id, sevenshifts_location_id, linked_by) values($1, 501, $3), ($2, 502, $3)", [A, B, MGR]);
  await q("insert into sevenshifts_user_links(sevenshifts_user_id, user_id, linked_at_location_id, linked_by) values(7, $1, $2, $4), (8, $1, $3, $4)", [ALICE, A, B, MGR]);
  const run = randomUUID();
  await q("insert into sevenshifts_sync_run_ids(id, trigger, started_at) values($1, 'cron', '2026-10-20T12:00:00Z')", [run]);
  await q("insert into sevenshifts_sync_runs(id, trigger, started_at, finished_at, status, requests, results) values($1,'cron','2026-10-20T12:00:00Z','2026-10-20T12:00:00Z','ok',1,$2::jsonb)",
    [run, JSON.stringify({ time_punches: { rows: 1, skipped: 0, pages: 1, error_code: null } })]);
  await wage(7, 2000); await wage(8, 2200); await wage(10, 2500, "2026-11-01");
  await punch(7, 501, "2026-10-05", "06:00", "21:00");
  await punch(7, 501, "2026-10-06", "06:00", "21:00");
  await punch(8, 502, "2026-10-08", "06:00", "21:00");
  await punch(9, 501, "2026-10-05", "10:00", "11:00"); // no wage at all
  await punch(10, 501, "2026-10-05", "10:00", "11:00"); // before the first known wage
  await build(WEEK);
}, 180_000);

describe("C. cost components (0338 fact_labor_cost)", () => {
  it("straight time per row, the blended-rate overtime premium where the overtime fell, the estimate where no wage is known", async () => {
    const [a] = await cost(A), [b] = await cost(B);
    // A: 1800 min x $20 + 60 x $18.40 (no wage) + 60 x $25 (first known, carried back)
    expect(a).toMatchObject({ hourly_straight_cents: 60000 + 1840 + 2500, ot_premium_cents: 0, estimated_rate_minutes: 60, hourly_minutes: 1920,
      ot_state: "assessed", days_covered: 7, days_missing: 0, burden_pct: "12.00", burden_basis: "estimated", salary_basis: "unknown", salaried_cents: null });
    // B: 900 x $22; premium 0.5 x blended (1800x2000 + 900x2200)/2700 x 300 min / 60
    expect(b).toMatchObject({ hourly_straight_cents: 33000, ot_premium_cents: Math.round((0.5 * (1800 * 2000 + 900 * 2200) / 2700 * 300) / 60), ot_minutes: 300 });
  });
  it("Q5 = dc_minimum prices the before-first-known minutes at the shop estimate instead; a shop estimate edit re-prices with no rebuild", async () => {
    expect((await cost(A, WEEK, "2026-10-10", "dc_minimum"))[0]).toMatchObject({ hourly_straight_cents: 60000 + 1840 + 1840, estimated_rate_minutes: 120 });
    await q("insert into schedule_shop_settings(location_id, estimated_hourly_cents, estimated_salaried_weekly_cents, updated_by) values($1, 2000, 140000, $2)", [A, MGR]);
    const [a] = await cost(A);
    expect(a).toMatchObject({ hourly_straight_cents: 60000 + 2000 + 2500, salaried_cents: 140000, salary_basis: "estimate" });
    expect((await cost(A, WEEK, "2026-10-06"))[0]).toMatchObject({ salaried_cents: 60000, range_days: 3 });
  });
  it("every shop at once returns one row per shop and week; the pricer sums the two views", async () => {
    const rows = await cost(null);
    expect(rows.map((r) => r.location_id)).toEqual([A, B]);
    const [v] = laborWeekViews(rows.map((r) => toLaborCostRow(r as unknown as Record<string, unknown>)));
    expect(v).toMatchObject({ salaryUnknown: true, fullyLoadedCents: null, pureHourlyCents: rows.reduce((s, r) => s + Number(r.hourly_straight_cents) + Number(r.ot_premium_cents), 0) });
    expect(v!.weekStart).toBe(WEEK);
  });
  it("a week never built reads unbuilt with every day missing: coverage first, never zero", async () => {
    expect((await cost(A, "2026-09-27", "2026-10-03"))[0]).toMatchObject({ ot_state: "unbuilt", days_missing: 7, days_covered: 0 });
  });
  it("refuses a window before the history floor, wider than 366 days, or an unknown fallback", async () => {
    await refuses(cost(A, "2026-07-01", "2026-07-30"), "fact_invalid_request");
    await refuses(cost(A, "2026-08-01", "2027-09-01"), "fact_invalid_request");
    await refuses(cost(A, WEEK, "2026-10-10", "average"), "fact_invalid_request");
  });
});

describe("C. the burden setting", () => {
  it("default 12% estimated; a backdated company payroll row re-prices history; a shop row beats it", async () => {
    await q("select save_labor_burden($1, null, 10, '2026-07-19', 'payroll', 'payroll register')", [MGR]);
    expect((await cost(A))[0]).toMatchObject({ burden_pct: "10.00", burden_basis: "payroll" });
    await q("select save_labor_burden($1, $2, 15.5, '2026-07-19', 'estimated', null)", [MGR, B]);
    expect((await cost(B))[0]).toMatchObject({ burden_pct: "15.50", burden_basis: "estimated" });
    expect((await cost(A))[0]).toMatchObject({ burden_pct: "10.00" });
    await q("select save_labor_burden($1, null, 11, '2026-10-11', 'payroll', null)", [MGR]);
    expect((await cost(A))[0]).toMatchObject({ burden_pct: "10.00" }); // a later valid_from does not reach this week
  });
  it("only Owner / CGS / MoO write it, inside 0-50", async () => {
    await refuses(q("select save_labor_burden($1, null, 10, '2026-07-19', 'payroll', null)", [GM]), "labor_burden_forbidden");
    await refuses(q("select save_labor_burden($1, null, 51, '2026-07-19', 'payroll', null)", [MGR]), "labor_burden_invalid");
    await refuses(q("select save_labor_burden($1, null, 10, '2026-07-19', 'guess', null)", [MGR]), "labor_burden_invalid");
    for (const p of ["INSERT", "UPDATE", "DELETE"]) {
      expect((await q<{ x: boolean }>(`select has_table_privilege('service_role', 'public.labor_burden_settings', '${p}') x`))[0]!.x).toBe(false);
    }
  });
});

describe("C. SPLH inputs (labor summed per quarter before the sales join)", () => {
  it("a quarter with two people carries its sales once; placed and promised clocks both work", async () => {
    const snap = randomUUID();
    await q("insert into fact_order_snapshot(location_id, business_date, order_guid, snapshot_id, run_member, check_count) values($1,'2026-10-05','o1',$2,true,1)", [A, snap]);
    await q(`insert into fact_order_check(location_id, business_date, order_guid, check_guid, snapshot_id, opened_at, opened_quarter_start_at, opened_wall_quarter, opened_fold, opened_et_date,
      promised_quarter_start_at, promised_wall_quarter, promised_fold, promised_et_date, order_voided, order_deleted, check_voided, check_deleted, excess_food, amount_cents, line_price_state)
      values($1,'2026-10-05','o1','c1',$2,$3,$3,40,0,'2026-10-05',$4,44,0,'2026-10-05',false,false,false,false,false,5000,'unpriced')`,
      [A, snap, etIso("2026-10-05", "10:00"), etIso("2026-10-05", "11:00")]);
    const placed = await q<{ labor_minutes: number; hourly_minutes: number; sales_cents: number; day_state: string }>(
      "select labor_minutes::int, hourly_minutes::int, sales_cents::int, day_state from fact_labor_splh($1,'2026-10-05','2026-10-05','placed') where wall_quarter = 40", [A]);
    // 10:00-10:15: Alice + user 9 + user 10 = 45 labor minutes, ONE $50 sale.
    expect(placed).toEqual([{ labor_minutes: 45, hourly_minutes: 45, sales_cents: 5000, day_state: "covered" }]);
    const promised = await q<{ sales_cents: number }>("select sales_cents::int from fact_labor_splh($1,'2026-10-05','2026-10-05','promised') where wall_quarter = 44", [A]);
    expect(promised).toEqual([{ sales_cents: 5000 }]);
    await refuses(q("select * from fact_labor_splh($1,'2026-10-05','2026-10-05','delivered')", [A]), "fact_invalid_request");
    await refuses(q("select * from fact_labor_splh($1,'2026-08-01','2026-10-05','placed')", [A]), "sales_report_window_too_wide");
  });
});
