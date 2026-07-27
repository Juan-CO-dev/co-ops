-- Migration 0157_item_taxonomy
-- STAGED in PR; prod apply deferred to Juan's go.
-- Canonical reference: docs/superpowers/specs/2026-07-26-master-list-taxonomy-design.md
--
-- The Master List (piece 3). Item taxonomy: one type-label per registry row so
-- checklists/counts/prep/reports speak the same nine words Juan uses on the floor.
--
--   vendor_items.sku_class  — raw items are SKUs straight from vendors; packaging,
--     cleaning supplies, and misc smallwares are inventory-tracked but not
--     ingredients. Backfill: inventory_only=true → 'packaging' (Juan later curates
--     the smallwares → 'misc' and chemical SKUs → 'cleaning' in the SKU editor);
--     everything else → 'raw'.
--
--   items.item_type — prepped = bundled/portioned ready-to-use; on_hand =
--     sliced-not-bundled (prepped but not portioned); sold_as_is = sold as-is.
--     Backfill: sold_directly=true → 'sold_as_is'; else 'prepped'. Juan flips
--     intermediates to 'on_hand' as he tracks them.
--
-- menu_items made-vs-retail is DERIVED (an active consumer build → made; else
-- retail) — NO column here.
--
-- Defaults + NOT NULL so existing rows land on a sane class for a clean lens.

alter table public.vendor_items
  add column sku_class text not null default 'raw'
  check (sku_class in ('raw', 'packaging', 'cleaning', 'misc'));

update public.vendor_items set sku_class = 'packaging' where inventory_only = true;

alter table public.items
  add column item_type text not null default 'prepped'
  check (item_type in ('prepped', 'on_hand', 'sold_as_is'));

update public.items set item_type = 'sold_as_is' where sold_directly = true;

comment on column public.vendor_items.sku_class is
  'Taxonomy (0157): raw | packaging | cleaning | misc. raw = vendor ingredient SKU; the others are inventory-tracked non-ingredients. Curated in the SKU editor.';
comment on column public.items.item_type is
  'Taxonomy (0157): prepped (portioned) | on_hand (sliced-not-bundled) | sold_as_is. Set from the catalog dossier (item_type editor).';
