-- Captured retroactively 2026-05-06 from supabase.migrations table.
-- Functional equivalent of applied migration; may differ in whitespace
-- or transaction wrapping from original MCP apply_migration input.
-- Canonical reference:
--   - lib/opening.ts (canonical consumer for submit_opening_atomic)
--   - BUILD_3_OPENING_REPORT_DESIGN.md §3.1 (Opening atomic submit RPC design)
--   - AGENTS.md "Pre-INSERT pg_enum query for enum-constrained columns" lesson
--     — this migration is the canonical example that taught the pg_enum lesson:
--     the seed against report_type_enum failed first-run on label drift
--     (design-doc shorthand 'opening' vs canonical 'opening_report'); the
--     fix-and-retry produced gap-recovery row
--     b927ae16-7ee1-43fa-8336-0c6b725b3a00 capturing the orphaned-changes
--     forensic detail. The lesson formalizes pre-flight pg_enum query as
--     standard practice going forward.

-- ─────────────────────────────────────────────────────────────────────
-- Build #3 PR 2 — submit_opening_atomic RPC
--
-- Mirrors submit_am_prep_atomic (migration 0044) shape with three deltas:
--   1. Entry shape uses count_value + photo_id + notes (top-level columns)
--      instead of prep_data JSONB — opening Phase 1 has nothing prep-shaped
--   2. Auto-completion target is closing(N-1)'s "Opening verified" item
--      (reverse temporal direction; AM Prep uses closing(N))
--   3. Audit metadata uses report_type = 'opening_report'
--
-- Pre-flight verification done before authoring:
--   - report_type_enum value 'opening_report' confirmed via pg_enum query
--     (per AGENTS.md durable lesson: "Query pg_enum before authoring INSERT
--     statements that touch enum-constrained columns")
--   - audit_log column shape confirmed via information_schema.columns
--     (no ip_address/user_agent columns; live in metadata JSONB per
--     migration 0044's lesson)
--
-- C.42 reuses the existing autoCompleteMeta pattern verbatim — no new
-- auto-completion lib code; just sets report_reference_type='opening_report'
-- on the cross-reference item (already done in C.49) and triggers the
-- mechanic.
--
-- C.46 update path included for forward-compat (PR 4+ may add opening
-- edit UI; RPC ready when that lands).
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.submit_opening_atomic(
  p_opening_instance_id uuid,
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
  v_opening_instance_row jsonb;
  v_max_edit_count int;
  v_new_edit_count int;
  v_chain_head_row checklist_submissions%ROWTYPE;
  v_original_completion_id uuid;
  v_count_value numeric;
  v_photo_id uuid;
  v_notes text;
BEGIN
  IF NOT p_is_update THEN
    -- ================================================================
    -- ORIGINAL-SUBMISSION PATH
    -- ================================================================

    -- 1. Insert one checklist_completion per entry. Opening uses top-level
    --    count_value, photo_id, notes — no prep_data JSONB.
    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
    LOOP
      v_count_value := NULLIF(v_entry->>'countValue', '')::numeric;
      v_photo_id := NULLIF(v_entry->>'photoId', '')::uuid;
      v_notes := NULLIF(v_entry->>'notes', '');

      INSERT INTO checklist_completions (
        instance_id,
        template_item_id,
        completed_by,
        completed_at,
        count_value,
        photo_id,
        notes
      )
      VALUES (
        p_opening_instance_id,
        (v_entry->>'templateItemId')::uuid,
        p_actor_id,
        v_submitted_at,
        v_count_value,
        v_photo_id,
        v_notes
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
      p_opening_instance_id,
      p_actor_id,
      v_submitted_at,
      v_completion_ids,
      true
    )
    RETURNING id INTO v_submission_id;

    -- 3. Pessimistic transition opening instance → confirmed.
    UPDATE checklist_instances
    SET
      status = 'confirmed',
      confirmed_at = v_submitted_at,
      confirmed_by = p_actor_id,
      finalized_at_actor_type = 'closer_confirm'  -- Build #3 PR 1: opener-PIN-attests is the same closer_confirm path semantically (operator finalized via attestation)
    WHERE id = p_opening_instance_id
      AND status = 'open';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'submit_opening_atomic: opening instance % is not open or does not exist', p_opening_instance_id
        USING ERRCODE = 'check_violation';
    END IF;

    -- 4. Auto-complete the closing's "Opening verified" item if one exists.
    --    Delta vs submit_am_prep_atomic: temporal direction reverses.
    --    Opening(date=N) auto-completes closing(date=N-1).
    IF p_closing_report_ref_item_id IS NOT NULL THEN
      WITH closing_ix AS (
        SELECT ci.id AS closing_instance_id
        FROM checklist_instances ci
        JOIN checklist_template_items cti
          ON cti.template_id = ci.template_id
        JOIN checklist_instances opening_ci
          ON opening_ci.location_id = ci.location_id
          AND ci.date = (opening_ci.date - INTERVAL '1 day')::date
        WHERE cti.id = p_closing_report_ref_item_id
          AND opening_ci.id = p_opening_instance_id
        LIMIT 1
      ),
      prior_live AS (
        SELECT cc.id AS prior_id
        FROM checklist_completions cc
        JOIN closing_ix ON cc.instance_id = closing_ix.closing_instance_id
        WHERE cc.template_item_id = p_closing_report_ref_item_id
          AND cc.superseded_at IS NULL
          AND cc.revoked_at IS NULL
        LIMIT 1
      )
      INSERT INTO checklist_completions (
        instance_id,
        template_item_id,
        completed_by,
        completed_at,
        auto_complete_meta
      )
      SELECT
        closing_ix.closing_instance_id,
        p_closing_report_ref_item_id,
        p_actor_id,
        v_submitted_at,
        jsonb_build_object(
          'reportType', 'opening_report',
          'reportInstanceId', p_opening_instance_id,
          'reportSubmittedAt', to_jsonb(v_submitted_at)
        )
      FROM closing_ix
      RETURNING id INTO v_auto_complete_id;

      -- v_auto_complete_id NULL = no closing instance found at date N-1.
      -- Acceptable for opening's first-ever-at-location case (no prior
      -- closing exists). Caller passes NULL p_closing_report_ref_item_id
      -- in that case; if caller passes non-NULL but no instance found,
      -- something's mis-wired and we raise.
      IF v_auto_complete_id IS NULL THEN
        RAISE EXCEPTION 'submit_opening_atomic: no closing instance found at date N-1 for opening instance % to auto-complete report-ref item %',
          p_opening_instance_id, p_closing_report_ref_item_id
          USING ERRCODE = 'foreign_key_violation';
      END IF;

      UPDATE checklist_completions
      SET
        superseded_at = v_submitted_at,
        superseded_by = v_auto_complete_id
      WHERE id IN (
        SELECT cc.id
        FROM checklist_completions cc
        JOIN checklist_instances ci ON ci.id = cc.instance_id
        JOIN checklist_instances opening_ci
          ON opening_ci.location_id = ci.location_id
          AND ci.date = (opening_ci.date - INTERVAL '1 day')::date
        WHERE cc.template_item_id = p_closing_report_ref_item_id
          AND opening_ci.id = p_opening_instance_id
          AND cc.id <> v_auto_complete_id
          AND cc.superseded_at IS NULL
          AND cc.revoked_at IS NULL
        LIMIT 1
      );
    END IF;

  ELSE
    -- ================================================================
    -- UPDATE PATH (C.46) — chained attribution; cap-checked; locked
    -- Forward-compat: PR 2 doesn't ship opening edit UI. Mirror of
    -- submit_am_prep_atomic update path with report_type='opening_report'.
    -- ================================================================

    IF p_original_submission_id IS NULL THEN
      RAISE EXCEPTION 'submit_opening_atomic: p_original_submission_id required when p_is_update = true'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- 1. Lock the chain head.
    SELECT * INTO v_chain_head_row
    FROM checklist_submissions
    WHERE id = p_original_submission_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'submit_opening_atomic: chain head submission % not found', p_original_submission_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF v_chain_head_row.original_submission_id IS NOT NULL THEN
      RAISE EXCEPTION 'submit_opening_atomic: % is an update row, not a chain head', p_original_submission_id
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_chain_head_row.instance_id <> p_opening_instance_id THEN
      RAISE EXCEPTION 'submit_opening_atomic: chain head % is for instance %, not %',
        p_original_submission_id, v_chain_head_row.instance_id, p_opening_instance_id
        USING ERRCODE = 'check_violation';
    END IF;

    PERFORM 1
    FROM checklist_submissions
    WHERE original_submission_id = p_original_submission_id
    FOR UPDATE;

    -- 2. Cap check.
    SELECT COALESCE(MAX(edit_count), 0) INTO v_max_edit_count
    FROM checklist_submissions
    WHERE id = p_original_submission_id
       OR original_submission_id = p_original_submission_id;

    IF v_max_edit_count >= 3 THEN
      RAISE EXCEPTION 'submit_opening_atomic: edit cap reached for chain % (current_max=%)',
        p_original_submission_id, v_max_edit_count
        USING ERRCODE = 'P0001';
    END IF;

    v_new_edit_count := v_max_edit_count + 1;

    -- 3. Insert new completions, each linked to the chain-head completion.
    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
    LOOP
      v_count_value := NULLIF(v_entry->>'countValue', '')::numeric;
      v_photo_id := NULLIF(v_entry->>'photoId', '')::uuid;
      v_notes := NULLIF(v_entry->>'notes', '');

      SELECT cc.id INTO v_original_completion_id
      FROM checklist_completions cc
      WHERE cc.id = ANY(v_chain_head_row.completion_ids)
        AND cc.template_item_id = (v_entry->>'templateItemId')::uuid
      LIMIT 1;

      IF v_original_completion_id IS NULL THEN
        RAISE EXCEPTION 'submit_opening_atomic: template_item_id % in update entries not found in chain head submission %',
          (v_entry->>'templateItemId')::uuid, p_original_submission_id
          USING ERRCODE = 'check_violation';
      END IF;

      INSERT INTO checklist_completions (
        instance_id,
        template_item_id,
        completed_by,
        completed_at,
        count_value,
        photo_id,
        notes,
        original_completion_id,
        edit_count
      )
      VALUES (
        p_opening_instance_id,
        (v_entry->>'templateItemId')::uuid,
        p_actor_id,
        v_submitted_at,
        v_count_value,
        v_photo_id,
        v_notes,
        v_original_completion_id,
        v_new_edit_count
      )
      RETURNING id INTO v_completion_id;

      v_completion_ids := array_append(v_completion_ids, v_completion_id);
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
      p_opening_instance_id,
      p_actor_id,
      v_submitted_at,
      v_completion_ids,
      true,
      p_original_submission_id,
      v_new_edit_count
    )
    RETURNING id INTO v_submission_id;

    -- 5. Audit emission inside transaction (atomic with chain write per
    --    C.46 A7). audit_log column shape: ip_address + user_agent live
    --    inside metadata JSONB (per migration 0044's lesson).
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
        'report_type', 'opening_report',
        'report_instance_id', p_opening_instance_id,
        'original_submission_id', p_original_submission_id,
        'original_completed_by', v_chain_head_row.submitted_by,
        'original_completed_at', to_jsonb(v_chain_head_row.submitted_at),
        'updated_by', p_actor_id,
        'updated_at', to_jsonb(v_submitted_at),
        'edit_count', v_new_edit_count,
        'changed_fields', COALESCE(p_changed_fields, '[]'::jsonb),
        'ip_address', p_ip_address,
        'user_agent', p_user_agent
      ),
      true
    );

    -- 6. Per C.46 A6: do NOT change checklist_instances.status.
    -- 7. Per C.46 A4: do NOT touch closing's auto-complete row.
  END IF;

  SELECT to_jsonb(ci) INTO v_opening_instance_row
  FROM checklist_instances ci
  WHERE ci.id = p_opening_instance_id;

  RETURN jsonb_build_object(
    'instance', v_opening_instance_row,
    'submissionId', v_submission_id,
    'completionIds', to_jsonb(v_completion_ids),
    'autoCompleteId', v_auto_complete_id,
    'editCount', CASE WHEN p_is_update THEN v_new_edit_count ELSE 0 END,
    'originalSubmissionId', CASE WHEN p_is_update THEN p_original_submission_id ELSE NULL END
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.submit_opening_atomic(uuid, uuid, jsonb, uuid, boolean, uuid, jsonb, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_opening_atomic(uuid, uuid, jsonb, uuid, boolean, uuid, jsonb, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_opening_atomic(uuid, uuid, jsonb, uuid, boolean, uuid, jsonb, text, text) TO authenticated, service_role;
