/** FILE ONLY: CC runs after 0335 is applied on SIM. Never run by the builder. No .env or direct database URL.
 *   SUPABASE_ACCESS_TOKEN=<operator environment> node scripts/sim/toast-map-0335-confirm-lock-check.mjs --ref=jepgzucrvklhqpthowsc
 * W27/B230 two-session proof for confirm_toast_mapping (0335), over the Management API, using the 0276 observed-wait
 * pattern (transactionSQL + proveRace: a REAL ungranted lock and its blocker are observed):
 *   R1  the confirm of candidate A HOLDS the graph lock + the GUID's rows; the rival confirm of candidate B on the
 *       same (shop, GUID) WAITS for it, then refuses toast_map:conflict (swallowed by name inside the racer's DO
 *       block; any other error re-raises and fails the proof). After both: A confirmed and active, B inactive and
 *       still a candidate, exactly ONE active row on the GUID — never zero (the pre-0335 outcome).
 * WRITES only newly allocated fixture UUIDs: a SIM-0335 shop and two toast_menu_map rows on a fixture GUID at that
 * shop. The map rows need an entity: one active GLOBAL items id (location_id null) is READ and referenced; nothing
 * of it is changed, and the rows are at the fixture shop only, so no real shop's sales mapping moves. Retirement
 * deactivates the fixture map rows and the fixture shop; append-only evidence is retained. Never retry an
 * ambiguously committed request.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { literal as q, managementQuery, projectRef } from '../supabase-management-query.mjs';
import { proveRace } from './checklist-0276-lock-check-management.mjs';

const SIG = 'public.confirm_toast_mapping(uuid,uuid,uuid)';

export function fixture() {
  const f = Object.fromEntries(['shop', 'actor', 'a', 'b'].map((k) => [k, randomUUID()]));
  f.tag = `SIM-0335-${f.shop}`;
  f.guid = `SIM-0335-${randomUUID()}`;
  return f;
}
export async function preflight(query) {
  const rows = await query(`begin read only; set local statement_timeout = '10s';
    select to_regprocedure(${q(SIG)}) is not null as present,
      coalesce(has_function_privilege('service_role', to_regprocedure(${q(SIG)}), 'EXECUTE'), false) as executable,
      coalesce(has_function_privilege('authenticated', to_regprocedure(${q(SIG)}), 'EXECUTE'), true) as escaped,
      (select id from public.items where active and location_id is null order by id limit 1) as item; commit;`);
  const r = rows[0];
  assert.ok(r?.present === true && r.executable === true && r.escaped === false, '0335 must be applied (function, grant)');
  assert.ok(r.item, 'need one active global item as the map rows\' entity');
  return { item: r.item };
}
export function fixtureSQL(f, ids) {
  return `begin;
    insert into public.locations(id,name,code,type,active) values(${q(f.shop)},${q(f.tag)},${q(f.tag)},'permanent',true);
    insert into public.toast_menu_map(id,location_id,item_id,toast_item_guid,toast_item_name,match_status,active) values
      (${q(f.a)},${q(f.shop)},${q(ids.item)},${q(f.guid)},${q(f.tag)},'candidate',true),
      (${q(f.b)},${q(f.shop)},${q(ids.item)},${q(f.guid)},${q(f.tag)},'candidate',true);
    commit;`;
}
export const confirmSQL = (f, id) => `select public.confirm_toast_mapping(${q(id)},${q(f.shop)},${q(f.actor)}) as result`;
/** The rival confirm; its NAMED refusal is the expected outcome, anything else fails the proof. */
export const rivalSQL = (f, id) => `do $$ begin
    perform public.confirm_toast_mapping(${q(id)},${q(f.shop)},${q(f.actor)});
  exception when others then
    if sqlerrm <> 'toast_map:conflict' then raise; end if;
  end $$`;
export const stateSQL = (f) => `select id, active, match_status from public.toast_menu_map
  where location_id=${q(f.shop)} and toast_item_guid=${q(f.guid)} order by id`;
export function retireSQL(f) {
  return `begin;
    update public.toast_menu_map set active=false where location_id=${q(f.shop)} and toast_item_guid=${q(f.guid)} and active;
    update public.locations set active=false where id=${q(f.shop)} and code=${q(f.tag)}; commit;`;
}

export async function runProof(query, log = console.log, raceOptions = {}) {
  const ids = await preflight(query);
  const f = fixture();
  log(`FIXTURE allocated ${JSON.stringify(f)}`);
  try {
    await query(fixtureSQL(f, ids));
    const r1 = await proveRace(query, confirmSQL(f, f.a), rivalSQL(f, f.b), `${f.tag}-r1`, raceOptions);
    assert.equal(r1.ok, true, 'R1 the waiting rival confirm ends in its named refusal (toast_map:conflict)');
    const rows = await query(stateSQL(f));
    const a = rows.find((r) => r.id === f.a), b = rows.find((r) => r.id === f.b);
    assert.ok(a?.active === true && a.match_status === 'confirmed', 'R1 A confirmed and active');
    assert.ok(b?.active === false && b.match_status === 'candidate', 'R1 B deactivated, still a candidate');
    assert.equal(rows.filter((r) => r.active).length, 1, 'R1 exactly one active row on the GUID');
    log('PASS R1 the rival confirm waits on the holder, refuses conflict, and the GUID keeps exactly one active row');
    log('PASS 0335: 1 observed-wait race');
  } finally {
    await query(retireSQL(f));
    log('PASS own fixture rows and shop retired; append-only evidence retained');
  }
}
export function main(args = process.argv.slice(2)) {
  const ref = projectRef(args, true);
  return runProof(managementQuery(ref, process.env.SUPABASE_ACCESS_TOKEN));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(() => main()).catch(() => {
    console.error('FAIL 0335 Management API proof: check SIM target, 0335 applied, connectivity and invariants; interrupted requests may need fixture retirement');
    process.exitCode = 1;
  });
}
