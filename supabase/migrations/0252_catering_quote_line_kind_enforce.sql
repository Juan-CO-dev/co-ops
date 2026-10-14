-- Migration 0252_catering_quote_line_kind_enforce
-- AUTHORED 2026-10-14, NOT YET APPLIED — GATE: apply only AFTER the B7c deploy is live
-- (sim first, then prod). Requires 0251.
--
-- RELEASE (expand/contract, Astra r4 BC-038): this is the CONTRACT half of 0251. From here on
-- every package line on a quote MUST carry its line_kind; a NULL kind means a non-package line
-- only. Applied before the B7c code is live it would turn every package save by the OLD server
-- into a 23514 — and the old portal writer deletes the cart's lines before inserting their
-- replacements, so that failure leaves an EMPTY CART. Hence the order:
--   1. 0251 → sim, then prod      2. merge + deploy B7c      3. 0252 → sim, then prod
-- The B7c code never writes a kind-less package line (the staff write path refuses one with
-- 409 quote_lines_outdated; the portal stamps package_header), so it works before AND after this.
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
-- IF THE ASSERT FAILS: a quote line was written by the old server during the deploy window (or
-- by something that bypasses the app). Re-saving from the builder does NOT fix it (the builder
-- reloads the NULL kind and the server refuses it with 409); repair by hand, then retry. Never
-- weaken the CHECK to get past it.
--
-- REPAIR — the rule (what the OLD builders wrote, line by line, all tagged with the package id):
--   · a line with an item_id or menu_item_id               → package_component (components_listed NULL)
--   · a bare line whose description is the package label   → package_header
--       components_listed = TRUE  when the quote also lists that package's component / pick
--                                 lines as their own lines (the staff builder);
--                           FALSE when the header is the package's ONLY line (the portal, or a
--                                 package with no composition) — it then stands for the whole package
--   · a bare line whose description is a choice slot's     → package_pick (components_listed NULL)
--     label (catering_package_items.description, slot_type 'choice')
--   · anything else (retyped description)                  → a human decides from the quote
--
-- Step 1 — classify (read-only):
--   select qi.quote_id, qi.id, qi.display_order, qi.description, qi.item_id, qi.menu_item_id,
--          qi.quantity, qi.unit_price_cents,
--          case
--            when qi.item_id is not null or qi.menu_item_id is not null then 'package_component'
--            when lower(btrim(coalesce(qi.description, ''))) in (lower(btrim(p.label_en)), lower(btrim(coalesce(p.label_es, ''))))
--              then 'package_header'
--            when exists (select 1 from public.catering_package_items s
--                          where s.package_id = qi.package_id and s.slot_type = 'choice'
--                            and lower(btrim(coalesce(s.description, ''))) = lower(btrim(coalesce(qi.description, ''))))
--              then 'package_pick'
--            else 'REVIEW BY HAND'
--          end as proposed_kind
--     from public.catering_quote_items qi
--     join public.catering_packages p on p.id = qi.package_id
--    where qi.package_id is not null and qi.line_kind is null
--    order by qi.quote_id, qi.package_id, qi.display_order;
--
-- Step 2 — repair ONE quote, by line id, in one transaction (fill in the ids from step 1):
--   begin;
--   -- components:
--   -- update public.catering_quote_items set line_kind = 'package_component', components_listed = null
--   --  where id in ('<component line id>', ...) and line_kind is null;
--   -- pick lines:
--   -- update public.catering_quote_items set line_kind = 'package_pick', components_listed = null
--   --  where id in ('<pick line id>', ...) and line_kind is null;
--   -- the header (true = its components/picks are listed on the quote, false = it is the package's only line):
--   -- update public.catering_quote_items set line_kind = 'package_header', components_listed = <true|false>
--   --  where id = '<header line id>' and line_kind is null;
--   -- then re-run step 1: zero rows for that quote, and commit;
--   commit;
--
-- Step 3 — if that quote's lead is ALREADY Confirmed (confirmed by the old server in the window,
-- reserved with the old over-counting rules), move it Confirmed → Quote sent → Confirmed on the
-- board so its prep demand is re-reserved from the repaired lines.
begin;

do $$
declare
  n int;
begin
  -- plpgsql compiles ASSERT to a no-op when plpgsql.check_asserts is off (see 0193): refuse
  -- instead of running blind.
  if current_setting('plpgsql.check_asserts', true) = 'off' then
    raise exception '0252: plpgsql.check_asserts is off — the manifest relies on ASSERT; refusing';
  end if;
  select count(*) into n from public.catering_quote_items where package_id is not null and line_kind is null;
  assert n = 0, format('0252: expected 0 package quote lines without a line_kind, found %s — written by the old server in the deploy window? find and fix them before retrying', n);
end $$;

alter table public.catering_quote_items
  add constraint catering_quote_items_package_line_has_kind check (
    package_id is null or line_kind is not null
  );

comment on column public.catering_quote_items.line_kind is
  'B7c 0251/0252: package_header | package_component | package_pick; NULL = non-package line only (every package line carries a kind).';

commit;
