-- CC SIM ONLY, after 0230. Owner connection; every fixture change rolls back.
-- psql -v ON_ERROR_STOP=1 -f scripts/test-station-lifecycle.sql
-- Do not run against production. Requires the existing named sim sentinel.
begin;
set local plpgsql.check_asserts=on;
do $$ begin
  if not exists(select 1 from public.users where email='maya@sim.co-ops') then
    raise exception 'SIM ONLY';
  end if;
  assert to_regprocedure('public.reconcile_station_lifecycle(uuid,date)') is not null,'0230 required';
  assert not exists(select 1 from information_schema.routine_privileges
    where routine_schema='public' and routine_name in
      ('station_closures','reconcile_station_lifecycle','write_station_break')
      and grantee in ('PUBLIC','anon','authenticated') and privilege_type='EXECUTE'), 'RPC grants';
  assert (select relrowsecurity from pg_class where oid='public.station_break_events'::regclass),'break RLS';
  assert not exists(select 1 from information_schema.role_table_grants
    where table_schema='public' and table_name='station_break_events'
      and (grantee in ('PUBLIC','anon','authenticated') or
        (grantee='service_role' and privilege_type in ('UPDATE','DELETE','TRUNCATE')))), 'break ledger grants';
end $$;
set local role authenticated;
do $$ begin
  begin perform public.reconcile_station_lifecycle(gen_random_uuid(),current_date);
    raise exception 'staff reconcile allowed'; exception when insufficient_privilege then null; end;
  begin perform public.write_station_break(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),true);
    raise exception 'staff break RPC allowed'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.station_break_events;
    raise exception 'staff break read allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform public.reconcile_station_lifecycle(gen_random_uuid(),current_date);
    raise exception 'anon reconcile allowed'; exception when insufficient_privilege then null; end;
  begin perform public.write_station_break(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),true);
    raise exception 'anon break RPC allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;

do $$
declare
  loc uuid; people uuid[]; hi uuid; lo uuid; crew uuid;
  s uuid; p1 uuid; p2 uuid; template uuid; instance uuid; item1 uuid; item2 uuid;
  completion uuid; task uuid; entry text:=gen_random_uuid()::text; next_entry text:=gen_random_uuid()::text;
  future_entry text:=gen_random_uuid()::text;
  day date:=(clock_timestamp() at time zone 'America/New_York')::date;
  station_name text:='SIM lifecycle '||gen_random_uuid();
  result jsonb; head public.station_events%rowtype; stamp timestamptz; count_before bigint;
