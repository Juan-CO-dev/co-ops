-- Migration 0158_sku_modifier_targets
-- STAGED in PR; prod apply deferred to Juan's go.
-- Canonical reference: docs/superpowers/specs/2026-07-27-sku-modifier-salad-design.md
--
-- Part 2 of the Toast modifier depletion arc (2026-07-24 spec, "Part 2 (OUT,
-- named): SKU-ref removals"). Salads at the register = any sub/BYO + a "No
-- bread- serve it on a bed of greens" modifier whose depletion effect is REMOVE
-- one Sub Roll — and a Sub Roll is a SKU (vendor_items, no prep item). The
-- modifier lane could only target items/menu_items; a fourth SKU target unlocks
-- the salad conversion AND the raw-SKU condiments with no prep item (Arugula,
-- Pepperoncini, Dijon — the "mayo-as-SKU class").
--
-- XOR grows to exactly-one-of-4, preserving the assortment carve-out (a modifier
-- guid mapped to a pool BEHAVIOR carries no FK) — the 0155 replacement pattern.
-- SKU targets are always modifiers (is_modifier true, enforced app-layer): a raw
-- SKU is never a sold base line.

alter table public.toast_menu_map
  add column sku_id uuid references public.vendor_items(id);

alter table public.toast_menu_map drop constraint toast_map_entity_xor;
alter table public.toast_menu_map add constraint toast_map_entity_xor check (
  (num_nonnulls(menu_item_id, item_id, package_id, sku_id) = 1)
  or (
    is_modifier
    and disposition in ('assortment_full', 'assortment_classics')
    and num_nonnulls(menu_item_id, item_id, package_id, sku_id) = 0
  )
);
