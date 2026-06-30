-- Migration 0099_items_menu_price
-- Applied via Supabase MCP apply_migration on 2026-06-30.
-- Canonical reference: docs/superpowers/specs/2026-06-30-r2-cost-yield-design.md §3
-- R2: hand-entered sell price on items → food-cost % = per-unit cost ÷ menu_price.
-- One column on items, so it serves global AND location-only specialty items by
-- construction (promoteItemToGlobal flips location_id in place, carrying the price).
alter table items add column menu_price numeric
  check (menu_price is null or menu_price > 0);
