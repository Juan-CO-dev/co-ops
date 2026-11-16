/** FILE ONLY: CC runs after 0322 is applied on SIM. Never run by the builder. No .env or direct database URL.
 *   SUPABASE_ACCESS_TOKEN=<operator environment> node scripts/sim/prep-production-0322-lock-check-management.mjs --ref=jepgzucrvklhqpthowsc
 * W16/B090 + B091 two-session proof for record_prep_production_atomic (0322), over the Management API, using the
 * 0276 observed-wait pattern (transactionSQL + proveRace: a REAL ungranted lock and its blocker are observed):
 *   R1  fold of C2 HOLDS its completion lock; a save superseding C2 (the 0215 save RPC's own supersede statement,
 *       then the new head C4) WAITS for it; C4's fold then wins: live production = 4, completion_id = C4.
 *   R2  a save superseding C2' HOLDS its row lock; C2''s fold WAITS, then re-reads the row and answers
 *       stale_completion: it writes nothing, the newer production stays live.
 *   S1  B091: fold C1 (recorded), re-save C5 (later completed_at, same qty), fold C5: the live header keeps
 *       C1's completed_at as produced_at.
 * WRITES only newly allocated fixture UUIDs (a SIM-0322 shop, user, template, item, instances, completions,
 * productions). production_inputs need an existing SKU and the header an existing item as FK targets: one active
 * vendor_items id and one active items id are READ and referenced; every production row is at the fixture shop
 * only, so no real shop's stock moves. Retirement deactivates the fixture configuration and revokes the fixture
 * shop's live productions; append-only evidence is retained. Never retry an ambiguously committed request.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { literal as q, managementQuery, projectRef } from '../supabase-management-query.mjs';
import { proveRace, transactionSQL } from './checklist-0276-lock-check-management.mjs';

const SIG = 'public.record_prep_production_atomic(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,jsonb,jsonb)';

export function fixture() {
  const f = Object.fromEntries(['actor','shop','template','item','r1','r2','s1'].map((k) => [k, randomUUID()]));
  f.tag = `SIM-0322-${f.template}`;
  for (const k of ['r1','r2','s1']) f[`${k}c`] = { first: randomUUID(), second: randomUUID() };
  return f;
}
export async function preflight(query) {
  const rows = await query(`begin read only; set local statement_timeout = '10s';
    select to_regprocedure(${q(SIG)}) is not null as present,
      coalesce(has_function_privilege('service_role', to_regprocedure(${q(SIG)}), 'EXECUTE'), false) as executable,
      coalesce(has_function_privilege('authenticated', to_regprocedure(${q(SIG)}), 'EXECUTE'), true) as escaped,
      exists(select 1 from information_schema.columns where table_schema='public' and table_name='productions' and column_name='completion_id') as col,
      (select id from public.vendor_items where active order by id limit 1) as sku,
      (select id from public.items where active order by id limit 1) as output_item; commit;`);
  const r = rows[0];
  assert.ok(r?.present === true && r.executable === true && r.escaped === false && r.col === true, '0322 must be applied (function, grant, column)');
  assert.ok(r.sku && r.output_item, 'need one active SKU and one active item as FK targets');
  return { sku: r.sku, outputItem: r.output_item };
}
export function fixtureSQL(f) {
  return `begin;
    insert into public.locations(id,name,code,type,active) values(${q(f.shop)},${q(f.tag)},${q(f.tag)},'permanent',true);
    insert into public.users(id,name,role,pin_hash,active) values(${q(f.actor)},${q(f.tag)},'key_holder','SIM-NO-VALID-CREDENTIAL',true);
    insert into public.user_locations(user_id,location_id,active) values(${q(f.actor)},${q(f.shop)},true);
    insert into public.checklist_templates(id,location_id,type,name,active) values(${q(f.template)},${q(f.shop)},'opening',${q(f.tag)},true);
    insert into public.checklist_template_items(id,template_id,label,min_role_level,active) values(${q(f.item)},${q(f.template)},${q(f.tag)},3,true);
    insert into public.checklist_instances(id,template_id,location_id,date,status) values
      ${['r1','r2','s1'].map((k, i) => `(${q(f[k])},${q(f.template)},${q(f.shop)},date '2099-02-01'+${i},'open')`).join(',')};
    insert into public.checklist_completions(id,instance_id,template_item_id,completed_by,completed_at,prep_data) values
      ${['r1','r2','s1'].map((k) => `(${q(f[`${k}c`].first)},${q(f[k])},${q(f.item)},${q(f.actor)},clock_timestamp()-interval '1 hour','{"phase2":{"opener_prepped":2}}'::jsonb)`).join(',')};
    commit;`;
}
/** The 0215 save RPC's supersede (same predicate), then the new live head — the save half of the race. */
export const saveSQL = (f, inst, next) => `update public.checklist_completions set superseded_at = clock_timestamp()
    where instance_id=${q(inst)} and template_item_id=${q(f.item)} and prep_data ? 'phase2' and superseded_at is null and revoked_at is null;
  insert into public.checklist_completions(id,instance_id,template_item_id,completed_by,completed_at,prep_data)
    values(${q(next)},${q(inst)},${q(f.item)},${q(f.actor)},clock_timestamp(),'{"phase2":{"opener_prepped":4}}'::jsonb)`;
