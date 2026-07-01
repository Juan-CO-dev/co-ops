-- Migration 0102_production_header_lines
-- Applied via Supabase MCP apply_migration on 2026-07-01.
-- Canonical reference: docs/superpowers/specs/2026-07-01-production-in-prep-fold-design.md §5
-- Reshape S1's single-input productions (0 rows) into a header + production_inputs lines
-- model: one prep-save conversion event → N leaf-SKU depletions. instance_id/template_item_id
-- link + superseded_at/revoked_at drive prep-save idempotency (§6). Deny-all RLS on lines.

alter table productions drop column input_sku_id;
alter table productions drop column input_qty;
alter table productions add column source text not null default 'manual'
  check (source in ('opening_p2','mid_day_p2','manual'));
alter table productions alter column source drop default;
alter table productions add column instance_id uuid references checklist_instances(id);
alter table productions add column template_item_id uuid references checklist_template_items(id);
alter table productions add column superseded_at timestamptz;
alter table productions add column revoked_at timestamptz;

create table production_inputs (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references productions(id) on delete cascade,
  input_sku_id uuid not null references vendor_items(id),
  input_oz numeric not null check (input_oz > 0),
  qty_entered numeric,
  unit_entered text,
  derived_oz numeric
);
create index production_inputs_production_idx on production_inputs(production_id);
create index production_inputs_sku_idx on production_inputs(input_sku_id);
create index productions_prep_live_idx on productions(instance_id, template_item_id)
  where superseded_at is null and revoked_at is null;

alter table production_inputs enable row level security;
create policy production_inputs_no_user_select on production_inputs for select using (false);
create policy production_inputs_no_user_insert on production_inputs for insert with check (false);
create policy production_inputs_no_user_update on production_inputs for update using (false);
create policy production_inputs_no_user_delete on production_inputs for delete using (false);
