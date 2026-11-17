// Toast churn fix PR 1: scripts/toast-hash-acceptance.sql (read-only) run in PGlite against the REAL
// 0221 / 0225 / 0229 / 0239 SQL, extracted verbatim from the migration files.
// - Metric A must catch churn AFTER the first canonical version (Astra r2 P2 #4): A -> B1 -> B2 -> B1
//   with B1/B2 sharing a modified_at and both already stored (no insert in W) is a CHURN row.
// - The recovery check (Astra r2 P1): pass 2's republish clears reconciled_day_sales_oz
//   (0229:205 retire + 0229:237 insert without it); only record_ezcater_reconciled_comparison
//   (0229:257) restores it. populated -> republish -> cleared -> record -> restored, and the
//   comparisons query reports covered dates vs the deferred list.
// - Same-modified_at is not churn by itself (prod 2026-11-17: 86 "CHURN" rows were all
//   toast_payments.payment_status AUTHORIZED -> CAPTURED at the nightly card batch, with Toast leaving
//   modified_at unchanged). A same-modified version change is CHURN only when the two snapshots' stored
//   content is equal ignoring storage identity, array order and synthetic ordinals; otherwise it is
//   EDIT_SAME_MODIFIED (reported, not a failure).
// - @query inserts is the SCOPED form (first_seen only over the window's snapshots and their peers):
//   identical to the old whole-table form, which exceeded the Management API's ~120 s gateway on prod.
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = (f: string) => readFileSync(f, "utf8");
const m0221 = read("supabase/migrations/0221_toast_order_capture.sql");
const m0225 = read("supabase/migrations/0225_ezcater_pass2.sql");
const m0229 = read("supabase/migrations/0229_ezcater_toast_reconcile.sql");
const m0239 = read("supabase/migrations/0239_sales_true_net.sql");
const cut = (sql: string, start: string, end: string) => {
  const i = sql.indexOf(start); expect(i, start).toBeGreaterThan(-1);
  const j = sql.indexOf(end, i); expect(j, end).toBeGreaterThan(i);
  return sql.slice(i, j + end.length);
};
const lineOf = (sql: string, n: number) => sql.split("\n")[n - 1]!;
const acceptance = read("scripts/toast-hash-acceptance.sql");
const query = (name: string, params: Record<string, string>) => {
  const body = cut(acceptance, `-- @query ${name}\n`, ";\n");
  return bind(body, params);
};
const bind = (body: string, params: Record<string, string>) =>
  Object.entries(params).reduce((sql, [k, v]) => sql.replaceAll(`:${k}::`, `'${v}'::`), body);