export const foldSQL = (f, ids, inst, completion, qty) => `select public.record_prep_production_atomic(${q(completion)},${q(f.shop)},${q(inst)},${q(f.item)},
  ${q(ids.outputItem)},${qty},'opening_p2',${q(f.actor)},
  ${q(JSON.stringify([{ sku_id: ids.sku, input_oz: qty * 8, qty_entered: null, unit_entered: null, derived_oz: qty * 8 }]))}::jsonb,null) as result`;
export const liveSQL = (f, inst) => `select output_qty::float as qty, completion_id, produced_at,
    (select completed_at from public.checklist_completions where id = p.completion_id) as completion_at
  from public.productions p where instance_id=${q(inst)} and template_item_id=${q(f.item)} and superseded_at is null and revoked_at is null`;
export function retireSQL(f) {
  return `begin;
    update public.productions set revoked_at=clock_timestamp() where location_id=${q(f.shop)} and superseded_at is null and revoked_at is null;
    update public.checklist_template_items set active=false where id=${q(f.item)} and template_id=${q(f.template)};
    update public.checklist_templates set active=false where id=${q(f.template)} and name=${q(f.tag)};
    update public.user_locations set active=false where user_id=${q(f.actor)} and location_id=${q(f.shop)};
    update public.users set active=false where id=${q(f.actor)} and name=${q(f.tag)};
    update public.locations set active=false where id=${q(f.shop)} and code=${q(f.tag)}; commit;`;
}

export async function runProof(query, log = console.log, raceOptions = {}) {
  const ids = await preflight(query);
  const f = fixture();
  log(`FIXTURE allocated ${JSON.stringify(f)}`);
  try {
    await query(fixtureSQL(f));
    // R1: the fold holds C2's lock; the save waits; then C4's fold wins.
    const r1 = await proveRace(query, foldSQL(f, ids, f.r1, f.r1c.first, 2), saveSQL(f, f.r1, f.r1c.second), `${f.tag}-r1`, raceOptions);
    assert.equal(r1.ok, true, 'R1 the waiting save commits');
    await query(transactionSQL(`${f.tag}-r1-fold4`, foldSQL(f, ids, f.r1, f.r1c.second, 4)));
    const l1 = await query(liveSQL(f, f.r1));
    assert.equal(l1.length, 1); assert.equal(l1[0].qty, 4); assert.equal(l1[0].completion_id, f.r1c.second);
    log('PASS R1 fold holds the completion lock, the save waits, the newer fold wins (live = 4, completion_id = C4)');
    // R2: the save holds C2's row; the stale fold waits, then refuses.
    await query(transactionSQL(`${f.tag}-r2-fold2`, foldSQL(f, ids, f.r2, f.r2c.first, 2)));
    const r2 = await proveRace(query, saveSQL(f, f.r2, f.r2c.second), foldSQL(f, ids, f.r2, f.r2c.first, 2), `${f.tag}-r2`, raceOptions);
    assert.equal(r2.ok, true);
    assert.equal(r2.rows[0]?.result?.status, 'stale_completion', 'R2 the waiting stale fold refuses');
    await query(transactionSQL(`${f.tag}-r2-fold4`, foldSQL(f, ids, f.r2, f.r2c.second, 4)));
    const l2 = await query(liveSQL(f, f.r2));
    assert.equal(l2.length, 1); assert.equal(l2[0].qty, 4); assert.equal(l2[0].completion_id, f.r2c.second);
    log('PASS R2 the save holds the row, the stale fold waits and answers stale_completion; the newer production stays live');
    // S1: B091 — the re-save keeps the first save's time.
    await query(transactionSQL(`${f.tag}-s1-a`, foldSQL(f, ids, f.s1, f.s1c.first, 2)));
    const first = (await query(liveSQL(f, f.s1)))[0];
    await query(transactionSQL(`${f.tag}-s1-save`, saveSQL(f, f.s1, f.s1c.second)));
    await query(transactionSQL(`${f.tag}-s1-b`, foldSQL(f, ids, f.s1, f.s1c.second, 2)));
    const again = (await query(liveSQL(f, f.s1)))[0];
    assert.equal(again.completion_id, f.s1c.second);
    assert.equal(new Date(again.produced_at).getTime(), new Date(first.completion_at).getTime(), 'S1 produced_at stays the first save\'s completed_at');
    log('PASS S1 a re-save keeps the first save\'s produced_at');
    log('PASS 0322: 2 observed-wait races + 1 sequential re-save proof');
  } finally {
    await query(retireSQL(f));
    log('PASS own fixture configuration retired (fixture productions revoked); append-only evidence retained');
  }
}
export function main(args = process.argv.slice(2)) {
  const ref = projectRef(args, true);
  return runProof(managementQuery(ref, process.env.SUPABASE_ACCESS_TOKEN));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(() => main()).catch(() => {
    console.error('FAIL 0322 Management API proof: check SIM target, 0322 applied, connectivity and invariants; interrupted requests may need fixture retirement');
    process.exitCode = 1;
  });
}
