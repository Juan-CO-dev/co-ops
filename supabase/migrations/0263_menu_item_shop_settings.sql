-- Migration 0263_menu_item_shop_settings
-- AUTHORED 2026-10-15. NOT YET APPLIED — apply via MCP after review (sim → prod dry-run → prod, with 0262, BEFORE the 3a code merges).
-- APPLIED TO SIM 2026-10-15 (schema_migrations version 20261015170502, name 'menu_item_shop_settings')
-- APPLIED TO PROD 2026-10-15 (schema_migrations version 20261015171121, name 'menu_item_shop_settings')
-- Plan: docs/superpowers/plans/2026-10-15-catalog-phase3a-recipe-menu-versions-data.md (Task 4).
-- Spec: docs/superpowers/specs/2026-10-15-catalog-redesign-design.md §3 (menu items: shop price, sold here, name override).
--
-- WHAT. A menu item's SHOP OVERLAY. The global default IS the menu_items row (the idiom's NULL location);
-- menu_item_shop_settings holds shop rows only:
--   price             NULL = the global price; else this shop's typed price (> 0, ≤ 1000, cents)
--   sold_here         false = off the menu at this shop (never deleted, never global)
--   name_override(_es) NULL = the global name
-- Effective-dated and append-only (valid_from / valid_to / active): a save closes the live row and opens a
-- new one; "back to default" retires it; Restore saves an old row's values as a new one.
-- The ONE rule that reads it is lib/menu-item-shop-shared.ts resolveMenuItemForShop.
--
-- WRITERS (SECURITY DEFINER, search_path pinned, service_role only; the menu_items row lock first):
--   save_menu_item_shop_setting(p_menu_item, p_location, p_price, p_sold_here, p_name, p_name_es, p_expected,
--                               p_note, p_actor, p_restored_from, p_snapshot)   optimistic on the live row id
--   retire_menu_item_shop_setting(p_setting, p_location, p_actor, p_snapshot)    back to default
--   promote_menu_item_shop_setting(p_setting, p_fields, p_expected_price, p_expected_name, p_expected_name_es, p_actor, p_snapshot)
--       MoO+ (lib gate): copies the shop's price and/or name into menu_items under a compare-and-set on the
--       global values; sold_here is never promoted. In the same transaction the SOURCE shop returns to the
--       default for the promoted fields (lead decision 5): its row closes; a new row opens with only what it
--       still says, or none. changed_shops = every active shop inheriting ANY promoted field (field by field).
--   menu_item_change_snapshot(p_menu_item, p_location)   THE DEPENDENCY SNAPSHOT, scoped: the item row, its live
--       shop rows, the active shops and, per recipe that makes it, 0262's closure snapshot at that scope. Every
--       writer above takes the graph lock, the item row, the closure locks (menu_item_change_lock → 0262
--       recipe_change_lock, NOWAIT) and then re-takes it: 'menu_item_shop:dependencies_changed' on any difference,
--       'recipe_version:dependencies_busy' when a dependency is being written right now.
-- Named refusals: P0001 'menu_item_shop:<code>' (lib/admin/menu-item-shop.ts maps them).
--
-- PRIVILEGE CEILING (the 0257 pattern): SELECT/INSERT/UPDATE for service_role, nothing else; nothing for
-- anon/authenticated; RLS on with the deny-all policy set.
--
-- VERIFY AFTER APPLY:
--   select count(*) from public.menu_item_shop_settings;                                    -- 0
--   select table_name, grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'menu_item_shop_settings' order by 2, 3;  -- service_role INSERT/SELECT/UPDATE (+ owner)
--   select routine_name, grantee from information_schema.routine_privileges
--    where routine_schema = 'public' and privilege_type = 'EXECUTE' and routine_name like '%menu_item_shop_setting'
--    order by 1, 2;                                                                         -- service_role (+ owner) only

begin;

