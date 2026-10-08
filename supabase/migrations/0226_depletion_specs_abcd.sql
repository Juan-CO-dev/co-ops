-- AUTHORED ONLY; CC applies sim then prod.
-- 0226: depletion specs A/B/D. No data flips; see SEED-FLIP-45.sql.
begin;

alter table public.toast_menu_map
  add column parent_only boolean not null default false;

create table public.toast_map_effects (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null references public.toast_menu_map(id),
  ordinal integer not null check (ordinal > 0),
  item_id uuid references public.items(id),
  sku_id uuid references public.vendor_items(id),
  menu_item_id uuid references public.menu_items(id),
  disposition text not null check (disposition in ('deplete', 'remove')),
  portion_qty numeric check (portion_qty > 0),
  portion_unit text,
  parent_only boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  constraint toast_map_effects_entity_xor check (num_nonnulls(item_id, sku_id, menu_item_id) = 1)
);
create unique index toast_map_effects_active_ordinal on public.toast_map_effects(map_id, ordinal) where active;
alter table public.toast_map_effects enable row level security;
create policy toast_map_effects_no_user_select on public.toast_map_effects for select using (false);
create policy toast_map_effects_no_user_insert on public.toast_map_effects for insert with check (false);
create policy toast_map_effects_no_user_update on public.toast_map_effects for update using (false) with check (false);
create policy toast_map_effects_no_user_delete on public.toast_map_effects for delete using (false);
revoke all on public.toast_map_effects from public, anon, authenticated, service_role;
grant select, insert, update on public.toast_map_effects to service_role;

alter table public.catering_package_items add column depletion_qty numeric
  constraint catering_package_items_depletion_qty_positive check (depletion_qty > 0);
comment on column public.catering_package_items.depletion_qty is
  'Whole-unit depletion per package; NULL uses quantity. Separate from customer pickN and pricing quantity.';

create table public.toast_open_item_aliases (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references public.locations(id),
  normalized_text text not null check (btrim(normalized_text) <> ''),
  menu_item_id uuid references public.menu_items(id),
  item_id uuid references public.items(id),
  qty_multiplier numeric not null default 1 check (qty_multiplier > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  constraint toast_open_item_aliases_entity_xor check (num_nonnulls(menu_item_id, item_id) = 1)
);
create unique index toast_open_item_aliases_active_text on public.toast_open_item_aliases
  (coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), normalized_text) where active;
alter table public.toast_open_item_aliases enable row level security;
create policy toast_open_item_aliases_no_user_select on public.toast_open_item_aliases for select using (false);
create policy toast_open_item_aliases_no_user_insert on public.toast_open_item_aliases for insert with check (false);
create policy toast_open_item_aliases_no_user_update on public.toast_open_item_aliases for update using (false) with check (false);
create policy toast_open_item_aliases_no_user_delete on public.toast_open_item_aliases for delete using (false);
revoke all on public.toast_open_item_aliases from public, anon, authenticated, service_role;
grant select, insert, update on public.toast_open_item_aliases to service_role;

-- 0155 replacement shape, retaining all four 0158 entity columns and the
-- assortment exception. Only base open-item rows may have no entity.
alter table public.toast_menu_map drop constraint toast_map_entity_xor;
alter table public.toast_menu_map add constraint toast_map_entity_xor check (
  (disposition <> 'open_item' and num_nonnulls(menu_item_id, item_id, package_id, sku_id) = 1)
  or (is_modifier and disposition in ('assortment_full', 'assortment_classics')
      and num_nonnulls(menu_item_id, item_id, package_id, sku_id) = 0)
  or (not is_modifier and disposition = 'open_item'
      and num_nonnulls(menu_item_id, item_id, package_id, sku_id) = 0)
);
alter table public.toast_menu_map drop constraint toast_menu_map_disposition_check;
alter table public.toast_menu_map add constraint toast_menu_map_disposition_check check (
  disposition in ('deplete', 'remove', 'ignore', 'assortment_full', 'assortment_classics', 'open_item')
);

-- Verify effective grants, including PUBLIC/inherited ACLs, not just direct rows.
do $$
declare t text; r text;
begin
  foreach t in array array['toast_map_effects', 'toast_open_item_aliases'] loop
    foreach r in array array['anon', 'authenticated'] loop
      if has_table_privilege(r, 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
        raise exception '0226: unexpected grant on % to %', t, r;
      end if;
    end loop;
    if not has_table_privilege('service_role', 'public.' || t, 'SELECT')
       or not has_table_privilege('service_role', 'public.' || t, 'INSERT')
       or not has_table_privilege('service_role', 'public.' || t, 'UPDATE')
       or has_table_privilege('service_role', 'public.' || t, 'DELETE,TRUNCATE') then
      raise exception '0226: incorrect service_role grants on %', t;
    end if;
  end loop;
end $$;
commit;