/** The pre-amendment @query inserts, verbatim (whole-table first_seen, no content equivalence). */
const OLD_INSERTS = `with first_seen as (
  select ro.snapshot_id, min(r.started_at) as first_seen
  from public.toast_capture_run_orders ro join public.toast_capture_runs r on r.id = ro.run_id
  group by ro.snapshot_id
), fresh as (
  select o.id, o.location_id, o.order_guid, o.business_date, o.modified_at, f.first_seen
  from public.toast_orders o join first_seen f on f.snapshot_id = o.id
  where f.first_seen >= :w_from::timestamptz and f.first_seen < :w_to::timestamptz
), classed as (
  select fr.location_id, fr.business_date,
    case
      when exists (select 1 from public.toast_orders p join first_seen pf on pf.snapshot_id = p.id
                   where p.location_id = fr.location_id and p.order_guid = fr.order_guid and p.id <> fr.id
                     and (pf.first_seen, p.id) < (fr.first_seen, fr.id) and p.modified_at is not distinct from fr.modified_at
                     and pf.first_seen >= :w_from::timestamptz) then 'churn'
      when exists (select 1 from public.toast_orders p join first_seen pf on pf.snapshot_id = p.id
                   where p.location_id = fr.location_id and p.order_guid = fr.order_guid and p.id <> fr.id
                     and pf.first_seen < :w_from::timestamptz and p.modified_at is not distinct from fr.modified_at) then 'transition'
      when exists (select 1 from public.toast_orders p join first_seen pf on pf.snapshot_id = p.id
                   where p.location_id = fr.location_id and p.order_guid = fr.order_guid and p.id <> fr.id
                     and (pf.first_seen, p.id) < (fr.first_seen, fr.id)) then 'edit'
      else 'new_order'
    end as kind
  from fresh fr
)
select location_id, business_date,
       count(*) filter (where kind = 'transition') as transition,
       count(*) filter (where kind = 'churn') as churn,
       count(*) filter (where kind = 'edit') as edit,
       count(*) filter (where kind = 'new_order') as new_order
from classed
group by location_id, business_date
order by location_id, business_date`;
/** The new @query inserts with its two scoping filters removed: first_seen over EVERY membership. */
const SCOPE_FILTERS = ["where ro.snapshot_id in (select snapshot_id from cand) ", "where ro.snapshot_id in (select id from peer_ids) "];
const unscopedInserts = (params: Record<string, string>) => {
  const body = cut(acceptance, "-- @query inserts\n", ";\n");
  for (const f of SCOPE_FILTERS) expect(body, f).toContain(f);
  return bind(SCOPE_FILTERS.reduce((sql, f) => sql.replace(f, ""), body), params);
};
type InsertRow = { location_id: string; business_date: unknown; transition: number; churn: number; edit_same_modified?: number; edit: number; new_order: number };
/** [shop, day, transition, churn, edit_same_modified, edit, new_order] */
const insertRows = async (sql: string) => (await db.query<InsertRow>(sql)).rows
  .map((r) => [r.location_id, String(r.business_date), Number(r.transition), Number(r.churn), Number(r.edit_same_modified ?? 0), Number(r.edit), Number(r.new_order)]);

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  const table = (name: string) => cut(m0221, `create table public.${name} (`, ");\n");
  const shadow = cut(m0225, "create table public.ezcater_shadow_depletion (", ");\n")
    .replace(/ references public\.\w+\(id\)/g, "").replace(/,\n foreign key\(order_id,snapshot_id\)[^\n]*/, "");
  // 0229's cited lines, verbatim: the retire (205), the shadow insert loop (236-240), the comparison writer (246-261).
  expect(lineOf(m0229, 205)).toContain("update public.ezcater_shadow_depletion set is_current=false");
  expect(lineOf(m0229, 237)).toContain("insert into public.ezcater_shadow_depletion(");
  expect(lineOf(m0229, 257)).toContain("update public.ezcater_shadow_depletion s set reconciled_day_sales_oz");
  const republish = m0229.split("\n").slice(235, 240).join("\n");
  await db.exec(`create table public.locations(id uuid primary key);
    ${["toast_capture_runs", "toast_orders", "toast_order_checks", "toast_check_discounts", "toast_check_service_charges", "toast_payments",
      "toast_capture_pages", "toast_capture_run_orders", "toast_order_latest_pointers"].map(table).join("\n")}
    ${cut(m0239, "alter table public.toast_order_checks add column accounting jsonb", ";\n")}
    ${cut(m0239, "alter table public.toast_payments add column sales_refund_cents bigint", ";\n")}
    create table public.ezcater_orders(id uuid primary key, snapshot_id uuid not null, event_date date not null);
    ${shadow}
    ${lineOf(m0229, 245)}
    ${cut(m0229, "create function public.record_ezcater_reconciled_comparison(", "end $$;")}
    create function public.republish_shadow(p_order_id uuid, p_location_id uuid, p_payload jsonb) returns void language plpgsql as $$
    declare o record; r jsonb;
    begin
      select * into o from public.ezcater_orders where id = p_order_id;
      ${lineOf(m0229, 205)}
      ${republish}
    end $$;`);
}, 120_000);

