-- Migration 0315_opening_counts_batch_prep
-- AUTHORED 2026-11-15. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word, AFTER 0215, 0255, 0287 and 0305).
-- APPLIED TO SIM 2026-11-16 (schema_migrations version 20261116004437, name '0315_opening_counts_batch_prep')
-- APPLIED TO PROD 2026-11-16 (schema_migrations version 20261116004957, name '0315_opening_counts_batch_prep')
-- Provenance: bug-audit wave W14 "Opening counts and batch prep" (found at 7494f738, re-confirmed on main 0a6e3246 and re-based on 3c32f330):
--   B020 (a blank AM-prep BACK UP made the batch row unsaveable, so the opening could never be finalized),
--   B078 (an older Phase 1 autosave or beacon could overwrite a newer draft),
--   B080 (an Undo or a save in flight could spoil a finalized prep report),
--   B181 (saving and undoing the same batch entry at the same moment could deadlock),
--   B182 (a general correction could permanently remove an item-tracking tick).
--   Owner decisions: W14-1 a (a blank BACK UP counts as zero), W14-3 a (item-tracking lines take no generic correction).
--
-- WHAT (one transaction; every re-emitted body is built mechanically from its LATEST definer and pinned as a
--   line-subsequence of it by tests/opening-counts-batch-prep-migration.test.ts — the 0215 / 0255 idiom):
--
--   1. opening_phase1_drafts gains client_tab uuid + client_seq bigint (both NULL-able), and the NEW
--      save_opening_phase1_draft(instance, location, draft, saved_by, client_tab, client_seq) → jsonb is the one
--      writer (SECURITY DEFINER, service_role only; the 0214 save_am_prep_draft pattern):
--        · locks the instance FOR SHARE and requires status = 'open' IN THE WRITE (the route's status read was a
--          separate request and could lose to submit_phase1_atomic);
--        · upserts with a same-tab compare-and-set: a request from the SAME tab whose counter is not higher
--          writes nothing and answers {applied:false}. Another tab, a request with no revision (an older
--          deployment) and a stored row with no revision keep last-write-wins — the cross-device rule is a
--          recorded decision (lib/opening.ts) and does not change.
--      Named refusals (P0001): opening_draft:invalid_payload / instance_not_found / phase1_not_open / location_mismatch.
--
--   2. save_phase2_item_atomic ← 0215, two changes:
--        · its first statement takes the opening instance row FOR NO KEY UPDATE (B080 / B181);
--        · B020: when the session's LINE is known and its BACK UP is NULL, the BACK UP is 0. The AM prep form
--          already totals a blank BACK UP as 0, Phase 1 lets that section verify without a recount, and a
--          recount always carries both boxes — so the row could never save (`backup_unknown`) and the opening
--          could never be finalized. A blank LINE is still `backup_unknown`. Mid-day is untouched (its Phase 1
--          already requires both boxes).
--
--   3. revoke_phase2_item_atomic ← 0215, re-ordered (same signature, same result, same completion UPDATE):
--        instance FOR NO KEY UPDATE → status must be phase1_complete (`phase2_not_eligible` otherwise, P0001)
--        → the item (plain read) → the prep_batch_sessions row FOR UPDATE → the completion UPDATE
--        (`revoke_conflict` on 0 rows) → the toss retraction. It used to update the completion first and lock
--        the session second, the opposite of the save (40P01). With no session row it is the old direct
--        UPDATE behind the lock, so lib/opening.ts now sends EVERY Phase 2 undo through it.
--
--   4. submit_phase2_atomic ← 0255, one change: the instance row FOR NO KEY UPDATE before the completeness
--      count. Recipients, the card's par, the universe and the guarded status UPDATE are byte-identical.
--
--   5. checklist_revoke_completion / checklist_revoke_with_reason / checklist_mark_not_done ← 0305 (audit W05:
--      0287's bodies with the ACTIVE-membership line, B150), one change each: the reference refusal
--      (`reference_row_not_correctable`) also covers an item-tracking line (ref_track_item_completion AND
--      references_template_item_id IS NOT NULL). Once such a tick is revoked nothing can tick it again (the
--      reconciler never re-ticks over a revoke; a manual tick is refused), so a hard-gated closing could
--      never be confirmed. Lock order, clocks, authority (W05's active membership included) and messages
--      unchanged.
--
-- LOCK ORDER (the AGENTS.md checklist order is: AM instance → closing instance → completion rows; parent locks
--   FOR NO KEY UPDATE; never a parent after a completion):
--     opening instance (FOR NO KEY UPDATE) → prep_batch_sessions row (FOR UPDATE) → completion rows.
--   All three opening Phase 2 writers now take exactly that, and none of them touches an AM or closing
--   instance, so the opening instance adds no edge to the global order. The 0287 corrections already lock
--   their one parent instance before the completion. submit_phase1_atomic (0215, untouched) writes Phase 1
--   rows and updates the instance status last; it shares no completion row with a Phase 2 writer (they
--   supersede / revoke rows with prep_data ? 'phase2' only and merely READ the Phase 1 row), so no cycle
--   passes through it. save_opening_phase1_draft: instance FOR SHARE → its own draft row; no other SQL writer
--   touches opening_phase1_drafts. Effect on the floor: Phase 2 saves and undos on ONE opening now run one at
--   a time (milliseconds), and finalize waits for the one in flight.
--
-- EXISTING ROWS: none are rewritten. Draft rows keep NULL client_tab / client_seq (last-write-wins until their
--   next save). Snapshot rows keep back_up_count NULL and are READ as 0 when the line is known — so an opening
--   stuck on `backup_unknown` today becomes finishable the moment this is applied, with no backfill. An
--   item-tracking tick that is ALREADY revoked stays revoked (append-only); the pre-flight below lists them.
--
-- CONSUMERS (same PR): lib/opening.ts (saveOpeningPhase1Draft → the RPC; revokePhase2Completion → always the
--   RPC, `phase2_not_eligible` and 40P01 / 55P03 mapped), app/api/opening/phase1/draft/route.ts,
--   lib/opening-draft-autosave.ts + opening-client.tsx (the revision), lib/batch-prep-shared.ts
--   sessionBackupBefore (the client twin of the B020 rule), lib/checklists.ts tagActualCompleter and the
--   closing screen (item-tracking lines offer no correction).
--
-- APP COMPATIBILITY (the app works BEFORE this file is applied):
--   · the draft save falls back to the 0203 upsert while save_opening_phase1_draft is missing (PGRST202 /
--     42883); the client's ordering fix is active either way, the server refusal only after the apply;
--   · every Phase 2 undo calls revoke_phase2_item_atomic, whose 0215 body already handles a row with no
--     batch session (identical to the old direct UPDATE) — the finalize race stays open until the apply;
--   · the item-tracking refusal is enforced in the app (lib + hidden controls) at once, in SQL after the apply;
--   · B020 is fixed BY the apply: until then a blank-BACK-UP batch row still cannot save (`backup_unknown`).
--   Re-emitted signatures are unchanged, so a deployment from before this PR keeps working after the apply.
--   Recommended order: SQL first (sim, then prod), then merge.
--
-- DEPENDS ON: 0203 (opening_phase1_drafts), 0215 (save / revoke, prep_batch_sessions, prep_batch_context),
--   0255 (submit_phase2_atomic), 0287 + 0305 (the three corrections), 0057 (the revocation columns).
--   APPLY ORDER: 0305 BEFORE 0315. 0305's own pre-flight accepts only 0287's correction bodies, so it cannot
--   be applied after this file; this file's pre-flight refuses by name when 0305 is missing.
--
-- PRE-FLIGHT (MCP, before apply):
--   select to_regprocedure('public.save_phase2_item_atomic(uuid,uuid,uuid,numeric,jsonb,jsonb,text,text,jsonb)'),
--          to_regprocedure('public.revoke_phase2_item_atomic(uuid,uuid,uuid,text,text)'),
--          to_regprocedure('public.submit_phase2_atomic(uuid,uuid,boolean,uuid,text,text)'),
--          to_regprocedure('public.checklist_mark_not_done(uuid,uuid,text)');                       -- all present
--   select strpos(prosrc, 'location_id = v_instance.location_id and active for share') > 0 from pg_proc
--    where proname = 'checklist_mark_not_done';                                                    -- t (0305 applied)
--   -- the live bodies this file re-emits (the DO block below refuses unless each is its source or this file's):
--   select proname, md5(regexp_replace(prosrc, '[^\x21-\x7E]+', '', 'g')) from pg_proc
--    where proname in ('save_phase2_item_atomic', 'revoke_phase2_item_atomic', 'submit_phase2_atomic',
--                      'checklist_revoke_completion', 'checklist_revoke_with_reason', 'checklist_mark_not_done');
--   -- B020: openings this unblocks (report the count; no action needed):
--   select count(*) from public.recipes where batch_mode;
--   select ci.id, ci.location_id, ci.date from public.checklist_instances ci
--     join public.opening_closer_count_snapshots s on s.opening_instance_id = ci.id
--    where ci.status = 'phase1_complete' and s.line_count is not null and s.back_up_count is null;
--   -- B182: item-tracking ticks ALREADY revoked on an OPEN closing (they stay revoked — report them first):
--   select cc.id, ci.location_id, ci.date from public.checklist_completions cc
--     join public.checklist_template_items cti on cti.id = cc.template_item_id
--     join public.checklist_instances ci on ci.id = cc.instance_id
--    where cti.ref_track_item_completion and cti.references_template_item_id is not null
--      and cc.revoked_at is not null and cc.superseded_at is null and ci.status = 'open';
--
-- VERIFY AFTER APPLY:
--   select proname, strpos(lower(prosrc), 'for no key update') > 0 from pg_proc
--    where proname in ('save_phase2_item_atomic', 'revoke_phase2_item_atomic', 'submit_phase2_atomic');   -- t, t, t
--   select strpos(prosrc, 'v_backup_before := 0;') > 0 from pg_proc where proname = 'save_phase2_item_atomic';  -- t
--   select proname, strpos(prosrc, 'ref_track_item_completion and references_template_item_id is not null') > 0
--     from pg_proc where proname like 'checklist_%' and proname in
--     ('checklist_revoke_completion', 'checklist_revoke_with_reason', 'checklist_mark_not_done');          -- t, t, t
--   select column_name from information_schema.columns where table_schema = 'public'
--    and table_name = 'opening_phase1_drafts' and column_name in ('client_tab', 'client_seq');              -- both
--   select routine_name, grantee from information_schema.routine_privileges where routine_schema = 'public'
--    and routine_name in ('save_opening_phase1_draft', 'save_phase2_item_atomic', 'revoke_phase2_item_atomic',
--      'submit_phase2_atomic', 'checklist_revoke_completion', 'checklist_revoke_with_reason',
--      'checklist_mark_not_done') order by 1, 2;                                                    -- service_role (+ postgres) only
--   Then the two-session proof on SIM only: scripts/sim/opening-phase2-0315-lock-check-management.mjs (CC runs it).
--
-- ROLLBACK: revert the app first (it then stops calling save_opening_phase1_draft and takes the direct
--   single-box undo again). The re-emitted functions keep their signatures and are safe to leave in place;
--   to restore the old bodies re-emit 0215 / 0255 / 0305 through a new reviewed migration. The two added
--   columns are harmless when left. Never delete or rewrite completion, submission or audit history.
--
-- Re-runnable: add column if not exists, create or replace; the pre-flight accepts this file's own bodies.

begin;

-- ── PRE-FLIGHT: every source object present, and every body this file re-emits is STILL the body it
--    was re-emitted from (or already this file's: a second run is a no-op). A later definer applied to
--    this database but unknown to this file refuses the apply instead of being silently overwritten.
--    The fingerprint is md5 over the body with everything but printable ASCII removed, so line endings
--    and the encoding of comment glyphs never matter; any change of code does.
do $$
declare
  r record;
  v_live text;
begin
  if to_regclass('public.opening_phase1_drafts') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'opening_phase1_drafts' and column_name = 'draft') then
    raise exception '0315: 0203 (opening_phase1_drafts) must be applied first';
  end if;
  if to_regclass('public.prep_batch_sessions') is null
     or to_regprocedure('public.prep_batch_context(uuid)') is null then
    raise exception '0315: 0215 (batch vs bottle) must be applied first';
  end if;
  -- 0305 (audit W05) re-emitted the three correction RPCs with an ACTIVE-membership check, and its own
  -- pre-flight accepts only 0287's bodies. This file re-emits FROM 0305, so 0305 goes first: applied
  -- the other way round, 0305 could never be applied after it.
  if exists (select 1 from pg_proc p
              where p.oid = to_regprocedure('public.checklist_mark_not_done(uuid,uuid,text)')
                and strpos(p.prosrc, 'location_id = v_instance.location_id and active for share') = 0) then
    raise exception '0315: 0305 (checklist corrections require an active membership) must be applied first';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'checklist_template_items'
         and column_name in ('ref_track_item_completion', 'references_template_item_id', 'report_reference_type')) <> 3 then
    raise exception '0315: checklist_template_items lacks the reference columns';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'checklist_completions'
         and column_name in ('revoked_at', 'revoked_by', 'revocation_reason', 'revocation_note', 'superseded_at', 'prep_data')) <> 6 then
    raise exception '0315: checklist_completions lacks the revocation columns (0057)';
  end if;
  for r in
    select * from (values
      ('public.save_phase2_item_atomic(uuid,uuid,uuid,numeric,jsonb,jsonb,text,text,jsonb)', '0215', '5fc8d3071c26f03253f48a11717a648b', '59014f4495ba6aae4648363b62b27623'),
      ('public.revoke_phase2_item_atomic(uuid,uuid,uuid,text,text)', '0215', '6bb5386ae3f96e584e97865c0baebe56', '4f3322d08ee03ec27a3a777f8bdbfdd3'),
      ('public.submit_phase2_atomic(uuid,uuid,boolean,uuid,text,text)', '0255', '7a9d437044cc4db2aece57dbc15878ce', '13a3433b03ac9732dd33a061dba41a7f'),
      ('public.checklist_revoke_completion(uuid,uuid)', '0305', 'a75f81a3a323c7e23cb0d3ebdcd52445', '2f9458d820c8650cc862695f73df8f28'),
      ('public.checklist_revoke_with_reason(uuid,uuid,text,text)', '0305', 'd88c7d325c04a24bb83d5cfe4e73b0b5', 'a49ffe598b34f314e92226646b996c34'),
      ('public.checklist_mark_not_done(uuid,uuid,text)', '0305', '0d7d62023c6cb35a983a96b3858c361b', 'f0cbff6f14f523c3228540b16d76081d')
    ) as t(sig, source_file, source_md5, own_md5)
  loop
    if to_regprocedure(r.sig) is null then
      raise exception '0315: % is missing (% must be applied first)', r.sig, r.source_file;
    end if;
    select md5(regexp_replace(p.prosrc, '[^\x21-\x7E]+', '', 'g')) into v_live
      from pg_proc p where p.oid = to_regprocedure(r.sig);
    if v_live is distinct from r.source_md5 and v_live is distinct from r.own_md5 then
      raise exception '0315: the live body of % (md5 %) is neither its % definition nor this file''s — a later definer exists; re-emit from it. Refusing.',
        r.sig, v_live, r.source_file;
    end if;
  end loop;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 1. opening_phase1_drafts — the per-tab revision (B078)
-- ═════════════════════════════════════════════════════════════════════════════════════════════
alter table public.opening_phase1_drafts
  add column if not exists client_tab uuid null,
  add column if not exists client_seq bigint null;
comment on column public.opening_phase1_drafts.client_tab is
  '0315: the browser tab (a random id minted per page load) whose save is stored. NULL = written before 0315 or by a request that carried no revision. Not an identity and not a secret.';
comment on column public.opening_phase1_drafts.client_seq is
  '0315: that tab''s send counter for the stored save. save_opening_phase1_draft refuses a save from the SAME tab whose counter is not higher, so a slow older autosave or beacon can never overwrite a newer one. NULL with client_tab.';

create or replace function public.save_opening_phase1_draft(
  p_instance_id uuid,
  p_location_id uuid,
  p_draft       jsonb,
  p_saved_by    uuid,
  p_client_tab  uuid,
  p_client_seq  bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_inst     record;
  v_saved_at timestamptz := clock_timestamp();
  v_applied  timestamptz;
begin
  if p_instance_id is null or p_draft is null or jsonb_typeof(p_draft) <> 'object' then
    raise exception 'opening_draft:invalid_payload' using errcode = 'P0001';
  end if;
  -- A revision is a (tab, sequence) pair or nothing at all.
  if (p_client_tab is null) <> (p_client_seq is null) or p_client_seq < 1 then
    raise exception 'opening_draft:invalid_payload' using errcode = 'P0001';
  end if;

  -- 1. The instance, locked against submit_phase1_atomic's status UPDATE, and still open.
  --    (The route's own status read was a separate request; this one is in the write.)
  select id, location_id, status
    into v_inst
    from public.checklist_instances
   where id = p_instance_id
   for share;
  if not found then
    raise exception 'opening_draft:instance_not_found' using errcode = 'P0001';
  end if;
  if v_inst.status <> 'open' then
    raise exception 'opening_draft:phase1_not_open' using errcode = 'P0001';
  end if;
  if p_location_id is distinct from v_inst.location_id then
    raise exception 'opening_draft:location_mismatch' using errcode = 'P0001';
  end if;

  -- 2. The upsert, with the same-tab compare-and-set. An OLDER request from the SAME tab is
  --    refused (the WHERE is false and nothing is written). Another tab, a request with no
  --    revision (a deployment from before this file) and a stored row with no revision keep
  --    last-write-wins, which stays the cross-device rule (lib/opening.ts).
  insert into public.opening_phase1_drafts as d
    (instance_id, location_id, draft, saved_by, saved_at, client_tab, client_seq)
  values
    (v_inst.id, v_inst.location_id, p_draft, p_saved_by, v_saved_at, p_client_tab, p_client_seq)
  on conflict (instance_id) do update
    set draft      = excluded.draft,
        saved_by   = excluded.saved_by,
        saved_at   = excluded.saved_at,
        client_tab = excluded.client_tab,
        client_seq = excluded.client_seq
    where excluded.client_tab is null
       or d.client_tab is distinct from excluded.client_tab
       or d.client_seq is null
       or excluded.client_seq > d.client_seq
  returning d.saved_at into v_applied;

  if v_applied is null then
    select d.saved_at into v_applied from public.opening_phase1_drafts d where d.instance_id = v_inst.id;
    return jsonb_build_object('applied', false, 'savedAt', v_applied);
  end if;
  return jsonb_build_object('applied', true, 'savedAt', v_applied);
end $$;

comment on function public.save_opening_phase1_draft(uuid, uuid, jsonb, uuid, uuid, bigint) is
  '0315: the one writer of opening_phase1_drafts. Locks the instance FOR SHARE and requires status = open in the write transaction, then upserts with a same-tab compare-and-set on (client_tab, client_seq): an older request from the same tab returns {applied:false} and writes nothing. Another tab, a NULL revision and a pre-0315 row keep last-write-wins. Named refusals: opening_draft:invalid_payload / instance_not_found / phase1_not_open / location_mismatch.';

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 2. save_phase2_item_atomic ← 0215 + the instance lock (B080 / B181) + blank BACK UP = 0 (B020)
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.save_phase2_item_atomic(
  p_opening_instance_id uuid,
  p_actor_id uuid,
  p_template_item_id uuid,
  p_opener_prepped numeric,
  p_over_par jsonb DEFAULT NULL,
  p_under_par jsonb DEFAULT NULL,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_batch jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_status text;
  v_item_label text;
  -- read from this item's prep_data->phase1 (0055:388-397 contract)
  v_phase1 jsonb;
  v_closer_count numeric;
  v_spot_check_status text;
  v_opener_recount numeric;
  v_ground_truth_count numeric;
  v_prep_need numeric;
  v_phase1_provenance text;   -- [D2] mirror onto the phase2 completion
  -- computed
  v_delta numeric;
  v_over_under_status text;
  v_over_under_reason_category text;
  v_over_under_reason_text text;
  v_directed_by uuid;
  v_prep_data_phase2 jsonb;
  v_completion_id uuid;
  v_saved_at timestamptz := now();
  v_completion_row jsonb;
  -- 0215 batch-vs-bottle locals (plan S r4; build corrections 1-5)
  v_location_id uuid;
  v_business_date date;
  v_template_id uuid;
  v_item_id uuid;
  v_batch_recipe_id uuid;
  v_output_count integer;
  v_recipe_yield numeric;
  v_is_batch boolean := false;
  v_batch_mode boolean := false;   -- Astra P1 #4: read separately; batch_mode AND NOT is_batch is REFUSED
  v_prev_toss numeric;             -- Astra P2 #6: the session's toss before this save (audit delta)
  v_b_batches integer;
  v_b_came_out numeric;
  v_b_tossed numeric;
  v_b_reason jsonb;
  v_b_reason_code text;
  v_b_reason_note text;
  v_line numeric;
  v_par_value_b numeric;
  v_backup_before numeric;
  v_need_for_line numeric;
  v_min_batches integer;
  v_available numeric;
  v_backup_after numeric;
  v_phase1_prep_need numeric;
  v_par_unit_b text;
  v_session_produced_at timestamptz;
  v_session_made_by uuid;
  v_batch_record jsonb := NULL;

BEGIN
  -- ──── Eligibility: Phase 2 active only at phase1_complete (Question C) ────
  -- 0315 (audit W14 / B080 + B181): the opening instance row is the FIRST lock of every opening
  -- Phase 2 writer (this save, revoke_phase2_item_atomic, submit_phase2_atomic), so a save can
  -- no longer supersede a row a finalize already counted, and save / revoke queue instead of
  -- deadlocking. FOR NO KEY UPDATE (the 0287 parent-lock mode): the FK key-share checks of the
  -- inserts below keep flowing. The status is re-read under the lock.
  SELECT status INTO v_status FROM checklist_instances WHERE id = p_opening_instance_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'save_phase2_item_atomic: opening instance % not found', p_opening_instance_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_status <> 'phase1_complete' THEN
    RAISE EXCEPTION 'save_phase2_item_atomic: phase2_not_eligible — instance % status is "%" (expected phase1_complete)',
      p_opening_instance_id, v_status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT label INTO v_item_label FROM checklist_template_items WHERE id = p_template_item_id;

  -- ──── Read this item's resolved Phase 1 ground truth (Model Y source) ────
  -- The phase1 completion was written by submit_phase1_atomic (0055). Live row only.
  SELECT cc.prep_data->'phase1', cc.count_provenance
  INTO v_phase1, v_phase1_provenance
  FROM checklist_completions cc
  WHERE cc.instance_id = p_opening_instance_id
    AND cc.template_item_id = p_template_item_id
    AND cc.prep_data ? 'phase1'
    AND cc.superseded_at IS NULL
    AND cc.revoked_at IS NULL
  ORDER BY cc.completed_at DESC
  LIMIT 1;

  IF v_phase1 IS NULL THEN
    RAISE EXCEPTION 'save_phase2_item_atomic: phase1_not_resolved for item % (%) — no live prep_data->phase1 completion; Phase 1 must resolve ground truth before Phase 2 prep',
      p_template_item_id, v_item_label
      USING ERRCODE = 'P0001';
  END IF;

  v_closer_count       := NULLIF(v_phase1->>'closer_count', '')::numeric;
  v_spot_check_status  := v_phase1->>'spot_check_status';
  v_opener_recount     := NULLIF(v_phase1->>'opener_recount', '')::numeric;
  v_ground_truth_count := NULLIF(v_phase1->>'ground_truth_count', '')::numeric;
  v_prep_need          := NULLIF(v_phase1->>'prep_need', '')::numeric;
  -- ──── 0215 batch-vs-bottle (plan S r4; GO corrections 1-5) ────
  -- Eligibility is derived HERE from the item and its recipe (ruling 2): a batch_mode item
  -- cannot opt out by omitting the batch object, and a non-batch item cannot opt in.
  SELECT ci.location_id, ci.date, ci.template_id
  INTO v_location_id, v_business_date, v_template_id
  FROM checklist_instances ci WHERE ci.id = p_opening_instance_id;
  SELECT c.item_id, c.recipe_id, c.output_count, c.yield, c.is_batch, c.batch_mode
  INTO v_item_id, v_batch_recipe_id, v_output_count, v_recipe_yield, v_is_batch, v_batch_mode
  FROM public.prep_batch_context(p_template_item_id) c;
  v_is_batch := COALESCE(v_is_batch, false);
  v_batch_mode := COALESCE(v_batch_mode, false);
  -- Astra P1 #4 (BC-004/042): a batch_mode recipe that is NOT eligible (two outputs, no yield)
  -- must never fall through to the single-box path by omitting p_batch. Refused BEFORE payload
  -- dispatch, whatever the payload says.
  IF v_batch_mode AND NOT v_is_batch THEN
    RAISE EXCEPTION 'save_phase2_item_atomic: batch_recipe_unresolved for item % — batch_mode needs exactly one item output with yield > 0 (recipe %, outputs %)',
      p_template_item_id, v_batch_recipe_id, v_output_count USING ERRCODE = 'P0001';
  END IF;
  IF v_is_batch AND (p_batch IS NULL OR p_batch = 'null'::jsonb) THEN
    RAISE EXCEPTION 'save_phase2_item_atomic: batch_payload_required for item % — batch_mode item saved without the batch object',
      p_template_item_id USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_is_batch AND p_batch IS NOT NULL AND p_batch <> 'null'::jsonb THEN
    RAISE EXCEPTION 'save_phase2_item_atomic: batch_payload_not_allowed for item % — not a batch_mode item',
      p_template_item_id USING ERRCODE = 'P0001';
  END IF;
  IF v_is_batch THEN
    -- Correction 4: the session is bound to the AUTHORIZED instance — location_id and
    -- business_date come from it, and the template item must belong to its template.
    PERFORM 1 FROM checklist_template_items cti
    WHERE cti.id = p_template_item_id AND cti.template_id = v_template_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'save_phase2_item_atomic: template_item_not_in_instance for item %', p_template_item_id USING ERRCODE = 'P0001';
    END IF;
    IF v_output_count IS DISTINCT FROM 1 OR v_recipe_yield IS NULL OR v_recipe_yield <= 0 THEN
      RAISE EXCEPTION 'save_phase2_item_atomic: batch_recipe_unresolved for item % — batch_mode needs exactly one item output with yield > 0',
        p_template_item_id USING ERRCODE = 'P0001';
    END IF;
    IF p_opener_prepped IS NULL THEN
      RAISE EXCEPTION 'save_phase2_item_atomic: opener_prepped_missing for item %', p_template_item_id USING ERRCODE = 'P0001';
    END IF;
    IF p_opener_prepped < 0 THEN
      RAISE EXCEPTION 'save_phase2_item_atomic: invalid_bottled for item %', p_template_item_id USING ERRCODE = 'P0001';
    END IF;
    -- NULL refusals (ruling G, the 0056:184 idiom): a missing or JSON-null batches / came_out_to /
    -- Other-note is an explicit failure, never a silent default.
    IF p_batch->'batches' IS NULL OR p_batch->'batches' = 'null'::jsonb
       OR NULLIF(btrim(p_batch->>'batches'), '') IS NULL THEN
      RAISE EXCEPTION 'save_phase2_item_atomic: batches_missing for item %', p_template_item_id USING ERRCODE = 'P0001';
    END IF;
    IF p_batch->>'batches' !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'save_phase2_item_atomic: invalid_batch_count for item % — batches must be a whole number >= 0', p_template_item_id USING ERRCODE = 'P0001';
    END IF;
    v_b_batches := (p_batch->>'batches')::integer;
    IF v_b_batches > 0 THEN
      IF p_batch->'came_out_to' IS NULL OR p_batch->'came_out_to' = 'null'::jsonb
         OR NULLIF(btrim(p_batch->>'came_out_to'), '') IS NULL THEN
        RAISE EXCEPTION 'save_phase2_item_atomic: came_out_to_missing for item % — required when batches > 0', p_template_item_id USING ERRCODE = 'P0001';
      END IF;
      IF p_batch->>'came_out_to' !~ '^[0-9]+(\.[0-9]+)?$' THEN
        RAISE EXCEPTION 'save_phase2_item_atomic: invalid_came_out_to for item %', p_template_item_id USING ERRCODE = 'P0001';
      END IF;
      v_b_came_out := (p_batch->>'came_out_to')::numeric;
    ELSE
      v_b_came_out := 0;
      IF p_batch->'came_out_to' IS NOT NULL AND p_batch->'came_out_to' <> 'null'::jsonb
         AND NULLIF(btrim(p_batch->>'came_out_to'), '') IS NOT NULL
         AND (p_batch->>'came_out_to' !~ '^[0-9]+(\.[0-9]+)?$' OR (p_batch->>'came_out_to')::numeric <> 0) THEN
        RAISE EXCEPTION 'save_phase2_item_atomic: invalid_came_out_to for item % — no batch made, nothing can have come out', p_template_item_id USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF p_batch->'tossed' IS NULL OR p_batch->'tossed' = 'null'::jsonb
       OR NULLIF(btrim(p_batch->>'tossed'), '') IS NULL THEN
      v_b_tossed := 0;
    ELSE
      IF p_batch->>'tossed' !~ '^[0-9]+(\.[0-9]+)?$' THEN
        RAISE EXCEPTION 'save_phase2_item_atomic: invalid_tossed for item %', p_template_item_id USING ERRCODE = 'P0001';
      END IF;
      v_b_tossed := (p_batch->>'tossed')::numeric;
    END IF;
    -- This session's counts (ruling A): the opener's two-box recount when present, else last
    -- night's closing count from the frozen snapshot. Never a total; never another row.
    SELECT s.line_count, s.back_up_count, s.par_unit
    INTO v_line, v_backup_before, v_par_unit_b
    FROM opening_closer_count_snapshots s
    WHERE s.opening_instance_id = p_opening_instance_id AND s.template_item_id = p_template_item_id;
    v_line := COALESCE(NULLIF(v_phase1->>'opener_recount_line', '')::numeric, v_line);
    v_backup_before := COALESCE(NULLIF(v_phase1->>'opener_recount_back_up', '')::numeric, v_backup_before);
    v_par_value_b := NULLIF(v_phase1->>'par_value', '')::numeric;
    -- 0315 (audit W14 / B020): a BACK UP the closer left blank is ZERO when the LINE is known.
    -- The AM prep form already totals a blank BACK UP as 0 (TOTAL = LINE), Phase 1 lets that
    -- section verify without a recount, and a recount always carries both boxes — so NULL here
    -- with a known LINE means "no bulk backup", never "unknown". It used to raise backup_unknown
    -- on every save, and the opening could never be finalized. A blank LINE is still unknown.
    IF v_backup_before IS NULL AND v_line IS NOT NULL THEN
      v_backup_before := 0;
    END IF;
    IF v_line IS NULL OR v_backup_before IS NULL THEN
      RAISE EXCEPTION 'save_phase2_item_atomic: backup_unknown for item % — this session has no LINE / bulk BACK UP count', p_template_item_id USING ERRCODE = 'P0001';
    END IF;
    v_need_for_line := CASE WHEN v_par_value_b IS NOT NULL THEN GREATEST(0, v_par_value_b - v_line) ELSE NULL END;
    IF v_b_tossed > v_backup_before THEN
      RAISE EXCEPTION 'save_phase2_item_atomic: tossed_exceeds_backup for item % — tossed % exceeds the counted backup %',
        p_template_item_id, v_b_tossed, v_backup_before USING ERRCODE = 'P0001';
    END IF;
    -- Ruling B: backup_after = before - tossed + came_out_to - bottled; bottled <= before - tossed + came_out_to.
    v_available := v_backup_before - v_b_tossed + v_b_came_out;
    IF p_opener_prepped > v_available THEN
      RAISE EXCEPTION 'save_phase2_item_atomic: bottled_exceeds_available for item % — bottled % exceeds available % (backup % - tossed % + came out %)',
        p_template_item_id, p_opener_prepped, v_available, v_backup_before, v_b_tossed, v_b_came_out USING ERRCODE = 'P0001';
    END IF;
    v_backup_after := v_available - p_opener_prepped;
    v_min_batches := CASE
      WHEN v_need_for_line IS NULL THEN NULL
      WHEN (v_backup_before - v_b_tossed) >= v_need_for_line THEN 0
      ELSE CEIL((v_need_for_line - (v_backup_before - v_b_tossed)) / v_recipe_yield)::integer
    END;
    -- Over-batch reason (Juan, addendum 2): ALWAYS required when batches exceed the minimum;
    -- one tap from a closed list; only 'other' needs a note. JSON-null-safe throughout.
    v_b_reason := p_batch->'over_batch_reason';
    v_b_reason_code := NULL;
    v_b_reason_note := NULL;
    IF v_b_reason IS NOT NULL AND v_b_reason <> 'null'::jsonb THEN
      v_b_reason_code := NULLIF(btrim(COALESCE(v_b_reason->>'code', '')), '');
      v_b_reason_note := NULLIF(btrim(COALESCE(v_b_reason->>'note', '')), '');
      IF v_b_reason_code IS NULL
         OR v_b_reason_code NOT IN ('catering_order', 'busy_day_expected', 'prepping_ahead', 'other') THEN
        RAISE EXCEPTION 'save_phase2_item_atomic: invalid_over_batch_reason for item %', p_template_item_id USING ERRCODE = 'P0001';
      END IF;
      IF v_b_reason_code = 'other' AND (v_b_reason->'note' IS NULL OR v_b_reason->'note' = 'null'::jsonb OR v_b_reason_note IS NULL) THEN
        RAISE EXCEPTION 'save_phase2_item_atomic: over_batch_note_required for item %', p_template_item_id USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF v_min_batches IS NOT NULL AND v_b_batches > v_min_batches AND v_b_reason_code IS NULL THEN
      RAISE EXCEPTION 'save_phase2_item_atomic: over_batch_reason_missing for item % — % batch(es) made, % needed',
        p_template_item_id, v_b_batches, v_min_batches USING ERRCODE = 'P0001';
    END IF;
    -- Session row (ruling 1; corrections 1, 3, 4): keyed by (instance_id, template_item_id).
    -- produced_at + made_by are set at the FIRST batch save and NEVER updated (not in the SET
    -- list). tossed_at / tossed_by move ONLY when the tossed qty itself changes (ELSE keeps them).
    -- Astra P2 #6: the toss BEFORE this save, under the row lock, so the caller can audit
    -- backup.tossed on every real change (set, moved, cleared) and nothing on an unchanged save.
    SELECT s.tossed_qty INTO v_prev_toss
    FROM prep_batch_sessions s
    WHERE s.instance_id = p_opening_instance_id AND s.template_item_id = p_template_item_id
    FOR UPDATE;
    INSERT INTO prep_batch_sessions (
      instance_id, template_item_id, location_id, item_id, business_date, source,
      produced_at, made_by, tossed_qty, tossed_par_unit, tossed_at, tossed_by, updated_at
    )
    VALUES (
      p_opening_instance_id, p_template_item_id, v_location_id, v_item_id, v_business_date, 'opening_p2',
      v_saved_at, p_actor_id, v_b_tossed, v_par_unit_b,
      CASE WHEN v_b_tossed > 0 THEN v_saved_at ELSE NULL END,
      CASE WHEN v_b_tossed > 0 THEN p_actor_id ELSE NULL END,
      v_saved_at
    )
    ON CONFLICT (instance_id, template_item_id) DO UPDATE SET
      tossed_qty = EXCLUDED.tossed_qty,
      tossed_par_unit = EXCLUDED.tossed_par_unit,
      tossed_at = CASE WHEN prep_batch_sessions.tossed_qty IS DISTINCT FROM EXCLUDED.tossed_qty
                       THEN v_saved_at ELSE prep_batch_sessions.tossed_at END,
      tossed_by = CASE WHEN prep_batch_sessions.tossed_qty IS DISTINCT FROM EXCLUDED.tossed_qty
                       THEN p_actor_id ELSE prep_batch_sessions.tossed_by END,
      updated_at = v_saved_at
    RETURNING prep_batch_sessions.produced_at, prep_batch_sessions.made_by
    INTO v_session_produced_at, v_session_made_by;
    v_batch_record := jsonb_build_object(
      'batches', v_b_batches,
      'came_out_to', v_b_came_out,
      'bottled', p_opener_prepped,
      'tossed', v_b_tossed,
      'backup_before', v_backup_before,
      'backup_after', v_backup_after,
      'line_count', v_line,
      'need_for_line', v_need_for_line,
      'min_batches', v_min_batches,
      'yield_at_time', v_recipe_yield,
      'recipe_id', v_batch_recipe_id,
      'item_id', v_item_id,
      'over_batch_reason', CASE WHEN v_b_reason_code IS NULL THEN NULL
                                ELSE jsonb_build_object('code', v_b_reason_code, 'note', v_b_reason_note) END,
      'produced_at', v_session_produced_at,
      'made_by', v_session_made_by,
      'session', jsonb_build_object('instance_id', p_opening_instance_id, 'template_item_id', p_template_item_id),
      'business_date', v_business_date,
      'location_id', v_location_id
    );
  END IF;

  -- Phase 2's delta / status / under-par alert measure BOTTLED against the LINE need for a
  -- batch row (plan S §2.4); the Phase 1 total-based need is kept on the batch object.
  IF v_is_batch THEN
    v_phase1_prep_need := v_prep_need;
    v_prep_need := v_need_for_line;
    v_batch_record := v_batch_record || jsonb_build_object('phase1_prep_need', v_phase1_prep_need);
  END IF;


  -- ──── opener_prepped required (universal — even on par-null items) ────
  IF p_opener_prepped IS NULL THEN
    RAISE EXCEPTION 'save_phase2_item_atomic: opener_prepped_missing for item % (%)',
      p_template_item_id, v_item_label
      USING ERRCODE = 'P0001';
  END IF;

  -- ──── Compute delta + status via the SHARED helper (single source) ────
  SELECT delta, over_under_status INTO v_delta, v_over_under_status
  FROM public.opening_phase2_compute_delta(p_opener_prepped, v_prep_need);

  -- ──── Reason gates (0053:354-369) — only when prep_need computable ────
  IF v_prep_need IS NOT NULL AND v_delta IS DISTINCT FROM 0 THEN
    IF NOT v_is_batch AND v_delta > 0 AND (p_over_par IS NULL OR p_over_par = 'null'::jsonb) THEN
      RAISE EXCEPTION 'save_phase2_item_atomic: over_par_reason_missing for item % (%) — delta=% > 0 requires overPar capture',
        p_template_item_id, v_item_label, v_delta
        USING ERRCODE = 'P0001';
    END IF;
    IF v_delta < 0 AND (p_under_par IS NULL OR p_under_par = 'null'::jsonb) THEN
      RAISE EXCEPTION 'save_phase2_item_atomic: under_par_reason_missing for item % (%) — delta=% < 0 requires underPar capture',
        p_template_item_id, v_item_label, v_delta
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- ──── Extract reason fields (0053:371-384) ────
  IF p_over_par IS NOT NULL AND p_over_par <> 'null'::jsonb THEN
    v_over_under_reason_category := p_over_par->>'reasonCategory';
    v_over_under_reason_text     := p_over_par->>'freeText';
    v_directed_by                := NULLIF(p_over_par->>'directedBy', '')::uuid;
  ELSIF p_under_par IS NOT NULL AND p_under_par <> 'null'::jsonb THEN
    v_over_under_reason_category := p_under_par->>'reasonCategory';
    v_over_under_reason_text     := p_under_par->>'freeText';
    v_directed_by                := NULL;  -- under-prep carries no directed_by
    -- under-prep freeText REQUIRED (build doc §7 / C.50 §4 — always non-empty)
    IF COALESCE(btrim(v_over_under_reason_text), '') = '' THEN
      RAISE EXCEPTION 'save_phase2_item_atomic: under_par_freetext_required for item % (%)',
        p_template_item_id, v_item_label
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    v_over_under_reason_category := NULL;
    v_over_under_reason_text     := NULL;
    v_directed_by                := NULL;
  END IF;

  -- ──── Build §8.4 prep_data->phase2 — 14 fields (12 core + 2 provenance) ────
  -- 12-core shape lifted from 0053:388-401; saved_at/saved_by are the C.52
  -- per-item provenance (spec C.53 §3, 1980-1994). Inverse-drift guard: the
  -- canonical full set is 14 — never strip saved_at/saved_by to "match 0053".
  v_prep_data_phase2 := jsonb_build_object(
    'phase', 2,
    'closer_count', v_closer_count,                      -- from prep_data->phase1
    'spot_check_status', v_spot_check_status,            -- from prep_data->phase1
    'opener_recount', v_opener_recount,                  -- from prep_data->phase1
    'ground_truth_count', v_ground_truth_count,          -- from prep_data->phase1
    'prep_need', v_prep_need,                            -- from prep_data->phase1
    'opener_prepped', p_opener_prepped,                  -- WRITTEN NOW
    'delta_vs_prep_need', v_delta,                       -- shared helper
    'over_under_status', v_over_under_status,            -- shared helper
    'over_under_reason_category', v_over_under_reason_category,
    'over_under_reason_text', v_over_under_reason_text,
    'directed_by', v_directed_by,
    'saved_at', v_saved_at,                              -- C.52 per-item provenance
    'saved_by', p_actor_id                               -- C.52 per-item provenance
  );
  -- 0215 batch-vs-bottle: the batch object rides BESIDE the 14 §8.4 fields (never replaces one).
  IF v_is_batch THEN
    v_prep_data_phase2 := v_prep_data_phase2 || jsonb_build_object('batch', v_batch_record);
  END IF;

  -- ──── Append-only write [D1]: supersede any prior live phase2 row, INSERT new ────
  UPDATE checklist_completions
  SET superseded_at = v_saved_at
  WHERE instance_id = p_opening_instance_id
    AND template_item_id = p_template_item_id
    AND prep_data ? 'phase2'
    AND superseded_at IS NULL
    AND revoked_at IS NULL;

  INSERT INTO checklist_completions (
    instance_id, template_item_id, completed_by, completed_at,
    count_value, photo_id, notes, prep_data, count_provenance
  )
  VALUES (
    p_opening_instance_id, p_template_item_id, p_actor_id, v_saved_at,
    NULL, NULL, NULL,
    jsonb_build_object('phase2', v_prep_data_phase2),
    v_phase1_provenance   -- [D2] mirror phase1 provenance (NOT hardcoded closer_captured)
  )
  RETURNING id INTO v_completion_id;

  SELECT to_jsonb(cc) INTO v_completion_row
  FROM checklist_completions cc WHERE cc.id = v_completion_id;

  -- 0215 (Astra P2 #6/#7): a BATCH row returns the session facts the caller audits/folds on —
  -- never re-derived client-side, never invented. Inserted BEFORE the 0056 RETURN so a
  -- single-box save returns exactly what it always did.
  IF v_is_batch THEN
    RETURN jsonb_build_object(
      'completion', v_completion_row,
      'templateItemId', p_template_item_id,
      'completionId', v_completion_id,
      'deltaVsPrepNeed', v_delta,
      'overUnderStatus', v_over_under_status,
      'tossPrevious', COALESCE(v_prev_toss, 0),
      'tossCurrent', v_b_tossed,
      'producedAt', to_jsonb(v_session_produced_at),
      'madeBy', to_jsonb(v_session_made_by)
    );
  END IF;

  RETURN jsonb_build_object(
    'completion', v_completion_row,
    'templateItemId', p_template_item_id,
    'completionId', v_completion_id,
    'deltaVsPrepNeed', v_delta,
    'overUnderStatus', v_over_under_status
  );
END;
$function$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 3. revoke_phase2_item_atomic ← 0215, re-ordered: instance → batch session → completion (B080 / B181)
--    Same signature, same result shape, same completion UPDATE (columns and predicates). It now
--    serves single-box rows too (no session row = the old direct UPDATE, behind the lock).
-- ═════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.revoke_phase2_item_atomic(
  p_instance_id uuid,
  p_completion_id uuid,
  p_actor_id uuid,
  p_revocation_reason text,
  p_revocation_note text
)
returns jsonb
language plpgsql security definer set search_path to 'pg_catalog', 'public' as $function$
declare
  v_now timestamptz := now();
  v_row jsonb;
  v_template_item_id uuid;
  v_toss_retracted numeric := 0;
  v_status text;
begin
  -- 0315 (audit W14 / B080 + B181). ONE lock order for every opening Phase 2 writer:
  --   opening instance (FOR NO KEY UPDATE) → prep_batch_sessions row → completion rows.
  -- (1) The instance, and its status UNDER the lock: an Undo that committed after
  --     submit_phase2_atomic counted its row left a finalized report naming a revoked
  --     completion. Past phase1_complete the Undo is refused; the lib's earlier status read
  --     stays as the friendly refusal, this one is the authority.
  select ci.status into v_status
  from checklist_instances ci
  where ci.id = p_instance_id
  for no key update;
  if not found then
    raise exception 'revoke_phase2_item_atomic: revoke_conflict — instance % not found', p_instance_id
      using errcode = 'P0001';
  end if;
  if v_status <> 'phase1_complete' then
    raise exception 'revoke_phase2_item_atomic: phase2_not_eligible — instance % status is "%" (expected phase1_complete)',
      p_instance_id, v_status using errcode = 'P0001';
  end if;
  -- (2) Which item: a plain read (no lock). A row that is gone or on another instance leaves
  --     this NULL, the session read below finds nothing, and the UPDATE raises revoke_conflict.
  select cc.template_item_id into v_template_item_id
  from checklist_completions cc
  where cc.id = p_completion_id and cc.instance_id = p_instance_id;
  -- (3) The batch session BEFORE the completion (B181): save_phase2_item_atomic locks the
  --     session and then supersedes the completion, and this function used to take them the
  --     other way round — 40P01 after deadlock_timeout. Zero rows is the single-box case.
  -- The session key, not the JSON shape (correction 1). Lock the row, read the toss, zero it.
  select s.tossed_qty into v_toss_retracted
  from prep_batch_sessions s
  where s.instance_id = p_instance_id and s.template_item_id = v_template_item_id
  for update;
  update checklist_completions cc
  set revoked_at = v_now,
      revoked_by = p_actor_id,
      revocation_reason = p_revocation_reason,
      revocation_note = p_revocation_note
  where cc.id = p_completion_id
    and cc.instance_id = p_instance_id
    and cc.revoked_at is null
    and cc.superseded_at is null
  returning to_jsonb(cc), cc.template_item_id into v_row, v_template_item_id;
  if v_row is null then
    raise exception 'revoke_phase2_item_atomic: revoke_conflict — completion % is not live on instance %',
      p_completion_id, p_instance_id using errcode = 'P0001';
  end if;
  if coalesce(v_toss_retracted, 0) > 0 then
    update prep_batch_sessions s
    set tossed_qty = 0,
        tossed_at = v_now,
        tossed_by = p_actor_id,
        updated_at = v_now
    where s.instance_id = p_instance_id and s.template_item_id = v_template_item_id;
  else
    v_toss_retracted := 0;
  end if;
  return jsonb_build_object('completion', v_row, 'tossRetracted', v_toss_retracted);
end
$function$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 4. submit_phase2_atomic ← 0255 + the instance lock before the completeness count (B080)
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.submit_phase2_atomic(p_opening_instance_id uuid, p_actor_id uuid, p_is_update boolean DEFAULT false, p_original_submission_id uuid DEFAULT NULL::uuid, p_ip_address text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_location_id uuid;
  v_location_code text;
  v_opening_date date;
  v_actor_name text;
  v_template_id uuid;
  v_submitted_at timestamptz := now();

  v_universe_item_id uuid;
  v_missing_count int := 0;

  v_completion_id uuid;
  v_completion_ids uuid[] := ARRAY[]::uuid[];
  v_submission_id uuid;
  v_opening_instance_row jsonb;

  -- per-item recompute locals
  v_phase2 jsonb;
  v_phase1 jsonb;          -- [D4] frozen Phase 1 contract — authoritative source
  v_item_label text;
  v_opener_prepped numeric;
  v_prep_need numeric;
  v_closer_count numeric;
  v_ground_truth_count numeric;
  v_over_under_reason_category text;
  v_over_under_reason_text text;
  v_delta numeric;
  v_over_under_status text;

  -- counters
  v_at_par_count int := 0;
  v_over_prep_count int := 0;
  v_under_prep_count int := 0;

  -- notifications
  v_notif_title text;
  v_notif_id uuid;
  v_notif_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  -- [D3] chain-edit deferred pending Juan ruling.
  IF p_is_update THEN
    RAISE EXCEPTION 'submit_phase2_atomic: phase2_chain_edit_not_implemented — re-finalize (C.46) deferred pending scope ruling'
      USING ERRCODE = 'P0001';
  END IF;

  -- 0315 (audit W14 / B080): the opening instance lock FIRST, before the completeness count.
  -- Finalize used to count live Phase 2 rows with no lock, so an Undo (or a save) committing
  -- after the count left a finalized report naming a revoked or superseded row. Under READ
  -- COMMITTED every statement below starts after this wait: a finalize that queued behind an
  -- Undo counts the row as missing (phase2_incomplete), and an Undo that queued behind this
  -- finalize is refused phase2_not_eligible. FOR NO KEY UPDATE = the 0287 parent-lock mode.
  PERFORM 1 FROM checklist_instances WHERE id = p_opening_instance_id FOR NO KEY UPDATE;

  -- ──── Pre-load instance + location ────
  SELECT ci.location_id, ci.date, ci.template_id, l.code
  INTO v_location_id, v_opening_date, v_template_id, v_location_code
  FROM checklist_instances ci
  JOIN locations l ON l.id = ci.location_id
  WHERE ci.id = p_opening_instance_id;
  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'submit_phase2_atomic: opening instance % not found', p_opening_instance_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT name INTO v_actor_name FROM users WHERE id = p_actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'submit_phase2_atomic: actor % not found', p_actor_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- ──── Completeness over the Model Y universe ────
  -- Universe = every ACTIVE openingPhase2 template item on this instance's template.
  -- 0197 (LRA-202): `cti.active` mirrors the screen and the per-item save; a deactivated
  -- item is template history, not an obligation, or finalize can never succeed.
  -- Each MUST have a live phase2 completion (written by save_phase2_item_atomic).
  SELECT count(*) INTO v_missing_count
  FROM checklist_template_items cti
  WHERE cti.template_id = v_template_id
    AND cti.active = TRUE
    AND cti.prep_meta->>'openingPhase2' = 'true'
    AND NOT EXISTS (
      SELECT 1 FROM checklist_completions cc
      WHERE cc.instance_id = p_opening_instance_id
        AND cc.template_item_id = cti.id
        AND cc.prep_data ? 'phase2'
        AND cc.superseded_at IS NULL
        AND cc.revoked_at IS NULL
    );
  IF v_missing_count > 0 THEN
    RAISE EXCEPTION 'submit_phase2_atomic: phase2_incomplete — % Phase 2 universe item(s) have no live completion', v_missing_count
      USING ERRCODE = 'P0001';
  END IF;

  -- ──── Per-item read-back, authoritative recompute, notification dispatch ────
  FOR v_universe_item_id, v_completion_id, v_phase2, v_item_label IN
    SELECT cti.id, cc.id, cc.prep_data->'phase2', cti.label
    FROM checklist_template_items cti
    JOIN checklist_completions cc
      ON cc.template_item_id = cti.id
     AND cc.instance_id = p_opening_instance_id
     AND cc.prep_data ? 'phase2'
     AND cc.superseded_at IS NULL
     AND cc.revoked_at IS NULL
    WHERE cti.template_id = v_template_id
      AND cti.active = TRUE
      AND cti.prep_meta->>'openingPhase2' = 'true'
  LOOP
    -- opener_prepped + reasons come from the phase2 row (only place they exist).
    v_opener_prepped             := NULLIF(v_phase2->>'opener_prepped', '')::numeric;
    v_over_under_reason_category := v_phase2->>'over_under_reason_category';
    v_over_under_reason_text     := v_phase2->>'over_under_reason_text';

    -- [D4] AUTHORITATIVE re-source: prep_need + ground_truth_count + closer_count
    -- are re-read from this item's FROZEN prep_data->phase1 contract — NOT trusted
    -- from the phase2 row (where they were mirrored at save time as UX convenience).
    -- Finalize is the authoritative compute; save-time values are advisory. They
    -- agree by design (same frozen contract, same helper), but finalize never
    -- trusts the written-onto-phase2 copy.
    SELECT cc1.prep_data->'phase1' INTO v_phase1
    FROM checklist_completions cc1
    WHERE cc1.instance_id = p_opening_instance_id
      AND cc1.template_item_id = v_universe_item_id
      AND cc1.prep_data ? 'phase1'
      AND cc1.superseded_at IS NULL
      AND cc1.revoked_at IS NULL
    ORDER BY cc1.completed_at DESC
    LIMIT 1;

    IF v_phase1 IS NULL THEN
      RAISE EXCEPTION 'submit_phase2_atomic: phase1_not_resolved for item % (%) — no live prep_data->phase1 at finalize',
        v_universe_item_id, v_item_label
        USING ERRCODE = 'P0001';
    END IF;

    -- 0215 batch-vs-bottle: a batch row's delta is measured against its LINE need (plan S §2.4).
    v_prep_need          := COALESCE(NULLIF(v_phase2->'batch'->>'need_for_line', '')::numeric, NULLIF(v_phase1->>'prep_need', '')::numeric);
    v_ground_truth_count := NULLIF(v_phase1->>'ground_truth_count', '')::numeric;
    v_closer_count       := NULLIF(v_phase1->>'closer_count', '')::numeric;

    -- Authoritative recompute via the SAME shared helper (guards against drift)
    SELECT delta, over_under_status INTO v_delta, v_over_under_status
    FROM public.opening_phase2_compute_delta(v_opener_prepped, v_prep_need);

    IF v_over_under_status = 'at_par' THEN
      v_at_par_count := v_at_par_count + 1;
    ELSIF v_over_under_status = 'over_prep' THEN
      v_over_prep_count := v_over_prep_count + 1;
    ELSE
      v_under_prep_count := v_under_prep_count + 1;
    END IF;

    v_completion_ids := array_append(v_completion_ids, v_completion_id);

    -- ──── Under-prep notification dispatch (0053:414-485 pattern) ────
    IF v_delta IS NOT NULL AND v_delta < 0 THEN
      v_notif_title := 'Under-par: ' || v_item_label || ' at ' || v_location_code;

      INSERT INTO notifications (
        type, category, priority, title, body, data,
        related_table, related_id, location_id, created_by
      )
      VALUES (
        'under_par_alert', NULL, 'urgent', v_notif_title, NULL,
        jsonb_build_object(
          'titleKey', 'notifications.under_par_alert.title',
          'titleParams', jsonb_build_object('itemName', v_item_label, 'locationCode', v_location_code),
          'bodyKey', 'notifications.under_par_alert.body',
          'bodyParams', jsonb_build_object(
            'openerName', v_actor_name, 'itemName', v_item_label,
            'prepped', v_opener_prepped, 'closer', v_closer_count,
            'reasonCategory', v_over_under_reason_category,
            'freeText', COALESCE(v_over_under_reason_text, ''),
            -- 0255: the par the opener saw (frozen Phase 1 contract); the card's "(par {par}, …)" was blank.
            'par', NULLIF(v_phase1->>'par_value', '')::numeric
          ),
          'itemName', v_item_label,
          'templateItemId', v_universe_item_id::text,
          'completionId', v_completion_id::text,
          'instanceId', p_opening_instance_id::text,
          'openingDate', v_opening_date::text,
          'closerCount', v_closer_count,
          'groundTruthCount', v_ground_truth_count,
          'prepNeed', v_prep_need,
          'openerPrepped', v_opener_prepped,
          'deltaVsPrepNeed', v_delta,
          'overUnderStatus', v_over_under_status,
          'reasonCategory', v_over_under_reason_category,
          'freeText', v_over_under_reason_text
        ),
        'checklist_completions', v_completion_id, v_location_id, p_actor_id
      )
      RETURNING id INTO v_notif_id;

      -- Recipients: KH+ at this location + MoO + Owner DISTINCT (0053:460-482 / 0055:564-575)
      -- 0255 (Juan, 2026-10-15): key holders and up only — trainer and employee dropped;
      -- prep_mgr added (prep alerts are that role's job); social_media_mgr stays off.
      INSERT INTO notification_recipients (notification_id, user_id, delivery_method, delivery_status)
      SELECT v_notif_id, recipients.user_id, 'in_app', 'pending'
      FROM (
        SELECT DISTINCT u.id AS user_id
        FROM users u
        WHERE u.active = TRUE
          AND (
            (u.role IN (
              'cgs', 'owner', 'moo', 'gm', 'agm', 'catering_mgr',
              'prep_mgr', 'shift_lead', 'key_holder'
            )
             AND EXISTS (
               SELECT 1 FROM user_locations ul
               WHERE ul.user_id = u.id AND ul.location_id = v_location_id
             ))
            OR u.role = 'moo'
            OR u.role = 'owner'
          )
      ) recipients;

      v_notif_ids := array_append(v_notif_ids, v_notif_id);
    END IF;
  END LOOP;

  -- ──── Submission row (is_final_confirmation FALSE — Phase 3 is final) ────
  INSERT INTO checklist_submissions (
    instance_id, submitted_by, submitted_at, completion_ids, is_final_confirmation
  )
  VALUES (
    p_opening_instance_id, p_actor_id, v_submitted_at, v_completion_ids, FALSE
  )
  RETURNING id INTO v_submission_id;

  -- ──── Status transition (race-safe): phase1_complete → phase2_complete ────
  -- 0066: also stamp finalize provenance (confirmed_at/confirmed_by) so the
  -- dashboard Opening tile + any consumer can show "Finalized at {time} by
  -- {name}", consistent with am-prep + mid-day. Phase 3 (if ever wired) may
  -- re-stamp on final confirmation; phase2_complete is the current terminal.
  UPDATE checklist_instances
  SET status = 'phase2_complete',
      confirmed_at = v_submitted_at,
      confirmed_by = p_actor_id
  WHERE id = p_opening_instance_id
    AND status = 'phase1_complete';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'submit_phase2_atomic: phase2_not_eligible — instance % is not in status=phase1_complete (concurrent submit OR status already past Phase 2)',
      p_opening_instance_id
      USING ERRCODE = 'P0001';
  END IF;

  -- NO opening→closing auto-complete (C.54 §2.A — Phase 3 owns it).

  -- ──── Build result jsonb (mirrors Phase1RpcResult + C.50 counters) ────
  SELECT to_jsonb(ci) INTO v_opening_instance_row
  FROM checklist_instances ci WHERE ci.id = p_opening_instance_id;

  RETURN jsonb_build_object(
    'instance', v_opening_instance_row,
    'submissionId', v_submission_id,
    'completionIds', to_jsonb(v_completion_ids),
    'autoCompleteId', NULL,                 -- Phase 2 has no auto-complete target
    'editCount', 0,
    'originalSubmissionId', NULL,
    'underParNotificationIds', to_jsonb(v_notif_ids),
    'atParCount', v_at_par_count,
    'overPrepCount', v_over_prep_count,
    'underPrepCount', v_under_prep_count
  );
END;
$function$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 5. The three generic corrections ← 0305 + item-tracking ticks refuse like report references (B182)
--    Exact 0305 bodies (0287's, with W05's ACTIVE-membership line: security invoker, lock order, clocks,
--    messages); only the reference check widens.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.checklist_revoke_completion(p_completion uuid, p_actor uuid)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  v_parent uuid; v_instance public.checklist_instances%rowtype;
  v_completion public.checklist_completions%rowtype;
  v_level integer; v_completer_level integer; v_n integer;
  v_at timestamptz; v_elapsed bigint;
begin
  -- Resolve identity only before the parent lock; every mutable field is re-read.
  select instance_id into v_parent from public.checklist_completions where id = p_completion;
  if not found then raise exception 'completion_not_found'; end if;
  select * into v_instance from public.checklist_instances where id = v_parent for no key update;
  if not found then raise exception 'instance_not_found'; end if;
  if v_instance.status is distinct from 'open' then raise exception 'instance_not_open'; end if;
  -- Reference/prep identity is immutable after insert; refuse before target lock.
  select * into v_completion from public.checklist_completions where id = p_completion;
  -- 0315 (audit W14 / B182): an item-tracking tick (ref_track_item_completion + a referenced
  -- item) is a system-written row too. Once revoked it can never be ticked again (the
  -- reconciler never re-ticks over a revoke and a manual tick is refused), which locks a
  -- hard-gated closing. It follows the item it tracks; refuse it like a report reference.
  if exists(select 1 from public.checklist_template_items
    where id = v_completion.template_item_id and (report_reference_type is not null
      or (ref_track_item_completion and references_template_item_id is not null))) then
    raise exception 'reference_row_not_correctable';
  end if;
  if v_completion.prep_data is not null then raise exception 'prep_data_not_correctable'; end if;
  select * into v_completion from public.checklist_completions
    where id = p_completion and instance_id = v_parent for no key update;
  if not found or v_completion.revoked_at is not null or v_completion.superseded_at is not null then
    raise exception 'completion_not_found';
  end if;
  perform 1 from public.users where id = p_actor and active for share;
  if not found then raise exception 'not_authorized'; end if;
  v_level := public.assignment_author_level(p_actor);
  if v_level is null then raise exception 'not_authorized'; end if;
  if v_level < 8 then
    -- 0305 (B150): an ACTIVE membership only. 0287 kept parity with the then-unfiltered current_user_locations().
    perform 1 from public.user_locations where user_id = p_actor and location_id = v_instance.location_id and active for share;
    if not found then raise exception 'not_authorized'; end if;
  end if;
  if v_completion.completed_by is distinct from p_actor then raise exception 'not_self'; end if;
  v_at := clock_timestamp(); -- after parent/target/authority lock waits
  v_elapsed := floor(extract(epoch from (v_at - v_completion.completed_at)) * 1000)::bigint;
  if v_elapsed >= 60000 then raise exception 'outside_quick_window'
    using detail = jsonb_build_object('elapsed_ms', v_elapsed)::text; end if;

  update public.checklist_completions set revoked_at = v_at, revoked_by = p_actor,
    revocation_reason = 'error_tap'
    where id = p_completion and instance_id = v_parent and revoked_at is null and superseded_at is null
    returning * into v_completion;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'concurrent_modification'; end if;
  return jsonb_build_object('completion', to_jsonb(v_completion), 'elapsed_ms', v_elapsed,
    'actor_level', v_level, 'completer_level', v_completer_level);
end $$;

create or replace function public.checklist_revoke_with_reason(p_completion uuid, p_actor uuid, p_reason text, p_note text default null)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  v_parent uuid; v_instance public.checklist_instances%rowtype;
  v_completion public.checklist_completions%rowtype;
  v_level integer; v_completer_level integer; v_n integer;
  v_at timestamptz; v_elapsed bigint; v_note text;
begin
  v_note := btrim(coalesce(p_note, ''), U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
  if p_reason is null or p_reason not in ('not_actually_done', 'other') then raise exception 'invalid_payload'; end if;
  if p_reason = 'other' and v_note = '' then raise exception 'revocation_note_required'; end if;
  -- Resolve identity only before the parent lock; every mutable field is re-read.
  select instance_id into v_parent from public.checklist_completions where id = p_completion;
  if not found then raise exception 'completion_not_found'; end if;
  select * into v_instance from public.checklist_instances where id = v_parent for no key update;
  if not found then raise exception 'instance_not_found'; end if;
  if v_instance.status is distinct from 'open' then raise exception 'instance_not_open'; end if;
  -- Reference/prep identity is immutable after insert; refuse before target lock.
  select * into v_completion from public.checklist_completions where id = p_completion;
  -- 0315 (audit W14 / B182): an item-tracking tick (ref_track_item_completion + a referenced
  -- item) is a system-written row too. Once revoked it can never be ticked again (the
  -- reconciler never re-ticks over a revoke and a manual tick is refused), which locks a
  -- hard-gated closing. It follows the item it tracks; refuse it like a report reference.
  if exists(select 1 from public.checklist_template_items
    where id = v_completion.template_item_id and (report_reference_type is not null
      or (ref_track_item_completion and references_template_item_id is not null))) then
    raise exception 'reference_row_not_correctable';
  end if;
  if v_completion.prep_data is not null then raise exception 'prep_data_not_correctable'; end if;
  select * into v_completion from public.checklist_completions
    where id = p_completion and instance_id = v_parent for no key update;
  if not found or v_completion.revoked_at is not null or v_completion.superseded_at is not null then
    raise exception 'completion_not_found';
  end if;
  perform 1 from public.users where id = p_actor and active for share;
  if not found then raise exception 'not_authorized'; end if;
  v_level := public.assignment_author_level(p_actor);
  if v_level is null then raise exception 'not_authorized'; end if;
  if v_level < 8 then
    -- 0305 (B150): an ACTIVE membership only. 0287 kept parity with the then-unfiltered current_user_locations().
    perform 1 from public.user_locations where user_id = p_actor and location_id = v_instance.location_id and active for share;
    if not found then raise exception 'not_authorized'; end if;
  end if;
  if v_completion.completed_by is distinct from p_actor then raise exception 'not_self'; end if;
  v_at := clock_timestamp(); -- after parent/target/authority lock waits
  v_elapsed := floor(extract(epoch from (v_at - v_completion.completed_at)) * 1000)::bigint;
  if v_elapsed < 60000 then raise exception 'use_quick_revoke'; end if;
  update public.checklist_completions set revoked_at = v_at, revoked_by = p_actor,
    revocation_reason = p_reason, revocation_note = case when p_reason = 'other' then v_note else null end
    where id = p_completion and instance_id = v_parent and revoked_at is null and superseded_at is null
    returning * into v_completion;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'concurrent_modification'; end if;
  return jsonb_build_object('completion', to_jsonb(v_completion), 'elapsed_ms', v_elapsed,
    'actor_level', v_level, 'completer_level', v_completer_level);
end $$;

create or replace function public.checklist_mark_not_done(p_completion uuid, p_actor uuid, p_note text)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  v_parent uuid; v_instance public.checklist_instances%rowtype;
  v_completion public.checklist_completions%rowtype;
  v_level integer; v_completer_level integer; v_n integer;
  v_at timestamptz; v_elapsed bigint; v_note text;
begin
  v_note := btrim(coalesce(p_note, ''), U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
  if v_note = '' then raise exception 'revocation_note_required'; end if;
  -- Resolve identity only before the parent lock; every mutable field is re-read.
  select instance_id into v_parent from public.checklist_completions where id = p_completion;
  if not found then raise exception 'completion_not_found'; end if;
  select * into v_instance from public.checklist_instances where id = v_parent for no key update;
  if not found then raise exception 'instance_not_found'; end if;
  if v_instance.status is distinct from 'open' then raise exception 'instance_not_open'; end if;
  -- Reference/prep identity is immutable after insert; refuse before target lock.
  select * into v_completion from public.checklist_completions where id = p_completion;
  -- 0315 (audit W14 / B182): an item-tracking tick (ref_track_item_completion + a referenced
  -- item) is a system-written row too. Once revoked it can never be ticked again (the
  -- reconciler never re-ticks over a revoke and a manual tick is refused), which locks a
  -- hard-gated closing. It follows the item it tracks; refuse it like a report reference.
  if exists(select 1 from public.checklist_template_items
    where id = v_completion.template_item_id and (report_reference_type is not null
      or (ref_track_item_completion and references_template_item_id is not null))) then
    raise exception 'reference_row_not_correctable';
  end if;
  if v_completion.prep_data is not null then raise exception 'prep_data_not_correctable'; end if;
  select * into v_completion from public.checklist_completions
    where id = p_completion and instance_id = v_parent for no key update;
  if not found or v_completion.revoked_at is not null or v_completion.superseded_at is not null then
    raise exception 'completion_not_found';
  end if;
  perform 1 from public.users where id = p_actor and active for share;
  if not found then raise exception 'not_authorized'; end if;
  v_level := public.assignment_author_level(p_actor);
  if v_level is null then raise exception 'not_authorized'; end if;
  if v_level < 8 then
    -- 0305 (B150): an ACTIVE membership only. 0287 kept parity with the then-unfiltered current_user_locations().
    perform 1 from public.user_locations where user_id = p_actor and location_id = v_instance.location_id and active for share;
    if not found then raise exception 'not_authorized'; end if;
  end if;
  if v_completion.completed_by = p_actor then raise exception 'use_self_revoke'; end if;
  if v_level < 4 then raise exception 'role_level_insufficient'
    using detail = jsonb_build_object('required', 4, 'actual', v_level)::text; end if;
  v_completer_level := public.assignment_author_level(v_completion.completed_by);
  if v_completer_level is null then raise exception 'completer_not_found'; end if;
  v_at := clock_timestamp(); -- after parent/target/authority lock waits
  v_elapsed := floor(extract(epoch from (v_at - v_completion.completed_at)) * 1000)::bigint;
  if v_elapsed < 60000 then raise exception 'use_quick_revoke'; end if;
  if v_level < v_completer_level then raise exception 'revoke_hierarchy_violation'
    using detail = jsonb_build_object('actor_level', v_level, 'completer_level', v_completer_level)::text; end if;
  update public.checklist_completions set revoked_at = v_at, revoked_by = p_actor,
    revocation_reason = 'not_actually_done', revocation_note = v_note
    where id = p_completion and instance_id = v_parent and revoked_at is null and superseded_at is null
    returning * into v_completion;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'concurrent_modification'; end if;
  return jsonb_build_object('completion', to_jsonb(v_completion), 'elapsed_ms', v_elapsed,
    'actor_level', v_level, 'completer_level', v_completer_level);
end $$;

-- ── Grants (CREATE OR REPLACE keeps ACLs; restated so the file stands alone) ─────────────────
revoke all on function public.save_opening_phase1_draft(uuid, uuid, jsonb, uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.save_opening_phase1_draft(uuid, uuid, jsonb, uuid, uuid, bigint) to service_role;
revoke execute on function public.save_phase2_item_atomic(uuid, uuid, uuid, numeric, jsonb, jsonb, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_phase2_item_atomic(uuid, uuid, uuid, numeric, jsonb, jsonb, text, text, jsonb) to service_role;
revoke execute on function public.revoke_phase2_item_atomic(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.revoke_phase2_item_atomic(uuid, uuid, uuid, text, text) to service_role;
revoke execute on function public.submit_phase2_atomic(uuid, uuid, boolean, uuid, text, text) from public, anon, authenticated;
grant execute on function public.submit_phase2_atomic(uuid, uuid, boolean, uuid, text, text) to service_role;
revoke all on function public.checklist_revoke_completion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.checklist_revoke_completion(uuid, uuid) to service_role;
revoke all on function public.checklist_revoke_with_reason(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.checklist_revoke_with_reason(uuid, uuid, text, text) to service_role;
revoke all on function public.checklist_mark_not_done(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.checklist_mark_not_done(uuid, uuid, text) to service_role;

-- ── POST-APPLY: every body is this file's, the ceilings hold, the table grew no grant ─────────
do $$
declare
  r record;
  v_live text;
  f regprocedure;
begin
  for r in
    select * from (values
      ('public.save_phase2_item_atomic(uuid,uuid,uuid,numeric,jsonb,jsonb,text,text,jsonb)', '59014f4495ba6aae4648363b62b27623', true),
      ('public.revoke_phase2_item_atomic(uuid,uuid,uuid,text,text)', '4f3322d08ee03ec27a3a777f8bdbfdd3', true),
      ('public.submit_phase2_atomic(uuid,uuid,boolean,uuid,text,text)', '13a3433b03ac9732dd33a061dba41a7f', true),
      ('public.checklist_revoke_completion(uuid,uuid)', '2f9458d820c8650cc862695f73df8f28', false),
      ('public.checklist_revoke_with_reason(uuid,uuid,text,text)', 'a49ffe598b34f314e92226646b996c34', false),
      ('public.checklist_mark_not_done(uuid,uuid,text)', 'f0cbff6f14f523c3228540b16d76081d', false),
      ('public.save_opening_phase1_draft(uuid,uuid,jsonb,uuid,uuid,bigint)', 'f01129c568967613148cd2d004f484fd', true)
    ) as t(sig, own_md5, definer)
  loop
    f := to_regprocedure(r.sig);
    if f is null then
      raise exception '0315: % is missing after apply', r.sig;
    end if;
    select md5(regexp_replace(p.prosrc, '[^\x21-\x7E]+', '', 'g')) into v_live from pg_proc p where p.oid = f;
    if v_live is distinct from r.own_md5 then
      raise exception '0315: % does not carry this file''s body after apply (md5 %)', r.sig, v_live;
    end if;
    if has_function_privilege('public', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE')
       or has_function_privilege('authenticated', f, 'EXECUTE') or not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '0315: RPC grant escaped on %', r.sig;
    end if;
    if (select p.prosecdef from pg_proc p where p.oid = f) is distinct from r.definer then
      raise exception '0315: % changed its SECURITY posture', r.sig;
    end if;
    if not coalesce((select p.proconfig from pg_proc p where p.oid = f) @> array['search_path=pg_catalog, public'], false) then
      raise exception '0315: % lost its pinned search_path', r.sig;
    end if;
  end loop;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'opening_phase1_drafts'
                and grantee in ('PUBLIC', 'anon', 'authenticated')) then
    raise exception '0315: unexpected opening_phase1_drafts table grant';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'opening_phase1_drafts'
         and column_name in ('client_tab', 'client_seq')) <> 2 then
    raise exception '0315: opening_phase1_drafts lacks client_tab / client_seq after apply';
  end if;
end $$;

commit;
