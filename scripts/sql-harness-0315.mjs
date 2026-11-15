/** Offline 0315 proof (audit W14). Only ephemeral in-memory PGlite; no credentials or network.
 *
 * Runs the REAL source functions (0056 delta helper, 0215 prep_batch_context / save / revoke,
 * 0255 finalize, 0228 author level, the three 0287 corrections, the 0203 drafts table) on a stub
 * schema, then the REAL 0315 file on top.
 *
 *   node scripts/sql-harness-0315.mjs                   the fixed behaviour, after 0315
 *   node scripts/sql-harness-0315.mjs --against-source  the bugs, reproduced on the source bodies
 *
 * PGlite has one backend, so lock PRESENCE and ORDER are structural here. Real blocking and the
 * winner / loser proof live in sim/opening-phase2-0315-lock-check-management.mjs (not run by CI).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const AGAINST_SOURCE = process.argv.includes('--against-source');
const read = name => readFileSync(`supabase/migrations/${name}`, 'utf8').replace(/\r\n/g, '\n');
const MIGRATION = read('0315_opening_counts_batch_prep.sql');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const opener = id(1), other = id(2), shop = id(3), openingTemplate = id(4), closingTemplate = id(5);
const batchItem = id(10), plainItem = id(11), batchTi = id(12), plainTi = id(13);
const recipe = id(14), opening = id(20), closing = id(21);
const trackTi = id(30), plainClosingTi = id(31), reportRefTi = id(32), danglingTrackTi = id(33);
const trackDone = id(40), plainDone = id(41), reportDone = id(42), danglingDone = id(43);
const tabA = id(900), tabB = id(901);
let checks = 0;
function check(ok, message) { checks++; if (!ok) throw new Error(message); }
const q = v => v === null ? 'null' : `'${String(v).replaceAll("'", "''")}'`;
const fingerprint = body => createHash('md5').update(body.replace(/[^\x21-\x7E]+/g, ''), 'utf8').digest('hex');

function grab(source, pattern, label) {
  const found = source.match(pattern)?.[0];
  if (!found) throw new Error(`source extraction failed: ${label}`);
  return found;
}

async function setup({ apply = !AGAINST_SOURCE } = {}) {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      grant usage on schema public to anon, authenticated, service_role;
      -- Simulate Supabase explicit defaults, not merely PostgreSQL's PUBLIC grant.
      alter default privileges grant execute on functions to anon, authenticated;
      create table locations(id uuid primary key, code text not null, name text);
      create table users(id uuid primary key, name text not null, role text not null, active boolean not null default true);
      create table user_locations(user_id uuid references users, location_id uuid references locations, active boolean default true);
      create table items(id uuid primary key);
      create table recipes(id uuid primary key, active boolean not null default true, recipe_type text not null default 'production',
        batch_mode boolean not null default false, created_at timestamptz default now());
      create table recipe_outputs(recipe_id uuid references recipes, output_item_id uuid references items, yield numeric);
      create table checklist_templates(id uuid primary key, location_id uuid references locations, type text, active boolean default true);
      create table checklist_template_items(id uuid primary key, template_id uuid references checklist_templates, label text,
        item_id uuid references items, active boolean not null default true, prep_meta jsonb, min_role_level integer default 3,
        report_reference_type text, ref_track_item_completion boolean, references_template_item_id uuid);
      create table checklist_instances(id uuid primary key, template_id uuid references checklist_templates,
        location_id uuid references locations, date date default current_date, status text not null default 'open',
        confirmed_at timestamptz, confirmed_by uuid references users);
      create table checklist_completions(id uuid primary key default gen_random_uuid(),
        instance_id uuid not null references checklist_instances, template_item_id uuid not null references checklist_template_items,
        completed_by uuid not null references users, completed_at timestamptz default now(), count_value numeric(10,2),
        photo_id uuid, notes text, prep_data jsonb, count_provenance text, superseded_at timestamptz,
        superseded_by uuid references checklist_completions, revoked_at timestamptz, revoked_by uuid references users,
        revocation_reason text check (revocation_reason in ('error_tap','not_actually_done','other','quick_reenter','re_enter_count')),
        revocation_note text, actual_completer_id uuid references users, auto_complete_meta jsonb);
      create unique index checklist_completions_one_live_head_per_phase on checklist_completions
        (instance_id, template_item_id, coalesce(prep_data ? 'phase2', false)) where superseded_at is null and revoked_at is null;
      create table checklist_submissions(id uuid primary key default gen_random_uuid(), instance_id uuid not null references checklist_instances,
        submitted_by uuid not null references users, submitted_at timestamptz default now(), completion_ids uuid[] not null,
        is_final_confirmation boolean default false);
      create table opening_closer_count_snapshots(id uuid primary key default gen_random_uuid(),
        opening_instance_id uuid not null references checklist_instances, template_item_id uuid not null references checklist_template_items,
        closer_count numeric, par_value numeric, par_unit text, line_count numeric, back_up_count numeric,
        unique (opening_instance_id, template_item_id));
      create table notifications(id uuid primary key default gen_random_uuid(), type text, category text, priority text, title text,
        body text, data jsonb, related_table text, related_id uuid, location_id uuid, created_by uuid);
      create table notification_recipients(notification_id uuid references notifications, user_id uuid references users,
        delivery_method text, delivery_status text);`);
    const s0215 = read('0215_batch_vs_bottle.sql');
    await db.exec(grab(s0215, /create table public\.prep_batch_sessions \([\s\S]*?\n\);/, 'prep_batch_sessions'));
    await db.exec(read('0203_opening_phase1_drafts.sql'));
    await db.exec(grab(read('0056_create_submit_phase2_atomic_rpc.sql'),
      /CREATE OR REPLACE FUNCTION public\.opening_phase2_compute_delta\([\s\S]*?\$function\$;/, 'compute_delta'));
    await db.exec(grab(s0215, /create or replace function public\.prep_batch_context\([\s\S]*?\$function\$;/, 'prep_batch_context'));
    await db.exec(grab(s0215, /CREATE OR REPLACE FUNCTION public\.save_phase2_item_atomic\([\s\S]*?\$function\$;/, 'save'));
    await db.exec(grab(s0215, /create or replace function public\.revoke_phase2_item_atomic\([\s\S]*?\$function\$;/, 'revoke'));
    await db.exec(grab(read('0255_under_par_alert_recipients.sql'),
      /CREATE OR REPLACE FUNCTION public\.submit_phase2_atomic\([\s\S]*?\$function\$;/, 'submit'));
    await db.exec(grab(read('0228_assignment_attribution.sql'), /create function public\.assignment_author_level[\s\S]*?end \$\$;/i, 'author level'));
    const s0287 = read('0287_checklist_corrections_serialized.sql');
    for (const name of ['checklist_revoke_completion', 'checklist_revoke_with_reason', 'checklist_mark_not_done']) {
      await db.exec(grab(s0287, new RegExp(`create function public\\.${name}\\([\\s\\S]*?end \\$\\$;`), name));
    }
    // The source migrations' own ceilings, so the fixture starts where prod is.
    await db.exec(`revoke all on all functions in schema public from public, anon, authenticated;
      grant execute on all functions in schema public to service_role;
      grant all on all tables in schema public to service_role;
      insert into locations values(${q(shop)}, 'SIM', 'Harness shop');
      insert into users(id, name, role) values(${q(opener)}, 'Opener', 'key_holder'), (${q(other)}, 'Lead', 'shift_lead');
      insert into user_locations values(${q(opener)}, ${q(shop)}, true), (${q(other)}, ${q(shop)}, true);
      insert into items values(${q(batchItem)}), (${q(plainItem)});
      insert into recipes(id, batch_mode) values(${q(recipe)}, true);
      insert into recipe_outputs values(${q(recipe)}, ${q(batchItem)}, 8);
      insert into checklist_templates values(${q(openingTemplate)}, ${q(shop)}, 'opening', true), (${q(closingTemplate)}, ${q(shop)}, 'closing', true);
      insert into checklist_template_items(id, template_id, label, item_id, prep_meta) values
        (${q(batchTi)}, ${q(openingTemplate)}, 'Hot Peppers', ${q(batchItem)}, '{"openingPhase2":"true"}'),
        (${q(plainTi)}, ${q(openingTemplate)}, 'Sliced Onion', ${q(plainItem)}, '{"openingPhase2":"true"}');
      insert into checklist_template_items(id, template_id, label, report_reference_type, ref_track_item_completion, references_template_item_id) values
        (${q(trackTi)}, ${q(closingTemplate)}, 'Tracks: Hot Peppers', null, true, ${q(batchTi)}),
        (${q(plainClosingTi)}, ${q(closingTemplate)}, 'Sweep the floor', null, false, null),
        (${q(reportRefTi)}, ${q(closingTemplate)}, 'Cash report', 'cash_report', false, null),
        (${q(danglingTrackTi)}, ${q(closingTemplate)}, 'Tracking flag, no target', null, true, null);
      insert into checklist_instances(id, template_id, location_id, status) values
        (${q(opening)}, ${q(openingTemplate)}, ${q(shop)}, 'phase1_complete'), (${q(closing)}, ${q(closingTemplate)}, ${q(shop)}, 'open');
      -- Last night: LINE 6, BACK UP left BLANK (TOTAL 6), par 8 → the opener verifies without a recount.
      insert into opening_closer_count_snapshots(opening_instance_id, template_item_id, closer_count, par_value, par_unit, line_count, back_up_count) values
        (${q(opening)}, ${q(batchTi)}, 6, 8, 'Bottle', 6, null), (${q(opening)}, ${q(plainTi)}, 3, 5, 'Pan', null, null);
      insert into checklist_completions(instance_id, template_item_id, completed_by, prep_data, count_provenance) values
        (${q(opening)}, ${q(batchTi)}, ${q(opener)}, '{"phase1":{"closer_count":6,"spot_check_status":"verified","ground_truth_count":6,"prep_need":2,"par_value":8}}', 'closer_captured'),
        (${q(opening)}, ${q(plainTi)}, ${q(opener)}, '{"phase1":{"closer_count":3,"spot_check_status":"verified","ground_truth_count":3,"prep_need":2,"par_value":5}}', 'closer_captured');
      insert into checklist_completions(id, instance_id, template_item_id, completed_by, completed_at, auto_complete_meta) values
        (${q(trackDone)}, ${q(closing)}, ${q(trackTi)}, ${q(opener)}, now() - interval '1 hour', '{"refTrack":true}'),
        (${q(plainDone)}, ${q(closing)}, ${q(plainClosingTi)}, ${q(opener)}, now() - interval '1 hour', null),
        (${q(reportDone)}, ${q(closing)}, ${q(reportRefTi)}, ${q(opener)}, now() - interval '1 hour', null),
        (${q(danglingDone)}, ${q(closing)}, ${q(danglingTrackTi)}, ${q(opener)}, now() - interval '1 hour', null);
      -- Each attempt is rolled back, so every case starts from the identical fixture.
      create function public.test_attempt(p_sql text) returns text language plpgsql security invoker as $$
      begin execute p_sql; raise sqlstate 'ZX001';
      exception when sqlstate 'ZX001' then return 'allowed'; when others then return sqlstate || ':' || sqlerrm; end $$;
      grant execute on function public.test_attempt(text) to service_role;`);
    if (apply) await db.exec(MIGRATION);
    return db;
  } catch (e) { await db.close(); throw e; }
}

const attempt = async (db, sql) => (await db.query('select public.test_attempt($1) as result', [sql])).rows[0].result;
async function expectRefusal(db, sql, needle, label) {
  const actual = await attempt(db, sql);
  check(actual.startsWith('P0001:') && actual.includes(needle), `${label}: expected ${needle}, got ${actual}`);
}
/** Run inside a transaction that is always rolled back; `change` mutates the fixture first. */
async function isolated(db, change, run) {
  await db.exec('begin');
  try { if (change) await db.exec(change); await db.exec('set local role service_role'); return await run(); }
  finally { await db.exec('rollback'); }
}
const one = async (db, sql) => (await db.query(sql)).rows[0];

