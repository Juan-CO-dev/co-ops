/** Offline 0347 proof (item 21 PR 3, the LINK step). Ephemeral in-memory PGlite only: no credentials, no network.
 * Builds the 0344 stub schema plus the ezCater tables the real writers touch, loads the REAL 0221 toast_orders_latest
 * view, the REAL 0229 publisher (publish_ezcater_shadow), the REAL 0231 planner and the REAL 0330 reconciler, then the
 * REAL 0344 file, then the REAL 0347 file, and proves:
 *   - planner equivalence: with no house link and no ring code, 0347's planner returns 0231's rows exactly, and a
 *     publication + reconcile write identical ezCater links with and without 0347;
 *   - contract #1: the unchanged publisher, run BEFORE either planner, does not admit an unowned dual-code check (the
 *     row is skipped, a dual_code conflict recorded, maps / reviews / shadow still written, no exception), and the
 *     reconciler after it keeps it out; both arrival orders (ezCater first / house first) end the same way;
 *   - contract #2: an ezCater-owned check that gains a house ring code keeps its ezCater links through reconcile AND
 *     through a recapture (retire + re-insert in one transaction), and the conflict shows on both sides;
 *   - plan r3 #3: a house-owned check leaves the ezCater batch before totals (toast 300 vs ezCater 500 = mismatch), and
 *     the D+1 fallback is computed from eligible checks only;
 *   - plan r3 #2: a recapture never releases ezCater ownership (manual house link refused until reconcile re-homes it);
 *   - the ONE writer decide_catering_toast: roles (catering manager any shop, GM own shop, level 8+ any), refusals by
 *     name, the expected head, the unlink tombstone and relink, no_ring_expected / ring_expected, a stale holder
 *     retired by the system, an audit row per decision, and a linked lead LEAVING the not-rung list;
 *   - the publisher guard never raises; the house guard does; the ceiling.
 * PGlite has ONE backend: lock waits are not provable here (CC's sim two-session proof covers them).
 */
import { PGlite } from '@electric-sql/pglite';
import { SHOP, OTHER, id, read, migration as m0344, schema as baseSchema, ring } from './sql-harness-0344-lib.mjs';

let checks = 0;
function check(ok, message) { checks++; if (!ok) throw new Error(`FAIL: ${message}`); }

const publisher0229 = read('0229_ezcater_toast_reconcile.sql').match(/create or replace function public\.publish_ezcater_shadow[\s\S]*?\nend \$\$;/)?.[0];
const planner0231 = read('0231_ezcater_reconcile_planner_speed.sql').match(/create or replace function public\.plan_ezcater_toast[\s\S]*?\$plan\$;/)?.[0];
const reconcile0330 = read('0330_ezcater_catering_records_fixes.sql').match(/create or replace function public\.reconcile_ezcater_toast[\s\S]*?\nend \$\$;/)?.[0];
export const m0347 = read('0347_catering_toast_link_step.sql');

const CM = id('2000', 11), GM = id('2000', 12), GM_ELSEWHERE = id('2000', 13), MOO = id('2000', 14), EMP = id('2000', 15), AGM = id('2000', 16);
const EZL1 = id('3000', 101), EZL2 = id('3000', 102), EZL3 = id('3000', 103);
const EO1 = id('3100', 1), EO2 = id('3100', 2), EO3 = id('3100', 3);
const HA = id('3000', 201), HB = id('3000', 202), HC = id('3000', 203);

