// 0343 (board two views PR 1): the PLANNED labor pricer. Offline (PGlite): the REAL parents + 0338 + 0339 + 0340
// + the REAL 0343, a week built by the real builder and writer.
//  - an empty plan is 0340, row for row (read before and after the apply), and the public function keeps its 23 columns;
//  - Astra r3 P1-1: planned rows REPLACE a masked day's facts (never a union); a masked day with no rows is a
//    planned zero-hour day; the plan's overtime list replaces the stored overtime of the whole payroll week;
//  - the premium is priced at the week's blended rate over the selected population (the preceding Sunday included);
//  - Astra r3 P2-3: a planned salaried row is used only when no stored row exists; the estimate beats both;
//  - Astra r4 P1: a genuinely UNBUILT future week returns its planned minutes, overtime and salary (ot_state stays
//    `unbuilt`: the shared pricer, not SQL, decides what a projection may show);
//  - `only` prices a non-contiguous set of days of the range (the strip's actual and projected parts);
//  - refusals by name, the pre-flight (0340 missing, a drifted body, a second apply) and the ceilings.
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { M0338, M0339, M0340, M0343, freshLaborParents } from "./helpers/fact-0338-parents";
import { A, ALICE, B, BOB, FUTURE_W, MGR, W, laborPlanDb, type LaborPlanDb } from "./helpers/labor-plan-fixture";

