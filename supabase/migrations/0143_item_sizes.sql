-- Migration 0143_item_sizes
-- Applied via Supabase MCP apply_migration on 2026-07-22.
-- Canonical reference: docs/superpowers/specs/2026-07-22-catering-alacarte-menu-and-sizes-design.md
--
-- Catering sub-project A: per-item explicit-price catering sizes for side items + the chosen
-- size on a cart line. Deny-all config table (service-role/lib authority) — mirrors item_components
-- (split _no_user_{insert,update,delete}, no select policy → default-deny; never FOR ALL per the
-- AGENTS "FOR ALL permits DELETE silently" lesson).

create table public.item_sizes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id),
  label text not null,
  price_cents integer not null check (price_cents >= 0),
  serves numeric,
  display_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (item_id, label)
);
alter table public.item_sizes enable row level security;
create policy item_sizes_no_user_insert on public.item_sizes for insert with check (false);
create policy item_sizes_no_user_update on public.item_sizes for update using (false);
create policy item_sizes_no_user_delete on public.item_sizes for delete using (false);
create index item_sizes_item_id_idx on public.item_sizes(item_id) where active;

-- The chosen size on a sized-item cart line (nullable → un-sized items / subs stay null).
alter table public.catering_quote_items
  add column size_id uuid references public.item_sizes(id);
