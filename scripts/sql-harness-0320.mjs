/** Offline 0320 proof (W15: B022 pointer move, B083 stale source, B084 apply-now + the instance guard,
 * B085 the Phase 2 universe). Only ephemeral in-memory PGlite; no credentials or network.
 * PGlite has one backend, so the lineage lock's presence is structural here; the two-session proof
 * lives in scripts/sim/checklist-0320-lineage-lock-check-management.mjs (sim only, not run by CI).
 */
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFileSync(`supabase/migrations/${name}`, 'utf8');
const MIGRATION = read('0320_checklist_publish_activation.sql');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const SHOP = id(1), OTHER = id(2), ACTOR = id(3);
const V1 = id(10), V2 = id(11), V3 = id(12), PREP = id(13), OTHER_LIST = id(14), OTHER_SHOP_V1 = id(15);
const C1 = id(20), C2 = id(21), C1_V2 = id(22), C2_V2 = id(23), C1_V3 = id(24), OTHER_ITEM = id(25), OTHER_SHOP_ITEM = id(26);
const FRIDGE = id(30), FRIDGE_OTHER = id(31);
const TODAY = '2026-11-15', TOMORROW = '2026-11-16';
let checks = 0;
function check(ok, message) { checks++; if (!ok) throw new Error(message); }

function extract(file, start, end) {
  const src = read(file).replace(/\r\n/g, '\n');
  const i = src.indexOf(start);
  const j = src.indexOf(end, i);
  if (i < 0 || j < 0) throw new Error(`extract ${start} from ${file}`);
  return src.slice(i, j + end.length);
}