const shop = "00000000-0000-4000-8000-0000000000a1";
const W = { w_from: "2026-11-20T13:00:00Z", w_to: "2026-11-22T13:00:00Z" };
let n = 0;
const uuid = () => `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`;
type Content = {
  units?: Record<string, unknown>[];
  checks?: { check_guid: string; amount_cents: number; accounting?: Record<string, unknown> }[];
  discounts?: { check_guid: string; ordinal: number; applied_discount_guid: string; amount_cents: number }[];
  charges?: { check_guid: string; ordinal: number; name: string; amount_cents: number }[];
  payments?: { check_guid: string; payment_guid: string; payment_status: string; amount_cents: number }[];
};
const snapshot = async (guid: string, modified: string | null, hash: string, content: Content = {}, loc = shop) => {
  const id = uuid();
  await db.query(`insert into public.toast_orders(id,location_id,order_guid,business_date,content_hash,modified_at,deleted,voided,excess_food,selection_units)
    values($1,$2,$3,'2026-11-20',$4,$5,false,false,false,$6::jsonb)`, [id, loc, guid, hash.padEnd(64, "0"), modified, JSON.stringify(content.units ?? [])]);
  for (const c of content.checks ?? []) await db.query("insert into public.toast_order_checks(snapshot_id,check_guid,amount_cents,voided,deleted,accounting) values($1,$2,$3,false,false,$4::jsonb)",
    [id, c.check_guid, c.amount_cents, c.accounting ? JSON.stringify(c.accounting) : null]);
  for (const d of content.discounts ?? []) await db.query("insert into public.toast_check_discounts(snapshot_id,check_guid,ordinal,applied_discount_guid,amount_cents) values($1,$2,$3,$4,$5)",
    [id, d.check_guid, d.ordinal, d.applied_discount_guid, d.amount_cents]);
  for (const c of content.charges ?? []) await db.query("insert into public.toast_check_service_charges(snapshot_id,check_guid,ordinal,name,amount_cents,gratuity,taxable) values($1,$2,$3,$4,$5,false,false)",
    [id, c.check_guid, c.ordinal, c.name, c.amount_cents]);
  for (const p of content.payments ?? []) await db.query("insert into public.toast_payments(snapshot_id,check_guid,payment_guid,payment_status,amount_cents) values($1,$2,$3,$4,$5)",
    [id, p.check_guid, p.payment_guid, p.payment_status, p.amount_cents]);
  return id;
};
/** One completed one-page run started at `at`, naming `members` (order guid -> snapshot id). */
const capture = async (at: string, members: Record<string, string>, loc = shop) => {
  const run = uuid();
  await db.query("insert into public.toast_capture_runs(id,location_id,business_date,started_at,finished_at,status,pages,orders) values($1,$2,'2026-11-20',$3,$3,'completed',1,$4)",
    [run, loc, at, Object.keys(members).length]);
  await db.query("insert into public.toast_capture_pages(run_id,page,orders,payload_hash) values($1,1,$2,'x')", [run, Object.keys(members).length]);
  for (const [guid, id] of Object.entries(members)) {
    await db.query("insert into public.toast_capture_run_orders(run_id,snapshot_id,location_id,business_date,order_guid,page) values($1,$2,$3,'2026-11-20',$4,1)", [run, id, loc, guid]);
  }
};

