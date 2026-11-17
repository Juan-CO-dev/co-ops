// Item 2 PR 2c: the 0338 READ side, offline (PGlite, synthetic fixtures). A built week (real reconciler,
// real builder, real writer), then fact_labor_cost (components only) through the pure two-view pricer,
// the burden setting and its one writer, and SPLH summed per quarter before the sales join.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { buildLaborWeek, laborWeekSourceFromJson } from "@/lib/facts/labor-week-shared";
import { LABOR_BUILDER_VERSION } from "@/lib/facts/labor-config-shared";
import { laborPercents, laborTargetsFor, laborWeekViews, toLaborCostRow, type LaborCostRow } from "@/lib/facts/labor-cost-shared";
import { M0338, M0339, freshLaborParents } from "./helpers/fact-0338-parents";

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
  await db.exec(M0339); // the production shape: overtime per shop (Juan 2026-11-17)
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
    // B: 900 x $22; Alice's 15 h at B are under 40 h AT B (each shop is its own employer, 0339): no overtime.
    // The per-shop blended premium is proved in tests/fact-labor-0339-migration.test.ts.
    expect(b).toMatchObject({ hourly_straight_cents: 33000, ot_premium_cents: 0, ot_minutes: 0 });
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

describe("fix r1 P1: an open punch reaches the pricer (builder -> writer -> fact_labor_cost -> views)", () => {
  it("a settled, evidenced week with an unclosed punch is a lower bound with unknown hours: never a green 0%", async () => {
    const W2 = "2026-10-11";
    await q("insert into sevenshifts_time_punches(id, user_id, location_id, clocked_in, clocked_out, break_minutes) values($1, 7, 501, $2, null, 0)",
      [++pid, etIso("2026-10-12", "06:00")]);
    await build(W2);
    expect((await q<{ ot_state: string }>("select ot_state from labor_week_coverage where week_start = $1", [W2]))[0]!.ot_state).toBe("lower_bound");
    const rows = await cost(null, W2, "2026-10-17");
    // Fix r2 P1: the Monday 06:00 open punch could run into Tuesday, so it marks both days: a range sums open punch-DAYS.
    expect(rows.find((r) => r.location_id === A)).toMatchObject({ open_punches: 2, days_covered: 7, ot_state: "lower_bound" });
    const [v] = laborWeekViews(rows.map((r) => toLaborCostRow(r as unknown as Record<string, unknown>)));
    expect(v).toMatchObject({ coverageComplete: false, hoursKnown: false, openPunches: 2, otState: "lower_bound", pureHourlyCents: 0 });
    expect(laborPercents(v!, 1_000_000, laborTargetsFor(null))).toEqual({ pureHourlyPct: null, pureHourlyTone: "none", fullyLoadedPct: null, fullyLoadedTone: "none" });
  });
});

describe("fix r1 P2: save_labor_burden writes its own destructive audit row, before and after", () => {
  it("one labor_burden.save row per save: actor, role, scope, the value in force before and the new value; a refusal writes none", async () => {
    const count = async () => (await q<{ n: number }>("select count(*)::int n from audit_log where action = 'labor_burden.save'"))[0]!.n;
    const before = await count();
    const id = (await q<{ id: string }>("select save_labor_burden($1, $2, 9.5, '2026-07-19', 'payroll', 'secret payroll note') id", [MGR, A]))[0]!.id;
    const rows = await q<Record<string, unknown>>("select * from audit_log where action = 'labor_burden.save' and resource_id = $1", [id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_id: MGR, actor_role: "moo", resource_table: "labor_burden_settings", destructive: true,
      before_state: { burden_pct: 10, source: "payroll", scope: "company" },
      after_state: { burden_pct: 9.5, source: "payroll", valid_from: "2026-07-19", location_id: A } });
    expect(rows[0]!.metadata).toMatchObject({ scope: "shop", location_id: A, valid_from: "2026-07-19", has_note: true });
    expect(JSON.stringify(rows[0])).not.toContain("secret payroll note");
    await refuses(q("select save_labor_burden($1, null, 10, '2026-07-19', 'payroll', null)", [GM]), "labor_burden_forbidden");
    await refuses(q("select save_labor_burden($1, null, 99, '2026-07-19', 'payroll', null)", [MGR]), "labor_burden_invalid");
    expect(await count()).toBe(before + 1);
  });
  it("a first save against the default records the 12% estimated default as the before state", async () => {
    const C = "00000000-0000-4000-8000-0000000000cc";
    await q("insert into locations(id) values($1)", [C]);
    // C has no shop row and no company row is in force on 2026-07-01 (all are valid from 07-19): the default.
    const id = (await q<{ id: string }>("select save_labor_burden($1, $2, 14, '2026-07-01', 'estimated', null) id", [MGR, C]))[0]!.id;
    const [r] = await q<Record<string, unknown>>("select before_state, metadata from audit_log where resource_id = $1", [id]);
    expect(r).toMatchObject({ before_state: { burden_pct: 12, source: "estimated", scope: "default" }, metadata: { has_note: false, scope: "shop" } });
  });
});

