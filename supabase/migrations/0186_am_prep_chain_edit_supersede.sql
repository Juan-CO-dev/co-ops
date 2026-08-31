-- Migration 0186_am_prep_chain_edit_supersede
-- AUTHORED 2026-08-30. NOT YET APPLIED — GATE (LEAD/JUAN).
--
-- 0186: submit_am_prep_atomic supersedes the live completion head before it inserts —
-- on BOTH of its write paths — so it stops violating 0176's one-live-head index.
--
-- This is 0185's twin, and the difference between them is the whole reason this file
-- exists: 0185's branch has no caller and cannot fail today. THIS ONE IS WIRED.
--
-- ── PROVENANCE (wiring audit, checklists-cash cluster; PR #304's flag) ─────────────────
-- Migration 0176 (2026-08-11, the concurrency sim) added
--     UNIQUE (instance_id, template_item_id) WHERE superseded_at IS NULL AND revoked_at IS NULL
-- on checklist_completions, and reworked lib/checklists.ts completeItem to supersede-then-
-- insert. 0176's own deploy note names the hazard in as many words: "the OLD completeItem
-- inserts BEFORE it supersedes, so a live index would 23505 any re-completion of an item
-- that already has a live head." submit_am_prep_atomic (0043 → 0044) predates the index and
-- was never revisited. It has TWO defects, not one:
--
--   (1) THE CHAIN-EDIT PATH BARE-INSERTS, WITH NO SUPERSEDE AT ALL. The p_is_update branch
--       inserts a fresh completion per entry against a key whose predecessor is still live,
--       and neither the RPC nor lib/prep.ts flips anything first — grep submitAmPrepUpdate
--       (lib/prep.ts:2666-2938): there is no superseded_at write anywhere on that path.
--   (2) THE AUTO-COMPLETE PATH INSERTS AND *THEN* SUPERSEDES. 0044:140-184 is precisely the
--       order 0176 calls the hazard: the INSERT lands first, so the unique index rejects it
--       before the collapsing UPDATE on the following line ever runs.
--
-- ── WHY THIS ONE IS NOT LATENT — THE CALLER EXISTS AND IS ONE TAP AWAY ─────────────────
-- Unlike 0055's Phase 1 branch, the am-prep chain edit is fully wired and shipped:
--   components/prep/AmPrepForm.tsx:566-572  — `mode === "edit" && originalSubmissionId`
--                                             posts { isUpdate: true, originalSubmissionId }
--   app/api/prep/submit/route.ts            — validates and forwards both fields
--   lib/prep.ts:2433-2443                   — submitAmPrep delegates to submitAmPrepUpdate
--   lib/prep.ts:2867-2880                   — calls the RPC with p_is_update = true
-- and lib/prep.ts:2903-2920 maps only P0001, 23514 and foreign_key_violation. A 23505 falls
-- through to `throw new Error(...)` → mapPrepError's catch-all → an opaque 500 reading
-- "Submission failed". So the FIRST am-prep edit anyone performs after 2026-08-11 fails,
-- at 6 AM, with no diagnosis on the surface and the whole transaction rolled back.
--
-- ── VERIFIED AGAINST THE LIVE SYSTEM (read-only probes, 2026-08-30) ────────────────────
--   · checklist_completions_one_live_head EXISTS in prod, exactly as 0176 declares it:
--     CREATE UNIQUE INDEX ... ON public.checklist_completions USING btree
--     (instance_id, template_item_id) WHERE ((superseded_at IS NULL) AND (revoked_at IS NULL))
--   · prod's submit_am_prep_atomic prosrc is BYTE-IDENTICAL to 0044's function body — raw
--     md5 90bdf694f0e88131e78d50e99dc3ec66, 11086 chars, on BOTH sides, with no whitespace
--     or comment normalisation required. (0185 needed normalising to reach agreement; this
--     one does not.) So the body below is a faithful re-emission of what is actually
--     running. It was COPIED from that body mechanically; the only edits are the four
--     marked 0186 blocks.
--   · prod's prosrc contains exactly THREE occurrences of 'superseded_at', ALL of them in
--     the auto-complete path (the dead prior_live CTE, the SET, and the collapsing
--     subquery's live filter). The p_is_update branch contains ZERO — confirming defect (1)
--     against the running function, not just against the file.
--   · 304 checklist_completions rows carry edit_count > 0. ALL 304 belong to prep /
--     am_prep instances (joined through checklist_instances → checklist_templates), i.e.
--     every one of them was written by THIS function's update path; max edit_count 3.
--     Oldest 2026-05-05, newest 2026-05-09 — and ZERO since the index landed 2026-08-11.
--     The path is proven-used and currently untested against the index.
--   · Auto-complete path: 15 rows carry auto_complete_meta->>'reportType' = 'am_prep'
--     (2026-05-05 → 2026-06-17). None of them ever superseded a predecessor, because on
--     the two keys where a human head DID exist it had been REVOKED seconds earlier:
--       completion a21f6720 (MEP) human at 2026-05-04 18:05:56, revoked 18:05:58
--       completion 5423fade (EM)  human at 2026-05-04 17:52:26, revoked 17:52:29
--     both on the closing template item labelled "AM Prep List"
--     (report_reference_type = 'am_prep', min_role_level = 3), completed by Juan (cgs).
--   · 0 duplicate live-head groups remain in prod — the index is doing its job.
--   · Grant posture today: anon = false, authenticated = false, service_role = true.
--
-- ── IS THE AUTO-COMPLETE PATH ACTUALLY BROKEN? YES — AND IT IS THE WORSE HALF ──────────
-- The question is whether a LIVE head can exist on (closing_instance, am_prep_ref_item) at
-- the moment the auto-complete INSERT fires. It can, and prod has already produced the
-- precondition twice:
--   · The closing UI stopped offering the tap — C.42 routes report-reference items through
--     components/ReportReferenceItem.tsx (navigate, don't complete), gated at
--     closing-client.tsx:1221 on `it.reportReferenceType !== null`. That closes the UI.
--   · It does NOT close the API. POST /api/checklist/completions
--     (app/api/checklist/completions/route.ts:60-95) takes an arbitrary templateItemId and
--     never inspects report_reference_type; the item's own min_role_level is 3, so any KH+
--     can still complete it directly. The two revoked rows above are that exact write,
--     performed through the UI of the day.
--   · Independently: Path A template versioning (AGENTS.md) ships a vN+1 am-prep template
--     as a NEW template id, so a second am_prep instance can exist for the same
--     (location, date). closing_ix keys the closing instance on location + date only — it
--     never filters on the prep template — so both instances resolve the SAME closing
--     ref-item key. The first submit takes the slot; the second 23505s.
-- The blast radius is LARGER here than on the chain edit: this block sits on the ORIGINAL
-- submission path, which every single am-prep submit takes. A 23505 rolls the whole
-- transaction back, so the prep report itself is lost, not merely an edit to it.
-- It has not fired yet only because the last auto-complete row predates the index. That is
-- luck, not safety, so the fix is folded in rather than documented as safe.
--
-- ── WHAT CHANGED, EXACTLY (four blocks; everything else is byte-for-byte 0044) ─────────
--   1. DECLARE   v_closing_instance_id uuid;  v_superseded_completion_id uuid;
--   2. AUTO-COMPLETE PATH: resolve the closing instance into a variable FIRST, then flip
--      the live head, then INSERT, then back-point. Same error, same ERRCODE, same
--      auto_complete_meta, same value returned as 'autoCompleteId'.
--   3. CHAIN-EDIT PATH: flip the LIVE head before the per-entry INSERT, capturing its id.
--      The LIVE head — not v_original_completion_id, which is the CHAIN HEAD's completion
--      and is already superseded by the time a second edit runs.
--   4. CHAIN-EDIT PATH: after the INSERT, write superseded_by = the new completion id onto
--      that captured row.
-- The dead `prior_live` CTE is DELETED. It was declared at 0044:131-139 and never
-- referenced by the INSERT that followed it (an unreferenced CTE in a data-modifying
-- statement is not executed), so it reads like a flip-first that was drafted and never
-- wired. Block 2 is what it was reaching for.
--
-- ── PRESERVED, DELIBERATELY ───────────────────────────────────────────────────────────
--   · C.46 A6: no checklist_instances.status change on the update path.
--   · C.46 A4: the update path still does not touch the closing auto-complete row —
--     lib/prep.ts:2873 passes p_closing_report_ref_item_id = null on every edit, and the
--     auto-complete block stays inside IF NOT p_is_update.
--   · The 0044 audit-emission fix: ip_address + user_agent stay INSIDE metadata JSONB.
--   · 'report.update' remains a RESERVED_ACTIONS entry emitted from SQL with `destructive`
--     set literally (AGENTS.md, the closed action vocabulary) — untouched here.
--
-- ── APPLY ORDER (for whoever gates this) ──────────────────────────────────────────────
-- CREATE OR REPLACE preserves ACLs, so the grant block at the bottom re-asserts 0043's +
-- 0132's posture rather than changing it. There is no data half: no existing row needs
-- fixing (0 duplicate live-head groups in prod), because the index has been rejecting the
-- bad writes rather than admitting them. Apply via MCP, then this file IS the record.
-- NOTHING IN THIS PR APPLIES IT.

CREATE OR REPLACE FUNCTION public.submit_am_prep_atomic(
  p_prep_instance_id uuid,
  p_actor_id uuid,
  p_entries jsonb,
  p_closing_report_ref_item_id uuid,
  p_is_update boolean DEFAULT false,
  p_original_submission_id uuid DEFAULT NULL,
  p_changed_fields jsonb DEFAULT NULL,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_entry jsonb;
  v_completion_id uuid;
  v_completion_ids uuid[] := ARRAY[]::uuid[];
  v_submission_id uuid;
  v_submitted_at timestamptz := now();
  v_auto_complete_id uuid := NULL;
  v_prep_instance_row jsonb;
  v_max_edit_count int;
  v_new_edit_count int;
  v_chain_head_row checklist_submissions%ROWTYPE;
  v_original_completion_id uuid;
  -- 0186 (block 1): the closing instance the auto-complete writes into, resolved
  -- BEFORE the write so the live head on that key can be flipped first.
  v_closing_instance_id uuid;
  -- 0186 (block 1): the live completion head this write supersedes (NULL when the
  -- key has no live head — a revoked or already-superseded predecessor).
  v_superseded_completion_id uuid;
BEGIN
  IF NOT p_is_update THEN
    -- ================================================================
    -- ORIGINAL-SUBMISSION PATH (preserved verbatim from 0041/0043)
    -- ================================================================

    -- 1. Insert one checklist_completion per entry.
    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
    LOOP
      INSERT INTO checklist_completions (
        instance_id,
        template_item_id,
        completed_by,
        completed_at,
        prep_data
      )
      VALUES (
        p_prep_instance_id,
        (v_entry->>'templateItemId')::uuid,
        p_actor_id,
        v_submitted_at,
        jsonb_build_object(
          'inputs', v_entry->'inputs',
          'snapshot', v_entry->'snapshot'
        )
      )
      RETURNING id INTO v_completion_id;

      v_completion_ids := array_append(v_completion_ids, v_completion_id);
    END LOOP;

    -- 2. Insert checklist_submissions row.
    INSERT INTO checklist_submissions (
      instance_id,
      submitted_by,
      submitted_at,
      completion_ids,
      is_final_confirmation
    )
    VALUES (
      p_prep_instance_id,
      p_actor_id,
      v_submitted_at,
      v_completion_ids,
      true
    )
    RETURNING id INTO v_submission_id;

    -- 3. Pessimistic transition prep instance → confirmed.
    UPDATE checklist_instances
    SET
      status = 'confirmed',
      confirmed_at = v_submitted_at,
      confirmed_by = p_actor_id
    WHERE id = p_prep_instance_id
      AND status = 'open';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'submit_am_prep_atomic: prep instance % is not open or does not exist', p_prep_instance_id
        USING ERRCODE = 'check_violation';
    END IF;

    -- 4. Auto-complete the closing's report-reference item if one exists.
    IF p_closing_report_ref_item_id IS NOT NULL THEN
      -- ──── 0186 BLOCK 2: SUPERSEDE-THEN-INSERT (migration 0176's one-live-head index) ────
      --
      -- 0044 wrote this as INSERT-then-supersede — the exact order 0176's deploy note
      -- names as the hazard. With the index live, the INSERT is rejected with 23505
      -- before the collapsing UPDATE on the next line can run, and because this block
      -- sits on the ORIGINAL submission path the rollback loses the whole prep report,
      -- not just an edit to it.
      --
      -- Resolving the closing instance into a variable is what makes the flip possible
      -- at all: you cannot supersede a key before you know which instance it is on. The
      -- lookup below is 0044's `closing_ix` CTE unchanged, only landed into a variable.
      --
      -- Observables are preserved exactly. 0044 detected "no closing instance" by
      -- INSERT ... SELECT FROM closing_ix inserting zero rows and leaving
      -- v_auto_complete_id NULL; the explicit IS NULL check below raises the SAME
      -- message with the SAME foreign_key_violation ERRCODE, and no longer depends on
      -- RETURNING-INTO-from-zero-rows to leave a variable untouched.
      --
      -- 0044's dead `prior_live` CTE is gone: it was declared and never referenced by
      -- the INSERT that followed, so it never executed. This block is what it was for.
      SELECT ci.id
      INTO v_closing_instance_id
      FROM checklist_instances ci
      JOIN checklist_template_items cti
        ON cti.template_id = ci.template_id
      JOIN checklist_instances prep_ci
        ON prep_ci.location_id = ci.location_id
        AND prep_ci.date = ci.date
      WHERE cti.id = p_closing_report_ref_item_id
        AND prep_ci.id = p_prep_instance_id
      LIMIT 1;

      IF v_closing_instance_id IS NULL THEN
        RAISE EXCEPTION 'submit_am_prep_atomic: no closing instance found for prep instance % to auto-complete report-ref item %',
          p_prep_instance_id, p_closing_report_ref_item_id
          USING ERRCODE = 'foreign_key_violation';
      END IF;

      -- Flip the live head BEFORE the insert. At most one row can match — that is
      -- precisely what 0176's index guarantees — so a single-row RETURNING INTO is safe.
      -- No live head (the ordinary case: nobody ticked the closing's "AM Prep List"
      -- item by hand) leaves it NULL and the insert stands alone.
      --
      -- 0044's collapsing UPDATE needed `cc.id <> v_auto_complete_id` and a LIMIT 1
      -- because it ran AFTER the insert and had to exclude the row it had just written.
      -- Flipping first removes the need for both: the new row does not exist yet.
      v_superseded_completion_id := NULL;

      UPDATE checklist_completions
      SET superseded_at = v_submitted_at
      WHERE instance_id = v_closing_instance_id
        AND template_item_id = p_closing_report_ref_item_id
        AND superseded_at IS NULL
        AND revoked_at IS NULL
      RETURNING id INTO v_superseded_completion_id;

      INSERT INTO checklist_completions (
        instance_id,
        template_item_id,
        completed_by,
        completed_at,
        auto_complete_meta
      )
      VALUES (
        v_closing_instance_id,
        p_closing_report_ref_item_id,
        p_actor_id,
        v_submitted_at,
        jsonb_build_object(
          'reportType', 'am_prep',
          'reportInstanceId', p_prep_instance_id,
          'reportSubmittedAt', to_jsonb(v_submitted_at)
        )
      )
      RETURNING id INTO v_auto_complete_id;

      -- Close the chain link. superseded_by can only be written once the successor's id
      -- exists, which is why the flip is two statements rather than one — the same order
      -- lib/checklists.ts completeItem and lib/cash.ts take.
      IF v_superseded_completion_id IS NOT NULL THEN
        UPDATE checklist_completions
        SET superseded_by = v_auto_complete_id
        WHERE id = v_superseded_completion_id;
      END IF;
    END IF;

  ELSE
    -- ================================================================
    -- UPDATE PATH (C.46 A6) — chained attribution; cap-checked; locked
    -- ================================================================

    IF p_original_submission_id IS NULL THEN
      RAISE EXCEPTION 'submit_am_prep_atomic: p_original_submission_id required when p_is_update = true'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- 1. Lock the chain head.
    SELECT * INTO v_chain_head_row
    FROM checklist_submissions
    WHERE id = p_original_submission_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'submit_am_prep_atomic: chain head submission % not found', p_original_submission_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF v_chain_head_row.original_submission_id IS NOT NULL THEN
      RAISE EXCEPTION 'submit_am_prep_atomic: % is an update row, not a chain head', p_original_submission_id
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_chain_head_row.instance_id <> p_prep_instance_id THEN
      RAISE EXCEPTION 'submit_am_prep_atomic: chain head % is for instance %, not %',
        p_original_submission_id, v_chain_head_row.instance_id, p_prep_instance_id
        USING ERRCODE = 'check_violation';
    END IF;

    PERFORM 1
    FROM checklist_submissions
    WHERE original_submission_id = p_original_submission_id
    FOR UPDATE;

    -- 2. Cap check (post-lock; safe under concurrency).
    SELECT COALESCE(MAX(edit_count), 0) INTO v_max_edit_count
    FROM checklist_submissions
    WHERE id = p_original_submission_id
       OR original_submission_id = p_original_submission_id;

    IF v_max_edit_count >= 3 THEN
      RAISE EXCEPTION 'submit_am_prep_atomic: edit cap reached for chain % (current_max=%)',
        p_original_submission_id, v_max_edit_count
        USING ERRCODE = 'P0001';
    END IF;

    v_new_edit_count := v_max_edit_count + 1;

    -- 3. Insert new completions, each linked to the chain-head completion
    --    for its template_item_id.
    --
    --    C.44 alignment: every entry's template_item_id must exist in the
    --    chain head's completions. This guard prevents adding new items via
    --    edit — edits operate on the original submission's snapshot, not
    --    the live template. A future "add missing item" capability would be
    --    a separate operation, not a chain edit.
    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
    LOOP
      SELECT cc.id INTO v_original_completion_id
      FROM checklist_completions cc
      WHERE cc.id = ANY(v_chain_head_row.completion_ids)
        AND cc.template_item_id = (v_entry->>'templateItemId')::uuid
      LIMIT 1;

      IF v_original_completion_id IS NULL THEN
        RAISE EXCEPTION 'submit_am_prep_atomic: template_item_id % in update entries not found in chain head submission %',
          (v_entry->>'templateItemId')::uuid, p_original_submission_id
          USING ERRCODE = 'check_violation';
      END IF;

      -- ──── 0186 BLOCK 3: SUPERSEDE-THEN-INSERT (migration 0176's one-live-head index) ────
      --
      -- This branch bare-INSERTED a second live row for a key whose predecessor is still
      -- live, and lib/prep.ts's submitAmPrepUpdate flips nothing either — so the moment a
      -- manager taps Edit on an AM Prep report, this raises a raw 23505 that lib/prep.ts
      -- does not map (it names only P0001, 23514 and foreign_key_violation), i.e. an
      -- opaque 500 at 6 AM on every chain edit. The flip below is the same shape
      -- save_phase2_item_atomic (0056), lib/checklists.ts completeItem and lib/cash.ts
      -- already use: clear the live head's null superseded_at BEFORE the insert, then
      -- back-point it once the new id exists.
      --
      -- It supersedes THE LIVE HEAD, not v_original_completion_id. Those are the same row
      -- on the first edit and diverge on the second: the C.44 alignment read above
      -- deliberately keys on the CHAIN HEAD's completion_ids (so the chain link points at
      -- the original submission, edit after edit — that is what
      -- original_completion_id MEANS), while the row that actually holds the index slot is
      -- whichever edit is currently live. Superseding the chain head on edit 2 would be a
      -- no-op and the 23505 would come straight back. The edit cap is 3, so edits 2 and 3
      -- are reachable, not theoretical — prod already holds chains at max edit_count 3.
      --
      -- At most one row can match — that is precisely what 0176's index guarantees — so a
      -- single-row RETURNING INTO is safe here. No live head (a revoked predecessor)
      -- leaves it NULL and the insert stands alone.
      --
      -- C.46 A4/A6 are untouched by this: an UPDATE of superseded_at on
      -- checklist_completions is not a status change and not a closing-side write.
      v_superseded_completion_id := NULL;

      UPDATE checklist_completions
      SET superseded_at = v_submitted_at
      WHERE instance_id = p_prep_instance_id
        AND template_item_id = (v_entry->>'templateItemId')::uuid
        AND superseded_at IS NULL
        AND revoked_at IS NULL
      RETURNING id INTO v_superseded_completion_id;

      INSERT INTO checklist_completions (
        instance_id,
        template_item_id,
        completed_by,
        completed_at,
        prep_data,
        original_completion_id,
        edit_count
      )
      VALUES (
        p_prep_instance_id,
        (v_entry->>'templateItemId')::uuid,
        p_actor_id,
        v_submitted_at,
        jsonb_build_object(
          'inputs', v_entry->'inputs',
          'snapshot', v_entry->'snapshot'
        ),
        v_original_completion_id,
        v_new_edit_count
      )
      RETURNING id INTO v_completion_id;

      v_completion_ids := array_append(v_completion_ids, v_completion_id);

      -- 0186 BLOCK 4: close the chain link. superseded_by can only be written once the
      -- successor's id exists, which is why the flip above is two statements rather than
      -- one — the same order lib/cash.ts and completeItem take.
      IF v_superseded_completion_id IS NOT NULL THEN
        UPDATE checklist_completions
        SET superseded_by = v_completion_id
        WHERE id = v_superseded_completion_id;
      END IF;
    END LOOP;

    -- 4. Insert new submission row, linked to the chain head.
    INSERT INTO checklist_submissions (
      instance_id,
      submitted_by,
      submitted_at,
      completion_ids,
      is_final_confirmation,
      original_submission_id,
      edit_count
    )
    VALUES (
      p_prep_instance_id,
      p_actor_id,
      v_submitted_at,
      v_completion_ids,
      true,
      p_original_submission_id,
      v_new_edit_count
    )
    RETURNING id INTO v_submission_id;

    -- 5. Audit emission inside transaction (atomic with chain write per A7).
    --    FIX (migration 0044): ip_address + user_agent are NOT columns on
    --    audit_log; they live inside metadata JSONB per the JS-side audit()
    --    helper convention. Migration 0043 incorrectly placed them as
    --    top-level INSERT columns, raising sqlstate 42703.
    --
    --    audit_log column shape (canonical, verified via
    --    information_schema.columns):
    --      id, occurred_at, actor_id, actor_role, action, resource_table,
    --      resource_id, before_state, after_state, metadata, destructive
    --
    --    Future RPC migrations writing to audit_log: query
    --    information_schema.columns for the table first; mirror exact
    --    column shape; place forensic enrichment (IP/UA/etc.) inside
    --    metadata JSONB to align with lib/audit.ts conventions.
    INSERT INTO audit_log (
      actor_id,
      action,
      resource_table,
      resource_id,
      metadata,
      destructive
    )
    VALUES (
      p_actor_id,
      'report.update',
      'checklist_submissions',
      v_submission_id,
      jsonb_build_object(
        'report_type', 'am_prep',
        'report_instance_id', p_prep_instance_id,
        'original_submission_id', p_original_submission_id,
        'original_completed_by', v_chain_head_row.submitted_by,
        'original_completed_at', to_jsonb(v_chain_head_row.submitted_at),
        'updated_by', p_actor_id,
        'updated_at', to_jsonb(v_submitted_at),
        'edit_count', v_new_edit_count,
        'changed_fields', COALESCE(p_changed_fields, '[]'::jsonb),
        -- IP + UA inside metadata to match JS-side audit() helper convention.
        'ip_address', p_ip_address,
        'user_agent', p_user_agent
      ),
      true
    );

    -- 6. Per A6: do NOT change checklist_instances.status.
    -- 7. Per A4: do NOT touch closing's auto-complete row.
  END IF;

  SELECT to_jsonb(ci) INTO v_prep_instance_row
  FROM checklist_instances ci
  WHERE ci.id = p_prep_instance_id;

  RETURN jsonb_build_object(
    'instance', v_prep_instance_row,
    'submissionId', v_submission_id,
    'completionIds', to_jsonb(v_completion_ids),
    'autoCompleteId', v_auto_complete_id,
    'editCount', CASE WHEN p_is_update THEN v_new_edit_count ELSE 0 END,
    'originalSubmissionId', CASE WHEN p_is_update THEN p_original_submission_id ELSE NULL END
  );
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants — re-asserted, not changed. CREATE OR REPLACE keeps the existing ACL;
-- this block restates 0043's + 0132's posture so the file stands alone in a fresh
-- environment. Per AGENTS.md, REVOKE FROM PUBLIC is NOT enough on Supabase — the
-- per-role revokes are the ones that bite, and 0132 shipped as a CRITICAL hotfix
-- (WB3-01) precisely because this function had retained the PUBLIC grant.
-- Live posture verified 2026-08-30: anon = false, authenticated = false,
-- service_role = true. This block reproduces exactly that.
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.submit_am_prep_atomic(
  uuid, uuid, jsonb, uuid, boolean, uuid, jsonb, text, text
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.submit_am_prep_atomic(
  uuid, uuid, jsonb, uuid, boolean, uuid, jsonb, text, text
) FROM anon;

REVOKE EXECUTE ON FUNCTION public.submit_am_prep_atomic(
  uuid, uuid, jsonb, uuid, boolean, uuid, jsonb, text, text
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.submit_am_prep_atomic(
  uuid, uuid, jsonb, uuid, boolean, uuid, jsonb, text, text
) TO service_role;
