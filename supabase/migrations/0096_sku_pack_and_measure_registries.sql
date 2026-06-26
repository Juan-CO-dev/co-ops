-- Migration 0096_sku_pack_and_measure_registries
-- Applied via Supabase MCP apply_migration on 2026-06-25.
-- Canonical reference: lib/admin/skus.ts (SkuView + load/createSku + registries)

-- Item/Inventory Spine — Slice C1 revision: structure the SKU "unit"/"unit_size"
-- free-text into a registry-backed purchase model (Juan, 2026-06-25):
--   pack_format (Case/Box/Each…) + units_per_pack + each_size + each_measure (oz/lb…).
-- Two new MoO+ registries (deny-all RLS, service-role reads) mirror public.units
-- (migration 0084). Old vendor_items.unit/unit_size go vestigial (like category);
-- unit loses its NOT NULL so writes can stop populating it.

-- ── Pack-format registry (the wholesale pack the vendor brings it in) ──
create table public.sku_pack_formats (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid null references public.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.users(id)
);
create index sku_pack_formats_active_order on public.sku_pack_formats (active, display_order);
alter table public.sku_pack_formats enable row level security;
create policy sku_pack_formats_no_user_select on public.sku_pack_formats for select using (false);
create policy sku_pack_formats_no_user_insert on public.sku_pack_formats for insert with check (false);
create policy sku_pack_formats_no_user_update on public.sku_pack_formats for update using (false) with check (false);
create policy sku_pack_formats_no_user_delete on public.sku_pack_formats for delete using (false);
-- First option = the "doesn't come in a case" single (display_order 1).
insert into public.sku_pack_formats (label, display_order) values
  ('Each (no case)',1),('Case',2),('Box',3),('Bag',4),('Flat',5)
on conflict (label) do nothing;

-- ── Measure registry (the measure of what's inside: oz/lb/count…) ──
create table public.measure_units (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid null references public.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.users(id)
);
create index measure_units_active_order on public.measure_units (active, display_order);
alter table public.measure_units enable row level security;
create policy measure_units_no_user_select on public.measure_units for select using (false);
create policy measure_units_no_user_insert on public.measure_units for insert with check (false);
create policy measure_units_no_user_update on public.measure_units for update using (false) with check (false);
create policy measure_units_no_user_delete on public.measure_units for delete using (false);
insert into public.measure_units (label, display_order) values
  ('oz',1),('lb',2),('fl oz',3),('gallon',4),('count',5),('gram',6),('kg',7),('mL',8),('liter',9)
on conflict (label) do nothing;

-- ── vendor_items: the structured purchase model ──
alter table public.vendor_items add column pack_format text null;       -- label from sku_pack_formats
alter table public.vendor_items add column units_per_pack integer null; -- e.g. 6 (1 for Each)
alter table public.vendor_items add column each_size numeric null;      -- e.g. 32
alter table public.vendor_items add column each_measure text null;      -- label from measure_units (e.g. oz)
alter table public.vendor_items alter column unit drop not null;        -- old unit/unit_size now vestigial
