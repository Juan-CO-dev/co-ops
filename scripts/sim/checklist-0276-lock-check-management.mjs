/** FILE ONLY: CC runs after 0276 on SIM. No direct DB URL or pg needed.
 * SUPABASE_ACCESS_TOKEN=<operator environment>; node scripts/sim/checklist-0276-lock-check-management.mjs --ref=jepgzucrvklhqpthowsc
 * WRITES only newly allocated fixture UUIDs; never reuses existing shop/user/history.
 * Retains evidence append-only; deactivates its own shop/user/membership/template/item.
 * A network interruption can leave tagged fixtures active: operator must retire those
 * configurations manually. No retry of an ambiguously committed request is safe.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { literal as q, managementQuery, projectRef } from '../supabase-management-query.mjs';
import { preflightManagement } from '../preflight-0276-management.mjs';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const settled = promise => promise.then(rows => ({ ok: true, rows }), error => ({ ok: false, refusal: error.refusal }));
export function fixture() {
  const f = Object.fromEntries(['actor', 'shop', 'template', 'item', 'report', 'first', 'second', 'third'].map(key => [key, randomUUID()]));
  f.tag = `SIM-0276-${f.template}`;
  return f;
}
export function fixtureSQL(f) {
  // Baseline required fields: docs/CO-OPS_Foundation_Spec_v1.3.md table definitions
  // for users/locations/checklist_templates/items/instances/written_reports.
  // That is not a live dump: runProof checks the actual catalog before emission.
  return `begin;
    insert into public.locations(id,name,code,type,active) values(${q(f.shop)},${q(f.tag)},${q(f.tag)},'permanent',true);
    insert into public.users(id,name,role,pin_hash,active) values(${q(f.actor)},${q(f.tag)},'key_holder','SIM-NO-VALID-CREDENTIAL',true);
    insert into public.user_locations(user_id,location_id,active) values(${q(f.actor)},${q(f.shop)},true);
    insert into public.checklist_templates(id,location_id,type,name,active) values(${q(f.template)},${q(f.shop)},'closing',${q(f.tag)},true);
    insert into public.checklist_template_items(id,template_id,label,min_role_level,active) values(${q(f.item)},${q(f.template)},${q(f.tag)},3,true);
    insert into public.checklist_instances(id,template_id,location_id,date,status) values
      ${['first','second','third'].map((key, index) => `(${q(f[key])},${q(f.template)},${q(f.shop)},date '2099-01-01'+${index},'open')`).join(',')};
    insert into public.written_reports(id,location_id,submitted_by,submitted_by_role,title,body,category,visibility_min_level)
      values(${q(f.report)},${q(f.shop)},${q(f.actor)},'key_holder',${q(f.tag)},${q(f.tag)},'other',3);
    ${['first','second','third'].map(key => writeSQL(f, f[key])).join(';')}; commit;`;
}
export function retireSQL(f) {
  return `begin;
    update public.checklist_template_items set active=false where id=${q(f.item)} and template_id=${q(f.template)};
    update public.checklist_templates set active=false where id=${q(f.template)} and name=${q(f.tag)};
    update public.user_locations set active=false where user_id=${q(f.actor)} and location_id=${q(f.shop)};
    update public.users set active=false where id=${q(f.actor)} and name=${q(f.tag)};
    update public.locations set active=false where id=${q(f.shop)} and code=${q(f.tag)}; commit;`;
}
const writeSQL = (f, id) => `select public.checklist_write_completion(${q(f.actor)},${q(id)},${q(f.item)},null,null,${q(f.tag)}) as result`;
const confirmSQL = (f, id, heads) => `select public.checklist_confirm_instance(${q(f.actor)},${q(id)},clock_timestamp(),'[]',array[${heads.map(row => q(row.id)).join(',')}]::uuid[]) as result`;
const editSQL = (f, text) => `select public.written_report_update_self(${q(f.actor)},${q(f.report)},${q(f.tag)},${q(text)},'other',3) as result`;
export const transactionSQL = (name, sql, hold = false) => `begin isolation level read committed;
  set local statement_timeout='18s'; set local lock_timeout='14s';
  set local application_name=${q(name)}; set local role service_role;
  ${sql}; ${hold ? 'select pg_sleep(7);' : ''} commit;`;

/** Observe a real ungranted lock AND its blocker; elapsed time is secondary proof. */
export async function proveRace(query, holderSQL, racerSQL, tag, { sleep = pause, now = Date.now } = {}) {
  const holderName = `${tag}-h`, racerName = `${tag}-r`;
  const holderStart = now();
  const holder = settled(query(transactionSQL(holderName, holderSQL, true)));
  let racer;
  try {
    // Readiness means the holder function returned and its transaction is sleeping.
    let ready = false;
    for (let i = 0; i < 40; i++) {
      const rows = await query(`select exists(select 1 from pg_stat_activity where application_name=${q(holderName)} and wait_event='PgSleep') as ready`);
      if (rows[0]?.ready === true) { ready = true; break; }
      await sleep(100);
    }
    assert.ok(ready, 'holder must acquire lock and enter pg_sleep');
    await sleep(Math.max(0, 2000 - (now() - holderStart)));
    const racerStart = now();
    racer = settled(query(transactionSQL(racerName, racerSQL))).then(result => ({ ...result, finishedAt: now() }));
    let blocked = false;
    for (let i = 0; i < 30; i++) {
      const rows = await query(`select exists(select 1 from pg_stat_activity h
        join pg_stat_activity r on h.pid = any(pg_blocking_pids(r.pid))
        join pg_locks l on l.pid=r.pid and not l.granted
        where h.application_name=${q(holderName)} and r.application_name=${q(racerName)} and h.pid<>r.pid) as blocked`);
      if (rows[0]?.blocked === true) { blocked = true; break; }
      await sleep(100);
    }
    const [a,b] = await Promise.all([holder, racer]);
    assert.ok(a.ok, 'holder function must commit successfully');
    assert.ok(blocked, 'racer must have an ungranted lock blocked by holder backend');
    assert.ok(b.finishedAt - racerStart >= Math.max(0, 7000 - (racerStart - holderStart)),
      'racer elapsed time must cover holder remainder');
    return b;
  } finally {
    // Never retire fixtures while an outstanding writer may still own a lock.
    await Promise.all([holder, racer].filter(Boolean));
  }
}

