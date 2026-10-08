-- CC SIM ONLY, after 0228. Owner connection; all fixture changes roll back.
-- psql -v ON_ERROR_STOP=1 -f scripts/test-assignment-attribution.sql
-- Atomic reason evidence is checked here; app audit/notification assertions are
-- in the unit suite because those use the existing fail-open app helpers.
begin;
set local plpgsql.check_asserts=on;
do $$ begin
  if not exists(select 1 from public.users where email='maya@sim.co-ops') then raise exception 'SIM ONLY'; end if;
  assert to_regprocedure('public.write_task_assignment(uuid,uuid,uuid,text,text,uuid)') is null,'old task signature removed';
  assert to_regprocedure('public.write_station_event(uuid,uuid,uuid,uuid,uuid,boolean)') is null,'old station signature removed';
end $$;
set local role authenticated;
do $$ begin
  begin perform public.write_task_assignment(gen_random_uuid(),gen_random_uuid(),null,null,null,null);
    raise exception 'staff task RPC allowed'; exception when insufficient_privilege then null; end;
  begin perform public.write_station_event(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),null,null);
    raise exception 'staff station RPC allowed'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.assignment_changes;
    raise exception 'staff evidence read allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform public.write_task_assignment(gen_random_uuid(),gen_random_uuid(),null,null,null,null);
    raise exception 'anon task RPC allowed'; exception when insufficient_privilege then null; end;
  begin perform public.write_station_event(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),null,null);
    raise exception 'anon station RPC allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;

do $$
declare loc uuid; hi uuid; lo uuid; crew uuid; people uuid[]; s uuid; p1 uuid; p2 uuid;
  assignment uuid; result jsonb; ev uuid; before_count bigint;
