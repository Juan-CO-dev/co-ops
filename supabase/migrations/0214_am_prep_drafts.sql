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
--                           (via rpc save_am_prep_draft, below)
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
-- ── THE WRITE IS ONE ATOMIC RPC (review fix, PR #383) ────────────────────────────────
-- `save_am_prep_draft(p_instance_id, p_patch, p_saved_by)` does the merge IN SQL, under a
-- row lock, so two devices saving DIFFERENT lines at the same moment both land (a TS
-- read-merge-write lost one). In one transaction it:
--   1. locks the instance row FOR SHARE and rechecks status = 'open' (the submit RPC's
--      UPDATE of the instance therefore serializes against a save, in either order);
--   2. ensures the (location_id, business_date) row exists, then locks it FOR UPDATE;
--   3. if the stored row belongs to a DIFFERENT instance (template re-versioned mid-day):
--      refuses when the stored instance is the NEWER one (a stale tab on the old instance
--      must not reset the live count), else RESETS the lines AND `consumed_at` — a new open
--      instance must never inherit the old one's "consumed";
--   4. merges the patch line by line (jsonb `||` per template-item key; an empty `{}` line
--      deletes the key; same line → last write wins), caps the line count, stamps
--      saved_by / saved_at, and returns saved_at.
-- Role floor, location bind and the "is this an AM prep" check stay in the lib, which runs
-- them BEFORE calling the RPC. `consumeAmPrepDraft` is bound to the instance id, so an
-- older instance's submit can never consume a newer instance's draft.
--
-- Grants follow 0211: the table and both functions are revoked from public, anon and
-- authenticated; service_role is granted explicitly; a DO block refuses to commit if any
-- PostgREST role still holds EXECUTE. `saved_at` is written explicitly (DEFAULT fires on
-- INSERT only). Re-runnable: `if not exists` / `create or replace`.
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
--   select routine_name, grantee from information_schema.routine_privileges
--    where routine_schema = 'public'
--      and routine_name in ('save_am_prep_draft', 'am_prep_draft_merge_items')
--      and privilege_type = 'EXECUTE' order by 1, 2;   -- expect: service_role (+ owner) only

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
grant select, insert, update on public.am_prep_drafts to service_role;

-- ── The per-line merge (pure) ────────────────────────────────────────────────────────
-- Lines in p_patch with a non-empty object REPLACE the stored line; lines whose value is
-- `{}` are REMOVED (the line is blank now); every other stored line is untouched. Mirrors
-- mergeAmPrepDraftItems in lib/am-prep-draft-shared.ts.
create or replace function public.am_prep_draft_merge_items(p_base jsonb, p_patch jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog, public
as $$
  select (
    coalesce(p_base, '{}'::jsonb)
    || coalesce(
         (select jsonb_object_agg(e.key, e.value)
            from jsonb_each(coalesce(p_patch, '{}'::jsonb)) e
           where e.value <> '{}'::jsonb),
         '{}'::jsonb)
  ) - coalesce(
         (select array_agg(e.key)
            from jsonb_each(coalesce(p_patch, '{}'::jsonb)) e
           where e.value = '{}'::jsonb),
         array[]::text[]);
$$;

-- ── The atomic save ──────────────────────────────────────────────────────────────────
create or replace function public.save_am_prep_draft(
  p_instance_id uuid,
  p_patch       jsonb,
  p_saved_by    uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_inst        record;
  v_row         record;
  v_stored_created timestamptz;
  v_base        jsonb;
  v_consumed    timestamptz;
  v_items       jsonb;
  v_saved_at    timestamptz := clock_timestamp();
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'am_prep_draft:invalid_payload' using errcode = 'P0001';
  end if;

  -- 1. The instance, locked against the submit RPC's status UPDATE, and still open.
  select id, location_id, date, status, created_at
    into v_inst
    from public.checklist_instances
   where id = p_instance_id
   for share;
  if not found then
    raise exception 'am_prep_draft:instance_not_found' using errcode = 'P0001';
  end if;
  if v_inst.status <> 'open' then
    raise exception 'am_prep_draft:prep_instance_not_open' using errcode = 'P0001';
  end if;

  -- 2. The shop-day row: create it if absent (race-safe), then lock it.
  insert into public.am_prep_drafts (location_id, business_date, instance_id, draft, saved_by, saved_at)
  values (v_inst.location_id, v_inst.date, v_inst.id,
          jsonb_build_object('version', 1, 'items', '{}'::jsonb), p_saved_by, v_saved_at)
  on conflict (location_id, business_date) do nothing;

  select instance_id, draft, consumed_at
    into v_row
    from public.am_prep_drafts
   where location_id = v_inst.location_id and business_date = v_inst.date
   for update;

  -- 3. A different instance: refuse a stale (older) one, reset for a newer one.
  if v_row.instance_id <> v_inst.id then
    select created_at into v_stored_created
      from public.checklist_instances where id = v_row.instance_id;
    if v_stored_created is not null and v_stored_created > v_inst.created_at then
      raise exception 'am_prep_draft:draft_superseded' using errcode = 'P0001';
    end if;
    v_base := '{}'::jsonb;
    v_consumed := null;
  elsif v_row.consumed_at is not null then
    -- Same instance already handed in (unreachable while the instance is open; kept honest).
    v_base := '{}'::jsonb;
    v_consumed := v_row.consumed_at;
  else
    v_base := coalesce(v_row.draft -> 'items', '{}'::jsonb);
    v_consumed := null;
  end if;

  -- 4. Merge per line, cap, write.
  v_items := public.am_prep_draft_merge_items(v_base, p_patch);
  if (select count(*) from jsonb_object_keys(v_items)) > 500 then
    raise exception 'am_prep_draft:draft_too_large' using errcode = 'P0001';
  end if;

  update public.am_prep_drafts
     set instance_id = v_inst.id,
         draft       = jsonb_build_object('version', 1, 'items', v_items),
         consumed_at = v_consumed,
         saved_by    = p_saved_by,
         saved_at    = v_saved_at
   where location_id = v_inst.location_id and business_date = v_inst.date;

  return v_saved_at;
end $$;

revoke all on function public.am_prep_draft_merge_items(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.save_am_prep_draft(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.am_prep_draft_merge_items(jsonb, jsonb) to service_role;
grant execute on function public.save_am_prep_draft(uuid, jsonb, uuid) to service_role;
do $$ begin
  if exists (select 1 from information_schema.routine_privileges
              where routine_schema = 'public'
                and routine_name in ('save_am_prep_draft', 'am_prep_draft_merge_items')
                and grantee in ('PUBLIC', 'anon', 'authenticated')
                and privilege_type = 'EXECUTE') then
    raise exception '0214: unexpected am_prep_draft execute grant';
  end if;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'am_prep_drafts'
                and grantee in ('PUBLIC', 'anon', 'authenticated')) then
    raise exception '0214: unexpected am_prep_drafts table grant';
  end if;
end $$;

commit;
