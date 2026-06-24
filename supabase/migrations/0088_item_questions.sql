-- Migration 0088_item_questions
-- Applied via Supabase MCP apply_migration on 2026-06-24.
-- Canonical reference: lib/admin/templates.ts (addItemQuestion / propagation) +
--   docs/superpowers/specs/2026-06-24-item-attached-questions-slice2-design.md

-- Per-line input types + non-inventory questions (Slice 2, PR A): item-attached
-- questions are non-inventory prompts attached to a specific ITEM (vs section
-- questions in 0087 which attach to a section). `item_questions` is the canonical
-- definition (MoO+); each propagates as a normal checklist_template_items LINE
-- (item_id NULL — it's NOT the item's count line — + item_question_id FK) onto
-- every PREP list where the item has an active line, in the item's section. So
-- answers store as ordinary completions + surface on reports with zero new
-- plumbing ("rides the item onto its reports"). RLS deny-all. NO Opening mirror
-- (questions aren't opening-verified this arc). A line carries section_question_id
-- XOR item_question_id XOR neither (a normal item/inventory line) — never both.

create table public.item_questions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id),
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
create index item_questions_active on public.item_questions (active, item_id);

alter table public.item_questions enable row level security;
create policy item_questions_no_user_select on public.item_questions for select using (false);
create policy item_questions_no_user_insert on public.item_questions for insert with check (false);
create policy item_questions_no_user_update on public.item_questions for update using (false) with check (false);
create policy item_questions_no_user_delete on public.item_questions for delete using (false);

alter table public.checklist_template_items add column item_question_id uuid null references public.item_questions(id);
create index cti_item_question on public.checklist_template_items (item_question_id) where item_question_id is not null;
