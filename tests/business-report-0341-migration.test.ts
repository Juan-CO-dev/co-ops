// Item 9 PR 9a: the 0341 offline proof (PGlite, single session, synthetic rows; no network, no sim, no prod).
// REAL parents (0337 on its own parents, the labor parents) + REAL 0338 + 0339, then the REAL 0341.
// Pins: the rate rule is fact_labor_cost's (0339) verbatim; the channel / provider rule is 0232's verbatim.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { M0338, M0339, freshLaborParents } from "./helpers/fact-0338-parents";
import { recomposeDay, daySalesFrom, toCutRow, channelTotals } from "@/lib/business-report-shared";

const M0341 = readFileSync("supabase/migrations/0341_business_report_reads.sql", "utf8");
const M0232 = readFileSync("supabase/migrations/0232_reports_sales_reads.sql", "utf8");
const LOC = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const D = "2026-10-05";
const U1 = "11111111-1111-4111-8111-111111111111";

let db: PGlite;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

async function check(o: { order: string; check?: string; amount: number | null; dining?: string; voided?: boolean; at?: string; server?: string | null; date?: string; loc?: string }) {
  const snap = crypto.randomUUID();
  const date = o.date ?? D;
  await q("insert into fact_order_snapshot values($1,$2,$3,$4,true,1)", [o.loc ?? LOC, date, o.order, snap]);
  const at = o.at ?? `${date}T16:05:00Z`;
  await q(`insert into fact_order_check(location_id, business_date, order_guid, check_guid, snapshot_id, opened_at, opened_quarter_start_at,
    opened_wall_quarter, opened_fold, opened_et_date, order_voided, order_deleted, check_voided, check_deleted, excess_food,
    dining_option_guid, server_guid, amount_cents, line_price_state)
    values($1,$2,$3,$4,$5,$6::timestamptz, date_bin('15 minutes', $6::timestamptz, timestamptz '2000-01-01'), 48, 0, $2, false, false, $7, false, false, $8, $9, $10, 'unpriced')`,
    [o.loc ?? LOC, date, o.order, o.check ?? `${o.order}-c`, snap, at, o.voided ?? false, o.dining ?? "dine", o.server === undefined ? "srv-1" : o.server, o.amount]);
  return snap;
}

beforeAll(async () => {
  db = await freshLaborParents();
  await db.exec(M0338);
  await db.exec(M0339);
  await db.exec("alter table public.users add column name text");
  await db.exec(M0341);
  await q("insert into locations(id, name) values($1,'A'),($2,'B')", [LOC, OTHER]);
  await q("insert into users(id, role, name) values($1,'employee','Ana Lopez')", [U1]);
  for (const [guid, name] of [["dine", "Dine In"], ["gift", "E-Gift Cards"], ["grub", "Grubhub"]]) {
    await q("insert into toast_dining_options(location_id, guid, name) values($1,$2,$3)", [LOC, guid, name]);
  }
  await q(`insert into sales_channel_map(dining_option_label, channel, provider, reviewed_at) values
    ('Dine In','dine_in',null,now()), ('E-Gift Cards','online','gift_card',now()), ('Grubhub','third_party','grubhub',now())`);
  await q(`insert into toast_time_entries(location_id, time_entry_guid, business_date, employee_guid, employee_first_name, in_at)
    values($1,'te1',$2,'srv-1','Ana',$3)`, [LOC, D, `${D}T14:00:00Z`]);
}, 240_000);

describe("pins: no second rule", () => {
  it("prices labor with fact_labor_cost's own rate rule (0339 priced CTE), verbatim", () => {
    const rule = M0339.match(/case when q\.pay_class = 'salaried' then null[\s\S]*?end rate,/)?.[0];
    expect(rule).toBeTruthy();
    expect(M0341.split(rule!.replace(/,$/, "")).length - 1).toBe(2);
    const est = M0339.match(/q\.pay_class = 'hourly' and \(q\.rate_basis = 'none'[\s\S]*?\) est/)?.[0];
    expect(M0341).toContain(est!);
  });
  it("derives channel and provider exactly as 0232's sales_report_facts", () => {
    const src = M0232.match(/case when m\.reviewed_at is null or m\.channel = 'Unknown' then 'unknown'[\s\S]*?else m\.provider end,/)?.[0];
    expect(src).toBeTruthy();
    const mine = src!.replace("o.third_party_provider_name", "c.third_party_provider_name").replace(/else m\.channel end,/, "else m.channel end ch,")
      .replace(/else m\.provider end,$/, "else m.provider end pv,");
    expect(M0341.replace(/\s+/g, " ")).toContain(mine.replace(/\s+/g, " "));
  });
});

