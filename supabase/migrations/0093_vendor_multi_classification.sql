-- Migration 0093_vendor_multi_classification
-- Applied via Supabase MCP apply_migration on 2026-06-25.
-- Canonical reference: lib/admin/vendors.ts +
--   docs/superpowers/specs/2026-06-25-vendor-directory-admin-design.md

-- Vendor multi-classification (Slice A addition, per Juan): a vendor can affect
-- MULTIPLE categories (internal item taxonomy) AND have MULTIPLE order types
-- (traditional supply view: Produce/Dry Goods/Paper/...). order_types is a new
-- registry like categories/units (MoO+ add-new). Two join tables make both
-- many-to-many. vendors.category_id (single, 0092) goes VESTIGIAL — migrated
-- into vendor_categories below.

create table public.order_types (
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
create index order_types_active_order on public.order_types (active, display_order);

alter table public.order_types enable row level security;
create policy order_types_no_user_select on public.order_types for select using (false);
create policy order_types_no_user_insert on public.order_types for insert with check (false);
create policy order_types_no_user_update on public.order_types for update using (false) with check (false);
create policy order_types_no_user_delete on public.order_types for delete using (false);

insert into public.order_types (slug, label, label_es, display_order) values
  ('Produce','Produce','Verduras y frutas',1),
  ('Protein','Protein','Proteína',2),
  ('Dairy','Dairy','Lácteos',3),
  ('DryGoods','Dry Goods','Secos',4),
  ('Paper','Paper & Disposables','Papel y desechables',5),
  ('Chemical','Chemical & Cleaning','Químicos y limpieza',6),
  ('Beverage','Beverage','Bebidas',7),
  ('Specialty','Specialty','Especialidad',8),
  ('Equipment','Equipment & Smallwares','Equipo y utensilios',9),
  ('Other','Other','Otro',10)
on conflict (slug) do nothing;

create table public.vendor_categories (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id),
  category_id uuid not null references public.categories(id),
  created_at timestamptz not null default now(),
  created_by uuid null references public.users(id),
  unique (vendor_id, category_id)
);
create index vendor_categories_vendor on public.vendor_categories (vendor_id);

create table public.vendor_order_types (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id),
  order_type_id uuid not null references public.order_types(id),
  created_at timestamptz not null default now(),
  created_by uuid null references public.users(id),
  unique (vendor_id, order_type_id)
);
create index vendor_order_types_vendor on public.vendor_order_types (vendor_id);

alter table public.vendor_categories enable row level security;
create policy vendor_categories_no_user_select on public.vendor_categories for select using (false);
create policy vendor_categories_no_user_insert on public.vendor_categories for insert with check (false);
create policy vendor_categories_no_user_update on public.vendor_categories for update using (false) with check (false);
create policy vendor_categories_no_user_delete on public.vendor_categories for delete using (false);

alter table public.vendor_order_types enable row level security;
create policy vendor_order_types_no_user_select on public.vendor_order_types for select using (false);
create policy vendor_order_types_no_user_insert on public.vendor_order_types for insert with check (false);
create policy vendor_order_types_no_user_update on public.vendor_order_types for update using (false) with check (false);
create policy vendor_order_types_no_user_delete on public.vendor_order_types for delete using (false);

insert into public.vendor_categories (vendor_id, category_id)
select id, category_id from public.vendors where category_id is not null
on conflict (vendor_id, category_id) do nothing;
