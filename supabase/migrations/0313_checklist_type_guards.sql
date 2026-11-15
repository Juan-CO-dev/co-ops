-- Migration 0313_checklist_type_guards
-- AUTHORED 2026-11-15. NOT YET APPLIED - sim first, prod on Juan's word.
-- Provenance: bug audit wave W13 ("Checklist submissions accepting the wrong checklist or
--   day"), bugs B019, B072, B073, B074. Reviewed plan: audit/plans/W13.md (migration A).
-- WHAT: every checklist writer refuses an instance of another checklist type, by name, in SQL:
--   submit_am_prep_atomic (<- 0291)        AM prep only          'wrong_checklist_type' (P0001)
--   submit_mid_day_phase1_atomic (<- 0215) mid-day prep only     'wrong_checklist_type' (P0001)
--   submit_phase1_atomic (<- 0215)         opening only          'wrong_checklist_type' (P0001)
--     + every entry's item on the instance's template            'item_not_in_template' (P0001)
--     + B074: every live spot-check item (snapshot row on an active item of this template)
--       arrives with a spot-check status, original branch only   'phase1_incomplete'    (P0001)
--   checklist_confirm_instance (<- 0288), checklist_write_completion / checklist_submit_batch
--     (<- 0276): closing only                                    'wrong_checklist_type'
-- Each body is copied mechanically from its latest definer with ADDITIONS ONLY (pinned as a
-- line-subsequence by tests/checklist-type-guards-migration.test.ts). Signatures, defaults,
-- SECURITY DEFINER/INVOKER and search_path are unchanged; grants are re-asserted below.
-- LOCK ORDER (AGENTS.md: AM instance -> closing instance -> completion rows): no new lock is
--   taken. Each guard is a plain read placed after the writer's existing parent lock (AM prep,
--   generic writers) or before any write (Phase 1, mid-day Phase 1); nothing is locked after a
--   completion row.
-- ROLLOUT: the app PR (W13) ships first or together — it already refuses every one of these
--   cases before the RPC and maps each new code by name; the real screens never trip them, so
--   the order is safe both ways. Before apply, run on prod (read-only):
--     select ci.id, ct.type, ct.prep_subtype, ci.status from checklist_instances ci
--       join checklist_templates ct on ct.id = ci.template_id
--      where (ct.type = 'closing' and ci.status in ('phase1_complete','phase2_complete'))
--         or (ct.type = 'prep' and ct.prep_subtype = 'am_prep' and ci.status in ('phase1_complete','phase2_complete','incomplete_confirmed'))
--         or (ct.type in ('opening','prep') and ci.status = 'incomplete_confirmed');
--   Any row found is history and an owner decision; this migration changes no row.
-- VERIFY AFTER APPLY:
--   select proname from pg_proc where proname in ('submit_am_prep_atomic','submit_phase1_atomic',
--     'submit_mid_day_phase1_atomic','checklist_confirm_instance','checklist_write_completion',
--     'checklist_submit_batch') and strpos(prosrc, 'wrong_checklist_type') > 0;  -- 6 rows
--   select routine_name, grantee from information_schema.routine_privileges where routine_schema = 'public'
--     and routine_name in (<same six>);  -- service_role (+ postgres) only
--   Run scripts/sql-harness-0313.mjs (offline) and scripts/sim/checklist-0313-guard-check-management.mjs (sim, CC).
-- ROLLBACK: forward-only. Re-emit the prior bodies (0291 / 0215 / 0288 / 0276) in a NEW migration;
--   never rewrite history.
begin;

do $$
declare v_def text;
begin
  if to_regprocedure('public.submit_am_prep_atomic(uuid,uuid,jsonb,uuid,boolean,uuid,jsonb,text,text,uuid,text)') is null then
    raise exception '0313: expected signature public.submit_am_prep_atomic(uuid,uuid,jsonb,uuid,boolean,uuid,jsonb,text,text,uuid,text)';
  end if;
  v_def := pg_get_functiondef('public.submit_am_prep_atomic(uuid,uuid,jsonb,uuid,boolean,uuid,jsonb,text,text,uuid,text)'::regprocedure);
  if strpos(v_def, 'prep_request_key_reused') = 0 then
    raise exception '0313: public.submit_am_prep_atomic drifted from its latest definer';
  end if;
  if strpos(v_def, 'wrong_checklist_type') > 0 then
    raise exception '0313: public.submit_am_prep_atomic already carries the type guard';
  end if;

  if to_regprocedure('public.submit_phase1_atomic(uuid,uuid,jsonb,jsonb,text,boolean,uuid,jsonb,text,text)') is null then
    raise exception '0313: expected signature public.submit_phase1_atomic(uuid,uuid,jsonb,jsonb,text,boolean,uuid,jsonb,text,text)';
  end if;
  v_def := pg_get_functiondef('public.submit_phase1_atomic(uuid,uuid,jsonb,jsonb,text,boolean,uuid,jsonb,text,text)'::regprocedure);
  if strpos(v_def, 'recount_split_required') = 0 then
    raise exception '0313: public.submit_phase1_atomic drifted from its latest definer';
  end if;
  if strpos(v_def, 'wrong_checklist_type') > 0 then
    raise exception '0313: public.submit_phase1_atomic already carries the type guard';
  end if;

  if to_regprocedure('public.submit_mid_day_phase1_atomic(uuid,uuid,jsonb)') is null then
    raise exception '0313: expected signature public.submit_mid_day_phase1_atomic(uuid,uuid,jsonb)';
  end if;
  v_def := pg_get_functiondef('public.submit_mid_day_phase1_atomic(uuid,uuid,jsonb)'::regprocedure);
  if strpos(v_def, 'mid_day_backup_required') = 0 then
    raise exception '0313: public.submit_mid_day_phase1_atomic drifted from its latest definer';
  end if;
  if strpos(v_def, 'wrong_checklist_type') > 0 then
    raise exception '0313: public.submit_mid_day_phase1_atomic already carries the type guard';
  end if;

  if to_regprocedure('public.checklist_confirm_instance(uuid,uuid,timestamptz,jsonb,uuid[])') is null then
    raise exception '0313: expected signature public.checklist_confirm_instance(uuid,uuid,timestamptz,jsonb,uuid[])';
  end if;
  v_def := pg_get_functiondef('public.checklist_confirm_instance(uuid,uuid,timestamptz,jsonb,uuid[])'::regprocedure);
  if strpos(v_def, 'if v_filtered is distinct from v_expected then') = 0 then
    raise exception '0313: public.checklist_confirm_instance drifted from its latest definer';
  end if;
  if strpos(v_def, 'wrong_checklist_type') > 0 then
    raise exception '0313: public.checklist_confirm_instance already carries the type guard';
  end if;

  if to_regprocedure('public.checklist_write_completion(uuid,uuid,uuid,numeric,uuid,text)') is null then
    raise exception '0313: expected signature public.checklist_write_completion(uuid,uuid,uuid,numeric,uuid,text)';
  end if;
  v_def := pg_get_functiondef('public.checklist_write_completion(uuid,uuid,uuid,numeric,uuid,text)'::regprocedure);
  if strpos(v_def, 'kept_completed_at') = 0 then
    raise exception '0313: public.checklist_write_completion drifted from its latest definer';
  end if;
  if strpos(v_def, 'wrong_checklist_type') > 0 then
    raise exception '0313: public.checklist_write_completion already carries the type guard';
  end if;

  if to_regprocedure('public.checklist_submit_batch(uuid,uuid,uuid[])') is null then
    raise exception '0313: expected signature public.checklist_submit_batch(uuid,uuid,uuid[])';
  end if;
  v_def := pg_get_functiondef('public.checklist_submit_batch(uuid,uuid,uuid[])'::regprocedure);
  if strpos(v_def, 'completion_wrong_author') = 0 then
    raise exception '0313: public.checklist_submit_batch drifted from its latest definer';
  end if;
  if strpos(v_def, 'wrong_checklist_type') > 0 then
    raise exception '0313: public.checklist_submit_batch already carries the type guard';
  end if;
end $$;

