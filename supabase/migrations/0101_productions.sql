-- Migration 0101_productions
-- Applied via Supabase MCP apply_migration on 2026-07-01.
-- Canonical reference: docs/superpowers/specs/2026-07-01-production-capture-design.md §4
-- S1 production capture: one SKU→item conversion per row (deplete SKU, credit item).
-- Deny-all RLS (service-role writes; app-layer KH+ gate + location-bind in lib/production.ts).

create table productions (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id),
  produced_at timestamptz not null default now(),
  input_sku_id uuid not null references vendor_items(id),
  input_qty numeric not null check (input_qty > 0),
  output_item_id uuid not null references items(id),
  output_qty numeric not null check (output_qty > 0),
  notes text,
  created_by uuid
);
create index productions_input_sku_idx on productions(input_sku_id);
create index productions_output_item_idx on productions(output_item_id);
create index productions_location_idx on productions(location_id);

alter table productions enable row level security;
create policy productions_no_user_select on productions for select using (false);
create policy productions_no_user_insert on productions for insert with check (false);
create policy productions_no_user_update on productions for update using (false);
create policy productions_no_user_delete on productions for delete using (false);
