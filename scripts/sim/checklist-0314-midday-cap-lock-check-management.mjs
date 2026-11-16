/** FILE ONLY: CC runs after 0314 on SIM. No .env or direct database URL; Management API only.
 * SUPABASE_ACCESS_TOKEN=<operator environment>; node scripts/sim/checklist-0314-midday-cap-lock-check-management.mjs --ref=jepgzucrvklhqpthowsc
 * Two-session proof for W13/B178 (0314 create_mid_day_prep_instance_atomic): with ONE mid-day
 * instance already committed, a holder creates the second and holds its transaction open; a
 * racer's create must WAIT on the advisory lock (observed ungranted lock + blocker), then answer
 * cap_reached — exactly two rows for (template, shop, today). The 0291/0276 observed-wait pattern
 * (proveRace) is reused. These races COMMIT. Never retry a transport error.
 * The RPC pins the ET day, so fixture instances are dated TODAY at a NEW fixture shop that no one
 * else uses. Only allocated SIM-0314 configuration is retired (shop, user, membership, template);
 * the instances stay as append-only evidence and are printed by id.
 * Interrupted requests may have committed: the printed ids support manual retirement.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { literal as q, managementQuery, projectRef } from '../supabase-management-query.mjs';
import { preflightManagement } from '../preflight-0276-management.mjs';
import { proveRace, transactionSQL } from './checklist-0276-lock-check-management.mjs';

export function fixture() {
  const f = Object.fromEntries(['actor', 'shop', 'template'].map(key => [key, randomUUID()]));
  f.tag = `SIM-0314-${f.template}`;
  return f;
}
const today = `(now() at time zone 'America/New_York')::date`;
export function fixtureSQL(f) {
  return `begin;
    insert into public.locations(id,name,code,type,active) values(${q(f.shop)},${q(f.tag)},${q(f.tag)},'permanent',true);
    insert into public.users(id,name,role,pin_hash,active) values(${q(f.actor)},${q(f.tag)},'key_holder','SIM-NO-VALID-CREDENTIAL',true);
    insert into public.user_locations(user_id,location_id,active) values(${q(f.actor)},${q(f.shop)},true);
    insert into public.checklist_templates(id,location_id,type,prep_subtype,name,active)
      values(${q(f.template)},${q(f.shop)},'prep','mid_day_prep',${q(f.tag)},true); commit;`;
}
export function retireSQL(f) {
  return `begin;
    update public.checklist_templates set active=false where id=${q(f.template)} and name=${q(f.tag)};
    update public.user_locations set active=false where user_id=${q(f.actor)} and location_id=${q(f.shop)};
    update public.users set active=false where id=${q(f.actor)} and name=${q(f.tag)};
    update public.locations set active=false where id=${q(f.shop)} and code=${q(f.tag)}; commit;`;
}
export const createSQL = f => `select public.create_mid_day_prep_instance_atomic(${q(f.template)},${q(f.shop)},${today},${q(f.actor)},2) as result`;
export const evidenceSQL = f => `select count(*)::int as n, array_agg(id order by triggered_at) as ids,
  bool_and(allows_multiple_per_day and status = 'open') as shape
  from public.checklist_instances where template_id=${q(f.template)} and location_id=${q(f.shop)} and date=${today}`;

export const requiredColumns = {
  locations: ['id','name','code','type','active'], users: ['id','name','role','pin_hash','active'],
  user_locations: ['user_id','location_id','active'],
  checklist_templates: ['id','location_id','type','prep_subtype','name','active'],
};
export async function fixturePreflight(query) {
  const tables = Object.keys(requiredColumns).map(q).join(',');
  const columns = await query(`select table_name,column_name,is_nullable,column_default,is_identity,is_generated
    from information_schema.columns where table_schema='public' and table_name in (${tables})`);
  for (const [table, names] of Object.entries(requiredColumns)) for (const name of names)
    assert.ok(columns.some(c => c.table_name === table && c.column_name === name), `fixture schema must contain ${table}.${name}`);
  for (const c of columns) assert.ok(c.is_nullable !== 'NO' || c.column_default != null || c.is_identity === 'YES'
    || c.is_generated === 'ALWAYS' || requiredColumns[c.table_name]?.includes(c.column_name), 'fixture schema has an omitted required column');
  const fn = await query(`select to_regprocedure('public.create_mid_day_prep_instance_atomic(uuid,uuid,date,uuid,integer)') is not null as present,
    coalesce(has_function_privilege('service_role',to_regprocedure('public.create_mid_day_prep_instance_atomic(uuid,uuid,date,uuid,integer)'),'EXECUTE'),false) as executable,
    coalesce(has_function_privilege('authenticated',to_regprocedure('public.create_mid_day_prep_instance_atomic(uuid,uuid,date,uuid,integer)'),'EXECUTE'),true) as staff`);
  assert.ok(fn[0]?.present === true && fn[0]?.executable === true && fn[0]?.staff === false, '0314 RPC missing or its grants escaped');
}

export async function runProof(query, log = console.log, raceOptions = {}) {
  await preflightManagement(query);
  await fixturePreflight(query);
  const f = fixture();
  log(`FIXTURE allocated ${JSON.stringify(f)}`);
  try {
    await query(fixtureSQL(f));
    const first = await query(transactionSQL(`${f.tag}-first`, createSQL(f)));
    assert.equal(first[0]?.result?.ok, true, 'the first create commits');
    const before = await query(evidenceSQL(f));
    assert.equal(before[0]?.n, 1, 'exactly one instance before the race');
    // Holder: the second create, held open. Racer: a third create that must wait, then refuse.
    const raced = await proveRace(query, createSQL(f), createSQL(f), f.tag, raceOptions);
    assert.equal(raced.ok, true, 'the waiting create commits its answer');
    assert.equal(raced.rows[0]?.result?.ok, false, 'the waiting create is refused');
    assert.equal(raced.rows[0]?.result?.reason, 'cap_reached', 'the waiting create sees the holder row: cap_reached');
    const after = await query(evidenceSQL(f));
    assert.equal(after[0]?.n, 2, 'exactly two instances after the race (the cap)');
    assert.equal(after[0]?.shape, true, 'both rows open and multi-per-day');
    log(`EVIDENCE instance ids ${JSON.stringify(after[0]?.ids)}`);
    const refused = await query(`do $$ begin
      perform public.create_mid_day_prep_instance_atomic(${q(f.template)},${q(f.shop)},${today} - 1,${q(f.actor)},2);
      raise exception 'expected date_not_today' using errcode='XX000';
      exception when sqlstate 'P0001' then if sqlerrm <> 'date_not_today' then raise; end if; end $$; select true as ok`);
    assert.equal(refused[0]?.ok, true, 'yesterday is refused date_not_today');
    log('PASS 0314: the concurrent third create waited on the advisory lock and was refused cap_reached; two rows; date pinned');
  } finally {
    await query(retireSQL(f));
    const retired = await query(`select
      not exists(select 1 from public.users where id=${q(f.actor)} and active)
      and not exists(select 1 from public.locations where id=${q(f.shop)} and active)
      and not exists(select 1 from public.user_locations where user_id=${q(f.actor)} and location_id=${q(f.shop)} and active)
      and not exists(select 1 from public.checklist_templates where id=${q(f.template)} and active) as retired`);
    assert.equal(retired[0]?.retired, true, 'all own fixture configuration retired');
    log('PASS own fixture configuration retired; instances retained as append-only evidence');
  }
}
export function main(args = process.argv.slice(2)) {
  const ref = projectRef(args, true);
  return runProof(managementQuery(ref, process.env.SUPABASE_ACCESS_TOKEN));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(() => main()).catch(() => {
    console.error('FAIL 0314 Management API proof: check SIM target, preflight, connectivity and invariants; interrupted requests may need fixture retirement');
    process.exitCode = 1;
  });
}