async function setup({ with0347 }) {
  const db = new PGlite();
  await baseSchema(db, check);
  await db.exec(`alter table ezcater_orders add column snapshot_id uuid, add column provider_uuid text, add column event_date date,
      add column status text, add column subtotal_cents bigint;
    alter table ezcater_toast_links add column amount_diff_cents bigint, add column amount_mismatch boolean not null default false,
      add column reconciliation_details jsonb not null default '{}'::jsonb, add column created_at timestamptz not null default now();
    create unique index ezcater_toast_links_selection on ezcater_toast_links(order_id,location_id,check_guid,selection_guid) where is_current;
    create table user_locations(user_id uuid not null, location_id uuid not null, active boolean not null default true);
    create table audit_log(id bigserial primary key, actor_id uuid, actor_role text, action text, resource_table text,
      resource_id uuid, metadata jsonb, destructive boolean, created_at timestamptz default now());
    create table ezcater_item_map(location_id uuid, identity_key text, provider_item_uuid text, menu_item_size_id text, pos_item_id text,
      toast_item_guid text, item_id uuid, menu_item_id uuid, package_id uuid, toast_map_id uuid, status text, evidence text,
      candidates jsonb, updated_at timestamptz, primary key(location_id, identity_key));
    create table ezcater_review_queue(id uuid primary key default gen_random_uuid(), order_id uuid, snapshot_id uuid, location_id uuid,
      source text, code text, identity_key text, candidates jsonb, last_seen_at timestamptz, resolved_at timestamptz, created_at timestamptz default now(),
      unique(order_id, location_id, source, code, identity_key));
    create table ezcater_review_resolutions(id uuid primary key default gen_random_uuid(), review_id uuid not null unique,
      rule text not null, created_at timestamptz not null default clock_timestamp());
    create table ezcater_reconciliation_status(order_id uuid, location_id uuid, event_date date, rule text);
    create table ezcater_shadow_depletion(order_id uuid, snapshot_id uuid, location_id uuid, event_date date, ordinal int, sku_id uuid,
      sales_oz numeric, suppressed_oz numeric, shadow_oz numeric, current_day_sales_oz numeric, is_current boolean not null default true);
    grant all on all tables in schema public to service_role;`);
  check(Boolean(publisher0229 && planner0231 && reconcile0330), 'real 0229 publisher / 0231 planner / 0330 reconciler extracted');
  await db.exec(publisher0229);
  await db.exec(planner0231);
  await db.exec(reconcile0330);
  await db.exec(m0344);
  if (with0347) await db.exec(m0347);
  await db.exec(`insert into users values ('${CM}', 'catering_mgr', true), ('${GM}', 'gm', true), ('${GM_ELSEWHERE}', 'gm', true),
      ('${MOO}', 'moo', true), ('${EMP}', 'employee', true), ('${AGM}', 'agm', true);
    insert into user_locations values ('${GM}', '${SHOP}', true), ('${GM_ELSEWHERE}', '${OTHER}', true), ('${AGM}', '${SHOP}', true);
    insert into catering_pipeline(id, location_id, event_date, stage, lead_source, estimated_revenue_cents) values
      ('${EZL1}', '${SHOP}', '2026-11-20', 'confirmed', 'ezcater', 50000),
      ('${EZL2}', '${SHOP}', '2026-11-22', 'confirmed', 'ezcater', 50000),
      ('${EZL3}', '${SHOP}', '2026-11-24', 'confirmed', 'ezcater', 9000),
      ('${HA}', '${SHOP}', '2026-11-20', 'confirmed', 'portal', 20000),
      ('${HB}', '${SHOP}', '2026-11-22', 'confirmed', 'portal', 20000),
      ('${HC}', '${SHOP}', '2026-11-24', 'confirmed', 'portal', 9000);
    insert into ezcater_orders(id, lead_id, location_id, order_number, snapshot_id, provider_uuid, event_date, status, subtotal_cents) values
      ('${EO1}', '${EZL1}', '${SHOP}', 'ABC-123', '${id('3200', 1)}', 'prov-1', '2026-11-20', 'submitted', 50000),
      ('${EO2}', '${EZL2}', '${SHOP}', null, '${id('3200', 2)}', 'prov-2', '2026-11-22', 'submitted', 50000),
      ('${EO3}', '${EZL3}', '${SHOP}', 'XYZ-789', '${id('3200', 3)}', 'prov-3', '2026-11-24', 'submitted', 9000);`);
  return db;
}

async function ringEz(db, snap, args) {
  await ring(db, snap, args);
  // The real publisher reads (s->>'voided')::boolean without a default: capture always writes both flags.
  await db.query(`update toast_orders set selection_units = (select coalesce(jsonb_agg(u || '{"voided":false,"deleted":false}'::jsonb), '[]'::jsonb)
    from jsonb_array_elements(selection_units) u) where id = $1`, [snap]);
  for (const c of args.checks) await db.query(`update toast_order_checks set amount_cents = total_cents where snapshot_id = $1 and check_guid = $2`, [snap, c.guid]);
}
const one = async (db, q, p = []) => (await db.query(q, p)).rows[0];
const all = async (db, q, p = []) => (await db.query(q, p)).rows;
async function refuses(db, run, code, message) {
  await db.exec('begin'); let error;
  try { await run(); } catch (e) { error = e; }
  await db.exec('rollback');
  check(String(error?.message ?? '').includes(code), `${message}: expected ${code}, got ${error?.message ?? 'success'}`);
}
const asService = async (db, fn) => { await db.exec('begin; set local role service_role'); try { return await fn(); } finally { await db.exec('commit'); } };
const reconcile = db => asService(db, () => one(db, `select reconcile_ezcater_toast('2026-11-01', '2026-11-30') r`));
const publish = (db, order, payload) => asService(db, () => db.query(`select publish_ezcater_shadow($1, $2, $3, $4)`,
  [order, order === EO1 ? id('3200', 1) : order === EO2 ? id('3200', 2) : id('3200', 3), SHOP, JSON.stringify(payload)]));