const coverOrders = (loc: string, date: string, state = "covered") => q(`insert into fact_day_coverage(location_id, business_date, fact, source_fingerprint, builder_version, state,
  run_id, run_orders, pointer_count, missing_pointer_count, order_count, check_count, line_count, refund_count, checks_inline_priced, checks_source_complete,
  checks_net_complete, checks_gross_complete, checks_receipt_line_complete) values($1, $2, 'orders', $3, 'orders-v1', $4, $5, $6, 0, $7, 0,0,0,0,0,0,0,0,0)`,
  [loc, date, "0".repeat(32), state, state === "uncovered" ? null : randomUUID(), state === "uncovered" ? null : 0, state === "uncovered" ? null : 0]);
/** One check (EDT fixtures: ET = UTC-4). */
async function check(order: string, business: string, opened: string, promised: string, cents: number) {
  const snap = randomUUID();
  await q("insert into fact_order_snapshot(location_id, business_date, order_guid, snapshot_id, run_member, check_count) values($1,$2,$3,$4,true,1)", [A, business, order, snap]);
  const qOf = (iso: string) => {
    const et = new Date(new Date(iso).getTime() - 4 * 3600_000);
    return { qs: iso, wq: et.getUTCHours() * 4 + Math.floor(et.getUTCMinutes() / 15), date: et.toISOString().slice(0, 10) };
  };
  const o = qOf(opened), p = qOf(promised);
  await q(`insert into fact_order_check(location_id, business_date, order_guid, check_guid, snapshot_id, opened_at, opened_quarter_start_at, opened_wall_quarter, opened_fold, opened_et_date,
    promised_quarter_start_at, promised_wall_quarter, promised_fold, promised_et_date, order_voided, order_deleted, check_voided, check_deleted, excess_food, amount_cents, line_price_state)
    values($1,$2,$3,$4,$5,$6,$6,$7,0,$8,$9,$10,0,$11,false,false,false,false,false,$12,'unpriced')`,
    [A, business, order, `${order}-c`, snap, o.qs, o.wq, o.date, p.qs, p.wq, p.date, cents]);
}
type Splh = { business_date: string; wall_quarter: number; labor_minutes: number | null; sales_cents: number | null; sale_checks: number | null; day_state: string | null; sales_state: string };
const splh = (from: string, to: string, clock: string, loc = A) => q<Splh>(`select to_char(business_date,'YYYY-MM-DD') business_date, wall_quarter::int, labor_minutes::int, sales_cents::int,
  sale_checks::int, day_state, sales_state from fact_labor_splh($1,$2,$3,$4)`, [loc, from, to, clock]);
const sum = (rs: Splh[]) => rs.reduce((s, r) => s + (r.sales_cents ?? 0), 0);