begin
  select location_id,array_agg(user_id order by user_id) into loc,people
    from public.user_locations where active group by location_id having count(*)>=3 order by location_id limit 1;
  assert loc is not null,'requires three sim memberships at one shop';
  hi:=people[1]; lo:=people[2]; crew:=people[3];
  update public.locations set active=true where id=loc;
  update public.users set active=true,role='gm' where id=hi;
  update public.users set active=true,role='key_holder' where id=lo;
  update public.users set active=true,role='employee' where id=crew;
  -- Isolate mirror/assignment fixtures, preserving all rows; ROLLBACK restores them.
  update public.toast_time_entries set deleted=true where location_id=loc and user_id=any(people[1:3]);
  update public.report_assignments set active=false where location_id=loc and assignee_id=any(people[1:3]);
  update public.checklist_instances set shift_start_at=clock_timestamp()-interval '17 hours'
    where location_id=loc and date<day and status='open';
  assert public.station_business_date(loc)=day,'fixture must use today';
  perform public.write_station_break(hi,crew,loc,false);
  perform public.write_station_break(hi,lo,loc,false);
  perform public.write_station_event(hi,crew,loc,null,null,true,'correction',null);
  perform public.write_station_event(hi,lo,loc,null,null,true,'correction',null);
  insert into public.stations(location_id,name,name_es,staffed)
    values(loc,station_name,'SIM ciclo',true) returning id into s;
  insert into public.station_positions(station_id,location_id,name,sort) values(s,loc,'one',1) returning id into p1;
  insert into public.station_positions(station_id,location_id,name,sort) values(s,loc,'two',2) returning id into p2;
  insert into public.checklist_templates(location_id,type,name,active,single_submission_only,created_by)
    values(loc,'closing',station_name,true,false,hi) returning id into template;
  insert into public.checklist_template_items(template_id,station,label,display_order,min_role_level,required,active,expects_count,expects_photo)
    values(template,station_name,'First close item',1,3,true,true,false,false) returning id into item1;
  insert into public.checklist_template_items(template_id,station,label,display_order,min_role_level,required,active,expects_count,expects_photo)
    values(template,station_name,'Second close item',2,3,true,true,false,false) returning id into item2;
  insert into public.checklist_instances(template_id,location_id,date,shift_start_at,status,triggered_by_user_id,triggered_at)
    values(template,loc,day,clock_timestamp(),'open',hi,clock_timestamp()) returning id into instance;

  -- Section closure is synchronous with the final check, without a board refresh/pull.
  perform public.write_station_event(hi,crew,loc,s,p1,true);
  perform public.write_station_event(hi,lo,loc,s,p2,true);
  insert into public.checklist_completions(instance_id,template_item_id,completed_by)
    values(instance,item1,crew);
  assert not exists(select 1 from public.station_closures(loc,day) c where c.station_id=s),'partial section stays open';
  insert into public.checklist_completions(instance_id,template_item_id,completed_by)
    values(instance,item2,crew) returning id into completion;
  assert exists(select 1 from public.station_closures(loc,day) c where c.station_id=s and closed_at is not null),'complete section closes';
  select * into head from public.station_events where location_id=loc and business_date=day and user_id=crew order by sequence desc limit 1;
  assert head.kind='release' and head.actor_id is null and head.reason_code='station_closed' and head.prior_position_id=p1,'closure system release evidence';
  select * into head from public.station_events where location_id=loc and business_date=day and user_id=lo order by sequence desc limit 1;
  assert head.kind='release' and head.reason_code='station_closed' and head.prior_position_id=p2,'all section positions released';
  begin perform public.write_station_event(crew,crew,loc,s,p1,false);
    raise exception 'closed station claim allowed';
  exception when raise_exception then if sqlerrm<>'station_closed' then raise; end if; end;
  begin perform public.write_station_event(hi,crew,loc,s,p1,true);
    raise exception 'closed station assignment allowed';
  exception when raise_exception then if sqlerrm<>'station_closed' then raise; end if; end;
  update public.checklist_completions set revoked_at=clock_timestamp(),revoked_by=crew where id=completion;
  assert not exists(select 1 from public.station_closures(loc,day) c where c.station_id=s),'retract reopens';
  select * into head from public.station_events where location_id=loc and business_date=day and user_id=crew order by sequence desc limit 1;
  assert head.station_id is null,'reopen restores nobody';
  perform public.write_station_event(crew,crew,loc,s,p1,false); -- prior assigned lock cleared
  perform public.write_station_event(hi,crew,loc,null,null,true);

  -- A manager can send someone on break without cover or a higher-author reason.
  begin perform public.write_station_break(crew,lo,loc,true);
    raise exception 'employee sent teammate on break';
  exception when raise_exception then if sqlerrm<>'role_insufficient' then raise; end if; end;
  begin perform public.write_station_break(lo,hi,loc,true);
    raise exception 'KH sent higher manager on break';
  exception when raise_exception then if sqlerrm<>'role_insufficient' then raise; end if; end;
  result:=public.write_task_assignment(hi,loc,crew,'am_prep',null,null);
  task:=(result->>'id')::uuid;
  -- SQL CHECK must reject NULL (PostgreSQL otherwise treats UNKNOWN as success).
  begin
    insert into public.assignment_changes(assignment_id,location_id,operational_date,report_type,
      actor_id,kind,reason_code,subject_user_id,effective_at)
      values(task,loc,day,'am_prep',null,'auto_release',null,crew,clock_timestamp());
    raise exception 'NULL system reason allowed';
  exception when check_violation then null; end;
  perform public.write_station_event(hi,crew,loc,s,p1,true);
  perform public.write_station_break(lo,crew,loc,true);
  select * into head from public.station_events where location_id=loc and business_date=day and user_id=crew order by sequence desc limit 1;
  assert head.kind='release' and head.reason_code='on_break' and head.prior_position_id=p1,'break leaves spot open for cover';
  assert (select active from public.report_assignments where id=task),'break never touches tasks';
  perform public.write_station_event(lo,lo,loc,s,p1,false); -- manager covers themselves
  begin perform public.write_station_event(crew,crew,loc,s,p2,false);
    raise exception 'on-break claim allowed';
  exception when raise_exception then if sqlerrm<>'on_break' then raise; end if; end;
  perform public.write_station_break(crew,crew,loc,false);
  select * into head from public.station_events where location_id=loc and business_date=day and user_id=crew order by sequence desc limit 1;
  assert head.station_id is null,'back from break restores nobody';
  perform public.write_station_event(crew,crew,loc,s,p2,false); -- may pick another open position
  perform public.write_station_break(crew,crew,loc,true); -- self break
  result:=public.write_station_break(crew,crew,loc,true);
  assert result->>'changed'='false','repeated break is idempotent';
  perform public.write_station_break(crew,crew,loc,false);
  perform public.write_station_event(lo,lo,loc,null,null,false);
  perform public.write_station_event(crew,crew,loc,s,p1,false); -- may reclaim original spot
  perform public.write_station_event(hi,crew,loc,null,null,true);
  perform public.write_station_event(hi,crew,loc,s,p1,true);
  begin perform public.write_station_event(lo,crew,loc,s,p2,true);
    raise exception 'human higher-author reason bypass';
  exception when raise_exception then if sqlerrm<>'override_reason_required' then raise; end if; end;

  -- Pull reconciliation releases only pre-clock-out work, once, with source time.
  stamp:=clock_timestamp();
  insert into public.toast_time_entries(location_id,time_entry_guid,business_date,employee_guid,user_id,in_at,out_at)
    values(loc,entry,day,gen_random_uuid()::text,crew,stamp-interval '1 hour',stamp);
  insert into public.toast_time_entries(location_id,time_entry_guid,business_date,employee_guid,user_id,in_at)
    values(loc,future_entry,day,gen_random_uuid()::text,crew,stamp+interval '1 hour');
  assert exists(select 1 from public.station_clocked_out(loc,day) c where c.user_id=crew),
    'future open entry cannot suppress an actual departure';
  update public.toast_time_entries set deleted=true where location_id=loc and time_entry_guid=future_entry;
  perform public.reconcile_station_lifecycle(loc,day);
  select * into head from public.station_events where location_id=loc and business_date=day and user_id=crew order by sequence desc limit 1;
  assert head.kind='release' and head.actor_id is null and head.reason_code='clocked_out'
    and head.prior_position_id=p1 and head.effective_at=stamp,'clock-out station evidence';
  assert not (select active from public.report_assignments where id=task),'clock-out unassigns open task';
  assert exists(select 1 from public.assignment_changes where assignment_id=task and kind='auto_release'
    and actor_id is null and reason_code='clocked_out' and subject_user_id=crew and effective_at=stamp),'task source attribution';
  select count(*) into count_before from public.station_events where location_id=loc and business_date=day;
  perform public.reconcile_station_lifecycle(loc,day);
  assert (select count(*) from public.station_events where location_id=loc and business_date=day)=count_before,'station retry idempotent';
  assert (select count(*) from public.assignment_changes where assignment_id=task and kind='auto_release')=1,'task retry idempotent';
  begin perform public.write_station_event(crew,crew,loc,s,p1,false);
    raise exception 'clocked-out claim allowed';
  exception when raise_exception then if sqlerrm<>'clocked_out' then raise; end if; end;

  -- Later open entry means returned, with no restoration and no stale re-release.
  insert into public.toast_time_entries(location_id,time_entry_guid,business_date,employee_guid,user_id,in_at)
    values(loc,next_entry,day,gen_random_uuid()::text,crew,clock_timestamp());
  perform public.reconcile_station_lifecycle(loc,day);
  select * into head from public.station_events where location_id=loc and business_date=day and user_id=crew order by sequence desc limit 1;
  assert head.station_id is null and not (select active from public.report_assignments where id=task),'re-clock-in restores nothing';
  perform public.write_station_event(crew,crew,loc,s,p1,false);
  result:=public.write_task_assignment(hi,loc,crew,'am_prep',null,null);
  task:=(result->>'id')::uuid;
  perform public.reconcile_station_lifecycle(loc,day);
  select * into head from public.station_events where location_id=loc and business_date=day and user_id=crew order by sequence desc limit 1;
  assert head.position_id=p1 and (select active from public.report_assignments where id=task),'later open entry protects new work';
  -- A late Toast correction for an earlier exit must not erase newer human work.
  -- Mirror updates are normal; assignment timestamps are explicit here because
  -- now() defaults share the enclosing fixture transaction's start timestamp.
  update public.report_assignments set created_at=clock_timestamp() where id=task;
  update public.toast_time_entries set deleted=true where location_id=loc and time_entry_guid=next_entry;
  perform public.reconcile_station_lifecycle(loc,day);
  select * into head from public.station_events where location_id=loc and business_date=day and user_id=crew order by sequence desc limit 1;
  assert head.position_id=p1 and (select active from public.report_assignments where id=task),'old clock-out preserves newer work';
  -- A departure during a break ends the break and converts its still-vacant
  -- cover hint to clock-out evidence, without restoring a holder on return.
  update public.toast_time_entries set deleted=false where location_id=loc and time_entry_guid=next_entry;
  perform public.write_station_break(crew,crew,loc,true);
  update public.toast_time_entries set out_at=clock_timestamp() where location_id=loc and time_entry_guid=next_entry;
  perform public.reconcile_station_lifecycle(loc,day);
  assert not (select on_break from public.station_break_events where location_id=loc and business_date=day and user_id=crew order by sequence desc limit 1),
    'departure clears break';
  select * into head from public.station_events where location_id=loc and business_date=day and user_id=crew order by sequence desc limit 1;
  assert head.reason_code='clocked_out' and head.prior_position_id=p1,'break vacancy becomes departure evidence';
  select count(*) into count_before from public.station_break_events where location_id=loc and business_date=day;
  perform public.reconcile_station_lifecycle(loc,day);
  assert (select count(*) from public.station_break_events where location_id=loc and business_date=day)=count_before,'break departure retry idempotent';
  raise notice 'station lifecycle assertions PASS; rolling back all fixtures';
end $$;
rollback;