const batchPayload = '{"batches":1,"came_out_to":8}';
const saveBatch = (bottled = 2, payload = batchPayload, under = 'null') =>
  `select public.save_phase2_item_atomic(${q(opening)},${q(opener)},${q(batchTi)},${bottled},null,${under},null,null,${q(payload)}::jsonb) as result`;
const savePlain = (prepped = 2) =>
  `select public.save_phase2_item_atomic(${q(opening)},${q(opener)},${q(plainTi)},${prepped},null,null,null,null,null) as result`;
const revoke = (completion, instance = opening) =>
  `select public.revoke_phase2_item_atomic(${q(instance)},${q(completion)},${q(opener)},'quick_reenter',null) as result`;
const finalize = `select public.submit_phase2_atomic(${q(opening)},${q(opener)}) as result`;
const draft = (seq, tab = tabA, body = `{"version":1,"n":${seq ?? 0}}`, instance = opening, location = shop) =>
  `select public.save_opening_phase1_draft(${q(instance)},${q(location)},${q(body)}::jsonb,${q(opener)},${q(tab)},${seq === null ? 'null' : seq}) as result`;
const corrections = (completion) => ({
  quick: `select public.checklist_revoke_completion(${q(completion)},${q(opener)})`,
  reason: `select public.checklist_revoke_with_reason(${q(completion)},${q(opener)},'other','a correction')`,
  authority: `select public.checklist_mark_not_done(${q(completion)},${q(other)},'not done')`,
});
const fnDef = async (db, sig) => (await one(db, `select lower(pg_get_functiondef(${q(sig)}::regprocedure)) as d`)).d.replace(/--[^\n]*/g, '');
const SIGS = {
  save: 'public.save_phase2_item_atomic(uuid,uuid,uuid,numeric,jsonb,jsonb,text,text,jsonb)',
  revoke: 'public.revoke_phase2_item_atomic(uuid,uuid,uuid,text,text)',
  submit: 'public.submit_phase2_atomic(uuid,uuid,boolean,uuid,text,text)',
  quick: 'public.checklist_revoke_completion(uuid,uuid)',
  reason: 'public.checklist_revoke_with_reason(uuid,uuid,text,text)',
  authority: 'public.checklist_mark_not_done(uuid,uuid,text)',
  draft: 'public.save_opening_phase1_draft(uuid,uuid,jsonb,uuid,uuid,bigint)',
};