-- ==========================================================================================
-- 1. submit_am_prep_atomic <- 0291 (W13/B019)
-- ==========================================================================================
CREATE OR REPLACE FUNCTION public.submit_am_prep_atomic(
  p_prep_instance_id uuid,
  p_actor_id uuid,
  p_entries jsonb,
  p_closing_report_ref_item_id uuid,
  p_is_update boolean DEFAULT false,
  p_original_submission_id uuid DEFAULT NULL,
  p_changed_fields jsonb DEFAULT NULL,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_client_request_id uuid DEFAULT NULL,
  p_client_request_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_replay checklist_submissions%ROWTYPE;
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
  -- 0290: the unsuperseded head, including revocation; the shared RPC diagnoses
  -- revoked/ambiguous heads instead of treating them as an empty key.
  v_superseded_completion_id uuid;
  v_ref_result jsonb;
  v_ref_heads uuid[];
  v_ref_skip_reason text := NULL;
BEGIN
  -- 0290: lock ALL parents before either branch takes completion/chain locks.
  -- Global order: AM instance -> closing instance -> completion rows.
  PERFORM 1 FROM public.checklist_instances
    WHERE id = p_prep_instance_id FOR NO KEY UPDATE;
  -- 0313 (W13/B019): only an AM prep instance is submitted here. Runs under the parent
  -- lock, before the replay block and both branches. A missing instance keeps 0186's
  -- refusal precedence (check_violation below), so existence is tested first.
  IF EXISTS (SELECT 1 FROM public.checklist_instances WHERE id = p_prep_instance_id)
     AND NOT EXISTS (SELECT 1 FROM public.checklist_instances ci
       JOIN public.checklist_templates ct ON ct.id = ci.template_id
       WHERE ci.id = p_prep_instance_id AND ct.type = 'prep' AND ct.prep_subtype = 'am_prep') THEN
    RAISE EXCEPTION 'submit_am_prep_atomic: wrong_checklist_type — instance % is not an AM prep', p_prep_instance_id
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT p_is_update THEN

    -- 0291: actor-scoped identity, under the parent/chain lock, before state/cap.
    IF p_client_request_id IS NOT NULL THEN
      SELECT * INTO v_replay FROM public.checklist_submissions
      WHERE instance_id = p_prep_instance_id AND submitted_by = p_actor_id
        AND client_request_id = p_client_request_id;
      IF FOUND THEN
        IF v_replay.client_request_hash IS DISTINCT FROM p_client_request_hash
          OR v_replay.original_submission_id IS DISTINCT FROM
            (CASE WHEN p_is_update THEN p_original_submission_id ELSE NULL END) THEN
          RAISE EXCEPTION 'prep_request_key_reused';
        END IF;
        -- Historical reference completions remain append-only, even superseded.
        -- Materialization prevents the planner casting unrelated metadata before
        -- restricting to the indexed closing-instance/reference-item key.
        WITH replay_refs AS MATERIALIZED (
          SELECT cc.id, cc.completed_at, cc.auto_complete_meta
          FROM public.checklist_completions cc
          JOIN public.checklist_instances closing_ci ON closing_ci.id = cc.instance_id
          JOIN public.checklist_templates closing_ct
            ON closing_ct.id = closing_ci.template_id AND closing_ct.type = 'closing'
          JOIN public.checklist_template_items cti
            ON cti.template_id = closing_ci.template_id AND cti.id = cc.template_item_id
          JOIN public.checklist_instances prep_ci
            ON prep_ci.location_id = closing_ci.location_id AND prep_ci.date = closing_ci.date
          WHERE prep_ci.id = p_prep_instance_id
            AND cti.report_reference_type = 'am_prep'
            AND cc.auto_complete_meta->>'reportInstanceId' = p_prep_instance_id::text
            AND cc.auto_complete_meta->>'reportType' = 'am_prep'
            AND v_replay.original_submission_id IS NULL
        )
        SELECT cc.id INTO v_auto_complete_id FROM replay_refs cc
        WHERE (cc.auto_complete_meta->>'reportSubmittedAt')::timestamptz = v_replay.submitted_at
        ORDER BY cc.completed_at, cc.id LIMIT 1;
        SELECT to_jsonb(ci) INTO v_prep_instance_row FROM public.checklist_instances ci
          WHERE ci.id = p_prep_instance_id;
        RETURN jsonb_build_object('instance', v_prep_instance_row,
          'submissionId', v_replay.id, 'completionIds', to_jsonb(v_replay.completion_ids),
          'autoCompleteId', v_auto_complete_id, 'closingRefSkip', NULL,
          'editCount', v_replay.edit_count,
          'originalSubmissionId', v_replay.original_submission_id, 'replayed', true);
      END IF;
    END IF;
  END IF;
  -- Preserve 0186 refusal precedence before resolving the closing parent.
  IF NOT p_is_update AND NOT EXISTS (
    SELECT 1 FROM public.checklist_instances
    WHERE id = p_prep_instance_id AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'submit_am_prep_atomic: prep instance % is not open or does not exist', p_prep_instance_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT p_is_update AND p_closing_report_ref_item_id IS NOT NULL THEN
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

    PERFORM 1 FROM public.checklist_instances
      WHERE id = v_closing_instance_id FOR NO KEY UPDATE;
  END IF;
  v_submitted_at := clock_timestamp();
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
      is_final_confirmation,
      client_request_id,
      client_request_hash
    )
    VALUES (
      p_prep_instance_id,
      p_actor_id,
      v_submitted_at,
      v_completion_ids,
      true,
      p_client_request_id,
      p_client_request_hash
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
      -- Parent is held: manager revocation/ambiguity must not wedge AM submit.
      SELECT array_agg(id ORDER BY id) INTO v_ref_heads
      FROM checklist_completions
      WHERE instance_id = v_closing_instance_id
        AND template_item_id = p_closing_report_ref_item_id
        AND superseded_at IS NULL
        AND NOT coalesce(prep_data ? 'phase2', false);
      IF cardinality(v_ref_heads) > 1 THEN
        v_ref_skip_reason := 'closing_ref_multiple_heads';
      ELSIF EXISTS (SELECT 1 FROM checklist_completions
        WHERE id = v_ref_heads[1] AND revoked_at IS NOT NULL) THEN
        v_ref_skip_reason := 'closing_ref_revoked';
      ELSE
        v_superseded_completion_id := v_ref_heads[1];
        v_ref_result := public.checklist_replace_closing_ref(
          v_closing_instance_id, p_closing_report_ref_item_id, p_actor_id,
          v_superseded_completion_id,
          jsonb_build_object('reportType', 'am_prep',
            'reportInstanceId', p_prep_instance_id,
            'reportSubmittedAt', to_jsonb(v_submitted_at)));
        IF v_ref_result->>'result' = 'lost' THEN
          RAISE EXCEPTION 'closing_ref_changed';
        END IF;
        v_auto_complete_id := (v_ref_result->>'completionId')::uuid;
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


    -- 0291: actor-scoped identity, under the parent/chain lock, before state/cap.
    IF p_client_request_id IS NOT NULL THEN
      SELECT * INTO v_replay FROM public.checklist_submissions
      WHERE instance_id = p_prep_instance_id AND submitted_by = p_actor_id
        AND client_request_id = p_client_request_id;
      IF FOUND THEN
        IF v_replay.client_request_hash IS DISTINCT FROM p_client_request_hash
          OR v_replay.original_submission_id IS DISTINCT FROM
            (CASE WHEN p_is_update THEN p_original_submission_id ELSE NULL END) THEN
          RAISE EXCEPTION 'prep_request_key_reused';
        END IF;
        -- Historical reference completions remain append-only, even superseded.
        -- Materialization prevents the planner casting unrelated metadata before
        -- restricting to the indexed closing-instance/reference-item key.
        WITH replay_refs AS MATERIALIZED (
          SELECT cc.id, cc.completed_at, cc.auto_complete_meta
          FROM public.checklist_completions cc
          JOIN public.checklist_instances closing_ci ON closing_ci.id = cc.instance_id
          JOIN public.checklist_templates closing_ct
            ON closing_ct.id = closing_ci.template_id AND closing_ct.type = 'closing'
          JOIN public.checklist_template_items cti
            ON cti.template_id = closing_ci.template_id AND cti.id = cc.template_item_id
          JOIN public.checklist_instances prep_ci
            ON prep_ci.location_id = closing_ci.location_id AND prep_ci.date = closing_ci.date
          WHERE prep_ci.id = p_prep_instance_id
            AND cti.report_reference_type = 'am_prep'
            AND cc.auto_complete_meta->>'reportInstanceId' = p_prep_instance_id::text
            AND cc.auto_complete_meta->>'reportType' = 'am_prep'
            AND v_replay.original_submission_id IS NULL
        )
        SELECT cc.id INTO v_auto_complete_id FROM replay_refs cc
        WHERE (cc.auto_complete_meta->>'reportSubmittedAt')::timestamptz = v_replay.submitted_at
        ORDER BY cc.completed_at, cc.id LIMIT 1;
        SELECT to_jsonb(ci) INTO v_prep_instance_row FROM public.checklist_instances ci
          WHERE ci.id = p_prep_instance_id;
        RETURN jsonb_build_object('instance', v_prep_instance_row,
          'submissionId', v_replay.id, 'completionIds', to_jsonb(v_replay.completion_ids),
          'autoCompleteId', v_auto_complete_id, 'closingRefSkip', NULL,
          'editCount', v_replay.edit_count,
          'originalSubmissionId', v_replay.original_submission_id, 'replayed', true);
      END IF;
    END IF;

    -- Timestamp after all parent and chain locks, including any wait.
    v_submitted_at := clock_timestamp();

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
      edit_count,
      client_request_id,
      client_request_hash
    )
    VALUES (
      p_prep_instance_id,
      p_actor_id,
      v_submitted_at,
      v_completion_ids,
      true,
      p_original_submission_id,
      v_new_edit_count,
      p_client_request_id,
      p_client_request_hash
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
    'closingRefSkip', CASE WHEN v_ref_skip_reason IS NOT NULL THEN jsonb_build_object(
      'instanceId', v_closing_instance_id, 'itemId', p_closing_report_ref_item_id,
      'reason', v_ref_skip_reason) ELSE NULL END,
    'editCount', CASE WHEN p_is_update THEN v_new_edit_count ELSE 0 END,
    'originalSubmissionId', CASE WHEN p_is_update THEN p_original_submission_id ELSE NULL END
  );
END;
$function$;

-- ==========================================================================================
-- 2. submit_phase1_atomic <- 0215 (W13/B073 + B074)
-- ==========================================================================================
CREATE OR REPLACE FUNCTION public.submit_phase1_atomic(
  p_opening_instance_id uuid,
  p_actor_id uuid,
  p_entries jsonb,
  p_section_verifications jsonb DEFAULT NULL,
  p_opener_no_prior_data_reason text DEFAULT NULL,
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
  -- Pre-load context
  v_location_id uuid;
  v_opening_date date;
  v_location_code text;
  v_actor_name text;
  v_submitted_at timestamptz := now();

  -- Per-entry locals
  v_entry jsonb;
  v_phase text;
  v_template_item_id uuid;
  v_item_label text;
  v_section_key text;
  v_section_verified boolean;
  v_count_value numeric;
  v_photo_id uuid;
  v_notes text;
  v_spot_check_status text;          -- input from entry payload
  v_resolved_spot_check_status text; -- server-derived (flagged_recount | matched_via_section_verify)
  v_opener_recount numeric;
  v_closer_count numeric;
  v_par_value numeric;
  v_ground_truth numeric;
  v_prep_need numeric;
  v_count_provenance text;           -- C.54: 'closer_captured' | 'reconstructed_morning' | NULL
  v_prep_data_phase1 jsonb;

  -- Section lookup map + verified section keys
  v_section_by_item_id jsonb;
  v_verified_sections text[] := ARRAY[]::text[];
  v_section_ver jsonb;

  -- Completion + submission state
  v_completion_id uuid;
  v_completion_ids uuid[] := ARRAY[]::uuid[];
  v_submission_id uuid;
  v_opening_instance_row jsonb;

  -- C.54 NULL-source per-instance state (Pattern A)
  v_has_null_source boolean := false;
  v_null_source_count int := 0;
  v_null_source_notif_id uuid;

  -- Counters returned to the JS layer for opening.phase1_submit audit metadata
  v_stations_verified int := 0;
  v_items_recounted int := 0;
  v_provenance_markers_set int := 0;

  -- Notification dispatch
  v_notif_title text;

  -- C.46 chain-edit state
  v_chain_head_row checklist_submissions%ROWTYPE;
  v_original_completion_id uuid;
  v_original_count_provenance text;  -- §9 preservation read
  v_max_edit_count int;
  v_new_edit_count int;
  -- 0185: the live completion head this chain edit supersedes (NULL when the
  -- item has no live head — a revoked or already-superseded original).
  v_superseded_completion_id uuid;
  -- 0215 batch-vs-bottle: the two-box recount (LINE + BACK UP) on batch_mode items.
  v_recount_line numeric;
  v_recount_back_up numeric;
  v_entry_is_batch boolean;
  -- 0313 (W13/B073 + B074): the instance's opening template; spot-check items missing from Phase 1.
  v_template_id uuid;
  v_phase1_missing int;
BEGIN
  -- ──── Pre-load instance + location ────
  --
  -- The locations FK on checklist_instances guarantees the JOIN never
  -- drops a row when the instance exists — so a NULL v_location_id here
  -- unambiguously means "instance not found."
  --
  -- Note: 0053:182-193 used a single 3-way JOIN (instance + locations +
  -- users) with a single disjunctive "instance OR actor not found" raise.
  -- That collapses two distinct failure modes (bad instance vs bad actor)
  -- into one error message, misattributing the failure. Per Triad A code-
  -- gate review 2026-05-26, the instance lookup and actor lookup are
  -- separated below so each failure raises with its own precise message.
  -- Both still raise as foreign_key_violation so the JS-side translation
  -- behavior is preserved.
  SELECT ci.location_id, ci.date, l.code
  INTO v_location_id, v_opening_date, v_location_code
  FROM checklist_instances ci
  JOIN locations l ON l.id = ci.location_id
  WHERE ci.id = p_opening_instance_id;

  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'submit_phase1_atomic: opening instance % not found',
      p_opening_instance_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- 0313 (W13/B073): only an OPENING instance is submitted here (both branches). A closing
  -- or prep id was flipped to phase1_complete — a state no closing/prep writer can leave.
  SELECT ci.template_id INTO v_template_id
  FROM checklist_instances ci
  JOIN checklist_templates ct ON ct.id = ci.template_id AND ct.type = 'opening'
  WHERE ci.id = p_opening_instance_id;
  IF v_template_id IS NULL THEN
    RAISE EXCEPTION 'submit_phase1_atomic: wrong_checklist_type — instance % is not an opening',
      p_opening_instance_id
      USING ERRCODE = 'P0001';
  END IF;

  -- ──── Pre-load actor display name ────
  --
  -- Separated from the instance lookup above (Triad A fix-1 ruling) so
  -- a missing actor raises distinctly from a missing instance. Both
  -- raises still use foreign_key_violation; the JS layer's mapOpeningError
  -- translation behavior is unchanged.
  SELECT name INTO v_actor_name FROM users WHERE id = p_actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'submit_phase1_atomic: actor % not found',
      p_actor_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- ──── Pre-load section assignments for Phase 1 items in p_entries ────
  --
  -- Builds a JSONB lookup { template_item_id::text -> section_key } from
  -- checklist_template_items.prep_meta->>'section'. Single query for the
  -- whole batch (manageable for current scale of ~10-15 spot-check items).
  -- Mirrors 0053:199-206.
  SELECT jsonb_object_agg(cti.id::text, cti.prep_meta->>'section')
  INTO v_section_by_item_id
  FROM checklist_template_items cti
  WHERE cti.id IN (
    SELECT (entry->>'templateItemId')::uuid
    FROM jsonb_array_elements(p_entries) entry
    WHERE COALESCE(entry->>'phase', 'phase1') = 'phase1'
  );

  -- ──── Pre-extract verified section keys → text[] ────
  --
  -- Empty array when no sections verified (legitimate state when all
  -- items are individually recounted). Mirrors 0053:212-220.
  IF p_section_verifications IS NOT NULL AND p_section_verifications <> 'null'::jsonb THEN
    SELECT array_agg(sv->>'sectionKey')
    INTO v_verified_sections
    FROM jsonb_array_elements(p_section_verifications) sv
    WHERE (sv->>'verified')::boolean = TRUE;
  END IF;
  IF v_verified_sections IS NULL THEN
    v_verified_sections := ARRAY[]::text[];
  END IF;

  IF NOT p_is_update THEN
    -- ════════════════════════════════════════════════════════════════════
    -- ORIGINAL-SUBMISSION PATH
    -- ════════════════════════════════════════════════════════════════════

    -- 0313 (W13/B074): every LIVE spot-check item — a closer-count snapshot row whose item is
    -- still active on this template — must arrive with a spot-check status, or Phase 2 can
    -- never be saved for it (save_phase2_item_atomic: phase1_not_resolved). This is exactly
    -- the set the opening screen sends with a status. Checked BEFORE the loop: nothing is
    -- written on refusal. The chain-edit branch is unchanged.
    SELECT count(*) INTO v_phase1_missing
    FROM opening_closer_count_snapshots s
    JOIN checklist_template_items cti ON cti.id = s.template_item_id
      AND cti.template_id = v_template_id AND cti.active = TRUE
    WHERE s.opening_instance_id = p_opening_instance_id
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_entries) e
        WHERE (e->>'templateItemId')::uuid = s.template_item_id
          AND NULLIF(e->>'spotCheckStatus', '') IS NOT NULL);
    IF v_phase1_missing > 0 THEN
      RAISE EXCEPTION 'submit_phase1_atomic: phase1_incomplete — % spot-check item(s) have no Phase 1 entry',
        v_phase1_missing
        USING ERRCODE = 'P0001';
    END IF;

    -- ──── Loop entries: per-item validation, server compute, INSERT ────
    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
    LOOP
      v_phase := COALESCE(v_entry->>'phase', 'phase1');
      IF v_phase <> 'phase1' THEN
        RAISE EXCEPTION 'submit_phase1_atomic: unexpected phase "%" in entry % (expected phase1)',
          v_phase, v_entry->>'templateItemId'
          USING ERRCODE = 'check_violation';
      END IF;

      v_template_item_id := (v_entry->>'templateItemId')::uuid;
      -- 0313 (W13/B073): an entry's item must be on this instance's template (membership only;
      -- an item deactivated between page load and submit is still accepted, as before).
      IF NOT EXISTS (SELECT 1 FROM checklist_template_items
                     WHERE id = v_template_item_id AND template_id = v_template_id) THEN
        RAISE EXCEPTION 'submit_phase1_atomic: item_not_in_template for item %', v_template_item_id
          USING ERRCODE = 'P0001';
      END IF;

      SELECT label INTO v_item_label
      FROM checklist_template_items
      WHERE id = v_template_item_id;

      -- Extract top-level fields (countValue/photoId/notes apply to ALL
      -- Phase 1 items — fridge temps, cleanliness notes, etc.)
      v_count_value := NULLIF(v_entry->>'countValue', '')::numeric;
      v_photo_id := NULLIF(v_entry->>'photoId', '')::uuid;
      v_notes := NULLIF(v_entry->>'notes', '');

      -- Discriminator: spotCheckStatus IS NULL on non-spot-check Phase 1
      -- items (cleanliness, station-ready ticks). Spot-check items always
      -- carry a non-null spotCheckStatus per OpeningEntryPhase1's contract
      -- (lib/types.ts:797 — "NULL on non-spot-check items").
      v_spot_check_status := NULLIF(v_entry->>'spotCheckStatus', '');
      v_opener_recount := CASE
        WHEN v_entry->>'openerRecount' IS NULL THEN NULL
        ELSE NULLIF(v_entry->>'openerRecount', '')::numeric
      END;
      -- 0215 batch-vs-bottle (ruling F): a batch_mode item's recount is TWO boxes — LINE
      -- (ready) and BACK UP (the bulk container). The server derives the total, so Phase 1's
      -- ground_truth / prep_need keep their count-total semantics. A total-only recount on a
      -- batch item is REFUSED (never coalesced to the closer LINE); a non-batch item ignores
      -- the two boxes entirely. Identical in the original and the chain-edit branch.
      v_recount_line := CASE
        WHEN v_entry->'openerRecountLine' IS NULL OR v_entry->'openerRecountLine' = 'null'::jsonb THEN NULL
        ELSE NULLIF(v_entry->>'openerRecountLine', '')::numeric
      END;
      v_recount_back_up := CASE
        WHEN v_entry->'openerRecountBackUp' IS NULL OR v_entry->'openerRecountBackUp' = 'null'::jsonb THEN NULL
        ELSE NULLIF(v_entry->>'openerRecountBackUp', '')::numeric
      END;
      SELECT c.is_batch INTO v_entry_is_batch FROM public.prep_batch_context(v_template_item_id) c;
      IF COALESCE(v_entry_is_batch, false) THEN
        IF (v_recount_line IS NULL) <> (v_recount_back_up IS NULL) THEN
          RAISE EXCEPTION 'submit_phase1_atomic: recount_split_incomplete for item % (%) — a batch item recount needs BOTH line and bulk backup',
            v_template_item_id, v_item_label
            USING ERRCODE = 'P0001';
        END IF;
        IF v_recount_line IS NOT NULL THEN
          IF v_recount_line < 0 OR v_recount_back_up < 0 THEN
            RAISE EXCEPTION 'submit_phase1_atomic: recount_split_negative for item % (%)',
              v_template_item_id, v_item_label
              USING ERRCODE = 'P0001';
          END IF;
          v_opener_recount := v_recount_line + v_recount_back_up;
        ELSIF v_opener_recount IS NOT NULL THEN
          RAISE EXCEPTION 'submit_phase1_atomic: recount_split_required for item % (%) — a batch item recount must be entered as line + bulk backup',
            v_template_item_id, v_item_label
            USING ERRCODE = 'P0001';
        END IF;
      ELSE
        v_recount_line := NULL;
        v_recount_back_up := NULL;
      END IF;

      IF v_spot_check_status IS NOT NULL THEN
        -- ════ SPOT-CHECK ITEM ════
        v_section_key := v_section_by_item_id->>(v_template_item_id::text);
        v_section_verified := v_section_key IS NOT NULL
          AND v_section_key = ANY(v_verified_sections);

        -- Read closer-count snapshot (materialized at instance create per
        -- migration 0052). closer_count IS NULLABLE — that nullability IS
        -- the C.54 NULL-source signal.
        SELECT closer_count, par_value
        INTO v_closer_count, v_par_value
        FROM opening_closer_count_snapshots
        WHERE opening_instance_id = p_opening_instance_id
          AND template_item_id = v_template_item_id;

        -- ──── Responsibility 1: verification gate (resolution rule) ────
        --
        -- Resolution rule per brief:
        --   non-NULL closer_count → section-verify OR recount (either valid)
        --   NULL closer_count     → recount ONLY (section-verify NOT a valid
        --                            path; you cannot verify-as-correct a
        --                            count that doesn't exist)
        --
        -- The NULL-closer-section-verified-without-recount case is the
        -- typed-error site that maps to OpeningNullSourceRequiresRecountError
        -- via mapOpeningError (Aggie's A2 lane; lib/opening.ts:208 + 79).
        IF v_closer_count IS NULL
           AND v_opener_recount IS NULL
           AND v_section_verified THEN
          RAISE EXCEPTION 'submit_phase1_atomic: null_source_requires_recount for item % (%) — closer_count IS NULL and item was section-verified; a per-item recount is required (section-verify is not a valid resolution for NULL-source items)',
            v_template_item_id, v_item_label
            USING ERRCODE = 'P0001';
        END IF;

        -- General unresolved gate covers both NULL-closer-no-recount-no-verify
        -- AND non-NULL-closer-no-recount-no-verify cases. The discriminating
        -- raise above fires first when applicable; this is the catch-all.
        IF v_opener_recount IS NULL AND NOT v_section_verified THEN
          RAISE EXCEPTION 'submit_phase1_atomic: ground_truth_unresolved for item % (%) — section not verified AND opener_recount IS NULL',
            v_template_item_id, v_item_label
            USING ERRCODE = 'P0001';
        END IF;

        -- ──── Responsibility 4: server compute (ground_truth + prep_need) ────
        --
        -- ground_truth = openerRecount IF NOT NULL ELSE closer_count (which
        -- is NOT NULL here because the gate above eliminated the
        -- NULL/NULL case). Server is authoritative — client's groundTruthCount
        -- is a UX hint only.
        v_ground_truth := COALESCE(v_opener_recount, v_closer_count);
        IF v_ground_truth IS NULL THEN
          RAISE EXCEPTION 'submit_phase1_atomic: ground_truth_unresolved for item % (%) — closer_count NULL AND opener_recount NULL despite gate-pass (defensive)',
            v_template_item_id, v_item_label
            USING ERRCODE = 'P0001';
        END IF;

        -- prep_need = MAX(0, par - ground_truth). NULL when par is NULL
        -- (par-null items have no prep_need semantic).
        v_prep_need := CASE
          WHEN v_par_value IS NOT NULL
            THEN GREATEST(0, v_par_value - v_ground_truth)
          ELSE NULL
        END;

        -- ──── Responsibility 5: C.54 NULL-source detection (per-item) ────
        --
        -- count_provenance = 'reconstructed_morning' when the source closer
        -- count was absent and the morning recount is the new source of
        -- truth; else 'closer_captured'. Pattern A: set v_has_null_source on
        -- ANY reconstructed_morning entry; dispatch ONE notification post-loop.
        IF v_opener_recount IS NOT NULL AND v_closer_count IS NULL THEN
          v_count_provenance := 'reconstructed_morning';
          v_has_null_source := true;
          v_null_source_count := v_null_source_count + 1;
        ELSE
          v_count_provenance := 'closer_captured';
        END IF;
        v_provenance_markers_set := v_provenance_markers_set + 1;

        -- Spot-check status discriminator (OpeningSpotCheckStatus enum):
        --   'flagged_recount'              → opener provided a recount
        --   'matched_via_section_verify'   → opener tapped section verify only
        v_resolved_spot_check_status := CASE
          WHEN v_opener_recount IS NOT NULL THEN 'flagged_recount'
          ELSE 'matched_via_section_verify'
        END;

        IF v_opener_recount IS NOT NULL THEN
          v_items_recounted := v_items_recounted + 1;
        END IF;

        -- Build prep_data->phase1 — invariant shape for Phase 2's downstream
        -- read. All 8 fields persist regardless of section-verify vs recount
        -- path (consistent with C.50 §8.4 invariant pattern for Phase 2).
        --
        -- ⚠ PHASE 2 CONTRACT DEPENDENCY (Triad A code-gate item 3, 2026-05-26):
        -- The Phase 2 RPC (submit_phase2_atomic, downstream commit) will
        -- READ this JSONB to source the persisted ground_truth_count + prep_need
        -- when computing delta_vs_prep_need. The exact key names below are
        -- the binding contract for Phase 2's reader:
        --   • prep_data->'phase1'->>'phase'              (always 1)
        --   • prep_data->'phase1'->>'closer_count'       (numeric or null)
        --   • prep_data->'phase1'->>'opener_recount'     (numeric or null)
        --   • prep_data->'phase1'->>'section_verified'   (boolean)
        --   • prep_data->'phase1'->>'ground_truth_count' (numeric, NOT NULL on spot-check items)
        --   • prep_data->'phase1'->>'prep_need'          (numeric or null when par_value is null)
        --   • prep_data->'phase1'->>'par_value'          (numeric or null)
        --   • prep_data->'phase1'->>'spot_check_status'  ('flagged_recount' | 'matched_via_section_verify')
        -- When Phase 2's RPC ships, the reader MUST be checked against these
        -- exact keys; any rename here is a Phase 2 break and requires the
        -- coupled-commit discipline (AGENTS.md "wire-shape coupling at
        -- architectural level, not conversational level").
        v_prep_data_phase1 := jsonb_build_object(
          'phase', 1,
          'closer_count', v_closer_count,
          'opener_recount', v_opener_recount,
          'section_verified', v_section_verified,
          'ground_truth_count', v_ground_truth,
          'prep_need', v_prep_need,
          'par_value', v_par_value,
          'spot_check_status', v_resolved_spot_check_status
        );
        -- 0215 batch-vs-bottle: the split rides BESIDE the 8-key contract (never replaces a key).
        IF COALESCE(v_entry_is_batch, false) THEN
          v_prep_data_phase1 := v_prep_data_phase1 || jsonb_build_object(
            'opener_recount_line', v_recount_line,
            'opener_recount_back_up', v_recount_back_up
          );
        END IF;

      ELSE
        -- ════ NON-SPOT-CHECK ITEM (cleanliness, station-ready, fridge temp) ════
        --
        -- No snapshot read, no ground-truth derivation, no provenance
        -- marker (count_provenance stays NULL — the C.54 marker only applies
        -- to items whose count was either closer-captured or morning-
        -- reconstructed; a cleanliness tick has no count semantic at all).
        v_count_provenance := NULL;
        v_prep_data_phase1 := NULL;
      END IF;

      -- INSERT the completion. count_provenance is set per the discriminator
      -- above; prep_data carries the Phase 1 metadata blob (or NULL for
      -- non-spot-check items where there's nothing to record beyond
      -- count_value/photo_id/notes).
      INSERT INTO checklist_completions (
        instance_id, template_item_id, completed_by, completed_at,
        count_value, photo_id, notes, prep_data, count_provenance
      )
      VALUES (
        p_opening_instance_id,
        v_template_item_id,
        p_actor_id,
        v_submitted_at,
        v_count_value,
        v_photo_id,
        v_notes,
        CASE
          WHEN v_prep_data_phase1 IS NOT NULL
            THEN jsonb_build_object('phase1', v_prep_data_phase1)
          ELSE NULL
        END,
        v_count_provenance
      )
      RETURNING id INTO v_completion_id;

      v_completion_ids := array_append(v_completion_ids, v_completion_id);
    END LOOP;

    -- ──── Responsibility 6: C.54 attestation gate (per-instance) ────
    --
    -- When ANY entry above set v_has_null_source, the opener MUST have
    -- supplied the no-prior-data attestation. Raises P0001 'provenance_
    -- required' which the JS layer maps to OpeningProvenanceRequiredError
    -- (lib/opening.ts:182).
    --
    -- The CHECK constraint on opener_no_prior_data_reason (migration 0054)
    -- enforces the enum values at write time, but we surface a friendlier
    -- error here so bad values raise as P0001 instead of as a 23514 check
    -- violation with a noisy constraint name.
    IF v_has_null_source THEN
      IF p_opener_no_prior_data_reason IS NULL THEN
        RAISE EXCEPTION 'submit_phase1_atomic: provenance_required for instance % — at least one item resolved via reconstructed_morning provenance; opener_no_prior_data_reason is required',
          p_opening_instance_id
          USING ERRCODE = 'P0001';
      END IF;
      IF p_opener_no_prior_data_reason NOT IN ('planned_closure', 'missed_or_unknown') THEN
        RAISE EXCEPTION 'submit_phase1_atomic: provenance_required for instance % — invalid p_opener_no_prior_data_reason "%": expected one of (planned_closure, missed_or_unknown)',
          p_opening_instance_id, p_opener_no_prior_data_reason
          USING ERRCODE = 'P0001';
      END IF;

      UPDATE checklist_instances
      SET opener_no_prior_data_reason = p_opener_no_prior_data_reason
      WHERE id = p_opening_instance_id;
    END IF;

    -- ──── Responsibility 7: C.54 notification dispatch (per-instance, single) ────
    --
    -- Pattern A: v_has_null_source was set in the entries loop above; we
    -- dispatch ONE notification here (NOT N-per-item). Recipients mirror
    -- 0053:462-482 verbatim per the brief — the IN-list is correct because
    -- current_user_role_level() reads the caller's role, useless for
    -- resolving target users' roles.
    --
    -- Notification type 'opening_no_prior_data_alert' is a new value in the
    -- lib/notifications.ts NOTIFICATION_TYPES vocabulary; Aggie's lib lane
    -- adds the const value (DB-side column is open text per the
    -- "type vocabulary at lib layer not DB layer" lock).
    --
    -- i18n keys 'notifications.opening_no_prior_data.title' + '.body' are
    -- placeholders; Aggie's S2 swarm lane populates EN + ES translations
    -- (gated as merge requirement before route handler goes live).
    IF v_has_null_source THEN
      v_notif_title := 'No prior closing data — opening at ' || v_location_code;

      INSERT INTO notifications (
        type, category, priority, title, body, data,
        related_table, related_id, location_id, created_by
      )
      VALUES (
        'opening_no_prior_data_alert',
        NULL,
        'urgent',
        v_notif_title,
        NULL,
        jsonb_build_object(
          'action', 'opening.submitted_with_no_prior_closing_data',
          'titleKey', 'notifications.opening_no_prior_data.title',
          'titleParams', jsonb_build_object(
            'locationCode', v_location_code,
            'openingDate', v_opening_date::text
          ),
          'bodyKey', 'notifications.opening_no_prior_data.body',
          'bodyParams', jsonb_build_object(
            'openerName', v_actor_name,
            'locationCode', v_location_code,
            'openingDate', v_opening_date::text,
            'nullSourceCount', v_null_source_count,
            'attestationReason', p_opener_no_prior_data_reason
          ),
          'instanceId', p_opening_instance_id::text,
          'openingDate', v_opening_date::text,
          'nullSourceCount', v_null_source_count,
          'attestationReason', p_opener_no_prior_data_reason
        ),
        'checklist_instances',
        p_opening_instance_id,
        v_location_id,
        p_actor_id
      )
      RETURNING id INTO v_null_source_notif_id;

      -- ──── Recipients: MoO + Owner + KH+ at location, DISTINCT ────
      --
      -- Mechanism: literal IN-list of KH+ role codes, paired with a
      -- location-membership EXISTS for location-scoped roles, OR'd with
      -- unconditional inclusion of moo + owner (per CO's role registry,
      -- moo + owner sit above location scope).
      --
      -- Verbatim diff against 0053:467-481 — this is the same mechanism
      -- (role-name IN-list, NOT a level comparison). Diffed literally by
      -- Triad A code-gate review 2026-05-26; semantics + names match.
      --
      -- The IN-list values map to KH+ (level ≥ 3) per lib/roles.ts:37-48:
      --   cgs(8), owner(7), moo(6.5), gm(6), agm(5), catering_mgr(5),
      --   shift_lead(4), key_holder(3), trainer(3), employee(3).
      -- The DB CHECK constraint on users.role lists eleven values; the
      -- omitted role is 'trainee' (level 2 per lib/roles.ts:48), correctly
      -- excluded as the only sub-KH+ role.
      --
      -- ⚠ COUPLING HAZARD (AGENTS.md sibling lesson, "Role-level gate
      -- audits must include UI-side gates"): adding a future role at
      -- level >= 3 to lib/roles.ts + the users.role CHECK constraint
      -- requires updating THIS IN-list AND 0053:467-481 AND any other
      -- recipient-resolution site driven by names. A grep-sweep for
      -- u.role IN (... is the discipline. Forward improvement: define a
      -- SQL-side role_level_of(role text) RETURNS int helper so recipient
      -- resolution can drive from levels instead of enumerated names —
      -- tracked as out-of-scope for B2 / this migration; raise as its
      -- own architectural change.
      --
      -- The "current_user_role_level() reads the actor, useless for
      -- target resolution" clause in the B2 brief is why the IN-list
      -- mechanism is correct here vs the helper: the helper resolves
      -- the caller's role from JWT claims, not arbitrary target rows.
      INSERT INTO notification_recipients (
        notification_id, user_id, delivery_method, delivery_status
      )
      SELECT v_null_source_notif_id, recipients.user_id, 'in_app', 'pending'
      FROM (
        SELECT DISTINCT u.id AS user_id
        FROM users u
        WHERE u.active = TRUE
          AND (
            (u.role IN (
              'cgs', 'owner', 'moo', 'gm', 'agm', 'catering_mgr',
              'shift_lead', 'key_holder', 'trainer', 'employee'
            )
             AND EXISTS (
               SELECT 1 FROM user_locations ul
               WHERE ul.user_id = u.id AND ul.location_id = v_location_id
             ))
            OR u.role = 'moo'
            OR u.role = 'owner'
          )
      ) recipients;
    END IF;

    -- ──── Responsibility 2: section verifications INSERT ────
    --
    -- Append-only — no UNIQUE constraint on (instance, sectionKey); multi-
    -- toggle in client state collapses to final value at submit. One row
    -- per verified=true entry. Mirrors 0053:499-515.
    IF p_section_verifications IS NOT NULL AND p_section_verifications <> 'null'::jsonb THEN
      FOR v_section_ver IN SELECT * FROM jsonb_array_elements(p_section_verifications)
      LOOP
        IF (v_section_ver->>'verified')::boolean = TRUE THEN
          INSERT INTO opening_section_verifications (
            opening_instance_id, section_key, verified_at, verified_by
          )
          VALUES (
            p_opening_instance_id,
            v_section_ver->>'sectionKey',
            v_submitted_at,
            p_actor_id
          );
          v_stations_verified := v_stations_verified + 1;
        END IF;
      END LOOP;
    END IF;

    -- ──── Submission row ────
    --
    -- is_final_confirmation = FALSE per Triad A: Phase 1 is not the final
    -- confirmation (Phase 3 is, with the closing auto-complete + the
    -- 'confirmed' status transition).
    INSERT INTO checklist_submissions (
      instance_id, submitted_by, submitted_at, completion_ids, is_final_confirmation
    )
    VALUES (
      p_opening_instance_id, p_actor_id, v_submitted_at, v_completion_ids, FALSE
    )
    RETURNING id INTO v_submission_id;

    -- ──── Responsibility 9: status transition (race-safe) ────
    --
    -- Single UPDATE with status='open' filter. NOT FOUND means another
    -- submitter beat us OR the instance is already past Phase 1. Translates
    -- to P0001 'phase1_not_eligible' which the JS layer maps to
    -- OpeningPhase1NotEligibleError (lib/opening.ts:279).
    --
    -- confirmed_at / confirmed_by / finalized_at_actor_type stay NULL —
    -- Phase 3 sets them at the 'confirmed' transition.
    UPDATE checklist_instances
    SET status = 'phase1_complete'
    WHERE id = p_opening_instance_id
      AND status = 'open';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'submit_phase1_atomic: phase1_not_eligible — instance % is not in status=open (concurrent submit OR status already past Phase 1)',
        p_opening_instance_id
        USING ERRCODE = 'P0001';
    END IF;

    -- NO opening→closing auto-complete (per Triad A ruling, C.54 §2.A). Phase 3
    -- owns that responsibility when the instance transitions to 'confirmed'.

  ELSE
    -- ════════════════════════════════════════════════════════════════════
    -- C.46 CHAIN-EDIT PATH — §9 NAMED VERIFICATION GATE
    -- ════════════════════════════════════════════════════════════════════
    --
    -- The C.46 chain-edit path is the historically highest-risk region in
    -- this function: the C.54 §9 production bug (Juan's NULL-SENTINEL smoke
    -- at EM 2026-05-25, instance d49d1504-...) lived in 0053's auto-complete
    -- branch carrying a "preserved from 0050" comment that was true at the
    -- literal level but architecturally wrong after C.50 changed the
    -- operational assumption ("absence of prior data" became a valid state).
    --
    -- This block IS the brief's named verification gate. The three
    -- preservation properties are demonstrated by the actual SQL structure
    -- below, NOT asserted in comments.
    --
    -- (a) Original completion's count_provenance is PRESERVED on chain edit
    --     — never rewritten from current snapshot/recount state.
    --     → Verified at the INSERT below: the new completion's
    --       count_provenance is set to v_original_count_provenance, which is
    --       READ FROM the original completion row (SELECT below). The
    --       chain-edit branch NEVER recomputes provenance from current
    --       (closer_count, opener_recount) state.
    --
    -- (b) The missing-closing notification (opening_no_prior_data_alert) is
    --     NOT re-emitted on chain edit.
    --     → Verified by structural absence: this branch contains NO
    --       INSERT INTO notifications statement. The original-path dispatch
    --       block above is gated under IF NOT p_is_update (the outer
    --       IF/ELSE here), so chain edits cannot reach it.
    --
    -- (c) The missing-closing notification is NOT retracted on chain edit.
    --     → Verified by structural absence: NO UPDATE notifications, NO
    --       UPDATE notification_recipients, NO DELETE FROM notifications, NO
    --       DELETE FROM notification_recipients statement exists ANYWHERE
    --       in this function. The original notification stands across all
    --       chain edits.
    --
    -- (d) Verification is against Phase 1's specific provenance model — NOT
    --     inherited assumption from 0053's structure.
    --     → Phase 1 stores count_provenance in the dedicated column added by
    --       migration 0054 (checklist_completions.count_provenance). The
    --       preservation read below pulls from THAT exact column, not from
    --       prep_data.phase1 metadata or from any 0053 location. Phase 1's
    --       per-instance attestation (checklist_instances.opener_no_prior
    --       _data_reason) is likewise untouched on chain edit — there is no
    --       UPDATE to that column in this branch.

    IF p_original_submission_id IS NULL THEN
      RAISE EXCEPTION 'submit_phase1_atomic: p_original_submission_id required when p_is_update = true'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- Lock chain head + concurrent chain rows (mirrors 0053 chain pattern).
    SELECT * INTO v_chain_head_row
    FROM checklist_submissions
    WHERE id = p_original_submission_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'submit_phase1_atomic: chain head submission % not found', p_original_submission_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF v_chain_head_row.original_submission_id IS NOT NULL THEN
      RAISE EXCEPTION 'submit_phase1_atomic: % is an update row, not a chain head', p_original_submission_id
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_chain_head_row.instance_id <> p_opening_instance_id THEN
      RAISE EXCEPTION 'submit_phase1_atomic: chain head % is for instance %, not %',
        p_original_submission_id, v_chain_head_row.instance_id, p_opening_instance_id
        USING ERRCODE = 'check_violation';
    END IF;

    PERFORM 1
    FROM checklist_submissions
    WHERE original_submission_id = p_original_submission_id
    FOR UPDATE;

    SELECT COALESCE(MAX(edit_count), 0) INTO v_max_edit_count
    FROM checklist_submissions
    WHERE id = p_original_submission_id
       OR original_submission_id = p_original_submission_id;

    IF v_max_edit_count >= 3 THEN
      RAISE EXCEPTION 'submit_phase1_atomic: edit cap reached for chain % (current_max=%)',
        p_original_submission_id, v_max_edit_count
        USING ERRCODE = 'P0001';
    END IF;

    v_new_edit_count := v_max_edit_count + 1;

    -- ──── Chain-edit entries loop ────
    --
    -- For each entry: lookup original completion in chain head, READ original
    -- count_provenance (§9 preservation point a), re-apply per-item compute
    -- against CURRENT snapshot/recount state (so the new completion's
    -- prep_data is current/valid), but INSERT the new row with the
    -- ORIGINAL provenance value.
    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
    LOOP
      v_phase := COALESCE(v_entry->>'phase', 'phase1');
      IF v_phase <> 'phase1' THEN
        RAISE EXCEPTION 'submit_phase1_atomic (update): unexpected phase "%" in entry % (expected phase1)',
          v_phase, v_entry->>'templateItemId'
          USING ERRCODE = 'check_violation';
      END IF;

      v_template_item_id := (v_entry->>'templateItemId')::uuid;

      -- ──── §9 PRESERVATION READ ────
      --
      -- Look up the original completion in the chain head AND read its
      -- count_provenance in a single query. This is the preservation source
      -- for §9 point (a). The value flows directly into the new INSERT
      -- below; the chain-edit branch never derives a new provenance value.
      SELECT id, count_provenance
      INTO v_original_completion_id, v_original_count_provenance
      FROM checklist_completions cc
      WHERE cc.id = ANY(v_chain_head_row.completion_ids)
        AND cc.template_item_id = v_template_item_id
      LIMIT 1;

      IF v_original_completion_id IS NULL THEN
        RAISE EXCEPTION 'submit_phase1_atomic (update): template_item_id % in update entries not found in chain head submission %',
          v_template_item_id, p_original_submission_id
          USING ERRCODE = 'check_violation';
      END IF;

      SELECT label INTO v_item_label
      FROM checklist_template_items
      WHERE id = v_template_item_id;

      v_count_value := NULLIF(v_entry->>'countValue', '')::numeric;
      v_photo_id := NULLIF(v_entry->>'photoId', '')::uuid;
      v_notes := NULLIF(v_entry->>'notes', '');
      v_spot_check_status := NULLIF(v_entry->>'spotCheckStatus', '');
      v_opener_recount := CASE
        WHEN v_entry->>'openerRecount' IS NULL THEN NULL
        ELSE NULLIF(v_entry->>'openerRecount', '')::numeric
      END;
      -- 0215 batch-vs-bottle (ruling F): a batch_mode item's recount is TWO boxes — LINE
      -- (ready) and BACK UP (the bulk container). The server derives the total, so Phase 1's
      -- ground_truth / prep_need keep their count-total semantics. A total-only recount on a
      -- batch item is REFUSED (never coalesced to the closer LINE); a non-batch item ignores
      -- the two boxes entirely. Identical in the original and the chain-edit branch.
      v_recount_line := CASE
        WHEN v_entry->'openerRecountLine' IS NULL OR v_entry->'openerRecountLine' = 'null'::jsonb THEN NULL
        ELSE NULLIF(v_entry->>'openerRecountLine', '')::numeric
      END;
      v_recount_back_up := CASE
        WHEN v_entry->'openerRecountBackUp' IS NULL OR v_entry->'openerRecountBackUp' = 'null'::jsonb THEN NULL
        ELSE NULLIF(v_entry->>'openerRecountBackUp', '')::numeric
      END;
      SELECT c.is_batch INTO v_entry_is_batch FROM public.prep_batch_context(v_template_item_id) c;
      IF COALESCE(v_entry_is_batch, false) THEN
        IF (v_recount_line IS NULL) <> (v_recount_back_up IS NULL) THEN
          RAISE EXCEPTION 'submit_phase1_atomic: recount_split_incomplete for item % (%) — a batch item recount needs BOTH line and bulk backup',
            v_template_item_id, v_item_label
            USING ERRCODE = 'P0001';
        END IF;
        IF v_recount_line IS NOT NULL THEN
          IF v_recount_line < 0 OR v_recount_back_up < 0 THEN
            RAISE EXCEPTION 'submit_phase1_atomic: recount_split_negative for item % (%)',
              v_template_item_id, v_item_label
              USING ERRCODE = 'P0001';
          END IF;
          v_opener_recount := v_recount_line + v_recount_back_up;
        ELSIF v_opener_recount IS NOT NULL THEN
          RAISE EXCEPTION 'submit_phase1_atomic: recount_split_required for item % (%) — a batch item recount must be entered as line + bulk backup',
            v_template_item_id, v_item_label
            USING ERRCODE = 'P0001';
        END IF;
      ELSE
        v_recount_line := NULL;
        v_recount_back_up := NULL;
      END IF;

      IF v_spot_check_status IS NOT NULL THEN
        -- Spot-check item (chain edit): re-apply gates + compute against
        -- CURRENT state for prep_data freshness. Provenance stays preserved
        -- per the §9 read above.
        v_section_key := v_section_by_item_id->>(v_template_item_id::text);
        v_section_verified := v_section_key IS NOT NULL
          AND v_section_key = ANY(v_verified_sections);

        SELECT closer_count, par_value
        INTO v_closer_count, v_par_value
        FROM opening_closer_count_snapshots
        WHERE opening_instance_id = p_opening_instance_id
          AND template_item_id = v_template_item_id;

        -- Resolution gates (same as original path)
        IF v_closer_count IS NULL
           AND v_opener_recount IS NULL
           AND v_section_verified THEN
          RAISE EXCEPTION 'submit_phase1_atomic (update): null_source_requires_recount for item % (%)',
            v_template_item_id, v_item_label
            USING ERRCODE = 'P0001';
        END IF;
        IF v_opener_recount IS NULL AND NOT v_section_verified THEN
          RAISE EXCEPTION 'submit_phase1_atomic (update): ground_truth_unresolved for item % (%) — section not verified AND opener_recount IS NULL',
            v_template_item_id, v_item_label
            USING ERRCODE = 'P0001';
        END IF;

        v_ground_truth := COALESCE(v_opener_recount, v_closer_count);
        IF v_ground_truth IS NULL THEN
          RAISE EXCEPTION 'submit_phase1_atomic (update): ground_truth_unresolved for item % (%) — closer_count NULL AND opener_recount NULL despite gate-pass (defensive)',
            v_template_item_id, v_item_label
            USING ERRCODE = 'P0001';
        END IF;

        v_prep_need := CASE
          WHEN v_par_value IS NOT NULL
            THEN GREATEST(0, v_par_value - v_ground_truth)
          ELSE NULL
        END;
        v_resolved_spot_check_status := CASE
          WHEN v_opener_recount IS NOT NULL THEN 'flagged_recount'
          ELSE 'matched_via_section_verify'
        END;

        IF v_opener_recount IS NOT NULL THEN
          v_items_recounted := v_items_recounted + 1;
        END IF;

        v_prep_data_phase1 := jsonb_build_object(
          'phase', 1,
          'closer_count', v_closer_count,
          'opener_recount', v_opener_recount,
          'section_verified', v_section_verified,
          'ground_truth_count', v_ground_truth,
          'prep_need', v_prep_need,
          'par_value', v_par_value,
          'spot_check_status', v_resolved_spot_check_status
        );
        -- 0215 batch-vs-bottle: the split rides BESIDE the 8-key contract (never replaces a key).
        IF COALESCE(v_entry_is_batch, false) THEN
          v_prep_data_phase1 := v_prep_data_phase1 || jsonb_build_object(
            'opener_recount_line', v_recount_line,
            'opener_recount_back_up', v_recount_back_up
          );
        END IF;
      ELSE
        v_prep_data_phase1 := NULL;
      END IF;

      -- ──── 0185: SUPERSEDE-THEN-INSERT (migration 0176's one-live-head index) ────
      --
      -- 0176 put a partial unique index on checklist_completions
      -- (instance_id, template_item_id) WHERE superseded_at IS NULL AND
      -- revoked_at IS NULL, and reworked lib/checklists.ts completeItem to flip
      -- first. This branch was written before that index existed and still
      -- bare-INSERTS a second row for a key whose original is LIVE — so the
      -- moment a caller sets p_is_update = true it raises a raw 23505 that
      -- mapOpeningError does not recognise, i.e. an opaque 500 on every chain
      -- edit. The flip below is the same shape save_phase2_item_atomic (0056)
      -- and lib/cash.ts already use: clear the live head's null superseded_at
      -- BEFORE the insert, then back-point it once the new id exists.
      --
      -- It supersedes THE LIVE HEAD, not v_original_completion_id. Those are the
      -- same row on the first edit and diverge on the second: the §9 provenance
      -- read above deliberately keys on the CHAIN HEAD's completion_ids (so
      -- provenance is preserved from the original submission moment, edit after
      -- edit), while the row that actually holds the index slot is whichever
      -- edit is currently live. Superseding the chain head on edit 2 would be a
      -- no-op and the 23505 would come straight back.
      --
      -- At most one row can match — that is precisely what 0176's index
      -- guarantees — so a single-row RETURNING INTO is safe here. No live head
      -- (a revoked original) leaves it NULL and the insert stands alone.
      --
      -- §9 IS UNTOUCHED BY THIS: count_provenance still flows from
      -- v_original_count_provenance (point a), and an UPDATE of superseded_at on
      -- checklist_completions is not a notifications write (points b, c).
      v_superseded_completion_id := NULL;

      UPDATE checklist_completions
      SET superseded_at = v_submitted_at
      WHERE instance_id = p_opening_instance_id
        AND template_item_id = v_template_item_id
        AND superseded_at IS NULL
        AND revoked_at IS NULL
      RETURNING id INTO v_superseded_completion_id;

      -- ──── §9 PRESERVATION POINT (a): provenance from ORIGINAL, not current ────
      --
      -- count_provenance is set to v_original_count_provenance — the value
      -- READ from the original completion above. Even if the current
      -- (closer_count, opener_recount) state would suggest a different
      -- provenance for an original-path completion, on chain edit the
      -- provenance stays as it was at the original submission moment.
      INSERT INTO checklist_completions (
        instance_id, template_item_id, completed_by, completed_at,
        count_value, photo_id, notes, prep_data, count_provenance,
        original_completion_id, edit_count
      )
      VALUES (
        p_opening_instance_id,
        v_template_item_id,
        p_actor_id,
        v_submitted_at,
        v_count_value,
        v_photo_id,
        v_notes,
        CASE
          WHEN v_prep_data_phase1 IS NOT NULL
            THEN jsonb_build_object('phase1', v_prep_data_phase1)
          ELSE NULL
        END,
        v_original_count_provenance,  -- ← §9 PRESERVATION POINT (a)
        v_original_completion_id,
        v_new_edit_count
      )
      RETURNING id INTO v_completion_id;

      v_completion_ids := array_append(v_completion_ids, v_completion_id);

      -- 0185: close the chain link. superseded_by can only be written once the
      -- successor's id exists, which is why the flip above is two statements
      -- rather than one — the same order lib/cash.ts and completeItem take.
      IF v_superseded_completion_id IS NOT NULL THEN
        UPDATE checklist_completions
        SET superseded_by = v_completion_id
        WHERE id = v_superseded_completion_id;
      END IF;

      -- ──── §9 PRESERVATION POINTS (b), (c): structural absence ────
      --
      -- No INSERT/UPDATE/DELETE against notifications or notification_
      -- recipients fires on this path. The original instance's notification
      -- (if any) is canonical and untouched.
    END LOOP;

    -- New submission row for the chain edit
    INSERT INTO checklist_submissions (
      instance_id, submitted_by, submitted_at, completion_ids,
      is_final_confirmation, original_submission_id, edit_count
    )
    VALUES (
      p_opening_instance_id, p_actor_id, v_submitted_at, v_completion_ids,
      FALSE, p_original_submission_id, v_new_edit_count
    )
    RETURNING id INTO v_submission_id;

    -- C.46 update-path audit row — RPC-side per Triad A correction 1.
    -- Mirrors 0053:860-879. ip_address + user_agent live INSIDE metadata per
    -- AGENTS.md "RPC-side audit_log INSERTs must mirror the actual column
    -- shape" lesson (migration 0044 fix). audit_log columns are id,
    -- occurred_at, actor_id, actor_role, action, resource_table, resource_id,
    -- before_state, after_state, metadata, destructive — no top-level
    -- ip_address/user_agent.
    INSERT INTO audit_log (
      actor_id, action, resource_table, resource_id, metadata, destructive
    )
    VALUES (
      p_actor_id,
      'report.update',
      'checklist_submissions',
      v_submission_id,
      jsonb_build_object(
        'report_type', 'opening_report',
        'phase', 'phase1',
        'report_instance_id', p_opening_instance_id,
        'original_submission_id', p_original_submission_id,
        'original_completed_by', v_chain_head_row.submitted_by,
        'original_completed_at', to_jsonb(v_chain_head_row.submitted_at),
        'updated_by', p_actor_id,
        'updated_at', to_jsonb(v_submitted_at),
        'edit_count', v_new_edit_count,
        'changed_fields', COALESCE(p_changed_fields, '[]'::jsonb),
        'ip_address', p_ip_address,
        'user_agent', p_user_agent,
        -- Forensic visibility for C.54 §9 audit queries: count of items in
        -- this chain edit whose preserved provenance is 'reconstructed_
        -- morning' (i.e., chain edits crossing a NULL-source item without
        -- retracting the original notification — exactly the case §9 above
        -- is designed to handle correctly).
        'items_with_preserved_reconstructed_morning_provenance', (
          SELECT count(*)
          FROM checklist_completions cc
          WHERE cc.id = ANY(v_completion_ids)
            AND cc.count_provenance = 'reconstructed_morning'
        )
      ),
      true
    );

    -- NO status update on chain edit (instance stays in current phase status).
    -- NO section verifications re-INSERT (original submission's verify state stands).
    -- NO attestation re-write to checklist_instances.opener_no_prior_data_reason.
  END IF;

  -- ──── Build result jsonb ────
  --
  -- Result shape mirrors the OpeningPhaseSubmitResult contract (lib/opening.ts:
  -- 1485) plus the audit counters per responsibility 10. Camel-case keys
  -- match 0053's return convention and the JS-side SubmitRpcResult marshaler.
  SELECT to_jsonb(ci) INTO v_opening_instance_row
  FROM checklist_instances ci
  WHERE ci.id = p_opening_instance_id;

  RETURN jsonb_build_object(
    'instance', v_opening_instance_row,
    'submissionId', v_submission_id,
    'completionIds', to_jsonb(v_completion_ids),
    -- Phase 1 owns no opening→closing auto-complete (Phase 3 does); always NULL.
    'autoCompleteId', NULL,
    'editCount', CASE WHEN p_is_update THEN v_new_edit_count ELSE 0 END,
    'originalSubmissionId', CASE WHEN p_is_update THEN p_original_submission_id ELSE NULL END,
    -- Phase 1 has no under-par notification (that's a Phase 2 concept); always [].
    'underParNotificationIds', to_jsonb(ARRAY[]::uuid[]),
    -- New: C.54 NULL-source notification ids (zero or one per submit by Pattern A).
    'nullSourceNotificationIds', CASE
      WHEN v_null_source_notif_id IS NOT NULL
        THEN to_jsonb(ARRAY[v_null_source_notif_id])
      ELSE to_jsonb(ARRAY[]::uuid[])
    END,
    -- Responsibility 10 audit counters for JS-side opening.phase1_submit audit metadata.
    'stationsVerified', v_stations_verified,
    'itemsRecounted', v_items_recounted,
    'nullSourceCount', v_null_source_count,
    'provenanceMarkersSet', v_provenance_markers_set,
    'attestationCapture', CASE
      WHEN v_has_null_source THEN p_opener_no_prior_data_reason
      ELSE NULL
    END
  );
END;
$function$;

-- ==========================================================================================
-- 3. submit_mid_day_phase1_atomic <- 0215 (W13/B019)
-- ==========================================================================================
CREATE OR REPLACE FUNCTION public.submit_mid_day_phase1_atomic(
  p_instance_id uuid,
  p_actor_id uuid,
  p_entries jsonb
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
  v_instance_row jsonb;
  -- 0215 batch-vs-bottle (ruling F): LINE (onHand) + BACK UP pair on batch_mode items; total derived here.
  v_entry_is_batch boolean;
  v_on_hand numeric;
  v_back_up numeric;
BEGIN
  -- 0313 (W13/B019): only a mid-day prep instance is submitted here. A missing instance keeps
  -- its check_violation (status UPDATE below), so existence is tested first.
  IF EXISTS (SELECT 1 FROM checklist_instances WHERE id = p_instance_id)
     AND NOT EXISTS (SELECT 1 FROM checklist_instances ci
       JOIN checklist_templates ct ON ct.id = ci.template_id
       WHERE ci.id = p_instance_id AND ct.type = 'prep' AND ct.prep_subtype = 'mid_day_prep') THEN
    RAISE EXCEPTION 'submit_mid_day_phase1_atomic: wrong_checklist_type for instance %', p_instance_id
      USING ERRCODE = 'P0001';
  END IF;
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
  LOOP
    -- 0215 batch-vs-bottle (ruling F): a batch_mode item's mid-day count is TWO boxes, LINE
    -- (onHand) + bulk BACK UP; both paired and non-negative, and the COUNT total is derived
    -- here (Phase 1 semantics — Phase 2's inputs.total stays the production delta, 0199).
    -- Non-batch items are stored exactly as 0060 stores them.
    SELECT c.is_batch INTO v_entry_is_batch
    FROM public.prep_batch_context((v_entry->>'templateItemId')::uuid) c;
    IF COALESCE(v_entry_is_batch, false) THEN
      v_on_hand := CASE
        WHEN v_entry->'inputs'->'onHand' IS NULL OR v_entry->'inputs'->'onHand' = 'null'::jsonb THEN NULL
        ELSE NULLIF(v_entry->'inputs'->>'onHand', '')::numeric
      END;
      v_back_up := CASE
        WHEN v_entry->'inputs'->'backUp' IS NULL OR v_entry->'inputs'->'backUp' = 'null'::jsonb THEN NULL
        ELSE NULLIF(v_entry->'inputs'->>'backUp', '')::numeric
      END;
      IF v_on_hand IS NULL OR v_back_up IS NULL THEN
        RAISE EXCEPTION 'submit_mid_day_phase1_atomic: mid_day_backup_required for item % — a batch item counts LINE (on hand) AND the bulk BACK UP',
          v_entry->>'templateItemId'
          USING ERRCODE = 'P0001';
      END IF;
      IF v_on_hand < 0 OR v_back_up < 0 THEN
        RAISE EXCEPTION 'submit_mid_day_phase1_atomic: mid_day_count_negative for item %',
          v_entry->>'templateItemId'
          USING ERRCODE = 'P0001';
      END IF;
      v_entry := jsonb_set(v_entry, '{inputs}', (v_entry->'inputs') || jsonb_build_object('total', v_on_hand + v_back_up));
    END IF;
    INSERT INTO checklist_completions (
      instance_id, template_item_id, completed_by, completed_at, prep_data
    )
    VALUES (
      p_instance_id,
      (v_entry->>'templateItemId')::uuid,
      p_actor_id,
      v_submitted_at,
      jsonb_build_object('inputs', v_entry->'inputs', 'snapshot', v_entry->'snapshot')
    )
    RETURNING id INTO v_completion_id;
    v_completion_ids := array_append(v_completion_ids, v_completion_id);
  END LOOP;

  INSERT INTO checklist_submissions (
    instance_id, submitted_by, submitted_at, completion_ids, is_final_confirmation
  )
  VALUES (p_instance_id, p_actor_id, v_submitted_at, v_completion_ids, false)
  RETURNING id INTO v_submission_id;

  UPDATE checklist_instances
  SET status = 'phase1_complete'
  WHERE id = p_instance_id AND status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'submit_mid_day_phase1_atomic: instance % is not open or does not exist', p_instance_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT to_jsonb(ci) INTO v_instance_row FROM checklist_instances ci WHERE ci.id = p_instance_id;

  RETURN jsonb_build_object(
    'instance', v_instance_row,
    'submissionId', v_submission_id,
    'completionIds', to_jsonb(v_completion_ids)
  );
END;
$function$;

-- ==========================================================================================
-- 4. checklist_confirm_instance <- 0288 (W13/B072)
-- ==========================================================================================
create or replace function public.checklist_confirm_instance(
  p_actor uuid, p_instance uuid, p_confirmed_at timestamptz,
  p_reasons jsonb, p_expected_completion_ids uuid[]
) returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  v_instance public.checklist_instances%rowtype; v_submission public.checklist_submissions%rowtype;
  v_reason jsonb; v_reasons jsonb := '[]'::jsonb; v_row public.checklist_incomplete_reasons%rowtype;
  v_filtered uuid[]; v_expected uuid[]; v_n integer; v_count integer;
begin
  select * into v_instance from public.checklist_instances where id = p_instance for update;
  if not found then raise exception 'instance_not_found'; end if;
  -- 0313 (W13/B072): the generic writers are the closing screen's; opening and prep finish
  -- through their own atomic flows.
  if not exists(select 1 from public.checklist_templates where id = v_instance.template_id and type = 'closing') then
    raise exception 'wrong_checklist_type'; end if;
  if v_instance.status is distinct from 'open' then raise exception 'instance_not_open'; end if;
  if public.checklist_actor_level(p_actor, v_instance.location_id) < 3 then raise exception 'not_authorized'; end if;
  -- p_confirmed_at is retained for call compatibility but intentionally ignored.
  if jsonb_typeof(p_reasons) is distinct from 'array'
    or p_expected_completion_ids is null or array_position(p_expected_completion_ids, null) is not null then
    raise exception 'invalid_payload';
  end if;
  -- App gates/PIN run BEFORE this transaction. Bind their exact completion snapshot
  -- so a replacement winning the lock before us requires validation again.
  -- The expected set is the unrevoked live heads.
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_filtered
    from public.checklist_completions where instance_id = p_instance
      and superseded_at is null and revoked_at is null;
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_expected
    from unnest(p_expected_completion_ids) id;
  if v_filtered is distinct from v_expected then raise exception 'completion_set_changed'; end if;
  v_count := jsonb_array_length(p_reasons);
  if (select count(distinct r->>'templateItemId') from jsonb_array_elements(p_reasons) r) <> v_count then
    raise exception 'invalid_reasons';
  end if;
  for v_reason in select value from jsonb_array_elements(p_reasons) loop
    if jsonb_typeof(v_reason->'reason') is distinct from 'string'
      or btrim(v_reason->>'reason') = '' or not exists(select 1 from public.checklist_template_items
        where id = (v_reason->>'templateItemId')::uuid and template_id = v_instance.template_id) then
      raise exception 'invalid_reasons';
    end if;
  end loop;
  update public.checklist_instances set status = case when v_count > 0 then 'incomplete_confirmed' else 'confirmed' end,
    confirmed_at = clock_timestamp(), confirmed_by = p_actor
    where id = p_instance and status = 'open' returning * into strict v_instance;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'instance_cardinality'; end if;
  for v_reason in select value from jsonb_array_elements(p_reasons) loop
    -- Reuse a reason saved by an earlier attempt, matching the former app path.
    select * into v_row from public.checklist_incomplete_reasons
      where instance_id = p_instance and template_item_id = (v_reason->>'templateItemId')::uuid
        and reported_by = p_actor order by reported_at, id limit 1;
    if not found then
      insert into public.checklist_incomplete_reasons(instance_id, template_item_id, reason, reported_by)
        values (p_instance, (v_reason->>'templateItemId')::uuid, v_reason->>'reason', p_actor)
        returning * into strict v_row;
      get diagnostics v_n = row_count;
      if v_n <> 1 then raise exception 'reason_cardinality'; end if;
    end if;
    v_reasons := v_reasons || jsonb_build_array(to_jsonb(v_row));
  end loop;
  insert into public.checklist_submissions(instance_id, submitted_by, completion_ids, is_final_confirmation)
    values (p_instance, p_actor, '{}'::uuid[], true) returning * into strict v_submission;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'submission_cardinality'; end if;
  return jsonb_build_object('instance', to_jsonb(v_instance), 'reasons', v_reasons, 'submission', to_jsonb(v_submission));
end $$;

-- ==========================================================================================
-- 5. checklist_write_completion <- 0276 (W13/B072)
-- ==========================================================================================
create or replace function public.checklist_write_completion(
  p_actor uuid, p_instance uuid, p_template_item uuid,
  p_count_value numeric default null, p_photo_id uuid default null, p_notes text default null
) returns jsonb
language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  v_instance public.checklist_instances%rowtype;
  v_item public.checklist_template_items%rowtype;
  v_prior public.checklist_completions%rowtype;
  v_new public.checklist_completions%rowtype;
  v_level integer; v_n integer; v_expected integer; v_ids uuid[];
  v_at timestamptz; v_completed_at timestamptz;
begin
  select * into v_instance from public.checklist_instances where id = p_instance for update;
  if not found then raise exception 'instance_not_found'; end if;
  -- 0313 (W13/B072): the generic writers are the closing screen's; opening and prep finish
  -- through their own atomic flows.
  if not exists(select 1 from public.checklist_templates where id = v_instance.template_id and type = 'closing') then
    raise exception 'wrong_checklist_type'; end if;
  if v_instance.status is distinct from 'open' then raise exception 'instance_not_open'; end if;
  v_level := public.checklist_actor_level(p_actor, v_instance.location_id);
  select * into v_item from public.checklist_template_items where id = p_template_item;
  if not found or v_item.template_id is distinct from v_instance.template_id then
    raise exception 'item_mismatch';
  end if;
  -- Baseline INSERT OR closing-staff INSERT: the baseline permits every item
  -- meeting its floor. Do not accidentally AND the stricter closing alternative.
  -- active/report-reference/manual-item checks remain the existing app prechecks.
  if v_level < v_item.min_role_level or v_item.min_role_level is null then
    raise exception 'not_authorized';
  end if;
  v_at := clock_timestamp(); -- after waiting for the parent, never before its prior writer
  -- Generic completeItem replaces all phase heads, as the existing writer does.
  -- 0196 permits at most two; do not silently take the first of an unknown set.
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_ids
    from public.checklist_completions where instance_id = p_instance
      and template_item_id = p_template_item and superseded_at is null and revoked_at is null;
  v_expected := cardinality(v_ids);
  if v_expected > 2 then raise exception 'completion_cardinality'; end if;
  if v_expected = 1 then
    select * into strict v_prior from public.checklist_completions where id = v_ids[1];
    -- B8 notes-only timestamp preservation, identical to carriedCompletedAt.
    if v_prior.completed_by = p_actor and v_item.input_type is distinct from 'free_text'
      and v_prior.actual_completer_id is null
      and v_prior.count_value is not distinct from p_count_value
      and v_prior.photo_id is not distinct from p_photo_id then
      v_completed_at := v_prior.completed_at;
    end if;
  end if;
  update public.checklist_completions set superseded_at = v_at
    where id = any(v_ids) and superseded_at is null and revoked_at is null;
  get diagnostics v_n = row_count;
  if v_n <> v_expected then raise exception 'completion_cardinality'; end if;
  insert into public.checklist_completions
    (instance_id, template_item_id, completed_by, completed_at, count_value, photo_id, notes)
    values (p_instance, p_template_item, p_actor, coalesce(v_completed_at, v_at), p_count_value, p_photo_id, p_notes)
    returning * into strict v_new;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'completion_cardinality'; end if;
  update public.checklist_completions set superseded_by = v_new.id
    where id = any(v_ids) and superseded_at = v_at and superseded_by is null;
  get diagnostics v_n = row_count;
  if v_n <> v_expected then raise exception 'completion_cardinality'; end if;
  return jsonb_build_object('completion', to_jsonb(v_new), 'superseded_ids', to_jsonb(v_ids),
    'kept_completed_at', v_completed_at is not null);
end $$;

-- ==========================================================================================
-- 6. checklist_submit_batch <- 0276 (W13/B072)
-- ==========================================================================================
create or replace function public.checklist_submit_batch(p_actor uuid, p_instance uuid, p_completion_ids uuid[])
returns public.checklist_submissions
language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_instance public.checklist_instances%rowtype; v_new public.checklist_submissions%rowtype;
  v_n integer; v_expected integer;
begin
  select * into v_instance from public.checklist_instances where id = p_instance for update;
  if not found then raise exception 'instance_not_found'; end if;
  -- 0313 (W13/B072): the generic writers are the closing screen's; opening and prep finish
  -- through their own atomic flows.
  if not exists(select 1 from public.checklist_templates where id = v_instance.template_id and type = 'closing') then
    raise exception 'wrong_checklist_type'; end if;
  if v_instance.status is distinct from 'open' then raise exception 'instance_not_open'; end if;
  perform public.checklist_actor_level(p_actor, v_instance.location_id);
  if coalesce(cardinality(p_completion_ids), 0) = 0 then raise exception 'empty_batch'; end if;
  select count(distinct id) into v_expected from unnest(p_completion_ids) id;
  if array_position(p_completion_ids, null) is not null then raise exception 'completion_not_found'; end if;
  select count(*) into v_n from public.checklist_completions where id = any(p_completion_ids);
  if v_n <> v_expected then raise exception 'completion_not_found'; end if;
  if exists(select 1 from public.checklist_completions where id = any(p_completion_ids)
    and instance_id <> p_instance) then raise exception 'completion_wrong_instance'; end if;
  if exists(select 1 from public.checklist_completions where id = any(p_completion_ids)
    and completed_by <> p_actor) then raise exception 'completion_wrong_author'; end if;
  insert into public.checklist_submissions(instance_id, submitted_by, completion_ids, is_final_confirmation)
    values (p_instance, p_actor, p_completion_ids, false) returning * into strict v_new;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'submission_cardinality'; end if;
  return v_new;
end $$;

revoke all on function
  public.submit_am_prep_atomic(uuid,uuid,jsonb,uuid,boolean,uuid,jsonb,text,text,uuid,text),
  public.submit_phase1_atomic(uuid,uuid,jsonb,jsonb,text,boolean,uuid,jsonb,text,text),
  public.submit_mid_day_phase1_atomic(uuid,uuid,jsonb),
  public.checklist_confirm_instance(uuid,uuid,timestamptz,jsonb,uuid[]),
  public.checklist_write_completion(uuid,uuid,uuid,numeric,uuid,text),
  public.checklist_submit_batch(uuid,uuid,uuid[])
  from public, anon, authenticated;
grant execute on function
  public.submit_am_prep_atomic(uuid,uuid,jsonb,uuid,boolean,uuid,jsonb,text,text,uuid,text),
  public.submit_phase1_atomic(uuid,uuid,jsonb,jsonb,text,boolean,uuid,jsonb,text,text),
  public.submit_mid_day_phase1_atomic(uuid,uuid,jsonb),
  public.checklist_confirm_instance(uuid,uuid,timestamptz,jsonb,uuid[]),
  public.checklist_write_completion(uuid,uuid,uuid,numeric,uuid,text),
  public.checklist_submit_batch(uuid,uuid,uuid[])
  to service_role;

do $$
declare f regprocedure;
begin
  foreach f in array array[
    'public.submit_am_prep_atomic(uuid,uuid,jsonb,uuid,boolean,uuid,jsonb,text,text,uuid,text)'::regprocedure,
    'public.submit_phase1_atomic(uuid,uuid,jsonb,jsonb,text,boolean,uuid,jsonb,text,text)'::regprocedure,
    'public.submit_mid_day_phase1_atomic(uuid,uuid,jsonb)'::regprocedure,
    'public.checklist_confirm_instance(uuid,uuid,timestamptz,jsonb,uuid[])'::regprocedure,
    'public.checklist_write_completion(uuid,uuid,uuid,numeric,uuid,text)'::regprocedure,
    'public.checklist_submit_batch(uuid,uuid,uuid[])'::regprocedure
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
      or not has_function_privilege('service_role', f, 'EXECUTE')
      or exists (select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = f and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      raise exception '0313: RPC execution grant escaped for %', f;
    end if;
    if not exists(select 1 from pg_proc where oid = f
      and 'search_path=pg_catalog, public' = any(coalesce(proconfig, '{}'::text[]))) then
      raise exception '0313: search_path escaped for %', f;
    end if;
    if strpos(pg_get_functiondef(f), 'wrong_checklist_type') = 0 then
      raise exception '0313: type guard missing from %', f;
    end if;
  end loop;
  -- The prep / opening writers stay SECURITY DEFINER; the 0276 generic writers stay INVOKER.
  if exists(select 1 from pg_proc where oid in (
      'public.submit_am_prep_atomic(uuid,uuid,jsonb,uuid,boolean,uuid,jsonb,text,text,uuid,text)'::regprocedure,
      'public.submit_phase1_atomic(uuid,uuid,jsonb,jsonb,text,boolean,uuid,jsonb,text,text)'::regprocedure,
      'public.submit_mid_day_phase1_atomic(uuid,uuid,jsonb)'::regprocedure) and not prosecdef) then
    raise exception '0313: a prep/opening writer lost SECURITY DEFINER';
  end if;
  if exists(select 1 from pg_proc where oid in (
      'public.checklist_confirm_instance(uuid,uuid,timestamptz,jsonb,uuid[])'::regprocedure,
      'public.checklist_write_completion(uuid,uuid,uuid,numeric,uuid,text)'::regprocedure,
      'public.checklist_submit_batch(uuid,uuid,uuid[])'::regprocedure) and prosecdef) then
    raise exception '0313: a generic checklist writer became SECURITY DEFINER';
  end if;
end $$;

INSERT INTO public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
VALUES (NULL, NULL, 'security.grants_change', 'checklist_instances', NULL, true,
  jsonb_build_object('actor_context', 'migration_apply', 'migration', '0313_checklist_type_guards',
    'change', 'checklist writers refuse an instance of another checklist type; Phase 1 requires every live spot-check item',
    'bugs', jsonb_build_array('B019', 'B072', 'B073', 'B074')));
commit;
