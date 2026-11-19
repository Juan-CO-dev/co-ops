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
 *   - the publisher guard never raises; the house guard does; the ceiling;
 *   - fix round 1 (review PORTAL3-r1): OWNERSHIP TRANSITIONS on the REAL 0225 transfer writer. A transfer away ENDS the
 *     house link (recorded lead_moved); a round trip never revives it, in both orders (ezCater claims while the lead is
 *     away / after it is back) and with the publisher or the reconciler claiming; the returning lead shows the ended
 *     link with its present owner (a conflict), never ownership. Same for lost -> re-opened, for a holder that became
 *     an ezCater lead, a voided / un-voided check, and a lead that cannot be deleted; the house planner, the orphans
 *     view and the writer all answer from ONE owner rule (catering_toast_house_owner).
 *   - fix round 2 (review PORTAL3-r2): the ezCater side's conflict read shows a recorded conflict only while its facts
 *     hold NOW: not once the check is voided (back when re-opened), the house code is removed, the house side unlinks,
 *     ezCater rings the order on another check, or the ezCater order is cancelled / its lead lost. The ledger is kept.
 *   - fix round 3 (review PORTAL3-r3): THE STATE TABLE (section K). Every (lead state x check state x owner) row of
 *     tests/fixtures/catering-toast-state-table.json is built on the real writers and every database answer compared:
 *     a conflict ends when the ezCater order moves to another shop (the real 0225 transfer), is cancelled, or its
 *     event leaves the check's window; "not a match" is accepted on a check another order holds and moves no owner.
 *   - fix round 4 (review PORTAL3-r4): the table gains two axes, every combination a row and the harness refuses a
 *     table that misses one: the EVIDENCE on a dual-code check (both codes, the ezCater number removed, the house code
 *     removed, neither, recaptured with both and ezCater synced; and the ezCater number as a special request: present,
 *     gone after a recapture, published again) x the house order's DECISION (none, not a match, no Toast ring expected,
 *     a link the system ended). A recorded conflict holds only while the check as Toast has it now still carries the
 *     ezCater evidence; a lead marked no ring expected has no live code; and each row's check-in-window answer is
 *     compared, so the panel's link rule can be held to the writer's answer row by row. K_DUMP=1 prints every row's
 *     answers instead of asserting them (for adding rows).
 * PGlite has ONE backend: lock waits are not provable here (CC's sim two-session proof covers them).
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { SHOP, OTHER, id, read, migration as m0344, schema as baseSchema, ring } from './sql-harness-0344-lib.mjs';

let checks = 0;
function check(ok, message) { checks++; if (!ok) throw new Error(`FAIL: ${message}`); }

const publisher0229 = read('0229_ezcater_toast_reconcile.sql').match(/create or replace function public\.publish_ezcater_shadow[\s\S]*?\nend \$\$;/)?.[0];
const planner0231 = read('0231_ezcater_reconcile_planner_speed.sql').match(/create or replace function public\.plan_ezcater_toast[\s\S]*?\$plan\$;/)?.[0];
const transfer0225 = read('0225_ezcater_pass2.sql').match(/create function public\.transfer_catering_lead[\s\S]*?\nend \$\$;/)?.[0];
const reconcile0330 = read('0330_ezcater_catering_records_fixes.sql').match(/create or replace function public\.reconcile_ezcater_toast[\s\S]*?\nend \$\$;/)?.[0];
export const m0347 = read('0347_catering_toast_link_step.sql');

export const CM = id('2000', 11), GM = id('2000', 12), GM_ELSEWHERE = id('2000', 13), MOO = id('2000', 14), EMP = id('2000', 15), AGM = id('2000', 16);
export const EZL1 = id('3000', 101), EZL2 = id('3000', 102), EZL3 = id('3000', 103);
export const EO1 = id('3100', 1), EO2 = id('3100', 2), EO3 = id('3100', 3);
export const HA = id('3000', 201), HB = id('3000', 202), HC = id('3000', 203);

export async function setup({ with0347 }) {
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
    -- What the REAL 0225 transfer writer touches.
    alter table locations add column active boolean not null default true, add column ezcater_caterer_uuid text;
    alter table catering_pipeline add column updated_at timestamptz, add column location_manually_moved_at timestamptz;
    alter table catering_quotes add column location_id uuid;
    create table catering_orders(id uuid primary key default gen_random_uuid(), pipeline_id uuid, location_id uuid);
    create table catering_prep_demand(id uuid primary key default gen_random_uuid(), pipeline_id uuid, quote_id uuid, location_id uuid,
      need_date date, item_id uuid, menu_item_id uuid, choice_package_item_id uuid, portion text, qty numeric, created_by uuid,
      status text not null default 'reserved', released_at timestamptz);
    alter table ezcater_orders add column provider_location_observed_at timestamptz, add column fetched_at timestamptz,
      add column created_at timestamptz default now(), add column location_conflict boolean not null default false,
      add column location_manual_override boolean not null default false, add column caterer_uuid text;
    create table catering_pipeline_events(id bigserial primary key, pipeline_id uuid, from_stage text, to_stage text, note text, actor_id uuid);
    grant all on all tables in schema public to service_role;`);
  check(Boolean(publisher0229 && planner0231 && reconcile0330 && transfer0225), 'real 0229 publisher / 0231 planner / 0330 reconciler / 0225 transfer extracted');
  await db.exec(transfer0225);
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

export async function ringEz(db, snap, args) {
  await ring(db, snap, args);
  // The real publisher reads (s->>'voided')::boolean without a default: capture always writes both flags.
  await db.query(`update toast_orders set selection_units = (select coalesce(jsonb_agg(u || '{"voided":false,"deleted":false}'::jsonb), '[]'::jsonb)
    from jsonb_array_elements(selection_units) u) where id = $1`, [snap]);
  for (const c of args.checks) await db.query(`update toast_order_checks set amount_cents = total_cents where snapshot_id = $1 and check_guid = $2`, [snap, c.guid]);
}
export const one = async (db, q, p = []) => (await db.query(q, p)).rows[0];
export const all = async (db, q, p = []) => (await db.query(q, p)).rows;
export async function refuses(db, run, code, message) {
  await db.exec('begin'); let error;
  try { await run(); } catch (e) { error = e; }
  await db.exec('rollback');
  check(String(error?.message ?? '').includes(code), `${message}: expected ${code}, got ${error?.message ?? 'success'}`);
}
export const asService = async (db, fn) => { await db.exec('begin; set local role service_role'); try { return await fn(); } finally { await db.exec('commit'); } };
export const reconcile = db => asService(db, () => one(db, `select reconcile_ezcater_toast('2026-11-01', '2026-11-30') r`));
export const publish = (db, order, payload) => asService(db, () => db.query(`select publish_ezcater_shadow($1, $2, $3, $4)`,
  [order, order === EO1 ? id('3200', 1) : order === EO2 ? id('3200', 2) : id('3200', 3), SHOP, JSON.stringify(payload)]));
export const ezLinks = async (db, where = '') => (await all(db, `select order_id::text o, order_guid, check_guid, selection_guid, evidence, toast_snapshot_id::text snap,
  amount_diff_cents::text diff, amount_mismatch, reconciliation_details::text det from ezcater_toast_links where is_current ${where}
  order by 1, 2, 3, 4, 5`));
export async function decide(db, actor, lead, kind, args = {}) {
  const r = await one(db, `select decide_catering_toast($1, $2, $3, $4, $5, $6, $7, $8) d`,
    [actor, lead, kind, args.loc ?? null, args.order ?? null, args.check ?? null, args.reason ?? null, args.expected ?? null]);
  return r.d;
}
export const head = async (db, lead, order = null, check_ = null) => (await one(db, `select id from catering_toast_decision_heads where lead_id = $1
  and order_guid is not distinct from $2 and check_guid is not distinct from $3`, [lead, order, check_]))?.id ?? null;
export const planEz = async db => all(db, `select order_id::text o, toast_snapshot_id::text snap, order_guid, check_guid, selection_guid, business_date::text d, evidence,
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
  check(house.map(h => h.proname).join() === 'publish_ezcater_shadow,reconcile_ezcater_toast,transfer_catering_lead', 'no house function updates ezcater_toast_links (the ezCater writers and the 0225 transfer only)');

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
  // A lost lead's link is ENDED at the stage change (fix round 1), with no tombstone; the check is free at once.
  await db.exec(`update catering_pipeline set stage = 'lost' where id = '${H}'`);
  check((await one(db, `select retired_reason from catering_toast_links where id = $1`, [re.link_id])).retired_reason === 'lead_lost'
    && (await head(db, H, 'G1', 'G1c')) === re.decision_id, 'a lost holder is retired lead_lost, its decision chain untouched');
  const take = await decide(db, CM, H2, 'link', { loc: SHOP, order: 'G1', check: 'G1c', expected: await head(db, H2, 'G1', 'G1c') });
  check(take.link_id && (await one(db, `select metadata from audit_log order by id desc limit 1`)).metadata.retired_stale_link === undefined, 'the next lead links the freed check');
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

  // I. Fix round 1 (review PORTAL3-r1): ownership transitions, on the REAL 0225 transfer writer.
  {
    const transfer = async (lead, to) => (await one(db, `select transfer_catering_lead($1, $2, $3, 'capacity') r`, [lead, to, CM])).r;
    const houseLinks = (lead) => all(db, `select id::text, is_current, retired_reason, location_id::text loc, check_guid from catering_toast_links where lead_id = $1 order by created_at`, [lead]);
    const owners = async (order, chk) => one(db, `select
      exists(select 1 from ezcater_toast_links z where z.is_current and z.location_id = $1 and z.order_guid = $2 and z.check_guid = $3) ez,
      catering_toast_house_owner($1, $2, $3)::text house,
      (select count(*)::int from catering_toast_links h where h.is_current and h.location_id = $1 and h.order_guid = $2 and h.check_guid = $3) house_rows`, [SHOP, order, chk]);
    const ended = (lead) => all(db, `select order_guid, check_guid, retired_reason, owner, head_id::text from catering_toast_ended_links($1)`, [lead]);
    const planRow = async (lead, chk, from = '2026-11-08', to = '2026-11-20') =>
      (await all(db, `select * from plan_catering_toast($1, $2, $3, '[]')`, [SHOP, from, to])).find(r => r.lead_id === lead && r.check_guid === chk);
    const status = async (lead) => (await one(db, `select status from catering_reconciliation_status where lead_id = $1`, [lead]))?.status ?? null;
    const mkHouse = (lead, date, cents) => db.exec(`insert into catering_pipeline(id, location_id, event_date, stage, lead_source, estimated_revenue_cents)
      values ('${lead}', '${SHOP}', '${date}', 'confirmed', 'portal', ${cents})`);
    const mkEz = async (n, date, number, cents) => {
      const lead = id('3000', 400 + n), order = id('3100', 400 + n), snap = id('3200', 400 + n);
      await db.exec(`insert into catering_pipeline(id, location_id, event_date, stage, lead_source, estimated_revenue_cents) values ('${lead}', '${SHOP}', '${date}', 'confirmed', 'ezcater', ${cents});
        insert into ezcater_orders(id, lead_id, location_id, order_number, snapshot_id, provider_uuid, event_date, status, subtotal_cents)
          values ('${order}', '${lead}', '${SHOP}', '${number}', '${snap}', 'prov-t${n}', '${date}', 'submitted', ${cents});`);
      return { lead, order, snap };
    };
    const publishFor = (ez, link) => asService(db, () => db.query(`select publish_ezcater_shadow($1, $2, $3, $4)`, [ez.order, ez.snap, SHOP,
      JSON.stringify({ links: [link], maps: [], reviews: [], shadow: [] })]));
    await db.exec(`insert into catering_toast_settings(location_id, enabled) values ('${OTHER}', true)`);

    // I1. Away -> ezCater claims (the RECONCILER) -> back. The reviewer's exact sequence.
    const TA = id('3000', 501);
    await mkHouse(TA, '2026-11-12', 40000);
    await mkEz(1, '2026-11-12', 'TRN-111', 40000);
    await ringEz(db, id('5000', 101), { order: 'T1', date: '2026-11-12', checks: [{ guid: 'T1c', total: 40000, names: ['TRN-111'] }] });
    const l1 = await decide(db, CM, TA, 'link', { loc: SHOP, order: 'T1', check: 'T1c' });
    await reconcile(db);
    let o = await owners('T1', 'T1c');
    check(o.house === TA && !o.ez, 'I1: linked; the house lead holds the check and the reconciler leaves it');
    check((await transfer(TA, OTHER)).result === 'moved', 'I1: the real transfer writer moved the lead');
    let hl = await houseLinks(TA);
    check(hl.length === 1 && hl[0].is_current === false && hl[0].retired_reason === 'lead_moved', `I1: a transfer away ENDS the link, recorded lead_moved (${JSON.stringify(hl)})`);
    check((await head(db, TA, 'T1', 'T1c')) === l1.decision_id, 'I1: a system end is no tombstone (the decision chain is untouched)');
    await reconcile(db);
    o = await owners('T1', 'T1c');
    check(o.ez && o.house === null, 'I1: while the lead is away ezCater claims the unowned check');
    check((await transfer(TA, SHOP)).result === 'moved', 'I1: ... and the lead comes back');
    o = await owners('T1', 'T1c');
    check(o.ez && o.house === null && o.house_rows === 0, `I1: round trip: ezCater keeps the check, the house link is NOT revived (${JSON.stringify(o)})`);
    check((await status(TA)) === 'not_rung_in_toast', 'I1: the returning lead is not counted as rung');
    const e1 = await ended(TA);
    check(e1.length === 1 && e1[0].check_guid === 'T1c' && e1[0].owner === 'ezcater' && e1[0].retired_reason === 'lead_moved' && e1[0].head_id === l1.decision_id,
      `I1: the returning lead SHOWS the conflict: its ended link, now ezCater's (${JSON.stringify(e1)})`);
    check((await planRow(TA, 'T1c'))?.owner === 'ezcater', 'I1: the house planner says ezCater owns it');
    await refuses(db, () => decide(db, CM, TA, 'link', { loc: SHOP, order: 'T1', check: 'T1c', expected: l1.decision_id }), 'check_owned_by_ezcater', 'I1: no relink over ezCater');
    await reconcile(db);
    o = await owners('T1', 'T1c');
    check(o.ez && o.house === null, 'I1: a reconcile after the return changes nothing: one owner');
    const pr = await one(db, `select (catering_pipeline_reconciliation($1, '2026-11-12', '2026-11-12')->'parts'->'rung_in_toast') r`, [SHOP]);
    check(pr.r === null, 'I1: the pipeline partition does not count the returning lead as rung in Toast');

    // I2. The other order: away -> back -> THEN ezCater (the PUBLISHER) arrives. The link stays ended; ezCater takes it.
    const TB = id('3000', 502);
    await mkHouse(TB, '2026-11-13', 41000);
    const ez2 = await mkEz(2, '2026-11-13', 'TRN-222', 41000);
    await ringEz(db, id('5000', 102), { order: 'T2', date: '2026-11-13', checks: [{ guid: 'T2c', total: 41000, names: ['TRN-222'] }] });
    const l2 = await decide(db, CM, TB, 'link', { loc: SHOP, order: 'T2', check: 'T2c' });
    const t2link = { toast_snapshot_id: id('5000', 102), order_guid: 'T2', check_guid: 'T2c', selection_guid: 'T2c-s0', business_date: '2026-11-13' };
    await publishFor(ez2, t2link);
    check(!(await owners('T2', 'T2c')).ez, 'I2: the publisher is refused while the house lead holds the check');
    await transfer(TB, OTHER);
    await transfer(TB, SHOP);
    o = await owners('T2', 'T2c');
    check(o.house === null && o.house_rows === 0 && !o.ez, 'I2: away and back with nobody claiming: the link stays ENDED, the check is unowned');
    const e2 = await ended(TB);
    check(e2.length === 1 && e2[0].owner === null, 'I2: the lead shows its ended link, free to link again');
    check((await planRow(TB, 'T2c'))?.owner === null, 'I2: the planner offers the check again (owner none)');
    await publishFor(ez2, t2link);
    o = await owners('T2', 'T2c');
    check(o.ez && o.house === null, 'I2: ezCater (publisher) arriving after the return takes the unowned check');
    check((await ended(TB))[0].owner === 'ezcater', 'I2: ... and the lead now shows the conflict');
    await refuses(db, () => decide(db, CM, TB, 'link', { loc: SHOP, order: 'T2', check: 'T2c', expected: l2.decision_id }), 'check_owned_by_ezcater', 'I2: no relink over ezCater');

    // I3. Away -> back -> a PERSON links again first -> ezCater (publisher, then reconciler) is refused.
    const TC = id('3000', 503);
    await mkHouse(TC, '2026-11-14', 42000);
    const ez3 = await mkEz(3, '2026-11-14', 'TRN-333', 42000);
    await ringEz(db, id('5000', 103), { order: 'T3', date: '2026-11-14', checks: [{ guid: 'T3c', total: 42000, names: ['TRN-333'] }] });
    const l3 = await decide(db, CM, TC, 'link', { loc: SHOP, order: 'T3', check: 'T3c' });
    await transfer(TC, OTHER);
    await refuses(db, () => decide(db, CM, TC, 'link', { loc: SHOP, order: 'T3', check: 'T3c', expected: l3.decision_id }), 'lead_moved', 'I3: no link at the old shop while away');
    await transfer(TC, SHOP);
    const l3b = await decide(db, GM, TC, 'link', { loc: SHOP, order: 'T3', check: 'T3c', expected: l3.decision_id });
    await publishFor(ez3, { toast_snapshot_id: id('5000', 103), order_guid: 'T3', check_guid: 'T3c', selection_guid: 'T3c-s0', business_date: '2026-11-14' });
    await reconcile(db);
    o = await owners('T3', 'T3c');
    check(o.house === TC && !o.ez && o.house_rows === 1 && l3b.link_id !== l3.link_id, 'I3: a human relink after the return is a NEW link and holds against ezCater');
    check((await ended(TC)).length === 0 && (await status(TC)) === 'matched', 'I3: relinked: nothing shown as ended, matched');
    hl = await houseLinks(TC);
    check(hl.length === 2 && hl[0].retired_reason === 'lead_moved' && hl[1].is_current, 'I3: history kept: the ended row and the new one');

    // I4. ezCater claims while away, by the PUBLISHER; then the lead returns.
    const TD = id('3000', 504);
    await mkHouse(TD, '2026-11-15', 43000);
    const ez4 = await mkEz(4, '2026-11-15', 'TRN-444', 43000);
    await ringEz(db, id('5000', 104), { order: 'T4', date: '2026-11-15', checks: [{ guid: 'T4c', total: 43000, names: ['TRN-444'] }] });
    await decide(db, CM, TD, 'link', { loc: SHOP, order: 'T4', check: 'T4c' });
    await transfer(TD, OTHER);
    await publishFor(ez4, { toast_snapshot_id: id('5000', 104), order_guid: 'T4', check_guid: 'T4c', selection_guid: 'T4c-s0', business_date: '2026-11-15' });
    await transfer(TD, SHOP);
    await reconcile(db);
    o = await owners('T4', 'T4c');
    check(o.ez && o.house === null && o.house_rows === 0, 'I4: publisher claims while away; after the return and a reconcile ezCater still alone');

    // I5. Lost -> ezCater claims -> re-opened: the same rule.
    const TE = id('3000', 505);
    await mkHouse(TE, '2026-11-16', 44000);
    await mkEz(5, '2026-11-16', 'TRN-555', 44000);
    await ringEz(db, id('5000', 105), { order: 'T5', date: '2026-11-16', checks: [{ guid: 'T5c', total: 44000, names: ['TRN-555'] }] });
    await decide(db, CM, TE, 'link', { loc: SHOP, order: 'T5', check: 'T5c' });
    await db.exec(`update catering_pipeline set stage = 'lost' where id = '${TE}'`);
    hl = await houseLinks(TE);
    check(hl[0].is_current === false && hl[0].retired_reason === 'lead_lost', 'I5: a lost lead ENDS its links (lead_lost)');
    await reconcile(db);
    await db.exec(`update catering_pipeline set stage = 'confirmed' where id = '${TE}'`);
    o = await owners('T5', 'T5c');
    check(o.ez && o.house === null && o.house_rows === 0, 'I5: lost -> ezCater claims -> re-opened: not revived');
    check((await ended(TE))[0]?.owner === 'ezcater' && (await ended(TE))[0]?.retired_reason === 'lead_lost', 'I5: the re-opened lead shows the conflict');
    // A stage move that is not `lost` (confirmed -> out -> completed -> quote_sent) ends nothing.
    const TF = id('3000', 506);
    await mkHouse(TF, '2026-11-17', 45000);
    await ringEz(db, id('5000', 106), { order: 'T6', date: '2026-11-17', checks: [{ guid: 'T6c', total: 45000 }] });
    await decide(db, CM, TF, 'link', { loc: SHOP, order: 'T6', check: 'T6c' });
    for (const st of ['out', 'completed', 'quote_sent', 'confirmed']) await db.exec(`update catering_pipeline set stage = '${st}', headcount = 9 where id = '${TF}'`);
    check((await owners('T6', 'T6c')).house === TF && (await houseLinks(TF)).every(l => l.is_current), 'I5: other stage moves and edits end nothing');

    // I6. A voided, then re-opened check: the link is held throughout (no window for ezCater), the lead leaves and
    // re-joins the rung set with the check.
    await ringEz(db, id('5000', 107), { order: 'T6', date: '2026-11-17', checks: [{ guid: 'T6c', total: 45000, voided: true }] });
    check((await status(TF)) === 'not_rung_in_toast' && (await owners('T6', 'T6c')).house === TF, 'I6: voided check: the lead is not rung, the link is still held');
    await refuses(db, () => decide(db, CM, TF, 'no_ring_expected', { reason: 'comped' }), 'lead_has_links', 'I6: unlink first, even when the check is voided');
    await ringEz(db, id('5000', 108), { order: 'T6', date: '2026-11-17', checks: [{ guid: 'T6c', total: 45000, names: ['TRN-666'] }] });
    const ez6 = await mkEz(6, '2026-11-17', 'TRN-666', 45000);
    await publishFor(ez6, { toast_snapshot_id: id('5000', 108), order_guid: 'T6', check_guid: 'T6c', selection_guid: 'T6c-s0', business_date: '2026-11-17' });
    await reconcile(db);
    o = await owners('T6', 'T6c');
    check((await status(TF)) === 'matched' && o.house === TF && !o.ez, 'I6: re-opened check: matched again, still the house lead alone');

    // I7. A lead is never deleted from under its links.
    await refuses(db, () => db.exec(`delete from catering_pipeline where id = '${TF}'`), 'violates foreign key', 'I7: a linked lead cannot be deleted');

    // I8. One owner rule everywhere (review P2 #1). A holder that BECAME an ezCater lead (an order attached to it) no
    // longer owns: the planner, the orphans view and the writer agree, and the next lead can take the check from the UI.
    const TG = id('3000', 507), TH = id('3000', 508);
    await mkHouse(TG, '2026-11-18', 46000); await mkHouse(TH, '2026-11-18', 46000);
    await ringEz(db, id('5000', 109), { order: 'T8', date: '2026-11-18', checks: [{ guid: 'T8c', total: 46000 }] });
    const l8 = await decide(db, CM, TG, 'link', { loc: SHOP, order: 'T8', check: 'T8c' });
    check((await planRow(TH, 'T8c'))?.owner === 'house' && (await planRow(TH, 'T8c')).owner_lead_id === TG, 'I8: a live holder is the owner in the plan');
    check(Number((await one(db, `select count(*) n from catering_toast_orphans where check_guid = 'T8c'`)).n) === 0, 'I8: a held check is no orphan');
    await db.exec(`insert into ezcater_orders(id, lead_id, location_id, provider_uuid) values ('${id('3100', 480)}', '${TG}', '${SHOP}', 'prov-attach')`);
    const p8 = await planRow(TH, 'T8c');
    check(p8?.owner === null && p8.owner_lead_id === null, `I8: a holder that no longer qualifies is NOT the owner in the plan (${p8?.owner})`);
    check(Number((await one(db, `select count(*) n from catering_toast_orphans where check_guid = 'T8c'`)).n) === 1, 'I8: ... and the check is an orphan again');
    const take8 = await decide(db, CM, TH, 'link', { loc: SHOP, order: 'T8', check: 'T8c' });
    check((await one(db, `select retired_reason from catering_toast_links where id = $1`, [l8.link_id])).retired_reason === 'lead_ezcater'
      && (await one(db, `select metadata from audit_log order by id desc limit 1`)).metadata.retired_stale_link === l8.link_id && take8.link_id,
      'I8: the writer retires the stale holder (lead_ezcater), named in the audit row');
    // The same stale holder, with ezCater arriving instead of a person: the claim ENDS the dormant row, so a holder that
    // turns house again later can never own beside ezCater.
    const TI = id('3000', 509);
    await mkHouse(TI, '2026-11-19', 47000);
    const ez9 = await mkEz(9, '2026-11-19', 'TRN-999', 47000);
    await ringEz(db, id('5000', 110), { order: 'T9', date: '2026-11-19', checks: [{ guid: 'T9c', total: 47000, names: ['TRN-999'] }] });
    await decide(db, CM, TI, 'link', { loc: SHOP, order: 'T9', check: 'T9c' });
    await db.exec(`insert into ezcater_orders(id, lead_id, location_id, provider_uuid) values ('${id('3100', 481)}', '${TI}', '${SHOP}', 'prov-attach-2')`);
    await publishFor(ez9, { toast_snapshot_id: id('5000', 110), order_guid: 'T9', check_guid: 'T9c', selection_guid: 'T9c-s0', business_date: '2026-11-19' });
    hl = await houseLinks(TI);
    check(hl[0].is_current === false && hl[0].retired_reason === 'lead_ezcater', `I8: an ezCater claim ENDS the dormant house row (${JSON.stringify(hl)})`);
    await db.exec(`delete from ezcater_orders where id = '${id('3100', 481)}'`);
    o = await owners('T9', 'T9c');
    check(o.ez && o.house === null && o.house_rows === 0, 'I8: the holder turning house again does not own beside ezCater');

    // A lead that becomes ezCater by its OWN row (lead_source) ends its links at once (the trigger).
    const TJ = id('3000', 510);
    await mkHouse(TJ, '2026-11-19', 48000);
    await ringEz(db, id('5000', 111), { order: 'TJ', date: '2026-11-19', checks: [{ guid: 'TJc', total: 48000 }] });
    await decide(db, CM, TJ, 'link', { loc: SHOP, order: 'TJ', check: 'TJc' });
    await db.exec(`update catering_pipeline set lead_source = 'ezcater' where id = '${TJ}'`);
    hl = await houseLinks(TJ);
    check(hl[0].is_current === false && hl[0].retired_reason === 'lead_ezcater', `I8: lead_source -> ezcater ENDS the link (${JSON.stringify(hl)})`);
    await db.exec(`update catering_pipeline set lead_source = 'portal' where id = '${TJ}'`);
    check((await owners('TJ', 'TJc')).house === null && (await ended(TJ))[0]?.owner === null, 'I8: turning house again revives nothing; the ended link is shown, free');

    // I9. Across everything above: no check ever has two owners.
    const dual = await all(db, `select h.check_guid from catering_toast_links h where h.is_current and exists (select 1 from ezcater_toast_links z
      where z.is_current and z.location_id = h.location_id and z.order_guid = h.order_guid and z.check_guid = h.check_guid)`);
    check(dual.length === 0, `I9: no check holds a current house row beside a current ezCater row (${JSON.stringify(dual)})`);
    // The readiness probe the panel asks before it offers a control.
    check((await asService(db, () => one(db, `select catering_toast_link_ready() r`))).r === true, 'the link-step readiness probe answers true');

    // J. Fix round 2 (review PORTAL3-r2 P2 #1): a recorded conflict is shown only while its facts still hold NOW. The
    // ledger stays as history (nothing deleted); the read filters it against the live check, the house evidence, the
    // ezCater order's claim and where ezCater rang the order.
    const conflictsOf = async (order) => all(db, `select check_guid, kind, house_lead_id::text h from ezcater_order_house_conflicts($1) order by 1, 2`, [order]);
    const ledgerRows = async (chk) => Number((await one(db, `select count(*) n from catering_toast_conflicts where check_guid = $1`, [chk])).n);
    const mkCoded = async (lead, date, code) => { await mkHouse(lead, date, 30000); await db.exec(`update catering_pipeline set ring_code = '${code}' where id = '${lead}'`); };

    // J1. Voided check -> gone; re-opened -> back (a read, not a deletion). House evidence removed -> gone.
    const HJ = id('3000', 521);
    await mkCoded(HJ, '2026-11-21', 'CO-JJA34');
    const ezJ = await mkEz(21, '2026-11-21', 'JJJ-100', 30000);
    const jLink = (snap) => ({ toast_snapshot_id: snap, order_guid: 'J1', check_guid: 'J1c', selection_guid: 'J1c-s0', business_date: '2026-11-21' });
    await ringEz(db, id('5000', 201), { order: 'J1', date: '2026-11-21', checks: [{ guid: 'J1c', total: 30000, names: ['JJJ-100', 'CO-JJA34'] }] });
    await publishFor(ezJ, jLink(id('5000', 201)));
    let cj = await conflictsOf(ezJ.order);
    check(cj.length === 1 && cj[0].check_guid === 'J1c' && cj[0].kind === 'dual_code' && cj[0].h === HJ, `J1: baseline, the dual-code conflict shows (${JSON.stringify(cj)})`);
    await ringEz(db, id('5000', 202), { order: 'J1', date: '2026-11-21', checks: [{ guid: 'J1c', total: 30000, names: ['JJJ-100', 'CO-JJA34'], voided: true }] });
    cj = await conflictsOf(ezJ.order);
    check(cj.length === 0, `J1: the Toast check voided -> the conflict is no longer shown (${JSON.stringify(cj)})`);
    check(await ledgerRows('J1c') === 1, 'J1: ... and the ledger row is kept as history');
    await ringEz(db, id('5000', 203), { order: 'J1', date: '2026-11-21', checks: [{ guid: 'J1c', total: 30000, names: ['JJJ-100', 'CO-JJA34'] }] });
    check((await conflictsOf(ezJ.order)).length === 1, 'J1: the check re-opened with both codes -> the conflict shows again');
    await ringEz(db, id('5000', 204), { order: 'J1', date: '2026-11-21', checks: [{ guid: 'J1c', total: 30000, names: ['JJJ-100'] }] });
    cj = await conflictsOf(ezJ.order);
    check(cj.length === 0, `J1: the house ring code removed from the check -> not shown (${JSON.stringify(cj)})`);

    // J2. The house side linked, then unlinked (a tombstone on the pair): not shown once unlinked.
    await ringEz(db, id('5000', 205), { order: 'J1', date: '2026-11-21', checks: [{ guid: 'J1c', total: 30000, names: ['JJJ-100', 'CO-JJA34'] }] });
    const lj = await decide(db, CM, HJ, 'link', { loc: SHOP, order: 'J1', check: 'J1c' });
    await publishFor(ezJ, jLink(id('5000', 205)));
    cj = await conflictsOf(ezJ.order);
    check(cj.length >= 1 && cj.every(c => c.h === HJ), `J2: the house lead holds the check: the conflict shows, naming it (${JSON.stringify(cj)})`);
    await decide(db, CM, HJ, 'unlink', { loc: SHOP, order: 'J1', check: 'J1c', expected: lj.decision_id });
    cj = await conflictsOf(ezJ.order);
    check(cj.length === 0, `J2: the house side unlinked (its pair tombstoned) -> not shown (${JSON.stringify(cj)})`);

    // J3. The ezCater order rung on ANOTHER check (ezCater holds it there) -> the old check's conflict is not shown.
    const HK = id('3000', 522);
    await mkCoded(HK, '2026-11-21', 'CO-KKA34');
    const ezK = await mkEz(22, '2026-11-21', 'KKK-200', 30000);
    await ringEz(db, id('5000', 206), { order: 'K1', date: '2026-11-21', checks: [{ guid: 'K1c', total: 30000, names: ['KKK-200', 'CO-KKA34'] }] });
    await publishFor(ezK, { toast_snapshot_id: id('5000', 206), order_guid: 'K1', check_guid: 'K1c', selection_guid: 'K1c-s0', business_date: '2026-11-21' });
    check((await conflictsOf(ezK.order)).length === 1, 'J3: baseline, the conflict shows');
    await ringEz(db, id('5000', 207), { order: 'K2', date: '2026-11-21', checks: [{ guid: 'K2c', total: 30000, names: ['KKK-200'] }] });
    await publishFor(ezK, { toast_snapshot_id: id('5000', 207), order_guid: 'K2', check_guid: 'K2c', selection_guid: 'K2c-s0', business_date: '2026-11-21' });
    check((await ezLinks(db, `and check_guid = 'K2c'`)).length === 1, 'J3: ezCater holds the order on the replacement check');
    cj = await conflictsOf(ezK.order);
    check(cj.length === 0, `J3: the order rung on another check -> the old conflict is not shown (${JSON.stringify(cj)})`);

    // J4. The ezCater side gone (the order cancelled) -> not shown.
    const HL = id('3000', 523);
    await mkCoded(HL, '2026-11-21', 'CO-LLA34');
    const ezL = await mkEz(23, '2026-11-21', 'LLL-300', 30000);
    await ringEz(db, id('5000', 208), { order: 'L1', date: '2026-11-21', checks: [{ guid: 'L1c', total: 30000, names: ['LLL-300', 'CO-LLA34'] }] });
    await publishFor(ezL, { toast_snapshot_id: id('5000', 208), order_guid: 'L1', check_guid: 'L1c', selection_guid: 'L1c-s0', business_date: '2026-11-21' });
    check((await conflictsOf(ezL.order)).length === 1, 'J4: baseline, the conflict shows');
    await db.exec(`update ezcater_orders set status = 'cancelled' where id = '${ezL.order}'`);
    cj = await conflictsOf(ezL.order);
    check(cj.length === 0, `J4: the ezCater order cancelled -> not shown (${JSON.stringify(cj)})`);
    await db.exec(`update ezcater_orders set status = 'submitted' where id = '${ezL.order}'; update catering_pipeline set stage = 'lost' where id = '${ezL.lead}'`);
    cj = await conflictsOf(ezL.order);
    check(cj.length === 0, `J4: the ezCater lead lost -> not shown (${JSON.stringify(cj)})`);

    // K. Fix round 3 (review PORTAL3-r3): THE STATE TABLE. One row per (lead state x check state x owner), shared with
    // tests/catering-toast-state-table.test.ts and the runbook (tests/fixtures/catering-toast-state-table.json). Each
    // row is built on the real writers (decide, the 0229 publisher, the 0225 transfer), then every answer the database
    // gives for that lead and check is compared with the row: the house planner, the not-rung list, the ezCater
    // order's conflict read, the ended-links read, and the writer's answer to "link" and to "not a match" (each tried
    // in a transaction that is rolled back). An accepted "not a match" never moves ownership.
    {
      const table = JSON.parse(readFileSync('tests/fixtures/catering-toast-state-table.json', 'utf8')).rows;
      const day = (i, plus = 0) => new Date(Date.UTC(2027, 0, 5) + (i * 10 + plus) * 86400000).toISOString().slice(0, 10);
      const ctx = (i) => ({ i, L: id('3000', 1000 + i), X: id('3000', 1100 + i), d: day(i), order: `S${i}`, chk: `S${i}c`,
        snap: k => id('5000', 1000 + i * 10 + k), code: `CO-${'XWVUT'[Math.floor((i - 1) / 21)]}${'ACDEFGHJKLMNPQRTUVWXY'[(i - 1) % 21]}Y34`, num: `SEZ-${100 + i}`, ez: null });
      const ringS = (c, k, names, voided = false) => ringEz(db, c.snap(k), { order: c.order, date: c.d, checks: [{ guid: c.chk, total: 50000, names, voided }] });
      const house = async (c, names = [], coded = false) => {
        await mkHouse(c.L, c.d, 50000);
        if (coded) await db.exec(`update catering_pipeline set ring_code = '${c.code}' where id = '${c.L}'`);
        await ringS(c, 0, names);
      };
      const ezOf = async (c) => { c.ez = await mkEz(200 + c.i, c.d, c.num, 50000); return c.ez; };
      const pub = (c, k = 0) => publishFor(c.ez, { toast_snapshot_id: c.snap(k), order_guid: c.order, check_guid: c.chk, selection_guid: `${c.chk}-s0`, business_date: c.d });
      const act = async (c, kind, lead = c.L) => decide(db, CM, lead, kind, { loc: SHOP, order: c.order, check: c.chk, expected: await head(db, lead, c.order, c.chk) });
      // S02: an unowned check carrying both codes; the publisher is skipped and a dual_code conflict is recorded.
      const dual = async (c) => { await house(c, [c.num, c.code], true); await ezOf(c); await pub(c); };
      // S09: ezCater holds the check first, then the check gains the house order's ring code.
      const incumbent = async (c) => { await house(c, [c.num], true); await ezOf(c); await pub(c); await ringS(c, 1, [c.num, c.code]); };
      // S12: linked, moved to another shop and back (the link ended; nothing revives it).
      const roundTrip = async (c) => { await house(c); await act(c, 'link'); await transfer(c.L, OTHER); await transfer(c.L, SHOP); };
      // S13: linked, moved away, ezCater took the check, moved back.
      const takenAway = async (c) => { await house(c, [c.num]); await act(c, 'link'); await transfer(c.L, OTHER); await ezOf(c); await pub(c); await transfer(c.L, SHOP); };
      // Fix round 4. The lead decision "no Toast ring expected".
      const noRing = async (c) => decide(db, CM, c.L, 'no_ring_expected', { reason: 'comped', expected: await head(db, c.L) });
      // The ezCater number typed as a special request: not in the retained names; the publisher's payload carries it.
      const noteDual = async (c) => { await house(c, [c.code], true); await ezOf(c); await pub(c); };
      // Linked on the dual-code check (ezCater skipped), then moved away and back: the link ended, the codes remain.
      const endedDual = async (c) => { await house(c, [c.num, c.code], true); await act(c, 'link'); await ezOf(c); await pub(c);
        await transfer(c.L, OTHER); await transfer(c.L, SHOP); await pub(c); };
      const DECISION = {
        none: dual,
        not_a_match: async c => { await dual(c); await act(c, 'not_a_match'); },
        no_ring_expected: async c => { await dual(c); await noRing(c); },
        ended: endedDual,
      };
      // A recapture (snapshot 5) of the check: which codes its names still carry, and whether the publisher ran again.
      const EVIDENCE = {
        present: async () => {},
        ezcater_removed: c => ringS(c, 5, [c.code]),
        house_removed: c => ringS(c, 5, [c.num]),
        both_removed: c => ringS(c, 5, []),
        recaptured: async c => { await ringS(c, 5, [c.num, c.code]); await pub(c, 5); },
      };
      const axes = { S02: { evidence: 'present', decision: 'none' }, S03: { evidence: 'present', decision: 'not_a_match' },
        S24: { evidence: 'note_present', decision: 'none' }, S25: { evidence: 'note_removed', decision: 'none' }, S26: { evidence: 'note_recaptured', decision: 'none' } };
      const build = {
        S01: c => house(c),
        S02: dual,
        S03: async c => { await dual(c); await act(c, 'not_a_match'); },
        S04: async c => { await dual(c); await act(c, 'not_a_match'); await pub(c); },
        S05: async c => { await house(c); await act(c, 'link'); },
        S06: async c => { await house(c, [c.num]); await act(c, 'link'); await ezOf(c); await pub(c); },
        S07: async c => { await house(c); await act(c, 'link'); await ringS(c, 1, [], true); },
        S08: async c => { await house(c); await mkHouse(c.X, c.d, 50000); await act(c, 'link', c.X); },
        S09: incumbent,
        S10: async c => { await incumbent(c); await act(c, 'not_a_match'); },
        S11: async c => { await house(c); await act(c, 'link'); await act(c, 'unlink'); },
        S12: roundTrip,
        S13: takenAway,
        S14: async c => { await takenAway(c); await act(c, 'not_a_match'); },
        S15: async c => { await roundTrip(c); await ringS(c, 1, [], true); },
        S16: async c => { await house(c); await act(c, 'link'); await transfer(c.L, OTHER); },
        S17: async c => { await house(c); await act(c, 'link'); await db.exec(`update catering_pipeline set stage = 'lost' where id = '${c.L}'`); },
        S18: async c => { await house(c); await decide(db, CM, c.L, 'no_ring_expected', { reason: 'comped' }); },
        // Review PORTAL3-r3 P2 #1: the ezCater order leaves the check's shop (the real 0225 transfer).
        S19: async c => { await dual(c); check((await transfer(c.ez.lead, OTHER)).result === 'moved', 'S19: the ezCater lead moved'); },
        S20: async c => { await dual(c); await db.exec(`update ezcater_orders set status = 'cancelled' where id = '${c.ez.order}'`); },
        S21: async c => { await dual(c); await db.exec(`update ezcater_orders set event_date = '${day(c.i, 30)}' where id = '${c.ez.order}'`); },
        // Fix round 4 (review PORTAL3-r4 P3): an ended link whose order is then marked "no Toast ring expected", or
        // whose event moved out of the check's window: the writer refuses a link, so the panel must not offer one.
        S22: async c => { await roundTrip(c); await noRing(c); },
        S23: async c => { await roundTrip(c); await db.exec(`update catering_pipeline set event_date = '${day(c.i, 35)}' where id = '${c.L}'`); },
        // Fix round 4 (review PORTAL3-r4 P2): ezCater evidence that never was a selection name (a special-request
        // note: the publisher's payload names the check, the retained names carry the house code only).
        S24: noteDual,
        S25: async c => { await noteDual(c); await ringS(c, 5, [c.code]); },
        S26: async c => { await noteDual(c); await ringS(c, 5, [c.code]); await pub(c, 5); },
      };
      // THE AXES (fix round 4): every EVIDENCE state of a dual-code check x every DECISION of the house order is a row.
      // The decision is taken first (on the check carrying both codes, the publisher skipped), then the evidence moves.
      {
        let n = 26;
        for (const decision of Object.keys(DECISION)) for (const evidence of Object.keys(EVIDENCE)) {
          if ((decision === 'none' || decision === 'not_a_match') && evidence === 'present') continue; // S02, S03
          build[`S${++n}`] = async c => { await DECISION[decision](c); await EVIDENCE[evidence](c); };
          axes[`S${n}`] = { evidence, decision };
        }
      }
      if (process.env.K_DUMP) console.log(JSON.stringify(axes));
      else {
        check(table.map(r => r.id).join() === Object.keys(build).join(), `K: the table and the harness name the same rows (${table.map(r => r.id)})`);
        for (const row of table) check(JSON.stringify(row.axes ?? null) === JSON.stringify(axes[row.id] ?? null), `K ${row.id}: the row's axes are the harness's (${JSON.stringify(axes[row.id])})`);
        const combos = new Set(Object.values(axes).filter(a => a.evidence in EVIDENCE).map(a => `${a.evidence}|${a.decision}`));
        check(combos.size === Object.keys(EVIDENCE).length * Object.keys(DECISION).length, `K: every evidence x decision combination is a row (${combos.size})`);
      }
      const holders = async (c) => JSON.stringify([await owners(c.order, c.chk), await ezLinks(db, `and check_guid = '${c.chk}'`)]);
      const attempt = async (c, kind) => {
        const before = await holders(c);
        await db.exec('begin'); let answer = 'ok';
        try {
          await act(c, kind);
          if (kind === 'not_a_match') check(await holders(c) === before, `K ${c.order}: an accepted "not a match" moves no ownership`);
        } catch (e) { answer = String(e.message); }
        await db.exec('rollback');
        return answer;
      };
      const rowsToRun = process.env.K_DUMP ? Object.keys(build).map(k => table.find(r => r.id === k) ?? { id: k, sql: null }) : table;
      for (const [n, row] of rowsToRun.entries()) {
        const c = ctx(n + 1);
        const ledgerBefore = Number((await one(db, `select count(*) n from catering_toast_conflicts`)).n);
        await build[row.id](c);
        const p = await planRow(c.L, c.chk, c.d, c.d);
        const e = (await ended(c.L)).find(x => x.check_guid === c.chk);
        const actual = {
          planner: p ? { owner: p.owner === 'house' ? (p.owner_lead_id === c.L ? 'this' : 'other_house') : p.owner ?? 'nobody', dual_code: p.dual_code, blocked: p.blocked } : null,
          list: (await one(db, `select status from catering_reconciliation_status where lead_id = $1 and location_id = $2`, [c.L, SHOP]))?.status ?? 'absent',
          conflict: c.ez ? (await conflictsOf(c.ez.order)).find(x => x.check_guid === c.chk)?.kind ?? null : null,
          linked: Number((await one(db, `select count(*) n from catering_toast_links where is_current and lead_id = $1 and check_guid = $2`, [c.L, c.chk])).n) === 1,
          ended: e ? e.owner ?? 'nobody' : null,
          checkLive: (await one(db, `select catering_toast_check_live($1, $2, $3) v`, [SHOP, c.order, c.chk])).v,
          // Is the check's day inside the order's window (the day before to a week after its event)?
          window: (await one(db, `select coalesce((select t.business_date between p.event_date - 1 and p.event_date + 7
            from toast_orders_latest t, catering_pipeline p where t.location_id = $1 and t.order_guid = $2 and p.id = $3), false) v`, [SHOP, c.order, c.L])).v,
          link: await attempt(c, 'link'),
          not_a_match: await attempt(c, 'not_a_match'),
        };
        if (process.env.K_DUMP) console.log(`${JSON.stringify(row.sql) === JSON.stringify(actual) ? 'same' : 'DIFF'} ${row.id} ${JSON.stringify(actual)}`);
        else check(JSON.stringify(actual) === JSON.stringify(row.sql), `K ${row.id} (${row.lead} | ${row.check} | ${row.owner}): expected ${JSON.stringify(row.sql)}, got ${JSON.stringify(actual)}`);
        // The ledger is history: a conflict that stops showing is never deleted.
        check(Number((await one(db, `select count(*) n from catering_toast_conflicts`)).n) >= ledgerBefore, `K ${row.id}: the ledger only grows`);
        const two = await one(db, `select count(*)::int n from catering_toast_links h where h.is_current and exists (select 1 from ezcater_toast_links z
          where z.is_current and z.location_id = h.location_id and z.order_guid = h.order_guid and z.check_guid = h.check_guid)`);
        check(two.n === 0, `K ${row.id}: no check has two owners`);
      }
    }
  }

  // H. The publisher guard never raises: break its helper inside a transaction; the row passes through.
  await db.exec('begin');
  await db.exec(`alter view catering_toast_decision_heads rename to catering_toast_decision_heads_gone`);
  await db.query(`insert into ezcater_toast_links(order_id, snapshot_id, location_id, toast_snapshot_id, order_guid, check_guid, selection_guid, business_date, evidence)
    values ($1, $2, $3, $4, 'D1', 'D1c', 'D1c-s9', '2026-11-20', 'normalized_code')`, [EO1, id('3200', 1), SHOP, id('5000', 11)]);
  check((await ezLinks(db, `and selection_guid = 'D1c-s9'`)).length === 1, 'a guard that cannot decide passes the row (today\'s behaviour), never raises');
  await db.exec('rollback');

  console.log(`sql-harness-0347: ${checks} checks passed`);
}

// Run only when invoked directly: scripts/sql-harness-0348.mjs imports the setup and helpers above.
if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exit(1); });
