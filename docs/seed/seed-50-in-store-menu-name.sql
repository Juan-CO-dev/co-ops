-- Seed 50: configure the in-store Toast menu for each active Toast-linked shop.
-- AUTHORED, NOT YET APPLIED — GATE CC: sim first, then prod; requires 0246.
-- Idempotent; refuses an empty target set or a different existing menu selection.
-- No location.update exists: registered system.config_update is the config-edit action.
begin;
lock table public.locations in share row exclusive mode;
create temp table s50 on commit drop as
 select id, toast_in_store_menu_name before_name from public.locations
 where active and toast_restaurant_guid is not null;
do $guard$
begin
  if not exists (select 1 from s50) then
    raise exception 'seed50: no active Toast-linked locations';
  end if;
  if exists (select 1 from s50 where before_name is not null and before_name <> 'Compliments Only') then
    raise exception 'seed50: location already has a different in-store menu';
  end if;
end $guard$;
create temp table s50_todo on commit drop as
 select * from s50 where before_name is null;
insert into public.audit_log(actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
select null, null, 'system.config_update', 'locations', id,
 jsonb_build_object('actor_context', 'seed_50', 'changed_fields', jsonb_build_array('toast_in_store_menu_name'),
   'before', jsonb_build_object('toast_in_store_menu_name', before_name),
   'after', jsonb_build_object('toast_in_store_menu_name', 'Compliments Only'),
   'reason', 'Configure the in-store Toast menu per shop (Juan 2026-10-11)'), true
from s50_todo;
update public.locations l set toast_in_store_menu_name = 'Compliments Only'
from s50_todo t where l.id = t.id;
commit;
