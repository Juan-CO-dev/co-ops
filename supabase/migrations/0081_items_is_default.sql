-- Migration 0081_items_is_default
-- Applied via Supabase MCP apply_migration on 2026-06-23.
-- Canonical reference: lib/admin/templates.ts setItemDefault (default-template
--   membership + propagation) + docs/superpowers/specs/2026-06-23-checklist-admin-3tab-design.md

-- Item/Inventory Spine 2B′: default-template membership. A global item
-- (items.location_id IS NULL) with is_default = true is part of the default
-- checklist set that all locations inherit; MoO+ toggles it, and turning it on
-- propagates an enabled line (+ Opening mirror) to every location. Per-location
-- enable/disable + par overrides remain location-local (item_par_levels).

alter table public.items add column is_default boolean not null default false;

-- Backfill: every existing GLOBAL item is currently part of the default set
-- (keeps today's behavior — all active global items propagate by default).
update public.items set is_default = true where location_id is null and active;
