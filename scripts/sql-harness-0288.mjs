/** Offline 0288 proof. Fixture copied from sql-harness-0287.mjs. Only ephemeral in-memory PGlite; no credentials or network.
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

const tightening = read('0288_checklist_confirm_filtered_only.sql');
const signature = 'public.checklist_confirm_instance(uuid,uuid,timestamptz,jsonb,uuid[])';
async function refused(db, statement, label) {
  const result = await attempt(db, statement);
  check(result === 'P0001:completion_set_changed', `${label}: ${result}`);
  const state = (await db.query(`select status,
    (select count(*)::int from checklist_submissions) as submissions,
    (select count(*)::int from checklist_incomplete_reasons) as reasons
    from checklist_instances where id=$1`, [instance])).rows[0];
  check(state.status === 'open' && state.submissions === 0 && state.reasons === 0,
    `${label}: no confirmation side effects`);
}

let db;
try {
  db = await setup();
  await db.exec(tightening);
  const catalog = (await db.query(`select prosecdef,proconfig,pg_get_functiondef(oid) as definition,
    has_function_privilege('anon',oid,'EXECUTE') as anon,
    has_function_privilege('authenticated',oid,'EXECUTE') as authenticated,
    has_function_privilege('service_role',oid,'EXECUTE') as service,
    exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner)))
      where grantee=0 and privilege_type='EXECUTE') as public_execute
    from pg_proc where oid=$1::regprocedure`, [signature])).rows[0];
  check(!catalog.prosecdef && catalog.proconfig.includes('search_path=pg_catalog, public'), 'invoker context');
  check(!catalog.anon && !catalog.authenticated && !catalog.public_execute && catalog.service, 'service-only grants');
  check(!catalog.definition.includes('v_live') && catalog.definition.includes('and superseded_at is null and revoked_at is null'), 'installed filtered-only query');
  const audit = (await db.query(`select * from audit_log where metadata->>'migration'='0288_checklist_confirm_filtered_only'`)).rows;
  check(audit.length === 1 && audit[0].action === 'security.grants_change' && audit[0].destructive
    && audit[0].metadata.actor_context === 'migration_apply'
    && audit[0].metadata.change === 'confirmation accepts only unrevoked live heads', 'one migration audit row');
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    let code;
    try { await db.query(calls.confirm); } catch (error) { code = error.code; }
    check(code === '42501', `${role} direct execution refused`);
    await db.exec('reset role');
  }
  console.log('0288 contracts: service-only grants, execution context, signature and audit verified');

  await db.exec('begin; set local role service_role');
  const revoked = id(90);
  await db.exec(`insert into checklist_completions(id,instance_id,template_item_id,completed_by,revoked_at)
    values('${revoked}','${instance}','${item}','${actor}',clock_timestamp())`);
  const legacy = calls.confirm.replace(`array['${completion}']`, `array['${completion}','${revoked}']`);
  await refused(db, legacy, 'legacy unfiltered set refused');
  check(await attempt(db, calls.confirm) === 'allowed', 'filtered set accepted');
  await db.exec('rollback');
  console.log('0288 confirmation: legacy unfiltered refused; filtered accepted');

  // Capture the actual app query, then commit a real correction in a separate
  // transaction before confirming. This proves ordering, not concurrent waits.
  const snapshot = (await db.query(`select id from checklist_completions
    where instance_id=$1 and superseded_at is null and revoked_at is null order by id`, [instance])).rows.map(row => row.id);
  check(snapshot.length === 1 && snapshot[0] === completion, 'snapshot before first revoke');
  await db.exec('begin; set local role service_role');
  await db.query(`select public.checklist_revoke_with_reason($1,$2,'other','a correction')`, [completion, actor]);
  await db.exec('commit');
  await db.exec('set role service_role');
  const stale = calls.confirm.replace(`array['${completion}']`, `array[${snapshot.map(quote).join(',')}]`);
  await refused(db, stale, 'committed first revoke invalidates snapshot');
  const fresh = calls.confirm.replace(`array['${completion}']::uuid[]`, "'{}'::uuid[]");
  check(await attempt(db, fresh) === 'allowed', 'fresh empty filtered snapshot accepted');
  await db.query(fresh);
  check((await db.query(`select status from checklist_instances where id=$1`, [instance])).rows[0].status === 'confirmed', 'fresh confirmation persisted');
  await db.exec('reset role');
  console.log('0288 revoke race: committed first revoke caught; fresh filtered snapshot accepted');

  // A rerun must fail closed, with no additional audit row.
  let refusal;
  try { await db.exec(tightening); } catch (error) { refusal = error.message; }
  await db.exec('rollback');
  check(refusal?.includes('0288: expected 0287 dual-accept confirmation'), 'preflight refuses filtered-only installed body');
  check((await db.query(`select count(*)::int as n from audit_log where metadata->>'migration'='0288_checklist_confirm_filtered_only'`)).rows[0].n === 1, 'preflight failure adds no audit row');
  console.log('0288 preflight: non-dual-accept body refused');
  console.log(`PASS 0288: ${checks} checks; two-connection sim proof NOT RUN`);
} catch (error) { console.error(`FAIL 0288: ${error.stack ?? error}`); process.exitCode = 1; }
finally { if (db) await db.close(); }
