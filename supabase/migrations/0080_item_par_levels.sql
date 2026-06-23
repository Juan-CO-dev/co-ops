-- Migration 0080_item_par_levels
-- Applied via Supabase MCP apply_migration on 2026-06-23.
-- Canonical reference: lib/items.ts (day-aware par resolver: loadItemOverrides /
--   pickOverride / resolveLineDefinition) + docs/superpowers/specs/2026-06-23-par-layer-design.md

-- Item/Inventory Spine sub-project 2B: the per-location, per-day par override layer.
-- Global items (items.location_id IS NULL) carry the canonical name + a recommended
-- default_par; this table holds each location's actual par_value + par_mode
-- (inherit | manual | auto) per day_of_week (NULL = all-days base). The resolver
-- layers auto -> manual -> inherit(recommendation). Distinct from the dormant
-- par_levels table, which stays SKU-shaped (vendor_item_id) for the ordering slice.
-- Append-only: superseded overrides are deactivated (active=false), never deleted.

create table public.item_par_levels (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id),
  location_id uuid not null references public.locations(id),
  day_of_week integer null,
  par_value numeric null,
  par_unit text null,
  par_mode text not null default 'manual',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid null references public.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.users(id),
  constraint item_par_levels_dow_chk check (day_of_week is null or (day_of_week between 0 and 6)),
  constraint item_par_levels_mode_chk check (par_mode in ('inherit','manual','auto'))
);

-- One active row per (item, location) all-days base, and per (item, location, dow).
create unique index item_par_levels_base_uq
  on public.item_par_levels (item_id, location_id)
  where day_of_week is null and active;
create unique index item_par_levels_day_uq
  on public.item_par_levels (item_id, location_id, day_of_week)
  where day_of_week is not null and active;
-- Resolver batch lookup.
create index item_par_levels_lookup
  on public.item_par_levels (item_id, location_id, active);

alter table public.item_par_levels enable row level security;

-- Service-role + app-gate pattern: deny all end-user DML; no end-user read needed
-- (loaders read via service-role). Split per-op; never FOR ALL (AGENTS.md footgun).
create policy item_par_levels_no_user_select on public.item_par_levels
  for select using (false);
create policy item_par_levels_no_user_insert on public.item_par_levels
  for insert with check (false);
create policy item_par_levels_no_user_update on public.item_par_levels
  for update using (false) with check (false);
create policy item_par_levels_no_user_delete on public.item_par_levels
  for delete using (false);
