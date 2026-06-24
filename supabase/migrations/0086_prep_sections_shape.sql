-- Migration 0086_prep_sections_shape
-- Applied via Supabase MCP apply_migration on 2026-06-24.
-- Canonical reference: lib/prep-sections.ts (shapeToColumns / totalSourcesForShape) +
--   docs/superpowers/specs/2026-06-24-add-remove-sections-design.md

-- Add/remove-sections slice: a section's `shape` drives BOTH its column set and
-- its auto-total rule (no free composition — a YAGNI footgun). `columns` jsonb
-- stays the stored convention (loaders read it) but is now DERIVED from shape at
-- write time via shapeToColumns(). The 6 seeded rows are backfilled from their
-- known shapes; the numeric-shape `columns` are re-synced to the derived value.
--
-- GROUND-TRUTH NOTE: the Cooks row's columns were STALE (["par","on_hand","total"]
-- — missing back_up) relative to what CooksSection has actually rendered since the
-- Build #2 PR 1 follow-up (["par","on_hand","back_up","total"]). The components
-- hardcoded INPUT_COLUMNS and ignored this table, so the drift was invisible. The
-- data-driven render (this slice) makes prep_sections.columns load-bearing, so the
-- re-sync corrects Cooks to match the live component — a no-op for today's render.
-- Misc's columns are intentionally NOT clobbered (a yes_no section may carry a
-- free_text note column). CHECK enforced after backfill. RLS unchanged (deny-all).

alter table public.prep_sections add column shape text;

update public.prep_sections set shape = 'on_hand'   where slug in ('Veg','Cooks');
update public.prep_sections set shape = 'portioned' where slug = 'Sides';
update public.prep_sections set shape = 'line'      where slug in ('Sauces','Slicing');
update public.prep_sections set shape = 'yes_no'    where slug = 'Misc';

update public.prep_sections set columns = '["par","on_hand","back_up","total"]'::jsonb   where shape = 'on_hand';
update public.prep_sections set columns = '["par","portioned","back_up","total"]'::jsonb where shape = 'portioned';
update public.prep_sections set columns = '["par","line","back_up","total"]'::jsonb      where shape = 'line';

alter table public.prep_sections
  alter column shape set not null,
  add constraint prep_sections_shape_check
    check (shape in ('on_hand','portioned','line','yes_no'));