create table if not exists public.menu_item_shop_settings (
  id                  uuid          primary key default gen_random_uuid(),
  menu_item_id        uuid          not null references public.menu_items(id),
  location_id         uuid          not null references public.locations(id),
  based_on_setting_id uuid          null references public.menu_item_shop_settings(id),
  price               numeric(10,2) null,
  sold_here           boolean       not null default true,
  name_override       text          null,
  name_override_es    text          null,
  active              boolean       not null default true,
  valid_from          timestamptz   not null default clock_timestamp(),
  valid_to            timestamptz   null,
  note                text          null,
  created_at          timestamptz   not null default clock_timestamp(),
  created_by          uuid          null references public.users(id),
  retired_by          uuid          null references public.users(id),
  constraint menu_item_shop_settings_live_window check ((valid_to is null) = active),
  constraint menu_item_shop_settings_price check (price is null or (price > 0 and price <= 1000)),
  constraint menu_item_shop_settings_names check (
    (name_override is null or char_length(btrim(name_override)) between 1 and 120)
    and (name_override_es is null or char_length(btrim(name_override_es)) between 1 and 120)
  ),
  constraint menu_item_shop_settings_says_something check (
    price is not null or not sold_here or name_override is not null or name_override_es is not null
  )
);
comment on table public.menu_item_shop_settings is
  'A menu item''s SHOP OVERLAY (0263): this shop''s price, whether it is sold here, and its name here. The '
  'global default is the menu_items row. Effective-dated, append-only, one live per (menu item, shop). '
  'Resolution: lib/menu-item-shop-shared.ts resolveMenuItemForShop.';
create unique index if not exists menu_item_shop_settings_one_live
  on public.menu_item_shop_settings (menu_item_id, location_id) where active;
create index if not exists menu_item_shop_settings_shop_live on public.menu_item_shop_settings (location_id) where active;
create index if not exists menu_item_shop_settings_history on public.menu_item_shop_settings (menu_item_id, location_id, valid_from desc);

-- THE DEPENDENCY SNAPSHOT (the 0261 pattern), SCOPED (lead decision (a)): what the menu preview's name, price,
-- cost and margins were computed from — this item's row, its live shop rows, the active shops, and, for every
-- recipe that makes it, 0262's closure snapshot at the scope whose cost is shown (p_location; NULL = the global
-- default, as a promote shows). Never a whole table.
create or replace function public.menu_item_change_snapshot(p_menu_item uuid, p_location uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'item', (select to_jsonb(m) from public.menu_items m where m.id = p_menu_item),
    'settings', coalesce((select jsonb_agg(to_jsonb(s) order by s.location_id)
                            from public.menu_item_shop_settings s where s.menu_item_id = p_menu_item and s.active), '[]'::jsonb),
    'active_shops', coalesce((select jsonb_agg(l.id order by l.id) from public.locations l where l.active), '[]'::jsonb),
    'costs', coalesce((select jsonb_agg(jsonb_build_object('recipe_id', r.recipe_id,
                                                           'snapshot', public.recipe_change_snapshot(r.recipe_id, p_location, null))
                                        order by r.recipe_id)
                         from (select distinct ro.recipe_id from public.recipe_outputs ro where ro.output_menu_item_id = p_menu_item) r),
                      '[]'::jsonb));
$$;

-- THE CLOSURE LOCKS for a menu change (0262 recipe_change_lock, per recipe that makes the item; NOWAIT). Lock
-- order: graph lock (taken first by every menu writer, re-entrant here) → the menu item row → the closure.
create or replace function public.menu_item_change_lock(p_menu_item uuid, p_location uuid)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_recipe uuid;
begin
  perform pg_advisory_xact_lock(7258025800);
  for v_recipe in
    select distinct ro.recipe_id from public.recipe_outputs ro where ro.output_menu_item_id = p_menu_item order by 1
  loop
    perform public.recipe_change_lock(v_recipe, p_location, null);
  end loop;
end;
$$;

