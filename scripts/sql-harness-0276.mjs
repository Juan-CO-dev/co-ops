/** Offline 0276 proof. Only ephemeral in-memory PGlite; no credentials or network.
 * PGlite has one backend, so lock presence is structural here. Real blocking and
 * winner/loser proof lives in sim/checklist-0276-lock-check.mjs (not run by CI).
 */
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { CHECKLIST_PARITY_CASES } from '../tests/fixtures/checklist-write-parity.mjs';

const sql = readFileSync('supabase/migrations/0276_checklist_guarded_writers.sql', 'utf8');
const read = name => readFileSync(`supabase/migrations/${name}`, 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const actor = id(1), other = id(2), location = id(3), template = id(4), item = id(5), instance = id(6), completion = id(7), session = id(8);
const quote = value => value === null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
let checks = 0;
function check(ok, message) { checks++; if (!ok) throw new Error(message); }
const calls = {
  completion: `select public.checklist_write_completion('${actor}','${instance}','${item}',null,null,'note')`,
  submission: `select public.checklist_submit_batch('${actor}','${instance}',array['${completion}']::uuid[])`,
  confirm: `select public.checklist_confirm_instance('${actor}','${instance}',now(),'[]',array['${completion}']::uuid[])`,
};

async function setup(migration = sql) {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      grant usage on schema public to anon, authenticated, service_role;
      -- Simulate Supabase explicit defaults, not merely PostgreSQL's PUBLIC grant.
      alter default privileges grant execute on functions to anon, authenticated;
      create table users(id uuid primary key, role text not null, active boolean not null);
      create table user_locations(user_id uuid references users, location_id uuid, active boolean default true);
      create table sessions(id uuid primary key,user_id uuid references users,revoked_at timestamptz,expires_at timestamptz);
      create table checklist_templates(id uuid primary key,location_id uuid,type text,active boolean default true);
      create table checklist_template_items(id uuid primary key,template_id uuid references checklist_templates,
        min_role_level integer,active boolean,report_reference_type text,ref_track_item_completion boolean,
        references_template_item_id uuid,input_type text);
      create table checklist_instances(id uuid primary key default gen_random_uuid(),template_id uuid references checklist_templates,
        location_id uuid,date date default current_date,status text default 'open',confirmed_at timestamptz,confirmed_by uuid references users);
      create table report_photos(id uuid primary key);
      create table checklist_completions(id uuid primary key default gen_random_uuid(),instance_id uuid not null references checklist_instances,
        template_item_id uuid not null references checklist_template_items,completed_by uuid not null references users,
        completed_at timestamptz default now(),count_value numeric(10,2),photo_id uuid references report_photos,notes text,
        superseded_at timestamptz,superseded_by uuid references checklist_completions,revoked_at timestamptz,
        actual_completer_id uuid references users,prep_data jsonb);
      create unique index checklist_completions_one_live_head_per_phase on checklist_completions
        (instance_id,template_item_id,coalesce(prep_data ? 'phase2',false)) where superseded_at is null and revoked_at is null;
      create table checklist_submissions(id uuid primary key default gen_random_uuid(),instance_id uuid not null references checklist_instances,
        submitted_by uuid not null references users,submitted_at timestamptz default now(),completion_ids uuid[] not null,is_final_confirmation boolean default false);
      create table checklist_incomplete_reasons(id uuid primary key default gen_random_uuid(),instance_id uuid not null references checklist_instances,
        template_item_id uuid not null references checklist_template_items,reason text not null,reported_by uuid not null references users,reported_at timestamptz default now());
      grant all on all tables in schema public to service_role;
      grant select on all tables in schema public to authenticated;
      grant insert,update on checklist_instances,checklist_completions,checklist_submissions,checklist_incomplete_reasons to authenticated;
      insert into users values('${actor}','key_holder',true),('${other}','key_holder',true);
      insert into user_locations values('${actor}','${location}',false);
      insert into sessions values('${session}','${actor}',null,now()+interval '1 day');
      insert into checklist_templates values('${template}','${location}','closing',true);
      insert into checklist_template_items values('${item}','${template}',3,true,null,false,null,null);
      insert into checklist_instances(id,template_id,location_id) values('${instance}','${template}','${location}');
      insert into checklist_completions(id,instance_id,template_item_id,completed_by,completed_at)
        values('${completion}','${instance}','${item}','${actor}',now()-interval '1 hour');`);
    // Execute the real existing role map and session/active helpers, never a fork.
    const author = read('0228_assignment_attribution.sql').match(/create function public\.assignment_author_level[\s\S]*?end \$\$;/i)?.[0];
    const role = read('0189_rls_perimeter_revokes_and_read_floors.sql').match(/create or replace function public\.current_user_role_level\(\)[\s\S]*?\$\$;/i)?.[0];
    const identity = read('0200_current_user_id_session_bound.sql').match(/CREATE OR REPLACE FUNCTION public\.current_user_id\(\)[\s\S]*?\$function\$;/)?.[0];
    check(author && role && identity, 'source helper extraction');
    await db.exec(identity + '\n' + author + '\n' + role);
    await db.exec(`revoke all on function assignment_author_level(uuid) from public,anon,authenticated;
      grant execute on function assignment_author_level(uuid) to service_role;
      create function current_user_locations() returns uuid[] language sql stable security definer
        set search_path=pg_catalog,public as $$ select array_agg(location_id) from user_locations where user_id=current_user_id() $$;
      alter table checklist_instances enable row level security;
      alter table checklist_completions enable row level security;
      alter table checklist_submissions enable row level security;
      alter table checklist_incomplete_reasons enable row level security;
      create policy checklist_instances_read on checklist_instances for select using(location_id=any(current_user_locations()) or current_user_role_level()>=8);
      create policy checklist_instances_insert on checklist_instances for insert with check(
        (case when (select type from checklist_templates where id=template_id) in ('opening','prep')
          then current_user_role_level()>=4 else current_user_role_level()>=3 end) and location_id=any(current_user_locations()));
      create policy checklist_instances_update on checklist_instances for update using(location_id=any(current_user_locations()) and current_user_role_level()>=3);
      create policy checklist_completions_read on checklist_completions for select using(exists(select 1 from checklist_instances i where i.id=instance_id));
      create policy checklist_completions_insert on checklist_completions for insert with check(completed_by=current_user_id()
        and (select min_role_level from checklist_template_items where id=template_item_id)<=current_user_role_level()
        and exists(select 1 from checklist_instances i where i.id=instance_id and i.location_id=any(current_user_locations()) and i.status='open'));
      create policy checklist_submissions_insert on checklist_submissions for insert with check(submitted_by=current_user_id());
      create policy checklist_incomplete_reasons_insert on checklist_incomplete_reasons for insert with check(reported_by=current_user_id());
      -- Tests roll back each successful attempt too, keeping one identical fixture.
      create function public.test_attempt(p_sql text) returns text language plpgsql security invoker as $$
      declare n integer;
      begin execute p_sql; get diagnostics n = row_count;
      if p_sql like 'update %' and n <> 1 then raise insufficient_privilege; end if;
      raise sqlstate 'ZX001';
      exception when sqlstate 'ZX001' then return 'allowed'; when others then return sqlstate || ':' || sqlerrm; end $$;
      grant execute on function public.test_attempt(text) to authenticated, service_role;`);
    const siblings = read('0217_assignments_stations.sql').match(/create policy checklist_instances_insert_closing_staff[\s\S]*?(?=-- Report navigation)/)?.[0];
    check(siblings, 'real 0217 policy siblings extracted');
    await db.exec(siblings);
    await db.exec(migration);
    return db;
  } catch (e) { await db.close(); throw e; }
}

async function attempt(db, statement) {
  return (await db.query('select public.test_attempt($1) as result', [statement])).rows[0].result;
}
async function fixture(db, c) {
  const validSession = c.sessionState !== 'missing' ? session : id(99);
  await db.exec(`reset role;
    update users set role=${quote(c.role)},active=${c.active} where id='${actor}';
    update user_locations set location_id='${c.member ? location : id(99)}';
    update sessions set user_id='${c.sessionState === 'mismatch' ? other : actor}',
      revoked_at=${c.sessionState === 'revoked' ? 'now()' : 'null'},
      expires_at=now()+interval '${c.sessionState === 'expired' ? '-1' : '1'} day';
    update checklist_instances set status=${quote(c.status)} where id='${instance}';
    update checklist_templates set type=${quote(c.templateType)};
    update checklist_template_items set min_role_level=${c.itemMinRoleLevel},active=${c.itemActive},
      report_reference_type=${quote(c.reportReferenceType)},ref_track_item_completion=${c.refTrackItemCompletion},
      references_template_item_id=${c.referencesTemplateItemId ? quote(id(99)) : 'null'};
    select set_config('request.jwt.claims', '${JSON.stringify({ user_id: actor, session_id: validSession })}',false);`);
}

async function parity(db) {
  for (const c of CHECKLIST_PARITY_CASES) {
    await fixture(db, c);
    // Insert into the OTHER phase slot so the existing live head does not mask RLS.
    await db.exec('set role authenticated');
    const live = (await db.query(`select
      test_attempt($1) as completion, test_attempt($2) as submission,
      test_attempt($3) as reason, test_attempt($4) as instance_create, test_attempt($5) as instance_update`, [
      `insert into checklist_completions(instance_id,template_item_id,completed_by,prep_data) values('${instance}','${item}','${actor}','{"phase2":true}')`,
      `insert into checklist_submissions(instance_id,submitted_by,completion_ids) values('${instance}','${actor}','{}')`,
      `insert into checklist_incomplete_reasons(instance_id,template_item_id,reported_by,reason) values('${instance}','${item}','${actor}','test')`,
      `insert into checklist_instances(template_id,location_id) values('${template}','${location}')`,
      `update checklist_instances set confirmed_at=now() where id='${instance}'`,
    ])).rows[0];
    for (const [key, expected] of Object.entries({completion:c.expected.completion,submission:c.expected.liveSubmission,reason:c.expected.liveSubmission,instance_create:c.expected.instanceCreate,instance_update:c.expected.liveInstanceUpdate})) {
      check((live[key] === 'allowed') === expected, `${c.id} LIVE ${key}: ${live[key]}`);
      if (!expected) check(live[key].startsWith('42501:'), `${c.id} LIVE refusal must be RLS`);
    }
    await db.exec('set role service_role');
    // The session-free RPC accepts only a server-resolved actor. Invalid sessions
    // have no actor; never claim the RPC itself verifies session/token credentials.
    const effectiveCalls = Object.values(calls).map(s => c.sessionState === 'valid' ? s : s.replace(quote(actor), 'null'));
    const results = (await db.query('select test_attempt($1) as completion,test_attempt($2) as submission,test_attempt($3) as confirm', effectiveCalls)).rows[0];
    for (const key of Object.keys(calls)) {
      check((results[key] === 'allowed') === c.expected[key], `${c.id} RPC ${key}: ${results[key]}`);
      if (!c.expected[key]) check(/P0001:(not_authorized|instance_not_open)/.test(results[key]), `${c.id} named authorization refusal: ${results[key]}`);
    }
  }
  console.log(`0276 parity: ${CHECKLIST_PARITY_CASES.length} shared cases, real RLS inserts and guarded RPCs; two R7 hole closures explicit`);
}

async function lockContract(db) {
  const rows = (await db.query(`select proname,prosrc from pg_proc where proname in
    ('checklist_write_completion','checklist_submit_batch','checklist_confirm_instance')`)).rows;
  check(rows.length === 3, 'three guarded writers');
  for (const row of rows) check(/select \* into v_instance from public.checklist_instances where id = p_instance for update;/i.test(row.prosrc),
    `0276: parent lock missing: ${row.proname}`);
}

async function behavior(db) {
  await fixture(db, { role:'key_holder',active:true,member:true,sessionState:'valid',status:'open',templateType:'closing',itemMinRoleLevel:3,itemActive:true,reportReferenceType:null,refTrackItemCompletion:false });
  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    for (const statement of [...Object.values(calls), `select public.checklist_actor_level('${actor}','${location}')`]) {
      // Call directly: the test probe is not granted to anon.
      let code;
      try { await db.query(statement); } catch (error) { code=error.code; }
      check(code==='42501',`${role} direct RPC execution refused`);
    }
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  check(await attempt(db, calls.submission.replace(quote(actor), quote(other))) === 'P0001:not_authorized', 'foreign member refused');
  check(await attempt(db, calls.completion.replace(`'${item}'`, `'${id(999)}'`)) === 'P0001:item_mismatch', 'missing item');
  check(await attempt(db, calls.completion.replace("null,null,'note'", `null,'${id(999)}','note'`)).then(x => x.startsWith('23503:')), 'failed replacement FK');
  check((await db.query('select superseded_at from checklist_completions where id=$1',[completion])).rows[0].superseded_at === null, 'failed insert restored prior head transactionally');
  check(await attempt(db, calls.submission.replace(`array['${completion}']::uuid[]`, "'{}'::uuid[]")) === 'P0001:empty_batch', 'empty batch');
  check(await attempt(db, calls.submission.replace(completion, id(999))) === 'P0001:completion_not_found', 'missing completion');
  await db.exec(`insert into user_locations values('${other}','${location}',false)`);
  check(await attempt(db, calls.submission.replace(quote(actor), quote(other))) === 'P0001:completion_wrong_author', 'member cannot submit another actor completion');
  await db.exec(`insert into checklist_instances(id,template_id,location_id) values('${id(20)}','${template}','${location}')`);
  check(await attempt(db, calls.submission.replace(quote(instance), quote(id(20)))) === 'P0001:completion_wrong_instance', 'foreign instance completion');
  check(await attempt(db, calls.confirm.replace("'[]'", "'null'")) === 'P0001:invalid_payload', 'null reasons');
  const duplicateReasons=quote(JSON.stringify([{templateItemId:item,reason:'one'},{templateItemId:item,reason:'two'}]));
  check(await attempt(db, calls.confirm.replace("'[]'", duplicateReasons)) === 'P0001:invalid_reasons', 'duplicate reasons');
  check(await attempt(db, calls.confirm.replace(`array['${completion}']::uuid[]`, "'{}'::uuid[]")) === 'P0001:completion_set_changed', 'stale confirmation snapshot');
  // Inject a final-submission failure AFTER claim/reasons to prove all roll back.
  await db.exec(`reset role; create function fail_final() returns trigger language plpgsql as $$ begin
    if new.is_final_confirmation then raise exception 'injected_final_failure'; end if; return new; end $$;
    create trigger fail_final before insert on checklist_submissions for each row execute function fail_final(); set role service_role;`);
  const withReason = calls.confirm.replace("'[]'", quote(JSON.stringify([{templateItemId:item,reason:'test'}])));
  check(await attempt(db, withReason) === 'P0001:injected_final_failure', 'dependent failure reached');
  check((await db.query(`select status,(select count(*) from checklist_incomplete_reasons)::integer as reasons from checklist_instances where id='${instance}'`)).rows.every(r=>r.status==='open' && r.reasons===0), 'claim and reasons rolled back');
  await db.exec('reset role; drop trigger fail_final on checklist_submissions; set role service_role;');
  // B8 app tests moved here: exercise the actual SQL timestamp owner, rolling
  // each variant back so no test double can merely imitate the carry rule.
  for (const [name, change, expectedCarry] of [
    ['notes only', '', true],
    ['free text answer', "update checklist_template_items set input_type='free_text'", false],
    ['peer tagged', `update checklist_completions set actual_completer_id='${other}'`, false],
    ['other author', `update checklist_completions set completed_by='${other}'`, false],
    ['count changed', 'update checklist_completions set count_value=1', false],
    ['photo changed', `insert into report_photos values('${id(99)}'); update checklist_completions set photo_id='${id(99)}'`, false],
    ['first tick', 'truncate checklist_completions cascade', false],
  ]) {
    await db.exec('begin');
    try {
      const original = (await db.query(`select completed_at from checklist_completions where id='${completion}'`)).rows[0].completed_at;
      if (change) await db.exec(change);
      await db.query(calls.completion);
      const current = (await db.query('select completed_at from checklist_completions where superseded_at is null')).rows[0].completed_at;
      check((String(current) === String(original)) === expectedCarry, `B8 ${name} timestamp`);
    } finally { await db.exec('rollback'); }
  }
  // Real committed in-memory replacement preserves note timestamp and points history at winner.
  const before = (await db.query('select completed_at from checklist_completions where id=$1',[completion])).rows[0].completed_at;
  await db.query(calls.completion);
  const heads = (await db.query(`select * from checklist_completions where superseded_at is null`)).rows;
  check(heads.length === 1 && String(heads[0].completed_at) === String(before), 'notes-only timestamp retained');
  check((await db.query('select superseded_by from checklist_completions where id=$1',[completion])).rows[0].superseded_by===heads[0].id, 'supersession linked');
  check(await attempt(db,calls.confirm)==='P0001:completion_set_changed','replace-before-confirm rejects old app snapshot');
  await db.query(calls.confirm.replace(completion,heads[0].id));
  const frozen = JSON.stringify((await db.query('select * from checklist_completions order by id')).rows);
  for (const [key, statement] of Object.entries(calls)) check(await attempt(db,statement)==='P0001:instance_not_open',`closed ${key} refuses`);
  check(JSON.stringify((await db.query('select * from checklist_completions order by id')).rows)===frozen,'attested completion set unchanged');
  check((await db.query('select count(*)::integer n from checklist_submissions where is_final_confirmation')).rows[0].n===1,'exactly one final attestation');
  await db.exec('reset role');
}

async function mutations() {
  for (const role of ['authenticated','anon']) {
    let db;
    try {
      const changed = sql.replace('do $$\ndeclare f regprocedure;', () => `grant execute on function checklist_submit_batch(uuid,uuid,uuid[]) to ${role};\ndo $$\ndeclare f regprocedure;`);
      check(changed !== sql, 'ACL mutation applied');
      db = await setup(changed);
      throw new Error('ACL mutation escaped');
    } catch(e) { check(e.message.includes('0276: RPC execution grant escaped'), `${role} mutation: ${e.message}`); }
    finally { if (db) await db.close(); }
    console.log(`0276 mutation ${role} EXECUTE: rejected`);
  }
  // Remove each writer's lock/check separately. Lock mutation is STRUCTURAL only:
  // PGlite cannot execute two connections; the sim script proves actual blocking.
  for (let index=0; index<3; index++) {
    for (const kind of ['lock','open']) {
      const target = kind==='lock' ? ' for update;' : "if v_instance.status is distinct from 'open' then raise exception 'instance_not_open'; end if;";
      let seen=0;
      const changed=sql.replaceAll(target,match=>seen++===index?(kind==='lock'?';':''):match);
      check(changed!==sql, `${kind} mutation applied`);
      const db=await setup(changed);
      try {
        if(kind==='lock') {
          let rejected=false;
          try { await lockContract(db); } catch(e) { rejected=e.message.includes('parent lock missing'); }
          check(rejected,`lock ${index} mutation detected`);
        } else {
          await db.exec(`update checklist_instances set status='confirmed'; set role service_role`);
          const result=await attempt(db,Object.values(calls)[index]);
          check(result!=='P0001:instance_not_open',`open ${index} mutation changes behavioral verdict`);
          // The ordinary closed-parent contract must reject this mutant (including
          // confirm's later zero-row UPDATE error, which loses its named refusal).
          check(result==='allowed' || result.startsWith('P0002:'),`open ${index}: ${result}`);
        }
      } finally { await db.close(); }
      console.log(`0276 mutation ${kind} writer ${index+1}: rejected`);
    }
  }
}

let db;
try {
  db=await setup();
  await lockContract(db);
  await parity(db);
  await behavior(db);
  await db.close(); db=undefined;
  await mutations();
  console.log(`PASS 0276: ${checks} checks; two-connection sim proof NOT RUN`);
} catch(e) { console.error(`FAIL 0276: ${e.stack ?? e}`); process.exitCode=1; }
finally { if(db) await db.close(); }
