-- Migration 0251_catering_quote_line_kind
-- AUTHORED 2026-10-14, NOT YET APPLIED — GATE CC: sim first, then prod. Apply BEFORE the B7c
-- code deploys: the staff quote writer and the portal draft writer name these two columns.
--
-- B7c (Juan 2026-10-14, "yes to all"): a quote line says what part of a package it is, so Prep
-- Demand never has to guess. Before this, a package line was told apart only by heuristics
-- (package id + no item reference = "the whole package"), and the staff builder's display-only
-- "Choose your sub" placeholders carried the package id too — so a 16 pc platter reserved 16 +
-- 256 subs to pick (Astra, rounds 1–2 of 12e208d3).
--
--   line_kind
--     'package_header'    — the package itself (package id, no item/menu reference). Qty =
--                           package units. Expanded by Prep Demand.
--     'package_component' — a concrete item/menu line of a package (reference + package id as
--                           a tag). Counted at its OWN Qty.
--     'package_pick'      — a "Choose your sub" slot line (package id, no reference). Display
--                           only while a header of that package is on the quote; the header's
--                           choice-slot expansion reserves the picks exactly once.
--     NULL                — a non-package line, or a LEGACY line saved before this migration
--                           (interpreted by the fixed legacy rules in lib/catering/prep-demand.ts).
--   components_listed (meaningful on a package_header only)
--     true        — this quote lists the package component by component: the header expands
--                   only the package's choice/pick slots, never its fixed components (even if
--                   every listed component was later removed).
--     false/NULL  — the header stands for the whole package (the customer portal's line).
--
-- ADDITIVE ONLY: two nullable columns + CHECKs that every existing row (both columns NULL)
-- satisfies. No backfill — legacy rows stay NULL and keep their legacy interpretation.
-- No RPC writes catering_quote_items (the staff quote lib and the portal draft lib insert via
-- the service-role client), so no function is re-emitted. No GRANT/REVOKE: the table's existing
-- grants and RLS cover the new columns.
begin;

alter table public.catering_quote_items
  add column line_kind text null
    constraint catering_quote_items_line_kind_check
    check (line_kind in ('package_header', 'package_component', 'package_pick')),
  add column components_listed boolean null;

-- Shape of a kinded line (NULL kind = unconstrained legacy/non-package line, as before).
alter table public.catering_quote_items
  add constraint catering_quote_items_line_kind_shape check (
    line_kind is null
    or (line_kind = 'package_header'    and package_id is not null and item_id is null and menu_item_id is null)
    or (line_kind = 'package_component' and package_id is not null and (item_id is not null or menu_item_id is not null))
    or (line_kind = 'package_pick'      and package_id is not null and item_id is null and menu_item_id is null)
  ),
  add constraint catering_quote_items_components_listed_header_only check (
    components_listed is null or line_kind = 'package_header'
  );

comment on column public.catering_quote_items.line_kind is
  'B7c 0251: package_header | package_component | package_pick; NULL = non-package or legacy line (legacy Prep Demand rules).';
comment on column public.catering_quote_items.components_listed is
  'B7c 0251: on a package_header only. true = components listed as their own lines (header expands choice slots only); false/NULL = header stands for the whole package.';

commit;
