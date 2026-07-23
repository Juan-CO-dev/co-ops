-- Migration 0146_toast_menu_crosswalk
-- STAGED in PR (Toast read-track 1); prod apply deferred to Juan's explicit go.
-- Canonical reference: docs/superpowers/specs/2026-07-23-toast-menu-crosswalk-design.md
--
-- Per-location (CO entity) -> (Toast menu item GUID) crosswalk + the Toast
-- restaurant GUID on locations (per-location operational identity = DATA, not
-- env, per the tenant boundary law). Deny-all config table (service-role/lib
-- authority) — 0143 item_sizes pattern: split _no_user_{insert,update,delete},
-- no select policy -> default-deny; never FOR ALL.

alter table public.locations add column toast_restaurant_guid text;

create table public.toast_menu_map (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  menu_item_id uuid references public.menu_items(id),
  item_id uuid references public.items(id),
  toast_item_guid text not null,
  toast_item_name text not null,
  toast_price_cents integer,
  match_status text not null check (match_status in ('candidate','confirmed','rejected','stale')),
  match_score numeric,
  matched_at timestamptz not null default now(),
  confirmed_by uuid,
  confirmed_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint toast_map_entity_xor check (
    (menu_item_id is not null and item_id is null) or
    (menu_item_id is null and item_id is not null)
  )
);
alter table public.toast_menu_map enable row level security;
create policy toast_menu_map_no_user_insert on public.toast_menu_map for insert with check (false);
create policy toast_menu_map_no_user_update on public.toast_menu_map for update using (false);
create policy toast_menu_map_no_user_delete on public.toast_menu_map for delete using (false);
create unique index toast_map_uq_guid on public.toast_menu_map(location_id, toast_item_guid)
  where active and match_status = 'confirmed';
create unique index toast_map_uq_menu_item on public.toast_menu_map(location_id, menu_item_id)
  where active and match_status = 'confirmed' and menu_item_id is not null;
create unique index toast_map_uq_item on public.toast_menu_map(location_id, item_id)
  where active and match_status = 'confirmed' and item_id is not null;
create index toast_map_loc_status_idx on public.toast_menu_map(location_id, match_status) where active;
