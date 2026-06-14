-- Migration 0059_c43_midday_prep_discriminator
-- Applied via Supabase MCP apply_migration on 2026-06-14.
-- Canonical reference: lib/prep.ts loadAmPrepState / loadMidDayPrepState;
--   docs/superpowers/specs/2026-06-13-c43-midday-prep-design.md §3.
--
-- C.43 — Mid-day Prep multi-instance numbered prep. Distinguishes AM vs Mid-day
-- prep templates (both type='prep') via prep_subtype, and allows multiple mid-day
-- instances per day via a denormalized allows_multiple_per_day flag + a partial
-- unique index. triggered_at / triggered_by_user_id already exist (migration 0038).
--
-- Ordering note: prep_subtype column is added nullable, backfilled, THEN the CHECK
-- is added — adding the CHECK before backfill would fail on existing prep rows.

-- 1. Template discriminator (nullable column first — no constraint yet).
alter table public.checklist_templates add column prep_subtype text;

-- 2. Backfill existing prep templates to am_prep (only prep subtype pre-C.43).
update public.checklist_templates set prep_subtype = 'am_prep' where type = 'prep';

-- 3. NOW add the CHECK (existing rows already satisfy it).
alter table public.checklist_templates
  add constraint checklist_templates_prep_subtype_check
  check (
    (type <> 'prep' and prep_subtype is null)
    or (type = 'prep' and prep_subtype in ('am_prep', 'mid_day_prep'))
  );

-- 4. Instance-level multi-per-day flag (denormalized from template prep_subtype).
alter table public.checklist_instances
  add column allows_multiple_per_day boolean not null default false;

-- 5. Conditional single-per-day: drop blanket UNIQUE, replace with partial index.
--    (A unique index predicate cannot subquery the template's prep_subtype, so the
--     gate is a denormalized instance column set at create time.)
alter table public.checklist_instances
  drop constraint checklist_instances_template_id_location_id_date_key;

create unique index checklist_instances_single_per_day_key
  on public.checklist_instances (template_id, location_id, date)
  where not allows_multiple_per_day;