describe("acceptance SQL on the real capture tables", () => {
  it("churn: A -> B1 -> B2 -> B1 inside W (B1/B2 same modified_at, both pre-existing) is caught; a settled order and a real edit are not", async () => {
    await db.query("insert into public.locations(id) values($1)", [shop]);
    const t1 = "2026-11-20T10:00:00Z", t2 = "2026-11-20T11:00:00Z";
    // Order X: legacy A (version 1), then version 2 stored twice BEFORE W (B1, B2).
    const a = await snapshot("X", t1, "a1"), b1 = await snapshot("X", t2, "b1"), b2 = await snapshot("X", t2, "b2");
    // Order Y: legacy L before W, canonical C first seen in W (the allowed transition), then stable.
    const l = await snapshot("Y", t1, "c1"), c = await snapshot("Y", t1, "c2");
    // Order Z: v1 before W, a real edit inside W.
    const z1 = await snapshot("Z", t1, "d1"), z2 = await snapshot("Z", t2, "d2");
    await capture("2026-11-19T12:00:00Z", { X: a, Y: l, Z: z1 });
    await capture("2026-11-20T12:00:00Z", { X: b1 });
    await capture("2026-11-20T12:30:00Z", { X: b2 });
    await capture("2026-11-20T14:00:00Z", { X: a, Y: c, Z: z1 });   // in W: X back on version 1 (A), Y's transition
    await capture("2026-11-20T15:00:00Z", { X: b1, Y: c, Z: z2 });  // in W: X version 2 = B1; Z edited
    await capture("2026-11-20T16:00:00Z", { X: b2, Y: c, Z: z2 });  // in W: X version 2 = B2  (churn, no insert)
    await capture("2026-11-20T17:00:00Z", { X: b1, Y: c, Z: z2 });  // in W: X version 2 = B1 again

    const churn = (await db.query<{ order_guid: string; kind: string; snapshots: number; sequence: string }>(query("churn", W))).rows;
    expect(churn.map((r) => [r.order_guid, r.kind, Number(r.snapshots)])).toEqual([["X", "CHURN", 2]]);
    expect(churn[0]!.sequence).toBe([b1, b2, b1].join(" > "));

    // The old first-membership-only metric would have missed it: nothing about X was INSERTED in W.
    expect((await insertRows(query("inserts", W))).map((r) => r.slice(2))).toEqual([[1, 0, 0, 1, 0]]);
    // Scoped == the pre-amendment whole-table query (no same-modified edit in these fixtures, so its
    // edit_same_modified column is 0 and the other four columns must match exactly).
    expect(await insertRows(bind(OLD_INSERTS, W))).toEqual(await insertRows(query("inserts", W)));
  });

  it("churn: a NEW same-modified snapshot inside W is classed churn by inserts and caught by Metric A", async () => {
    const y2 = await snapshot("Y", "2026-11-20T10:00:00Z", "c3");
    await capture("2026-11-20T18:00:00Z", { Y: y2 });
    expect((await insertRows(query("inserts", W))).map((r) => r.slice(2, 4))).toEqual([[1, 1]]);
    expect(await insertRows(bind(OLD_INSERTS, W))).toEqual(await insertRows(query("inserts", W)));
    expect((await db.query<{ order_guid: string }>(query("churn", W))).rows.map((r) => r.order_guid)).toEqual(["X", "Y"]);
  });

  it("null modified_at is its own partition and kind (never merged with a dated version)", async () => {
    const n1 = await snapshot("N", null, "e1"), n2 = await snapshot("N", null, "e2");
    await capture("2026-11-20T19:00:00Z", { N: n1 });
    await capture("2026-11-20T20:00:00Z", { N: n2 });
    const rows = (await db.query<{ order_guid: string; kind: string }>(query("churn", W))).rows;
    expect(rows.find((r) => r.order_guid === "N")?.kind).toBe("CHURN_NULL_MODIFIED");
  });

  it("coverage counts orders captured in 3+ runs in W", async () => {
    const rows = (await db.query<{ orders_captured_3_plus: number; orders_seen: number }>(query("coverage", W))).rows;
    expect(rows.map((r) => [Number(r.orders_captured_3_plus), Number(r.orders_seen)])).toEqual([[3, 4]]);
  });
});

