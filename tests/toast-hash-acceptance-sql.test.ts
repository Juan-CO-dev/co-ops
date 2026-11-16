// Toast churn fix PR 1: scripts/toast-hash-acceptance.sql (read-only) run in PGlite against the REAL
// 0221 / 0225 / 0229 / 0239 SQL, extracted verbatim from the migration files.
// - Metric A must catch churn AFTER the first canonical version (Astra r2 P2 #4): A -> B1 -> B2 -> B1
//   with B1/B2 sharing a modified_at and both already stored (no insert in W) is a CHURN row.
// - The recovery check (Astra r2 P1): pass 2's republish clears reconciled_day_sales_oz
//   (0229:205 retire + 0229:237 insert without it); only record_ezcater_reconciled_comparison
//   (0229:257) restores it. populated -> republish -> cleared -> record -> restored, and the
//   comparisons query reports covered dates vs the deferred list.
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
  return Object.entries(params).reduce((sql, [k, v]) => sql.replaceAll(`:${k}::`, `'${v}'::`), body);
};

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
    ${["toast_capture_runs", "toast_orders", "toast_order_checks", "toast_capture_pages", "toast_capture_run_orders", "toast_order_latest_pointers"].map(table).join("\n")}
    ${cut(m0239, "alter table public.toast_order_checks add column accounting jsonb", ";\n")}
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
const snapshot = async (guid: string, modified: string | null, hash: string) => {
  const id = uuid();
  await db.query(`insert into public.toast_orders(id,location_id,order_guid,business_date,content_hash,modified_at,deleted,voided,excess_food)
    values($1,$2,$3,'2026-11-20',$4,$5,false,false,false)`, [id, shop, guid, hash.padEnd(64, "0"), modified]);
  return id;
};
/** One completed one-page run started at `at`, naming `members` (order guid -> snapshot id). */
const capture = async (at: string, members: Record<string, string>) => {
  const run = uuid();
  await db.query("insert into public.toast_capture_runs(id,location_id,business_date,started_at,finished_at,status,pages,orders) values($1,$2,'2026-11-20',$3,$3,'completed',1,$4)",
    [run, shop, at, Object.keys(members).length]);
  await db.query("insert into public.toast_capture_pages(run_id,page,orders,payload_hash) values($1,1,$2,'x')", [run, Object.keys(members).length]);
  for (const [guid, id] of Object.entries(members)) {
    await db.query("insert into public.toast_capture_run_orders(run_id,snapshot_id,location_id,business_date,order_guid,page) values($1,$2,$3,'2026-11-20',$4,1)", [run, id, shop, guid]);
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
    const inserts = (await db.query<{ transition: number; churn: number; edit: number; new_order: number }>(query("inserts", W))).rows;
    expect(inserts.map((r) => [Number(r.transition), Number(r.churn), Number(r.edit), Number(r.new_order)])).toEqual([[1, 0, 1, 0]]);
  });

  it("churn: a NEW same-modified snapshot inside W is classed churn by inserts and caught by Metric A", async () => {
    const y2 = await snapshot("Y", "2026-11-20T10:00:00Z", "c3");
    await capture("2026-11-20T18:00:00Z", { Y: y2 });
    const inserts = (await db.query<{ churn: number; transition: number }>(query("inserts", W))).rows;
    expect(inserts.map((r) => [Number(r.transition), Number(r.churn)])).toEqual([[1, 1]]);
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
