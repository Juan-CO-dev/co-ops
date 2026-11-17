// Item 2 PR 2a: the 0337 offline proof (PGlite, single session, synthetic fixtures only; no network,
// no sim, no prod). REAL parent DDL is extracted from the applied migrations (0221 tables + finish,
// 0239 columns + page writer, 0237 status constraint + toast_modified_save, 0232 classifier + window
// guard, 0243 leases + 0300 union), then the REAL 0337 is applied and driven by the REAL TS builder.
// Two-session lock proof (capture vs builder interleavings): scripts/sim/fact-0337-lock-check-management.mjs,
// sim only, run by CC before 0337 reaches prod.
import { createHash, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { buildOrderDay, FACT_BUILDER_VERSION, type OrderDaySource } from "@/lib/facts/order-facts-shared";
import { compareDaily, factDaily, type DailyMoney, type FactCheckClassRow, type FactRefundReadRow } from "@/lib/facts/parity-shared";

import { M0337, freshParents as parents } from "./helpers/fact-0337-parents";

const LOC = "00000000-0000-4000-8000-000000000001";
const D1 = "2026-10-01", D2 = "2026-10-02", D3 = "2026-10-03", D4 = "2026-10-04", D5 = "2026-10-05";
const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const ACC = { version: 1, gross_cents: 1000, discounts_comps_cents: 0, voids_cents: 0, service_charges_cents: 0, pre_refund_cents: 1000,
  line_prices: { v: 1, selections_present: true, heads: 1, uncaptured_heads: 0, mixed_heads: 0, net_cents: 1000,
    source_complete: true, net_complete: true, gross_complete: true, receipt_line_complete: true } };

interface EntryOpts { modified?: string; checks?: number; refund?: boolean; undatedRefund?: boolean; amount?: number; refundDate?: string;
  /** 0247 candidate C: an accounted check's payment with NO refund evidence and an unknown (NULL) sales refund. */
  unknownRefund?: "null_status" | "none_status"; unaccounted?: boolean }
function entry(guid: string, date: string, o: EntryOpts = {}) {
  const checks = Array.from({ length: o.checks ?? 1 }, (_, i) => ({ check_guid: `${guid}-c${i}`, amount_cents: o.amount ?? 1000,
    tax_cents: 100, total_cents: 1100, voided: false, deleted: false, accounting: o.unaccounted ? null : ACC }));
  const order = { order_guid: guid, business_date: date, opened_at: `${date}T16:00:00Z`, closed_at: null, paid_at: null,
    modified_at: o.modified ?? `${date}T17:00:00Z`, promised_at: null, source: "In Store", revenue_center_guid: null,
    dining_option_guid: "dine", server_guid: "srv", deleted: false, voided: false, excess_food: false,
    third_party_provider_guid: null, third_party_provider_name: null,
    selection_units: checks.map((c) => ({ check_guid: c.check_guid, selection_guid: `${c.check_guid}-s`, parent_selection_guid: null,
      item_guid: "item", name: "Sub", quantity: 1, voided: false, deleted: false, price_v: 1, net_cents: 1000, gross_cents: 1000,
      receipt_line_cents: 1000, tax_cents: 100, tax_inclusion: "NOT_INCLUDED", selection_type: "NONE", deferred: false })) };
  const payments = (o.refund || o.undatedRefund) && checks[0] ? [{ check_guid: checks[0].check_guid, payment_guid: `${guid}-p`, type: "CREDIT",
    payment_status: "CAPTURED", refund_status: "PARTIAL", amount_cents: 1100, tip_cents: 0, paid_business_date: date,
    refund_amount_cents: 300, refund_tip_cents: 0, refund_business_date: o.undatedRefund ? null : (o.refundDate ?? date), void_business_date: null, server_guid: null,
    sales_refund_cents: o.undatedRefund ? null : 300 }]
    : o.unknownRefund && checks[0] ? [{ check_guid: checks[0].check_guid, payment_guid: `${guid}-p`, type: "CREDIT",
      payment_status: "CAPTURED", refund_status: o.unknownRefund === "none_status" ? "NONE" : null, amount_cents: 1100, tip_cents: 0,
      paid_business_date: date, refund_amount_cents: null, refund_tip_cents: null, refund_business_date: null, void_business_date: null,
      server_guid: null, sales_refund_cents: null }] : [];
  const body = { order, checks, discounts: [], service_charges: [], payments };
  return { content_hash: hash(body), ...body };
}

let db: PGlite;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
async function fullCapture(date: string, entries: ReturnType<typeof entry>[], startedAt = new Date().toISOString()) {
  const run = randomUUID();
  await q("insert into toast_capture_runs(id, location_id, business_date, started_at) values($1,$2,$3,$4)", [run, LOC, date, startedAt]);
  await q("select toast_capture_page($1,$2,$3,1,$4::jsonb)", [run, LOC, date, JSON.stringify(entries)]);
  await q("select toast_capture_finish($1,$2,$3,1)", [run, LOC, date]);
  return run;
}
async function modifiedSave(entries: ReturnType<typeof entry>[]) {
  await q("insert into toast_modified_cursors(location_id, coverage_start) values($1, '2026-01-01') on conflict do nothing", [LOC]);
  return q("select toast_modified_save($1,$2::jsonb) n", [LOC, JSON.stringify(entries)]);
}
async function source(date: string): Promise<OrderDaySource> {
  const orders = await q<OrderDaySource["orders"][number]>(`select o.id snapshot_id, o.order_guid, o.opened_at, o.paid_at, o.closed_at, o.promised_at,
    o.source, o.revenue_center_guid, o.dining_option_guid, o.server_guid, o.deleted, o.voided, o.excess_food, o.third_party_provider_guid,
    o.third_party_provider_name, o.selection_units from toast_order_latest_pointers p join toast_orders o on o.id = p.snapshot_id
    where p.location_id = $1 and p.business_date = $2`, [LOC, date]);
  const iso = (v: unknown) => v == null ? null : new Date(v as string).toISOString();
  for (const o of orders) { o.opened_at = iso(o.opened_at); o.promised_at = iso(o.promised_at); o.paid_at = iso(o.paid_at); o.closed_at = iso(o.closed_at); }
  const ids = orders.map((o) => o.snapshot_id);
  const checks = await q<OrderDaySource["checks"][number]>("select snapshot_id, check_guid, amount_cents, tax_cents, total_cents, voided, deleted, accounting from toast_order_checks where snapshot_id = any($1::uuid[])", [ids]);
  const payments = await q<OrderDaySource["payments"][number]>(`select snapshot_id, check_guid, payment_guid, payment_status, refund_status, refund_amount_cents,
    refund_tip_cents, to_char(refund_business_date,'YYYY-MM-DD') refund_business_date, sales_refund_cents from toast_payments where snapshot_id = any($1::uuid[])`, [ids]);
  const discounts = await q<OrderDaySource["discounts"][number]>("select snapshot_id, check_guid, selection_guid, amount_cents from toast_check_discounts where snapshot_id = any($1::uuid[])", [ids]);
  return { locationId: LOC, businessDate: date, orders, checks, discounts, payments };
}
async function fingerprint(date: string) {
  return (await q<{ f: string }>("select fact_order_day_fingerprint($1,$2,$3) f", [LOC, date, FACT_BUILDER_VERSION]))[0]!.f;
}
async function replace(date: string, payload: never, fp?: string) {
  return q<{ r: Record<string, unknown> }>("select fact_replace_order_day($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb) r",
    [LOC, date, FACT_BUILDER_VERSION, fp ?? await fingerprint(date), JSON.stringify((payload as { orders: unknown }).orders),
      JSON.stringify((payload as { checks: unknown }).checks), JSON.stringify((payload as { lines: unknown }).lines),
      JSON.stringify((payload as { refunds: unknown }).refunds)]);
}
async function build(date: string) {
  const fp = await fingerprint(date);
  return (await replace(date, buildOrderDay(await source(date)) as never, fp))[0]!.r;
}
async function stale(floor = "2026-01-01") {
  return (await q<{ day_business_date: string }>("select to_char(day_business_date,'YYYY-MM-DD') day_business_date from fact_order_days_stale($2, 1000, $1)", [FACT_BUILDER_VERSION, floor]))
    .map((r) => r.day_business_date).sort();
}
const coverage = async (date: string) => (await q("select * from fact_day_coverage where location_id=$1 and business_date=$2", [LOC, date]))[0];
const factCounts = async (date: string) => (await q<{ n: number }>(`select (select count(*) from fact_order_snapshot where business_date=$1)
  + (select count(*) from fact_order_check where business_date=$1) + (select count(*) from fact_order_line where business_date=$1) n`, [date]))[0]!.n;
async function refuses(p: Promise<unknown>, code: string, on: PGlite = db) {
  try { await expect(p).rejects.toThrow(code); }
  finally { if (on.isInTransaction()) await on.exec("rollback"); }
}

async function freshParents() {
  const d = await parents();
  await d.query("insert into locations(id) values($1)", [LOC]);
  return d;
}

beforeAll(async () => {
  db = await freshParents();
  await db.exec(M0337);
}, 120_000);

describe("0337 pre-flight", () => {
  it("refuses a cron union that is not 0300's six jobs, leaving no partial DDL", async () => {
    const d = await freshParents();
    await d.exec("alter table cron_route_leases drop constraint cron_route_leases_job_check, add constraint cron_route_leases_job_check check(job in ('toast-sales-today'))");
    await refuses(d.exec(M0337), "not the 0300 six-job union", d);
    expect((await d.query("select to_regclass('public.fact_day_coverage') r")).rows[0]).toEqual({ r: null });
  }, 60_000);
  it("refuses a second apply", async () => {
    await refuses(db.exec(M0337), "already applied");
  });
});

describe("build, manifest, idempotence", () => {
  it("a completed day with ordinary AND zero-check orders builds (Astra r3 P2 #1)", async () => {
    await fullCapture(D1, [entry("a1", D1, { refund: true }), entry("a2", D1, { checks: 2 }), entry("z1", D1, { checks: 0 })]);
    expect(await stale()).toContain(D1);
    const r = await build(D1);
    expect(r).toMatchObject({ state: "covered", orders: 3, checks: 3, lines: 3, refunds: 1, missing_pointer_count: 0 });
    expect(await q("select order_guid, check_count, run_member from fact_order_snapshot where business_date=$1 order by order_guid", [D1]))
      .toEqual([{ order_guid: "a1", check_count: 1, run_member: true }, { order_guid: "a2", check_count: 2, run_member: true },
        { order_guid: "z1", check_count: 0, run_member: true }]);
    expect(await stale()).not.toContain(D1);
  });
  it("is idempotent: the same input changes nothing but built_at", async () => {
    const snap = async () => q(`select (select json_agg(c order by order_guid, check_guid) from fact_order_check c where business_date=$1) c,
      (select json_agg(l order by selection_guid) from fact_order_line l where business_date=$1) l,
      (select row_to_json(x)::jsonb - 'built_at' from fact_day_coverage x where business_date=$1) v`, [D1]);
    const before = await snap();
    await build(D1);
    expect(await snap()).toEqual(before);
  });
});

describe("refusals change nothing", () => {
  it("fact_open_day for today (ET)", async () => {
    const today = (await q<{ d: string }>("select to_char((clock_timestamp() at time zone 'America/New_York')::date,'YYYY-MM-DD') d"))[0]!.d;
    await refuses(replace(today, { orders: [], checks: [], lines: [], refunds: [] } as never), "fact_open_day");
  });
  it("fact_stale on a fingerprint the source no longer has", async () => {
    const before = await factCounts(D1);
    await refuses(replace(D1, buildOrderDay(await source(D1)) as never, "0".repeat(32)), "fact_stale");
    expect(await factCounts(D1)).toBe(before);
  });
  it("fact_stale when the manifest misses an order, or names one that is not in the pointer set", async () => {
    const p = buildOrderDay(await source(D1));
    const zero = p.orders.find((o) => o.order_guid === "z1")!;
    await refuses(replace(D1, { ...p, orders: p.orders.filter((o) => o !== zero) } as never), "fact_stale");
    await refuses(replace(D1, { ...p, orders: [...p.orders.filter((o) => o !== zero), { ...zero, order_guid: "ghost" }] } as never), "fact_stale");
    await refuses(replace(D1, { ...p, orders: [...p.orders.filter((o) => o !== zero), p.orders[0]!] } as never), "fact_stale");
  });
  it("fact_payload_mismatch when a check is missing or a check count lies", async () => {
    const p = buildOrderDay(await source(D1));
    await refuses(replace(D1, { ...p, checks: p.checks.slice(1), lines: p.lines.filter((l) => l.check_guid !== p.checks[0]!.check_guid),
      refunds: p.refunds.filter((r) => r.check_guid !== p.checks[0]!.check_guid) } as never), "fact_payload_mismatch");
    await refuses(replace(D1, { ...p, orders: p.orders.map((o) => o.order_guid === "z1" ? { ...o, check_count: 1 } : o) } as never), "fact_payload_mismatch");
  });
  it("a check without its accounting can never claim line completeness (unknown is never 0)", async () => {
    const p = buildOrderDay(await source(D1));
    const bad = { ...p, checks: p.checks.map((c, i) => i === 0 ? { ...c, line_price_state: "unpriced" } : c) };
    await expect(replace(D1, bad as never)).rejects.toThrow(/check constraint/);
  });
});

describe("coverage cases (plan r3 §1 P2 #6)", () => {
  it("a successful empty capture is covered, zero", async () => {
    await fullCapture(D2, []);
    expect(await stale()).toContain(D2);
    expect(await build(D2)).toMatchObject({ state: "covered_zero", orders: 0 });
  });
  it("a pointer-only day (modified capture, no completed run) is stored uncovered, never zero", async () => {
    // 0237 saves only an order whose payments changed, so the new order carries one.
    expect((await modifiedSave([entry("m1", D3, { refund: true })]))[0]).toEqual({ n: 1 });
    expect(await stale()).toContain(D3);
    expect(await build(D3)).toMatchObject({ state: "uncovered", orders: 1, missing_pointer_count: null });
    expect(await coverage(D3)).toMatchObject({ run_id: null, run_orders: null });
  });
  it("a modified_completed run alone moves the pointer, not the coverage: the day rebuilds on the same run", async () => {
    const run = (await coverage(D1))!.run_id;
    await modifiedSave([entry("a2", D1, { checks: 2, amount: 1500, refund: true, modified: `${D1}T18:00:00Z` })]);
    expect(await stale()).toContain(D1);
    await build(D1);
    expect(await coverage(D1)).toMatchObject({ run_id: run, state: "covered" });
    expect(await stale()).not.toContain(D1);
  });
  it("a completion whose pointer upserts all lose still changes the run: rebuilt, missing pointers recounted", async () => {
    // A later full run that saw only a1, with an OLDER modified_at: no pointer moves, but it is the latest completed run.
    await fullCapture(D1, [entry("a1", D1, { modified: `${D1}T10:00:00Z`, amount: 999 })]);
    expect(await stale()).toContain(D1);
    expect(await build(D1)).toMatchObject({ state: "covered", orders: 3, missing_pointer_count: 2 });
    expect(await q("select order_guid, run_member from fact_order_snapshot where business_date=$1 order by order_guid", [D1]))
      .toEqual([{ order_guid: "a1", run_member: true }, { order_guid: "a2", run_member: false }, { order_guid: "z1", run_member: false }]);
  });
  it("an order moved from day A to day B makes both days stale; both rebuild", async () => {
    await fullCapture(D4, [entry("mv", D4), entry("stay", D4)]);
    await build(D4);
    await fullCapture(D5, [entry("mv", D5, { modified: `${D5}T20:00:00Z` })]);
    expect(await stale()).toEqual(expect.arrayContaining([D4, D5]));
    await build(D4); await build(D5);
    expect(await q("select business_date::text d, order_guid from fact_order_snapshot where order_guid in ('mv','stay') order by order_guid"))
      .toEqual([{ d: D5, order_guid: "mv" }, { d: D4, order_guid: "stay" }]);
    expect(await stale()).toEqual([]);
  });
  it("the diff is exactly the fingerprint difference over every candidate day", async () => {
    await fullCapture(D2, [entry("late", D2)]);
    const days = (await q<{ d: string }>(`select distinct business_date::text d from (select business_date from toast_order_latest_pointers
      union select business_date from toast_capture_runs where status='completed' union select business_date from fact_day_coverage) x`)).map((r) => r.d);
    const expected: string[] = [];
    for (const d of days) if ((await coverage(d))?.source_fingerprint !== await fingerprint(d)) expected.push(d);
    expect(await stale()).toEqual(expected.sort());
    expect(expected).toEqual([D2]);
    await build(D2);
  });
  it("a builder-version bump makes every built day stale", async () => {
    const all = (await q<{ n: number }>("select count(*)::int n from fact_order_days_stale('2026-01-01', 1000, 'orders-v999')"))[0]!.n;
    expect(all).toBe((await q<{ n: number }>("select count(*)::int n from fact_day_coverage"))[0]!.n);
  });
});

describe("read-time classification (double-count law)", () => {
  it("an ezCater-linked check is 'ezcater_linked' and its refund is not a sales refund", async () => {
    const c = (await q<{ snapshot_id: string; check_guid: string }>("select snapshot_id, check_guid from fact_order_check where business_date=$1 and order_guid='a2' order by check_guid limit 1", [D1]))[0]!;
    await q("insert into ezcater_current_toast_links values($1,$2,$3,$4)", [LOC, D1, c.snapshot_id, c.check_guid]);
    const classes = await q<{ check_guid: string; sale_class: string }>("select check_guid, sale_class from fact_sales_check_classes($1,$2,$3) order by check_guid", [LOC, D1, D1]);
    expect(classes.find((x) => x.check_guid === c.check_guid)!.sale_class).toBe("ezcater_linked");
    expect(classes.filter((x) => x.sale_class === "sale")).toHaveLength(2);
    // a1's refund (a sale) stays; a2's refund is on the linked check, so it is not a sales refund.
    expect(await q("select count(*)::int n from fact_refund where order_business_date=$1", [D1])).toEqual([{ n: 2 }]);
    expect(await q("select refund_business_date::text d, sales_refund_cents::int s from fact_sales_refund_rows($1,$2,$3)", [LOC, D1, D1]))
      .toEqual([{ d: D1, s: 300 }]);
  });
  it("PARITY: the facts reproduce the REAL sales_report_daily (0247) classes and refunds over the window", async () => {
    // An undated refund (sales refund unknown) on a sale BEFORE the window: uncertainty on every window day.
    await fullCapture("2026-09-28", [entry("pre", "2026-09-28", { undatedRefund: true })]);
    await build("2026-09-28");
    expect(await stale()).toEqual([]);
    const report = (await q<{ r: DailyMoney }>("select sales_report_daily($1,$2,$3) r", [LOC, D1, D5]))[0]!.r;
    const checks = await q<FactCheckClassRow>("select business_date::text business_date, order_guid, check_guid, sale_class, amount_cents::int, tax_cents::int, gross_cents::int, discounts_comps_cents::int, voids_cents::int, service_charges_cents::int, pre_refund_cents::int from fact_sales_check_classes($1,$2,$3)", [LOC, D1, D5]);
    const refunds = await q<FactRefundReadRow>("select order_business_date::text order_business_date, refund_business_date::text refund_business_date, refund_cents::int, refund_tip_cents::int, sales_refund_cents::int from fact_sales_refund_rows($1,$2,$3)", [LOC, D1, D5]);
    expect(report.classes.length).toBeGreaterThan(0);
    expect(report.refunds.filter((r) => r.sales_refund_missing === 1 && r.count === 0)).toHaveLength(5);
    expect(compareDaily(report, factDaily(checks, refunds, D1, D5))).toEqual([]);
  });
  it("the read helpers keep 0232's 31-day guard", async () => {
    await refuses(q("select * from fact_sales_check_classes($1,'2026-01-01','2026-03-01')", [LOC]), "sales_report_window_too_wide");
  });
});

describe("days older than the floor (review r1 #1: a late refund is never stale forever)", () => {
  const OLD = "2025-11-20";
  it("a refund dated inside the window on an order older than the floor makes that order's day stale, and the rebuild carries it", async () => {
    await fullCapture(OLD, [entry("old1", OLD)]);
    expect(await stale()).not.toContain(OLD);
    // Modified capture records a refund dated D2 against an order of a day older than the floor.
    expect((await modifiedSave([entry("old1", OLD, { refund: true, refundDate: D2, modified: `${D2}T15:00:00Z` })]))[0]).toEqual({ n: 1 });
    expect(await stale()).toContain(OLD);
    await build(OLD);
    expect(await stale()).not.toContain(OLD);
    expect(await q("select order_business_date::text o, refund_business_date::text r, sales_refund_cents::int s from fact_refund where order_guid='old1'"))
      .toEqual([{ o: OLD, r: D2, s: 300 }]);
    expect(await q("select order_business_date::text o, refund_business_date::text r from fact_sales_refund_rows($1,$2,$3)", [LOC, D2, D2]))
      .toContainEqual({ o: OLD, r: D2 });
  });
  it("an undated refund on an order older than the floor (uncertainty on every window day) also makes its day stale", async () => {
    const OLD2 = "2025-11-21";
    await fullCapture(OLD2, [entry("old2", OLD2)]);
    await modifiedSave([entry("old2", OLD2, { undatedRefund: true, modified: `${D2}T15:30:00Z` })]);
    expect(await stale()).toContain(OLD2);
    await build(OLD2);
    expect(await stale()).not.toContain(OLD2);
  });
  it("a day already built keeps its invalidation after the floor passes it", async () => {
    expect(await stale("2026-10-10")).toEqual([]);
    await modifiedSave([entry("stay", D4, { refund: true, refundDate: D4, modified: `${D4}T21:00:00Z` })]);
    // The floor has moved past D4 and the refund is dated D4 (outside the window): the stored coverage row keeps D4 maintained.
    expect(await stale("2026-10-10")).toEqual([D4]);
    await build(D4);
    expect(await stale("2026-10-10")).toEqual([]);
  });
  it("an old day with no coverage and no refund touching the window stays out of the diff", async () => {
    await fullCapture("2025-11-22", [entry("old3", "2025-11-22", { refund: true })]);
    expect(await stale()).not.toContain("2025-11-22");
  });
});

describe("days older than the floor: 0247 candidate C (review r2: accounted-check uncertainty)", () => {
  const dailyParity = async () => {
    const report = (await q<{ r: DailyMoney }>("select sales_report_daily($1,$2,$3) r", [LOC, D1, D5]))[0]!.r;
    const checks = await q<FactCheckClassRow>("select business_date::text business_date, order_guid, check_guid, sale_class, amount_cents::int, tax_cents::int, gross_cents::int, discounts_comps_cents::int, voids_cents::int, service_charges_cents::int, pre_refund_cents::int from fact_sales_check_classes($1,$2,$3)", [LOC, D1, D5]);
    const refunds = await q<FactRefundReadRow>("select order_business_date::text order_business_date, refund_business_date::text refund_business_date, refund_cents::int, refund_tip_cents::int, sales_refund_cents::int from fact_sales_refund_rows($1,$2,$3)", [LOC, D1, D5]);
    return { report, facts: factDaily(checks, refunds, D1, D5) };
  };
  const missing = (rows: DailyMoney["refunds"]) => rows.map((r) => `${r.business_date}:${r.sales_refund_missing}`).sort();
  it.each([["null_status", "2025-11-23"], ["none_status", "2025-11-24"]] as const)(
    "an accounted check's payment with an unknown sales refund (%s) is discovered, built, and matches the real report's missing counts", async (kind, OLD) => {
      // Never built, older than the floor, captured once: no dated refund and no refund evidence.
      await fullCapture(OLD, [entry(`c-${kind}`, OLD, { unknownRefund: kind })]);
      const before = await dailyParity();
      // 0247 already counts it as a missing sales refund on every window day; until built, the facts do not.
      expect(compareDaily(before.report, before.facts)).not.toEqual([]);
      expect(await stale()).toContain(OLD);
      await build(OLD);
      expect(await stale()).not.toContain(OLD);
      expect(await q("select order_business_date::text o, refund_business_date r, sales_refund_cents s, check_accounting_present a from fact_refund where order_guid=$1", [`c-${kind}`]))
        .toEqual([{ o: OLD, r: null, s: null, a: true }]);
      const after = await dailyParity();
      expect(compareDaily(after.report, after.facts)).toEqual([]);
      expect(missing(after.facts.refunds)).toEqual(missing(after.report.refunds));
    });
  it("the same payment on an UNACCOUNTED (legacy) check is not uncertainty in 0247, so it stays out of the diff", async () => {
    const OLD = "2025-11-25";
    await fullCapture(OLD, [entry("c-legacy", OLD, { unknownRefund: "null_status", unaccounted: true })]);
    expect(await stale()).not.toContain(OLD);
    const p = await dailyParity();
    expect(compareDaily(p.report, p.facts)).toEqual([]);
  });
  it("candidate C on a superseded snapshot does not make its day stale (bound to the current pointer)", async () => {
    const OLD = "2025-11-26";
    await fullCapture(OLD, [entry("c-moved", OLD, { unknownRefund: "null_status" })]);
    // A newer snapshot of the same order carries no payment: the pointer moves off the candidate.
    await fullCapture(OLD, [entry("c-moved", OLD, { modified: `${OLD}T23:00:00Z` })]);
    expect(await q("select count(*)::int n from toast_order_latest_pointers p join toast_payments pm on pm.snapshot_id = p.snapshot_id where p.order_guid='c-moved'"))
      .toEqual([{ n: 0 }]);
    expect(await stale()).not.toContain(OLD);
  });
});

describe("ceilings and cron", () => {
  it("no fact table references toast_orders (the duplicate-snapshot cleanup deletes snapshots)", async () => {
    expect(await q(`select conrelid::regclass::text t from pg_constraint where contype='f' and confrelid='public.toast_orders'::regclass
      and conrelid::regclass::text like 'fact_%'`)).toEqual([]);
  });
  it("anon / authenticated cannot read a fact or call a fact RPC; service_role cannot write a fact", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await refuses(q("select * from fact_order_check"), "permission denied");
      await refuses(q("select fact_order_days_stale('2026-01-01', 10, 'orders-v1')"), "permission denied");
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    expect(await q("select count(*) from fact_day_coverage")).toHaveLength(1);
    await refuses(q("insert into fact_day_coverage(location_id) values($1)", [LOC]), "permission denied");
    await refuses(q("delete from fact_order_snapshot"), "permission denied");
    await refuses(q("truncate fact_refund"), "permission denied");
    await db.exec("reset role");
  });
  it("claim_cron_route knows fact-build and keeps the 0300 six", async () => {
    for (const job of ["fact-build", "toast-sales-today", "meta-leads"]) expect(await q("select claim_cron_route($1) c", [job])).toEqual([{ c: true }]);
    expect(await q("select claim_cron_route('fact-build') c")).toEqual([{ c: false }]);
    await refuses(q("select claim_cron_route('nope')"), "invalid_cron_route");
  });
});

describe("the builder's rows ARE the table columns (no silently dropped key)", () => {
  const cols = (name: string) => {
    const m = M0337.match(new RegExp(`create table public\\.${name} \\(([\\s\\S]*?)\\n\\);`, "i"))![1]!;
    return m.split("\n").flatMap((line) => line.trim().split(/,\s*(?=[a-z_]+ (?:uuid|text|date|bigint|boolean|integer|smallint|numeric|timestamptz)\b)/))
      .map((s) => s.trim().match(/^([a-z_]+) (uuid|text|date|bigint|boolean|integer|smallint|numeric|timestamptz)\b/)?.[1]).filter(Boolean).sort();
  };
  it.each([["fact_order_snapshot", "orders", ["location_id", "business_date", "run_member"]],
    ["fact_order_check", "checks", ["location_id", "business_date"]],
    ["fact_order_line", "lines", ["location_id", "business_date"]],
    ["fact_refund", "refunds", ["location_id", "order_business_date"]]] as const)("%s", async (table, key, stamped) => {
    const p = buildOrderDay(await source(D1));
    const row = (p[key] as unknown as Record<string, unknown>[])[0]!;
    expect([...Object.keys(row), ...stamped].sort()).toEqual(cols(table));
  });
});
