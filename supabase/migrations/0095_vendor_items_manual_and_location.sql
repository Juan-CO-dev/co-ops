-- Migration 0095_vendor_items_manual_and_location
-- Applied via Supabase MCP apply_migration on 2026-06-25.
-- Canonical reference: lib/admin/skus.ts +
--   docs/superpowers/specs/2026-06-25-sku-catalog-slice-c1-design.md

-- SKU catalog (Slice C1): support MANUAL (vendor-less) SKUs + per-location SKUs.
-- vendor_id becomes nullable (a SKU we buy ourselves to test, no vendor);
-- location_id added (null = global, set = location-specific). Existing 24 keep
-- their vendor + null location (= global). No backfill.
alter table public.vendor_items alter column vendor_id drop not null;
alter table public.vendor_items add column location_id uuid null references public.locations(id);
