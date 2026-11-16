/** FILE ONLY: CC runs after 0328 on SIM. No .env or direct database URL; Management API only.
 * SUPABASE_ACCESS_TOKEN=<operator environment>; node scripts/sim/stations-0328-cutoff-check-management.mjs --ref=jepgzucrvklhqpthowsc
 * Proof for W21/B116 (0328 station_business_date_at + the delegating station_business_date) on the
 * REAL sim schema: a NEW fixture shop with one open closing dated 2026-10-14, opened 20:30 ET, then
 * station_business_date_at at fixed instants (00:59 ET → D, 01:00 ET → D+1, 07:00 ET → D+1) and
 * the live wrapper equal to station_business_date_at(loc, now()). Read-only by outcome: the fixture
 * is written and read inside ONE transaction that ROLLS BACK, so nothing persists on the sim.
 * Never retry a transport error. The guard refuses every project but the designated sim.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { literal as q, managementQuery, projectRef } from '../supabase-management-query.mjs';

export function fixture() {
  const f = Object.fromEntries(['shop', 'template', 'instance'].map(key => [key, randomUUID()]));
  f.tag = `SIM-0328-${f.template}`;
  return f;
}

export const requiredColumns = {
  locations: ['id', 'name', 'code', 'type', 'active'],
  checklist_templates: ['id', 'location_id', 'type', 'name', 'active'],
  checklist_instances: ['id', 'template_id', 'location_id', 'date', 'status', 'shift_start_at'],
};

export async function preflight(query) {
  const fn = await query(`select
    to_regprocedure('public.station_business_date_at(uuid,timestamptz)') is not null as present,
    coalesce(has_function_privilege('service_role', to_regprocedure('public.station_business_date_at(uuid,timestamptz)'), 'EXECUTE'), false) as executable,
    coalesce(has_function_privilege('authenticated', to_regprocedure('public.station_business_date_at(uuid,timestamptz)'), 'EXECUTE'), true) as staff,
    strpos(pg_get_functiondef('public.station_business_date(uuid)'::regprocedure), 'station_business_date_at') > 0 as delegates`);
  assert.ok(fn[0]?.present === true && fn[0]?.executable === true && fn[0]?.staff === false && fn[0]?.delegates === true,
    '0328 missing, not delegating, or its grants escaped');
  const tables = Object.keys(requiredColumns).map(q).join(',');
  const columns = await query(`select table_name,column_name,is_nullable,column_default,is_identity,is_generated
    from information_schema.columns where table_schema='public' and table_name in (${tables})`);
  for (const [table, names] of Object.entries(requiredColumns)) for (const name of names)
    assert.ok(columns.some(c => c.table_name === table && c.column_name === name), `fixture schema must contain ${table}.${name}`);
  for (const c of columns) assert.ok(c.is_nullable !== 'NO' || c.column_default != null || c.is_identity === 'YES'
    || c.is_generated === 'ALWAYS' || requiredColumns[c.table_name]?.includes(c.column_name), 'fixture schema has an omitted required column');
}

/** One transaction: fixture → readings → ROLLBACK. Returns the readings row. */
export function proofSQL(f) {
  const at = instant => `public.station_business_date_at(${q(f.shop)}, ${q(instant)}::timestamptz)::text`;
  return `begin;
    insert into public.locations(id,name,code,type,active) values(${q(f.shop)},${q(f.tag)},${q(f.tag)},'permanent',true);
    insert into public.checklist_templates(id,location_id,type,name,active) values(${q(f.template)},${q(f.shop)},'closing',${q(f.tag)},true);
    insert into public.checklist_instances(id,template_id,location_id,date,status,shift_start_at)
      values(${q(f.instance)},${q(f.template)},${q(f.shop)},'2026-10-14','open','2026-10-15T00:30:00Z');
    select ${at('2026-10-15T03:30:00Z')} as at_2330, ${at('2026-10-15T04:59:00Z')} as at_0059,
      ${at('2026-10-15T05:00:00Z')} as at_0100, ${at('2026-10-15T11:00:00Z')} as at_0700,
      public.station_business_date(${q(f.shop)}) = public.station_business_date_at(${q(f.shop)}, now()) as wrapper_equal;
    rollback;`;
}

export async function runProof(query, log = console.log) {
  await preflight(query);
  const f = fixture();
  log(`FIXTURE (rolled back) ${JSON.stringify(f)}`);
  const rows = await query(proofSQL(f));
  const r = rows[0];
  assert.equal(r?.at_2330, '2026-10-14', '23:30 ET: the open closing holds its day');
  assert.equal(r?.at_0059, '2026-10-14', '00:59 ET: still the closing day');
  assert.equal(r?.at_0100, '2026-10-15', '01:00 ET: the cutoff moves to the new day');
  assert.equal(r?.at_0700, '2026-10-15', '07:00 ET: the morning crew is on the new day (B116)');
  assert.equal(r?.wrapper_equal, true, 'station_business_date(uuid) = station_business_date_at(uuid, now())');
  const left = await query(`select not exists(select 1 from public.locations where id=${q(f.shop)}) as clean`);
  assert.equal(left[0]?.clean, true, 'the fixture rolled back');
  log('PASS 0328: cutoff at 01:00 ET on the sim schema; wrapper delegates; nothing persisted');
}

export function main(args = process.argv.slice(2)) {
  const ref = projectRef(args, true);
  return runProof(managementQuery(ref, process.env.SUPABASE_ACCESS_TOKEN));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(() => main()).catch(() => {
    console.error('FAIL 0328 Management API proof: check SIM target, 0328 applied, connectivity and invariants');
    process.exitCode = 1;
  });
}