async function setup({ submitBody } = {}) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges grant execute on functions to anon, authenticated;
    create table locations(id uuid primary key, code text, name text);
    create table users(id uuid primary key, name text, role text, active boolean default true);
    create table user_locations(user_id uuid, location_id uuid);
    create table checklist_templates(id uuid primary key, location_id uuid not null, type text not null, name text not null,
      prep_subtype text, active boolean not null default true, effective_from date,
      supersedes_template_id uuid references checklist_templates(id), created_at timestamptz not null default now());
    create unique index checklist_templates_active_name_ef_uk on checklist_templates
      (location_id, type, name, (coalesce(prep_subtype, '')), effective_from) where active;
    create table checklist_template_items(id uuid primary key, template_id uuid not null references checklist_templates,
      label text, active boolean not null default true, prep_meta jsonb);
    create table checklist_instances(id uuid primary key default gen_random_uuid(), template_id uuid not null references checklist_templates,
      location_id uuid not null, date date not null, status text not null default 'open',
      allows_multiple_per_day boolean not null default false, confirmed_at timestamptz, confirmed_by uuid);
    create unique index checklist_instances_single_per_day_key on checklist_instances (template_id, location_id, date)
      where not allows_multiple_per_day;
    create table maintenance_equipment(id uuid primary key, location_id uuid not null, kind text not null,
      opening_temp_item_id uuid references checklist_template_items(id), closing_temp_item_id uuid references checklist_template_items(id),
      active boolean not null default true);
    create table checklist_completions(id uuid primary key default gen_random_uuid(), instance_id uuid not null references checklist_instances,
      template_item_id uuid not null references checklist_template_items, completed_by uuid, completed_at timestamptz default now(),
      prep_data jsonb, superseded_at timestamptz, revoked_at timestamptz);
    create table checklist_submissions(id uuid primary key default gen_random_uuid(), instance_id uuid, submitted_by uuid,
      submitted_at timestamptz, completion_ids uuid[], is_final_confirmation boolean);
    create table notifications(id uuid primary key default gen_random_uuid(), type text, category text, priority text, title text,
      body text, data jsonb, related_table text, related_id uuid, location_id uuid, created_by uuid);
    create table notification_recipients(notification_id uuid, user_id uuid, delivery_method text, delivery_status text);
    grant all on all tables in schema public to service_role;
    grant select, insert on checklist_instances to authenticated;
    grant select on checklist_templates to authenticated;
    insert into locations values ('${SHOP}', 'A', 'Shop A'), ('${OTHER}', 'B', 'Shop B');
    insert into users values ('${ACTOR}', 'Opener', 'key_holder', true);
    insert into checklist_templates(id, location_id, type, name, prep_subtype, active, effective_from, created_at) values
      ('${V1}', '${SHOP}', 'closing', 'Closing', null, true, '2026-01-01', '2026-01-01T00:00:00Z'),
      ('${PREP}', '${SHOP}', 'prep', 'AM Prep', 'am_prep', true, '2026-01-01', '2026-01-01T00:00:00Z'),
      ('${OTHER_LIST}', '${SHOP}', 'closing', 'Deep clean', null, true, '2026-01-01', '2026-01-01T00:00:00Z'),
      ('${OTHER_SHOP_V1}', '${OTHER}', 'closing', 'Closing', null, true, '2026-01-01', '2026-01-01T00:00:00Z');
    insert into checklist_template_items(id, template_id, label) values
      ('${C1}', '${V1}', 'Fridge 1 temp'), ('${C2}', '${V1}', 'Wipe slicer'),
      ('${OTHER_ITEM}', '${OTHER_LIST}', 'x'), ('${OTHER_SHOP_ITEM}', '${OTHER_SHOP_V1}', 'Fridge B temp');
    insert into maintenance_equipment values
      ('${FRIDGE}', '${SHOP}', 'fridge', null, '${C1}', true),
      ('${FRIDGE_OTHER}', '${OTHER}', 'fridge', null, '${OTHER_SHOP_ITEM}', true);`);
  await db.exec(extract('0056_create_submit_phase2_atomic_rpc.sql', 'CREATE OR REPLACE FUNCTION public.opening_phase2_compute_delta(', '$function$;'));
  await db.exec(submitBody ?? extract('0255_under_par_alert_recipients.sql', 'CREATE OR REPLACE FUNCTION public.submit_phase2_atomic(', '$function$;'));
  await db.exec(`revoke execute on function public.submit_phase2_atomic(uuid, uuid, boolean, uuid, text, text) from public, anon, authenticated;
    grant execute on function public.submit_phase2_atomic(uuid, uuid, boolean, uuid, text, text) to service_role;`);
  return db;
}

async function refuses(db, run, expected) {
  await db.exec('savepoint refusal');
  let error;
  try { await run(); } catch (e) { error = e; }
  await db.exec('rollback to savepoint refusal');
  check(error && (error.message === expected || error.code === expected),
    `expected ${expected}, got ${error ? `${error.code} ${error.message}` : 'success'}`);
}
async function isolated(db, run) {
  await db.exec('begin');
  try { await db.exec('set local role service_role'); await run(); } finally { await db.exec('rollback'); }
}
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const activate = (db, source, fresh, applyNow, map, today = TODAY) => db.query(
  'select public.checklist_template_activate_version($1, $2, $3, $4, $5::date, $6::jsonb) as r',
  [ACTOR, source, fresh, applyNow, today, JSON.stringify(map)]).then(r => r.rows[0].r);
async function mint(db, newId, source, effectiveFrom, items) {
  await db.query(`insert into checklist_templates(id, location_id, type, name, prep_subtype, active, effective_from, supersedes_template_id, created_at)
    select $1, location_id, type, name, prep_subtype, false, $3::date, id, now() + interval '1 second' from checklist_templates where id = $2`, [newId, source, effectiveFrom]);
  for (const [itemId, label] of items) await db.query('insert into checklist_template_items(id, template_id, label) values ($1, $2, $3)', [itemId, newId, label]);
}
const activeIds = async db => (await db.query(`select id from checklist_templates where location_id = $1 and type = 'closing' and name = 'Closing' and active order by id`, [SHOP])).rows.map(r => r.id);

async function main() {
  // ── 0. Before 0320: the B085 bug is real on the 0255 body ─────────────────────────────────────────────
  {
    const db = await setup();
    await db.exec(`insert into checklist_templates(id, location_id, type, name, active, effective_from) values ('${id(40)}', '${SHOP}', 'opening', 'Opening', true, '2026-01-01');
      insert into checklist_template_items(id, template_id, label, prep_meta) values
        ('${id(41)}', '${id(40)}', 'Tuna', '{"openingPhase2": true}'), ('${id(42)}', '${id(40)}', 'Late mirror', '{"openingPhase2": true}');
      insert into checklist_instances(id, template_id, location_id, date, status) values ('${id(43)}', '${id(40)}', '${SHOP}', '${TODAY}', 'phase1_complete');
      insert into checklist_completions(instance_id, template_item_id, completed_by, prep_data) values
        ('${id(43)}', '${id(41)}', '${ACTOR}', '{"phase1": {"prep_need": 2, "par_value": 4}}'),
        ('${id(43)}', '${id(41)}', '${ACTOR}', '{"phase2": {"opener_prepped": 2}}');`);
    await isolated(db, async () => refuses(db, () => db.query(`select public.submit_phase2_atomic('${id(43)}', '${ACTOR}')`),
      'submit_phase2_atomic: phase2_incomplete — 1 Phase 2 universe item(s) have no live completion'));
    await db.close();
  }

  // ── 1. Pre-flight refuses a submit_phase2_atomic body that is not 0255's (W14 / 0315 rebase guard) ────
  {
    const moved = extract('0255_under_par_alert_recipients.sql', 'CREATE OR REPLACE FUNCTION public.submit_phase2_atomic(', '$function$;')
      .replace('  -- ──── Completeness over the Model Y universe ────', '  PERFORM 1 FROM checklist_instances WHERE id = p_opening_instance_id FOR NO KEY UPDATE;\n  -- ──── Completeness over the Model Y universe ────');
    const db = await setup({ submitBody: moved });
    let error;
    try { await db.exec(MIGRATION); } catch (e) { error = e; await db.exec('rollback'); }
    check(/re-base section D/.test(error?.message ?? ''), `0320 must refuse a moved submit_phase2_atomic, got ${error?.message ?? 'success'}`);
    check(!(await one(db, `select to_regprocedure('public.checklist_template_activate_version(uuid,uuid,uuid,boolean,date,jsonb)') is not null as p`)).p,
      'a refused 0320 leaves nothing behind');
    await db.close();
  }

  const db = await setup();
  await db.exec(MIGRATION);
  await db.exec(MIGRATION); // idempotent: a second run re-creates the same objects and still verifies

  // ── 2. Ceilings ────────────────────────────────────────────────────────────────────────────────────────
  for (const f of ['public.checklist_lineage_lock_key(uuid)', 'public.checklist_template_activate_version(uuid,uuid,uuid,boolean,date,jsonb)',
    'public.checklist_instance_lineage_guard()', 'public.submit_phase2_atomic(uuid,uuid,boolean,uuid,text,text)']) {
    const r = await one(db, `select has_function_privilege('anon', $1, 'execute') a, has_function_privilege('authenticated', $1, 'execute') u,
      has_function_privilege('service_role', $1, 'execute') s, (select prosecdef from pg_proc where oid = to_regprocedure($1)) d`, [f]);
    check(!r.a && !r.u && r.d, `${f}: definer, no anon/authenticated EXECUTE`);
    check(r.s === !/lock_key|lineage_guard/.test(f), `${f}: service_role EXECUTE only on the RPCs`);
  }
  for (const f of ['checklist_template_activate_version', 'checklist_instance_lineage_guard']) {
    check((await one(db, `select prosrc ~ 'pg_advisory_xact_lock\\(public\\.checklist_lineage_lock_key' x from pg_proc where proname = $1`, [f])).x,
      `${f} takes the shared lineage key`);
  }

  // ── 3. next_day activation moves the fridge pointer (B022) and keeps today's version ──────────────────
  await isolated(db, async () => {
    await mint(db, V2, V1, TOMORROW, [[C1_V2, 'Fridge 1 temp'], [C2_V2, 'Wipe slicer']]);
    const r = await activate(db, V1, V2, false, { [C1]: C1_V2, [C2]: C2_V2 });
    check(JSON.stringify(await activeIds(db)) === JSON.stringify([V1, V2].sort()), 'next_day keeps V1 serving today and activates V2');
    check(r.retired.length === 0 && r.currently_effective === V1 && r.pointers_moved === 1, `next_day result ${JSON.stringify(r)}`);
    check((await one(db, 'select closing_temp_item_id x from maintenance_equipment where id = $1', [FRIDGE])).x === C1_V2, 'pointer moved to the copy');
    check((await one(db, 'select closing_temp_item_id x from maintenance_equipment where id = $1', [FRIDGE_OTHER])).x === OTHER_SHOP_ITEM, 'other shop untouched');

    // B083: publishing again from V1 (no longer the head: V2 is pending) is refused; nothing moves.
    await mint(db, V3, V1, TOMORROW, [[C1_V3, 'Fridge 1 temp']]);
    await refuses(db, () => activate(db, V1, V3, false, { [C1]: C1_V3 }), 'stale_source');
    check(JSON.stringify(await activeIds(db)) === JSON.stringify([V1, V2].sort()), 'stale publish retired nothing');
    check((await one(db, 'select closing_temp_item_id x from maintenance_equipment where id = $1', [FRIDGE])).x === C1_V2, 'stale publish moved no pointer');
  });

  // ── 4. Re-publishing the pending head replaces it (pending_replaced), V1 still serves today ───────────
  await isolated(db, async () => {
    await mint(db, V2, V1, TOMORROW, [[C1_V2, 'Fridge 1 temp']]);
    await activate(db, V1, V2, false, { [C1]: C1_V2 });
    await mint(db, V3, V2, TOMORROW, [[C1_V3, 'Fridge 1 temp']]);
    const r = await activate(db, V2, V3, false, { [C1_V2]: C1_V3 });
    check(r.retired.length === 1 && r.retired[0].id === V2 && r.retired[0].publish_op === 'pending_replaced', `pending replaced ${JSON.stringify(r)}`);
    check(JSON.stringify(await activeIds(db)) === JSON.stringify([V1, V3].sort()), 'V1 + V3 active');
    check((await one(db, 'select closing_temp_item_id x from maintenance_equipment where id = $1', [FRIDGE])).x === C1_V3, 'pointer followed to V3');
  });

  // ── 5. apply_now: refused when ANY lineage version has an instance today (B084); else V1 superseded ───
  await isolated(db, async () => {
    await mint(db, V2, V1, TODAY, [[C1_V2, 'Fridge 1 temp']]);
    await db.query(`insert into checklist_instances(template_id, location_id, date) values ($1, $2, $3)`, [V1, SHOP, TODAY]);
    await refuses(db, () => activate(db, V1, V2, true, { [C1]: C1_V2 }), 'apply_now_blocked_open_instance');
    check(JSON.stringify(await activeIds(db)) === JSON.stringify([V1]), 'a refused apply-now leaves V1 active and V2 inactive');
    check((await one(db, 'select closing_temp_item_id x from maintenance_equipment where id = $1', [FRIDGE])).x === C1, 'a refused activation leaves the pointer');
  });
  await isolated(db, async () => {
    await mint(db, V2, V1, TODAY, [[C1_V2, 'Fridge 1 temp']]);
    const r = await activate(db, V1, V2, true, { [C1]: C1_V2 });
    check(JSON.stringify(await activeIds(db)) === JSON.stringify([V2]), 'apply-now retires V1 and activates V2 in one transaction');
    check(r.retired.length === 1 && r.retired[0].id === V1 && r.retired[0].publish_op === 'superseded', `apply-now result ${JSON.stringify(r)}`);
  });

  // ── 6. Named refusals ────────────────────────────────────────────────────────────────────────────────
  await isolated(db, async () => {
    await mint(db, V2, V1, TOMORROW, [[C1_V2, 'Fridge 1 temp']]);
    await refuses(db, () => activate(db, V1, V2, false, { [OTHER_ITEM]: C1_V2 }), 'item_map_invalid');
    await refuses(db, () => activate(db, V1, V2, false, { [C1]: OTHER_ITEM }), 'item_map_invalid');
    await refuses(db, () => activate(db, V1, V2, false, { [C1]: 'not-a-uuid' }), 'item_map_invalid');
    await refuses(db, () => activate(db, V1, V2, false, []), 'item_map_invalid');
    check(JSON.stringify(await activeIds(db)) === JSON.stringify([V1]), 'a bad map aborts the activation too');
    await refuses(db, () => activate(db, OTHER_LIST, V2, false, {}), 'version_not_activatable');
    await refuses(db, () => activate(db, PREP, V2, false, {}), 'type_not_publishable');
    await refuses(db, () => activate(db, id(99), V2, false, {}), 'template_not_found');
    await db.query('update checklist_templates set active = true where id = $1', [V2]);
    await refuses(db, () => activate(db, V1, V2, false, {}), 'version_not_activatable');
  });

  // ── 7. The instance guard (B084): one instance per lineage per shop per day ────────────────────────────
  await isolated(db, async () => {
    await mint(db, V2, V1, TODAY, []);
    await db.query('update checklist_templates set active = true where id = $1', [V2]);
    await db.query('insert into checklist_instances(template_id, location_id, date) values ($1, $2, $3)', [V1, SHOP, TODAY]);
    await refuses(db, () => db.query('insert into checklist_instances(template_id, location_id, date) values ($1, $2, $3)', [V2, SHOP, TODAY]),
      'checklist_instance_lineage_taken');
    await refuses(db, () => db.query('insert into checklist_instances(template_id, location_id, date) values ($1, $2, $3)', [V1, SHOP, TODAY]), '23505');
    const conflict = await db.query(`insert into checklist_instances(template_id, location_id, date) values ($1, $2, $3)
      on conflict (template_id, location_id, date) where not allows_multiple_per_day do nothing returning id`, [V1, SHOP, TODAY]);
    check(conflict.rows.length === 0, 'the same-template ON CONFLICT path still resolves to the existing row');
    await db.query('insert into checklist_instances(template_id, location_id, date) values ($1, $2, $3)', [V2, SHOP, TOMORROW]);
    await db.query('insert into checklist_instances(template_id, location_id, date) values ($1, $2, $3)', [OTHER_LIST, SHOP, TODAY]);
    await db.query('insert into checklist_instances(template_id, location_id, date) values ($1, $2, $3)', [OTHER_SHOP_V1, OTHER, TODAY]);
    await db.query('insert into checklist_instances(template_id, location_id, date) values ($1, $2, $3)', [PREP, SHOP, TODAY]);
    await db.query('insert into checklist_instances(template_id, location_id, date, allows_multiple_per_day) values ($1, $2, $3, true), ($1, $2, $3, true)', [PREP, SHOP, TODAY]);
    check((await one(db, `select count(*)::int n from checklist_instances where template_id = $1 and allows_multiple_per_day`, [PREP])).n === 2,
      'mid-day prep (allows_multiple_per_day) is unaffected');
  });
  // The guard runs for a staff-role insert too (definer body; the inserting role needs no EXECUTE).
  await db.exec('begin');
  try {
    await db.exec('set local role authenticated');
    await db.query('insert into checklist_instances(template_id, location_id, date) values ($1, $2, $3)', [V1, SHOP, '2026-11-20']);
    check((await one(db, `select count(*)::int n from checklist_instances where date = '2026-11-20'`)).n === 1, 'a staff-role insert passes the guard');
  } finally { await db.exec('rollback'); }
  await isolated(db, async () => {
    await mint(db, V2, V1, TODAY, []);
    await db.query('update checklist_templates set active = true where id = $1', [V2]);
    await db.query('insert into checklist_instances(template_id, location_id, date) values ($1, $2, $3)', [V1, SHOP, '2026-11-21']);
    await db.exec('set local role authenticated');
    await refuses(db, () => db.query('insert into checklist_instances(template_id, location_id, date) values ($1, $2, $3)', [V2, SHOP, '2026-11-21']),
      'checklist_instance_lineage_taken');
  });

  // ── 8. B085: a mirror with no Phase 1 row on THIS instance is not in its Phase 2 universe ─────────────
  await isolated(db, async () => {
    const T = id(40), A = id(41), LATE = id(42), I = id(43), NO_P2 = id(44);
    await db.exec(`insert into checklist_templates(id, location_id, type, name, active, effective_from) values ('${T}', '${SHOP}', 'opening', 'Opening', true, '2026-01-01');
      insert into checklist_template_items(id, template_id, label, prep_meta) values
        ('${A}', '${T}', 'Tuna', '{"openingPhase2": true}'), ('${LATE}', '${T}', 'Late mirror', '{"openingPhase2": true}');
      insert into checklist_instances(id, template_id, location_id, date, status) values ('${I}', '${T}', '${SHOP}', '${TODAY}', 'phase1_complete');
      insert into checklist_completions(instance_id, template_item_id, completed_by, prep_data) values
        ('${I}', '${A}', '${ACTOR}', '{"phase1": {"prep_need": 2, "par_value": 4}}'),
        ('${I}', '${A}', '${ACTOR}', '{"phase2": {"opener_prepped": 2}}');`);
    const r = (await db.query(`select public.submit_phase2_atomic('${I}', '${ACTOR}') r`)).rows[0].r;
    check(r.completionIds.length === 1 && r.atParCount === 1, `finalize succeeds with the late mirror left out: ${JSON.stringify(r)}`);
    check((await one(db, 'select status from checklist_instances where id = $1', [I])).status === 'phase2_complete', 'finalized');
    // An item that WAS in Phase 1 but has no Phase 2 entry still blocks finalize.
    await db.exec(`insert into checklist_template_items(id, template_id, label, prep_meta) values ('${NO_P2}', '${T}', 'Bacon', '{"openingPhase2": true}');
      update checklist_instances set status = 'phase1_complete' where id = '${I}';
      insert into checklist_completions(instance_id, template_item_id, completed_by, prep_data) values ('${I}', '${NO_P2}', '${ACTOR}', '{"phase1": {"prep_need": 1}}');`);
    await refuses(db, () => db.query(`select public.submit_phase2_atomic('${I}', '${ACTOR}')`),
      'submit_phase2_atomic: phase2_incomplete — 1 Phase 2 universe item(s) have no live completion');
  });

  await db.close();
  console.log(`PASS 0320: ${checks} checks (ceilings, pointer move, stale source, apply-now, named refusals, instance guard, Phase 2 universe)`);
}

main().catch(e => { console.error(`FAIL 0320: ${e.message}`); process.exitCode = 1; });
