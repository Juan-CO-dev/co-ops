-- Migration 0091_categories_registry
-- Applied via Supabase MCP apply_migration on 2026-06-25.
-- Canonical reference: lib/admin/vendors.ts (loadCategories/addCategory) +
--   docs/superpowers/specs/2026-06-25-vendor-directory-admin-design.md

-- Shared category taxonomy (Vendor Directory v2 + future items/inventory report).
-- Seeded to ALIGN with prep_sections slugs (Veg/Cooks/Sides/Sauces/Slicing/Misc)
-- plus line extras (Paper/Cleaning) + a catch-all (Other). MoO+ add-new. Vendors
-- reference it now; items + the inventory report adopt the same list as built;
-- prep_sections is reconciled into this taxonomy when the inventory report lands.
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null,
  label_es text null,
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid null references public.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.users(id)
);
create index categories_active_order on public.categories (active, display_order);

alter table public.categories enable row level security;
create policy categories_no_user_select on public.categories for select using (false);
create policy categories_no_user_insert on public.categories for insert with check (false);
create policy categories_no_user_update on public.categories for update using (false) with check (false);
create policy categories_no_user_delete on public.categories for delete using (false);

insert into public.categories (slug, label, label_es, display_order) values
  ('Veg','Veg','Verduras',1),
  ('Cooks','Cooks','Cocidos',2),
  ('Sides','Sides','Acompañantes',3),
  ('Sauces','Sauces','Salsas',4),
  ('Slicing','Slicing','Rebanado',5),
  ('Misc','Misc','Misceláneo',6),
  ('Paper','Paper','Papel',7),
  ('Cleaning','Cleaning','Limpieza',8),
  ('Other','Other','Otro',9)
on conflict (slug) do nothing;