const md5 = (s: string) => createHash("md5").update(s.replace(/[^\x21-\x7E]+/g, ""), "utf8").digest("hex");
function bodyOf(sql: string, name: string): string {
  const start = sql.indexOf(`create function public.${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  const open = sql.indexOf("$$", start) + 2;
  return sql.slice(open, sql.indexOf("$$", open));
}

let f: LaborPlanDb;
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => f.q<T>(sql, params);
async function refuses(p: Promise<unknown>, code: string) {
  try { await expect(p).rejects.toThrow(code); }
  finally { if (f.db.isInTransaction()) await f.db.exec("rollback"); }
}
type Row = Record<string, unknown>;
const planned = (loc: string | null, from: string, to: string, plan: unknown, fallback = "first_known") =>
  q<Row>("select * from fact_labor_cost_planned($1, $2, $3, $4, $5::jsonb)", [loc, from, to, fallback, plan === null ? null : JSON.stringify(plan)]);
const num = (r: Row, ...ks: string[]) => Object.fromEntries(ks.map((k) => [k, r[k] === null ? null : Number(r[k])]));
const hourly = (user: string, date: string, minutes: number, cents = 2000) =>
  ({ person_key: `u:${user}`, business_date: date, minutes, pay_class: "hourly", rate_cents: cents, rate_basis: "known", carry_back_rate_cents: null });
const u = (id: string) => `u:${id}`;

const IDENTITY: Array<[string | null, string, string, string]> = [
  [A, W, "2026-10-10", "first_known"], [A, W, "2026-10-10", "dc_minimum"], [B, W, "2026-10-10", "first_known"], [null, W, "2026-10-10", "first_known"],
  [A, "2026-10-05", "2026-10-05", "first_known"], [A, "2026-10-09", "2026-10-09", "first_known"], [A, "2026-10-05", "2026-10-11", "first_known"],
  [A, "2026-10-07", "2026-10-20", "first_known"], [null, "2026-10-05", "2026-10-11", "dc_minimum"], [A, "2099-01-05", "2099-01-10", "first_known"],
];
const before: Row[][] = [];

beforeAll(async () => {
  f = await laborPlanDb();
  for (const [loc, from, to, fb] of IDENTITY) before.push(await q("select * from fact_labor_cost($1, $2, $3, $4)", [loc, from, to, fb]));
  await f.db.exec(M0343);
}, 240_000);

describe("0343 static shape", () => {
  it("one transaction; the pre-flight accepts exactly 0340's fact_labor_cost body", () => {
    expect(M0343).toMatch(/^begin;$/m);
    expect(M0343.trimEnd().endsWith("commit;")).toBe(true);
    expect(M0343).toContain(`'${md5(bodyOf(M0340, "fact_labor_cost"))}'`);
  });
  it("adds no table and touches no fact row: it only creates the planned pricer and re-points the public one at it", () => {
    expect(M0343).not.toMatch(/create table|alter table|insert into|delete from|update public\./i);
    expect(M0343).toContain("create function public.fact_labor_cost_planned(");
    expect(M0343).toContain("create or replace function public.fact_labor_cost(");
  });
});

describe("an empty plan is 0340", () => {
  it("the public function returns the same rows, byte for byte, with the same 23 columns", async () => {
    for (const [i, [loc, from, to, fb]] of IDENTITY.entries()) {
      const after = await q("select * from fact_labor_cost($1, $2, $3, $4)", [loc, from, to, fb]);
      expect(after, `${loc} ${from}..${to} ${fb}`).toEqual(before[i]);
      expect(Object.keys(after[0] ?? {})).toEqual(Object.keys(before[i]![0] ?? {}));
    }
    expect(Object.keys(before[0]![0]!)).toHaveLength(23);
  });
  it("a null plan and {} answer the same rows plus days_planned 0 and salary_projected false", async () => {
    for (const [i, [loc, from, to, fb]] of IDENTITY.entries()) {
      for (const plan of [null, {}]) {
        const rows = await planned(loc, from, to, plan, fb);
        expect(rows.map(({ days_planned: _d, salary_projected: _s, ot_planned: _o, ...rest }) => rest)).toEqual(before[i]);
        expect(rows.every((r) => r.days_planned === 0 && r.salary_projected === false && r.ot_planned === false)).toBe(true);
      }
    }
  });
  it("the fixture: shop A's built week is 48 h for Alice with 8 h of overtime on Friday", async () => {
    expect(num(before[0]![0]!, "hourly_minutes", "ot_minutes", "hourly_straight_cents", "ot_premium_cents", "days_covered"))
      .toEqual({ hourly_minutes: 2880 + 360 + 60, ot_minutes: 480, hourly_straight_cents: 96000 + 18000 + 1840, ot_premium_cents: 8000, days_covered: 7 });
  });
});

describe("planned rows replace, never union (Astra r3 P1-1)", () => {
  const monday = "2026-10-05";
  it("a masked day prices the plan only: 17 recorded hours + 8 scheduled is 8 h, in the day range and in the week range", async () => {
    const plan = { mask: [monday], rows: [hourly(ALICE, monday, 480)], ot: [{ person_key: u(ALICE), business_date: "2026-10-09", ot_minutes: 360 }] };
    const [day] = await planned(A, monday, monday, plan);
    expect(num(day!, "hourly_minutes", "hourly_straight_cents", "estimated_rate_minutes", "days_planned", "days_covered", "days_missing", "range_days"))
      .toEqual({ hourly_minutes: 480, hourly_straight_cents: 16000, estimated_rate_minutes: 0, days_planned: 1, days_covered: 0, days_missing: 0, range_days: 1 });
    const [week] = await planned(A, W, "2026-10-10", plan);
    // Alice 8 + 10 + 10 + 10 + 8 = 46 h; Bob's and the no-wage account's Monday punches are gone with the day.
    expect(num(week!, "hourly_minutes", "ot_minutes", "hourly_straight_cents", "ot_premium_cents", "days_planned", "days_covered"))
      .toEqual({ hourly_minutes: 2760, ot_minutes: 360, hourly_straight_cents: 92000, ot_premium_cents: 6000, days_planned: 1, days_covered: 6 });
  });
  it("another shop's rows are never touched by this shop's mask", async () => {
    const [b] = await planned(B, W, "2026-10-10", { mask: ["2026-10-06"], rows: [] });
    expect(num(b!, "hourly_minutes", "days_planned")).toEqual({ hourly_minutes: 0, days_planned: 1 });
    const [a] = await planned(A, W, "2026-10-10", { mask: ["2026-10-06"], rows: [] });
    expect(Number(a!.hourly_minutes)).toBe(2880 + 360 + 60 - 600);
    // B's own week is untouched by A's plan: read without one.
    expect(Number((await planned(B, W, "2026-10-10", null))[0]!.hourly_minutes)).toBe(300);
  });
  it("a day cancelled to zero is a planned zero-hour day: 0 minutes, counted in days_planned, not missing", async () => {
    const [day] = await planned(A, monday, monday, { mask: [monday], rows: [] });
    expect(num(day!, "hourly_minutes", "hourly_straight_cents", "days_planned", "days_covered", "days_pending", "days_incomplete", "days_missing", "open_punches"))
      .toEqual({ hourly_minutes: 0, hourly_straight_cents: 0, days_planned: 1, days_covered: 0, days_pending: 0, days_incomplete: 0, days_missing: 0, open_punches: 0 });
  });
  it("the plan's overtime list replaces the STORED overtime of the whole payroll week (replacing Wednesday moves a later day)", async () => {
    // Wednesday cancelled: 38 h in the week, so Friday's stored 8 h of overtime is gone.
    const none = { mask: ["2026-10-07"], rows: [], ot: [] };
    expect(num((await planned(A, W, "2026-10-10", none))[0]!, "ot_minutes", "ot_premium_cents")).toEqual({ ot_minutes: 0, ot_premium_cents: 0 });
    // Wednesday planned at 12 h: 50 h, 10 h of overtime, 2 of them now on Thursday (a RETAINED fact day).
    const more = { mask: ["2026-10-07"], rows: [hourly(ALICE, "2026-10-07", 720)],
      ot: [{ person_key: u(ALICE), business_date: "2026-10-08", ot_minutes: 120 }, { person_key: u(ALICE), business_date: "2026-10-09", ot_minutes: 480 }] };
    expect(num((await planned(A, "2026-10-08", "2026-10-08", more))[0]!, "ot_minutes", "ot_premium_cents")).toEqual({ ot_minutes: 120, ot_premium_cents: 2000 });
    expect(num((await planned(A, W, "2026-10-10", more))[0]!, "ot_minutes", "ot_premium_cents")).toEqual({ ot_minutes: 600, ot_premium_cents: 10000 });
  });
  it("the days BEFORE a week's first masked date keep their STORED overtime and are not flagged; from that date on the row is ot_planned", async () => {
    // Thursday is replaced by a 14 h plan: Mon-Wed 30 h stored, Thu 14 h planned (4 h over), Fri 8 h retained (all over).
    const plan = { mask: ["2026-10-08"], rows: [hourly(ALICE, "2026-10-08", 840)],
      ot: [{ person_key: u(ALICE), business_date: "2026-10-08", ot_minutes: 240 }, { person_key: u(ALICE), business_date: "2026-10-09", ot_minutes: 480 }] };
    const early = (await planned(A, "2026-10-05", "2026-10-07", plan))[0]!;
    expect(early).toMatchObject({ ot_planned: false, days_planned: 0, days_covered: 3 });
    expect(early).toEqual({ ...(await planned(A, "2026-10-05", "2026-10-07", null))[0]!, ot_planned: false });
    expect((await planned(A, "2026-10-08", "2026-10-08", plan))[0]).toMatchObject({ ot_planned: true, days_planned: 1 });
    const fri = (await planned(A, "2026-10-09", "2026-10-09", plan))[0]!;
    expect(fri).toMatchObject({ ot_planned: true, days_planned: 0, days_covered: 1 });
    expect(Number(fri.ot_minutes)).toBe(480);
    // `only` = the days before the mask, asked over the whole week: still the stored overtime, not flagged.
    expect((await planned(A, W, "2026-10-10", { ...plan, only: ["2026-10-05", "2026-10-06"] }))[0]).toMatchObject({ ot_planned: false });
    // An overtime entry dated before the week's first masked date is refused (nothing planned reaches back).
    await refuses(planned(A, W, "2026-10-10", { ...plan, ot: [{ person_key: u(ALICE), business_date: "2026-10-07", ot_minutes: 10 }] }), "fact_invalid_request");
  });
  it("the premium uses the week's BLENDED rate over the selected population (an unsettled Sunday at another rate)", async () => {
    // Sunday 8 h at $30 from the plan + the 48 recorded hours at $20: 56 h, 16 h of overtime at (8x30 + 48x20) / 56.
    const plan = { mask: [W], rows: [hourly(ALICE, W, 480, 3000)],
      ot: [{ person_key: u(ALICE), business_date: "2026-10-08", ot_minutes: 480 }, { person_key: u(ALICE), business_date: "2026-10-09", ot_minutes: 480 }] };
    const [week] = await planned(A, "2026-10-05", "2026-10-10", plan);
    const blended = (480 * 3000 + 2880 * 2000) / 3360;
    expect(num(week!, "ot_minutes", "ot_premium_cents", "days_planned", "range_days"))
      .toEqual({ ot_minutes: 960, ot_premium_cents: Math.round((0.5 * blended * 960) / 60), days_planned: 0, range_days: 6 });
  });
  it("a plan row with no wage is priced at the shop estimate and counted as estimated (the facts' own rule)", async () => {
    const row = { person_key: u(BOB), business_date: monday, minutes: 60, pay_class: "hourly", rate_cents: null, rate_basis: "none", carry_back_rate_cents: null };
    const [day] = await planned(A, monday, monday, { mask: [monday], rows: [row] });
    expect(num(day!, "hourly_straight_cents", "estimated_rate_minutes")).toEqual({ hourly_straight_cents: 1840, estimated_rate_minutes: 60 });
  });
});

describe("`only`: a non-contiguous set of the range's days", () => {
  it("prices exactly those days; the salary share and the day counts follow them; a week with none of them returns no row", async () => {
    const rows = await planned(A, "2026-10-05", "2026-10-11", { only: ["2026-10-05", "2026-10-09"] });
    expect(rows).toHaveLength(1);
    expect(num(rows[0]!, "range_days", "hourly_minutes", "ot_minutes", "days_covered", "salaried_cents"))
      .toEqual({ range_days: 2, hourly_minutes: 600 + 360 + 60 + 480, ot_minutes: 480, days_covered: 2, salaried_cents: Math.round((140000 * 2) / 7) });
  });
});

describe("a genuinely unbuilt future week (Astra r4 P1)", () => {
  const days = ["2099-01-05", "2099-01-06", "2099-01-07", "2099-01-08", "2099-01-09", "2099-01-10"];
  const plan48 = {
    mask: [FUTURE_W, ...days], rows: days.map((d) => hourly(ALICE, d, 480)),
    ot: [{ person_key: u(ALICE), business_date: "2099-01-10", ot_minutes: 480 }],
    salaried: [{ week_start: FUTURE_W, salaried_cents: 140000, salaried_people: 1, unplaced_people: 0, missing_wage_people: 0 }],
  };
  it("nothing is stored for it: without a plan the week is unbuilt, every day missing, no salary", async () => {
    const [r] = await planned(A, FUTURE_W, "2099-01-10", null);
    expect(r).toMatchObject({ ot_state: "unbuilt", days_missing: 7, salary_basis: "unknown", salaried_cents: null });
  });
  it("a 48-hour schedule: planned minutes, 8 h of overtime at its premium, the salary from the plan, flagged projected", async () => {
    const [r] = await planned(A, FUTURE_W, "2099-01-10", plan48);
    expect(r).toMatchObject({ ot_state: "unbuilt", salary_basis: "wages", salary_projected: true, days_planned: 7, days_missing: 0 });
    expect(num(r!, "hourly_minutes", "ot_minutes", "hourly_straight_cents", "ot_premium_cents", "salaried_cents", "salaried_people"))
      .toEqual({ hourly_minutes: 2880, ot_minutes: 480, hourly_straight_cents: 96000, ot_premium_cents: 8000, salaried_cents: 140000, salaried_people: 1 });
  });
  it("parity: the same minutes price the same from the plan as from built facts", async () => {
    const [p] = await planned(A, FUTURE_W, "2099-01-10", plan48);
    const built = before[0]![0]!;
    // The built week also holds Bob (6 h at $30) and one no-wage hour: Alice's own 48 h are the same $ and premium.
    expect(Number(p!.hourly_straight_cents)).toBe(Number(built.hourly_straight_cents) - 18000 - 1840);
    expect(Number(p!.ot_premium_cents)).toBe(Number(built.ot_premium_cents));
    expect(Number(p!.salaried_cents)).toBe(Number(built.salaried_cents));
  });
});

describe("salary: estimate, then the stored row, then the plan (Astra r3 P2-3)", () => {
  it("a stored row beats a plan row", async () => {
    const [r] = await planned(A, W, "2026-10-10", { salaried: [{ week_start: W, salaried_cents: 999900, salaried_people: 3, unplaced_people: 0, missing_wage_people: 0 }] });
    expect(r).toMatchObject({ salary_basis: "wages", salary_projected: false, salaried_people: 1 });
    expect(Number(r!.salaried_cents)).toBe(140000);
  });
  it("an unplaced salaried account in the plan: this shop reads incomplete with its count and no cents", async () => {
    const [r] = await planned(A, FUTURE_W, "2099-01-10", { salaried: [{ week_start: FUTURE_W, salaried_cents: null, salaried_people: 1, unplaced_people: 1, missing_wage_people: 0 }] });
    expect(r).toMatchObject({ salary_basis: "incomplete", salaried_cents: null, salary_unplaced_people: 1, salary_projected: true });
  });
  it("the estimate beats both, with the plan's gap counts still returned", async () => {
    await q("insert into schedule_shop_settings(location_id, estimated_salaried_weekly_cents, updated_by) values($1, 300000, $2)", [A, MGR]);
    const [r] = await planned(A, FUTURE_W, "2099-01-10", { salaried: [{ week_start: FUTURE_W, salaried_cents: null, salaried_people: 0, unplaced_people: 2, missing_wage_people: 0 }] });
    expect(r).toMatchObject({ salary_basis: "estimate", salary_unplaced_people: 2, salary_projected: false });
    expect(Number(r!.salaried_cents)).toBe(300000);
    await q("delete from schedule_shop_settings where location_id=$1", [A]);
  });
});

describe("refusals (fact_invalid_request)", () => {
  const monday = "2026-10-05";
  it("a plan needs one shop", async () => {
    await refuses(planned(null, W, "2026-10-10", { mask: [monday], rows: [] }), "fact_invalid_request");
  });
  it("a row outside the mask; a mask date outside the request's payroll weeks", async () => {
    await refuses(planned(A, W, "2026-10-10", { mask: [monday], rows: [hourly(ALICE, "2026-10-06", 60)] }), "fact_invalid_request");
    await refuses(planned(A, monday, monday, { mask: ["2026-10-11"], rows: [] }), "fact_invalid_request");
  });
  it("overtime above the day's hourly minutes; overtime for a week with no masked date; a duplicate entry", async () => {
    await refuses(planned(A, W, "2026-10-10", { mask: [monday], rows: [hourly(ALICE, monday, 60)], ot: [{ person_key: u(ALICE), business_date: monday, ot_minutes: 61 }] }), "fact_invalid_request");
    await refuses(planned(A, W, "2026-10-10", { ot: [{ person_key: u(ALICE), business_date: "2026-10-09", ot_minutes: 10 }] }), "fact_invalid_request");
    const e = { person_key: u(ALICE), business_date: "2026-10-09", ot_minutes: 10 };
    await refuses(planned(A, W, "2026-10-10", { mask: [monday], rows: [], ot: [e, e] }), "fact_invalid_request");
  });
  it("a malformed plan: not an object, an unknown key, a bad row, a salaried total that hides a gap, `only` outside the range", async () => {
    await refuses(planned(A, W, "2026-10-10", []), "fact_invalid_request");
    await refuses(planned(A, W, "2026-10-10", { masc: [monday] }), "fact_invalid_request");
    await refuses(planned(A, W, "2026-10-10", { mask: [monday], rows: [{ ...hourly(ALICE, monday, 60), minutes: 0 }] }), "fact_invalid_request");
    await refuses(planned(A, W, "2026-10-10", { mask: [monday], rows: [{ ...hourly(ALICE, monday, 60), rate_basis: "none" }] }), "fact_invalid_request");
    await refuses(planned(A, W, "2026-10-10", { mask: ["not-a-date"] }), "fact_invalid_request");
    await refuses(planned(A, W, "2026-10-10", { salaried: [{ week_start: W, salaried_cents: 5, salaried_people: 1, unplaced_people: 1, missing_wage_people: 0 }] }), "fact_invalid_request");
    await refuses(planned(A, W, "2026-10-10", { salaried: [{ week_start: "2026-10-05", salaried_cents: null, salaried_people: 0, unplaced_people: 0, missing_wage_people: 0 }] }), "fact_invalid_request");
    await refuses(planned(A, W, "2026-10-10", { only: ["2026-10-11"] }), "fact_invalid_request");
    await refuses(planned(A, W, "2026-10-10", { only: [] }), "fact_invalid_request");
  });
  it("the request rules are 0340's (range, fallback)", async () => {
    await refuses(planned(A, "2026-10-10", W, null), "fact_invalid_request");
    await refuses(planned(A, W, "2026-10-10", null, "nope"), "fact_invalid_request");
  });
});

describe("ceilings and the pre-flight", () => {
  it("both functions are service_role only", async () => {
    for (const sig of ["public.fact_labor_cost(uuid,date,date,text)", "public.fact_labor_cost_planned(uuid,date,date,text,jsonb)"]) {
      expect((await q<{ x: boolean }>(`select has_function_privilege('service_role', '${sig}', 'EXECUTE') x`))[0]!.x).toBe(true);
      for (const r of ["anon", "authenticated"]) expect((await q<{ x: boolean }>(`select has_function_privilege('${r}', '${sig}', 'EXECUTE') x`))[0]!.x, `${r} ${sig}`).toBe(false);
      expect((await q<{ n: number }>(`select count(*)::int n from pg_proc pr, lateral aclexplode(pr.proacl) a where pr.oid = '${sig}'::regprocedure and a.grantee = 0`))[0]!.n).toBe(0);
    }
  });
  it("a second apply refuses", async () => {
    await refuses(f.db.exec(M0343), "0343: already applied");
  });
  it("refuses without 0340, and refuses a drifted fact_labor_cost body by name", async () => {
    const d: PGlite = await freshLaborParents();
    const run = async (sql: string) => { try { await d.exec(sql); return null; } catch (e) { if (d.isInTransaction()) await d.exec("rollback"); return String(e); } };
    await d.exec(M0338); await d.exec(M0339);
    expect(await run(M0343)).toContain("0343: apply 0340 first");
    await d.exec(M0340);
    const live = bodyOf(M0340, "fact_labor_cost");
    const at = M0340.indexOf("create function public.fact_labor_cost(");
    const head = M0340.slice(at, M0340.indexOf("$$", at));
    await d.exec(`${head.replace("create function", "create or replace function")}$$${live.replace("'fact_invalid_request'", "'fact_invalid_requesx'")}$$;`);
    expect(await run(M0343)).toContain("0343: the live body of public.fact_labor_cost(uuid,date,date,text)");
    expect((await d.query<{ r: unknown }>("select to_regprocedure('public.fact_labor_cost_planned(uuid,date,date,text,jsonb)') r")).rows[0]!.r).toBeNull();
    await d.close();
  }, 240_000);
});