const ezLinks = async (db, where = '') => (await all(db, `select order_id::text o, order_guid, check_guid, selection_guid, evidence, toast_snapshot_id::text snap,
  amount_diff_cents::text diff, amount_mismatch, reconciliation_details::text det from ezcater_toast_links where is_current ${where}
  order by 1, 2, 3, 4, 5`));
async function decide(db, actor, lead, kind, args = {}) {
  const r = await one(db, `select decide_catering_toast($1, $2, $3, $4, $5, $6, $7, $8) d`,
    [actor, lead, kind, args.loc ?? null, args.order ?? null, args.check ?? null, args.reason ?? null, args.expected ?? null]);
  return r.d;
}
const head = async (db, lead, order = null, check_ = null) => (await one(db, `select id from catering_toast_decision_heads where lead_id = $1
  and order_guid is not distinct from $2 and check_guid is not distinct from $3`, [lead, order, check_]))?.id ?? null;
const planEz = async db => all(db, `select order_id::text o, toast_snapshot_id::text snap, order_guid, check_guid, selection_guid, business_date::text d, evidence,
  amount_diff_cents::text diff, amount_mismatch, reconciliation_details::text det from plan_ezcater_toast() order by 1, 2, 3, 4, 5, 7`);

/** The shared Toast rings for the equivalence run: codes on names, an ezCater dining-option batch with a D+1 fallback. */
async function rings(db) {
  await ringEz(db, id('5000', 1), { order: 'Z1', date: '2026-11-20', checks: [{ guid: 'Z1c', total: 50000, names: ['ABC-123 party'] }] });
  await ringEz(db, id('5000', 2), { order: 'Z2', date: '2026-11-22', option: 'do-ez', checks: [{ guid: 'Z2a', total: 20000 }, { guid: 'Z2b', total: 30000 }] });
  await ringEz(db, id('5000', 3), { order: 'Z3', date: '2026-11-25', checks: [{ guid: 'Z3c', total: 9000, names: ['XYZ-789'] }] });
}

