-- SIM ONLY: revert exactly the ORIGINAL 0223 applied as 20261008063625.
-- CC runs as migration owner, then applies fixed 0223 and its rollback harness.
-- No CASCADE / IF EXISTS: unexpected dependencies or schema changes abort.
begin;
do $$ begin
  if not exists(select 1 from public.users where email = 'maya@sim.co-ops') then
    raise exception 'SIM ONLY: maya@sim.co-ops sentinel missing';
  end if;
  if not exists(select 1 from supabase_migrations.schema_migrations where version = '20261008063625') then
    raise exception 'original SIM 0223 migration row missing';
  end if;
  if to_regprocedure('public.apply_ezcater_order(text,text,jsonb,text,text,text)') is null
    or to_regclass('public.ezcater_order_snapshots') is not null then
    raise exception 'expected original SIM 0223 schema';
  end if;
end $$;
drop function public.apply_ezcater_order(text,text,jsonb,text,text,text);
drop table public.ezcater_order_contacts;
drop table public.ezcater_order_items;
drop table public.ezcater_orders;
do $$ declare n integer; begin
  delete from supabase_migrations.schema_migrations where version = '20261008063625';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'expected exactly one original SIM migration row'; end if;
end $$;
commit;
