-- Migration 0246_location_toast_in_store_menu
-- AUTHORED 2026-10-11, NOT YET APPLIED — GATE CC: sim first, then prod.
-- APPLIED TO PROD 2026-10-11 (schema_migrations version 20261011214424, name '0246_location_toast_in_store_menu'; true dry run first; sim first 20261011214405).
-- Per-shop Toast menu selection. No GRANT/REVOKE: preserve existing locations ACLs
-- (including any column-level restrictions) and RLS; the loader uses service_role.
begin;
alter table public.locations
  add column toast_in_store_menu_name text null
  check (toast_in_store_menu_name is null or char_length(btrim(toast_in_store_menu_name)) between 1 and 120);
commit;
