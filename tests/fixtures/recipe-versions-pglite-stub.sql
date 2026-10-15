-- Catalog Phase 3a — the MINIMUM base schema the REAL migrations 0258 → 0259 → 0260 → 0261 → 0262 read and write,
-- for PGlite (in-memory Postgres; no network, no real database). Shared by tests/fixtures/recipe-versions-pglite.ts
-- (vitest) and scripts/sql-harness-0262.mjs (node). NOT a migration: nothing here is ever applied anywhere real.
--
-- Shapes follow prod where the migrations care: 0159's sku_pack_levels verbatim in the parts 0259 reads, the
-- 0103/0179/0215 recipe columns the 0258 writers insert, the 0174/0183 location_sku_settings columns 0259/0261 touch.
-- The base tables keep prod's broad service_role grant (0262's own tables get their own ceiling).
create role anon nologin; create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;

create table public.users(id uuid primary key);
create table public.locations(id uuid primary key, name text, active boolean not null default true);
create table public.vendors(id uuid primary key default gen_random_uuid(), name text, source_kind text, active boolean not null default true);
create table public.products(
  id uuid primary key default gen_random_uuid(), name text not null, name_es text, notes text,
  unit_oz numeric check (unit_oz is null or unit_oz > 0), unit_oz_class text, unit_oz_source_note text,
  unit_oz_established_at timestamptz, unit_oz_established_by uuid references public.users(id),
  active boolean not null default true, created_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id));
create unique index products_name_lower_uq on public.products(lower(name)) where active;
create table public.vendor_items(id uuid primary key default gen_random_uuid(), name text not null, active boolean not null default true,
  location_id uuid null references public.locations(id), vendor_id uuid references public.vendors(id),
  product_id uuid references public.products(id), pack_format text, each_container_label text,
  units_per_pack int, each_size numeric, each_measure text, avg_oz_per_each numeric,
  item_number text, sku_class text not null default 'raw', price_basis text,
  weekday_par numeric, weekend_par numeric, created_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id), unique (id),
  constraint vendor_items_id_product_uq unique (id, product_id));
create table public.measure_units(label text primary key, dimension text, to_base_factor numeric, active boolean not null default true);
create table public.sku_pack_levels (
  id uuid primary key default gen_random_uuid(),
  sku_id uuid not null references public.vendor_items(id),
  label text not null,
  contains_qty numeric not null check (contains_qty > 0),
  contains_level_id uuid null references public.sku_pack_levels(id),
  contains_measure_unit text null,
  display_ordinal integer not null default 0,
  effective_from timestamptz not null default now(),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid null references public.users(id),
  constraint sku_pack_levels_one_link check (num_nonnulls(contains_level_id, contains_measure_unit) = 1)
);
create unique index sku_pack_levels_sku_label_active on public.sku_pack_levels (sku_id, label) where active;
create table public.vendor_price_history(id uuid primary key default gen_random_uuid(),
  vendor_item_id uuid not null references public.vendor_items(id), unit_price numeric(10,2) not null,
  effective_date date not null, recorded_at timestamptz default now(), recorded_by uuid, source text, source_note text);
create table public.location_sku_settings (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  sku_id uuid not null references public.vendor_items(id),
  active_override boolean null, weekday_par numeric null, weekend_par numeric null,
  updated_by uuid null references public.users(id), updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  auto_weekday_par numeric null, auto_weekend_par numeric null,
  auto_weekday_applied_at timestamptz null, auto_weekend_applied_at timestamptz null,
  auto_weekday_baseline_par numeric null, auto_weekend_baseline_par numeric null,
  pinned_weekday_at timestamptz null, pinned_weekend_at timestamptz null,
  constraint location_sku_settings_location_sku_uq unique (location_id, sku_id)
);
create table public.product_primaries(id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id), location_id uuid null references public.locations(id),
  primary_sku_id uuid not null, note text, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), updated_by uuid references public.users(id),
  constraint product_primaries_scope_uq unique nulls not distinct (product_id, location_id),
  constraint product_primaries_member_fk foreign key (primary_sku_id, product_id)
    references public.vendor_items(id, product_id));
create table public.vendor_import_batches(id uuid primary key);
create table public.vendor_import_observations(id uuid primary key);
create table public.vendor_deliveries(id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id), vendor_id uuid references public.vendors(id));
create table public.vendor_delivery_items(id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.vendor_deliveries(id), vendor_item_id uuid references public.vendor_items(id),
  created_at timestamptz not null default now());
create table public.photos(id uuid primary key, location_id uuid not null references public.locations(id));
create table public.items(
  id uuid primary key default gen_random_uuid(), location_id uuid references public.locations(id),
  name text not null, name_es text, section text, default_par numeric, default_par_unit text,
  is_default boolean not null default false, special_instruction text, special_instruction_es text,
  min_role_level integer, required boolean not null default false, opening_verify boolean not null default true,
  active boolean not null default true, created_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id));
create table public.menu_items(
  id uuid primary key default gen_random_uuid(), name text not null, name_es text, section text,
  active boolean not null default true, menu_price numeric check (menu_price is null or menu_price >= 0),
  catering_available boolean not null default false, created_at timestamptz not null default now(),
  created_by uuid references public.users(id), updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id));
-- 0103 + 0179 + 0215, the columns the 0258 writers read and write.
create table public.recipes(id uuid primary key default gen_random_uuid(), name text, name_es text, recipe_type text,
  batch_yield numeric, directions text, directions_es text, active boolean not null default true,
  batch_mode boolean not null default false, shelf_life_days integer not null default 5,
  created_at timestamptz not null default now(), created_by uuid references public.users(id));
create table public.recipe_inputs(id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  component_sku_id uuid references public.vendor_items(id), component_item_id uuid references public.items(id),
  component_product_id uuid references public.products(id), quantity numeric not null check (quantity > 0), unit text,
  each_container_label text, portioned boolean not null default false, display_order integer not null default 0,
  created_at timestamptz not null default now(), created_by uuid references public.users(id),
  constraint recipe_inputs_exactly_one_component check (num_nonnulls(component_sku_id, component_item_id, component_product_id) = 1));
create table public.recipe_outputs(id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  output_item_id uuid references public.items(id), output_menu_item_id uuid references public.menu_items(id),
  yield numeric not null default 1, output_container_label text, display_order integer not null default 0,
  created_by uuid references public.users(id));
grant select, insert, update, delete on all tables in schema public to service_role;
