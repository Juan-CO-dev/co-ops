/** FILE ONLY: CC runs after 0334 on SIM. No .env or direct database URL; Management API only.
 * SUPABASE_ACCESS_TOKEN=<operator environment>; node scripts/sim/people-0334-pm-v2-lock-check-management.mjs --ref=jepgzucrvklhqpthowsc
 * Two-session proof for W25/B219 (0334 save_people_shop_settings): a MoO turns PM v2 ON and holds the
 * transaction open; a GM's save carrying the OFF they last saw (with a new prep position) must WAIT on the
 * per-shop advisory lock (observed ungranted lock + blocker), then be refused pm_v2_moo_only — the MoO's ON
 * stands and the GM's prep position was not written. The 0276 observed-wait pattern (proveRace) is reused.
 * These races COMMIT. Never retry a transport error.
 * Everything runs at a NEW fixture shop nobody else uses. Only allocated SIM-0334 configuration is retired
 * (shop, users, memberships, station, positions); the people_shop_settings row stays (append-only by grant: no
 * DELETE exists) and is printed by shop id. Interrupted requests may have committed: the printed ids support
 * manual retirement.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { literal as q, managementQuery, projectRef } from '../supabase-management-query.mjs';
import { preflightManagement } from '../preflight-0276-management.mjs';
import { proveRace, transactionSQL } from './checklist-0276-lock-check-management.mjs';

export function fixture() {
  const f = Object.fromEntries(['gm', 'moo', 'shop', 'station', 'posA', 'posB'].map(key => [key, randomUUID()]));
  f.tag = `SIM-0334-${f.shop}`;
  return f;
}
export function fixtureSQL(f) {
  return `begin;
    insert into public.locations(id,name,code,type,active) values(${q(f.shop)},${q(f.tag)},${q(f.tag)},'permanent',true);
    insert into public.users(id,name,role,pin_hash,active) values(${q(f.gm)},${q(f.tag)},'gm','SIM-NO-VALID-CREDENTIAL',true),
      (${q(f.moo)},${q(f.tag)},'moo','SIM-NO-VALID-CREDENTIAL',true);
    insert into public.user_locations(user_id,location_id,active) values(${q(f.gm)},${q(f.shop)},true),(${q(f.moo)},${q(f.shop)},true);
    insert into public.stations(id,location_id,name,name_es,active) values(${q(f.station)},${q(f.shop)},${q(f.tag)},${q(f.tag)},true);
    insert into public.station_positions(id,station_id,location_id,name,active)
      values(${q(f.posA)},${q(f.station)},${q(f.shop)},'SIM A',true),(${q(f.posB)},${q(f.station)},${q(f.shop)},'SIM B',true); commit;`;
}
export function retireSQL(f) {
  return `begin;
    update public.station_positions set active=false where id in (${q(f.posA)},${q(f.posB)}) and location_id=${q(f.shop)};
    update public.stations set active=false where id=${q(f.station)} and name=${q(f.tag)};
    update public.user_locations set active=false where user_id in (${q(f.gm)},${q(f.moo)}) and location_id=${q(f.shop)};
    update public.users set active=false where id in (${q(f.gm)},${q(f.moo)}) and name=${q(f.tag)};
    update public.locations set active=false where id=${q(f.shop)} and code=${q(f.tag)}; commit;`;
}
const saveSQL = (f, actor, pmV2, pos) => `select public.save_people_shop_settings(${q(actor)},${q(f.shop)},${pmV2},${q(pos)}) as result`;
// The racer's refusal is caught IN SQL (the Management helper exposes no arbitrary refusal text): it waits on the
// lock inside the function, then the DO block accepts exactly pm_v2_moo_only and re-raises anything else.
const staleGmSQL = f => `do $$ begin
    perform public.save_people_shop_settings(${q(f.gm)},${q(f.shop)},false,${q(f.posB)});
    raise exception 'expected pm_v2_moo_only' using errcode='XX000';
  exception when sqlstate 'P0001' then if sqlerrm <> 'pm_v2_moo_only' then raise; end if; end $$; select true as refused`;
const evidenceSQL = f => `select pm_v2, prep_position_id from public.people_shop_settings where location_id=${q(f.shop)}`;

export const requiredColumns = {
  locations: ['id','name','code','type','active'], users: ['id','name','role','pin_hash','active'],
  user_locations: ['user_id','location_id','active'], stations: ['id','location_id','name','name_es','active'],
  station_positions: ['id','station_id','location_id','name','active'],
};
export async function fixturePreflight(query) {
  const tables = Object.keys(requiredColumns).map(q).join(',');
  const columns = await query(`select table_name,column_name,is_nullable,column_default,is_identity,is_generated
    from information_schema.columns where table_schema='public' and table_name in (${tables})`);
  for (const [table, names] of Object.entries(requiredColumns)) for (const name of names)
    assert.ok(columns.some(c => c.table_name === table && c.column_name === name), `fixture schema must contain ${table}.${name}`);
  for (const c of columns) assert.ok(c.is_nullable !== 'NO' || c.column_default != null || c.is_identity === 'YES'
    || c.is_generated === 'ALWAYS' || requiredColumns[c.table_name]?.includes(c.column_name), 'fixture schema has an omitted required column');
  const fn = await query(`select md5(regexp_replace(p.prosrc, '[^\\x21-\\x7E]+', '', 'g')) = '5f4188850bab073cec1ce8d07374aeb7' as body,
    has_function_privilege('service_role',p.oid,'EXECUTE') as executable, has_function_privilege('authenticated',p.oid,'EXECUTE') as staff
    from pg_proc p where p.oid = to_regprocedure('public.save_people_shop_settings(uuid,uuid,boolean,uuid)')`);
  assert.ok(fn[0]?.body === true && fn[0]?.executable === true && fn[0]?.staff === false, '0334 body missing or its grants escaped');
}

export async function runProof(query, log = console.log, raceOptions = {}) {
  await preflightManagement(query);
  await fixturePreflight(query);
  const f = fixture();
  log(`FIXTURE allocated ${JSON.stringify(f)}`);
  try {
    await query(fixtureSQL(f));
    const first = await query(transactionSQL(`${f.tag}-first`, saveSQL(f, f.moo, false, f.posA)));
    assert.equal(first[0]?.result?.after?.pm_v2, false, 'the starting row commits OFF');
    // Holder: the MoO turns it ON, held open. Racer: the GM's stale save (OFF + a new prep position).
    const raced = await proveRace(query, saveSQL(f, f.moo, true, f.posA), staleGmSQL(f), f.tag, raceOptions);
    assert.equal(raced.ok, true, 'the waiting GM save ended in the expected refusal');
    assert.equal(raced.rows.at(-1)?.refused, true, 'the waiting GM save was refused pm_v2_moo_only');
    const after = await query(evidenceSQL(f));
    assert.equal(after[0]?.pm_v2, true, "the MoO's ON stands");
    assert.equal(after[0]?.prep_position_id, f.posA, "nothing of the GM's save was written");
    log(`EVIDENCE people_shop_settings row of shop ${f.shop}: ${JSON.stringify(after[0])}`);
    log('PASS 0334: the GM save waited on the per-shop advisory lock and was refused pm_v2_moo_only; the MoO ON stands');
  } finally {
    await query(retireSQL(f));
    const retired = await query(`select
      not exists(select 1 from public.users where id in (${q(f.gm)},${q(f.moo)}) and active)
      and not exists(select 1 from public.locations where id=${q(f.shop)} and active)
      and not exists(select 1 from public.station_positions where id in (${q(f.posA)},${q(f.posB)}) and active) as retired`);
    assert.equal(retired[0]?.retired, true, 'all own fixture configuration retired');
    log('PASS own fixture configuration retired; the shop settings row retained (append-only by grant)');
  }
}
export function main(args = process.argv.slice(2)) {
  const ref = projectRef(args, true);
  return runProof(managementQuery(ref, process.env.SUPABASE_ACCESS_TOKEN));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(() => main()).catch(() => {
    console.error('FAIL 0334 Management API proof: check SIM target, preflight, connectivity and invariants; interrupted requests may need fixture retirement');
    process.exitCode = 1;
  });
}
