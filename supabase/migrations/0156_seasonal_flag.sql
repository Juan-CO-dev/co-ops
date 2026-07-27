-- Migration 0156_seasonal_flag
-- STAGED in PR; prod apply deferred to Juan's go.
-- Canonical reference: docs/superpowers/specs/2026-07-26-items-master-catalog-design.md
--
-- Items Master Catalog (piece 1). `seasonal` is a LABEL + LENS, not a hider —
-- availability stays governed by active/catering flags. Toggled from the catalog
-- dossier (items/menu_items via setCateringFlags; packages via updatePackage).
-- Default false so existing rows are non-seasonal; NOT NULL for a clean lens.

alter table public.items add column seasonal boolean not null default false;
alter table public.menu_items add column seasonal boolean not null default false;
alter table public.catering_packages add column seasonal boolean not null default false;
