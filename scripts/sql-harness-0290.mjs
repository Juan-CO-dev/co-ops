/** Offline 0290 proof. Only ephemeral in-memory PGlite; no credentials or network.
 * PGlite has one backend, so lock presence is structural here. Real blocking
 * proof lives in sim/checklist-0290-lock-check.mjs (not run by CI).
 */
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { PGlite } from '@electric-sql/pglite';

const sql = readFileSync('supabase/migrations/0276_checklist_guarded_writers.sql', 'utf8').replace(/\r\n/g, '\n');
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
      create table audit_log(actor_id uuid,actor_role text,action text,resource_table text,resource_id uuid,destructive boolean,metadata jsonb);
      create table written_reports(id uuid primary key,submitted_by uuid,submitted_at timestamptz,location_id uuid,
        title text,body text,category text,visibility_min_level integer,last_edited_at timestamptz,edit_count integer default 0);
      create table users(id uuid primary key, role text not null, active boolean not null);
      create table user_locations(user_id uuid references users, location_id uuid, active boolean default true);
      create table sessions(id uuid primary key,user_id uuid references users,revoked_at timestamptz,expires_at timestamptz);
      create table checklist_templates(id uuid primary key,location_id uuid,type text,active boolean default true);
      create type report_type_enum as enum('am_prep','mid_day_prep','cash_report','opening_report','training_report','special_report','pm_report','receiving','counts','ordering');
      create table checklist_template_items(id uuid primary key,template_id uuid references checklist_templates,
        min_role_level integer,active boolean,report_reference_type report_type_enum,ref_track_item_completion boolean,
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
      add column original_completion_id uuid references checklist_completions, add column edit_count integer default 0;
      alter table checklist_submissions add column original_submission_id uuid references checklist_submissions,
      add column edit_count integer default 0;
      update checklist_template_items set report_reference_type='am_prep';
      insert into checklist_templates values('${id(10)}','${location}','am_prep',true);
      insert into checklist_instances(id,template_id,location_id) values('${id(11)}','${id(10)}','${location}');
      update checklist_completions set auto_complete_meta='{"reportType":"am_prep","reportInstanceId":"${id(11)}","reportSubmittedAt":"2026-11-03T08:00:00Z","count":1}';`);
    await db.exec(read('0186_am_prep_chain_edit_supersede.sql'));
    await db.exec(read('0288_checklist_confirm_filtered_only.sql'));
    await db.exec(read('0290_checklist_closing_ref_atomic.sql'));
    return db;
  } catch (e) { await db.close(); throw e; }
}

const meta = (count = 2, time = '2026-11-03T09:00:00Z') => ({
  reportType: 'am_prep', reportInstanceId: id(11), reportSubmittedAt: time, count,
});
async function replace(db, expected = completion, value = meta()) {
  return (await db.query('select public.checklist_replace_closing_ref($1,$2,$3,$4,$5) as result',
    [instance,item,actor,expected,JSON.stringify(value)])).rows[0].result;
}
async function isolated(db, change, run) {
  await db.exec('begin');
  try { if (change) await db.exec(change); await db.exec('set local role service_role'); await run(); }
  finally { await db.exec('rollback'); }
}
async function refuses(db, run, code) {
  await db.exec('savepoint refusal');
  let error;
  try { await run(); } catch(e) { error=e; }
  await db.exec('rollback to savepoint refusal');
  check(error?.message===code, `expected ${code}, got ${error?.message ?? 'success'}`);
}
async function rows(db) {
  return (await db.query('select * from checklist_completions where instance_id=$1 and template_item_id=$2 order by id',[instance,item])).rows;
}
async function behavior(db) {
  await isolated(db,'',async()=> {
    const result=await replace(db);
    check(result.result==='superseded','replacement result');
    const all=await rows(db), old=all.find(r=>r.id===completion), head=all.find(r=>r.id===result.completionId);
    check(all.length===2 && head && !head.superseded_at && !head.revoked_at,'one new live head');
    check(old.superseded_at && old.superseded_by===head.id,'complete predecessor link');
    check(head.completed_by===actor && head.completed_at && isDeepStrictEqual(head.auto_complete_meta,meta()),'actor/time/report provenance');
    check((await replace(db,completion)).result==='lost','stale expected head loses');
  });
  for (const event of ['insert','link']) {
    await isolated(db,`create function public.fail_0290() returns trigger language plpgsql as $$ begin
      if TG_OP='INSERT' or NEW.superseded_by is not null then raise exception 'injected_0290_failure'; end if;
      return NEW; end $$;
      create trigger fail_0290 before ${event==='insert'?'insert':'update'} on checklist_completions
        for each row execute function public.fail_0290();`,async()=> {
      await refuses(db,()=>replace(db),'injected_0290_failure');
      const all=await rows(db);
      check(all.length===1 && all[0].id===completion && !all[0].superseded_at && !all[0].superseded_by,'failure after supersede rolls back head and insert');
    });
  }
  await isolated(db,`delete from checklist_completions where id='${completion}'`,async()=> {
    check((await replace(db,null)).result==='inserted','first empty-head insert');
    check((await replace(db,null)).result==='lost','second first-insert snapshot loses');
    check((await rows(db)).length===1,'two first insert snapshots produce one head');
  });
  await isolated(db,`update checklist_completions set revoked_at=clock_timestamp()`,async()=> {
    await refuses(db,()=>replace(db,null),'closing_ref_revoked');
    await refuses(db,()=>replace(db,completion),'closing_ref_revoked');
    const all=await rows(db);
    check(all.length===1 && all[0].revoked_at && !all[0].superseded_at,'manager revoke wins');
  });
  // The production partial index excludes revoked rows, so this ambiguity is
  // reachable without disabling the index. Both unsuperseded heads must count.
  await isolated(db,`insert into checklist_completions(instance_id,template_item_id,completed_by,revoked_at)
    values('${instance}','${item}','${actor}',clock_timestamp())`,async()=> {
    await refuses(db,()=>replace(db),'closing_ref_multiple_heads');
    await refuses(db,()=>replace(db,null),'closing_ref_multiple_heads');
    check((await rows(db)).length===2,'ambiguous heads untouched');
  });
  await isolated(db,`insert into checklist_completions(id,instance_id,template_item_id,completed_by,prep_data)
    values('${id(15)}','${instance}','${item}','${actor}','{"phase2":true}')`,async()=> {
    check((await replace(db)).result==='superseded','different phase head is not ambiguous');
    const phase=(await rows(db)).find(row=>row.id===id(15));
    check(phase && !phase.superseded_at && !phase.revoked_at,'phase two head preserved');
  });
  await isolated(db,`update checklist_instances set status='confirmed' where id='${instance}'`,async()=> {
    check((await replace(db)).result==='superseded','confirmed closing reconciliation scope preserved');
  });
  await isolated(db,`update checklist_template_items set report_reference_type=null,
    ref_track_item_completion=true,references_template_item_id='${id(16)}' where id='${item}'`,async()=> {
    const tracked={refTrack:true,referencedTemplateItemId:id(16),reportInstanceId:id(11),reportSubmittedAt:'2026-11-03T09:00:00Z'};
    await refuses(db,()=>replace(db,completion,{...tracked,referencedTemplateItemId:id(17)}),'invalid_payload');
    await refuses(db,()=>replace(db,completion,{...tracked,refTrack:false}),'invalid_payload');
    const result=await replace(db,completion,tracked);
    check(result.result==='superseded','tracked reference with matching target is supported');
    check(isDeepStrictEqual((await rows(db)).find(row=>row.id===result.completionId).auto_complete_meta,tracked),'tracked reference provenance preserved');
  });
  // AM submit exercises the actual re-emitted function, including its full
  // transaction: AM commits while revoked/ambiguous closing heads stay untouched.
  for (const [change,code] of [
    [`update checklist_completions set revoked_at=clock_timestamp()`,'closing_ref_revoked'],
    [`insert into checklist_completions(instance_id,template_item_id,completed_by,revoked_at)
      values('${instance}','${item}','${actor}',clock_timestamp())`,'closing_ref_multiple_heads'],
  ]) await isolated(db,change,async()=> {
    const before=await rows(db);
    const result=(await db.query('select public.submit_am_prep_atomic($1,$2,$3,$4) as result',[id(11),actor,'[]',item])).rows[0].result;
    check(result.autoCompleteId===null,'skipped push has no completion id');
    check(isDeepStrictEqual(result.closingRefSkip,{instanceId:instance,itemId:item,reason:code}),'skip carries audit identifiers/reason');
    check((await db.query('select status from checklist_instances where id=$1',[id(11)])).rows[0].status==='confirmed','AM commits despite skipped push');
    check((await db.query('select count(*)::int as n from checklist_submissions')).rows[0].n===1,'AM submission retained');
    check(isDeepStrictEqual(await rows(db),before),'closing line untouched, manager revoke wins');
  });
  await isolated(db,`update checklist_instances set status='confirmed' where id='${id(11)}';
    update checklist_instances set date=date+1 where id='${instance}'`,async()=> {
    await db.exec('savepoint precedence');
    let error;
    try { await db.query('select public.submit_am_prep_atomic($1,$2,$3,$4)',[id(11),actor,'[]',item]); } catch(e) { error=e; }
    await db.exec('rollback to savepoint precedence');
    check(error?.code==='23514','already confirmed AM precedes missing closing');
  });
  // Inject an uncooperative head change between pre-check and RPC CAS.
  await isolated(db,`alter function public.checklist_replace_closing_ref(uuid,uuid,uuid,uuid,jsonb) rename to original_replace;
    create function public.checklist_replace_closing_ref(uuid,uuid,uuid,uuid,jsonb) returns jsonb
    language sql as $$ select '{"result":"lost"}'::jsonb $$;`,async()=> {
    const before=await rows(db);
    await refuses(db,()=>db.query('select public.submit_am_prep_atomic($1,$2,$3,$4)',[id(11),actor,'[]',item]),'closing_ref_changed');
    check((await db.query('select status from checklist_instances where id=$1',[id(11)])).rows[0].status==='open','true race rolls AM back');
    check((await db.query('select count(*)::int as n from checklist_submissions')).rows[0].n===0,'true race rolls submission back');
    check(isDeepStrictEqual(await rows(db),before),'true race preserves closing');
  });
  await isolated(db,'',async()=> {
    const result=(await db.query('select public.submit_am_prep_atomic($1,$2,$3,$4) as result',[id(11),actor,'[]',item])).rows[0].result;
    const all=await rows(db);
    check(result.autoCompleteId && all.length===2 && all.find(r=>r.id===completion).superseded_by===result.autoCompleteId,'AM push uses atomic replacement/link');
  });
  await isolated(db,`update checklist_template_items set report_reference_type='mid_day_prep';
    update checklist_completions set auto_complete_meta=jsonb_build_object('reportType','mid_day_prep',
      'reportInstanceId','${id(11)}','reportSubmittedAt','2026-11-03T12:00:00Z','count',2);
    update checklist_instances set confirmed_at='2026-11-03T09:00:00Z' where id='${id(11)}';
    insert into checklist_instances(id,template_id,location_id,confirmed_at)
      values('${id(12)}','${id(10)}','${location}','2026-11-03T10:00:00Z');`,async()=> {
    const proposed=(count,time,report=id(12))=>({reportType:'mid_day_prep',reportInstanceId:report,reportSubmittedAt:time,count});
    check((await replace(db,completion,proposed(1,'2026-11-03T10:00:00Z'))).result==='skipped','stale lower count cannot regress');
    check((await replace(db,completion,proposed(2,'2026-11-03T08:00:00Z'))).result==='skipped','stale equal-count earlier report cannot regress');
    check((await replace(db,completion,proposed(2,'2026-11-03T09:00:00Z'))).result==='skipped','equal confirmation time cannot churn');
    check((await rows(db)).length===1,'monotonic refusals append nothing');
    const repaired=await replace(db,completion,proposed(2,'2026-11-03T09:00:00Z',id(11)));
    check(repaired.result==='superseded','same-report incorrect stored timestamp can be repaired');
    check((await replace(db,repaired.completionId,proposed(2,'2026-11-03T09:00:00Z',id(11)))).result==='skipped','repeated reconciliation causes no churn');
    const newer=await replace(db,repaired.completionId,proposed(2,'2026-11-03T10:00:00Z'));
    check(newer.result==='superseded','newer equal-count report advances');
    check((await rows(db)).length===3,'only repair and newer report append');
  });
  await isolated(db,`update checklist_template_items set report_reference_type='mid_day_prep';
    update checklist_completions set auto_complete_meta=jsonb_build_object('reportType','mid_day_prep',
      'reportInstanceId','${id(11)}','reportSubmittedAt','2026-11-03T12:00:00Z','count',2);
    update checklist_instances set confirmed_at='2026-11-03T09:00:00Z' where id='${id(11)}';`,async()=> {
    check((await replace(db,completion,{reportType:'mid_day_prep',reportInstanceId:id(12),
      reportSubmittedAt:'2026-11-03T10:00:00Z',count:2})).result==='superseded','actual confirmation beats incorrect later stored load time');
  });
  console.log('0290 monotonicity: count/time regressions refused, actual confirmation preferred, timestamp repair and repeated reconcile verified');
  console.log('0290 behavior: rollback after supersede/insert, first-insert CAS, provenance/link, revoked and multiple-head refusals, confirmed reconcile, AM push verified');
}
async function contracts(db) {
  const defs=(await db.query(`select proname,prosecdef,proconfig,pg_get_functiondef(oid) as definition from pg_proc
    where proname in ('checklist_replace_closing_ref','submit_am_prep_atomic')`)).rows;
  check(defs.length===2,'one signature per RPC');
  for (const row of defs) {
    check(row.prosecdef===(row.proname==='submit_am_prep_atomic'),`${row.proname} security mode preserved`);
    check(row.proconfig.some(s=>s.includes('pg_catalog')&&s.includes('public')),'explicit search path');
    check(/for no key update/i.test(row.definition),'parent NO KEY UPDATE');
  }
  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    let code;
    try { await replace(db); } catch(e) {code=e.code;}
    check(code==='42501',`${role} replace RPC refused`);
    code=undefined;
    try { await db.query('select public.submit_am_prep_atomic($1,$2,$3,$4)',[id(11),actor,'[]',item]); } catch(e) {code=e.code;}
    check(code==='42501',`${role} AM RPC refused`);
    await db.exec('reset role');
  }
  check((await db.query(`select to_regprocedure('public.checklist_confirm_instance(uuid,uuid,timestamptz,jsonb,uuid[])') is not null as ok`)).rows[0].ok,'0277 confirm signature preserved');
  console.log('0290 contracts: service-only ACLs, security modes, signatures and parent lock verified');
}
let db;
try {
  db=await setup();
  await contracts(db);
  await behavior(db);
  console.log(`PASS 0290: ${checks} checks; two-connection sim proof NOT RUN`);
} catch(e) { console.error(`FAIL 0290: ${e.stack??e}`); process.exitCode=1; }
finally { if(db) await db.close(); }
