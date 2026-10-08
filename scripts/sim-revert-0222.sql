-- SIM ONLY: revert precisely the ORIGINAL 0222 applied as 20261008005718.
-- CC runs this as migration owner, then applies the revised 0222 and both harnesses.
-- Deliberately no CASCADE / IF EXISTS: an unexpected schema or downstream dependency aborts.
-- Derived 0222 caches are dropped; 0221 capture evidence is preserved.
begin;
do $$ begin
 if not exists(select 1 from public.users where email='maya@sim.co-ops') then
  raise exception 'SIM ONLY: maya@sim.co-ops sentinel missing';
 end if;
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20261008005718') then
  raise exception 'original SIM 0222 migration row missing';
 end if;
 if to_regprocedure('public.toast_capture_claim(uuid,uuid,date)') is null
 or to_regprocedure('public.replace_toast_depletion_day(uuid,date,uuid,jsonb,jsonb,integer,text,integer)') is null
 or to_regprocedure('public.toast_capture_claim(uuid,uuid,date,interval)') is not null then
  raise exception 'expected original SIM 0222 signatures';
 end if;
 -- Refuse instead of deleting or rewriting catering records to fit the former CHECK.
 if exists(select 1 from public.toast_catering_orders where classification='not_catering') then
  raise exception 'SIM has post-0222 catering data: reviewed cleanup required';
 end if;
end $$;
drop function public.toast_capture_claim(uuid,uuid,date);
drop function public.replace_toast_depletion_day(uuid,date,uuid,jsonb,jsonb,integer,text,integer);
drop table public.toast_capture_debounce;
drop table public.toast_depletion_day_coverage;
drop table public.toast_depletion_item_attribution;
drop table public.toast_capture_daily_depletion;
revoke update(catering_status,catering_error_code) on public.toast_capture_runs from service_role;
alter table public.toast_capture_runs drop column catering_status, drop column catering_error_code;
alter table public.toast_catering_orders drop constraint toast_catering_orders_classification_check;
alter table public.toast_catering_orders add constraint toast_catering_orders_classification_check
 check(classification in ('catering','ezcater','third_party'));
do $$ declare n integer; begin
 delete from supabase_migrations.schema_migrations where version='20261008005718';
 get diagnostics n=row_count;
 if n<>1 then raise exception 'expected exactly one original SIM migration row'; end if;
end $$;
commit;
