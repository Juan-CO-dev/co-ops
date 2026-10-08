-- CC SIM ONLY: undo migration 0233 (who's here) so the corrected 0233 can be re-applied cleanly.
-- psql -v ON_ERROR_STOP=1 -f scripts/sim-undo-0233.sql
-- IDEMPOTENT: every step is IF EXISTS / re-creatable; running it twice (or on a sim without 0233) is a
-- no-op beyond re-asserting the 0230 constraint shapes. NEVER run on production: the sentinel refuses.
--
-- What it reverts (every object any 0233 revision created):
--   triggers  toast_time_entries_link_user, toast_time_entries_link_lock (r1),
--             checklist_shop_closed_release on checklist_instances (r0 only)
--   functions toast_time_entry_link_user, toast_time_entries_link_lock, toast_link_actor_level,
--             link_toast_employee, unlink_toast_employee, whos_here_audit, end_shift,
--             release_shop_closed (r0), checklist_shop_closed_release (r0), reconcile_shop_closed (r1)
--   tables    shift_ends, toast_employee_links (with their indexes, policies, sequence)
--   checks    station_events_reason_code_check / _system_actor / _system_reason,
--             assignment_changes_reason_code_check / _system_actor, station_break_events reason check
--             -> back to their exact 0230 definitions.
-- Rows that only 0233 could write (reason ended_shift / shop_closed) are SIM test data and are deleted
-- first, children before parents, so the 0230 checks can be restored. toast_time_entries.user_id values
-- that links backfilled are cleared for employees that had a link (0230 never filled user_id on sim
-- except through its own harness, which rolls back). audit_log rows are left as history.
begin;
do $$ begin
  if not exists(select 1 from public.users where email='maya@sim.co-ops') then raise exception 'SIM ONLY'; end if;
end $$;

drop trigger if exists checklist_shop_closed_release on public.checklist_instances;
drop trigger if exists toast_time_entries_link_lock on public.toast_time_entries;
drop trigger if exists toast_time_entries_link_user on public.toast_time_entries;

-- Clear link-derived attribution before the links disappear (sim data only).
do $$ begin
  if to_regclass('public.toast_employee_links') is not null then
    update public.toast_time_entries e set user_id=null
      where e.user_id is not null and exists(select 1 from public.toast_employee_links l
        where l.location_id=e.location_id and l.employee_guid=e.employee_guid);
  end if;
end $$;

drop function if exists public.checklist_shop_closed_release();
drop function if exists public.release_shop_closed(uuid,date);
drop function if exists public.reconcile_shop_closed(uuid,date,boolean);
drop function if exists public.end_shift(uuid,uuid,uuid,text,text);
drop function if exists public.whos_here_audit(text,text,uuid,jsonb);
drop function if exists public.unlink_toast_employee(uuid,uuid,uuid);
drop function if exists public.link_toast_employee(uuid,uuid,text,uuid,text);
drop function if exists public.toast_link_actor_level(uuid,uuid);
drop function if exists public.toast_time_entries_link_lock();
drop function if exists public.toast_time_entry_link_user();

drop table if exists public.shift_ends;
drop table if exists public.toast_employee_links;

-- 0233-only trail rows (sim test data), children first.
delete from public.assignment_changes where reason_code in ('ended_shift','shop_closed');
delete from public.station_events where reason_code in ('ended_shift','shop_closed');
delete from public.station_break_events where reason_code='shop_closed';

-- Restore the exact 0230 checks (drop-if-exists + add: idempotent).
alter table public.station_events drop constraint if exists station_events_reason_code_check;
alter table public.station_events add constraint station_events_reason_code_check check
  (reason_code in ('coverage_change','unavailable','skill_fit','correction','other','station_closed','clocked_out','on_break'));
alter table public.station_events drop constraint if exists station_events_system_actor;
alter table public.station_events add constraint station_events_system_actor check (actor_id is not null or
    coalesce((kind='release' and reason_code in ('station_closed','clocked_out') and effective_at is not null),false));
alter table public.station_events drop constraint if exists station_events_system_reason;
alter table public.station_events add constraint station_events_system_reason check (reason_code not in ('station_closed','clocked_out','on_break') or
    (kind='release' and station_id is null and position_id is null and source is null and overridden_assigner_id is null));
alter table public.assignment_changes drop constraint if exists assignment_changes_reason_code_check;
alter table public.assignment_changes add constraint assignment_changes_reason_code_check check
    (reason_code in ('coverage_change','unavailable','skill_fit','correction','other','clocked_out'));
alter table public.assignment_changes drop constraint if exists assignment_changes_system_actor;
alter table public.assignment_changes add constraint assignment_changes_system_actor check
    ((kind='auto_release' and actor_id is null and reason_code is not distinct from 'clocked_out' and subject_user_id is not null and effective_at is not null and overridden_assigner_id is null)
      or (kind<>'auto_release' and actor_id is not null and reason_code is distinct from 'clocked_out'));
-- 0230 created this check unnamed (station_break_events_check); 0233 renamed it. Restore 0230's.
alter table public.station_break_events drop constraint if exists station_break_events_reason_check;
alter table public.station_break_events drop constraint if exists station_break_events_check;
alter table public.station_break_events add constraint station_break_events_check check
  ((actor_id is not null and reason_code is null) or
    (actor_id is null and not on_break and reason_code is not distinct from 'clocked_out'));

-- Postconditions: nothing of 0233 remains; the re-apply preflight will pass.
do $$ begin
  if to_regclass('public.toast_employee_links') is not null or to_regclass('public.shift_ends') is not null
    or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      and p.proname in ('toast_time_entry_link_user','toast_time_entries_link_lock','toast_link_actor_level','link_toast_employee',
        'unlink_toast_employee','whos_here_audit','end_shift','release_shop_closed','reconcile_shop_closed','checklist_shop_closed_release'))
    or exists(select 1 from pg_trigger where not tgisinternal and tgname in
      ('toast_time_entries_link_user','toast_time_entries_link_lock','checklist_shop_closed_release'))
    or (select count(*) from pg_constraint where conrelid='public.station_break_events'::regclass and contype='c'
      and pg_get_constraintdef(oid) like '%clocked_out%')<>1 then
    raise exception 'sim-undo-0233: residue remains';
  end if;
  raise notice 'sim-undo-0233: 0233 removed; re-apply 0233 next';
end $$;
-- Also remove the migration-history row so the re-apply is recorded fresh (CC: adjust if your apply
-- tool keys on name rather than version).
do $$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations where name='0233_whos_here';
  end if;
end $$;
commit;
