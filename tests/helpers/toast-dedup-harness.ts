// Toast duplicate cleanup (0351): one PGlite schema for every test that needs it. REAL SQL only:
// the whole 0221 file, 0225's link table (+ 0229's added columns), 0239's columns and page writer,
// 0337's fact tables, 0344 / 0347's house link + conflict tables, then (optionally) the whole 0351 file.
// Foreign keys to tables outside this slice (ezCater orders, catering pipeline, decisions) are cut;
// every FK that touches a Toast snapshot is kept.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

export const readMigration = (name: string) => readFileSync(`supabase/migrations/${name}`, "utf8").replace(/\r\n/g, "\n");
export const M0351 = "0351_toast_snapshot_dedup.sql";
export const m0351 = readMigration(M0351);
const m0221 = readMigration("0221_toast_order_capture.sql");
const m0225 = readMigration("0225_ezcater_pass2.sql");
const m0239 = readMigration("0239_sales_true_net.sql");
const m0337 = readMigration("0337_fact_layer_orders.sql");
const m0344 = readMigration("0344_catering_toast_house_side.sql");
const m0347 = readMigration("0347_catering_toast_link_step.sql");

export function cut(sql: string, start: string, end: string): string {
  const i = sql.indexOf(start);
  if (i < 0) throw new Error(`cut: missing ${start}`);
  const j = sql.indexOf(end, i);
  if (j < 0) throw new Error(`cut: missing ${end} after ${start}`);
  return sql.slice(i, j + end.length);
}
const table = (sql: string, name: string) => cut(sql, `create table public.${name} (`, "\n);\n");
const noForeign = (sql: string, ...tables: string[]) =>
  tables.reduce((s, t) => s.replace(new RegExp(` references public\\.${t}\\([a-z_, ]+\\)`, "g"), ""), sql);

export const SHOP = "00000000-0000-4000-8000-0000000000a1";
export const SHOP2 = "00000000-0000-4000-8000-0000000000a2";

/** Everything below 0351, exactly as the files have it. */
export async function baseSchema(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.locations(id uuid primary key);
    insert into public.locations values ('${SHOP}'), ('${SHOP2}');
    create table public.toast_sales_events(dining_option text);
    create table public.audit_log(id uuid primary key default gen_random_uuid(), occurred_at timestamptz default now(),
      actor_id uuid, actor_role text, action text not null, resource_table text not null, resource_id uuid,
      before_state jsonb, after_state jsonb, metadata jsonb, destructive boolean default false);`);
  await db.exec(m0221);
  await db.exec(`${noForeign(table(m0225, "ezcater_toast_links").replace(/,\n foreign key\(order_id,snapshot_id\)[^\n]*/, ""), "ezcater_orders")}
    alter table public.ezcater_toast_links add column reconciliation_details jsonb not null default '{}'::jsonb;
    ${cut(m0239, "alter table public.toast_order_checks add column accounting jsonb", ";\n")}
    ${cut(m0239, "alter table public.toast_payments add column sales_refund_cents bigint", ";\n")}
    ${cut(m0239, "create or replace function public.toast_capture_page(", "end $$;")}
    ${table(m0337, "fact_order_snapshot")}
    ${table(m0337, "fact_order_check")}
    ${table(m0337, "fact_refund")}
    ${noForeign(table(m0344, "catering_toast_links"), "catering_pipeline", "catering_toast_link_decisions")}
    ${table(m0347, "catering_toast_conflicts")}`);
  return db;
}
export async function schema(): Promise<PGlite> {
  const db = await baseSchema();
  await db.exec(m0351);
  return db;
}

let n = 0;
export const uuid = () => `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`;
export const hash = (tag: string) => Buffer.from(tag).toString("hex").padEnd(64, "0").slice(0, 64);

export interface OrderSpec {
  guid: string; hash: string; modified?: string | null; date?: string;
  units?: Record<string, unknown>[];
  checks?: { check_guid: string; amount_cents?: number; accounting?: Record<string, unknown> | null }[];
  discounts?: { check_guid: string; ordinal: number; applied_discount_guid?: string; amount_cents?: number }[];
  charges?: { check_guid: string; ordinal: number; name?: string; amount_cents?: number }[];
  payments?: { check_guid: string; payment_guid: string; payment_status?: string; amount_cents?: number; sales_refund_cents?: number | null }[];
}
export const DAY = "2026-10-10";
const entry = (o: OrderSpec) => ({
  content_hash: hash(o.hash),
  order: { order_guid: o.guid, business_date: o.date ?? DAY, modified_at: o.modified === undefined ? "2026-10-10T18:00:00Z" : o.modified,
    deleted: false, voided: false, excess_food: false, selection_units: o.units ?? [] },
  checks: (o.checks ?? []).map((c) => ({ check_guid: c.check_guid, amount_cents: c.amount_cents ?? 1000, tax_cents: 0, total_cents: c.amount_cents ?? 1000,
    voided: false, deleted: false, accounting: c.accounting ?? null })),
  discounts: (o.discounts ?? []).map((d) => ({ check_guid: d.check_guid, ordinal: d.ordinal, applied_discount_guid: d.applied_discount_guid ?? "ad", amount_cents: d.amount_cents ?? 100 })),
  service_charges: (o.charges ?? []).map((c) => ({ check_guid: c.check_guid, ordinal: c.ordinal, name: c.name ?? "fee", amount_cents: c.amount_cents ?? 50, gratuity: false, taxable: false })),
  payments: (o.payments ?? []).map((p) => ({ check_guid: p.check_guid, payment_guid: p.payment_guid, payment_status: p.payment_status ?? "CAPTURED",
    amount_cents: p.amount_cents ?? 1000, ...(p.sales_refund_cents === undefined ? {} : { sales_refund_cents: p.sales_refund_cents }) })),
});

/** One capture run through the REAL writers (0239 page, 0221 finish). Returns the run id and each order's snapshot id. */
export async function capture(db: PGlite, orders: OrderSpec[], opts: { finish?: boolean; shop?: string; date?: string; startedAt?: string } = {}) {
  const run = uuid(), shop = opts.shop ?? SHOP, date = opts.date ?? DAY;
  await db.query("insert into public.toast_capture_runs(id, location_id, business_date, started_at) values ($1, $2, $3, coalesce($4::timestamptz, clock_timestamp()))",
    [run, shop, date, opts.startedAt ?? null]);
  await db.query("select public.toast_capture_page($1, $2, $3, 1, $4::jsonb)", [run, shop, date, JSON.stringify(orders.map(entry))]);
  if (opts.finish !== false) await db.query("select public.toast_capture_finish($1, $2, $3, 1)", [run, shop, date]);
  const rows = (await db.query<{ order_guid: string; snapshot_id: string }>("select order_guid, snapshot_id from public.toast_capture_run_orders where run_id = $1", [run])).rows;
  return { run, ids: Object.fromEntries(rows.map((r) => [r.order_guid, r.snapshot_id])) as Record<string, string> };
}
export const one = async <T>(db: PGlite, sql: string, params: unknown[] = []) => (await db.query<{ v: T }>(sql, params)).rows[0]!.v;
export const errorOf = async (run: () => Promise<unknown>): Promise<string> => {
  try { await run(); } catch (e) { return e instanceof Error ? e.message : String(e); }
  return "";
};