const requiredColumns = {
  locations: ['id','name','code','type','active'], users: ['id','name','role','pin_hash','active'],
  user_locations: ['user_id','location_id','active'], checklist_templates: ['id','location_id','type','name','active'],
  checklist_template_items: ['id','template_id','label','min_role_level','active'],
  checklist_instances: ['id','template_id','location_id','date','status'],
  written_reports: ['id','location_id','submitted_by','submitted_by_role','title','body','category','visibility_min_level','edit_count'],
};
export async function runProof(query, log = console.log, raceOptions = {}) {
  await preflightManagement(query);
  const columns = await query(`select table_name,column_name,is_nullable,column_default,is_identity,is_generated from information_schema.columns where table_schema='public'
    and table_name in (${Object.keys(requiredColumns).map(q).join(',')})`);
  for (const [table, names] of Object.entries(requiredColumns)) for (const column of names) {
    assert.ok(columns.some(row => row.table_name === table && row.column_name === column), 'fixture schema must contain every inserted column');
  }
  for (const column of columns) {
    assert.ok(column.is_nullable !== 'NO' || column.column_default != null || column.is_identity === 'YES'
      || column.is_generated === 'ALWAYS' || requiredColumns[column.table_name]?.includes(column.column_name),
    'fixture schema must not require an omitted column without a default');
  }
  // Foundation schema uses text CHECKs. Refuse incompatible enum evolution before
  // any INSERT; pg_enum is authoritative for an enum-backed inserted column.
  const enums = await query(`select c.relname as table_name,a.attname as column_name,e.enumlabel
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    join pg_type t on t.oid=a.atttypid join pg_enum e on e.enumtypid=t.oid
    where n.nspname='public' and c.relname in (${Object.keys(requiredColumns).map(q).join(',')})`);
  const enumValues = { 'locations.type':'permanent','users.role':'key_holder',
    'checklist_templates.type':'closing','checklist_instances.status':'open',
    'written_reports.submitted_by_role':'key_holder','written_reports.category':'other' };
  for (const row of enums) {
    if (!requiredColumns[row.table_name]?.includes(row.column_name)) continue;
    const key = `${row.table_name}.${row.column_name}`;
    assert.ok(enumValues[key] && enums.some(value => value.table_name===row.table_name
      && value.column_name===row.column_name && value.enumlabel===enumValues[key]),
    'fixture enum labels must match live pg_enum before insert');
  }
  const f = fixture();
  const heads = id => query(`select to_jsonb(c) as row from public.checklist_completions c where instance_id=${q(id)} and superseded_at is null order by id`).then(rows => rows.map(row => row.row));
  const attest = async (id, expected) => {
    assert.deepEqual(await heads(id), expected, 'attested completion rows unchanged');
    const rows = await query(`select status,confirmed_by,(select count(*)::int from public.checklist_submissions s
      where s.instance_id=i.id and s.is_final_confirmation) as finals from public.checklist_instances i where id=${q(id)}`);
    assert.equal(rows[0]?.status,'confirmed'); assert.equal(rows[0]?.confirmed_by,f.actor); assert.equal(rows[0]?.finals,1);
  };
  try {
    await query(fixtureSQL(f));
    const before = await heads(f.first);
    const replaced = await proveRace(query, writeSQL(f,f.first), confirmSQL(f,f.first,before), `${f.tag}-1`, raceOptions);
    assert.equal(replaced.ok,false); assert.equal(replaced.refusal,'completion_set_changed');
    const after = await heads(f.first);
    assert.notDeepEqual(after.map(row => row.id),before.map(row => row.id),'replacement changes live head');
    await query(transactionSQL(`${f.tag}-refresh`, confirmSQL(f,f.first,after)));
    await attest(f.first,after);
    log('PASS replacement first: stale snapshot refused, refreshed set attested');
    for (const [key, name] of [['second','confirmation first'],['third','concurrent confirmations']]) {
      const snapshot = await heads(f[key]);
      const result = await proveRace(query, confirmSQL(f,f[key],snapshot), key==='second' ? writeSQL(f,f[key]) : confirmSQL(f,f[key],snapshot), `${f.tag}-${key}`, raceOptions);
      assert.equal(result.ok,false); assert.equal(result.refusal,'instance_not_open');
      await attest(f[key],snapshot);
      log(`PASS ${name}: one final, attested rows unchanged`);
    }
    const edit = await proveRace(query, editSQL(f,'SIM first queued edit'), editSQL(f,'SIM second queued edit'), `${f.tag}-edit`, raceOptions);
    assert.equal(edit.ok,true); assert.equal(edit.rows[0]?.result,1);
    const report = await query(`select edit_count,body from public.written_reports where id=${q(f.report)}`);
    assert.equal(report[0]?.edit_count,2,'both queued increments must land');
    assert.equal(report[0]?.body,'SIM second queued edit','racer edit must follow holder');
    log('PASS queued report edits: both increments land');
  } finally {
    await query(retireSQL(f));
    const retired = await query(`select
      not exists(select 1 from public.users where id=${q(f.actor)} and active)
      and not exists(select 1 from public.locations where id=${q(f.shop)} and active)
      and not exists(select 1 from public.user_locations where user_id=${q(f.actor)} and active)
      and not exists(select 1 from public.checklist_templates where id=${q(f.template)} and active)
      and not exists(select 1 from public.checklist_template_items where id=${q(f.item)} and active) as retired`);
    assert.equal(retired[0]?.retired,true,'all owned fixture configuration retired');
    log('PASS own fixture configuration retired; append-only evidence retained');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(() => {
    const ref = projectRef(process.argv.slice(2), true);
    return runProof(managementQuery(ref,process.env.SUPABASE_ACCESS_TOKEN));
  }).catch(error => {
    if (error?.name === 'AssertionError') console.error(`FAIL assertion: ${error.message.split('\n')[0]}`);
    console.error('FAIL 0276 Management API lock proof: check SIM target, fixtures, connectivity and invariants; interrupted requests may need fixture retirement');
    process.exitCode=1;
  });
}