describe("C. SPLH inputs (labor summed per quarter before the sales join)", () => {
  it("a quarter with two people carries its sales once; placed and promised clocks both work", async () => {
    await coverOrders(A, "2026-10-04"); await coverOrders(A, "2026-10-05");
    await check("o1", "2026-10-05", etIso("2026-10-05", "10:00"), etIso("2026-10-05", "11:00"), 5000);
    const placed = (await splh("2026-10-05", "2026-10-05", "placed")).filter((r) => r.wall_quarter === 40);
    // 10:00-10:15: Alice + user 9 + user 10 = 45 labor minutes, ONE $50 sale.
    expect(placed).toEqual([{ business_date: "2026-10-05", wall_quarter: 40, labor_minutes: 45, sales_cents: 5000, sale_checks: 1, day_state: "covered", sales_state: "covered" }]);
    expect((await splh("2026-10-05", "2026-10-05", "promised")).filter((r) => r.wall_quarter === 44).map((r) => r.sales_cents)).toEqual([5000]);
    await refuses(q("select * from fact_labor_splh($1,'2026-10-05','2026-10-05','delivered')", [A]), "fact_invalid_request");
    await refuses(q("select * from fact_labor_splh($1,'2026-08-01','2026-10-05','placed')", [A]), "sales_report_window_too_wide");
  });
  it("fix r1 P2: an order is selected by the CHOSEN clock's date, never its Toast business date; the output stays inside the window", async () => {
    await coverOrders(A, "2026-10-06");
    // Business date Monday 10-05, promised Tuesday 10-06 11:00 (catering ordered the day before).
    await check("o2", "2026-10-05", etIso("2026-10-05", "15:00"), etIso("2026-10-06", "11:00"), 7000);
    expect((await splh("2026-10-06", "2026-10-06", "promised")).filter((r) => r.wall_quarter === 44).map((r) => r.sales_cents)).toEqual([7000]);
    const mon = await splh("2026-10-05", "2026-10-05", "promised");
    expect(mon.every((r) => r.business_date === "2026-10-05")).toBe(true);
    expect(sum(mon)).toBe(5000);
    // Placed: a late check opened after midnight (ET 10-06 00:30) on business date 10-05 is Tuesday's quarter 2.
    await check("o3", "2026-10-05", etIso("2026-10-06", "00:30"), etIso("2026-10-06", "00:30"), 900);
    expect((await splh("2026-10-06", "2026-10-06", "placed")).filter((r) => r.wall_quarter === 2).map((r) => r.sales_cents)).toEqual([900]);
    const monPlaced = await splh("2026-10-05", "2026-10-05", "placed");
    expect(monPlaced.every((r) => r.business_date === "2026-10-05")).toBe(true);
    expect(sum(monPlaced)).toBe(5000 + 7000);
  });
  it("fix r1 P2: order facts unbuilt or uncovered = sales unknown (null, not_covered), never measured zero; labor unbuilt = labor null", async () => {
    // B 10-08: labor built (covered, Alice 06:00-21:00), B's order facts never built.
    const wed = await splh("2026-10-08", "2026-10-08", "placed", B);
    expect(wed.length).toBeGreaterThan(0);
    expect(wed.every((r) => r.sales_cents === null && r.sale_checks === null && r.sales_state === "not_covered" && r.labor_minutes !== null)).toBe(true);
    // 10-08 at A: labor built (no minutes at A), order facts uncovered -> still unknown.
    await coverOrders(A, "2026-10-07"); await coverOrders(A, "2026-10-08", "uncovered");
    await check("o4", "2026-10-08", etIso("2026-10-08", "12:00"), etIso("2026-10-08", "12:00"), 1200);
    expect(await splh("2026-10-08", "2026-10-08", "placed")).toEqual([
      { business_date: "2026-10-08", wall_quarter: 48, labor_minutes: 0, sales_cents: null, sale_checks: null, day_state: "covered", sales_state: "not_covered" }]);
    // 2026-09-28: no labor week built, order facts covered -> labor null, sales measured.
    await coverOrders(A, "2026-09-27"); await coverOrders(A, "2026-09-28");
    await check("o5", "2026-09-28", etIso("2026-09-28", "12:00"), etIso("2026-09-28", "12:00"), 3000);
    expect(await splh("2026-09-28", "2026-09-28", "placed")).toEqual([
      { business_date: "2026-09-28", wall_quarter: 48, labor_minutes: null, sales_cents: 3000, sale_checks: 1, day_state: null, sales_state: "covered" }]);
  });
  it("fix r2 P2: on the promised clock, a captured business date in the lookback whose order facts are not built makes the day's sales unknown", async () => {
    const run = async (date: string) => q("insert into toast_capture_runs(location_id, business_date, started_at, finished_at, status) values($1,$2,$3,$3,'completed')",
      [A, date, etIso(date, "23:59")]);
    await coverOrders(A, "2026-10-13"); await coverOrders(A, "2026-10-14");
    await check("o7", "2026-10-14", etIso("2026-10-14", "09:00"), etIso("2026-10-14", "12:00"), 800);
    const wed = () => splh("2026-10-14", "2026-10-14", "promised");
    expect((await wed()).map((r) => [r.sales_state, r.sales_cents])).toEqual([["covered", 800]]);
    // A capture run 15 days back is outside the bounded lookback (FACT_LABOR_PROMISED_LOOKBACK_DAYS = 14).
    await run("2026-09-29");
    expect((await wed()).map((r) => r.sales_state)).toEqual(["covered"]);
    // Monday 10-12 was captured but its order-fact build failed (no fact_day_coverage row, no fact_order_check rows):
    // a check placed Monday and promised Wednesday may be missing, so Wednesday's promised sales are unknown.
    await run("2026-10-12");
    expect((await wed()).map((r) => [r.sales_state, r.sales_cents])).toEqual([["not_covered", null]]);
    // The placed clock does not depend on Monday.
    expect((await splh("2026-10-14", "2026-10-14", "placed")).every((r) => r.sales_state === "covered")).toBe(true);
    // Monday built (even covered_zero): Wednesday is covered again.
    await coverOrders(A, "2026-10-12", "covered_zero");
    expect((await wed()).map((r) => r.sales_state)).toEqual(["covered"]);
    // The day after is in the window too (the candidates' own bound: business date at most the promise + 1): captured, unbuilt = unknown.
    await run("2026-10-15");
    expect((await wed()).map((r) => r.sales_state)).toEqual(["not_covered"]);
  });
  it("fix r1 P2: on the placed clock a day is covered only when the day before is too (a late check of that business date lands here)", async () => {
    await coverOrders(A, "2026-10-10"); // 10-09 never built
    await check("o6", "2026-10-10", etIso("2026-10-10", "12:00"), etIso("2026-10-10", "12:00"), 400);
    const sat = await splh("2026-10-10", "2026-10-10", "placed");
    expect(sat.length).toBeGreaterThan(0);
    expect(sat.every((r) => r.sales_state === "not_covered" && r.sales_cents === null)).toBe(true);
  });
});
