-- Migration 0214_am_prep_drafts
-- AUTHORED 2026-10-06. NOT YET APPLIED — GATE (CC/JUAN). Sim first, prod on Juan's word.
-- Provenance: Juan's floor note (Wave 1 branch A, GO-coops-wave1-2026-10-06):
--   "the AM prep list resets whenever someone exits the am prep, which makes them have to
--    recount everything. It should just hold its inputs, so that even if the 10 minute
--    timer hits, they don't lose all their work, or if they need to stop the count and do
--    something else."
-- Pattern mirrored: 0203_opening_phase1_drafts (LRA-121).
--
-- WHAT: `public.am_prep_drafts` — ONE row per shop per business day
--       (`location_id`, `business_date`), holding the unsubmitted contents of the AM prep
--       form as jsonb, merged and updated in place.
--
-- WHY: AM prep counts lived ONLY in the browser's React state until submit. Leaving the
--      page, the idle timeout (10 minutes, then a client-side push to the sign-in page),
--      a closed tab or a second phone all threw the count away, and the crew recounted
--      the whole kitchen.
--
-- ── KEY: PER SHOP PER DAY, NOT PER INSTANCE (differs from 0203, on purpose) ───────────
-- 0203 keys on `instance_id`. The spec for this table says ONE shared draft per shop per
-- business day, so a second person who finishes a count someone else started sees the
-- first person's numbers. AM prep is already single-instance-per-day-per-location
-- (checklist_instances UNIQUE(template_id, location_id, date)), so on an ordinary day the
-- two keys name the same row; the day key additionally means a mid-day template re-version
-- (new instance id) replaces the row rather than leaving a second one. `instance_id` rides
-- on the row and the loader ignores a draft whose instance does not match the page's.
--
-- ── THIS IS WORKING STATE, NOT HISTORY — AND THAT IS WHY IT UPDATES IN PLACE ──────────
-- Same reasoning as 0203. The accountability record for AM prep is written by
-- `submit_am_prep_atomic` (0041) into `checklist_completions` / `checklist_submissions`,
-- both append-only. A keystroke buffer is not that record. A successful submit stamps
-- `consumed_at` (POST /api/prep/submit → consumeAmPrepDraft); a failed submit leaves the
-- draft untouched. There is deliberately NO delete path, app-side or RLS-side.
--
-- ── RLS POSTURE: DENY-ALL, EXACTLY AS 0203 ───────────────────────────────────────────
-- RLS enabled, `REVOKE ALL … FROM anon, authenticated, public`, NO user-facing policies.
-- The ONLY reader and writer are service-role:
--
--     lib/am-prep-draft.ts  loadAmPrepDraft()     ← app/(authed)/operations/am-prep/page.tsx
--     lib/am-prep-draft.ts  saveAmPrepDraft()     ← app/api/prep/draft/route.ts
--     lib/am-prep-draft.ts  consumeAmPrepDraft()  ← app/api/prep/submit/route.ts
--
-- The staff JWT is a valid PostgREST bearer (AGENTS.md), so any grant to `authenticated`
-- would open every shop's in-progress count to curl past every app gate. No grant, so no
-- policy to write: a policy for a role holding no privilege is inert decoration (the
-- 0172/0174/0182/0203 precedent).
--
-- LOCATION SCOPING is therefore enforced where the access is: the app layer. Every write
-- binds the actor to the instance's shop with `lockLocationContext` INSIDE the lib
-- (saveAmPrepDraft / consumeAmPrepDraft), and the location + day are derived from the
-- instance server-side, never taken from the request body. `tests/location-bind-
-- differential.test.ts` lists this table and file, so an unbound writer fails CI.
--
-- ── THE APP-LAYER ROLE FLOOR ─────────────────────────────────────────────────────────
-- The same gate as AM prep submit (`submitAmPrep`, lib/prep.ts): level >=
-- AM_PREP_BASE_LEVEL (4) OR an active am_prep `report_assignments` row for the actor, shop
-- and day. Unlike opening (where the level-3 employee walks and a key holder submits), the
-- AM prep page itself refuses anyone below that gate, so the draft floor and the page
-- floor are the same thing.
--
-- No enum, no trigger, no RPC. `saved_at` is written explicitly by the writer (DEFAULT
-- fires on INSERT only). Re-runnable: `create table if not exists`, `create index if not
-- exists`.
--
-- VERIFY AFTER APPLY (the 0132/0189 law — verify grants, never assume):
--   select relrowsecurity from pg_class
--    where oid = 'public.am_prep_drafts'::regclass;            -- expect: t
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'am_prep_drafts'
--      and grantee in ('anon', 'authenticated', 'PUBLIC') order by 1, 2;
--                                                             -- expect: NO ROWS
--   select policyname from pg_policies
--    where schemaname = 'public' and tablename = 'am_prep_drafts';
--                                                             -- expect: NO ROWS (deny-all)

begin;

create table if not exists public.am_prep_drafts (
  -- The shop and its business day: ONE shared draft per (shop, day), updated in place.
  location_id   uuid        not null references public.locations(id),
  business_date date        not null,
  -- The AM prep instance the lines belong to (their keys are that template's item ids).
  instance_id   uuid        not null references public.checklist_instances(id),
  -- The envelope parsed by parseAmPrepDraft (lib/am-prep-draft-shared.ts):
  --   { version: 1,
  --     items: { <template_item_id>: { onHand?, portioned?, line?, backUp?, total?   -- raw strings
  --                                    yesNo?, freeText? } } }
  -- Untyped on purpose: one pure TS validator owns the shape and rejects a malformed
  -- draft whole (the 0203 posture).
  draft         jsonb       not null,
  -- Last writer — drives "Picked up where you left off at 9:42 (Maria)". NULL-able: the
  -- draft is not an accountability record and must not fail to save over attribution.
  saved_by      uuid        null references public.users(id),
  saved_at      timestamptz not null default now(),
  -- Stamped by a SUCCESSFUL submit. A consumed draft is never restored.
  consumed_at   timestamptz null,
  created_at    timestamptz not null default now(),
  primary key (location_id, business_date)
);

comment on table public.am_prep_drafts is
  'Unsubmitted AM prep form state, ONE row per (location, business day), merged and updated '
  'in place. Working state, NOT history — the submit RPC (0041) writes the accountability '
  'rows; a successful submit stamps consumed_at. No delete path. Service-role access only '
  '(lib/am-prep-draft.ts); deny-all RLS posture per 0203.';

-- Forensic lookup by instance ("which count did this draft belong to").
create index if not exists am_prep_drafts_instance_ix
  on public.am_prep_drafts (instance_id);

alter table public.am_prep_drafts enable row level security;
revoke all on public.am_prep_drafts from anon, authenticated;
revoke all on public.am_prep_drafts from public;

commit;
