/** Offline 0291 proof. Only ephemeral in-memory PGlite; no credentials or network.
 * PGlite has one backend, so lock presence is structural here. Real blocking
 * proof lives in sim/checklist-0291-lock-check-management.mjs (not run by CI).
 */
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { PGlite } from '@electric-sql/pglite';

const sql = readFileSync('supabase/migrations/0276_checklist_guarded_writers.sql', 'utf8').replace(/\r\n/g, '\n');
const read = name => readFileSync(`supabase/migrations/${name}`, 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const actor = id(1), other = id(2), location = id(3), template = id(4), item = id(5), instance = id(6), completion = id(7), session = id(8);
let checks = 0;
function check(ok, message) { checks++; if (!ok) throw new Error(message); }
async function setup(migration = sql) {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      grant usage on schema public to anon, authenticated, service_role;
      -- Simulate Supabase explicit defaults, not merely PostgreSQL's PUBLIC grant.
      alter default privileges grant execute on functions to anon, authenticated;
      create table audit_log(actor_id uuid,actor_role text,action text,resource_table text,resource_id uuid,destructive boolean,metadata jsonb);
      create table written_reports(id uuid primary key,submitted_by uuid,submitted_at timestamptz,location_id uuid,
        title text,body text,category text,visibility_min_level integer,last_edited_at timestamptz,edit_count integer default 0);
      create table users(id uuid primary key, role text not null check(role in ('cgs','owner','moo','gm','agm','catering_mgr','prep_mgr','social_media_mgr','shift_lead','key_holder','trainer','employee','trainee','hired_not_yet_worked','prospect')), active boolean not null);
      create table user_locations(user_id uuid references users, location_id uuid, active boolean default true);
      create table sessions(id uuid primary key,user_id uuid references users,revoked_at timestamptz,expires_at timestamptz);
      create table checklist_templates(id uuid primary key,location_id uuid,type text check (type in ('closing','prep','opening')),active boolean default true);
      create type report_type_enum as enum('am_prep','mid_day_prep','cash_report','opening_report','training_report','special_report','pm_report','receiving','counts','ordering');
      create table checklist_template_items(id uuid primary key,template_id uuid references checklist_templates,
        min_role_level integer,active boolean,report_reference_type report_type_enum,ref_track_item_completion boolean,
        references_template_item_id uuid,input_type text);
      create table checklist_instances(id uuid primary key default gen_random_uuid(),template_id uuid references checklist_templates,
        location_id uuid,date date default current_date,status text default 'open' check(status in ('open','phase1_complete','phase2_complete','confirmed','incomplete_confirmed','auto_finalized')),confirmed_at timestamptz,confirmed_by uuid references users);
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
      insert into user_locations values('${actor}','${location}',true);
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
    await db.exec(`alter table checklist_completions add column revoked_by uuid references users, add column revocation_reason text, add column revocation_note text, add column actual_completer_tagged_by uuid references users;`);
    await db.exec(read('0287_checklist_corrections_serialized.sql'));
    await db.exec(`alter table checklist_completions add column auto_complete_meta jsonb,
      add column original_completion_id uuid references checklist_completions, add column edit_count integer not null default 0;
      alter table checklist_submissions add column original_submission_id uuid references checklist_submissions,
      add column edit_count integer not null default 0;
      update checklist_template_items set report_reference_type='am_prep';
      insert into checklist_templates values('${id(10)}','${location}','prep',true);
      insert into checklist_instances(id,template_id,location_id) values('${id(11)}','${id(10)}','${location}');
      update checklist_completions set auto_complete_meta='{"reportType":"am_prep","reportInstanceId":"${id(11)}","reportSubmittedAt":"2026-11-03T08:00:00Z","count":1}';`);
    await db.exec(read('0186_am_prep_chain_edit_supersede.sql'));
    await db.exec(read('0288_checklist_confirm_filtered_only.sql'));
    await db.exec(read('0290_checklist_closing_ref_atomic.sql'));
    await db.exec(read('0291_prep_submit_idempotency.sql'));
    return db;
  } catch (e) { await db.close(); throw e; }
}

