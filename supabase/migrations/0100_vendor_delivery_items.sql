-- Migration 0100_vendor_delivery_items
-- Applied via Supabase MCP apply_migration on 2026-07-01.
-- Canonical reference: docs/superpowers/specs/2026-07-01-r3-receiving-design.md §3
-- R3 receiving: per-SKU delivery lines under the dormant vendor_deliveries header.
-- Deny-all RLS (service-role writes; app-layer KH+ gate + location-bind in lib/receiving.ts).

create table vendor_delivery_items (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references vendor_deliveries(id),
  vendor_item_id uuid not null references vendor_items(id),
  qty_received numeric not null check (qty_received > 0),
  unit_price numeric check (unit_price is null or unit_price > 0),
  observed_oz_per_each numeric check (observed_oz_per_each is null or observed_oz_per_each > 0),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid
);
create index vendor_delivery_items_delivery_idx on vendor_delivery_items(delivery_id);
create index vendor_delivery_items_sku_idx on vendor_delivery_items(vendor_item_id);

alter table vendor_delivery_items enable row level security;
create policy vendor_delivery_items_no_user_select on vendor_delivery_items for select using (false);
create policy vendor_delivery_items_no_user_insert on vendor_delivery_items for insert with check (false);
create policy vendor_delivery_items_no_user_update on vendor_delivery_items for update using (false);
create policy vendor_delivery_items_no_user_delete on vendor_delivery_items for delete using (false);
