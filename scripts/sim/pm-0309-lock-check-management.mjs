/** FILE ONLY: CC runs after 0309 on SIM. Never loads .env or a direct DB URL.
 * SUPABASE_ACCESS_TOKEN=<operator environment>; node scripts/sim/pm-0309-lock-check-management.mjs --ref=jepgzucrvklhqpthowsc
 * The two-session proof of save_pm_employee_eval (W09/B164) that one PGlite session cannot give:
 *   race 1  session A saves an evaluation of E and HOLDS the day-row lock (pg_sleep); session B's save of the same
 *           (report, employee) by another manager must WAIT on A's backend, then supersede A's row — exactly ONE
 *           live evaluation at the end, and it is B's;
 *   race 2  session A saves and holds; the v1 submit (the same guarded UPDATE lib/pm-report.ts submitPmReport
 *           sends) must WAIT on A, then submit; a save after that refuses report_already_submitted.
 * Commits its own fixture: a shop, a GM, a key holder and an employee (all tagged SIM-0309-<uuid>, no valid
 * credential) and a v1 pm_reports day in 2099. Evaluation and day rows are append-only evidence and are kept;
 * the shop, users and memberships are retired afterward. No names or notes beyond the fixture tag are written
 * or printed. No retries: an interrupted request may have committed; the printed fixture ids let CC retire
 * stranded fixtures by hand.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { literal as q, managementQuery, projectRef } from '../supabase-management-query.mjs';
import { proveRace } from './checklist-0276-lock-check-management.mjs';

export const signatures = ['public.save_pm_employee_eval(uuid,uuid,uuid,uuid,text,text,text,text,text,text)'];
export const requiredColumns = {
  locations: ['id', 'name', 'code', 'type', 'active'], users: ['id', 'name', 'role', 'pin_hash', 'active'],
  user_locations: ['user_id', 'location_id', 'active'], pm_reports: ['id', 'location_id', 'report_date', 'status', 'created_by', 'format'],
};
export function fixture() {
  const f = Object.fromEntries(['shop', 'gm', 'kh', 'emp', 'day1', 'day2'].map(key => [key, randomUUID()]));
  f.tag = `SIM-0309-${f.shop}`;
  return f;
}
export function fixtureSQL(f) {
  return `begin;
    insert into public.locations(id,name,code,type,active) values(${q(f.shop)},${q(f.tag)},${q(f.tag)},'permanent',true);
    insert into public.users(id,name,role,pin_hash,active) values
      (${q(f.gm)},${q(f.tag)},'gm','SIM-NO-VALID-CREDENTIAL',true),
      (${q(f.kh)},${q(f.tag)},'key_holder','SIM-NO-VALID-CREDENTIAL',true),
      (${q(f.emp)},${q(f.tag)},'employee','SIM-NO-VALID-CREDENTIAL',true);
    insert into public.user_locations(user_id,location_id,active) values
      (${q(f.gm)},${q(f.shop)},true),(${q(f.kh)},${q(f.shop)},true),(${q(f.emp)},${q(f.shop)},true);
    insert into public.pm_reports(id,location_id,report_date,status,created_by,format) values
      (${q(f.day1)},${q(f.shop)},date '2099-03-01','open',${q(f.gm)},'v1'),
      (${q(f.day2)},${q(f.shop)},date '2099-03-02','open',${q(f.gm)},'v1');
    commit;`;
}
export function retireSQL(f) {
  // Retires only the configuration allocated above; evaluations and day rows stay as append-only evidence.
  return `begin;
    update public.user_locations set active=false where location_id=${q(f.shop)} and user_id in (${[f.gm, f.kh, f.emp].map(q).join(',')});
    update public.users set active=false where id in (${[f.gm, f.kh, f.emp].map(q).join(',')}) and name=${q(f.tag)};
    update public.locations set active=false where id=${q(f.shop)} and code=${q(f.tag)};
    commit;`;
}
export const saveSQL = (f, actor, day, grade) =>
  `select public.save_pm_employee_eval(${q(actor)},${q(day)},${q(f.shop)},${q(f.emp)},${q(grade)},'good','good','good',null,null) as result`;
// The same guarded flip lib/pm-report.ts submitPmReport sends (status open → submitted, checked rowcount).
export const submitSQL = (f, day) =>
  `update public.pm_reports set status='submitted', submitted_by=${q(f.gm)}, submitted_at=clock_timestamp()
    where id=${q(day)} and status='open' and superseded_at is null returning id`;
export const lateSaveSQL = (f, day) => `do $$ begin
    perform public.save_pm_employee_eval(${q(f.kh)},${q(day)},${q(f.shop)},${q(f.emp)},'good','good','good','good',null,null);
    raise exception 'late_save_accepted';
  exception when others then
    if sqlerrm <> 'report_already_submitted' then raise; end if;
  end $$; select true as refused`;

export async function preflight(query) {
  const grants = await query(`begin read only; set local statement_timeout='10s';
    select signature, to_regprocedure(signature) is not null as present,
      coalesce(has_function_privilege('service_role',to_regprocedure(signature),'EXECUTE'),false) as executable
    from unnest(array[${signatures.map(q).join(',')}]::text[]) as required(signature); commit;`);
  assert.ok(signatures.every(signature => grants.some(r => r.signature === signature && r.present === true && r.executable === true)),
    '0309 save_pm_employee_eval and service_role EXECUTE must be present');
  const index = await query(`select count(*)::int as n from pg_indexes where schemaname='public' and indexname='pm_employee_evals_one_live'`);
  assert.equal(index[0]?.n, 1, '0309 pm_employee_evals_one_live must be present');
  const columns = await query(`select table_name,column_name,is_nullable,column_default,is_identity,is_generated from information_schema.columns
    where table_schema='public' and table_name in (${Object.keys(requiredColumns).map(q).join(',')})`);
  for (const [table, names] of Object.entries(requiredColumns)) for (const column of names) {
    assert.ok(columns.some(c => c.table_name === table && c.column_name === column), 'fixture schema must contain every inserted column');
  }
  for (const c of columns) {
    assert.ok(c.is_nullable !== 'NO' || c.column_default != null || c.is_identity === 'YES' || c.is_generated === 'ALWAYS'
      || requiredColumns[c.table_name]?.includes(c.column_name), 'fixture schema must not require an omitted column without a default');
  }
  const enums = await query(`select c.relname as table_name,a.attname as column_name,e.enumlabel from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    join pg_type t on t.oid=a.atttypid join pg_enum e on e.enumtypid=t.oid
    where n.nspname='public' and c.relname in (${Object.keys(requiredColumns).map(q).join(',')})`);
  for (const e of enums) {
    if (!requiredColumns[e.table_name]?.includes(e.column_name)) continue;
    assert.ok(e.table_name === 'users' && e.column_name === 'role', 'fixture enum column mismatch');
  }
  if (enums.some(e => e.table_name === 'users' && e.column_name === 'role')) {
    for (const role of ['gm', 'key_holder', 'employee']) assert.ok(enums.some(e => e.column_name === 'role' && e.enumlabel === role), 'fixture role label mismatch');
  }
}

export async function evidence(query, f, day) {
  return query(`select author_id, superseded_at is null as live from public.pm_employee_evals
    where pm_report_id=${q(day)} and employee_id=${q(f.emp)} order by created_at, id`);
}

export async function runProof(query, log = console.log, raceOptions = {}) {
  await preflight(query);
  const f = fixture();
  log(`FIXTURE allocated ${JSON.stringify(f)}`);
  try {
    await query(fixtureSQL(f));
    // race 1: two saves of one (report, employee) serialize on the day row; the second supersedes the first.
    const r1 = await proveRace(query, saveSQL(f, f.gm, f.day1, 'needs_work'), saveSQL(f, f.kh, f.day1, 'great'), `${f.tag}-1`, raceOptions);
    assert.equal(r1.ok, true, 'the waiting save must commit');
    const rows1 = await evidence(query, f, f.day1);
    assert.equal(rows1.length, 2, 'both saves persisted (append-only)');
    assert.equal(rows1.filter(r => r.live === true).length, 1, 'exactly ONE live evaluation after the race');
    assert.equal(rows1.find(r => r.live === true)?.author_id, f.kh, 'the live evaluation is the second (waiting) save');
    log('PASS race 1: the concurrent save waited on the day-row lock, then superseded; one live evaluation');
    // race 2: the submit waits on a save in flight; a save after the submit refuses.
    const r2 = await proveRace(query, saveSQL(f, f.gm, f.day2, 'good'), submitSQL(f, f.day2), `${f.tag}-2`, raceOptions);
    assert.equal(r2.ok, true, 'the waiting submit must commit');
    const day2 = await query(`select status from public.pm_reports where id=${q(f.day2)}`);
    assert.equal(day2[0]?.status, 'submitted', 'the submit flipped the day after the save committed');
    const late = await query(lateSaveSQL(f, f.day2));
    assert.equal(late[0]?.refused, true, 'a save after submit must refuse report_already_submitted');
    const rows2 = await evidence(query, f, f.day2);
    assert.equal(rows2.filter(r => r.live === true).length, 1, 'the pre-submit save is the only live evaluation');
    log('PASS race 2: the submit waited on the save in flight; a later save refused report_already_submitted');
  } finally {
    // proveRace settles both requests before returning or throwing.
    await query(retireSQL(f));
    const rows = await query(`select
      not exists(select 1 from public.users where id in (${[f.gm, f.kh, f.emp].map(q).join(',')}) and active)
      and not exists(select 1 from public.locations where id=${q(f.shop)} and active) as retired`);
    assert.equal(rows[0]?.retired, true, 'owned fixture configuration must be retired');
    log('PASS own shop, users and memberships retired; evaluation and day rows retained as evidence');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(() => {
    const ref = projectRef(process.argv.slice(2), true);
    return runProof(managementQuery(ref, process.env.SUPABASE_ACCESS_TOKEN));
  }).catch(() => {
    console.error('FAIL 0309 Management API proof: check SIM target, preflight, connectivity and invariants; interrupted requests may need fixture retirement');
    process.exitCode = 1;
  });
}
