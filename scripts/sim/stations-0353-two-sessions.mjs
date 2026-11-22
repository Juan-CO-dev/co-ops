/** FILE ONLY: CC runs after 0353 on SIM, at apply time, on Juan's word. No .env or direct database URL; Management API only.
 * SUPABASE_ACCESS_TOKEN=<operator environment>; node scripts/sim/stations-0353-two-sessions.mjs --ref=jepgzucrvklhqpthowsc
 * Two-session proof for nav PR 6 (0353 set_station_mid_day_trigger): at a NEW fixture shop with two active stations
 * A and B, a holder marks A and holds its transaction open (pg_sleep); a racer marks B and must WAIT on the shop's
 * locations row lock (observed ungranted lock + blocker, the 0276 proveRace pattern), then commit. The result: exactly
 * ONE marked station at the shop (B), never two and never a bare 23505. These races COMMIT. Only the allocated
 * SIM-0353 configuration is retired afterwards (stations, membership, user, shop). Never retry a transport error.
 * Interrupted requests may have committed: the printed ids support manual retirement.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { literal as q, managementQuery, projectRef } from '../supabase-management-query.mjs';
import { proveRace } from './checklist-0276-lock-check-management.mjs';

export function fixture() {
  const f = Object.fromEntries(['actor', 'shop', 'a', 'b'].map(key => [key, randomUUID()]));
  f.tag = `SIM-0353-${f.shop}`;
  return f;
}
export function fixtureSQL(f) {
  return `begin;
    insert into public.locations(id,name,code,type,active) values(${q(f.shop)},${q(f.tag)},${q(f.tag)},'permanent',true);
    insert into public.users(id,name,role,pin_hash,active) values(${q(f.actor)},${q(f.tag)},'gm','SIM-NO-VALID-CREDENTIAL',true);
    insert into public.user_locations(user_id,location_id,active) values(${q(f.actor)},${q(f.shop)},true);
    insert into public.stations(id,location_id,name,name_es,sort,active) values
      (${q(f.a)},${q(f.shop)},${q(`${f.tag}-A`)},${q(`${f.tag}-A`)},1,true), (${q(f.b)},${q(f.shop)},${q(`${f.tag}-B`)},${q(`${f.tag}-B`)},2,true);
    commit;`;
}
export function retireSQL(f) {
  return `begin;
    update public.stations set starts_mid_day=false, active=false where location_id=${q(f.shop)} and id in (${q(f.a)},${q(f.b)});
    update public.user_locations set active=false where user_id=${q(f.actor)} and location_id=${q(f.shop)};
    update public.users set active=false where id=${q(f.actor)} and name=${q(f.tag)};
    update public.locations set active=false where id=${q(f.shop)} and code=${q(f.tag)}; commit;`;
}
export const markSQL = (f, station) => `select public.set_station_mid_day_trigger(${q(f.actor)},${q(f.shop)},${q(station)},true) as result`;
export const evidenceSQL = f => `select count(*)::int as n, array_agg(id) as ids from public.stations where location_id=${q(f.shop)} and starts_mid_day`;

export const requiredColumns = {
  locations: ['id', 'name', 'code', 'type', 'active'], users: ['id', 'name', 'role', 'pin_hash', 'active'],
  user_locations: ['user_id', 'location_id', 'active'], stations: ['id', 'location_id', 'name', 'name_es', 'sort', 'active', 'starts_mid_day', 'not_phase_station'],
};
export async function preflight(query) {
  const tables = Object.keys(requiredColumns).map(q).join(',');
  const columns = await query(`select table_name,column_name,is_nullable,column_default,is_identity,is_generated
    from information_schema.columns where table_schema='public' and table_name in (${tables})`);
  for (const [table, names] of Object.entries(requiredColumns)) for (const name of names)
    assert.ok(columns.some(c => c.table_name === table && c.column_name === name), `fixture schema must contain ${table}.${name}`);
  for (const c of columns) assert.ok(c.is_nullable !== 'NO' || c.column_default != null || c.is_identity === 'YES'
    || c.is_generated === 'ALWAYS' || requiredColumns[c.table_name]?.includes(c.column_name), 'fixture schema has an omitted required column');
  const fn = await query(`select to_regprocedure('public.set_station_mid_day_trigger(uuid,uuid,uuid,boolean)') is not null as present,
    coalesce(has_function_privilege('service_role',to_regprocedure('public.set_station_mid_day_trigger(uuid,uuid,uuid,boolean)'),'EXECUTE'),false) as executable,
    coalesce(has_function_privilege('authenticated',to_regprocedure('public.set_station_mid_day_trigger(uuid,uuid,uuid,boolean)'),'EXECUTE'),true) as staff`);
  assert.ok(fn[0]?.present === true && fn[0]?.executable === true && fn[0]?.staff === false, '0353 writer missing or its grants escaped');
}

export async function runProof(query, log = console.log, raceOptions = {}) {
  await preflight(query);
  const f = fixture();
  log(`FIXTURE allocated ${JSON.stringify(f)}`);
  try {
    await query(fixtureSQL(f));
    // Holder marks A and holds the shop's lock; the racer marks B and must wait on it.
    const raced = await proveRace(query, markSQL(f, f.a), markSQL(f, f.b), f.tag, raceOptions);
    assert.equal(raced.ok, true, 'the waiting mark commits (never a bare 23505)');
    assert.equal(raced.rows[0]?.result?.changed, true, 'the waiting mark changed the shop');
    assert.equal(raced.rows[0]?.result?.previous_station_id, f.a, 'the waiting mark saw A, committed by the holder, and cleared it');
    const after = await query(evidenceSQL(f));
    assert.equal(after[0]?.n, 1, 'exactly one marked station at the shop');
    assert.deepEqual(after[0]?.ids, [f.b], 'the marked station is B (the later choice)');
    log('PASS 0353: the second mark waited on the shop lock, cleared A and marked B; one marked station');
  } finally {
    await query(retireSQL(f));
    log(`RETIRED fixture ${f.tag}`);
  }
}

export function main(args = process.argv.slice(2)) {
  const ref = projectRef(args, true);
  return runProof(managementQuery(ref, process.env.SUPABASE_ACCESS_TOKEN));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(() => main()).catch(() => {
    console.error('FAIL 0353 two-session proof: check SIM target, 0353 applied, connectivity and invariants');
    process.exitCode = 1;
  });
}
