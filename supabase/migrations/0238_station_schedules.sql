-- 0238 station close times + trims. APPLIED TO PROD 2026-10-09 (20261009044825; sim 20261009044741, harness pass; prod dry run pass).
-- Daily advisory configuration only. No scheduled mutation or seed values.
begin;
do $$ begin
  if not exists(select 1 from information_schema.columns where table_schema='public'
    and table_name='stations' and column_name='usually_closes_at' and data_type='time without time zone') then
    raise exception '0238: expected 0230 stations.usually_closes_at';
  end if;
end $$;
create function public.valid_station_trims(p_trims jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog,public as $$
declare entry jsonb; previous_time text := ''; count_value numeric;
begin
  if p_trims is null or jsonb_typeof(p_trims)<>'array' then return false; end if;
  if jsonb_array_length(p_trims)>24 then return false; end if;
  for entry in select value from jsonb_array_elements(p_trims) loop
    if jsonb_typeof(entry)<>'object' then return false; end if;
    if (entry - 'at' - 'to_count')<>'{}'::jsonb
      or jsonb_typeof(entry->'at') is distinct from 'string'
      or jsonb_typeof(entry->'to_count') is distinct from 'number' then return false; end if;
    if (entry->>'at') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (entry->>'at')<=previous_time then return false; end if;
    count_value := (entry->>'to_count')::numeric;
    if count_value<>trunc(count_value) or count_value<0 or count_value>100 then return false; end if;
    previous_time := entry->>'at';
  end loop;
  return true;
end $$;
revoke all on function public.valid_station_trims(jsonb) from public,anon,authenticated;
grant execute on function public.valid_station_trims(jsonb) to service_role;
alter table public.stations add column trims jsonb not null default '[]'::jsonb
  constraint stations_trims_valid check (public.valid_station_trims(trims));
-- Fail closed if the inherited 0217 deny-all table contract has drifted.
do $$ declare role_name text; privilege_name text; begin
  if not (select relrowsecurity from pg_class where oid='public.stations'::regclass)
    or exists(select 1 from pg_policy where polrelid='public.stations'::regclass) then
    raise exception '0238: stations must retain enabled deny-all RLS without policies';
  end if;
  foreach role_name in array array['anon','authenticated'] loop
    foreach privilege_name in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege(role_name,'public.stations',privilege_name) then
        raise exception '0238: stations table grant escaped to %: %',role_name,privilege_name;
      end if;
    end loop;
    foreach privilege_name in array array['SELECT','INSERT','UPDATE','REFERENCES'] loop
      if has_any_column_privilege(role_name,'public.stations',privilege_name) then
        raise exception '0238: stations column grant escaped to %: %',role_name,privilege_name;
      end if;
    end loop;
  end loop;
  if not has_table_privilege('service_role','public.stations','SELECT')
    or not has_table_privilege('service_role','public.stations','INSERT')
    or not has_table_privilege('service_role','public.stations','UPDATE')
    or has_table_privilege('service_role','public.stations','DELETE')
    or has_table_privilege('service_role','public.stations','TRUNCATE') then
    raise exception '0238: stations service-role grant contract drifted';
  end if;
end $$;
commit;
