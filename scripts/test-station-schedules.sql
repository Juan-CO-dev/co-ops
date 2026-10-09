-- CC SIM ONLY, after 0238. psql -v ON_ERROR_STOP=1 -f scripts/test-station-schedules.sql
begin;
set local plpgsql.check_asserts=on;
-- Verify effective ACLs (including inherited/PUBLIC and column grants), not
-- just information_schema's explicit routine grants.
do $$ declare role_name text; privilege_name text; begin
  assert (select relrowsecurity from pg_class where oid='public.stations'::regclass), 'stations RLS disabled';
  assert not exists(select 1 from pg_policy where polrelid='public.stations'::regclass), 'stations deny-all policy manifest drifted';
  foreach role_name in array array['anon','authenticated'] loop
    foreach privilege_name in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      assert not has_table_privilege(role_name,'public.stations',privilege_name), 'stations table grant escaped';
    end loop;
    foreach privilege_name in array array['SELECT','INSERT','UPDATE','REFERENCES'] loop
      assert not has_any_column_privilege(role_name,'public.stations',privilege_name), 'stations column grant escaped';
    end loop;
  end loop;
  assert has_table_privilege('service_role','public.stations','SELECT');
  assert has_table_privilege('service_role','public.stations','INSERT');
  assert has_table_privilege('service_role','public.stations','UPDATE');
  assert not has_table_privilege('service_role','public.stations','DELETE');
  assert not has_table_privilege('service_role','public.stations','TRUNCATE');
end $$;
do $$ declare value jsonb; begin
  if not exists(select 1 from public.users where email='maya@sim.co-ops') then raise exception 'SIM ONLY'; end if;
  assert public.valid_station_trims('[]');
  assert public.valid_station_trims('[{"at":"14:00","to_count":2},{"at":"16:00","to_count":1}]');
  foreach value in array array['null','{}','[null]','[{"at":"24:00","to_count":1}]',
    '[{"at":"14:00","to_count":-1}]','[{"at":"14:00","to_count":1.5}]',
    '[{"at":"14:00"}]','[{"at":"14:00","to_count":1,"extra":true}]',
    '[{"at":"14:00","to_count":2},{"at":"14:00","to_count":1}]']::jsonb[] loop
    assert not public.valid_station_trims(value), 'invalid schedule accepted';
  end loop;
  assert exists(select 1 from pg_constraint where conrelid='public.stations'::regclass and conname='stations_trims_valid');
  assert not exists(select 1 from information_schema.routine_privileges where routine_schema='public'
    and routine_name='valid_station_trims' and grantee in ('PUBLIC','anon','authenticated') and privilege_type='EXECUTE');
end $$;
set local role authenticated;
do $$ begin
  begin perform public.valid_station_trims('[]'); raise exception 'staff execute allowed';
  exception when insufficient_privilege then null; end;
  begin perform trims from public.stations; raise exception 'staff schedule read allowed';
  exception when insufficient_privilege then null; end;
  begin update public.stations set trims='[]'; raise exception 'staff schedule update allowed';
  exception when insufficient_privilege then null; end;
  begin insert into public.stations(trims) values ('[]'); raise exception 'staff station insert allowed';
  exception when insufficient_privilege then null; end;
  begin delete from public.stations; raise exception 'staff station delete allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role service_role;
do $$ declare target uuid; begin
  select id into target from public.stations limit 1;
  assert target is not null, 'sim station fixture required';
  update public.stations set trims='[{"at":"14:00","to_count":1}]' where id=target;
  begin
    update public.stations set trims='[{"at":"29:00","to_count":1}]' where id=target;
    raise exception 'invalid write accepted';
  exception when check_violation then null; end;
end $$;
reset role;
rollback;