describe("business_report_check_cuts", () => {
  it("classifies at read time (gift card, ezCater-linked, void are never sales) and flags > $5,000 inside the total", async () => {
    await check({ order: "o1", amount: 1_000 });
    await check({ order: "o2", amount: 600_000 });
    await check({ order: "o3", amount: 2_500, dining: "gift" });
    const linked = await check({ order: "o4", amount: 9_000 });
    await q("insert into ezcater_current_toast_links values($1,$2,$3,'o4-c')", [LOC, D, linked]);
    await check({ order: "o5", amount: 700, voided: true });
    await check({ order: "o6", amount: null, dining: "grub", server: null, at: `${D}T23:50:00Z` });
    await check({ order: "o7", amount: 5_000, loc: OTHER });
    const rows = (await q("select * from business_report_check_cuts($1,$2,$2)", [LOC, D])).map((r) => toCutRow(r));
    const sale = rows.filter((r) => r.sale_class === "sale");
    expect(sale.reduce((s, r) => s + r.amount_cents, 0)).toBe(601_000);
    expect(sale.reduce((s, r) => s + r.checks, 0)).toBe(3);
    expect(sale.reduce((s, r) => s + r.amount_missing, 0)).toBe(1);
    expect(sale.reduce((s, r) => s + r.large_checks, 0)).toBe(1);
    expect(sale.find((r) => r.large_checks === 1)).toMatchObject({ large_cents: 600_000, amount_cents: 601_000, server_label: "Ana" });
    expect(rows.find((r) => r.sale_class === "gift_card")).toMatchObject({ channel: "gift_card", amount_cents: 2_500 });
    expect(rows.find((r) => r.sale_class === "ezcater_linked")).toMatchObject({ amount_cents: 9_000 });
    expect(rows.find((r) => r.sale_class === "void")).toMatchObject({ checks: 1 });
    expect(sale.find((r) => r.channel === "third_party")).toMatchObject({ provider: "grubhub", server_guid: null, quarter_start_at: `${D.slice(0, 10)}T23:45:00.000Z` });
    expect(channelTotals(rows).excluded.map((e) => e.key).sort()).toEqual(["ezcater_linked", "gift_card", "void"]); // fix round 8: every non-sale class is listed
  });
  it("recomposes to sales_report_daily's day shape (same classifier, same money)", async () => {
    const rows = (await q("select * from business_report_check_cuts($1,$2,$2)", [LOC, D])).map((r) => toCutRow(r));
    const [day] = daySalesFrom([{ classes: [{ business_date: D, sale_class: "sale", checks: 3, amount_cents: 601_000, tax_cents: 0, amount_missing: 1,
      gross_cents: 0, discounts_comps_cents: 0, voids_cents: 0, service_charges_cents: 0, accounting_missing: 3 }],
      tips: [], discounts: [], refunds: [], captured_days: [D], ezcater: [] }], D, D);
    expect(recomposeDay(day!, rows)).toMatchObject({ ok: true });
  });
  it("refuses a window wider than 31 days and a null shop", async () => {
    await expect(q("select * from business_report_check_cuts($1,'2026-09-01','2026-10-05')", [LOC])).rejects.toThrow(/sales_report_window_too_wide/);
    await expect(q("select * from business_report_check_cuts(null,$1,$1)", [D])).rejects.toThrow(/sales_report_invalid_window/);
  });
});

