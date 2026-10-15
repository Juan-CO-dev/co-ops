/** Proves 0267 against real 0072/0073 PM tables: access, policies, audits,
 * service-role writes, and refusal when an authenticated grant survives. */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = name => readFileSync(`supabase/migrations/${name}`, "utf8");
const migration = read("0267_pm_evals_privacy.sql");
let failures = 0;
let checks = 0;
function check(ok, name) {
  checks++;
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}`); }
}
async function denied(db, sql, name) {
  try { await db.exec(sql); check(false, name); }
  catch (error) { check(error.code === "42501", `${name} (${error.code ?? error.message})`); }
}
async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.users (id uuid primary key);
    create table public.locations (id uuid primary key);
    create table public.audit_log (actor_id uuid, actor_role text, action text,
      resource_table text, resource_id uuid, destructive boolean, metadata jsonb);
    create function public.current_user_role_level() returns integer language sql stable as 'select 4';
    create function public.current_user_locations() returns uuid[] language sql stable as 'select array[]::uuid[]';
    create function public.current_user_id() returns uuid language sql stable as 'select null::uuid';
  `);
  await db.exec(read("0072_pm_report_tables.sql"));
  await db.exec(read("0073_pm_evals_gradient_reshape.sql"));
  // 0106 replaces the permissive UPDATE policy with this deny policy.
  await db.exec(`drop policy pm_reports_update on public.pm_reports;
    create policy pm_reports_no_user_update on public.pm_reports for update using (false);`);
  await db.exec("grant all on public.pm_reports, public.pm_employee_evals to anon, authenticated, service_role;");
  return db;
}

let db;
try {
  db = await setup();
  await db.exec(migration);
  check(true, "0267 applied with its SQL assertions");
  const policies = (await db.query(`select tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('pm_employee_evals', 'pm_reports')
    order by tablename, policyname`)).rows.map(r => `${r.tablename}.${r.policyname}`);
  check(JSON.stringify(policies) === JSON.stringify([
    "pm_employee_evals.pm_evals_no_user_delete", "pm_employee_evals.pm_evals_no_user_update",
    "pm_reports.pm_reports_no_user_delete", "pm_reports.pm_reports_no_user_update",
  ]), "exact deny-only policy set survives");
  const audit = (await db.query("select resource_table, action, destructive, metadata from public.audit_log order by resource_table")).rows;
  check(audit.length === 2 && audit.map(r => r.resource_table).join(",") === "pm_employee_evals,pm_reports"
    && audit.every(r => r.action === "security.grants_change" && r.destructive === true
      && r.metadata.actor_context === "migration_apply"), "one destructive migration audit row per table");
  await db.exec("set role authenticated");
  await denied(db, "select note from public.pm_employee_evals", "authenticated cannot read note");
  await denied(db, "select id from public.pm_reports", "authenticated cannot read PM report");
  await denied(db, "insert into public.pm_employee_evals (id, author_id) values (gen_random_uuid(), gen_random_uuid())", "authenticated cannot spoof eval author");
  await denied(db, "update public.pm_employee_evals set note = 'spoof'", "authenticated cannot update eval");
  await denied(db, "delete from public.pm_employee_evals", "authenticated cannot delete eval");
  await denied(db, "insert into public.pm_reports (id, created_by) values (gen_random_uuid(), gen_random_uuid())", "authenticated cannot spoof report creator");
  await db.exec("set role anon");
  await denied(db, "select note from public.pm_employee_evals", "anon cannot read note");
  await denied(db, "select id from public.pm_reports", "anon cannot read PM report");
  await db.exec("reset role");
  const user = (await db.query("insert into public.users (id) values (gen_random_uuid()) returning id")).rows[0].id;
  const shop = (await db.query("insert into public.locations (id) values (gen_random_uuid()) returning id")).rows[0].id;
  await db.exec("set role service_role");
  const report = (await db.query(`insert into public.pm_reports (location_id, report_date, created_by)
    values ('${shop}', '2026-10-15', '${user}') returning id`)).rows[0].id;
  await db.exec(`insert into public.pm_employee_evals
    (pm_report_id, location_id, employee_id, attitude, author_id, note)
    values ('${report}', '${shop}', '${user}', 'good', '${user}', 'private')`);
  check((await db.query("select note from public.pm_employee_evals")).rows[0]?.note === "private", "service role can write and read eval");
  await denied(db, "delete from public.pm_employee_evals", "service role cannot delete eval");
  await db.exec("reset role");
  await db.close();
  db = await setup();
  const withoutStaffRevoke = migration.replace(
    "revoke all privileges on table public.pm_employee_evals from public, anon, authenticated, service_role;",
    "revoke all privileges on table public.pm_employee_evals from public, anon, service_role;",
  );
  try { await db.exec(withoutStaffRevoke); check(false, "leftover authenticated grant is refused"); }
  catch (error) { check(String(error.message).includes("0267: PostgREST role can access pm_employee_evals"), "leftover authenticated grant is refused"); }
} catch (error) {
  failures++;
  console.error(`FAIL 0267 harness: ${error.stack ?? error}`);
} finally {
  if (db) await db.close();
}
if (failures) process.exitCode = 1;
else console.log(`PASS 0267: ${checks} checks`);
