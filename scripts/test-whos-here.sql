-- CC SIM ONLY, after 0233. Owner connection; every fixture change rolls back.
-- psql -v ON_ERROR_STOP=1 -f scripts/test-whos-here.sql
-- Do not run against production. Requires the existing named sim sentinel.
-- Covers: A links (gates, uniqueness, backfill, trigger, unlink, 0230 clock-out release through a
-- link), B end_shift (self, KH+ with the 0228 reason rule, breaks, idempotency), C the shop-closed
-- net (closing finalize trigger, idempotent re-run, non-closing flips ignored).
begin;
set local plpgsql.check_asserts=on;
do $$ begin
  if not exists(select 1 from public.users where email='maya@sim.co-ops') then
    raise exception 'SIM ONLY';
  end if;
  assert to_regprocedure('public.end_shift(uuid,uuid,uuid,text,text)') is not null,'0233 required';
  assert not exists(select 1 from information_schema.routine_privileges
    where routine_schema='public' and routine_name in
      ('link_toast_employee','unlink_toast_employee','end_shift','release_shop_closed','toast_link_actor_level','whos_here_audit')
      and grantee in ('PUBLIC','anon','authenticated') and privilege_type='EXECUTE'), 'RPC grants';
  assert (select relrowsecurity from pg_class where oid='public.toast_employee_links'::regclass),'links RLS';
  assert (select relrowsecurity from pg_class where oid='public.shift_ends'::regclass),'shift ends RLS';
  assert not exists(select 1 from information_schema.role_table_grants
    where table_schema='public' and table_name in ('toast_employee_links','shift_ends')
      and (grantee in ('PUBLIC','anon','authenticated') or
        (grantee='service_role' and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')))), 'ledger grants';
end $$;
set local role authenticated;
do $$ begin
  begin perform public.end_shift(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
    raise exception 'staff end_shift RPC allowed'; exception when insufficient_privilege then null; end;
  begin perform public.link_toast_employee(gen_random_uuid(),gen_random_uuid(),'g',gen_random_uuid(),'manual');
    raise exception 'staff link RPC allowed'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.toast_employee_links;
    raise exception 'staff link read allowed'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.shift_ends;
    raise exception 'staff shift_ends read allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform public.release_shop_closed(gen_random_uuid(),current_date);
    raise exception 'anon shop-closed RPC allowed'; exception when insufficient_privilege then null; end;
  begin perform public.unlink_toast_employee(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
    raise exception 'anon unlink RPC allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;

do $$
declare
  loc uuid; people uuid[]; hi uuid; lo uuid; crew uuid;
  s uuid; p1 uuid; p2 uuid; template uuid; instance uuid; other_template uuid; other_instance uuid; task uuid;
  g1 text:='sim-emp-'||gen_random_uuid(); g2 text:='sim-emp-'||gen_random_uuid();
  e1 text:=gen_random_uuid()::text; e2 text:=gen_random_uuid()::text;
  day date:=(clock_timestamp() at time zone 'America/New_York')::date;
  station_name text:='SIM whos-here '||gen_random_uuid();
  result jsonb; head public.station_events%rowtype; ends_before bigint; link_id uuid; stamp timestamptz;
begin
  select location_id,array_agg(user_id order by user_id) into loc,people
    from public.user_locations where active group by location_id having count(*)>=3 order by location_id limit 1;
  assert loc is not null,'requires three sim memberships at one shop';
  hi:=people[1]; lo:=people[2]; crew:=people[3];
  update public.locations set active=true where id=loc;
  update public.users set active=true,role='gm' where id=hi;
  update public.users set active=true,role='key_holder' where id=lo;
  update public.users set active=true,role='employee' where id=crew;
  -- Isolate fixtures, preserving rows; ROLLBACK restores them.
  update public.toast_employee_links set active=false,unlinked_at=clock_timestamp(),unlinked_by=hi
    where location_id=loc and active and user_id=any(people[1:3]);
  update public.toast_time_entries set deleted=true where location_id=loc and user_id=any(people[1:3]);
  update public.report_assignments set active=false where location_id=loc and assignee_id=any(people[1:3]);
  update public.checklist_instances set shift_start_at=clock_timestamp()-interval '17 hours'
    where location_id=loc and date<day and status='open';
  assert public.station_business_date(loc)=day,'fixture must use today';
  perform public.write_station_break(hi,crew,loc,false);
  perform public.write_station_break(hi,lo,loc,false);
  perform public.write_station_event(hi,crew,loc,null,null,true,'correction',null);
  perform public.write_station_event(hi,lo,loc,null,null,true,'correction',null);
  insert into public.stations(location_id,name,name_es,staffed) values(loc,station_name,'SIM aquí',true) returning id into s;
  insert into public.station_positions(station_id,location_id,name,sort) values(s,loc,'one',1) returning id into p1;
  insert into public.station_positions(station_id,location_id,name,sort) values(s,loc,'two',2) returning id into p2;

  -- ── A. Links ────────────────────────────────────────────────────────────────────────────
  insert into public.toast_time_entries(location_id,time_entry_guid,business_date,employee_guid,in_at,out_at)
    values(loc,e1,day-1,g1,clock_timestamp()-interval '30 hours',clock_timestamp()-interval '24 hours');
  assert (select user_id from public.toast_time_entries where location_id=loc and time_entry_guid=e1) is null,'no link, no user';
  begin perform public.link_toast_employee(crew,loc,g1,crew,'manual');
    raise exception 'employee linked'; exception when raise_exception then if sqlerrm<>'role_insufficient' then raise; end if; end;
  begin perform public.link_toast_employee(lo,loc,g1,crew,'manual');
    raise exception 'KH linked'; exception when raise_exception then if sqlerrm<>'role_insufficient' then raise; end if; end;
  begin perform public.link_toast_employee(hi,loc,g1,crew,'auto');
    raise exception 'auto with an actor'; exception when raise_exception then if sqlerrm<>'invalid_payload' then raise; end if; end;
  begin perform public.link_toast_employee(null,loc,g1,crew,'manual');
    raise exception 'manual without an actor'; exception when raise_exception then if sqlerrm<>'invalid_payload' then raise; end if; end;
  result:=public.link_toast_employee(hi,loc,g1,crew,'manual');
  assert result->>'changed'='true' and (result->>'backfilled')::int=1,'manual link backfills every date';
  link_id:=(result->>'id')::uuid;
  assert (select user_id from public.toast_time_entries where location_id=loc and time_entry_guid=e1)=crew,'backfilled user';
  assert (select linked_by from public.toast_employee_links where id=link_id)=hi,'linked_by recorded';
  result:=public.link_toast_employee(hi,loc,g1,crew,'manual');
  assert result->>'changed'='false','same link is idempotent';
  begin perform public.link_toast_employee(hi,loc,g1,lo,'manual');
    raise exception 'employee double-linked'; exception when raise_exception then if sqlerrm<>'employee_already_linked' then raise; end if; end;
  begin perform public.link_toast_employee(hi,loc,g2,crew,'manual');
    raise exception 'user double-linked'; exception when raise_exception then if sqlerrm<>'user_already_linked' then raise; end if; end;
  -- System auto link: no actor, source auto.
  result:=public.link_toast_employee(null,loc,g2,lo,'auto');
  assert (select source='auto' and linked_by is null from public.toast_employee_links where id=(result->>'id')::uuid),'auto link shape';
  -- Going forward: a pull upsert (no user_id in the payload) gets the user from the link.
  insert into public.toast_time_entries(location_id,time_entry_guid,business_date,employee_guid,in_at)
    values(loc,e2,day,g1,clock_timestamp()-interval '2 hours')
    on conflict (location_id,time_entry_guid) do update set in_at=excluded.in_at;
  assert (select user_id from public.toast_time_entries where location_id=loc and time_entry_guid=e2)=crew,'trigger fills new rows';
  update public.toast_time_entries set pulled_at=clock_timestamp() where location_id=loc and time_entry_guid=e2;
  assert (select user_id from public.toast_time_entries where location_id=loc and time_entry_guid=e2)=crew,'trigger keeps it on update';
  -- Unlink clears every date; a repeat is a no-op; an unknown id is refused.
  result:=public.unlink_toast_employee(hi,loc,link_id);
  assert result->>'changed'='true' and (result->>'cleared')::int=2,'unlink clears all dates';
  assert not exists(select 1 from public.toast_time_entries where location_id=loc and employee_guid=g1 and user_id is not null),'cleared';
  assert (select not active and unlinked_by=hi and unlinked_at is not null from public.toast_employee_links where id=link_id),'append-only unlink';
  result:=public.unlink_toast_employee(hi,loc,link_id);
  assert result->>'changed'='false','repeat unlink is a no-op';
  begin perform public.unlink_toast_employee(hi,loc,gen_random_uuid());
    raise exception 'unknown link'; exception when raise_exception then if sqlerrm<>'link_not_found' then raise; end if; end;
  begin perform public.unlink_toast_employee(lo,loc,link_id);
    raise exception 'KH unlinked'; exception when raise_exception then if sqlerrm<>'role_insufficient' then raise; end if; end;
  update public.toast_time_entries set pulled_at=clock_timestamp() where location_id=loc and time_entry_guid=e2;
  assert (select user_id from public.toast_time_entries where location_id=loc and time_entry_guid=e2) is null,'no stale user after unlink';
  result:=public.link_toast_employee(hi,loc,g1,crew,'manual');
  assert (select count(*) from public.toast_employee_links where location_id=loc and employee_guid=g1)=2,'re-link is a new row';
  -- Keep the open entry from blocking B (clocked_out guards); B uses CO-OPS presence only.
  update public.toast_time_entries set deleted=true where location_id=loc and time_entry_guid=e2;

  -- ── B. End my shift ─────────────────────────────────────────────────────────────────────
  perform public.write_station_event(crew,crew,loc,s,p1,false);
  result:=public.write_task_assignment(hi,loc,crew,'am_prep',null,null);
  task:=(result->>'id')::uuid;
  result:=public.end_shift(crew,crew,loc);
  assert result->>'changed'='true' and result->>'released_station'='true' and (result->>'released_tasks')::int=1,'self end';
  select * into head from public.station_events where location_id=loc and business_date=day and user_id=crew order by sequence desc limit 1;
  assert head.kind='release' and head.reason_code='ended_shift' and head.actor_id=crew and head.prior_position_id=p1
    and head.effective_at is not null,'ended_shift station trail';
  assert not (select active from public.report_assignments where id=task),'self end unassigns the task';
  assert exists(select 1 from public.assignment_changes where assignment_id=task and kind='auto_release' and reason_code='ended_shift'
    and actor_id=crew and subject_user_id=crew and overridden_assigner_id is null),'ended_shift task trail (self: no override)';
  select count(*) into ends_before from public.shift_ends where location_id=loc and user_id=crew;
  result:=public.end_shift(crew,crew,loc);
  assert result->>'changed'='false' and (select count(*) from public.shift_ends where location_id=loc and user_id=crew)=ends_before,'repeat tap is idempotent';
  -- A new claim after ending is a new shift (never blocked), and can be ended again.
  perform public.write_station_event(crew,crew,loc,s,p1,false);
  perform public.write_station_event(hi,crew,loc,null,null,true);
  -- KH+ ends someone else's shift: work given by a higher level needs a reason (0228).
  perform public.write_station_event(hi,crew,loc,s,p1,true);
  result:=public.write_task_assignment(hi,loc,crew,'am_prep',null,null);
  task:=(result->>'id')::uuid;
  begin perform public.end_shift(crew,lo,loc);
    raise exception 'employee ended a teammate'; exception when raise_exception then if sqlerrm<>'role_insufficient' then raise; end if; end;
  begin perform public.end_shift(lo,hi,loc);
    raise exception 'KH ended a GM'; exception when raise_exception then if sqlerrm<>'role_insufficient' then raise; end if; end;
  begin perform public.end_shift(lo,crew,loc);
    raise exception 'override without reason'; exception when raise_exception then if sqlerrm<>'override_reason_required' then raise; end if; end;
  begin perform public.end_shift(lo,crew,loc,'other','  ');
    raise exception 'blank Other note'; exception when raise_exception then if sqlerrm<>'invalid_payload' then raise; end if; end;
  result:=public.end_shift(lo,crew,loc,'coverage_change',null);
  assert result->>'changed'='true' and (result->>'overridden_assigner_id')::uuid=hi,'override evidence returned';
  assert exists(select 1 from public.shift_ends where id=(result->>'id')::uuid and actor_id=lo and user_id=crew
    and reason_code='coverage_change' and overridden_assigner_id=hi),'override evidence stored';
  assert exists(select 1 from public.assignment_changes where assignment_id=task and reason_code='ended_shift'
    and actor_id=lo and overridden_assigner_id=hi),'task override evidence';
  -- The GM ending a crew member's shift needs no reason (nothing was given by a higher level).
  perform public.write_station_event(lo,crew,loc,s,p2,true);
  result:=public.end_shift(hi,crew,loc);
  assert result->>'changed'='true' and result->>'overridden_assigner_id' is null,'no override for the senior';
  -- On break: the break ends and the cover hint becomes the ended-shift trail.
  perform public.write_station_event(crew,crew,loc,s,p1,false);
  perform public.write_station_break(crew,crew,loc,true);
  result:=public.end_shift(crew,crew,loc);
  assert not (select on_break from public.station_break_events where location_id=loc and business_date=day and user_id=crew order by sequence desc limit 1),'end clears break';
  select * into head from public.station_events where location_id=loc and business_date=day and user_id=crew order by sequence desc limit 1;
  assert head.reason_code='ended_shift' and head.prior_position_id=p1,'break vacancy becomes ended-shift evidence';

  -- ── C. Shop closed: finalizing the closing releases everything still held ─────────────────
  perform public.write_station_event(crew,crew,loc,s,p1,false);
  perform public.write_station_event(lo,lo,loc,s,p2,false);
  perform public.write_station_break(lo,lo,loc,true);
  result:=public.write_task_assignment(hi,loc,crew,'am_prep',null,null);
  task:=(result->>'id')::uuid;
  perform public.write_task_assignment(hi,loc,lo,'counts',null,null);
  -- A NON-closing instance leaving 'open' fires nothing.
  insert into public.checklist_templates(location_id,type,name,active,single_submission_only,created_by)
    values(loc,'opening',station_name,true,false,hi) returning id into other_template;
  insert into public.checklist_instances(template_id,location_id,date,shift_start_at,status,triggered_by_user_id,triggered_at)
    values(other_template,loc,day,clock_timestamp(),'open',hi,clock_timestamp()) returning id into other_instance;
  update public.checklist_instances set status='auto_finalized',finalized_at_actor_type='system_auto' where id=other_instance;
  assert not exists(select 1 from public.shift_ends where location_id=loc and business_date=day and kind='shop_closed'),'opening flip ignored';
  assert (select active from public.report_assignments where id=task),'opening flip released nothing';
  -- The closing finalize (any path: here the system auto-release shape).
  insert into public.checklist_templates(location_id,type,name,active,single_submission_only,created_by)
    values(loc,'closing',station_name,true,false,hi) returning id into template;
  insert into public.checklist_instances(template_id,location_id,date,shift_start_at,status,triggered_by_user_id,triggered_at)
    values(template,loc,day,clock_timestamp(),'open',hi,clock_timestamp()) returning id into instance;
  update public.checklist_instances set status='auto_finalized',finalized_at_actor_type='system_auto' where id=instance;
  assert (select count(*) from public.shift_ends where location_id=loc and business_date=day and kind='shop_closed'
    and user_id is null and actor_id is null)=1,'one shop-closed marker';
  select * into head from public.station_events where location_id=loc and business_date=day and user_id=crew order by sequence desc limit 1;
  assert head.kind='release' and head.actor_id is null and head.reason_code='shop_closed' and head.prior_position_id=p1,'holder released';
  select * into head from public.station_events where location_id=loc and business_date=day and user_id=lo order by sequence desc limit 1;
  assert head.reason_code='shop_closed' and head.prior_position_id=p2,'on-break cover hint released';
  assert (select not on_break and actor_id is null and reason_code='shop_closed' from public.station_break_events
    where location_id=loc and business_date=day and user_id=lo order by sequence desc limit 1),'break ended at close';
  assert not exists(select 1 from public.report_assignments where location_id=loc and operational_date=day and active
    and assignee_id=any(people[1:3])),'no task stays held overnight';
  assert exists(select 1 from public.assignment_changes where assignment_id=task and kind='auto_release' and reason_code='shop_closed'
    and actor_id is null and subject_user_id=crew),'shop_closed task trail';
  assert exists(select 1 from public.audit_log where action='shift.system_end' and actor_id is null and destructive=false
    and metadata->>'reason'='shop_closed' and (metadata->>'location_id')::uuid=loc),'one system audit row';
  result:=public.release_shop_closed(loc,day);
  assert (result->>'stations_released')::int=0 and (result->>'tasks_released')::int=0 and (result->>'breaks_ended')::int=0,'re-run is a no-op';
  assert (select count(*) from public.shift_ends where location_id=loc and business_date=day and kind='shop_closed')=1,'marker stays unique';

  -- ── A (end). Through the link, a Toast clock-out now releases via 0230's reconcile ──────────
  perform public.write_station_event(crew,crew,loc,s,p1,false);
  stamp:=clock_timestamp();
  insert into public.toast_time_entries(location_id,time_entry_guid,business_date,employee_guid,in_at,out_at)
    values(loc,gen_random_uuid()::text,day,g1,stamp-interval '1 hour',stamp);
  assert exists(select 1 from public.station_clocked_out(loc,day) c where c.user_id=crew),'linked clock-out is visible to 0230';
  perform public.reconcile_station_lifecycle(loc,day);
  select * into head from public.station_events where location_id=loc and business_date=day and user_id=crew order by sequence desc limit 1;
  assert head.reason_code='clocked_out' and head.actor_id is null and head.effective_at=stamp,'0230 release fires through the link';
  raise notice 'whos-here (0233) assertions PASS; rolling back all fixtures';
end $$;
rollback;