create or replace function public.save_menu_item_shop_setting(
  p_menu_item     uuid,
  p_location      uuid,
  p_price         numeric,
  p_sold_here     boolean,
  p_name          text,
  p_name_es       text,
  p_expected      uuid,
  p_note          text,
  p_actor         uuid,
  p_restored_from uuid,
  p_snapshot      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_live      uuid;
  v_src       public.menu_item_shop_settings%rowtype;
  v_price     numeric := p_price;
  v_sold      boolean := coalesce(p_sold_here, true);
  v_name      text := nullif(btrim(coalesce(p_name, '')), '');
  v_name_es   text := nullif(btrim(coalesce(p_name_es, '')), '');
  v_new       uuid;
  v_now       timestamptz := clock_timestamp();
begin
  -- LOCK ORDER (0262 (7a)): the graph lock, then THE MENU ITEM ROW (every overlay writer of this item serializes
  -- here), then the cost closure (NOWAIT), then the snapshot re-check under them all.
  perform pg_advisory_xact_lock(7258025800);
  perform 1 from public.menu_items where id = p_menu_item and active for update;
  if not found then
    raise exception 'menu_item_shop:menu_item_not_found' using errcode = 'P0001';
  end if;
  perform public.menu_item_change_lock(p_menu_item, p_location);
  if p_snapshot is null or public.menu_item_change_snapshot(p_menu_item, p_location) is distinct from p_snapshot then
    raise exception 'menu_item_shop:dependencies_changed' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.locations where id = p_location and active) then
    raise exception 'menu_item_shop:location_not_found' using errcode = 'P0001';
  end if;
  if p_restored_from is not null then
    select * into v_src from public.menu_item_shop_settings
     where id = p_restored_from and menu_item_id = p_menu_item and location_id = p_location;
    if not found then
      raise exception 'menu_item_shop:invalid_source' using errcode = 'P0001';
    end if;
    v_price := v_src.price; v_sold := v_src.sold_here; v_name := v_src.name_override; v_name_es := v_src.name_override_es;
  end if;
  if v_price is not null and (v_price <= 0 or v_price > 1000 or v_price <> round(v_price, 2)) then
    raise exception 'menu_item_shop:invalid_price' using errcode = 'P0001';
  end if;
  if (v_name is not null and char_length(v_name) > 120) or (v_name_es is not null and char_length(v_name_es) > 120) then
    raise exception 'menu_item_shop:invalid_name' using errcode = 'P0001';
  end if;
  if v_price is null and v_sold and v_name is null and v_name_es is null then
    raise exception 'menu_item_shop:empty_setting' using errcode = 'P0001';
  end if;
  select id into v_live from public.menu_item_shop_settings
   where menu_item_id = p_menu_item and location_id = p_location and active for update;
  if v_live is distinct from p_expected then
    raise exception 'menu_item_shop:version_changed' using errcode = 'P0001';
  end if;
  if v_live is not null then
    update public.menu_item_shop_settings set active = false, valid_to = greatest(v_now, valid_from), retired_by = p_actor where id = v_live and active;
  end if;
  insert into public.menu_item_shop_settings (menu_item_id, location_id, based_on_setting_id, price, sold_here, name_override,
                                              name_override_es, active, valid_from, note, created_at, created_by)
  values (p_menu_item, p_location, coalesce(p_restored_from, v_live), v_price, v_sold, v_name, v_name_es, true, v_now,
          nullif(btrim(coalesce(p_note, '')), ''), v_now, p_actor)
  returning id into v_new;
  return jsonb_build_object('setting_id', v_new, 'retired_setting_id', v_live, 'valid_from', v_now);
end;
$$;

