-- Migration 0152_toast_map_modifier_lane
-- STAGED in PR; prod apply deferred to Juan's go.
-- Canonical reference: docs/superpowers/specs/2026-07-24-toast-modifier-depletion-design.md
--
-- Modifier lane on the crosswalk: BYO toppings + signature-sub deltas map to
-- prep ITEMS with a disposition (deplete/remove/ignore — Juan: removals COUNT,
-- "we do not count that as being consumed") and a derived per-application
-- portion (the 32x-trap guard: a topping never depletes a par-unit tray).

alter table public.toast_menu_map
  add column is_modifier boolean not null default false,
  add column disposition text not null default 'deplete'
    check (disposition in ('deplete','remove','ignore')),
  add column portion_qty numeric,
  add column portion_unit text;
