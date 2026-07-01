-- Migration 0103_recipe_entities
-- Applied via Supabase MCP apply_migration on 2026-07-01.
-- Canonical reference: docs/superpowers/specs/2026-07-01-recipe-stage-design.md §3
-- Recipe stage: repurpose the dormant 0-row `recipes` table into the two-tier
-- recipe hub (production|consumer) + polymorphic recipe_inputs/recipe_outputs
-- + new menu_items. Deny-all RLS (service-role writes; app-layer gate in lib/recipes.ts).

-- 1. Extend the dormant recipes table (0 rows → all adds are safe/no-backfill).
alter table recipes add column recipe_type text not null default 'production'
  check (recipe_type in ('production','consumer'));
alter table recipes alter column recipe_type drop default;  -- force explicit going forward
alter table recipes add column batch_yield numeric not null default 1 check (batch_yield > 0);
alter table recipes add column name_es text;
alter table recipes add column directions text;
alter table recipes add column directions_es text;
alter table recipes add column updated_by uuid;

-- 1b. Tighten recipes to deny-all. It carried the dormant training feature's
-- permissive user-facing policies (recipes_read/insert/update); the table is now a
-- service-role-written, app-gated admin config entity (writes via lib/recipes.ts).
-- 0 rows + no built reader → no live path breaks.
drop policy if exists recipes_read on recipes;
drop policy if exists recipes_insert on recipes;
drop policy if exists recipes_update on recipes;
drop policy if exists recipes_no_user_delete on recipes;
create policy recipes_no_user_select on recipes for select using (false);
create policy recipes_no_user_insert on recipes for insert with check (false);
create policy recipes_no_user_update on recipes for update using (false);
create policy recipes_no_user_delete on recipes for delete using (false);

-- 2. recipe_inputs — SKU XOR sub-item edge.
create table recipe_inputs (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  component_sku_id uuid references vendor_items(id),
  component_item_id uuid references items(id),
  quantity numeric not null check (quantity > 0),
  unit text,
  each_container_label text,
  portioned boolean not null default false,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint recipe_inputs_exactly_one_component
    check ((component_sku_id is not null) <> (component_item_id is not null))
);
create index recipe_inputs_recipe_idx on recipe_inputs(recipe_id);
create index recipe_inputs_sku_idx on recipe_inputs(component_sku_id);
create index recipe_inputs_item_idx on recipe_inputs(component_item_id);

-- 3. recipe_outputs — item XOR menu_item; fan-out = multiple rows.
create table recipe_outputs (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  output_item_id uuid references items(id),
  output_menu_item_id uuid,  -- FK added after menu_items exists (below)
  yield numeric not null check (yield > 0),
  output_container_label text,
  oz_alloc_share numeric check (oz_alloc_share is null or oz_alloc_share > 0),
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint recipe_outputs_exactly_one_target
    check ((output_item_id is not null) <> (output_menu_item_id is not null))
);
create index recipe_outputs_recipe_idx on recipe_outputs(recipe_id);
create index recipe_outputs_item_idx on recipe_outputs(output_item_id);
create index recipe_outputs_menu_item_idx on recipe_outputs(output_menu_item_id);

-- 4. menu_items — the sold leaf; menu_price moves here from items (0 items use it today).
create table menu_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_es text,
  menu_price numeric check (menu_price is null or menu_price >= 0),
  toast_ref text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table recipe_outputs
  add constraint recipe_outputs_menu_item_fk
  foreign key (output_menu_item_id) references menu_items(id);

-- 5. Deny-all RLS (split per-op; service-role bypasses; app-layer gates writes).
alter table recipe_inputs enable row level security;
create policy recipe_inputs_no_user_select on recipe_inputs for select using (false);
create policy recipe_inputs_no_user_insert on recipe_inputs for insert with check (false);
create policy recipe_inputs_no_user_update on recipe_inputs for update using (false);
create policy recipe_inputs_no_user_delete on recipe_inputs for delete using (false);

alter table recipe_outputs enable row level security;
create policy recipe_outputs_no_user_select on recipe_outputs for select using (false);
create policy recipe_outputs_no_user_insert on recipe_outputs for insert with check (false);
create policy recipe_outputs_no_user_update on recipe_outputs for update using (false);
create policy recipe_outputs_no_user_delete on recipe_outputs for delete using (false);

alter table menu_items enable row level security;
create policy menu_items_no_user_select on menu_items for select using (false);
create policy menu_items_no_user_insert on menu_items for insert with check (false);
create policy menu_items_no_user_update on menu_items for update using (false);
create policy menu_items_no_user_delete on menu_items for delete using (false);
