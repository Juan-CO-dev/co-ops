-- Migration 0251_catering_quote_line_kind
-- AUTHORED 2026-10-14, NOT YET APPLIED — GATE CC: sim first, then prod, BEFORE the B7c deploy.
-- APPLIED TO SIM 2026-10-14 (schema_migrations version 20261014174514, name '0251_catering_quote_line_kind')
-- APPLIED TO PROD 2026-10-14 (schema_migrations version 20261014174531, name '0251_catering_quote_line_kind')
--
-- RELEASE (expand/contract, Astra r4 BC-038): this is the EXPAND half. It only ADDS — two
-- nullable columns and two CHECKs that every row the OLD server writes still satisfies (the old
-- writers name neither column, so their package lines land with line_kind NULL, which both CHECKs
-- accept). So it is safe to apply while the old code is still serving. The CONTRACT half — every
-- package line MUST carry its kind — is 0252, applied only AFTER the B7c code is live.
--   1. 0251 → sim, then prod      (old server keeps working)
--   2. merge + deploy B7c         (new server writes a kind on every package line)
--   3. 0252 → sim, then prod      (refuses a kind-less package line from then on)
--
-- DEPLOY RUNBOOK — HARD GATE (Astra r5): run the whole thing OUTSIDE catering hours.
--   1. 0251 → sim, then prod.
--   2. Merge + deploy B7c IMMEDIATELY after step 1 (back-to-back: the window between them is
--      when the OLD server can still save a package line without its kind).
--   3. As soon as the deploy is live, run the 0252 ASSERT query by hand:
--        select quote_id, id from public.catering_quote_items
--         where package_id is not null and line_kind is null;
--      zero rows → apply 0252 at once (sim, then prod).
--      any rows  → repair those lines by hand with the template in the 0252 header BEFORE anyone
--                  confirms the lead (B7c refuses the confirm with 409 quote_needs_repair until
--                  then), then apply 0252.
--
-- B7c (Juan 2026-10-14, "yes to all"): every package line on a quote says what part of the
-- package it is, so Prep Demand never has to guess. Before this, a package line was told apart
-- only by heuristics (package id + no item reference = "the whole package"), and the staff
-- builder's "Choose your sub" placeholders carried the package id too — a 16 pc platter
-- reserved 16 + 256 subs to pick (Astra, rounds 1–4 of 12e208d3).
--
--   line_kind
--     'package_header'    — the package itself (package id, no item/menu reference). Qty =
--                           package units. Expanded by Prep Demand.
--     'package_component' — a concrete item/menu line of a package (reference + package id as
--                           a tag). Counted at its OWN Qty.
--     'package_pick'      — a "Choose your sub" slot line (package id, no reference). Display
--                           only while a header of that package is on the quote; the header's
--                           choice-slot expansion reserves the picks exactly once.
--     NULL                — a non-package line. (Until 0252 also a package line written by the
--                           pre-B7c server in the deploy window; the new code counts such a line
--                           as no demand and logs its id — it never guesses.)
--   components_listed (on a package_header only)
--     true        — the quote lists the package component by component: the header expands
--                   only the package's choice/pick slots, never its fixed components (even if
--                   every listed component was later removed).
--     false/NULL  — the header stands for the whole package (the customer portal's line).
--
-- No backfill: production held ONE catering quote and ZERO package quote lines on 2026-10-14
-- (CC, read-only), the sim none. No RPC writes catering_quote_items (the staff quote lib and the
-- portal draft lib insert via the service-role client), so no function is re-emitted. No
-- GRANT/REVOKE: the table's existing grants and RLS cover the new columns.
begin;

alter table public.catering_quote_items
  add column line_kind text null
    constraint catering_quote_items_line_kind_check
    check (line_kind in ('package_header', 'package_component', 'package_pick')),
  add column components_listed boolean null;

alter table public.catering_quote_items
  -- The shape of each kind. A NULL kind passes (non-package lines, and old-server package lines
  -- until 0252).
  add constraint catering_quote_items_line_kind_shape check (
    line_kind is null
    or (line_kind = 'package_header'    and package_id is not null and item_id is null and menu_item_id is null)
    or (line_kind = 'package_component' and package_id is not null and (item_id is not null or menu_item_id is not null))
    or (line_kind = 'package_pick'      and package_id is not null and item_id is null and menu_item_id is null)
  ),
  -- components_listed belongs to a header only. coalesce(…, false): with line_kind NULL the
  -- comparison is NULL, and a NULL CHECK result PASSES — the coalesce makes it refuse. The old
  -- server never writes components_listed, so its rows (NULL) pass.
  add constraint catering_quote_items_components_listed_header_only check (
    components_listed is null or coalesce(line_kind = 'package_header', false)
  );

comment on column public.catering_quote_items.line_kind is
  'B7c 0251: package_header | package_component | package_pick; NULL = non-package line (0252 makes it required on every package line).';
comment on column public.catering_quote_items.components_listed is
  'B7c 0251: on a package_header only. true = components listed as their own lines (header expands choice slots only); false/NULL = header stands for the whole package.';

commit;
