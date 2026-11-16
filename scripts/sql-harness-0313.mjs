/** Offline 0313 proof (W13/B019, B072, B073, B074). Ephemeral in-memory PGlite only: no
 * credentials, no network. The schema stubs follow scripts/sql-harness-0291.mjs; the checklist
 * chain runs the REAL 0276 -> 0287 -> 0186 -> 0288 -> 0290 -> 0291 files, the REAL 0215 Phase 1 and
 * mid-day Phase 1 bodies (extracted), then the REAL 0313 file. The broken variant re-runs the
 * refusals against 0313 bodies with the guards stripped and must see the bugs succeed.
 */
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFileSync(`supabase/migrations/${name}`, 'utf8').replace(/\r\n/g, '\n');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const actor = id(1), other = id(2), location = id(3), closingTmpl = id(4), closingItem = id(5), closing = id(6),
  completion = id(7), session = id(8);
const amTmpl = id(10), amPrep = id(11), amItem = id(20);
const openTmpl = id(50), spotA = id(51), spotB = id(52), plainItem = id(53), retiredItem = id(54), opening = id(60);
const midTmpl = id(70), midDay = id(71), midItem = id(72);
const foreignTmpl = id(80), foreignItem = id(81);
let checks = 0;
function check(ok, message) { checks++; if (!ok) throw new Error(message); }

function extract(file, marker) {
  const src = read(file);
  const i = src.indexOf(marker);
  const j = src.indexOf('$function$;', i) + '$function$;'.length;
  check(i >= 0 && j > i, `extract ${marker} from ${file}`);
  return src.slice(i, j);
}

