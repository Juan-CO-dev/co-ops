-- Migration 0155_platter_depletion
-- STAGED in PR; prod apply deferred to Juan's go.
-- Canonical reference: docs/superpowers/specs/2026-07-25-toast-platter-depletion-design.md
--
-- Juan 2026-07-25: "we don't want to exclude them, we want anything we sell
-- as part of the system." Toast platter checks = parent "N pc platter" +
-- an ASSORTMENT modifier ("Our Favorites" = full enabled pool / "The
-- Classics" = the classic-flagged subset). Three schema moves:
--
-- 1. classic flag on slot options — Juan's Classics subset, managed in the
--    W1b packages editor alongside the existing enable/disable pool.
alter table public.catering_package_slot_options
  add column classic boolean not null default false;

-- 2. package targets on the crosswalk — a platter parent GUID maps to a CO
--    catering_package. XOR becomes exactly-one-of-3, with ONE carve-out:
--    assortment MODIFIER rows map a GUID to a BEHAVIOR (which pool), not an
--    entity, so they carry no FK at all.
alter table public.toast_menu_map
  add column package_id uuid references public.catering_packages(id);
alter table public.toast_menu_map drop constraint toast_map_entity_xor;
alter table public.toast_menu_map add constraint toast_map_entity_xor check (
  (num_nonnulls(menu_item_id, item_id, package_id) = 1)
  or (
    is_modifier
    and disposition in ('assortment_full', 'assortment_classics')
    and num_nonnulls(menu_item_id, item_id, package_id) = 0
  )
);

-- 3. assortment dispositions (constraint name verified against live prod).
alter table public.toast_menu_map drop constraint toast_menu_map_disposition_check;
alter table public.toast_menu_map add constraint toast_menu_map_disposition_check
  check (disposition in ('deplete', 'remove', 'ignore', 'assortment_full', 'assortment_classics'));