// ── The bugs, reproduced on the source bodies (0215 / 0255 / 0287) ─────────────────────────
async function reproduce(db) {
  await isolated(db, '', async () => {
    await expectRefusal(db, saveBatch(), 'backup_unknown', 'B020 source');
  });
  console.log('BEFORE 0315 B020: a blank BACK UP with a known LINE raises backup_unknown — the batch row can never save');
  await isolated(db, '', async () => {
    const saved = (await one(db, savePlain())).result;
    await db.exec(`update checklist_instances set status='phase2_complete' where id=${q(opening)}`);
    const revoked = (await one(db, revoke(saved.completionId))).result;
    check(revoked.completion.revoked_at !== null, 'source revoke ignores the instance status');
  });
  console.log('BEFORE 0315 B080: an Undo commits on a FINALIZED opening (no status check, no instance lock)');
  for (const key of ['save', 'revoke', 'submit']) check(!(await fnDef(db, SIGS[key])).includes('for no key update'), `${key} source has no instance lock`);
  const src = await fnDef(db, SIGS.revoke);
  check(src.indexOf('update checklist_completions') < src.indexOf('from prep_batch_sessions'), 'source revoke updates the completion before locking the session');
  console.log('BEFORE 0315 B181: revoke updates the completion THEN locks the session (the save does the opposite)');
  await isolated(db, '', async () => {
    for (const [name, call] of Object.entries(corrections(trackDone))) {
      if (name === 'quick') continue; // the fixture row is an hour old
      check(await attempt(db, call) === 'allowed', `source ${name} accepts an item-tracking tick`);
    }
  });
  console.log('BEFORE 0315 B182: a generic correction revokes an item-tracking tick');
  check((await one(db, `select to_regprocedure(${q(SIGS.draft)}) is null as missing`)).missing, 'no draft writer before 0315');
  console.log('BEFORE 0315 B078: opening_phase1_drafts has no revision and no ordered writer');
  console.log(`PASS 0315 --against-source: ${checks} checks reproduce the bugs on the 0215 / 0255 / 0287 bodies`);
}

