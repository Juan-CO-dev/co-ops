-- Migration 0165_line_input_type
-- PR-2 of the checklist full-edit arc (council 2026-07-30, D2 ruling):
-- question input types for CLOSING/OPENING template lines.
--
-- The line records its input type EXPLICITLY — rendering and validation never
-- infer meaning from column overloading (the council's locked guardrail).
-- Storage for answers stays on the EXISTING checklist_completions columns:
--   yes_no    -> count_value 1/0  (answered-yes / answered-no; row = answered)
--   free_text -> notes            (the answer text)
-- This is honest because closing/opening templates VERSION on publish (new
-- item rows per version): a completion's template_item_id pins the input_type
-- it was answered under, so historical interpretation can never drift.
--
-- NULL input_type = the legacy vocabulary: plain tick, or count when
-- expects_count. Numeric stays the expects_count path (already built).
-- PREP lines speak prep_meta.columns, not this column — the CHECK keeps the
-- two vocabularies from ever coexisting on one line.

alter table public.checklist_template_items
  add column input_type text null;

alter table public.checklist_template_items
  add constraint cti_input_type_valid
  check (input_type is null or input_type in ('yes_no', 'free_text'));

-- A line is EITHER a count line or a question line, never both.
alter table public.checklist_template_items
  add constraint cti_input_type_not_count
  check (not (expects_count and input_type is not null));

-- input_type is the closing/opening vocabulary; prep-meta lines (prep +
-- opening Phase-2 mirrors) author their input via prep_meta.columns.
alter table public.checklist_template_items
  add constraint cti_input_type_not_prep
  check (input_type is null or prep_meta is null);