create or replace function public.retire_menu_item_shop_setting(p_setting uuid, p_location uuid, p_actor uuid, p_snapshot jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.menu_item_shop_settings%rowtype;
  v_now timestamptz;
begin
  select * into v_row from public.menu_item_shop_settings where id = p_setting;
  if not found or v_row.location_id is distinct from p_location then
    raise exception 'menu_item_shop:not_found' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(7258025800);
  perform 1 from public.menu_items where id = v_row.menu_item_id for update;
  perform public.menu_item_change_lock(v_row.menu_item_id, p_location);
  if p_snapshot is null or public.menu_item_change_snapshot(v_row.menu_item_id, p_location) is distinct from p_snapshot then
    raise exception 'menu_item_shop:dependencies_changed' using errcode = 'P0001';
  end if;
  select * into v_row from public.menu_item_shop_settings where id = p_setting for update;
  if not v_row.active then
    raise exception 'menu_item_shop:not_live' using errcode = 'P0001';
  end if;
  v_now := greatest(clock_timestamp(), v_row.valid_from);
  update public.menu_item_shop_settings set active = false, valid_to = v_now, retired_by = p_actor where id = p_setting and active;
  return jsonb_build_object('setting_id', p_setting, 'menu_item_id', v_row.menu_item_id, 'location_id', p_location, 'valid_to', v_now);
end;
$$;

create or replace function public.promote_menu_item_shop_setting(
  p_setting          uuid,
  p_fields           text[],
  p_expected_price   numeric,
  p_expected_name    text,
  p_expected_name_es text,
  p_actor            uuid,
  p_snapshot         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row     public.menu_item_shop_settings%rowtype;
  v_item    public.menu_items%rowtype;
  v_price   boolean := 'price' = any(coalesce(p_fields, '{}'::text[]));
  v_name    boolean := 'name' = any(coalesce(p_fields, '{}'::text[]));
  v_changed jsonb;
  v_now     timestamptz;
  v_rest    uuid;
begin
  if cardinality(coalesce(p_fields, '{}'::text[])) = 0
     or exists (select 1 from unnest(p_fields) f where f not in ('price', 'name')) then
    raise exception 'menu_item_shop:invalid_payload' using errcode = 'P0001';
  end if;
  select * into v_row from public.menu_item_shop_settings where id = p_setting;
  if not found then
    raise exception 'menu_item_shop:not_found' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(7258025800);
  select * into v_item from public.menu_items where id = v_row.menu_item_id and active for update;
  if not found then
    raise exception 'menu_item_shop:menu_item_not_found' using errcode = 'P0001';
  end if;
  -- A promote shows the GLOBAL cost only: the closure and snapshot of the global view alone (NIL scope, 0262 (7a)).
  perform public.menu_item_change_lock(v_item.id, '00000000-0000-0000-0000-000000000000'::uuid);
  if p_snapshot is null or public.menu_item_change_snapshot(v_item.id, '00000000-0000-0000-0000-000000000000'::uuid) is distinct from p_snapshot then
    raise exception 'menu_item_shop:dependencies_changed' using errcode = 'P0001';
  end if;
  select * into v_row from public.menu_item_shop_settings where id = p_setting for update;
  if not v_row.active then
    raise exception 'menu_item_shop:not_live' using errcode = 'P0001';
  end if;
  if (v_price and v_row.price is null) or (v_name and v_row.name_override is null) then
    raise exception 'menu_item_shop:nothing_to_promote' using errcode = 'P0001';
  end if;
  -- COMPARE-AND-SET on the global values the person saw in the preview.
  if v_item.menu_price is distinct from p_expected_price or v_item.name is distinct from p_expected_name
     or v_item.name_es is distinct from p_expected_name_es then
    raise exception 'menu_item_shop:global_changed' using errcode = 'P0001';
  end if;
  -- FIELD BY FIELD (Astra 3b r1#4): a shop's menu changes when it inherits ANY promoted field — a shop with its
  -- own price but the default name still changes when price AND name are promoted. Taken before the source
  -- returns to the default (its values ARE the promoted ones, so its menu does not change).
  v_changed := coalesce((
    select jsonb_agg(l.id order by l.id) from public.locations l
     where l.active and l.id <> v_row.location_id
       and ((v_price and not exists (select 1 from public.menu_item_shop_settings s
                                      where s.menu_item_id = v_item.id and s.location_id = l.id and s.active and s.price is not null))
         or (v_name and not exists (select 1 from public.menu_item_shop_settings s
                                     where s.menu_item_id = v_item.id and s.location_id = l.id and s.active and s.name_override is not null)))),
    '[]'::jsonb);
  update public.menu_items
     set menu_price = case when v_price then v_row.price else menu_price end,
         name       = case when v_name then v_row.name_override else name end,
         name_es    = case when v_name then v_row.name_override_es else name_es end,
         updated_at = now(),
         updated_by = p_actor
   where id = v_item.id;
  -- THE SOURCE SHOP RETURNS TO THE DEFAULT for what it promoted (lead decision 5): its row closes (history
  -- kept); what it still says on its own (a field not promoted, or "not sold here") carries on in a new row.
  v_now := greatest(clock_timestamp(), v_row.valid_from);
  update public.menu_item_shop_settings set active = false, valid_to = v_now, retired_by = p_actor where id = v_row.id and active;
  if (not v_price and v_row.price is not null) or not v_row.sold_here
     or (not v_name and (v_row.name_override is not null or v_row.name_override_es is not null)) then
    insert into public.menu_item_shop_settings (menu_item_id, location_id, based_on_setting_id, price, sold_here, name_override,
                                                name_override_es, active, valid_from, note, created_at, created_by)
    values (v_item.id, v_row.location_id, v_row.id,
            case when v_price then null else v_row.price end, v_row.sold_here,
            case when v_name then null else v_row.name_override end,
            case when v_name then null else v_row.name_override_es end,
            true, v_now, 'promoted to the default', v_now, p_actor)
    returning id into v_rest;
  end if;
  return jsonb_build_object(
    'menu_item_id', v_item.id, 'fields', to_jsonb(p_fields),
    'before', jsonb_build_object('menu_price', v_item.menu_price, 'name', v_item.name, 'name_es', v_item.name_es),
    'changed_shops', v_changed,
    'returned_shop', v_row.location_id, 'retired_setting_id', v_row.id, 'remaining_setting_id', v_rest);
end;
$$;

alter table public.menu_item_shop_settings enable row level security;
create policy menu_item_shop_settings_no_user_select on public.menu_item_shop_settings for select using (false);
create policy menu_item_shop_settings_no_user_insert on public.menu_item_shop_settings for insert with check (false);
create policy menu_item_shop_settings_no_user_update on public.menu_item_shop_settings for update using (false);
create policy menu_item_shop_settings_no_user_delete on public.menu_item_shop_settings for delete using (false);
revoke all on public.menu_item_shop_settings from public, anon, authenticated, service_role;
grant select, insert, update on public.menu_item_shop_settings to service_role;

revoke all on function public.save_menu_item_shop_setting(uuid, uuid, numeric, boolean, text, text, uuid, text, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.retire_menu_item_shop_setting(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.promote_menu_item_shop_setting(uuid, text[], numeric, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.menu_item_change_snapshot(uuid, uuid) from public, anon, authenticated;
revoke all on function public.menu_item_change_lock(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.save_menu_item_shop_setting(uuid, uuid, numeric, boolean, text, text, uuid, text, uuid, uuid, jsonb) to service_role;
grant execute on function public.retire_menu_item_shop_setting(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.promote_menu_item_shop_setting(uuid, text[], numeric, text, text, uuid, jsonb) to service_role;
grant execute on function public.menu_item_change_snapshot(uuid, uuid) to service_role;

do $$ begin
  if exists (select 1 from information_schema.routine_privileges
              where routine_schema = 'public'
                and routine_name in ('save_menu_item_shop_setting', 'retire_menu_item_shop_setting', 'promote_menu_item_shop_setting',
                                     'menu_item_change_snapshot', 'menu_item_change_lock')
                and grantee in ('PUBLIC', 'anon', 'authenticated') and privilege_type = 'EXECUTE') then
    raise exception '0263: unexpected execute grant';
  end if;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'menu_item_shop_settings' and grantee in ('PUBLIC', 'anon', 'authenticated')) then
    raise exception '0263: unexpected table grant on menu_item_shop_settings';
  end if;
  if has_table_privilege('service_role', 'public.menu_item_shop_settings', 'DELETE')
     or has_table_privilege('service_role', 'public.menu_item_shop_settings', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.menu_item_shop_settings', 'REFERENCES')
     or has_table_privilege('service_role', 'public.menu_item_shop_settings', 'TRIGGER') then
    raise exception '0263: service_role above its ceiling';
  end if;
  if not (has_table_privilege('service_role', 'public.menu_item_shop_settings', 'SELECT')
          and has_table_privilege('service_role', 'public.menu_item_shop_settings', 'INSERT')
          and has_table_privilege('service_role', 'public.menu_item_shop_settings', 'UPDATE')) then
    raise exception '0263: service_role is missing a privilege the writers need';
  end if;
end $$;

commit;
