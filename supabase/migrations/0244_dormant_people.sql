-- Migration 0244_dormant_people
-- AUTHORED 2026-10-11. NOT YET APPLIED -- GATE CC: sim first, then prod.
-- Display-only dormancy. No login/session changes and no wider staff column grants.
begin;
alter table public.users
  add column dormant_at timestamptz null,
  add column dormant_by uuid null references public.users(id);

create function public.admin_last_clock_ins(p_since timestamptz)
returns table(location_id uuid, employee_guid text, user_id uuid, last_in_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select e.location_id, e.employee_guid, e.user_id, max(e.in_at)
  from public.toast_time_entries e
  where e.deleted = false and e.in_at >= p_since
  group by e.location_id, e.employee_guid, e.user_id
$$;
revoke all on function public.admin_last_clock_ins(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_last_clock_ins(timestamptz) to service_role;

do $$ declare r text; c text; begin
  foreach r in array array['anon','authenticated'] loop
    foreach c in array array['dormant_at','dormant_by'] loop
      if has_column_privilege(r,'public.users',c,'SELECT,INSERT,UPDATE,REFERENCES') then
        raise exception '0244: dormant column grant escaped';
      end if;
    end loop;
    if has_function_privilege(r,'public.admin_last_clock_ins(timestamptz)','EXECUTE') then
      raise exception '0244: clock-in RPC grant escaped';
    end if;
  end loop;
end $$;
commit;
