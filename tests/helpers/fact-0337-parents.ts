// The REAL parent DDL for 0337's offline proofs, extracted from the applied migrations (never retyped):
// 0221 tables + finish, 0239 columns + page writer, 0237 status constraint + toast_modified_save, 0232
// classifier / window guard / sales_report_facts, 0247 sales_report_daily, 0243 leases + 0300 union.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = (n: string) => readFileSync(`supabase/migrations/${n}`, "utf8");
export const M0337 = read("0337_fact_layer_orders.sql");
function grab(file: string, re: RegExp, what: string): string {
  const m = read(file).match(re);
  if (!m) throw new Error(`harness: ${what} not found in ${file}`);
  return m[0];
}
const tbl = (file: string, name: string) => grab(file, new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`, "i"), name);
const oneLineTbl = (file: string, name: string) => grab(file, new RegExp(`create table public\\.${name} \\(.*\\);`, "i"), name);
const fn = (file: string, name: string) => grab(file, new RegExp(`create (or replace )?function public\\.${name}\\([\\s\\S]*?(end \\$\\$;|\\n\\$\\$;)`, "i"), name);

export const PARENTS = [
  `create role anon; create role authenticated; create role service_role bypassrls;
   grant usage on schema public to anon, authenticated, service_role;
   alter default privileges in schema public grant all on tables to public, anon, authenticated, service_role;
   alter default privileges in schema public grant all on functions to public, anon, authenticated, service_role;
   create table public.locations(id uuid primary key, name text, code text, type text, active boolean default true);
   create table public.ezcater_current_toast_links(location_id uuid, business_date date, toast_snapshot_id uuid, check_guid text);
   create table public.ezcater_orders(id uuid, event_date date, lead_id uuid, location_id uuid, snapshot_id uuid, status text, subtotal_cents bigint);
   create table public.catering_pipeline(id uuid, location_id uuid, stage text);`,
  ...["toast_capture_runs", "toast_orders", "toast_order_checks", "toast_check_discounts", "toast_check_service_charges",
    "toast_payments", "toast_capture_pages", "toast_capture_run_orders", "toast_order_latest_pointers", "sales_channel_map"]
    .map((t) => tbl("0221_toast_order_capture.sql", t)),
  oneLineTbl("0221_toast_order_capture.sql", "toast_dining_options"),
  grab("0239_sales_true_net.sql", /alter table public\.toast_order_checks add column accounting[\s\S]*?sales_refund_cents >= 0\);/i, "0239 columns"),
  grab("0237_toast_modified_capture.sql", /alter table public\.toast_capture_runs drop constraint[\s\S]*?'modified_completed'\)\);/i, "0237 status"),
  tbl("0237_toast_modified_capture.sql", "toast_modified_cursors"),
  fn("0239_sales_true_net.sql", "toast_capture_page"),
  fn("0221_toast_order_capture.sql", "toast_capture_finish"),
  fn("0237_toast_modified_capture.sql", "toast_modified_save"),
  fn("0232_reports_sales_reads.sql", "sales_report_class"),
  fn("0232_reports_sales_reads.sql", "sales_report_assert_window"),
  fn("0232_reports_sales_reads.sql", "sales_report_discount_counts"),
  fn("0232_reports_sales_reads.sql", "sales_report_facts"),
  fn("0247_sales_refund_candidates.sql", "sales_report_daily"),
  grab("0243_cron_route_leases.sql", /create table public\.cron_route_leases[\s\S]*?\);/i, "leases"),
  grab("0300_meta_leads.sql", /alter table public\.cron_route_leases drop constraint[\s\S]*?;/i, "0300 union"),
  fn("0300_meta_leads.sql", "claim_cron_route"),
];

export async function freshParents(): Promise<PGlite> {
  const d = new PGlite();
  for (const sql of PARENTS) await d.exec(sql);
  return d;
}