// ── After 0315 ─────────────────────────────────────────────────────────────────────────────
async function guards() {
  // A second run is a no-op (the pre-flight accepts this file's own bodies).
  const db = await setup();
  try {
    await db.exec(MIGRATION);
    // The fingerprint JS computes over the file is the one Postgres computes over the catalog.
    const starts = {
      save: ['CREATE OR REPLACE FUNCTION public.save_phase2_item_atomic(', '$function$'],
      revoke: ['create or replace function public.revoke_phase2_item_atomic(', '$function$'],
      submit: ['CREATE OR REPLACE FUNCTION public.submit_phase2_atomic(', '$function$'],
      quick: ['create or replace function public.checklist_revoke_completion(', '$$'],
      reason: ['create or replace function public.checklist_revoke_with_reason(', '$$'],
      authority: ['create or replace function public.checklist_mark_not_done(', '$$'],
      draft: ['create or replace function public.save_opening_phase1_draft(', '$$'],
    };
    for (const [key, [start, tag]] of Object.entries(starts)) {
      const at = MIGRATION.indexOf(start);
      const open = MIGRATION.indexOf(tag, at) + tag.length;
      const body = MIGRATION.slice(open, MIGRATION.indexOf(tag, open));
      const live = (await one(db, `select md5(regexp_replace(prosrc, '[^\\x21-\\x7E]+', '', 'g')) as h from pg_proc where oid=${q(SIGS[key])}::regprocedure`)).h;
      check(live === fingerprint(body), `${key}: catalog fingerprint ${live} differs from the file's`);
      check(MIGRATION.includes(`'${live}'`), `${key}: the file does not carry its own fingerprint`);
    }
  } finally { await db.close(); }
  // A later definer this file does not know refuses the apply, and nothing is changed.
  const drifted = await setup({ apply: false });
  try {
    const def = (await one(drifted, `select pg_get_functiondef(${q(SIGS.submit)}::regprocedure) as d`)).d;
    await drifted.exec(def.replace('BEGIN', 'BEGIN\n  PERFORM 1; -- a later definer'));
    let message = '';
    try { await drifted.exec(MIGRATION); } catch (e) { message = String(e.message); }
    check(/0315: the live body of public\.submit_phase2_atomic.*a later definer exists/.test(message), `drift refusal, got: ${message}`);
    try { await drifted.exec('rollback'); } catch { /* the failed apply left its transaction open */ }
    check((await one(drifted, `select to_regprocedure(${q(SIGS.draft)}) is null as missing`)).missing, 'a refused apply creates nothing');
    check((await one(drifted, `select count(*)::int as n from information_schema.columns where table_name='opening_phase1_drafts' and column_name='client_seq'`)).n === 0, 'a refused apply adds no column');
  } finally { await drifted.close(); }
  const missing = await setup({ apply: false });
  try {
    await missing.exec(`drop function ${SIGS.revoke}`);
    let message = '';
    try { await missing.exec(MIGRATION); } catch (e) { message = String(e.message); }
    check(/0315: public\.revoke_phase2_item_atomic.* is missing \(0215 must be applied first\)/.test(message), `missing-source refusal, got: ${message}`);
  } finally { await missing.close(); }
  console.log('0315 guards: re-run is a no-op; catalog fingerprints equal the file; a later definer and a missing source refuse');
}