async function main() {
  // A. Equivalence: no house link, no ring code -> 0347's planner = 0231's; reconcile + publish write the same links.
  {
    const a = await setup({ with0347: false }), b = await setup({ with0347: true });
    for (const db of [a, b]) await rings(db);
    const pa = await planEz(a), pb = await planEz(b);
    check(pa.length >= 4 && JSON.stringify(pa) === JSON.stringify(pb), `planner equivalence (${pa.length} rows)`);
    const pub = { links: [{ toast_snapshot_id: id('5000', 3), order_guid: 'Z3', check_guid: 'Z3c', selection_guid: 'Z3c-s0', business_date: '2026-11-25' }],
      maps: [], reviews: [], shadow: [] };
    for (const db of [a, b]) { await publish(db, EO3, pub); await reconcile(db); }
    check(JSON.stringify(await ezLinks(a)) === JSON.stringify(await ezLinks(b)) && (await ezLinks(b)).length >= 3, 'links identical with and without 0347');
    const batch = (await ezLinks(b)).filter(l => l.evidence === 'daily_batch');
    check(batch.length === 2 && batch.every(l => l.amount_mismatch === false), 'baseline batch: 200 + 300 vs 500 matches');
    check(Number((await one(b, `select count(*) n from catering_toast_conflicts`)).n) === 0, 'no conflict recorded without house evidence');
  }

  const db = await setup({ with0347: true });

  // B. Ceiling, triggers, pins.
  const pol = await one(db, `select count(*)::int n from pg_policies where tablename = 'catering_toast_conflicts'`);
  check(pol.n === 4, 'four deny-all policies on the conflict ledger');
  const priv = await one(db, `select has_table_privilege('service_role','public.catering_toast_conflicts','select') s,
    has_table_privilege('service_role','public.catering_toast_conflicts','insert') i, has_function_privilege('authenticated','public.decide_catering_toast(uuid,uuid,text,uuid,text,text,text,uuid)','execute') a,
    has_function_privilege('service_role','public.decide_catering_toast(uuid,uuid,text,uuid,text,text,text,uuid)','execute') x`);
  check(priv.s && !priv.i && !priv.a && priv.x, 'service_role SELECT on the ledger, EXECUTE on the writer; users nothing');
  const writers = await all(db, `select p.proname from pg_proc p where p.prosrc ~* 'insert into public\\.(catering_toast_links|ezcater_toast_links)'`);
  for (const w of writers) {
    const src = (await one(db, `select prosrc from pg_proc where proname = $1`, [w.proname])).prosrc;
    const lock = src.indexOf("pg_advisory_xact_lock(hashtext('ezcater-toast-reconcile'))");
    const ins = src.search(/insert into public\.(catering_toast_links|ezcater_toast_links)/i);
    check(lock >= 0 && lock < ins, `${w.proname}: the reconcile lock comes before any link insert`);
  }
  check(writers.map(w => w.proname).sort().join() === 'decide_catering_toast,publish_ezcater_shadow,reconcile_ezcater_toast', `link writers: ${writers.map(w => w.proname)}`);
  const house = await all(db, `select proname from pg_proc where prosrc ~* 'update\\s+public\\.ezcater_toast_links' order by 1`);
  check(house.map(h => h.proname).join() === 'publish_ezcater_shadow,reconcile_ezcater_toast', 'no house function updates ezcater_toast_links');

  // Everything stays behind the shop's enabled switch: off (no row) refuses every decision by name.
  await refuses(db, () => decide(db, CM, HA, 'no_ring_expected', { reason: 'comped' }), 'catering_toast_off', 'a shop that is off refuses decisions');
  await db.exec(`insert into catering_toast_settings(location_id, enabled) values ('${SHOP}', true)`);

  // Rings for the scenarios. HA's code CO-ACD34, HB's CO-ACD36, HC's CO-ACD37.
  await db.exec(`update catering_pipeline set ring_code = 'CO-ACD34' where id = '${HA}'; update catering_pipeline set ring_code = 'CO-ACD36' where id = '${HB}';
    update catering_pipeline set ring_code = 'CO-ACD37' where id = '${HC}'`);
  // D1: an unowned dual-code check (ABC-123 = EO1's number, CO-ACD34 = HA's code).
  await ringEz(db, id('5000', 11), { order: 'D1', date: '2026-11-20', checks: [{ guid: 'D1c', total: 50000, names: ['ABC-123', 'CO-ACD34'] }] });
  // Batch day 2026-11-22 for EO2 (no number): two ezCater-option checks, 200 + 300 vs ezCater 500.
  await ringEz(db, id('5000', 12), { order: 'B1', date: '2026-11-22', option: 'do-ez', checks: [{ guid: 'B1a', total: 20000 }, { guid: 'B1b', total: 30000 }] });
  // EO3 (XYZ-789) on 11-24, and its check later gains HC's code.
  await ringEz(db, id('5000', 13), { order: 'X1', date: '2026-11-24', checks: [{ guid: 'X1c', total: 9000, names: ['XYZ-789'] }] });

  // C. Contract #1: the publisher, BEFORE either planner, on the unowned dual-code check.
  const payload = { links: [{ toast_snapshot_id: id('5000', 11), order_guid: 'D1', check_guid: 'D1c', selection_guid: 'D1c-s0', business_date: '2026-11-20' }],
    maps: [{ identity_key: 'k1', provider_item_uuid: 'p', menu_item_size_id: 's', status: 'review', evidence: 'none', candidates: [] }],
    reviews: [{ source: 'ezcater', code: 'unmapped_item', identity_key: 'k1', candidates: [] }],
    shadow: [{ ordinal: 1, sku_id: id('7000', 1), sales_oz: 1, suppressed_oz: 0, shadow_oz: 1, current_day_sales_oz: 1 }] };
  await publish(db, EO1, payload);
  check((await ezLinks(db, `and check_guid = 'D1c'`)).length === 0, '#1: the publisher did not admit the unowned dual-code check');
  const c1 = await one(db, `select kind, house_lead_id::text h, seen_count from catering_toast_conflicts where check_guid = 'D1c'`);
  check(c1?.kind === 'dual_code' && c1.h === HA, '#1: a dual_code conflict recorded, naming the house lead');
  check(Number((await one(db, `select count(*) n from ezcater_item_map`)).n) === 1 && Number((await one(db, `select count(*) n from ezcater_review_queue`)).n) === 1
    && Number((await one(db, `select count(*) n from ezcater_shadow_depletion where is_current`)).n) === 1, '#1: maps, reviews and shadow still committed');
  await reconcile(db);
  check((await ezLinks(db, `and check_guid = 'D1c'`)).length === 0, '#1: the reconciler after it keeps the dual-code check out');
  await publish(db, EO1, payload);
  check((await one(db, `select seen_count from catering_toast_conflicts where check_guid = 'D1c'`)).seen_count === 2, '#1: a retry is counted, never raised');
  const hp = (await all(db, `select * from plan_catering_toast($1, '2026-11-15', '2026-11-30', '[]')`, [SHOP])).find(r => r.lead_id === HA && r.check_guid === 'D1c');
  check(hp?.dual_code === true && hp.owner === null, '#1: the house list sees the same check as dual code, unowned');

  // House-first arrival order on the same kind of check: a person links it (human decision), then ezCater publishes.
  await ringEz(db, id('5000', 14), { order: 'D2', date: '2026-11-20', checks: [{ guid: 'D2c', total: 20000, names: ['ABC-123', 'CO-ACD34'] }] });
  await decide(db, CM, HA, 'link', { loc: SHOP, order: 'D2', check: 'D2c' });
  await publish(db, EO1, { ...payload, links: [{ ...payload.links[0], toast_snapshot_id: id('5000', 14), order_guid: 'D2', check_guid: 'D2c', selection_guid: 'D2c-s0' }] });
  await reconcile(db);
  check((await ezLinks(db, `and check_guid in ('D1c','D2c')`)).length === 0, 'house first: ezCater never takes the house-held check');
  check((await one(db, `select kind from catering_toast_conflicts where check_guid = 'D2c'`))?.kind === 'ownership_conflict', 'house first: an ownership_conflict recorded');

  // D. Contract #2: an ezCater-owned check gains a house ring code.
  await reconcile(db);
  const before = await ezLinks(db, `and check_guid = 'X1c'`);
  check(before.length === 1 && before[0].o === EO3, '#2: EO3 owns X1c');
  await ringEz(db, id('5000', 15), { order: 'X1', date: '2026-11-24', checks: [{ guid: 'X1c', total: 9000, names: ['XYZ-789', 'CO-ACD37'] }] });
  await reconcile(db);
  const after = await ezLinks(db, `and check_guid = 'X1c'`);
  check(after.length === 1 && after[0].o === EO3 && after[0].snap === id('5000', 15), '#2: recapture with a rival code: still EO3, re-homed on the new snapshot');
  await reconcile(db);
  check(JSON.stringify(await ezLinks(db, `and check_guid = 'X1c'`)) === JSON.stringify(after), '#2: a second reconcile changes nothing');
  const ezSide = await all(db, `select kind, house_lead_id::text h from ezcater_order_house_conflicts($1)`, [EO3]);
  check(ezSide.some(c => c.kind === 'ownership_conflict' && c.h === HC), '#2: the conflict shows on the ezCater side');
  const houseSide = (await all(db, `select * from plan_catering_toast($1, '2026-11-15', '2026-11-30', '[]')`, [SHOP])).find(r => r.lead_id === HC && r.check_guid === 'X1c');
  check(houseSide?.owner === 'ezcater', '#2: and on the house side (owner ezCater)');
  await refuses(db, () => decide(db, CM, HC, 'link', { loc: SHOP, order: 'X1', check: 'X1c' }), 'check_owned_by_ezcater', '#2: no house link over the ezCater owner');
  // E. Plan r2 #2: a recapture never releases ezCater ownership.
  await ringEz(db, id('5000', 16), { order: 'X1', date: '2026-11-24', checks: [{ guid: 'X1c', total: 9000, names: ['XYZ-789', 'CO-ACD37'] }] });
  const view = await one(db, `select count(*)::int n from ezcater_toast_links z join toast_orders_latest t on t.id = z.toast_snapshot_id where z.is_current and z.check_guid = 'X1c'`);
  check(view.n === 0, 'recapture: the snapshot-fresh join is empty');
  await refuses(db, () => decide(db, CM, HC, 'link', { loc: SHOP, order: 'X1', check: 'X1c' }), 'check_owned_by_ezcater', 'recapture: a manual house link is refused');
  // The publisher re-homing its OWN link (retire then insert in one transaction) passes the guard: incumbent.
  await publish(db, EO3, { links: [{ toast_snapshot_id: id('5000', 16), order_guid: 'X1', check_guid: 'X1c', selection_guid: 'X1c-s0', business_date: '2026-11-24' }],
    maps: [], reviews: [], shadow: [] });
  const rehomed = await ezLinks(db, `and check_guid = 'X1c'`);
  check(rehomed.some(l => l.o === EO3 && l.snap === id('5000', 16)), '#2: a retire-then-insert of the incumbent in one transaction is not a new admission');
  await reconcile(db);
  check((await ezLinks(db, `and check_guid = 'X1c'`))[0]?.snap === id('5000', 16), 'recapture: reconcile re-homes it, still ezCater');

  // F. Plan r3 #3: a house-held check leaves the batch BEFORE totals.
  await reconcile(db);
  check((await ezLinks(db, `and order_guid = 'B1'`)).length === 2, 'batch baseline: EO2 holds both B1 checks');
  // A batch check can only become house-held while ezCater does not hold it: a fresh day.
  await ringEz(db, id('5000', 17), { order: 'B2', date: '2026-11-26', option: 'do-ez', checks: [{ guid: 'B2a', total: 20000 }, { guid: 'B2b', total: 30000 }] });
  const EZL4 = id('3000', 104), EO4 = id('3100', 4), HD = id('3000', 204);
  await db.exec(`insert into catering_pipeline(id, location_id, event_date, stage, lead_source, estimated_revenue_cents) values
      ('${EZL4}', '${SHOP}', '2026-11-26', 'confirmed', 'ezcater', 50000), ('${HD}', '${SHOP}', '2026-11-26', 'confirmed', 'portal', 20000);
    insert into ezcater_orders(id, lead_id, location_id, snapshot_id, provider_uuid, event_date, status, subtotal_cents)
      values ('${EO4}', '${EZL4}', '${SHOP}', '${id('3200', 4)}', 'prov-4', '2026-11-26', 'submitted', 50000);`);
  await decide(db, GM, HD, 'link', { loc: SHOP, order: 'B2', check: 'B2a' });
  await reconcile(db);
  const b2 = await ezLinks(db, `and order_guid = 'B2'`);
  check(b2.length === 1 && b2[0].check_guid === 'B2b' && b2[0].amount_mismatch === true && b2[0].diff === '-20000', `#3: toast 300 vs ezCater 500 = mismatch, ${JSON.stringify(b2)}`);
  // D+1 fallback from eligible checks only: day 11-28 has only a house-held ezCater-option check; 11-29 has one more.
  const EZL5 = id('3000', 105), EO5 = id('3100', 5), HE = id('3000', 205);
  await db.exec(`insert into catering_pipeline(id, location_id, event_date, stage, lead_source, estimated_revenue_cents) values
      ('${EZL5}', '${SHOP}', '2026-11-28', 'confirmed', 'ezcater', 10000), ('${HE}', '${SHOP}', '2026-11-28', 'confirmed', 'portal', 7000);
    insert into ezcater_orders(id, lead_id, location_id, snapshot_id, provider_uuid, event_date, status, subtotal_cents)
      values ('${EO5}', '${EZL5}', '${SHOP}', '${id('3200', 5)}', 'prov-5', '2026-11-28', 'submitted', 10000);`);
  await ringEz(db, id('5000', 18), { order: 'F1', date: '2026-11-28', option: 'do-ez', checks: [{ guid: 'F1a', total: 7000 }] });
  await ringEz(db, id('5000', 19), { order: 'F2', date: '2026-11-29', option: 'do-ez', checks: [{ guid: 'F2a', total: 10000 }] });
  await decide(db, GM, HE, 'link', { loc: SHOP, order: 'F1', check: 'F1a' });
  await reconcile(db);
  const f = await ezLinks(db, `and order_guid in ('F1','F2')`);
  check(f.length === 1 && f[0].check_guid === 'F2a' && JSON.parse(f[0].det).fallback === true && f[0].amount_mismatch === false,
    `#3: the D+1 check takes the day once the house check is out, ${JSON.stringify(f)}`);

  // #1 for batch evidence: an unowned check on the ezCater dining option that carries a live house ring code is not
  // admitted to the ezCater batch either.
  const EZL6 = id('3000', 106), EO6 = id('3100', 6);
  await db.exec(`insert into catering_pipeline(id, location_id, event_date, stage, lead_source, estimated_revenue_cents) values
      ('${EZL6}', '${SHOP}', '2026-11-30', 'confirmed', 'ezcater', 10000);
    insert into ezcater_orders(id, lead_id, location_id, snapshot_id, provider_uuid, event_date, status, subtotal_cents)
      values ('${EO6}', '${EZL6}', '${SHOP}', '${id('3200', 6)}', 'prov-6', '2026-11-30', 'submitted', 10000);`);
  await ringEz(db, id('5000', 20), { order: 'W1', date: '2026-11-30', option: 'do-ez', checks: [{ guid: 'W1a', total: 10000, names: ['CO-ACD36'] }] });
  await reconcile(db);
  check((await ezLinks(db, `and order_guid = 'W1'`)).length === 0, '#1: a house-coded ezCater-option check is not admitted to the batch');
  check(!(await planEz(db)).some(r => r.order_guid === 'W1'), '#1: ... by the planner itself, before batch totals (not only by the guard)');
  check(!(await planEz(db)).some(r => r.check_guid === 'D1c'), '#1: the planner leaves the dual-code check out of code candidates');

  // G. The writer: who, refusals by name, the expected head, tombstone, relink.
  const H = id('3000', 301), H2 = id('3000', 302);
  await db.exec(`insert into catering_pipeline(id, location_id, event_date, stage, lead_source, estimated_revenue_cents) values
      ('${H}', '${SHOP}', '2026-11-10', 'confirmed', 'portal', 30000), ('${H2}', '${SHOP}', '2026-11-10', 'confirmed', null, 30000)`);
  await ringEz(db, id('5000', 21), { order: 'G1', date: '2026-11-10', checks: [{ guid: 'G1c', total: 30000 }, { guid: 'G1v', total: 1, voided: true }] });
  await ringEz(db, id('5000', 22), { order: 'G2', date: '2026-11-25', checks: [{ guid: 'G2c', total: 30000 }] });
  check((await one(db, `select status from catering_reconciliation_status where lead_id = $1`, [H])).status === 'not_rung_in_toast', 'H on the not-rung list');
  await refuses(db, () => decide(db, EMP, H, 'link', { loc: SHOP, order: 'G1', check: 'G1c' }), 'forbidden', 'an employee may not link');
  await refuses(db, () => decide(db, AGM, H, 'link', { loc: SHOP, order: 'G1', check: 'G1c' }), 'forbidden', 'an AGM may not link (Juan answer 8)');
  await refuses(db, () => decide(db, GM_ELSEWHERE, H, 'link', { loc: SHOP, order: 'G1', check: 'G1c' }), 'forbidden', 'a GM of another shop may not link');
  await refuses(db, () => decide(db, CM, EZL1, 'link', { loc: SHOP, order: 'G1', check: 'G1c' }), 'lead_not_eligible', 'an ezCater lead is not a house lead');
  await refuses(db, () => decide(db, CM, H, 'link', { loc: SHOP, order: 'G1', check: 'G1v' }), 'check_not_found', 'a voided check');
  await refuses(db, () => decide(db, CM, H, 'link', { loc: SHOP, order: 'G2', check: 'G2c' }), 'check_out_of_window', 'out of the D-1..D+7 window');
  await refuses(db, () => decide(db, CM, H, 'link', { loc: OTHER, order: 'G1', check: 'G1c' }), 'lead_moved', 'another shop than the lead');
  await refuses(db, () => decide(db, CM, H, 'link', { loc: SHOP, order: 'G1', check: 'G1c', expected: id('9999', 1) }), 'decision_moved', 'a stale expected head');
  await refuses(db, () => decide(db, CM, H, 'link', { loc: SHOP, order: 'G1', check: 'G1c', reason: 'comped' }), 'invalid_decision', 'a reason on a link');
  const auditBefore = Number((await one(db, `select count(*) n from audit_log`)).n);
  const linked = await decide(db, MOO, H, 'link', { loc: SHOP, order: 'G1', check: 'G1c' });
  check(linked.kind === 'link' && linked.link_id, 'level 8 links at any shop');
  const s = await one(db, `select status, linked_cents::int c from catering_reconciliation_status where lead_id = $1`, [H]);
  check(s.status === 'matched' && s.c === 30000, 'a linked lead is matched: it LEAVES the not-rung list');
  const a1 = await one(db, `select action, destructive, actor_role, resource_id::text r, metadata from audit_log order by id desc limit 1`);
  check(a1.action === 'catering.toast_link' && a1.destructive === true && a1.actor_role === 'moo' && a1.r === H
    && a1.metadata.check_guid === 'G1c' && a1.metadata.decision_id === linked.decision_id, 'the link is audited, destructive, with ids only');
  await refuses(db, () => decide(db, CM, H, 'link', { loc: SHOP, order: 'G1', check: 'G1c', expected: linked.decision_id }), 'already_linked', 'linking twice');
  await refuses(db, () => decide(db, CM, H2, 'link', { loc: SHOP, order: 'G1', check: 'G1c' }), 'check_owned_by_house', 'one house lead per check');
  await refuses(db, () => db.query(`insert into catering_toast_links(lead_id, location_id, order_guid, check_guid, toast_snapshot_id, evidence) values ($1, $2, 'X1', 'X1c', $3, 'ring_code')`,
    [HC, SHOP, id('5000', 16)]), 'check_owned_by_ezcater', 'the house guard raises on any insert over an ezCater owner');
  await refuses(db, () => decide(db, CM, H, 'not_a_match', { loc: SHOP, order: 'G1', check: 'G1c', expected: linked.decision_id }), 'linked_use_unlink', 'not a match on a linked pair');
  await refuses(db, () => decide(db, CM, H, 'no_ring_expected', { reason: 'comped' }), 'lead_has_links', 'no ring on a linked lead');
  // Unlink -> tombstone -> blocked in the plan -> back on the list; relink needs the unlink head.
  const un = await decide(db, CM, H, 'unlink', { loc: SHOP, order: 'G1', check: 'G1c', expected: linked.decision_id });
  check((await one(db, `select retired_reason from catering_toast_links where id = $1`, [linked.link_id])).retired_reason === 'unlinked', 'unlink retires the link');
  check((await one(db, `select status from catering_reconciliation_status where lead_id = $1`, [H])).status === 'not_rung_in_toast', 'unlinked: back on the not-rung list');
  check((await all(db, `select * from plan_catering_toast($1, '2026-11-05', '2026-11-12', '[]')`, [SHOP])).find(r => r.lead_id === H && r.check_guid === 'G1c')?.blocked === true, 'the unlink is a tombstone in the plan');
  check((await one(db, `select action from audit_log order by id desc limit 1`)).action === 'catering.toast_unlink', 'unlink audited');
  await refuses(db, () => decide(db, CM, H, 'unlink', { loc: SHOP, order: 'G1', check: 'G1c', expected: un.decision_id }), 'not_linked', 'unlink twice');
  // Another lead may now take G1c (the pair is H's tombstone, not the check's).
  const other = await decide(db, CM, H2, 'link', { loc: SHOP, order: 'G1', check: 'G1c' });
  await decide(db, CM, H2, 'unlink', { loc: SHOP, order: 'G1', check: 'G1c', expected: other.decision_id });
  const re = await decide(db, GM, H, 'link', { loc: SHOP, order: 'G1', check: 'G1c', expected: un.decision_id });
  check(re.link_id && (await head(db, H, 'G1', 'G1c')) === re.decision_id, 'a human relink clears the tombstone');
  // A stale holder (lead lost) is retired by the system with no tombstone.
  await db.exec(`update catering_pipeline set stage = 'lost' where id = '${H}'`);
  const take = await decide(db, CM, H2, 'link', { loc: SHOP, order: 'G1', check: 'G1c', expected: await head(db, H2, 'G1', 'G1c') });
  check((await one(db, `select retired_reason from catering_toast_links where id = $1`, [re.link_id])).retired_reason === 'lead_lost'
    && (await head(db, H, 'G1', 'G1c')) === re.decision_id, 'a lost holder is retired lead_lost, its decision chain untouched');
  check((await one(db, `select metadata from audit_log order by id desc limit 1`)).metadata.retired_stale_link === re.link_id, 'the retirement is named in the audit row');
  // not_a_match / no_ring_expected / ring_expected.
  const H3 = id('3000', 303);
  await db.exec(`insert into catering_pipeline(id, location_id, event_date, stage, lead_source, estimated_revenue_cents) values ('${H3}', '${SHOP}', '2026-11-10', 'out', 'portal', 30000)`);
  const nm = await decide(db, GM, H3, 'not_a_match', { loc: SHOP, order: 'G1', check: 'G1c' });
  await refuses(db, () => decide(db, GM, H3, 'not_a_match', { loc: SHOP, order: 'G1', check: 'G1c', expected: nm.decision_id }), 'already_decided', 'not a match twice');
  await refuses(db, () => decide(db, GM, H3, 'ring_expected'), 'not_marked', 'ring expected without a mark');
  await refuses(db, () => decide(db, GM, H3, 'no_ring_expected'), 'invalid_decision', 'no ring needs a reason');
  const nr = await decide(db, GM, H3, 'no_ring_expected', { reason: 'paid_outside_toast' });
  check((await one(db, `select status from catering_reconciliation_status where lead_id = $1`, [H3])).status === 'no_ring_expected', 'no ring expected leaves the list');
  await refuses(db, () => decide(db, GM, H3, 'link', { loc: SHOP, order: 'G1', check: 'G1c', expected: nm.decision_id }), 'lead_no_ring_expected', 'no link while no ring is expected');
  await decide(db, GM, H3, 'ring_expected', { expected: nr.decision_id });
  check((await one(db, `select status from catering_reconciliation_status where lead_id = $1`, [H3])).status === 'not_rung_in_toast', 'ring expected: back on the list');
  const actions = (await all(db, `select action, destructive from audit_log where id > $1 order by id`, [auditBefore]));
  check(actions.every(a => a.destructive) && ['catering.toast_link', 'catering.toast_unlink', 'catering.toast_not_a_match', 'catering.toast_no_ring_expected', 'catering.toast_ring_expected']
    .every(n => actions.some(a => a.action === n)), 'every decision kind writes its own destructive audit row');
  check(Number((await one(db, `select count(*) n from catering_toast_link_decisions`)).n) === Number((await one(db, `select count(*) n from audit_log where action like 'catering.toast_%'`)).n),
    'one audit row per decision');

  // H. The publisher guard never raises: break its helper inside a transaction; the row passes through.
  await db.exec('begin');
  await db.exec(`alter view catering_toast_decision_heads rename to catering_toast_decision_heads_gone`);
  await db.query(`insert into ezcater_toast_links(order_id, snapshot_id, location_id, toast_snapshot_id, order_guid, check_guid, selection_guid, business_date, evidence)
    values ($1, $2, $3, $4, 'D1', 'D1c', 'D1c-s9', '2026-11-20', 'normalized_code')`, [EO1, id('3200', 1), SHOP, id('5000', 11)]);
  check((await ezLinks(db, `and selection_guid = 'D1c-s9'`)).length === 1, 'a guard that cannot decide passes the row (today\'s behaviour), never raises');
  await db.exec('rollback');

  console.log(`sql-harness-0347: ${checks} checks passed`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
