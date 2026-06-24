-- Migration 0084_units
-- Applied via Supabase MCP apply_migration on 2026-06-23.
-- Canonical reference: lib/units.server.ts (loadUnits) +
--   docs/superpowers/specs/2026-06-23-units-registry-design.md

-- Item/Inventory Spine units slice: par units become a first-class registry so
-- selection is a DROPDOWN (no free typing → no drift like QT/qt/Quart) and the
-- existing free-text values are normalized (see scripts/backfill-units-normalize.ts).
-- `label` is the canonical display = the value stored in par_unit fields (units
-- are display/data only, never matched in code logic, so no separate stable key).
-- Add/curate units = MoO+. Unit is an item-global attribute (par grid shows it
-- read-only; resolver sources item.default_par_unit).

create table public.units (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid null references public.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.users(id)
);
create index units_active_order on public.units (active, display_order);

alter table public.units enable row level security;
-- Deny all end-user DML; loaders read via service-role. Split per-op (never FOR ALL).
create policy units_no_user_select on public.units for select using (false);
create policy units_no_user_insert on public.units for insert with check (false);
create policy units_no_user_update on public.units for update using (false) with check (false);
create policy units_no_user_delete on public.units for delete using (false);

-- Seed the 8 canonical units (Juan, 2026-06-23; spelled out + Bundle for meats).
insert into public.units (label, display_order) values
  ('1/3 Pan',1),('Quart',2),('Bottle',3),('Piece',4),('Bag',5),('Logs',6),('Min',7),('Bundle',8)
on conflict (label) do nothing;