async function blankBackup(db) {
  await isolated(db, '', async () => {
    const result = (await one(db, saveBatch())).result;
    const batch = result.completion.prep_data.phase2.batch;
    check(Number(batch.backup_before) === 0, `blank BACK UP reads 0, got ${batch.backup_before}`);
    check(Number(batch.backup_after) === 6 && Number(batch.need_for_line) === 2 && Number(batch.min_batches) === 1, 'ruling B arithmetic against a zero backup');
    check(result.overUnderStatus === 'at_par', 'bottled 2 against need 2 is at par');
    // The honest zero is what the other gates now judge against.
    await expectRefusal(db, saveBatch(2, '{"batches":0}'), 'bottled_exceeds_available', 'nothing to bottle from a zero backup');
    await expectRefusal(db, saveBatch(2, '{"batches":1,"came_out_to":8,"tossed":1}'), 'tossed_exceeds_backup', 'nothing to toss from a zero backup');
  });
  await isolated(db, `update opening_closer_count_snapshots set line_count=null where template_item_id=${q(batchTi)}`, async () => {
    await expectRefusal(db, saveBatch(), 'backup_unknown', 'a blank LINE is still unknown');
  });
  await isolated(db, `update checklist_completions set prep_data=jsonb_set(jsonb_set(prep_data,'{phase1,opener_recount_line}','4'),'{phase1,opener_recount_back_up}','3')
      where template_item_id=${q(batchTi)}`, async () => {
    const batch = (await one(db, saveBatch(4, '{"batches":1,"came_out_to":8}'))).result.completion.prep_data.phase2.batch;
    check(Number(batch.backup_before) === 3 && Number(batch.line_count) === 4, "the opener's two-box recount still wins");
  });
  await isolated(db, `update opening_closer_count_snapshots set back_up_count=5 where template_item_id=${q(batchTi)}`, async () => {
    const batch = (await one(db, saveBatch(2, '{"batches":0}'))).result.completion.prep_data.phase2.batch;
    check(Number(batch.backup_before) === 5, 'a counted BACK UP is untouched by the rule');
  });
  await isolated(db, '', async () => {
    const plain = (await one(db, savePlain())).result;
    check(plain.completion.prep_data.phase2.batch === undefined && plain.overUnderStatus === 'at_par', 'a single-box row is unchanged');
  });
  console.log('0315 B020: a blank BACK UP with a known LINE saves as 0; a blank LINE is still backup_unknown; recount and counted values win');
}