async function setup() {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      grant usage on schema public to anon, authenticated, service_role;
      alter default privileges grant execute on functions to anon, authenticated;
      create table audit_log(actor_id uuid,actor_role text,action text,resource_table text,resource_id uuid,destructive boolean,metadata jsonb);
      create table written_reports(id uuid primary key,submitted_by uuid,submitted_at timestamptz,location_id uuid,
        title text,body text,category text,visibility_min_level integer,last_edited_at timestamptz,edit_count integer default 0);
      create table users(id uuid primary key, role text not null check(role in ('cgs','owner','moo','gm','agm','catering_mgr','prep_mgr','social_media_mgr','shift_lead','key_holder','trainer','employee','trainee','hired_not_yet_worked','prospect')), active boolean not null, name text);
      create table user_locations(user_id uuid references users, location_id uuid, active boolean default true);
      create table sessions(id uuid primary key,user_id uuid references users,revoked_at timestamptz,expires_at timestamptz);
      create table locations(id uuid primary key, code text);
      create table checklist_templates(id uuid primary key,location_id uuid,type text check (type in ('closing','prep','opening')),active boolean default true, prep_subtype text);
      create type report_type_enum as enum('am_prep','mid_day_prep','cash_report','opening_report','training_report','special_report','pm_report','receiving','counts','ordering');
      create table checklist_template_items(id uuid primary key,template_id uuid references checklist_templates,
        min_role_level integer,active boolean,report_reference_type report_type_enum,ref_track_item_completion boolean,
        references_template_item_id uuid,input_type text,label text,prep_meta jsonb);
      create table checklist_instances(id uuid primary key default gen_random_uuid(),template_id uuid references checklist_templates,
        location_id uuid,date date default current_date,status text default 'open' check(status in ('open','phase1_complete','phase2_complete','confirmed','incomplete_confirmed','auto_finalized')),confirmed_at timestamptz,confirmed_by uuid references users,
        opener_no_prior_data_reason text);
      create table report_photos(id uuid primary key);
      create table checklist_completions(id uuid primary key default gen_random_uuid(),instance_id uuid not null references checklist_instances,
        template_item_id uuid not null references checklist_template_items,completed_by uuid not null references users,
        completed_at timestamptz default now(),count_value numeric(10,2),photo_id uuid references report_photos,notes text,
        superseded_at timestamptz,superseded_by uuid references checklist_completions,revoked_at timestamptz,
        actual_completer_id uuid references users,prep_data jsonb,count_provenance text);
      create unique index checklist_completions_one_live_head_per_phase on checklist_completions
        (instance_id,template_item_id,coalesce(prep_data ? 'phase2',false)) where superseded_at is null and revoked_at is null;
      create table checklist_submissions(id uuid primary key default gen_random_uuid(),instance_id uuid not null references checklist_instances,
        submitted_by uuid not null references users,submitted_at timestamptz default now(),completion_ids uuid[] not null,is_final_confirmation boolean default false);
      create table checklist_incomplete_reasons(id uuid primary key default gen_random_uuid(),instance_id uuid not null references checklist_instances,
        template_item_id uuid not null references checklist_template_items,reason text not null,reported_by uuid not null references users,reported_at timestamptz default now());
      create table opening_closer_count_snapshots(opening_instance_id uuid references checklist_instances, template_item_id uuid references checklist_template_items,
        closer_count numeric, par_value numeric);
      create table opening_section_verifications(opening_instance_id uuid, section_key text, verified_at timestamptz, verified_by uuid);
      -- 0215's prep_batch_context reads the recipe graph; only its is_batch column is read by
      -- the two Phase 1 writers. No batch items here, so the stub answers false.
      create function public.prep_batch_context(p uuid) returns table(is_batch boolean) language sql as $$ select false $$;
      grant all on all tables in schema public to service_role;
      grant select on all tables in schema public to authenticated;
      grant insert,update on checklist_instances,checklist_completions,checklist_submissions,checklist_incomplete_reasons to authenticated;
      insert into users values('${actor}','key_holder',true,'Actor'),('${other}','key_holder',true,'Other');
      insert into user_locations values('${actor}','${location}',true);
      insert into sessions values('${session}','${actor}',null,now()+interval '1 day');
      insert into locations values('${location}','EM');
      insert into checklist_templates values('${closingTmpl}','${location}','closing',true,null);
      insert into checklist_template_items(id,template_id,min_role_level,active,report_reference_type,ref_track_item_completion)
        values('${closingItem}','${closingTmpl}',3,true,null,false);
      insert into checklist_instances(id,template_id,location_id) values('${closing}','${closingTmpl}','${location}');
      insert into checklist_completions(id,instance_id,template_item_id,completed_by,completed_at)
        values('${completion}','${closing}','${closingItem}','${actor}',now()-interval '1 hour');`);
    const author = read('0228_assignment_attribution.sql').match(/create function public\.assignment_author_level[\s\S]*?end \$\$;/i)?.[0];
    const role = read('0189_rls_perimeter_revokes_and_read_floors.sql').match(/create or replace function public\.current_user_role_level\(\)[\s\S]*?\$\$;/i)?.[0];
    const identity = read('0200_current_user_id_session_bound.sql').match(/CREATE OR REPLACE FUNCTION public\.current_user_id\(\)[\s\S]*?\$function\$;/)?.[0];
    check(author && role && identity, 'source helper extraction');
    await db.exec(identity + '\n' + author + '\n' + role);
    await db.exec(`revoke all on function assignment_author_level(uuid) from public,anon,authenticated;
      grant execute on function assignment_author_level(uuid) to service_role;
      create function current_user_locations() returns uuid[] language sql stable security definer
        set search_path=pg_catalog,public as $$ select array_agg(location_id) from user_locations where user_id=current_user_id() $$;`);
    await db.exec(read('0276_checklist_guarded_writers.sql'));
    await db.exec(`alter table checklist_completions add column revoked_by uuid references users, add column revocation_reason text, add column revocation_note text, add column actual_completer_tagged_by uuid references users;`);
    await db.exec(read('0287_checklist_corrections_serialized.sql'));
    await db.exec(`alter table checklist_completions add column auto_complete_meta jsonb,
      add column original_completion_id uuid references checklist_completions, add column edit_count integer not null default 0;
      alter table checklist_submissions add column original_submission_id uuid references checklist_submissions,
      add column edit_count integer not null default 0;
      update checklist_template_items set report_reference_type='am_prep' where id='${closingItem}';
      insert into checklist_templates values('${amTmpl}','${location}','prep',true,'am_prep'),
        ('${openTmpl}','${location}','opening',true,null), ('${midTmpl}','${location}','prep',true,'mid_day_prep'),
        ('${foreignTmpl}','${location}','opening',false,null);
      insert into checklist_template_items(id,template_id,min_role_level,active,label,prep_meta) values
        ('${amItem}','${amTmpl}',3,true,'am item',null),
        ('${spotA}','${openTmpl}',3,true,'spot A','{"openingPhase2":true,"section":"line"}'),
        ('${spotB}','${openTmpl}',3,true,'spot B','{"openingPhase2":true,"section":"line"}'),
        ('${plainItem}','${openTmpl}',3,true,'clean',null),
        ('${retiredItem}','${openTmpl}',3,false,'retired spot','{"openingPhase2":true}'),
        ('${midItem}','${midTmpl}',3,true,'mid item',null),
        ('${foreignItem}','${foreignTmpl}',3,true,'foreign',null);
      insert into checklist_instances(id,template_id,location_id) values('${amPrep}','${amTmpl}','${location}'),
        ('${opening}','${openTmpl}','${location}'), ('${midDay}','${midTmpl}','${location}');
      insert into opening_closer_count_snapshots values ('${opening}','${spotA}',4,6),('${opening}','${spotB}',2,5),('${opening}','${retiredItem}',1,3);`);
    await db.exec(read('0186_am_prep_chain_edit_supersede.sql'));
    await db.exec(read('0288_checklist_confirm_filtered_only.sql'));
    await db.exec(read('0290_checklist_closing_ref_atomic.sql'));
    await db.exec(read('0291_prep_submit_idempotency.sql'));
    // The latest Phase 1 / mid-day Phase 1 definers (0215), exactly as applied.
    await db.exec(extract('0215_batch_vs_bottle.sql', 'CREATE OR REPLACE FUNCTION public.submit_phase1_atomic('));
    await db.exec(extract('0215_batch_vs_bottle.sql', 'CREATE OR REPLACE FUNCTION public.submit_mid_day_phase1_atomic('));
    await db.exec(`revoke execute on function public.submit_phase1_atomic(uuid, uuid, jsonb, jsonb, text, boolean, uuid, jsonb, text, text) from public, anon, authenticated;
      grant execute on function public.submit_phase1_atomic(uuid, uuid, jsonb, jsonb, text, boolean, uuid, jsonb, text, text) to service_role;
      revoke execute on function public.submit_mid_day_phase1_atomic(uuid, uuid, jsonb) from public, anon, authenticated;
      grant execute on function public.submit_mid_day_phase1_atomic(uuid, uuid, jsonb) to service_role;`);
    return db;
  } catch (e) { await db.close(); throw e; }
}

const one = async (db, q, p = []) => (await db.query(q, p)).rows[0];
const count = async (db, table, where = 'true') => (await one(db, `select count(*)::int n from ${table} where ${where}`)).n;
const statusOf = async (db, inst) => (await one(db, `select status from checklist_instances where id = $1`, [inst])).status;
async function isolated(db, run) {
  await db.exec('begin');
  try { await db.exec('set local role service_role'); await run(); } finally { await db.exec('rollback'); }
}
async function attempt(db, run) {
  await db.exec('savepoint a'); let error = null, value;
  try { value = await run(); } catch (e) { error = e; }
  await db.exec(error ? 'rollback to savepoint a' : 'release savepoint a');
  return { error, value };
}
async function refuses(db, run, pattern, label) {
  const { error } = await attempt(db, run);
  check(error && pattern.test(error.message), `${label}: expected ${pattern}, got ${error?.message ?? 'success'}`);
  return error;
}

const amEntries = JSON.stringify([{ templateItemId: amItem, inputs: { onHand: 1 }, snapshot: { label: 'fixture' } }]);
const submitAm = (db, inst, ref = closingItem, isUpdate = false, head = null) => db.query(
  `select public.submit_am_prep_atomic($1,$2,$3,$4,$5,$6) r`, [inst, actor, amEntries, ref, isUpdate, head]);
const phase1 = (db, inst, entries, isUpdate = false) => db.query(
  `select public.submit_phase1_atomic($1,$2,$3,'[]'::jsonb,null,$4,null,null,null,null) r`, [inst, actor, JSON.stringify(entries), isUpdate]);
const spot = (item, extra = {}) => ({ templateItemId: item, phase: 'phase1', spotCheckStatus: 'flagged_recount', openerRecount: 3, ...extra });
const midDayPhase1 = (db, inst) => db.query(`select public.submit_mid_day_phase1_atomic($1,$2,$3) r`,
  [inst, actor, JSON.stringify([{ templateItemId: midItem, inputs: { onHand: 2 }, snapshot: {} }])]);
const confirm = (db, inst, expected) => db.query(`select public.checklist_confirm_instance($1,$2,now(),'[]'::jsonb,$3::uuid[]) r`, [actor, inst, expected]);
const writeCompletion = (db, inst, item) => db.query(`select public.checklist_write_completion($1,$2,$3) r`, [actor, inst, item]);
const submitBatch = (db, inst, ids) => db.query(`select public.checklist_submit_batch($1,$2,$3::uuid[]) r`, [actor, inst, ids]);

/** The refusals the bugs describe; on the guard-stripped variant each must SUCCEED (returns the count that did). */
async function bugProbes(db) {
  let succeeded = 0;
  await isolated(db, async () => { if (!(await attempt(db, () => submitAm(db, closing))).error) succeeded++; });
  await isolated(db, async () => { if (!(await attempt(db, () => phase1(db, opening, []))).error) succeeded++; });
  await isolated(db, async () => { if (!(await attempt(db, () => phase1(db, closing, []))).error) succeeded++; });
  await isolated(db, async () => { if (!(await attempt(db, () => confirm(db, opening, []))).error) succeeded++; });
  return succeeded;
}

async function behavior(db) {
  // ── B019: AM prep ────────────────────────────────────────────────────────
  await isolated(db, async () => {
    await refuses(db, () => submitAm(db, closing), /wrong_checklist_type/, 'AM prep submit of a closing id');
    check(await statusOf(db, closing) === 'open', 'the closing stays open');
    check(await count(db, 'checklist_submissions', `instance_id='${closing}'`) === 0, 'no submission on the closing');
    await refuses(db, () => submitAm(db, closing, closingItem, true, id(99)), /wrong_checklist_type/, 'the update path is guarded too');
    await refuses(db, () => submitAm(db, midDay), /wrong_checklist_type/, 'AM prep submit of a mid-day id');
    await refuses(db, () => submitAm(db, id(98)), /not open|does not exist|not found/i, 'a missing instance keeps its old refusal');
    const ok = (await submitAm(db, amPrep)).rows[0].r;
    check(ok.instance.status === 'confirmed' && Boolean(ok.autoCompleteId), 'a real AM prep still confirms and ticks its closing ref');
  });
  // ── B019: mid-day Phase 1 ────────────────────────────────────────────────
  await isolated(db, async () => {
    await refuses(db, () => midDayPhase1(db, amPrep), /wrong_checklist_type/, 'mid-day Phase 1 of an AM prep id');
    await refuses(db, () => midDayPhase1(db, opening), /wrong_checklist_type/, 'mid-day Phase 1 of an opening id');
    check(await count(db, 'checklist_completions', `instance_id in ('${amPrep}','${opening}')`) === 0, 'nothing written');
    const { error } = await attempt(db, () => midDayPhase1(db, id(97)));
    check(error?.code === '23503' || error?.code === '23514', `a missing instance keeps a non-guard refusal, got ${error?.code}`);
    check((await midDayPhase1(db, midDay)).rows[0].r.instance.status === 'phase1_complete', 'a real mid-day Phase 1 still completes');
  });
  // ── B073 + B074: opening Phase 1 ─────────────────────────────────────────
  await isolated(db, async () => {
    await refuses(db, () => phase1(db, closing, []), /wrong_checklist_type/, 'Phase 1 of a closing id');
    await refuses(db, () => phase1(db, closing, [], true), /wrong_checklist_type/, 'Phase 1 chain edit of a closing id');
    await refuses(db, () => phase1(db, amPrep, []), /wrong_checklist_type/, 'Phase 1 of an AM prep id');
    check(await statusOf(db, closing) === 'open', 'the closing is not stranded in phase1_complete');
    const empty = await refuses(db, () => phase1(db, opening, []), /phase1_incomplete — 2 spot-check/, 'empty Phase 1');
    check(empty.code === 'P0001', 'phase1_incomplete is P0001');
    check(await statusOf(db, opening) === 'open', 'the opening stays open');
    check(await count(db, 'checklist_completions', `instance_id='${opening}'`) === 0 && await count(db, 'checklist_submissions', `instance_id='${opening}'`) === 0,
      'zero completions and submissions after the refusal');
    await refuses(db, () => phase1(db, opening, [spot(spotA)]), /phase1_incomplete — 1 spot-check/, 'Phase 1 missing one of two spot checks');
    await refuses(db, () => phase1(db, opening, [spot(spotA), spot(spotB, { spotCheckStatus: null })]), /phase1_incomplete — 1/, 'a spot check with no status counts as missing');
    await refuses(db, () => phase1(db, opening, [spot(spotA), spot(spotB), { templateItemId: foreignItem, phase: 'phase1' }]),
      /item_not_in_template for item 00000000-0000-0000-0000-000000000081/, 'an item from another template');
    check(await count(db, 'checklist_completions', `instance_id='${opening}'`) === 0, 'the foreign-item refusal rolled back every insert');
    const ok = (await phase1(db, opening, [spot(spotA), spot(spotB), { templateItemId: plainItem, phase: 'phase1', notes: 'ok' }])).rows[0].r;
    check(ok.instance.status === 'phase1_complete' && ok.completionIds.length === 3, 'a full Phase 1 completes (the deactivated item\'s snapshot is not required)');
  });
  // ── B072: generic writers ────────────────────────────────────────────────
  await isolated(db, async () => {
    await refuses(db, () => confirm(db, opening, []), /^wrong_checklist_type$/, 'generic confirm of an opening');
    await refuses(db, () => confirm(db, amPrep, []), /^wrong_checklist_type$/, 'generic confirm of an AM prep');
    check(await statusOf(db, opening) === 'open' && await statusOf(db, amPrep) === 'open', 'both stay open');
    await refuses(db, () => writeCompletion(db, amPrep, amItem), /^wrong_checklist_type$/, 'generic completion on an AM prep');
    await refuses(db, () => submitBatch(db, amPrep, [completion]), /^wrong_checklist_type$/, 'generic batch on an AM prep');
    await refuses(db, () => confirm(db, id(96), []), /^instance_not_found$/, 'a missing instance keeps instance_not_found');
    const w = (await writeCompletion(db, closing, closingItem)).rows[0].r;
    check(Boolean(w.completion.id), 'a closing completion still writes');
    const c = (await confirm(db, closing, [w.completion.id])).rows[0].r;
    check(c.instance.status === 'confirmed', 'a closing still confirms');
  });
}

async function contracts(db) {
  const names = ['submit_am_prep_atomic', 'submit_phase1_atomic', 'submit_mid_day_phase1_atomic',
    'checklist_confirm_instance', 'checklist_write_completion', 'checklist_submit_batch'];
  const rows = (await db.query(`select proname, oid, prosecdef, proconfig, prosrc from pg_proc where proname = any($1) order by proname`, [names])).rows;
  check(rows.length === 6, `exactly one definition each, got ${rows.length}`);
  for (const r of rows) {
    check(r.prosrc.includes('wrong_checklist_type'), `${r.proname}: guard present`);
    check(r.proconfig.includes('search_path=pg_catalog, public'), `${r.proname}: search path`);
    const definer = ['submit_am_prep_atomic', 'submit_phase1_atomic', 'submit_mid_day_phase1_atomic'].includes(r.proname);
    check(r.prosecdef === definer, `${r.proname}: security ${definer ? 'definer' : 'invoker'} kept`);
    for (const role of ['anon', 'authenticated']) {
      check(!(await one(db, `select has_function_privilege($1,$2::oid,'EXECUTE') ok`, [role, r.oid])).ok, `${r.proname}: ${role} cannot execute`);
    }
    check((await one(db, `select has_function_privilege('service_role',$1::oid,'EXECUTE') ok`, [r.oid])).ok, `${r.proname}: service_role executes`);
  }
  check(await count(db, 'audit_log', `action='security.grants_change' and metadata->>'migration'='0313_checklist_type_guards'`) === 1, 'one migration audit row');
}

const STRIP = [
  ['submit_am_prep_atomic', "IF EXISTS (SELECT 1 FROM public.checklist_instances WHERE id = p_prep_instance_id)\n     AND NOT EXISTS", 'IF false AND NOT EXISTS'],
  ['submit_phase1_atomic', 'IF v_template_id IS NULL THEN', 'IF false THEN'],
  ['submit_phase1_atomic', 'IF v_phase1_missing > 0 THEN', 'IF false THEN'],
  ['checklist_confirm_instance', "if not exists(select 1 from public.checklist_templates where id = v_instance.template_id and type = 'closing') then", 'if false then'],
];

let db;
try {
  db = await setup();
  const before = await bugProbes(db);
  check(before === 4, `pre-0313 the four bug probes all succeed (got ${before})`);
  await db.exec(read('0313_checklist_type_guards.sql'));
  let refused = false;
  try { await db.exec(read('0313_checklist_type_guards.sql')); } catch (e) { refused = /already carries the type guard/.test(e.message); await db.exec('rollback'); }
  check(refused, 'a second apply is refused by the pre-flight');
  await contracts(db);
  // Broken variant: the same 0313 bodies with each guard stripped must let the bugs through.
  const defs = {};
  for (const [name] of STRIP) defs[name] ??= (await one(db, `select pg_get_functiondef(oid) d from pg_proc where proname=$1`, [name])).d;
  for (const name of Object.keys(defs)) {
    let d = defs[name];
    for (const [n, from, to] of STRIP) if (n === name) { check(d.includes(from), `strip anchor in ${name}`); d = d.replace(from, to); }
    await db.exec(d);
  }
  const stripped = await bugProbes(db);
  check(stripped === 4, `the guard-stripped variant lets all four through (got ${stripped})`);
  console.log('EXPECTED FAIL 0313 broken variant: with the guards stripped, a closing confirmed as AM prep, an empty Phase 1, a closing flipped by Phase 1 and a generic confirm of an opening all succeeded');
  for (const name of Object.keys(defs)) await db.exec(defs[name]);
  check(await bugProbes(db) === 0, 'the restored 0313 bodies refuse all four');
  await behavior(db);
  console.log(`PASS 0313: ${checks} checks; two-session sim proof NOT RUN (sim only)`);
} catch (e) { console.error(`FAIL 0313: ${e.stack ?? e}`); process.exitCode = 1; }
finally { if (db) await db.close(); }