begin
  select location_id,array_agg(user_id order by user_id) into loc,people
    from public.user_locations where active group by location_id having count(*)>=3 order by location_id limit 1;
  assert loc is not null,'requires three sim users with memberships at one shop';
  hi:=people[1]; lo:=people[2]; crew:=people[3];
  update public.locations set active=true where id=loc;
  update public.users set role='gm',active=true where id=hi;
  update public.users set role='key_holder',active=true where id=lo;
  update public.users set role='employee',active=true where id=crew;
  -- Fixture isolation uses retraction, never deletes accountability history.
  update public.report_assignments set active=false where location_id=loc and assignee_id=crew;
  insert into public.stations(location_id,name,name_es,staffed)
    values(loc,'SIM reason '||gen_random_uuid(),'SIM motivo',true) returning id into s;
  insert into public.station_positions(station_id,location_id,name) values(s,loc,'one') returning id into p1;
  insert into public.station_positions(station_id,location_id,name) values(s,loc,'two') returning id into p2;
  -- Clear any existing station head using the authoritative writer with evidence.
  perform public.write_station_event(hi,crew,loc,null,null,true,'correction',null);

  result:=public.write_task_assignment(hi,loc,crew,'am_prep',null,null);
  assignment:=(result->>'id')::uuid;
  begin perform public.write_task_assignment(lo,loc,null,null,null,assignment);
    raise exception 'missing higher task reason allowed';
  exception when raise_exception then if sqlerrm<>'override_reason_required' then raise; end if; end;
  assert (select active from public.report_assignments where id=assignment),'refusal preserved assignment';
  begin perform public.write_task_assignment(lo,loc,null,null,null,assignment,'other',' ');
    raise exception 'blank other allowed';
  exception when raise_exception then if sqlerrm<>'invalid_payload' then raise; end if; end;
  begin perform public.write_task_assignment(lo,loc,null,null,null,assignment,'other',E'\t\n\r');
    raise exception 'whitespace other task note allowed';
  exception when raise_exception then if sqlerrm<>'invalid_payload' then raise; end if; end;
  begin perform public.write_task_assignment(lo,loc,null,null,null,assignment,'correction',repeat('x',501));
    raise exception 'long note allowed';
  exception when raise_exception then if sqlerrm<>'invalid_payload' then raise; end if; end;
  update public.users set active=false where id=hi;
  update public.user_locations set active=false where user_id=hi and location_id=loc;
  begin perform public.write_task_assignment(lo,loc,null,null,null,assignment);
    raise exception 'inactive transferred author bypassed task reason';
  exception when raise_exception then if sqlerrm<>'override_reason_required' then raise; end if; end;
  result:=public.write_task_assignment(lo,loc,null,null,null,assignment,'other','  Shift coverage  ');
  assert result->>'overridden_assigner_id'=hi::text and result->>'reason_note'='Shift coverage','task audit context';
  assert exists(select 1 from public.assignment_changes where assignment_id=assignment and kind='retract'
    and actor_id=lo and overridden_assigner_id=hi and reason_code='other' and reason_note='Shift coverage'),'retract evidence';
  select count(*) into before_count from public.assignment_changes where assignment_id=assignment;
  result:=public.write_task_assignment(lo,loc,null,null,null,assignment);
  assert result->>'changed'='false','retry is no-op';
  assert (select count(*) from public.assignment_changes where assignment_id=assignment)=before_count,'retry no duplicate evidence';
  update public.users set active=true where id=hi;
  update public.user_locations set active=true where user_id=hi and location_id=loc;
  -- Same-rank and lower-rank authors do not need a reason.
  result:=public.write_task_assignment(lo,loc,crew,'am_prep',null,null);
  perform public.write_task_assignment(lo,loc,null,null,null,(result->>'id')::uuid);
  result:=public.write_task_assignment(lo,loc,crew,'am_prep',null,null);
  perform public.write_task_assignment(hi,loc,null,null,null,(result->>'id')::uuid);
  begin perform public.write_task_assignment(crew,loc,null,null,null,assignment,'correction',null);
    raise exception 'crew task write allowed';
  exception when raise_exception then if sqlerrm<>'role_insufficient' then raise; end if; end;

  perform public.write_station_event(hi,crew,loc,s,p1,true);
  begin perform public.write_station_event(lo,crew,loc,s,p2,true,'other',E'\t\n\r');
    raise exception 'whitespace other station note allowed';
  exception when raise_exception then if sqlerrm<>'invalid_payload' then raise; end if; end;
  begin perform public.write_station_event(lo,crew,loc,s,p2,true);
    raise exception 'higher station move without reason allowed';
  exception when raise_exception then if sqlerrm<>'override_reason_required' then raise; end if; end;
  begin perform public.write_station_event(lo,crew,loc,null,null,true);
    raise exception 'higher station release without reason allowed';
  exception when raise_exception then if sqlerrm<>'override_reason_required' then raise; end if; end;
  begin perform public.write_station_event(crew,crew,loc,s,p2,false,'correction',null);
    raise exception 'self assigned station bypass allowed';
  exception when raise_exception then if sqlerrm<>'station_locked' then raise; end if; end;
  begin perform public.write_station_event(crew,lo,loc,s,p2,true,'correction',null);
    raise exception 'crew changes teammate allowed';
  exception when raise_exception then if sqlerrm<>'role_insufficient' then raise; end if; end;
  update public.users set active=false where id=hi;
  update public.user_locations set active=false where user_id=hi and location_id=loc;
  begin perform public.write_station_event(lo,crew,loc,s,p2,true);
    raise exception 'inactive transferred author bypassed station reason';
  exception when raise_exception then if sqlerrm<>'override_reason_required' then raise; end if; end;
  result:=public.write_station_event(lo,crew,loc,s,p2,true,'coverage_change','Coverage');
  ev:=(result->>'id')::uuid;
  assert result->>'overridden_assigner_id'=hi::text,'station audit context';
  assert exists(select 1 from public.station_events where id=ev and kind='move' and source='assigned'
    and actor_id=lo and overridden_assigner_id=hi and reason_code='coverage_change' and reason_note='Coverage'),'station move evidence';
  -- Current author is now the lower manager: no reason needed for own release.
  perform public.write_station_event(lo,crew,loc,null,null,true);
  update public.users set active=true where id=hi;
  update public.user_locations set active=true where user_id=hi and location_id=loc;
  perform public.write_station_event(hi,crew,loc,s,p1,true);
  result:=public.write_station_event(lo,crew,loc,null,null,true,'unavailable',null);
  assert exists(select 1 from public.station_events where id=(result->>'id')::uuid and kind='release'
    and overridden_assigner_id=hi and reason_code='unavailable'),'release evidence';
  perform public.write_station_event(crew,crew,loc,s,p1,false);
  result:=public.write_station_event(crew,crew,loc,s,p2,false);
  assert exists(select 1 from public.station_events where id=(result->>'id')::uuid and kind='move' and source='claimed'),'claim origin preserved';
  perform public.write_station_event(hi,crew,loc,null,null,true);
  perform public.write_station_event(lo,crew,loc,s,p1,true);
  perform public.write_station_event(hi,crew,loc,s,p2,true);
  perform public.write_station_event(hi,crew,loc,null,null,true);
  update public.users set role='trainee' where id=crew;
  begin perform public.write_task_assignment(crew,loc,null,null,null,assignment,'correction',null);
    raise exception 'level 2 task write allowed';
  exception when raise_exception then if sqlerrm<>'role_insufficient' then raise; end if; end;
  begin perform public.write_station_event(crew,lo,loc,s,p1,true,'correction',null);
    raise exception 'level 2 teammate station write allowed';
  exception when raise_exception then if sqlerrm<>'role_insufficient' then raise; end if; end;
end $$;
rollback;