async function phase2Writers(db) {
  for (const key of ['save', 'revoke', 'submit']) {
    const def = await fnDef(db, SIGS[key]);
    const lock = def.search(/from checklist_instances[^;]*for no key update/);
    const writes = [def.indexOf('update checklist_completions'), def.indexOf('insert into checklist_completions'),
      def.indexOf('from prep_batch_sessions'), def.indexOf('insert into checklist_submissions')].filter(n => n >= 0);
    check(lock >= 0 && writes.every(n => lock < n), `${key}: the instance lock is the first lock`);
  }
  const revokeDef = await fnDef(db, SIGS.revoke);
  const session = revokeDef.search(/from prep_batch_sessions[^;]*for update/);
  check(session >= 0 && session < revokeDef.indexOf('update checklist_completions'), 'revoke locks the batch session before the completion');
  const saveDef = await fnDef(db, SIGS.save);
  check(saveDef.search(/from prep_batch_sessions[^;]*for update/) < saveDef.indexOf('update checklist_completions'), 'save keeps session before completion');

  // A single-box row has no session: the RPC is the old direct UPDATE behind the lock.
  await isolated(db, '', async () => {
    const saved = (await one(db, savePlain())).result;
    const revoked = (await one(db, revoke(saved.completionId))).result;
    check(revoked.completion.revoked_at !== null && revoked.completion.revoked_by === opener
      && revoked.completion.revocation_reason === 'quick_reenter' && Number(revoked.tossRetracted) === 0, 'single-box undo');
    await expectRefusal(db, revoke(saved.completionId), 'revoke_conflict', 'a second undo of the same row');
  });
  // A batch row with a toss: the toss is retracted in the same transaction.
  await isolated(db, `update opening_closer_count_snapshots set back_up_count=5 where template_item_id=${q(batchTi)}`, async () => {
    const saved = (await one(db, saveBatch(2, '{"batches":0,"tossed":1}'))).result;
    const revoked = (await one(db, revoke(saved.completionId))).result;
    check(Number(revoked.tossRetracted) === 1, 'the toss is retracted');
    check(Number((await one(db, `select tossed_qty from prep_batch_sessions where instance_id=${q(opening)}`)).tossed_qty) === 0, 'the session toss is zero');
  });
  await isolated(db, '', async () => {
    await expectRefusal(db, revoke(id(999)), 'revoke_conflict', 'unknown completion');
    await expectRefusal(db, revoke(id(999), id(998)), 'revoke_conflict', 'unknown instance');
    const saved = (await one(db, savePlain())).result;
    await expectRefusal(db, revoke(saved.completionId, closing), 'phase2_not_eligible', 'another (non Phase 2) instance');
  });
  // Finalize, then nothing may move underneath the report.
  await isolated(db, `update opening_closer_count_snapshots set back_up_count=5 where template_item_id=${q(batchTi)}`, async () => {
    const a = (await one(db, saveBatch(2, '{"batches":0}'))).result;
    const b = (await one(db, savePlain())).result;
    const done = (await one(db, finalize)).result;
    check(done.instance.status === 'phase2_complete' && [...done.completionIds].sort().join() === [a.completionId, b.completionId].sort().join(), 'finalize names both live rows');
    await expectRefusal(db, revoke(a.completionId), 'phase2_not_eligible', 'an Undo after finalize');
    await expectRefusal(db, savePlain(3), 'phase2_not_eligible', 'a save after finalize');
    await expectRefusal(db, finalize, 'phase2_not_eligible', 'a second finalize');
    check((await one(db, `select count(*)::int as n from checklist_completions where id in (${q(a.completionId)},${q(b.completionId)}) and revoked_at is null and superseded_at is null`)).n === 2,
      'the finalized rows are still live');
  });
  // The order the lock now forces when the Undo wins: finalize sees the row missing.
  await isolated(db, `update opening_closer_count_snapshots set back_up_count=5 where template_item_id=${q(batchTi)}`, async () => {
    await one(db, saveBatch(2, '{"batches":0}'));
    const b = (await one(db, savePlain())).result;
    await one(db, revoke(b.completionId));
    await expectRefusal(db, finalize, 'phase2_incomplete', 'finalize after an Undo');
    check((await one(db, `select status from checklist_instances where id=${q(opening)}`)).status === 'phase1_complete', 'a refused finalize leaves the opening open');
  });
  console.log('0315 B080/B181: instance lock first in save / revoke / finalize; session before completion; an Undo or a save after finalize is refused');
}

