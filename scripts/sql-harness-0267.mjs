import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
let failures = 0;
const check = (ok, name) => {
  if (ok) console.log(`ok   ${name}`);
  else { failures++; console.error(`FAIL ${name}`); }
};
async function denied(sql, name) {
  try { await db.exec(sql); check(false, name); }
  catch (error) { check(error.code === "42501", `${name} (${error.code ?? error.message})`); }
}

try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.pm_reports (id uuid primary key, created_by uuid);
    create table public.pm_employee_evals (id uuid primary key, note text, author_id uuid);
    create table public.audit_log (actor_id uuid, actor_role text, action text,
      resource_table text, resource_id uuid, destructive boolean, metadata jsonb);
    alter table public.pm_reports enable row level security;
    alter table public.pm_employee_evals enable row level security;
    create policy pm_reports_insert on public.pm_reports for insert with check (true);
    create policy pm_evals_insert on public.pm_employee_evals for insert with check (true);
    grant all on public.pm_reports, public.pm_employee_evals to anon, authenticated, service_role;
  `);
  await db.exec(readFileSync("supabase/migrations/0267_pm_evals_privacy.sql", "utf8"));
  check(true, "0267 applied with its SQL assertions");
  await db.exec("set role authenticated");
  await denied("select note from public.pm_employee_evals", "authenticated cannot read note");
  await denied("select id from public.pm_reports", "authenticated cannot read PM report");
  await denied("insert into public.pm_employee_evals (id, author_id) values (gen_random_uuid(), gen_random_uuid())", "authenticated cannot spoof eval author");
  await denied("update public.pm_employee_evals set note = 'spoof'", "authenticated cannot update eval");
  await denied("delete from public.pm_employee_evals", "authenticated cannot delete eval");
  await denied("insert into public.pm_reports (id, created_by) values (gen_random_uuid(), gen_random_uuid())", "authenticated cannot spoof report creator");
  await db.exec("reset role; set role service_role;");
  await db.exec("insert into public.pm_employee_evals (id, note) values (gen_random_uuid(), 'private')");
  check((await db.query("select note from public.pm_employee_evals")).rows[0]?.note === "private", "service role can write and read eval");
  await denied("delete from public.pm_employee_evals", "service role cannot delete eval");
} catch (error) {
  failures++;
  console.error(error);
} finally {
  await db.close();
}
if (failures) process.exitCode = 1;
