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
-- IF THE ASSERT FAILS: a quote line was written by the old server during the deploy window (or
-- by something that bypasses the app). Find it —
--   select quote_id, id, description from public.catering_quote_items
--    where package_id is not null and line_kind is null;
-- — and fix it before retrying (re-save the quote from the builder, or set its kind by hand
-- from what the line is). Never weaken the CHECK to get past it.
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