async function drafts(db) {
  await isolated(db, '', async () => {
    const stored = async () => one(db, `select draft, client_tab, client_seq from opening_phase1_drafts where instance_id=${q(opening)}`);
    await db.exec(`update checklist_instances set status='open' where id=${q(opening)}`);
    check((await one(db, draft(2))).result.applied === true, 'first save applies');
    const stale = (await one(db, draft(1))).result;
    check(stale.applied === false && stale.savedAt != null, 'an older request from the same tab is refused');
    check((await stored()).draft.n === 2 && String((await stored()).client_seq) === '2', 'the newer draft is still stored');
    check((await one(db, draft(2))).result.applied === false, 'the same sequence again is refused');
    check((await one(db, draft(3))).result.applied === true && (await stored()).draft.n === 3, 'a newer request from the same tab applies');
    check((await one(db, draft(1, tabB))).result.applied === true && (await stored()).client_tab === tabB, 'another tab keeps last-write-wins');
    check((await one(db, draft(null, null))).result.applied === true && (await stored()).client_tab === null, 'a request with no revision applies (older deployment)');
    check((await one(db, draft(1, tabA))).result.applied === true, 'a stored row with no revision accepts any request');
    await expectRefusal(db, draft(null, tabA), 'opening_draft:invalid_payload', 'a tab without a sequence');
    await expectRefusal(db, draft(0, tabA), 'opening_draft:invalid_payload', 'a sequence below 1');
    await expectRefusal(db, draft(5, tabA, '[]'), 'opening_draft:invalid_payload', 'a draft that is not an object');
    await expectRefusal(db, draft(5, tabA, undefined, id(999)), 'opening_draft:instance_not_found', 'unknown instance');
    await expectRefusal(db, draft(5, tabA, undefined, opening, id(998)), 'opening_draft:location_mismatch', 'another shop');
    await db.exec(`update checklist_instances set status='phase1_complete' where id=${q(opening)}`);
    await expectRefusal(db, draft(9), 'opening_draft:phase1_not_open', 'a draft after Phase 1 was submitted');
  });
  // Pre-0315 rows (no revision) are kept and overwritten by the first new save.
  await isolated(db, `update checklist_instances set status='open' where id=${q(opening)};
      insert into opening_phase1_drafts(instance_id, location_id, draft, saved_by) values(${q(opening)},${q(shop)},'{"version":1,"n":0}',${q(opener)})`, async () => {
    check((await one(db, draft(1))).result.applied === true, 'an existing draft row takes the first revisioned save');
  });
  const def = await fnDef(db, SIGS.draft);
  check(def.search(/from public\.checklist_instances[^;]*for share/) < def.indexOf('insert into public.opening_phase1_drafts'), 'the draft writer locks the instance before it writes');
  console.log('0315 B078: an older same-tab draft is refused; another tab, a NULL revision and a pre-0315 row keep last-write-wins; not-open refuses in the write');
}

