// Toast churn fix PR 1 (plan r2 §2.3.1 / §3): the REAL capture writers in PGlite. 0221's tables and
// toast_capture_finish, 0239's accounting / sales_refund_cents columns and its toast_capture_page are
// extracted verbatim from the migration files (no migration in this PR). Asserts what prod will see:
// the same order captured with its arrays in different orders is ONE snapshot, and the legacy ->
// canonical transition costs exactly ONE new snapshot per order, after which memberships and the
// latest pointer stay on it.
import { beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { legacyHashInput, normalizeToastOrder, type ToastCapturedOrder } from "@/lib/toast/capture-shared";
import { toastContentHash } from "@/lib/toast/content-hash";

const m0221 = readFileSync("supabase/migrations/0221_toast_order_capture.sql", "utf8");
const m0239 = readFileSync("supabase/migrations/0239_sales_true_net.sql", "utf8");
const cut = (sql: string, start: string, end: string) => {
  const i = sql.indexOf(start); expect(i, start).toBeGreaterThan(-1);
  const j = sql.indexOf(end, i); expect(j, end).toBeGreaterThan(i);
  return sql.slice(i, j + end.length);
};
const table = (name: string) => cut(m0221, `create table public.${name} (`, ");\n");

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create table public.locations(id uuid primary key);
    ${["toast_capture_runs", "toast_orders", "toast_order_checks", "toast_check_discounts", "toast_check_service_charges",
       "toast_payments", "toast_capture_pages", "toast_capture_run_orders", "toast_order_latest_pointers"].map(table).join("\n")}
    ${cut(m0239, "alter table public.toast_order_checks add column accounting jsonb", ";\n")}
    ${cut(m0239, "alter table public.toast_payments add column sales_refund_cents bigint", ";\n")}
    ${cut(m0239, "create or replace function public.toast_capture_page(", "end $$;")}
    ${cut(m0221, "create function public.toast_capture_finish(", "end $$;")}`);
}, 120_000);

const DATE = "2026-10-08";
let shopN = 0;
const newShop = async () => {
  const id = `00000000-0000-4000-8000-${String(++shopN).padStart(12, "0")}`;
  await db.query("insert into public.locations(id) values($1)", [id]);
  return id;
};
let clock = Date.parse("2026-10-09T12:00:00.000Z");
/** One completed capture run (one page) of `orders`, each carrying its content_hash. */
async function run(shop: string, orders: (ToastCapturedOrder & { content_hash: string })[]) {
  clock += 60_000;
  const r = await db.query<{ id: string }>("insert into public.toast_capture_runs(location_id,business_date,started_at) values($1,$2,$3) returning id", [shop, DATE, new Date(clock).toISOString()]);
  const id = r.rows[0]!.id;
  await db.query("select public.toast_capture_page($1,$2,$3,1,$4::jsonb)", [id, shop, DATE, JSON.stringify(orders)]);
  await db.query("select public.toast_capture_finish($1,$2,$3,1)", [id, shop, DATE]);
  return id;
}
const canonicalEntry = (o: ToastCapturedOrder) => ({ ...o, content_hash: toastContentHash(o) });
/** What the pre-fix writer stored: the same rows, the legacy hash. */
const legacyEntry = (o: ToastCapturedOrder) => ({ ...o, content_hash: createHash("sha256").update(JSON.stringify(legacyHashInput(o))).digest("hex") });
const count = async (sql: string, args: unknown[]) => Number((await db.query<{ n: number }>(sql, args)).rows[0]!.n);
const snapshots = (shop: string, guid: string) => count("select count(*)::int as n from public.toast_orders where location_id=$1 and order_guid=$2", [shop, guid]);
const childRows = (shop: string) => count(`select (select count(*) from public.toast_order_checks c join public.toast_orders o on o.id=c.snapshot_id where o.location_id=$1)
  + (select count(*) from public.toast_check_discounts c join public.toast_orders o on o.id=c.snapshot_id where o.location_id=$1)
  + (select count(*) from public.toast_check_service_charges c join public.toast_orders o on o.id=c.snapshot_id where o.location_id=$1)
  + (select count(*) from public.toast_payments c join public.toast_orders o on o.id=c.snapshot_id where o.location_id=$1) as n`, [shop]);
const membership = async (runId: string, guid: string) => (await db.query<{ snapshot_id: string }>("select snapshot_id from public.toast_capture_run_orders where run_id=$1 and order_guid=$2", [runId, guid])).rows[0]!.snapshot_id;
const pointer = async (shop: string, guid: string) => (await db.query<{ snapshot_id: string }>("select snapshot_id from public.toast_order_latest_pointers where location_id=$1 and order_guid=$2", [shop, guid])).rows[0]!.snapshot_id;

// One order (two checks, discounts, service charges, payments, a modifier), and its arrays reversed.
const raw = {
  guid: "pg-order", businessDate: 20261008, modifiedDate: "2026-10-08T16:00:00.000Z",
  checks: [
    { guid: "pg-c2", amount: 20, appliedDiscounts: [{ name: "Open", discountAmount: 1 }, { name: "Open", discountAmount: 2 }],
      selections: [{ guid: "pg-s2", item: { guid: "it-b" }, quantity: 1, price: 10, modifiers: [{ guid: "pg-s0", item: { guid: "it-m" }, quantity: 1, price: 1 }] },
                   { guid: "pg-s1", item: { guid: "it-a" }, quantity: 1, price: 10 }],
      appliedServiceCharges: [{ serviceCharge: { guid: "sc-2" }, name: "Tip", chargeAmount: 2, gratuity: true }, { serviceCharge: { guid: "sc-1" }, name: "Fee", chargeAmount: 1 }],
      payments: [{ guid: "pay-b", amount: 10, paymentStatus: "CAPTURED" }, { guid: "pay-a", amount: 12, paymentStatus: "CAPTURED" }] },
    { guid: "pg-c1", amount: 5, selections: [{ guid: "pg-s3", item: { guid: "it-c" }, quantity: 2, price: 5 }],
      payments: [{ guid: "pay-c", amount: 5, paymentStatus: "CAPTURED" }] },
  ],
};
type R = Record<string, unknown>;
const reversed = (x: unknown): unknown => Array.isArray(x) ? x.slice().reverse().map(reversed)
  : x !== null && typeof x === "object" ? Object.fromEntries(Object.entries(x as R).map(([k, v]) => [k, reversed(v)])) : x;
const variants = [raw, reversed(raw), { ...raw, checks: [raw.checks[1], raw.checks[0]] }, reversed({ ...raw, checks: [raw.checks[1], raw.checks[0]] })];

describe("canonical hash on the real 0239 page writer", () => {
  it("the same order captured in different array orders is ONE snapshot; every membership and the pointer name it", async () => {
    const shop = await newShop();
    const orders = variants.map((v) => normalizeToastOrder(v, DATE));
    expect(new Set(orders.map((o) => JSON.stringify(o))).size).toBe(variants.length); // the payloads really differ
    const runs: string[] = [];
    for (const o of orders) runs.push(await run(shop, [canonicalEntry(o)]));
    expect(await snapshots(shop, "pg-order")).toBe(1);
    const id = await membership(runs[0]!, "pg-order");
    for (const r of runs) expect(await membership(r, "pg-order")).toBe(id);
    expect(await pointer(shop, "pg-order")).toBe(id);
  });

  it("control: under the LEGACY hash the same captures make one snapshot per array order (the churn)", async () => {
    const shop = await newShop();
    for (const v of variants) await run(shop, [legacyEntry(normalizeToastOrder(v, DATE))]);
    expect(await snapshots(shop, "pg-order")).toBe(variants.length);
  });

  it("transition: a legacy snapshot, then canonical recaptures -> exactly +1 snapshot, then constant; memberships and pointer settle on it", async () => {
    const shop = await newShop();
    const legacyRun = await run(shop, [legacyEntry(normalizeToastOrder(variants[1], DATE))]);
    const legacyId = await membership(legacyRun, "pg-order");
    expect(await pointer(shop, "pg-order")).toBe(legacyId);
    const children0 = await childRows(shop);

    const first = await run(shop, [canonicalEntry(normalizeToastOrder(variants[1], DATE))]);
    const canonicalId = await membership(first, "pg-order");
    expect(canonicalId).not.toBe(legacyId); // variants[1] is not in canonical order: the one allowed new snapshot
    expect(await snapshots(shop, "pg-order")).toBe(2);
    const children1 = await childRows(shop);
    expect(children1).toBe(children0 * 2);

    const later: string[] = [];
    for (const v of [variants[0], variants[2], variants[3]]) later.push(await run(shop, [canonicalEntry(normalizeToastOrder(v, DATE))]));
    expect(await snapshots(shop, "pg-order")).toBe(2);
    expect(await childRows(shop)).toBe(children1);
    for (const r of later) expect(await membership(r, "pg-order")).toBe(canonicalId);
    expect(await membership(legacyRun, "pg-order")).toBe(legacyId); // history untouched
    expect(await pointer(shop, "pg-order")).toBe(canonicalId);
  });

  it("transition for an order already in canonical order: its legacy snapshot IS the canonical one (no new row)", async () => {
    const shop = await newShop();
    const o = normalizeToastOrder(variants[1], DATE);
    const already = normalizeToastOrder({ ...raw, guid: "pg-sorted", checks: [] }, DATE);
    expect(toastContentHash(already)).toBe(legacyEntry(already).content_hash);
    const r1 = await run(shop, [legacyEntry(already), legacyEntry(o)]);
    const r2 = await run(shop, [canonicalEntry(already), canonicalEntry(o)]);
    expect(await membership(r2, "pg-sorted")).toBe(await membership(r1, "pg-sorted"));
    expect(await snapshots(shop, "pg-sorted")).toBe(1);
  });

  it("a real edit after the transition is still a new snapshot and moves the pointer", async () => {
    const shop = await newShop();
    await run(shop, [canonicalEntry(normalizeToastOrder(raw, DATE))]);
    const edited = { ...raw, modifiedDate: "2026-10-08T17:00:00.000Z", checks: [{ ...raw.checks[1], amount: 6 }, raw.checks[0]] };
    const r = await run(shop, [canonicalEntry(normalizeToastOrder(edited, DATE))]);
    expect(await snapshots(shop, "pg-order")).toBe(2);
    expect(await pointer(shop, "pg-order")).toBe(await membership(r, "pg-order"));
  });
});
