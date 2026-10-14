-- Migration 0251_catering_quote_line_kind
-- AUTHORED 2026-10-14, NOT YET APPLIED — GATE CC: sim first, then prod. Apply BEFORE the B7c
-- code deploys: the staff quote writer and the portal draft writer name these two columns.
--
-- B7c (Juan 2026-10-14, "yes to all"): every package line on a quote says what part of the
-- package it is, so Prep Demand never has to guess. Before this, a package line was told apart
-- only by heuristics (package id + no item reference = "the whole package"), and the staff
-- builder's "Choose your sub" placeholders carried the package id too — a 16 pc platter
-- reserved 16 + 256 subs to pick (Astra, rounds 1–3 of 12e208d3).
--
--   line_kind
--     'package_header'    — the package itself (package id, no item/menu reference). Qty =
--                           package units. Expanded by Prep Demand.
--     'package_component' — a concrete item/menu line of a package (reference + package id as
--                           a tag). Counted at its OWN Qty.
--     'package_pick'      — a "Choose your sub" slot line (package id, no reference). Display
--                           only while a header of that package is on the quote; the header's
--                           choice-slot expansion reserves the picks exactly once.
--     NULL                — a NON-package line (package_id is null). Nothing else: every line
--                           with a package id must carry its kind (CHECK below).
--   components_listed (on a package_header only)
--     true        — the quote lists the package component by component: the header expands
--                   only the package's choice/pick slots, never its fixed components (even if
--                   every listed component was later removed).
--     false/NULL  — the header stands for the whole package (the customer portal's line).
--
-- NO LEGACY ROWS (CC, read-only, 2026-10-14): production holds ONE catering quote and ZERO quote
-- lines with a package_id, and its catering_prep_demand is empty; the sim holds no quote lines
-- at all. So there is nothing to backfill and no legacy interpretation is kept: the DO block
-- below proves it on the target before the new CHECK goes on, and refuses loudly otherwise.
--
-- Additive: two nullable columns + three CHECKs. No RPC writes catering_quote_items (the staff
-- quote lib and the portal draft lib insert via the service-role client), so no function is
-- re-emitted. No GRANT/REVOKE: the table's existing grants and RLS cover the new columns.
begin;

alter table public.catering_quote_items
  add column line_kind text null
    constraint catering_quote_items_line_kind_check
    check (line_kind in ('package_header', 'package_component', 'package_pick')),
  add column components_listed boolean null;

-- Manifest guard: every existing row now has line_kind NULL, so a row with a package id would
-- violate catering_quote_items_package_line_has_kind. Expected count: 0 (prod and sim,
-- 2026-10-14). A drifted DB stops here with the count, before any constraint is added.
do $$
declare
  n int;
begin
  -- plpgsql compiles ASSERT to a no-op when plpgsql.check_asserts is off (see 0193): refuse
  -- instead of running blind.
  if current_setting('plpgsql.check_asserts', true) = 'off' then
    raise exception '0251: plpgsql.check_asserts is off — the manifest relies on ASSERT; refusing';
  end if;
  select count(*) into n from public.catering_quote_items where package_id is not null and line_kind is null;
  assert n = 0, format('0251: expected 0 package quote lines without a line_kind, found %s — stop and look (no legacy interpretation exists any more)', n);
end $$;

alter table public.catering_quote_items
  -- Every package line carries its kind; NULL kind = a non-package line only.
  add constraint catering_quote_items_package_line_has_kind check (
    package_id is null or line_kind is not null
  ),
  -- The shape of each kind.
  add constraint catering_quote_items_line_kind_shape check (
    line_kind is null
    or (line_kind = 'package_header'    and package_id is not null and item_id is null and menu_item_id is null)
    or (line_kind = 'package_component' and package_id is not null and (item_id is not null or menu_item_id is not null))
    or (line_kind = 'package_pick'      and package_id is not null and item_id is null and menu_item_id is null)
  ),
  -- components_listed belongs to a header only. coalesce(…, false): with line_kind NULL the
  -- comparison is NULL, and a NULL CHECK result PASSES — the coalesce makes it refuse.
  add constraint catering_quote_items_components_listed_header_only check (
    components_listed is null or coalesce(line_kind = 'package_header', false)
  );

comment on column public.catering_quote_items.line_kind is
  'B7c 0251: package_header | package_component | package_pick; NULL = non-package line only (every package line carries a kind).';
comment on column public.catering_quote_items.components_listed is
  'B7c 0251: on a package_header only. true = components listed as their own lines (header expands choice slots only); false/NULL = header stands for the whole package.';

commit;
