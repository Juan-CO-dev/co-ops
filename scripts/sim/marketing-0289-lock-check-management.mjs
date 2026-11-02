/** FILE ONLY: CC runs after 0289 on SIM. Never loads .env or a direct DB URL.
 * SUPABASE_ACCESS_TOKEN=<operator environment>; node scripts/sim/marketing-0289-lock-check-management.mjs --ref=jepgzucrvklhqpthowsc
 * Commits its own owner fixture and two real code allocations. Observes an
 * ungranted lock with the first backend as blocker, then checks persisted slots.
 * Retains both allocations (slots are lifetime allocations), retiring codes and
 * its own user afterward. No retries: interrupted requests may have committed;
 * printed fixture identifiers let CC retire stranded fixtures manually.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { literal as q, managementQuery, projectRef } from '../supabase-management-query.mjs';
import { proveRace } from './checklist-0276-lock-check-management.mjs';

export const signatures = ['public.landing_ad_code_create(uuid,text)', 'public.landing_ad_code_retire(uuid,text)'];
export const userColumns = ['id', 'name', 'role', 'pin_hash', 'active'];
export function fixture() {
  const actor = randomUUID();
  return { actor, tag: `SIM-0289-${actor}`, codes: [`sim-0289-${actor}-a`, `sim-0289-${actor}-b`] };
}
export function fixtureSQL(f) {
  return `begin;
    insert into public.users(id,name,role,pin_hash,active)
    values(${q(f.actor)},${q(f.tag)},'owner','SIM-NO-VALID-CREDENTIAL',true);
    commit;`;
}
export function retireSQL(f) {
  // Cleanup targets only IDs allocated above, including after ambiguous failure.
  return `begin;
    update public.landing_ad_codes set active=false where code in (${f.codes.map(q).join(',')});
    update public.users set active=false where id=${q(f.actor)} and name=${q(f.tag)};
    commit;`;
}
export async function preflight(query) {
  const grants = await query(`begin read only; set local statement_timeout='10s';
    select signature, to_regprocedure(signature) is not null as present,
      coalesce(has_function_privilege('service_role',to_regprocedure(signature),'EXECUTE'),false) as executable
    from unnest(array[${signatures.map(q).join(',')}]::text[]) as required(signature); commit;`);
  assert.ok(signatures.every(signature => grants.some(r => r.signature===signature && r.present===true && r.executable===true)),
    '0289 functions and service_role EXECUTE must be present');
  const columns = await query(`select column_name,is_nullable,column_default,is_identity,is_generated
    from information_schema.columns where table_schema='public' and table_name='users'`);
  for (const name of userColumns) assert.ok(columns.some(c => c.column_name===name), 'fixture column missing');
  for (const c of columns) assert.ok(c.is_nullable!=='NO' || c.column_default!=null || c.is_identity==='YES'
    || c.is_generated==='ALWAYS' || userColumns.includes(c.column_name), 'fixture schema has omitted required column');
  const enums = await query(`select a.attname as column_name,e.enumlabel from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    join pg_type t on t.oid=a.atttypid join pg_enum e on e.enumtypid=t.oid
    where n.nspname='public' and c.relname='users'`);
  for (const e of enums) {
    if (!userColumns.includes(e.column_name)) continue;
    assert.ok(e.column_name==='role' && enums.some(r => r.column_name==='role' && r.enumlabel==='owner'), 'fixture enum label mismatch');
  }
  const capacity = await query('select coalesce(max(slot),0)::int as max_slot from public.landing_ad_codes');
  assert.ok(Number.isInteger(capacity[0]?.max_slot) && capacity[0].max_slot<=1022, 'SIM requires two unused lifetime slots');
}
export async function runProof(query, log=console.log, raceOptions={}) {
  await preflight(query);
  const f = fixture();
  log(`FIXTURE allocated ${JSON.stringify(f)}`);
  const create = code => `select public.landing_ad_code_create(${q(f.actor)},${q(code)}) as slot`;
  try {
    await query(fixtureSQL(f));
    const result = await proveRace(query,create(f.codes[0]),create(f.codes[1]),f.tag,raceOptions);
    assert.equal(result.ok,true,'both real allocations must commit');
    const rows = await query(`select code,slot,active from public.landing_ad_codes where code in (${f.codes.map(q).join(',')}) order by code`);
    assert.equal(rows.length,2,'both committed allocations must persist');
    assert.deepEqual(rows.map(r => r.code).sort(), [...f.codes].sort());
    assert.ok(rows.every(r => r.active===true && Number.isInteger(r.slot) && r.slot>=1 && r.slot<=1024));
    assert.notEqual(rows[0].slot,rows[1].slot,'concurrent allocations must get distinct slots');
    log('PASS observed blocking and two committed distinct slot allocations');
  } finally {
    // proveRace settles both requests before returning or throwing.
    await query(retireSQL(f));
    const rows = await query(`select
      not exists(select 1 from public.landing_ad_codes where code in (${f.codes.map(q).join(',')}) and active)
      and not exists(select 1 from public.users where id=${q(f.actor)} and active) as retired`);
    assert.equal(rows[0]?.retired,true,'owned fixture configuration must be retired');
    log('PASS own codes and user retired; lifetime slot evidence retained');
  }
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(() => {
    const ref=projectRef(process.argv.slice(2),true);
    return runProof(managementQuery(ref,process.env.SUPABASE_ACCESS_TOKEN));
  }).catch(() => {
    console.error('FAIL 0289 Management API proof: check SIM target, preflight, connectivity and invariants; interrupted requests may need fixture retirement');
    process.exitCode=1;
  });
}
