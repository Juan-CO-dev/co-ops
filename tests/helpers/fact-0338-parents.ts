// The REAL parent DDL for 0338's offline proofs (item 2 PR 2c, labor), extracted from the applied
// migrations (never retyped): 0337 on its own parents, then 0268 (sync ledger, punches, labor settings,
// wages + THE reconciler), 0269 links with 0301's per-shop indexes, 0224 Toast time entries, 0233 Toast
// employee links, 0274 schedule_shop_settings. Only `users` is a stub (its real DDL predates the repo's
// migration lineage); the link FKs need its id.
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { M0337, freshParents as orderParents } from "./fact-0337-parents";

const read = (n: string) => readFileSync(`supabase/migrations/${n}`, "utf8");
export const M0338 = read("0338_fact_layer_labor.sql");
/** 0339 (Juan 2026-11-17): overtime per employer (shop), applied on top of 0338 = the production shape. */
export const M0339 = read("0339_fact_labor_ot_per_shop.sql");
function grab(file: string, re: RegExp, what: string): string {
  const m = read(file).match(re);
  if (!m) throw new Error(`harness: ${what} not found in ${file}`);
  return m[0];
}
const tbl = (file: string, name: string) => grab(file, new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`, "i"), name);
const fn = (file: string, name: string) => grab(file, new RegExp(`create (or replace )?function public\\.${name}\\([\\s\\S]*?(end \\$\\$;|\\n\\$\\$;)`, "i"), name);
const idx = (file: string, name: string) => grab(file, new RegExp(`create unique index ${name}[\\s\\S]*?;`, "i"), name);

// The REAL audit_log (fix r1: save_labor_burden writes its own audit row): the Foundation Spec's CREATE TABLE
// (0044's verified column list) plus every migration's ALTER TABLE audit_log before 0338, never retyped.
const spec = readFileSync("docs/CO-OPS_Foundation_Spec_v1.3.md", "utf8");
const auditCreate = spec.match(/CREATE TABLE audit_log \([\s\S]*?\n\);/)?.[0];
if (!auditCreate) throw new Error("harness: Foundation Spec CREATE TABLE audit_log not found");
const auditAlters = readdirSync("supabase/migrations").filter((f) => /^\d{4}_.*\.sql$/.test(f) && f < "0338").sort()
  .flatMap((f) => read(f).match(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?audit_log\b[^;]*;/gi) ?? []);

export const LABOR_PARENTS = [
  `create table public.users(id uuid primary key, role text not null, active boolean not null default true);`,
  auditCreate.replace("CREATE TABLE audit_log", "CREATE TABLE public.audit_log"),
  ...auditAlters,
  tbl("0268_sevenshifts_sync.sql", "sevenshifts_sync_run_ids"),
  tbl("0268_sevenshifts_sync.sql", "sevenshifts_sync_runs"),
  tbl("0268_sevenshifts_sync.sql", "sevenshifts_time_punches"),
  tbl("0268_sevenshifts_sync.sql", "sevenshifts_labor_settings"),
  tbl("0268_sevenshifts_sync.sql", "sevenshifts_wages"),
  idx("0268_sevenshifts_sync.sql", "sevenshifts_wages_one_live"),
  fn("0268_sevenshifts_sync.sql", "sevenshifts_snapshot_row_problem"),
  fn("0268_sevenshifts_sync.sql", "reconcile_sevenshifts_user_snapshot"),
  tbl("0269_sevenshifts_links.sql", "sevenshifts_location_links"),
  idx("0269_sevenshifts_links.sql", "sevenshifts_location_links_one_live_shop"),
  idx("0269_sevenshifts_links.sql", "sevenshifts_location_links_one_live_remote"),
  tbl("0269_sevenshifts_links.sql", "sevenshifts_user_links"),
  idx("0301_sevenshifts_per_shop_links.sql", "sevenshifts_user_links_one_live_user_shop"),
  idx("0301_sevenshifts_per_shop_links.sql", "sevenshifts_user_links_one_live_remote_shop"),
  tbl("0224_toast_time_entries.sql", "toast_time_entries"),
  tbl("0233_whos_here.sql", "toast_employee_links"),
  idx("0233_whos_here.sql", "toast_employee_links_one_active_employee"),
  tbl("0274_schedule_settings.sql", "schedule_shop_settings"),
];

/** 0337's parents + the REAL 0337 + the labor parents (0338 not applied). */
export async function freshLaborParents(): Promise<PGlite> {
  const d = await orderParents();
  await d.exec(M0337);
  for (const sql of LABOR_PARENTS) await d.exec(sql);
  return d;
}
