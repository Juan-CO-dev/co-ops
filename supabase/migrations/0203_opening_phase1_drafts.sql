-- Migration 0203_opening_phase1_drafts
-- AUTHORED 2026-09-15. NOT YET APPLIED — GATE (LEAD/JUAN). Sim first, prod on Juan's word.
-- Provenance: launch-readiness audit row LRA-121 (STAFF-5), sim journey
--             `opening.phase1.persist-before-submit`
--             (scripts/sim/launch-readiness/journeys/opening.spec.ts).
--
-- WHAT: `public.opening_phase1_drafts` — ONE row per opening `checklist_instances` id,
--       holding the unsubmitted contents of the Phase 1 verification form as jsonb,
--       updated in place.
--
-- WHY: Phase 1 work — station ticks, fridge temperatures, per-item comments, spot-check
--      recounts, the section-verify beat and the no-prior-data attestation — lived ONLY in
--      the browser's React state until a key holder tapped submit. An employee is level 3;
--      `submit_phase1_atomic` floors at OPENING_BASE_LEVEL = 4. So the shift's real
--      sequence (employee walks the shop, key holder arrives on their OWN device and
--      submits) is exactly the sequence that loses every keystroke. Navigating away loses
--      it too. Managers start on the app 2026-09-21; this has to hold before then.
--
-- ── THIS IS WORKING STATE, NOT HISTORY — AND THAT IS WHY IT UPDATES IN PLACE ──────────
-- The append-only law (AGENTS.md, "Append-only is law, enforced at RLS") protects the
-- ACCOUNTABILITY record: who said what about the kitchen, and when. A pre-submit form
-- buffer is not that record. The accountability rows for Phase 1 are written by
-- `submit_phase1_atomic` (migration 0055) into `checklist_completions` and
-- `opening_section_verifications`, both append-only, and those SUPERSEDE this row
-- wholesale: the page loader ignores a draft the moment `checklist_instances.status`
-- leaves 'open'. Versioning a keystroke buffer would file thousands of rows a morning
-- that no one will ever read and that answer no question the completion rows do not
-- already answer. So: primary key on `instance_id`, upsert in place, one row forever.
--
-- There is deliberately NO delete path, app-side or RLS-side. A stale draft on a
-- submitted instance is inert (never read) and is forensically harmless.
--
-- ── RLS POSTURE: DENY-ALL, AND IT IS DELIBERATE ──────────────────────────────────────
-- This is the house idiom for every table created since 0168/0174 (0174's five, 0175's
-- one, 0182's five): RLS enabled, `REVOKE ALL … FROM anon, authenticated, public`, and NO
-- user-facing policies at all. It is the right posture here because the ONLY reader and
-- the ONLY writer of this table are service-role:
--
--     lib/opening.ts  loadOpeningPhase1Draft()  ← app/(authed)/operations/opening/page.tsx
--     lib/opening.ts  saveOpeningPhase1Draft()  ← app/api/opening/phase1/draft/route.ts
--
-- Both take the client from `getServiceRoleClient()`, which bypasses RLS entirely. No app
-- code path reads or writes this table on a user-context (`createAuthedClient`) client,
-- so `authenticated` needs no grant, and policies written for a role that holds no table
-- privilege would be inert decoration.
--
-- The grant is not a harmless spare key. AGENTS.md: "The staff JWT is a valid PostgREST
-- bearer" — it carries `role:'authenticated'` and is signed with the project secret, so
-- anything `authenticated` may touch is reachable by any staff member with a cookie and
-- curl, past every app-layer gate. That is exactly how `catering_insights` and
-- `release_overdue_closings` sat open from 0121/0046 until the 2026-09-01 audit, and what
-- 0189 closed. Granting here would open a direct-PostgREST path — read AND write — to
-- every shop's in-progress opening form, for a capability the app does not use and would
-- not notice losing. Deny-all costs nothing and closes it by construction.
--
-- Explicit deny POLICIES are deliberately not stacked on top of the revoke (the
-- 0172/0174/0182 precedent): with no privilege granted, there is nothing for a policy to
-- narrow, and a policy that can never be evaluated reads as protection that is not there.
-- The "never FOR ALL / always pair an explicit FOR DELETE USING (false)" law governs
-- tables that grant write privileges to a PostgREST role; this one grants none.
--
-- ── WHY `location_id` IS STORED AT ALL, GIVEN NO POLICY READS IT ─────────────────────
-- Forensics and future optionality, not RLS: it makes "which shop's openings have drafts
-- open right now" a flat indexed query instead of a join through
-- `checklist_instances`, and if this table ever DOES acquire a user-context reader, the
-- location predicate is already a column on the row rather than a correlated subquery.
-- The route sets it from the instance it just loaded, so it can never disagree; the FK
-- keeps it a real location.
--
-- ── THE APP-LAYER FLOOR (there is no DB floor, by the posture above) ─────────────────
-- POST /api/opening/phase1/draft gates at `OPENING_DRAFT_MIN_LEVEL` = 3
-- (lib/opening-draft-shared.ts) and binds the actor's location with `lockLocationContext`
-- against the instance's own location, the same way POST /api/opening/submit/phase1 does.
-- 3 is the opening PAGE's floor, NOT the submit floor: 4 (`OPENING_BASE_LEVEL`) gates
-- `submit_phase1_atomic`, while the page carries no level gate beyond a live session and
-- every opening template item is `min_role_level = 3`. The level-3 employee IS the actor
-- whose work this table exists to save — flooring the draft at 4 would rebuild LRA-121
-- inside its own fix.
--
-- No enum, no trigger, no RPC. `saved_at` is written explicitly by the writer (the column
-- DEFAULT fires on INSERT only, and an upsert landing on the UPDATE arm would otherwise
-- keep the first save's timestamp), with the DEFAULT kept for the insert path's safety.
--
-- Re-runnable: `create table if not exists`, `create index if not exists`.
--
-- VERIFY AFTER APPLY (the 0132/0189 law — verify grants, never assume):
--   select relrowsecurity from pg_class
--    where oid = 'public.opening_phase1_drafts'::regclass;     -- expect: t
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'opening_phase1_drafts'
--      and grantee in ('anon', 'authenticated', 'PUBLIC') order by 1, 2;
--                                                             -- expect: NO ROWS
--   select policyname from pg_policies
--    where schemaname = 'public' and tablename = 'opening_phase1_drafts';
--                                                             -- expect: NO ROWS (deny-all)

begin;

create table if not exists public.opening_phase1_drafts (
  -- PK on the instance: one draft per opening, updated in place. This IS the
  -- "working state, not history" decision, expressed as a constraint.
  instance_id  uuid        primary key references public.checklist_instances(id),
  -- Denormalized from the instance (see header — forensics + optionality, not RLS).
  location_id  uuid        not null references public.locations(id),
  -- The envelope parsed by parseOpeningPhase1Draft (lib/opening-draft-shared.ts):
  --   { version: 1,
  --     items:    { <template_item_id>: { countValue, photoId, notes, ticked, openerRecount } },
  --     sections: { <section_key>: boolean },
  --     openerNoPriorDataAttestation: 'planned_closure' | 'missed_or_unknown' | null }
  -- Untyped on purpose: the shape is owned by one pure TS validator that rejects a
  -- malformed draft whole, and a CHECK constraint here would be a second, weaker opinion
  -- about it that a shape change would have to migrate (the posture audit_log takes with
  -- AuditAction, and par_auto_moves.reason_code with ParReasonCode).
  draft        jsonb       not null,
  -- Last writer. NULL-able because the draft is not an accountability record and must not
  -- fail to save over attribution.
  saved_by     uuid        null references public.users(id),
  saved_at     timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

comment on table public.opening_phase1_drafts is
  'LRA-121: unsubmitted Phase 1 opening form state, ONE row per instance, updated in '
  'place. Working state, NOT history — superseded wholesale by submit_phase1_atomic '
  '(0055) and never read once checklist_instances.status leaves ''open''. Deliberately '
  'not append-only and deliberately has no delete path. Service-role access only '
  '(lib/opening.ts load/saveOpeningPhase1Draft); deny-all RLS posture per 0174/0182.';

-- The read path is by PK (the page loads one instance's draft). This index serves the
-- location-scoped forensic sweep described in the header.
create index if not exists opening_phase1_drafts_location_ix
  on public.opening_phase1_drafts (location_id);

alter table public.opening_phase1_drafts enable row level security;
revoke all on public.opening_phase1_drafts from anon, authenticated;
revoke all on public.opening_phase1_drafts from public;

commit;