describe("same-modified_at: churn only when the stored content is equal (prod 2026-11-17)", () => {
  // A second shop so the first describe's per-shop counts stay as they were.
  const shop2 = "00000000-0000-4000-8000-0000000000a2";
  const t = "2026-11-20T09:00:00Z";
  const check = { check_guid: "c1", amount_cents: 1000, accounting: { version: "1", gross_cents: 1000 } };
  const pay = (status: string) => ({ check_guid: "c1", payment_guid: "p1", payment_status: status, amount_cents: 1080 });
  const unitA = { check_guid: "c1", selection_guid: "s1", parent_selection_guid: null, item_guid: "i1", name: "Ham", quantity: 1, voided: false, deleted: false };
  const unitB = { check_guid: "c1", selection_guid: "s2", parent_selection_guid: null, item_guid: "i2", name: "Chips", quantity: 2, voided: false, deleted: false };
  const d1 = { applied_discount_guid: "ad1", amount_cents: 100 }, d2 = { applied_discount_guid: "ad2", amount_cents: 50 };
  type ChurnRow = { location_id: string; order_guid: string; kind: string; snapshots: number; contents: number };
  const churnOf = async (guid: string) => (await db.query<ChurnRow>(query("churn", W))).rows
    .filter((r) => r.location_id === shop2 && r.order_guid === guid).map((r) => [r.kind, Number(r.snapshots), Number(r.contents)]);
  const insertsOf = async () => (await insertRows(query("inserts", W))).filter((r) => r[0] === shop2).map((r) => r.slice(2));

  it("a payment_status-only change (AUTHORIZED -> CAPTURED) with the same modified_at is EDIT_SAME_MODIFIED, never CHURN", async () => {
    await db.query("insert into public.locations(id) values($1)", [shop2]);
    const p1 = await snapshot("P", t, "p1", { units: [unitA], checks: [check], payments: [pay("AUTHORIZED")] }, shop2);
    const p2 = await snapshot("P", t, "p2", { units: [unitA], checks: [check], payments: [pay("CAPTURED")] }, shop2);
    await capture("2026-11-20T14:05:00Z", { P: p1 }, shop2);
    await capture("2026-11-21T06:00:00Z", { P: p2 }, shop2);   // the nightly card batch capture; Toast's modified_at unchanged
    expect(await churnOf("P")).toEqual([["EDIT_SAME_MODIFIED", 2, 2]]);
    // inserts [transition, churn, edit_same_modified, edit, new_order]: p1 a new order, p2 a same-modified edit.
    expect(await insertsOf()).toEqual([[0, 0, 1, 0, 1]]);
  });

  it("the same capture against a snapshot first seen BEFORE W is edit_same_modified, never a transition", async () => {
    const q1 = await snapshot("Q", t, "q1", { checks: [check], payments: [pay("AUTHORIZED")] }, shop2);
    const q2 = await snapshot("Q", t, "q2", { checks: [check], payments: [pay("CAPTURED")] }, shop2);
    await capture("2026-11-19T20:00:00Z", { Q: q1 }, shop2);
    await capture("2026-11-21T06:00:00Z", { Q: q2 }, shop2);
    expect(await churnOf("Q")).toEqual([]);   // one snapshot for that version inside W
    expect(await insertsOf()).toEqual([[0, 0, 2, 0, 1]]);
  });

  it("a reordered-only pair (selection order, discount and service-charge ordinals, jsonb key order) is CHURN", async () => {
    const r1 = await snapshot("R", t, "r1", { units: [unitA, unitB], checks: [check], payments: [pay("CAPTURED")],
      discounts: [{ check_guid: "c1", ordinal: 0, ...d1 }, { check_guid: "c1", ordinal: 1, ...d2 }],
      charges: [{ check_guid: "c1", ordinal: 0, name: "Delivery", amount_cents: 300 }, { check_guid: "c1", ordinal: 1, name: "Bag", amount_cents: 10 }] }, shop2);
    const r2 = await snapshot("R", t, "r2", { units: [unitB, unitA], checks: [{ ...check, accounting: { gross_cents: 1000, version: "1" } }], payments: [pay("CAPTURED")],
      discounts: [{ check_guid: "c1", ordinal: 0, ...d2 }, { check_guid: "c1", ordinal: 1, ...d1 }],
      charges: [{ check_guid: "c1", ordinal: 0, name: "Bag", amount_cents: 10 }, { check_guid: "c1", ordinal: 1, name: "Delivery", amount_cents: 300 }] }, shop2);
    await capture("2026-11-20T15:00:00Z", { R: r1 }, shop2);
    await capture("2026-11-20T16:00:00Z", { R: r2 }, shop2);
    expect(await churnOf("R")).toEqual([["CHURN", 2, 1]]);
    expect(await insertsOf()).toEqual([[0, 1, 2, 0, 2]]);
  });

  it("duplicates are content: dropping one of two identical discounts is an edit, not churn", async () => {
    const e1 = await snapshot("E", t, "e1", { checks: [check], discounts: [{ check_guid: "c1", ordinal: 0, ...d1 }, { check_guid: "c1", ordinal: 1, ...d1 }] }, shop2);
    const e2 = await snapshot("E", t, "e2", { checks: [check], discounts: [{ check_guid: "c1", ordinal: 0, ...d1 }] }, shop2);
    await capture("2026-11-20T17:00:00Z", { E: e1 }, shop2);
    await capture("2026-11-20T18:00:00Z", { E: e2 }, shop2);
    expect(await churnOf("E")).toEqual([["EDIT_SAME_MODIFIED", 2, 2]]);
  });

  it("scoped @query inserts == the whole-table form on every fixture and window, including snapshots outside W", async () => {
    // Outside W on both sides: a snapshot seen only before W, and one first seen after it.
    const o1 = await snapshot("O", t, "o1", {}, shop2), o2 = await snapshot("O", "2026-11-20T10:00:00Z", "o2", {}, shop2);
    await capture("2026-11-18T12:00:00Z", { O: o1 }, shop2);
    await capture("2026-11-23T12:00:00Z", { O: o2 }, shop2);
    const windows = [W, { w_from: "2026-11-30T00:00:00Z", w_to: "2026-12-01T00:00:00Z" }, { w_from: "2026-11-18T00:00:00Z", w_to: "2026-11-20T00:00:00Z" },
      { w_from: "2026-11-21T00:00:00Z", w_to: "2026-11-24T00:00:00Z" }, { w_from: "2026-11-01T00:00:00Z", w_to: "2026-12-01T00:00:00Z" }];
    for (const w of windows) expect(await insertRows(query("inserts", w)), JSON.stringify(w)).toEqual(await insertRows(unscopedInserts(w)));
    expect((await insertRows(query("inserts", W))).length).toBe(2);
  });
});