async function trackingTicks(db) {
  await isolated(db, '', async () => {
    for (const [name, call] of Object.entries(corrections(trackDone))) await expectRefusal(db, call, 'reference_row_not_correctable', `tracking tick ${name}`);
    for (const [name, call] of Object.entries(corrections(reportDone))) await expectRefusal(db, call, 'reference_row_not_correctable', `report reference ${name} (0287, kept)`);
  });
  await isolated(db, `update checklist_completions set completed_at=clock_timestamp() where id=${q(trackDone)}`, async () => {
    await expectRefusal(db, corrections(trackDone).quick, 'reference_row_not_correctable', 'a fresh tracking tick refuses the quick undo too');
  });
  await isolated(db, '', async () => {
    check(await attempt(db, corrections(plainDone).reason) === 'allowed', 'an ordinary tick is still correctable');
    check(await attempt(db, corrections(plainDone).authority) === 'allowed', 'an ordinary tick still takes mark-not-done');
    check(await attempt(db, corrections(danglingDone).reason) === 'allowed', 'a tracking flag with no referenced item is an ordinary tick');
    await expectRefusal(db, corrections(plainDone).quick, 'outside_quick_window', '0287 window kept');
  });
  await isolated(db, `update checklist_instances set status='confirmed' where id=${q(closing)}`, async () => {
    await expectRefusal(db, corrections(trackDone).reason, 'instance_not_open', '0287 order kept: the parent status is judged first');
  });
  for (const key of ['quick', 'reason', 'authority']) {
    const def = await fnDef(db, SIGS[key]);
    check(def.indexOf('for no key update') < def.indexOf('reference_row_not_correctable')
      && def.indexOf('reference_row_not_correctable') < def.lastIndexOf('for no key update'), `${key}: parent lock → reference refusal → completion lock`);
  }
  console.log('0315 B182: an item-tracking tick refuses all three corrections; ordinary ticks and the 0287 order are unchanged');
}

async function ceilings(db) {
  const rows = (await db.query(`select p.oid::regprocedure::text as sig, p.prosecdef, p.proconfig from pg_proc p where p.oid = any($1::regprocedure[])`, [Object.values(SIGS)])).rows;
  check(rows.length === 7, 'seven functions present');
  for (const row of rows) {
    const definer = !row.sig.startsWith('checklist_');
    check(row.prosecdef === definer, `${row.sig}: security posture kept`);
    check(row.proconfig.includes('search_path=pg_catalog, public'), `${row.sig}: pinned search_path`);
  }
  const calls = [savePlain(), revoke(id(999)), finalize, draft(1), ...Object.values(corrections(plainDone))];
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      for (const call of calls) {
        let code; try { await db.query(call); } catch (e) { code = e.code; }
        check(code === '42501', `${role} direct RPC refused, got ${code}`);
      }
      let code; try { await db.query('select 1 from opening_phase1_drafts'); } catch (e) { code = e.code; }
      check(code === '42501', `${role} cannot read drafts`);
    } finally { await db.exec('reset role'); }
  }
  console.log('0315 ceilings: seven RPCs service_role only, postures and search_path kept, drafts table deny-all');
}

let db;
try {
  db = await setup();
  if (AGAINST_SOURCE) {
    await reproduce(db);
  } else {
    await guards();
    await ceilings(db);
    await blankBackup(db);
    await phase2Writers(db);
    await drafts(db);
    await trackingTicks(db);
    console.log(`PASS 0315: ${checks} checks; two-connection sim proof NOT RUN`);
  }
} catch (e) { console.error(`FAIL 0315: ${e.stack ?? e}`); process.exitCode = 1; }
finally { if (db) await db.close(); }