const prep = id(11), prepItem = id(20), key = id(30);
const hash = intent => `intent-${intent}`; // SQL treats hashes as opaque app-supplied intent fingerprints.
const entries = [{templateItemId:prepItem,inputs:{onHand:1},snapshot:{label:'fixture'}}];
async function submit(db, {request=key,fingerprint=hash('one'),head=null,who=actor,closing=item}={}) {
  return (await db.query(`select public.submit_am_prep_atomic($1,$2,$3,$4,$5,$6,null,null,null,$7,$8) as result`,
    [prep,who,JSON.stringify(entries),closing,head!==null,head,request,fingerprint])).rows[0].result;
}
async function isolated(db, change, run) {
  await db.exec('begin');
  try { if(change) await db.exec(change); await db.exec('set local role service_role'); await run(); }
  finally { await db.exec('rollback'); }
}
async function refuses(db, run, expected, byCode=false) {
  await db.exec('savepoint refusal'); let error;
  try {await run();} catch(e) {error=e;}
  await db.exec('rollback to savepoint refusal');
  check((byCode ? error?.code : error?.message)===expected,`expected ${expected}, got ${error?.message??'success'}`);
}
async function count(db, table, where='true') {
  return (await db.query(`select count(*)::int n from ${table} where ${where}`)).rows[0].n;
}
async function behavior(db) {
  await isolated(db,'',async()=> {
    const first=(await db.query(`select public.submit_am_prep_atomic(p_actor_id=>$1,p_entries=>$2,p_prep_instance_id=>$3,p_closing_report_ref_item_id=>$4) result`,
      [actor,JSON.stringify(entries),prep,item])).rows[0].result;
    check(Boolean(first.autoCompleteId),'four named arguments use trailing defaults');
    const legacyEdit=()=>db.query(`select public.submit_am_prep_atomic(p_prep_instance_id=>$1,p_actor_id=>$2,p_entries=>$3,
      p_closing_report_ref_item_id=>$4,p_is_update=>true,p_original_submission_id=>$5,p_changed_fields=>'[]',p_ip_address=>null,p_user_agent=>null) result`,
      [prep,actor,JSON.stringify(entries),item,first.submissionId]);
    for(let n=1;n<=3;n++) check((await legacyEdit()).rows[0].result.editCount===n,'nine named args legacy edit '+n);
    await refuses(db,legacyEdit,'P0001',true);
  });
  await isolated(db,'',async()=> {
    const first=await submit(db);
    const one=await submit(db,{head:first.submissionId,request:id(31)});
    const two=await submit(db,{head:first.submissionId,request:id(31),who:other});
    check(one.submissionId!==two.submissionId && two.editCount===2 && !two.replayed,'same edit key by another actor creates distinct edit');
  });
  await isolated(db,`update checklist_completions set revoked_at=clock_timestamp()`,async()=> {
    const first=await submit(db), again=await submit(db);
    check(first.closingRefSkip.reason==='closing_ref_revoked' && again.replayed && again.closingRefSkip===null && again.submissionId===first.submissionId,'keyed skipped push replays without advisory audit hint');
  });
  await isolated(db,'',async()=> {
    const first=await submit(db), again=await submit(db);
    check(again.replayed===true && again.submissionId===first.submissionId,'same original submission replay');
    check(isDeepStrictEqual(again.completionIds,first.completionIds) && again.autoCompleteId===first.autoCompleteId,'same completion and push IDs');
    check(await count(db,'checklist_submissions')===1,'one submission');
    check(await count(db,'checklist_completions',`instance_id='${prep}'`)===1,'one completion set');
    await refuses(db,()=>submit(db,{fingerprint:hash('two')}),'prep_request_key_reused');
    await refuses(db,()=>submit(db,{who:other}),'23514',true);
    await refuses(db,()=>submit(db,{request:null,fingerprint:null}),'23514',true);
    await db.query('select checklist_replace_closing_ref($1,$2,$3,$4,$5)',[instance,item,actor,first.autoCompleteId,
      JSON.stringify({reportType:'am_prep',reportInstanceId:prep,reportSubmittedAt:'2026-11-04T01:00:00Z'})]);
    const historical=await submit(db);
    check(historical.autoCompleteId===first.autoCompleteId,'replay preserves historical push ID after closing replacement');
    check(historical.instance.status==='confirmed','confirmed instance still replays');
  });
  await isolated(db,'',async()=> {
    const first=await submit(db);
    const opts={head:first.submissionId,request:id(31),fingerprint:hash('edit')};
    const edit=await submit(db,opts), replay=await submit(db,opts);
    check(edit.editCount===1 && replay.editCount===1 && edit.submissionId===replay.submissionId,'edit retry consumes no slot');
    check(await count(db,'audit_log',`action='report.update'`)===1,'edit retry emits no SQL audit');
    await refuses(db,()=>submit(db,{...opts,fingerprint:hash('different')}),'prep_request_key_reused');
    await submit(db,{...opts,request:id(32)}); await submit(db,{...opts,request:id(33)});
    check((await submit(db,opts)).submissionId===edit.submissionId,'edit replays after cap');
    await refuses(db,()=>submit(db,{...opts,request:id(34)}),'P0001',true);
    check(await count(db,'checklist_submissions')===4,'different-key edits obey cap');
  });
  await isolated(db,'',async()=> {
    const first=await submit(db,{request:null,fingerprint:null});
    check(first.autoCompleteId!==null && !first.replayed,'legacy original pushes closing ref');
    const edit=await submit(db,{request:null,fingerprint:null,head:first.submissionId});
    check(edit.editCount===1 && edit.autoCompleteId===null,'legacy edit retained');
    await submit(db,{request:null,fingerprint:null,head:first.submissionId});
    check(await count(db,'checklist_submissions')===3,'no-key identical edits remain separate');
    check(await count(db,'checklist_submissions','client_request_id is not null')===0,'legacy rows remain null');
  });
  for(const [change,reason] of [
    [`update checklist_completions set revoked_at=clock_timestamp()`,'closing_ref_revoked'],
    [`insert into checklist_completions(instance_id,template_item_id,completed_by,revoked_at) values('${instance}','${item}','${actor}',clock_timestamp())`,'closing_ref_multiple_heads']
  ]) await isolated(db,change,async()=> {
    const original=await submit(db,{request:null,fingerprint:null});
    check(original.autoCompleteId===null && original.closingRefSkip.reason===reason,'legacy closing skip '+reason);
  });
  await isolated(db,`alter function public.checklist_replace_closing_ref(uuid,uuid,uuid,uuid,jsonb) rename to original_replace;
    create function public.checklist_replace_closing_ref(uuid,uuid,uuid,uuid,jsonb) returns jsonb language sql as $$ select '{"result":"lost"}'::jsonb $$`,async()=> {
    await refuses(db,()=>submit(db,{request:null,fingerprint:null}),'closing_ref_changed');
    check(await count(db,'checklist_submissions')===0,'legacy closing race rolls back');
  });
  await isolated(db,`create function public.fail_0291() returns trigger language plpgsql as $$ begin raise exception 'injected_abort'; end $$;
    create trigger fail_0291 before update on checklist_instances for each row execute function public.fail_0291()`,async()=> {
    await refuses(db,()=>submit(db),'injected_abort');
    check(await count(db,'checklist_submissions')===0,'aborted transaction leaves no key row');
    check(await count(db,'checklist_completions',`instance_id='${prep}'`)===0,'abort leaves no completions');
    await db.exec('reset role; drop trigger fail_0291 on checklist_instances; set local role service_role');
    check(Boolean((await submit(db)).submissionId),'retry after transaction abort succeeds');
  });
}
async function contracts(db) {
  const body=read('0291_prep_submit_idempotency.sql');
  check(body.indexOf('WHERE id = p_prep_instance_id FOR NO KEY UPDATE')<body.indexOf('SELECT * INTO v_replay'),'AM parent lock precedes replay');
  check(body.lastIndexOf('SELECT * INTO v_replay')>body.indexOf('WHERE id = p_original_submission_id\n    FOR UPDATE'),'edit replay follows chain lock');
  check(body.lastIndexOf('SELECT * INTO v_replay')<body.indexOf('IF v_max_edit_count >= 3'),'edit replay precedes cap');
  const functions=(await db.query(`select oid,pronargs,prosecdef,proconfig from pg_proc where proname='submit_am_prep_atomic'`)).rows;
  check(functions.length===1 && functions[0].pronargs===11,'exactly one eleven-argument signature');
  check(functions[0].prosecdef && functions[0].proconfig.includes('search_path=pg_catalog, public'),'definer and search path');
  for(const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`); let error;
    try {await submit(db);} catch(e) {error=e;}
    await db.exec('reset role'); check(error?.code==='42501',role+' cannot execute');
  }
  check((await db.query(`select has_function_privilege('service_role',$1::oid,'EXECUTE') ok`,[functions[0].oid])).rows[0].ok,'service execute granted');
}
let db;
try {
  db=await setup();
  await db.exec(`insert into checklist_template_items(id,template_id,min_role_level,active) values('${prepItem}','${id(10)}',3,true)`);
  await contracts(db);
  // Mutation proof executes the same mismatch assertion against a broken body.
  const definition=(await db.query(`select pg_get_functiondef(oid) definition from pg_proc where proname='submit_am_prep_atomic'`)).rows[0].definition;
  await db.exec(definition.replaceAll('v_replay.client_request_hash IS DISTINCT FROM p_client_request_hash','false'));
  let detected=false;
  try {
    await isolated(db,'',async()=> {
      await submit(db);
      await refuses(db,()=>submit(db,{fingerprint:hash('changed')}),'prep_request_key_reused');
    });
  } catch(e) { detected=e.message.includes('expected prep_request_key_reused, got success'); }
  check(detected,'broken hash comparison must fail the real mismatch assertion');
  console.log('EXPECTED FAIL 0291 broken variant: changed intent under same key returned success; mismatch assertion caught it');
  await db.exec(definition);
  await behavior(db);
  console.log(`PASS 0291: ${checks} checks (including one expected mutation assertion failure); two-connection sim proof NOT RUN`);
} catch(e) { console.error(`FAIL 0291: ${e.stack??e}`); process.exitCode=1; }
finally { if(db) await db.close(); }
