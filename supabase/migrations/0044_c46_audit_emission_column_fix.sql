-- Captured retroactively 2026-05-06 from supabase.migrations table.
-- Functional equivalent of applied migration; may differ in whitespace
-- or transaction wrapping from original MCP apply_migration input.
-- Canonical reference: AGENTS.md "RPC-side audit_log INSERTs must mirror
-- the actual column shape (Build #2 PR 3 smoke)" lesson; lib/prep.ts is
-- the downstream consumer where the corrected emission shape is observable.

-- 0044_c46_audit_emission_column_fix
-- The RPC migrated in 0043 referenced ip_address + user_agent as top-level
-- columns on audit_log, but the audit_log schema stores them inside the
-- metadata JSONB (matching lib/audit.ts convention). Postgres raised
-- sqlstate 42703 ("column 'ip_address' of relation 'audit_log' does not
-- exist") on every update-path call; the whole transaction rolled back;
-- the UI surfaced a generic "Submission failed".
--
-- Audit_log actual columns (verified via information_schema.columns):
--   id, occurred_at, actor_id, actor_role, action, resource_table,
--   resource_id, before_state, after_state, metadata, destructive
--
-- IP/UA forensic enrichment lives inside metadata JSONB (matching the
-- JS-side audit() helper convention so audit_log queries can filter
-- consistently across both emission paths).
--
-- Function signature is identical to 0043 — CREATE OR REPLACE is sufficient
-- (no DROP needed). Only the INSERT block in the update branch changes.

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
      WITH closing_ix AS (
        SELECT ci.id AS closing_instance_id
        FROM checklist_instances ci
        JOIN checklist_template_items cti
          ON cti.template_id = ci.template_id
        JOIN checklist_instances prep_ci
          ON prep_ci.location_id = ci.location_id
          AND prep_ci.date = ci.date
        WHERE cti.id = p_closing_report_ref_item_id
          AND prep_ci.id = p_prep_instance_id
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
          'reportType', 'am_prep',
          'reportInstanceId', p_prep_instance_id,
          'reportSubmittedAt', to_jsonb(v_submitted_at)
        )
      FROM closing_ix
      RETURNING id INTO v_auto_complete_id;

      IF v_auto_complete_id IS NULL THEN
        RAISE EXCEPTION 'submit_am_prep_atomic: no closing instance found for prep instance % to auto-complete report-ref item %',
          p_prep_instance_id, p_closing_report_ref_item_id
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
        JOIN checklist_instances prep_ci
          ON prep_ci.location_id = ci.location_id
          AND prep_ci.date = ci.date
        WHERE cc.template_item_id = p_closing_report_ref_item_id
          AND prep_ci.id = p_prep_instance_id
          AND cc.id <> v_auto_complete_id
          AND cc.superseded_at IS NULL
          AND cc.revoked_at IS NULL
        LIMIT 1
      );
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