describe("recovery restores the comparison that pass 2's republish clears (Astra r2 P1)", () => {
  const order = "00000000-0000-4000-8000-0000000000e1", ezSnap = "00000000-0000-4000-8000-0000000000e2";
  const sku = "00000000-0000-4000-8000-0000000000e3";
  const payload = { shadow: [{ ordinal: 0, sku_id: sku, sales_oz: 10, suppressed_oz: 4, shadow_oz: 6, current_day_sales_oz: 10 }] };
  const comparisons = async () => (await db.query<{ event_date: string; status: string; missing: number; reconciled_day_sales_oz: string | null }>(
    query("comparisons", { r1: "2026-11-19", c: "2026-11-20", r2: "2026-11-21" }))).rows
    .map((r) => [(r.event_date as unknown) instanceof Date ? (r.event_date as unknown as Date).toISOString().slice(0, 10) : String(r.event_date).slice(0, 10), r.status, Number(r.missing), r.reconciled_day_sales_oz === null ? null : Number(r.reconciled_day_sales_oz)]);
  const rows = [{ location_id: shop, business_date: "2026-11-20", sku_id: sku, direct_oz: 7.5 }];

  it("populated -> links-only republish (cleared) -> normal-mode record (restored); an uncovered date stays on the deferred list", async () => {
    await db.query("insert into public.ezcater_orders(id,snapshot_id,event_date) values($1,$2,'2026-11-20'),($3,$2,'2026-11-21')", [order, ezSnap, `${order.slice(0, -1)}9`]);
    await db.query("select public.republish_shadow($1,$2,$3::jsonb)", [order, shop, JSON.stringify(payload)]);
    await db.query("select public.republish_shadow($1,$2,$3::jsonb)", [`${order.slice(0, -1)}9`, shop, JSON.stringify(payload)]);
    await db.query("select public.record_ezcater_reconciled_comparison('2026-11-20','2026-11-20',$1::jsonb)", [JSON.stringify(rows)]);
    expect(await comparisons()).toEqual([["2026-11-20", "covered", 0, 7.5], ["2026-11-21", "deferred", 1, null]]);

    // The transition recovery: --links-only runs pass 2, which republishes the order -> comparison gone.
    await db.query("select public.republish_shadow($1,$2,$3::jsonb)", [order, shop, JSON.stringify(payload)]);
    expect(await comparisons()).toEqual([["2026-11-20", "covered", 1, null], ["2026-11-21", "deferred", 1, null]]);
    // Re-running links-only does NOT restore it.
    await db.query("select public.republish_shadow($1,$2,$3::jsonb)", [order, shop, JSON.stringify(payload)]);
    expect((await comparisons())[0]).toEqual(["2026-11-20", "covered", 1, null]);

    // Normal mode over the covered dates [R1, C] records it again.
    await db.query("select public.record_ezcater_reconciled_comparison('2026-11-19','2026-11-20',$1::jsonb)", [JSON.stringify(rows)]);
    expect(await comparisons()).toEqual([["2026-11-20", "covered", 0, 7.5], ["2026-11-21", "deferred", 1, null]]);
  });
});
