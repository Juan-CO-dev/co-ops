-- Migration 0082_prep_sections
-- Applied via Supabase MCP apply_migration on 2026-06-23.
-- Canonical reference: lib/prep-sections.server.ts (loadPrepSections) +
--   docs/superpowers/specs/2026-06-23-sections-first-class-design.md

-- Item/Inventory Spine sub-slice A: prep sections become first-class data so a
-- section's LABEL can be renamed (Global tab, MoO+) without touching the system
-- key. `slug` is the stable internal key (= today's PrepSection enum string,
-- stamped into lines' station/prep_meta.section + frozen C.44 snapshots — never
-- changed); `label_en`/`label_es` are the editable display names; `columns` is
-- the per-section PrepColumn convention (moved off the hardcoded SECTION_COLUMNS
-- map so add/remove sections is a clean follow-up). Lines are NOT migrated — they
-- keep referencing the slug. Seeded labels = today's display → no-op render.

create table public.prep_sections (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label_en text not null,
  label_es text null,
  columns jsonb not null,
  display_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid null references public.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.users(id)
);
create index prep_sections_active_order on public.prep_sections (active, display_order);

alter table public.prep_sections enable row level security;
-- Deny all end-user DML; labels read via service-role loaders (spec decision).
-- Split per-op; never FOR ALL (AGENTS.md footgun).
create policy prep_sections_no_user_select on public.prep_sections for select using (false);
create policy prep_sections_no_user_insert on public.prep_sections for insert with check (false);
create policy prep_sections_no_user_update on public.prep_sections for update using (false) with check (false);
create policy prep_sections_no_user_delete on public.prep_sections for delete using (false);

-- Seed the 6 enum sections (label_es from the am_prep.section.* ES i18n values).
insert into public.prep_sections (slug, label_en, label_es, columns, display_order)
values
  ('Veg','Veg','Verduras','["par","on_hand","back_up","total"]',1),
  ('Cooks','Cooks','Cocidos','["par","on_hand","total"]',2),
  ('Sides','Sides','Acompañantes','["par","portioned","back_up","total"]',3),
  ('Sauces','Sauces','Salsas','["par","line","back_up","total"]',4),
  ('Slicing','Slicing','Rebanado','["par","line","back_up","total"]',5),
  ('Misc','Misc','Misceláneo','["yes_no"]',6)
on conflict (slug) do nothing;
