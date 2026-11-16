/** FILE ONLY: CC runs after 0320 on SIM. No .env or direct database URL.
 * Two-session proof of 0320's lineage key (B084), modeled on the 0291 / 0276 Management API
 * proofs: a holder transaction takes the lineage key and sleeps, the racer must be observed
 * BLOCKED on it (an ungranted advisory lock held by the holder's backend), then the racer's
 * outcome is judged by evidence after both settle (the Management API hides refusal text):
 *   case 1  holder = an instance insert on T1 for day D;  racer = the apply-now activation of
 *           T2 for D → after the holder commits the racer must REFUSE (T1 still active, T2 still
 *           inactive, one instance) — the re-count under the key saw the new instance.
 *   case 2  holder = an instance insert on T1 for day D;  racer = an instance insert on T2
 *           (same lineage, active) for D → the racer must REFUSE (one instance for D).
 *   case 3  holder = the apply-now activation of T2 for D (no instance yet); racer = an instance
 *           insert on T1 for D → the racer waits, then lands on the RETIRED T1 with no sibling
 *           (allowed; the pages read it instance-first) — still exactly one instance for D.
 * Fixture rows are dated 2099, named SIM-0320-<id>; configuration is retired (active=false),
 * append-only evidence (instances) is retained. Interrupted requests may have committed:
 * printed IDs support manual retirement. Never retry transport errors.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { literal as q, managementQuery, projectRef } from '../supabase-management-query.mjs';
import { proveRace } from './checklist-0276-lock-check-management.mjs';

const CASES = 3;
export function fixture() {
  const f = Object.fromEntries(['actor', 'shop'].map(k => [k, randomUUID()]));
  f.tag = `SIM-0320-${randomUUID()}`;
  f.cases = Array.from({ length: CASES }, (_, i) => ({
    name: `${f.tag}-${i}`, t1: randomUUID(), t2: randomUUID(), i1: randomUUID(), i2: randomUUID(),
    date: `2099-02-0${i + 1}`,
  }));
  return f;
}
export function fixtureSQL(f) {
  // T1 = the version serving D (active); T2 = the minted version for D (inactive, supersedes T1),
  // except case 2 where T2 is already active on a later date so an insert on it is legal alone.
  return `begin;
    insert into public.locations(id,name,code,type,active) values(${q(f.shop)},${q(f.tag)},${q(f.tag)},'permanent',true);
    insert into public.users(id,name,role,pin_hash,active) values(${q(f.actor)},${q(f.tag)},'key_holder','SIM-NO-VALID-CREDENTIAL',true);
    ${f.cases.map((c, i) => `
    insert into public.checklist_templates(id,location_id,type,name,active,effective_from)
      values(${q(c.t1)},${q(f.shop)},'closing',${q(c.name)},true,date ${q(c.date)} - 30);
    insert into public.checklist_templates(id,location_id,type,name,active,effective_from,supersedes_template_id)
      values(${q(c.t2)},${q(f.shop)},'closing',${q(c.name)},${i === 1 ? 'true' : 'false'},${i === 1 ? `date ${q(c.date)} + 1` : `date ${q(c.date)}`},${q(c.t1)});
    insert into public.checklist_template_items(id,template_id,label,min_role_level,active)
      values(${q(c.i1)},${q(c.t1)},${q(c.name)},3,true),(${q(c.i2)},${q(c.t2)},${q(c.name)},3,true);`).join('')}
    commit;`;
}
export function retireSQL(f) {
  const tpls = f.cases.flatMap(c => [c.t1, c.t2]).map(q).join(',');
  return `begin;
    update public.checklist_template_items set active=false where template_id in (${tpls});
    update public.checklist_templates set active=false where id in (${tpls}) and location_id=${q(f.shop)};
    update public.users set active=false where id=${q(f.actor)} and name=${q(f.tag)};
    update public.locations set active=false where id=${q(f.shop)} and code=${q(f.tag)}; commit;`;
}
const insertSQL = (f, template, date) => `insert into public.checklist_instances(template_id,location_id,date,status)
  values(${q(template)},${q(f.shop)},date ${q(date)},'open') returning id`;
const activateSQL = (f, c) => `select public.checklist_template_activate_version(${q(f.actor)},${q(c.t1)},${q(c.t2)},true,date ${q(c.date)},
  ${q(JSON.stringify({ [c.i1]: c.i2 }))}::jsonb) as result`;
export function evidenceSQL(f, c) {
  return `select
    (select count(*)::int from public.checklist_instances where location_id=${q(f.shop)} and date=date ${q(c.date)}) as instances,
    (select active from public.checklist_templates where id=${q(c.t1)}) as t1_active,
    (select active from public.checklist_templates where id=${q(c.t2)}) as t2_active,
    (select template_id from public.checklist_instances where location_id=${q(f.shop)} and date=date ${q(c.date)} order by created_at limit 1) as instance_template`;
}
export const requiredColumns = {
  locations: ['id', 'name', 'code', 'type', 'active'], users: ['id', 'name', 'role', 'pin_hash', 'active'],
  checklist_templates: ['id', 'location_id', 'type', 'name', 'active', 'effective_from', 'supersedes_template_id'],
  checklist_template_items: ['id', 'template_id', 'label', 'min_role_level', 'active'],
  checklist_instances: ['template_id', 'location_id', 'date', 'status'],
};
export async function preflight(query) {
  const tables = Object.keys(requiredColumns).map(q).join(',');
  const columns = await query(`select table_name,column_name,is_nullable,column_default,is_identity,is_generated
    from information_schema.columns where table_schema='public' and table_name in (${tables})`);
  for (const [table, names] of Object.entries(requiredColumns)) for (const name of names)
    assert.ok(columns.some(c => c.table_name === table && c.column_name === name), 'fixture schema must contain every inserted column');
  for (const c of columns) assert.ok(c.is_nullable !== 'NO' || c.column_default != null || c.is_identity === 'YES'
    || c.is_generated === 'ALWAYS' || requiredColumns[c.table_name]?.includes(c.column_name), 'fixture schema has omitted required column');
  const rows = await query(`select
    to_regprocedure('public.checklist_template_activate_version(uuid,uuid,uuid,boolean,date,jsonb)') is not null as rpc,
    coalesce(has_function_privilege('service_role','public.checklist_template_activate_version(uuid,uuid,uuid,boolean,date,jsonb)','EXECUTE'),false) as executable,
    exists(select 1 from pg_trigger where tgrelid='public.checklist_instances'::regclass and tgname='checklist_instances_lineage_guard' and tgenabled='O') as guard`);
  assert.equal(rows[0]?.rpc, true, '0320 activation RPC missing (apply 0320 to SIM first)');
  assert.equal(rows[0]?.executable, true, 'service_role EXECUTE on the activation RPC missing');
  assert.equal(rows[0]?.guard, true, '0320 instance guard trigger missing or disabled');
}

export async function runProof(query, log = console.log, raceOptions = {}) {
  await preflight(query);
  const f = fixture();
  log(`FIXTURE allocated ${JSON.stringify(f)}`);
  try {
    await query(fixtureSQL(f));
    const [c1, c2, c3] = f.cases;

    // case 1: instance first, apply-now activation blocked on the key, then refused by its re-count.
    let r = await proveRace(query, insertSQL(f, c1.t1, c1.date), activateSQL(f, c1), `${c1.name}`, raceOptions);
    assert.equal(r.ok, false, 'apply-now activation must refuse once the instance it waited on committed');
    let e = (await query(evidenceSQL(f, c1)))[0];
    assert.deepEqual([e.instances, e.t1_active, e.t2_active, e.instance_template], [1, true, false, c1.t1]);
    log('PASS case 1: apply-now waited on the lineage key and refused (T1 active, T2 inactive, one instance)');

    // case 2: instance on T1, a second instance on T2 (same lineage) waits and is refused.
    r = await proveRace(query, insertSQL(f, c2.t1, c2.date), insertSQL(f, c2.t2, c2.date), `${c2.name}`, raceOptions);
    assert.equal(r.ok, false, 'a second same-lineage instance for the day must refuse');
    e = (await query(evidenceSQL(f, c2)))[0];
    assert.deepEqual([e.instances, e.instance_template], [1, c2.t1]);
    log('PASS case 2: a second same-lineage instance waited on the key and was refused (one instance)');

    // case 3: activation first, the late insert on the retired T1 waits, then lands alone.
    r = await proveRace(query, activateSQL(f, c3), insertSQL(f, c3.t1, c3.date), `${c3.name}`, raceOptions);
    assert.equal(r.ok, true, 'the late insert on the retired version (no sibling) is allowed');
    e = (await query(evidenceSQL(f, c3)))[0];
    assert.deepEqual([e.instances, e.t1_active, e.t2_active, e.instance_template], [1, false, true, c3.t1]);
    log('PASS case 3: activation held the key; the late insert waited and is the day\'s only instance');
    log('PASS 0320: 3 committed lineage-key races with observed waits');
  } finally {
    await query(retireSQL(f));
    const tpls = f.cases.flatMap(c => [c.t1, c.t2]).map(q).join(',');
    const retired = await query(`select
      not exists(select 1 from public.users where id=${q(f.actor)} and active)
      and not exists(select 1 from public.locations where id=${q(f.shop)} and active)
      and not exists(select 1 from public.checklist_templates where id in (${tpls}) and active)
      and not exists(select 1 from public.checklist_template_items where template_id in (${tpls}) and active) as retired`);
    assert.equal(retired[0]?.retired, true, 'all own fixture configuration retired');
    log('PASS own fixture configuration retired; append-only evidence (2099 instances) retained');
  }
}
export function main(args = process.argv.slice(2)) {
  const ref = projectRef(args, true);
  return runProof(managementQuery(ref, process.env.SUPABASE_ACCESS_TOKEN));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(() => main()).catch(() => {
    console.error('FAIL 0320 Management API proof: check SIM target, preflight, connectivity and invariants; interrupted requests may need fixture retirement');
    process.exitCode = 1;
  });
}
