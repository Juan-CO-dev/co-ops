/** Offline 0287 proof. Only ephemeral in-memory PGlite; no credentials or network.
 * PGlite has one backend, so lock presence is structural here. Real blocking and
 * winner/loser proof lives in sim/checklist-0287-lock-check.mjs (not run by CI).
 */
import { readFileSync } from 'node:fs';
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
    return db;
  } catch (e) { await db.close(); throw e; }
}

async function attempt(db, statement) {
  return (await db.query('select public.test_attempt($1) as result', [statement])).rows[0].result;
}

const correctionCalls = {
  quick: `select public.checklist_revoke_completion('${completion}','${actor}')`,
  reason: `select public.checklist_revoke_with_reason('${completion}','${actor}','other','a correction')`,
  authority: `select public.checklist_mark_not_done('${completion}','${other}','not done')`,
};
async function isolated(db, change, run) {
  await db.exec('begin');
  try { if (change) await db.exec(change); await db.exec('set local role service_role'); await run(); }
  finally { await db.exec('rollback'); }
}
async function expectRefusal(db, call, code, label) {
  const actual=await attempt(db,call);
  check(actual===`P0001:${code}`,`${label}: expected ${code}, got ${actual}`);
}
async function corrections(db) {
  await db.exec(`insert into user_locations values('${other}','${location}',true)`);
  for (const status of ['confirmed','incomplete_confirmed','closed']) {
    await isolated(db,`update checklist_instances set status='${status}'`,async()=> {
      for (const [name,call] of Object.entries(correctionCalls)) await expectRefusal(db,call,'instance_not_open',`${name} ${status}`);
    });
  }
  for (const [change,code] of [
    ["update checklist_template_items set report_reference_type='cash_report'",'reference_row_not_correctable'],
    ["update checklist_completions set prep_data='{}'",'prep_data_not_correctable'],
    ["update checklist_completions set prep_data='{\"phase2\":true}'",'prep_data_not_correctable'],
    ["update checklist_completions set superseded_at=clock_timestamp()",'completion_not_found'],
    ["update checklist_completions set revoked_at=clock_timestamp()",'completion_not_found'],
  ]) await isolated(db,change,async()=> {
    for (const [name,call] of Object.entries(correctionCalls)) await expectRefusal(db,call,code,`${name} ${code}`);
  });
  await isolated(db,'',async()=> {
    await expectRefusal(db,correctionCalls.quick,'outside_quick_window','quick expiry');
    await expectRefusal(db,correctionCalls.reason.replace("'other','a correction'","'other',' '"),'revocation_note_required','other requires note');
    await expectRefusal(db,correctionCalls.reason.replace("'other'","'bogus'"),'invalid_payload','invalid reason');
    await expectRefusal(db,correctionCalls.quick.replace(quote(actor),quote(other)),'not_self','self only');
    await expectRefusal(db,correctionCalls.authority.replace(quote(other),quote(actor)),'use_self_revoke','authority cross-user only');
    await expectRefusal(db,correctionCalls.authority.replace("'not done'","' '"),'revocation_note_required','authority note required');
    for (const call of Object.values(correctionCalls)) await expectRefusal(db,call.replace(quote(completion),quote(id(999))),'completion_not_found','missing target');
  });
  for (const setup of ["update checklist_completions set completed_at=clock_timestamp()",
    "update checklist_instances set status='confirmed'", "update users set active=false"]) {
    await isolated(db,setup,async()=> {
      await expectRefusal(db,correctionCalls.reason.replace("'other','a correction'","'other',' '"),'revocation_note_required','note precedes state');
      await expectRefusal(db,correctionCalls.reason.replace("'other'","'bogus'"),'invalid_payload','reason precedes state');
      await expectRefusal(db,correctionCalls.authority.replace("'not done'","' '"),'revocation_note_required','authority note precedes state');
    });
  }
  for (const [age,quick,reason] of [['30 seconds',true,false],['60 seconds',false,true],['61 seconds',false,true]]) {
    await isolated(db,`update checklist_completions set completed_at=clock_timestamp()-interval '${age}'`,async()=> {
      check((await attempt(db,correctionCalls.quick)==='allowed')===quick,`quick boundary ${age}`);
      check((await attempt(db,correctionCalls.reason)==='allowed')===reason,`reason boundary ${age}`);
      check((await attempt(db,correctionCalls.authority)==='allowed')===reason,`authority boundary ${age}`);
    });
  }
  await isolated(db,"update checklist_completions set completed_at=now()-interval '59.95 seconds'",async()=> {
    // A single backend cannot wait behind another session's row lock. This
    // transaction-age probe plus the structural lock/clock check detects now()
    // regressions; actual lock waits are the separately delivered sim proof.
    await new Promise(resolve=>setTimeout(resolve,100));
    await expectRefusal(db,correctionCalls.quick,'outside_quick_window','wall clock crosses 60s during transaction');
    check(await attempt(db,correctionCalls.reason)==='allowed','structured correction after transaction crosses 60s');
  });
  // This checks boundary acceptance and stored audit/attribution fields only.
  // The 59.95s + 100ms block above is the real now() vs wall-clock proof.
  await isolated(db,"update checklist_completions set completed_at=now()-interval '60 seconds'",async()=> {
    const result=(await db.query(correctionCalls.reason+' as result')).rows[0].result;
    check(Number.isInteger(result.elapsed_ms),'integer audit elapsed_ms');
    check(result.elapsed_ms>=60000,'elapsed measured at/after 60s boundary');
    check(new Date(result.completion.revoked_at).getTime()>=new Date(result.completion.completed_at).getTime()+60000,'stored correction timestamp is after boundary');
    check(result.completion.completed_by===actor && result.completion.revoked_by===actor,'append-only completion attribution');
    check(result.completion.revocation_reason==='other' && result.completion.revocation_note==='a correction','stored structured reason');
  });
  console.log('0287 correction behavior: non-open/reference/prep/live/window/reason refusals verified');
}
async function authorityParity(db) {
  const roles=[['prospect',0],['hired_not_yet_worked',1],['trainee',2],['employee',3],['trainer',4],['key_holder',4],['shift_lead',5],['agm',6],['catering_mgr',6],['prep_mgr',6],['social_media_mgr',6],['gm',7],['moo',8],['owner',9],['cgs',10]];
  let cases=0;
  for (const [role,level] of roles) for (const membership of ['active','inactive','missing']) {
    const member=membership!=='missing';
    await isolated(db,`update users set role='${role}' where id='${other}';
      update user_locations set active=${membership==='active'},location_id='${member?location:id(999)}' where user_id='${other}';`,async()=> {
      const result=await attempt(db,correctionCalls.authority);
      const allowed=level>=4 && (member || level>=8);
      check((result==='allowed')===allowed,`authority parity ${role}/${membership}: ${result}`);
      const self=correctionCalls.reason.replace(quote(actor),quote(other));
      await db.exec(`update checklist_completions set completed_by='${other}'`);
      check((await attempt(db,self)==='allowed')===(member||level>=8),`self membership parity ${role}/${membership}`);
      cases++;
    });
  }
  await isolated(db,`update users set role='owner' where id='${actor}'`,async()=> {
    await expectRefusal(db,correctionCalls.authority,'revoke_hierarchy_violation','cannot correct above current level');
  });
  await isolated(db,`update users set active=false where id='${actor}'`,async()=> {
    check(await attempt(db,correctionCalls.authority)==='allowed','inactive completer retains peer correction authority');
    await db.exec(`update users set role='owner' where id='${actor}'`);
    await expectRefusal(db,correctionCalls.authority,'revoke_hierarchy_violation','inactive completer retains current higher role');
  });
  await isolated(db,`update users set active=false where id='${other}'`,async()=> {
    await expectRefusal(db,correctionCalls.authority,'not_authorized','inactive actor');
  });
  console.log(`0287 authority: ${cases} role/membership cases; level 8+ without membership preserved`);
}
async function confirmation(db) {
  const revoked=id(90);
  await isolated(db,`insert into checklist_completions(id,instance_id,template_item_id,completed_by,revoked_at)
    values('${revoked}','${instance}','${item}','${actor}',clock_timestamp())`,async()=> {
    const legacy=calls.confirm.replace(`array['${completion}']`,`array['${completion}','${revoked}']`);
    check(await attempt(db,legacy)==='allowed','legacy unfiltered set passes');
    check(await attempt(db,calls.confirm)==='allowed','filtered set passes');
    await db.query(correctionCalls.reason);
    await expectRefusal(db,calls.confirm,'completion_set_changed','filtered stale revoke with prior revoked head');
    check(await attempt(db,legacy)==='allowed','legacy compatibility preserved after revoke');
    check(await attempt(db,calls.confirm.replace(`array['${completion}']::uuid[]`,"'{}'::uuid[]"))==='allowed','fresh filtered empty snapshot passes');
  });
  await isolated(db,'',async()=> {
    await db.query(correctionCalls.reason);
    // Ruling 4's two accepted sets cannot identify which deployment supplied [A].
    // Do not claim this first-revoke race is closed by the transitional migration.
    check(await attempt(db,calls.confirm)==='allowed','document dual-accept first-revoke ambiguity');
    await expectRefusal(db,calls.confirm.replace(completion,id(999)),'completion_set_changed','unknown snapshot rejected');
  });
  console.log('0287 dual accept: legacy + filtered pass; stale revoke with prior revoked head rejected');
  console.log('0287 KNOWN TRANSITION LIMITATION: first-revoke filtered snapshot also matches legacy set');
}
async function contracts(db) {
  const names=['checklist_revoke_completion','checklist_revoke_with_reason','checklist_mark_not_done'];
  const rows=(await db.query(`select proname,prosecdef,proconfig,pg_get_functiondef(oid) as definition from pg_proc where proname=any($1::text[])`,[names])).rows;
  check(rows.length===3,'exactly three correction RPCs');
  for (const row of rows) {
    check(!row.prosecdef && row.proconfig.includes('search_path=pg_catalog, public'),`${row.proname} invoker context`);
    const body=row.definition.replace(/--[^\n]*/g,'');
    check(/for no key update/i.test(body),`${row.proname} parent NO KEY UPDATE`);
    check(body.indexOf('clock_timestamp()')>body.toLowerCase().indexOf('for no key update'),`${row.proname} clock after parent lock`);
    check(body.toLowerCase().lastIndexOf('for no key update')>body.toLowerCase().indexOf('for no key update'),`${row.proname} completion lock after parent`);
  }
  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    for (const call of [...Object.values(correctionCalls),calls.confirm]) {
      let code; try { await db.query(call); } catch(e) {code=e.code;}
      check(code==='42501',`${role} direct RPC refused`);
    }
    await db.exec('reset role');
  }
  const signature=(await db.query(`select to_regprocedure('public.checklist_confirm_instance(uuid,uuid,timestamp with time zone,jsonb,uuid[])') is not null as valid`)).rows[0];
  check(signature.valid,'0277 asserted confirmation signature intact');
  console.log('0287 contracts: service-only ACLs, signatures, lock order and after-lock clock verified');
}
let db;
try {
  db=await setup();
  await contracts(db);
  await corrections(db);
  await authorityParity(db);
  await confirmation(db);
  console.log(`PASS 0287: ${checks} checks; two-connection sim proof NOT RUN`);
} catch(e) { console.error(`FAIL 0287: ${e.stack??e}`); process.exitCode=1; }
finally { if(db) await db.close(); }
