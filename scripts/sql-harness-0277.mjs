/** Local privilege proof only. Real PostgreSQL column-ACL/sim verification remains CC's gate. */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const migration = readFileSync("supabase/migrations/0277_postgrest_checklist_write_lockdown.sql", "utf8").replace(/\r\n/g, "\n");
const manifest = [...migration.matchAll(/^  \('([a-z_]+)', array\[([^\]]+)\]\)[,;]$/gm)]
  .map(([, table, names]) => ({ table, policies: [...names.matchAll(/'([^']+)'/g)].map(m => m[1]) }));
const signatures = [...migration.matchAll(/^    '(public\.[^']+)'[,\n]/gm)].map(m => m[1]);
let checks = 0;
function check(ok, message) { checks++; if (!ok) throw new Error(message); }
async function denied(db, sql, label) {
  try { await db.exec(sql); throw new Error(`${label}: unexpectedly succeeded`); }
  catch (error) { check(error.code === "42501", `${label}: ${error.message}`); }
}
async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create role read_auditor;
    grant usage on schema public to anon, authenticated, service_role, read_auditor;
    create table public.audit_log(actor_id uuid, actor_role text, action text, resource_table text not null,
      resource_id uuid, destructive boolean, metadata jsonb);
    create function public.is_member() returns boolean language sql stable as
      'select current_setting(''test.member'', true) = ''yes''';
    set test.member = 'yes';`);
  for (const { table, policies } of manifest) {
    await db.exec(`create table public.${table}(id integer primary key, value text);
      insert into public.${table} values(1, 'before');
      alter table public.${table} enable row level security;
      grant all on public.${table} to anon, authenticated, service_role;
      grant select(id) on public.${table} to read_auditor;
      grant select(value) on public.${table} to public;
      grant update(value), insert(id), references(id) on public.${table} to authenticated;
      create policy ${table}_read on public.${table} for select using(public.is_member());
      create policy ${table}_no_user_delete on public.${table} for delete using(false);
      create policy ${table}_no_user_update on public.${table} for update using(false) with check(false);`);
    for (const policy of policies) {
      const kind = policy.includes('update') ? 'update' : 'insert';
      await db.exec(`create policy ${policy} on public.${table} for ${kind} ${kind === 'update' ? 'using(true)' : 'with check(true)'}`);
    }
  }
  for (const signature of signatures) await db.exec(`create function ${signature} returns integer language sql as 'select 1';
    revoke all on function ${signature} from public, anon, authenticated;
    grant execute on function ${signature} to service_role;`);
  return db;
}
const marker = '-- ASSERTIONS:';
function inject(sql) { return migration.replace(marker, sql + '\n' + marker); }
let db;
try {
  check(manifest.length === 5 && signatures.length === 5, 'five tables and five exact RPC signatures');
  db = await setup();
  await db.exec('revoke update on public.checklist_instances from authenticated');
  const survives = (await db.query("select has_column_privilege('authenticated','public.checklist_instances','value','UPDATE') as allowed")).rows[0].allowed;
  console.log(`0277 column-ACL probe: table REVOKE ${survives ? 'preserved' : 'removed'} explicit UPDATE(value); real sim verification required`);
  await db.exec('grant update on public.checklist_instances to authenticated');
  for (const role of ['authenticated', 'anon']) {
    await db.exec(`set role ${role}`);
    for (const { table } of manifest) check((await db.query(`select * from public.${table}`)).rows.length === 1, `${role} member reads ${table} before`);
    await db.exec('reset role');
  }
  await db.exec(migration);
  const audit = (await db.query('select * from public.audit_log')).rows;
  check(audit.length === 6 && audit.every(r => r.action === 'security.grants_change'
    && r.destructive && r.metadata.actor_context === 'migration_apply' && r.metadata.migration === '0277_postgrest_checklist_write_lockdown'), 'six audit rows with registered action and migration metadata');
  const tableAudit = audit.filter(r => manifest.some(m => m.table === r.resource_table));
  check(tableAudit.length === 5 && JSON.stringify(tableAudit.map(r => r.resource_table).sort()) === JSON.stringify(manifest.map(r => r.table).sort()), 'five exact per-table audit rows');
  const summary = audit.filter(r => r.resource_table === 'schema_migrations');
  check(summary.length === 1 && summary[0].metadata.scope === 'checklist PostgREST direct-write lockdown'
    && JSON.stringify(summary[0].metadata.affected_tables) === JSON.stringify(manifest.map(r => r.table).sort()), 'one migration summary with exact affected tables');
  for (const role of ['authenticated', 'anon']) {
    await db.exec(`set role ${role}`);
    for (const { table } of manifest) {
      await denied(db, `insert into public.${table} values(2, 'blocked')`, `${role} insert ${table}`);
      await denied(db, `update public.${table} set value='blocked' where id=1`, `${role} update ${table}`);
      await denied(db, `delete from public.${table} where id=1`, `${role} delete ${table}`);
      check((await db.query(`select * from public.${table}`)).rows.length === 1, `${role} member reads ${table} after`);
      await db.exec("set test.member='no'");
      check((await db.query(`select * from public.${table}`)).rows.length === 0, `${role} foreign reader denied ${table}`);
      await db.exec("set test.member='yes'");
    }
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  for (const { table } of manifest) {
    await db.exec(`insert into public.${table} values(2,'service'); update public.${table} set value='updated' where id=2`);
    check((await db.query(`select value from public.${table} where id=2`)).rows[0].value === 'updated', `service writes ${table}`);
    await db.exec(`delete from public.${table} where id=2`);
    check((await db.query(`select * from public.${table}`)).rows.length === 1, `service DELETE retained ${table}`);
  }
  await db.exec('reset role');
  for (const { table } of manifest) check((await db.query(`select policyname from pg_policies where tablename='${table}' and policyname in ('${table}_no_user_delete','${table}_no_user_update')`)).rows.length === 2, `false policies retained ${table}`);
  await db.close(); db = undefined;
  const cases = [
    ['table grant', 'grant update on public.checklist_instances to authenticated;', 'PostgREST write grant remains'],
    ['column grant', 'grant update(value) on public.checklist_instances to authenticated;', 'PostgREST write grant remains'],
    ['PUBLIC grant', 'grant insert on public.checklist_instances to public;', 'PostgREST write grant remains'],
    ['column PUBLIC grant', 'grant references(id) on public.checklist_instances to public;', 'PostgREST write grant remains'],
    ...['insert','update','delete','all'].map(kind => [`permissive ${kind}`, `create policy sibling on public.checklist_instances for ${kind} ${kind === 'insert' ? 'with check(true)' : 'using(true)'};`, 'permissive write policy remains']),
    ['role policy', 'create policy sibling on public.checklist_instances for insert to authenticated with check(true);', 'permissive write policy remains'],
    ['RLS disabled', 'alter table public.checklist_instances disable row level security;', 'RLS disabled'],
    ['SELECT lost', 'revoke select on public.checklist_instances from anon;', 'SELECT surface changed'],
    ['SELECT added', 'grant select on public.checklist_instances to read_auditor;', 'SELECT surface changed'],
    ['column SELECT lost', 'revoke select(id) on public.checklist_instances from read_auditor;', 'SELECT surface changed'],
    ['SELECT policy drift', 'alter policy checklist_instances_read on public.checklist_instances using(true);', 'SELECT surface changed'],
    ['missing prerequisite', `drop function ${signatures[0]};`, 'required 0276 function missing'],
    ['missing EXECUTE', `revoke execute on function ${signatures[0]} from service_role;`, 'service_role lacks EXECUTE'],
    ['service DML lost', 'revoke delete on public.checklist_instances from service_role;', 'service_role DML changed'],
  ];
  for (const [label, statement, expected] of cases) {
    db = await setup();
    try { await db.exec(inject(statement)); throw new Error('migration unexpectedly succeeded'); }
    catch (error) { check(String(error.message).includes(`0277: ${expected}`), `${label}: ${error.message}`); }
    await db.exec('rollback');
    check((await db.query('select * from public.audit_log')).rows.length === 0, `${label} no audit on failure`);
    check((await db.query("select has_table_privilege('authenticated','public.checklist_instances','INSERT') as allowed")).rows[0].allowed, `${label} grants rolled back`);
    console.log(`0277 mutation ${label}: expected ${expected}`);
    await db.close(); db = undefined;
  }
  console.log(`PASS 0277: ${checks} checks`);
} catch (error) {
  console.error(`FAIL 0277: ${error.stack ?? error}`); process.exitCode = 1;
} finally { if (db) await db.close(); }