describe("business_report_labor_quarters / _people", () => {
  beforeAll(async () => {
    const row = `insert into labor_quarter(location_id, quarter_start_at, person_key, source, role_key, wall_quarter, fold, business_date, week_start,
      user_id, minutes, ot_minutes, pay_class, rate_cents, rate_basis, carry_back_rate_cents) values`;
    await q(`${row} ($1,'${D}T16:00:00Z','u:${U1}','7shifts',0,48,0,'${D}','2026-10-04','${U1}',15,0,'hourly',2000,'known',null),
      ($1,'${D}T16:00:00Z','ss:42','7shifts',0,48,0,'${D}','2026-10-04',null,15,0,'hourly',null,'none',null),
      ($1,'${D}T16:15:00Z','u:${U1}','7shifts',0,49,0,'${D}','2026-10-04','${U1}',15,0,'hourly',2000,'known',null),
      ($1,'${D}T16:15:00Z','ss:43','7shifts',0,49,0,'${D}','2026-10-04',null,15,0,'salaried',null,'none',null)`, [LOC]);
  });
  it("per quarter: minutes, salaried presence and STRAIGHT-TIME cost at the shop estimate when no wage", async () => {
    const rows = await q<{ minutes: number; hourly_minutes: number; salaried_minutes: number; straight_cents: number; estimated_minutes: number }>(
      "select minutes, hourly_minutes, salaried_minutes, straight_cents, estimated_minutes from business_report_labor_quarters($1,$2,$2,'first_known')", [LOC, D]);
    expect(rows.map((r) => Object.values(r).map(Number))).toEqual([[30, 30, 0, 960, 15], [30, 15, 15, 500, 0]]);
  });
  it("a day's quarters sum to fact_labor_cost's straight time for that day (one pricing rule)", async () => {
    const [cost] = await q<{ hourly_straight_cents: number }>("select hourly_straight_cents from fact_labor_cost($1,$2,$2,'first_known')", [LOC, D]);
    const [mine] = await q<{ s: number }>("select sum(straight_cents) s from business_report_labor_quarters($1,$2,$2,'first_known')", [LOC, D]);
    expect(Number(mine!.s)).toBe(Number(cost!.hourly_straight_cents));
  });
  it("per person: minutes and straight cost (no rate column), labelled by first name only", async () => {
    const rows = await q("select * from business_report_labor_people($1,$2,$2,'first_known')", [LOC, D]);
    expect(Object.keys(rows[0]!).sort()).toEqual(["minutes", "ot_minutes", "pay_class", "person_key", "person_label", "role_key", "source", "straight_cents", "user_id", "week_start"]);
    const ana = rows.find((r) => r.person_key === `u:${U1}`)!;
    expect(ana).toMatchObject({ person_label: "Ana", pay_class: "hourly" });
    expect(Number(ana.minutes)).toBe(30);
    expect(Number(ana.straight_cents)).toBe(1_000);
    expect(rows.find((r) => r.person_key === "ss:43")).toMatchObject({ straight_cents: null, pay_class: "salaried" });
  });
  it("refuses a bad wage fallback and a wide window", async () => {
    await expect(q("select * from business_report_labor_quarters($1,$2,$2,'whatever')", [LOC, D])).rejects.toThrow(/fact_invalid_request/);
    await expect(q("select * from business_report_labor_people($1,'2026-09-01',$2,'first_known')", [LOC, D])).rejects.toThrow(/sales_report_window_too_wide/);
  });
});

describe("ceilings", () => {
  it("service_role only; anon / authenticated / PUBLIC cannot execute", async () => {
    for (const f of ["business_report_check_cuts(uuid,date,date)", "business_report_labor_quarters(uuid,date,date,text)", "business_report_labor_people(uuid,date,date,text)"]) {
      const [r] = await q<{ s: boolean; a: boolean; u: boolean }>(`select has_function_privilege('service_role','public.${f}','EXECUTE') s,
        has_function_privilege('anon','public.${f}','EXECUTE') a, has_function_privilege('authenticated','public.${f}','EXECUTE') u`);
      expect(r).toEqual({ s: true, a: false, u: false });
    }
  });
  it("is file-only and dark: header gate line present, no table / column / trigger change", () => {
    expect(M0341).toMatch(/NOT YET APPLIED -- GATE CC\/JUAN/);
    expect(M0341).not.toMatch(/\b(create|alter|drop) (table|trigger|index)\b/i);
    expect(M0341).not.toMatch(/\b(insert into|update public|delete from)\b/i);
  });
});
