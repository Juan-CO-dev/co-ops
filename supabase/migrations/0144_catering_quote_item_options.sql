-- Migration 0144_catering_quote_item_options
-- Applied via Supabase MCP apply_migration on 2026-07-22.
-- Canonical reference: docs/superpowers/specs/2026-07-22-catering-package-configurator-design.md
--
-- Sub-project B: the customer's per-slot picks for a package cart line (whole-sub allocation).
-- ON DELETE CASCADE so the delete-then-reinsert cart replace in setDraftLines stays clean.
-- Deny-all config table (service-role/lib authority) — mirrors catering_package_slot_options.
create table public.catering_quote_item_options (
  id uuid primary key default gen_random_uuid(),
  quote_item_id uuid not null references public.catering_quote_items(id) on delete cascade,
  package_item_id uuid not null references public.catering_package_items(id),
  item_id uuid references public.items(id),
  menu_item_id uuid references public.menu_items(id),
  quantity numeric not null check (quantity > 0),
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint catering_quote_item_options_one_ref check ((item_id is null) <> (menu_item_id is null))
);
create index catering_quote_item_options_quote_item_idx on public.catering_quote_item_options(quote_item_id);
alter table public.catering_quote_item_options enable row level security;
create policy catering_quote_item_options_no_user_insert on public.catering_quote_item_options for insert with check (false);
create policy catering_quote_item_options_no_user_update on public.catering_quote_item_options for update using (false);
create policy catering_quote_item_options_no_user_delete on public.catering_quote_item_options for delete using (false);
