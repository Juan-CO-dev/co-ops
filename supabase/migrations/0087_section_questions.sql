-- Migration 0087_section_questions
-- Applied via Supabase MCP apply_migration on 2026-06-24.
-- Canonical reference: lib/admin/templates.ts (addSectionQuestion / propagation) +
--   docs/superpowers/specs/2026-06-24-per-line-input-types-questions-slice1-design.md

-- Per-line input types + non-inventory questions (Slice 1, PR B): section
-- questions are non-inventory prompts attached to a section. `section_questions`
-- is the canonical definition (MoO+, global); each question propagates as normal
-- checklist_template_items LINES (item_id NULL) onto every prep list that runs
-- the section — exactly like default items propagate (#84 machinery) — so answers
-- store as ordinary completions + surface on reports with zero new plumbing.
-- The line carries `section_question_id` back to its canonical question for
-- idempotent propagation + edit-once/disable. input_type ∈ the 5 LineInputTypes.
-- RLS deny-all (admin loaders/writes via service-role). Questions are NOT in
-- Opening verification this arc (no mirror). Authority: MoO+ (Global tab).

create table public.section_questions (
  id uuid primary key default gen_random_uuid(),
  section_slug text not null references public.prep_sections(slug),
  label text not null,
  label_es text null,
  input_type text not null check (input_type in ('on_hand','portioned','line','yes_no','free_text')),
  include_note boolean not null default false,
  min_role_level integer null,
  required boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid null references public.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.users(id)
);
create index section_questions_active on public.section_questions (active, section_slug);

alter table public.section_questions enable row level security;
create policy section_questions_no_user_select on public.section_questions for select using (false);
create policy section_questions_no_user_insert on public.section_questions for insert with check (false);
create policy section_questions_no_user_update on public.section_questions for update using (false) with check (false);
create policy section_questions_no_user_delete on public.section_questions for delete using (false);

alter table public.checklist_template_items add column section_question_id uuid null references public.section_questions(id);
create index cti_section_question on public.checklist_template_items (section_question_id) where section_question_id is not null;
