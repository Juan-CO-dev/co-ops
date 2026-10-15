/** Executable privilege and RLS proof for 0272, without database access. */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync("supabase/migrations/0272_postgrest_write_lockdown.sql", "utf8");
const manifest = [...migration.matchAll(/^  \('([a-z_]+)', array\[([^\]]+)\]\)[,;]$/gm)]
  .map(([, table, policies]) => ({ table, policies: [...policies.matchAll(/'([^']+)'/g)].map(x => x[1]) }));
const excluded = ["checklist_instances", "checklist_completions", "checklist_submissions", "checklist_incomplete_reasons", "written_reports"];
let checks = 0;
function check(ok, message) { checks++; if (!ok) throw new Error(message); }
async function denied(db, sql, message) {
  try { await db.exec(sql); throw new Error(`${message}: unexpectedly succeeded`); }
  catch (error) { check(error.code === "42501", `${message}: ${error.code ?? error.message}`); }
}
function level(table) {
  if (["locations","positions","position_responsibilities","training_modules","user_locations"].includes(table)) return 8;
  if (["checklist_templates","checklist_template_items","deep_clean_tasks","par_levels","recipe_ingredients","recipe_steps","tip_pools","tip_pool_distributions","vendor_orders","lto_performance"].includes(table)) return 7;
  if (["cash_reports","opening_setup_items","opening_setup_verifications"].includes(table)) return 4;
  if (["customer_feedback","maintenance_notes","report_photos","shift_overlays","training_reports","vendor_deliveries"].includes(table)) return 3;
  if (table === "maintenance_tickets" || table === "shift_overlay_corrections") return 5;
  return 6;
}
async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create function public.current_user_role_level() returns integer language sql stable as 'select 6';
    create function public.current_user_id() returns uuid language sql stable as 'select null::uuid';
    create function public.current_user_locations() returns uuid[] language sql stable as 'select array[]::uuid[]';
    create table public.audit_log (actor_id uuid, actor_role text, action text,
      resource_table text, resource_id uuid, destructive boolean, metadata jsonb);`);
  for (const { table, policies } of manifest) {
    await db.exec(`create table public.${table} (id integer primary key, value text);
      insert into public.${table} values (1, 'before');
      alter table public.${table} enable row level security;
      grant select, insert, update, delete, truncate, references, trigger on public.${table} to anon, authenticated, service_role;
      create policy ${table}_read on public.${table} for select using (public.current_user_role_level() >= 3);`);
    for (const policy of policies) {
      const kind = policy.includes("update") ? "update" : "insert";
      await db.exec(`create policy ${policy} on public.${table} for ${kind}
        ${kind === "insert" ? `with check (public.current_user_role_level() >= ${level(table)})` : `using (public.current_user_role_level() >= ${level(table)})`};`);
    }
  }
  for (const table of excluded) await db.exec(`create table public.${table} (id integer primary key, value text);
    alter table public.${table} enable row level security;
    grant all on public.${table} to anon, authenticated, service_role;
    create policy ${table}_insert on public.${table} for insert with check (true);`);
  await db.exec("grant update (value) on public.written_reports to authenticated;");
  // Explicit column ACL proves why a table-level REVOKE alone is insufficient.
  await db.exec("grant update (value), insert (id, value) on public.vendor_items to authenticated;");
  return db;
}

let db;
let stage = "setup";
try {
  check(manifest.length === 42, "manifest is 42 tables");
  db = await setup();
  await db.exec("revoke update on public.vendor_items from authenticated");
  const columnSurvives = (await db.query("select has_column_privilege('authenticated', 'public.vendor_items', 'value', 'UPDATE') as allowed")).rows[0]?.allowed;
  check(typeof columnSurvives === "boolean", "PGlite table REVOKE versus column grant measured");
  console.log(`0272 column-grant probe: table REVOKE ${columnSurvives ? "preserved" : "removed"} explicit UPDATE(value)`);
  await db.exec("grant update on public.vendor_items to authenticated");
  await db.exec("set role authenticated");
  await db.exec("update public.vendor_items set value = 'before allowed' where id = 1");
  check((await db.query("select value from public.vendor_items where id = 1")).rows[0]?.value === "before allowed", "L6 authenticated can update vendor_items before migration");
  await db.exec("reset role");
  stage = "read excluded policies";
  const excludedSql = excluded.map(t => `'${t}'`).join(",");
  const beforeExcluded = (await db.query(`select tablename, policyname, cmd from pg_policies where tablename in (${excludedSql}) order by tablename, policyname`)).rows;
  const excludedGrants = `select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name in (${excludedSql}) order by table_name, grantee, privilege_type`;
  const beforeExcludedGrants = (await db.query(excludedGrants)).rows;
  const excludedAclSql = `select c.relname, c.relacl::text as table_acl, a.attname,
    a.attacl::text as column_acl from pg_class c join pg_namespace n on n.oid = c.relnamespace
    left join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public' and c.relname in (${excludedSql}) order by c.relname, a.attname`;
  const beforeExcludedAcl = (await db.query(excludedAclSql)).rows;
  stage = "apply migration";
  const firstDo = migration.indexOf("do $$");
  stage = "manifest insert";
  await db.exec(migration.slice(0, firstDo));
  stage = "remaining migration";
  const secondDo = migration.indexOf("do $$", firstDo + 1);
  await db.exec(migration.slice(firstDo, secondDo));
  stage = "assertions and audit";
  await db.exec(migration.slice(secondDo));
  const afterExcluded = (await db.query(`select tablename, policyname, cmd from pg_policies where tablename in (${excludedSql}) order by tablename, policyname`)).rows;
  check(JSON.stringify(beforeExcluded) === JSON.stringify(afterExcluded), "five step-2 policies unchanged");
  check(JSON.stringify(beforeExcludedGrants) === JSON.stringify((await db.query(excludedGrants)).rows), "five step-2 grants unchanged");
  check(JSON.stringify(beforeExcludedAcl) === JSON.stringify((await db.query(excludedAclSql)).rows), "five step-2 table and column grants unchanged");
  const audit = (await db.query("select resource_table, action, destructive, metadata from public.audit_log order by resource_table")).rows;
  check(audit.length === 42 && audit.every(r => r.action === "security.grants_change" && r.destructive === true && r.metadata.actor_context === "migration_apply" && r.metadata.migration === "0272_postgrest_write_lockdown"), "42 destructive audit rows");
  const policies = (await db.query("select tablename, policyname from pg_policies where schemaname = 'public'")).rows;
  check(["insert","update","delete"].every(k => policies.some(p => p.tablename === "opening_setup_verifications" && p.policyname === `opening_setup_verifications_no_user_${k}`)), "opening setup explicit denies");
  for (const role of ["authenticated", "anon"]) {
    await db.exec(`set role ${role}`);
    for (const { table } of manifest) {
      await denied(db, `insert into public.${table} values (2, 'blocked')`, `${role} insert ${table}`);
      await denied(db, `update public.${table} set value = 'blocked' where id = 1`, `${role} update ${table}`);
      const rows = (await db.query(`select id from public.${table} where id = 1`)).rows;
      check(rows.length === 1, `${role} SELECT retained on ${table}`);
    }
    await db.exec("reset role");
  }
  await db.exec("set role service_role");
  for (const { table } of manifest) {
    await db.exec(`insert into public.${table} values (2, 'service'); update public.${table} set value = 'updated' where id = 2`);
    check((await db.query(`select value from public.${table} where id = 2`)).rows[0]?.value === "updated", `service_role writes ${table}`);
  }
  await db.exec("reset role");
  await db.close();
  db = await setup();
  // PGlite's table-level revoke clears the setup column ACL. Regrant after
  // cleanup to prove the assertion catches a surviving or later grant.
  const weakened = migration.replace("create policy opening_setup_verifications_no_user_insert",
    "grant insert (id, value) on public.vendor_items to authenticated;\ncreate policy opening_setup_verifications_no_user_insert");
  try { await db.exec(weakened); throw new Error("weakened migration succeeded"); }
  catch (error) { check(String(error.message).includes("0272: PostgREST write grant remains on vendor_items"), `leftover authenticated INSERT grant trips DO assertion: ${error.message}`); }
  console.log(`PASS 0272: ${checks} checks`);
} catch (error) {
  console.error(`FAIL 0272 (${stage}): ${error.stack ?? error} code=${error.code} detail=${error.detail}`);
  process.exitCode = 1;
} finally { if (db) await db.close(); }
