-- Migration 0142_vendor_items_inventory_only
-- Applied via Supabase MCP apply_migration on 2026-07-21.
-- Operational Seed Stage 2: flag packaging / cleaning-supply SKUs as inventory-only.
-- These are real order-guide lines (ordered, par'd, received, counted) but must NOT
-- appear in ingredient contexts — recipe builds, item "made from" (BOM), prep items.
-- The recipe/BOM SKU pickers filter inventory_only = false; all inventory surfaces
-- (SKU admin, vendor detail, receiving, par, readiness) keep showing every SKU.
-- Canonical reference: scripts/seed/02-skus.ts (sets it true for the guide's
-- "Packaging Supplies" + "Trimark" sections).

ALTER TABLE public.vendor_items
  ADD COLUMN IF NOT EXISTS inventory_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.vendor_items.inventory_only IS
  'true = orderable/inventory-tracked but excluded from ingredient pickers (recipe/BOM/prep). Packaging + cleaning supplies. Set by operational seed Stage 2.';
