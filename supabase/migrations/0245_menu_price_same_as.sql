-- Migration 0245_menu_price_same_as
-- AUTHORED 2026-10-11, NOT YET APPLIED — GATE CC: sim first, then prod.
-- APPLIED TO PROD 2026-10-11 (schema_migrations version 20261011213433, name '0245_menu_price_same_as'; true dry run first; sim first).
-- One-hop selling-price inheritance. Existing table grants and deny-all RLS remain in force.
begin;
alter table public.menu_items
  add column price_same_as_id uuid null references public.menu_items(id),
  add constraint menu_items_price_same_as_not_self check (price_same_as_id is null or price_same_as_id <> id);
commit;
