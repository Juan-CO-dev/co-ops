-- Migration 0050_opening_phase2_rpc_extension
-- Applied via Supabase MCP apply_migration on 2026-05-07.
-- Canonical references:
--   - lib/opening.ts (OpeningEntry discriminated union + submitOpening
--     marshalling for Phase 2 entries; locked Q1/Q2/Q3 sub-decisions)
--   - lib/notifications.ts (Step 5 — under_par_alert vocabulary +
--     loadUnreadForUser dashboard polling read)
--   - AGENTS.md "Pre-INSERT pg_enum query for enum-constrained columns"
--     lesson — pre-flight verified notifications.priority CHECK ('info',
--     'urgent') post-0049 + notification_recipients.delivery_method/status
--     CHECK constraints support 'in_app'/'pending' values used here
--   - AGENTS.md "RPC-side audit_log INSERTs must mirror the actual column
--     shape" lesson — applied to notifications + notification_recipients
--     INSERTs (information_schema.columns query verified column shapes
--     before authoring; 'priority' lives on notifications, NOT on recipients)
--   - SPEC_AMENDMENTS.md C.50 PENDING (Phase 2 schema additions, RPC
--     extension semantic, under-par notification routing pattern)
--   - BUILD_3_OPENING_REPORT_DESIGN.md §3 (Phase 2 three-values model +
--     under-par notification routing to KH+ at location + MoO + Owner)

-- Build #3 PR 3 Step 4 — submit_opening_atomic Phase 2 + under-par notification.
--
-- Extends the 0048 RPC with three deltas:
--   1. Per-entry phase dispatch on `entry.phase = 'phase1' | 'phase2'`
--      (form-passed discriminator; RPC trusts per locked Q2 sub-decision)
--   2. Phase 2 entries write `prep_data.phase2.{openerActual, openerPrepped,
--      overPar, underPar, closerEstimateSnapshot}` JSONB (count_value/
--      photo_id/notes NULL); closerEstimateSnapshot trusted from form per
--      locked Q3 (no RPC re-resolution)
--   3. Under-par entries (phase2.underPar non-null) emit transactional
--      notifications + recipients per locked Q4/Q5:
--        - notifications: priority='urgent', type='under_par_alert',
--          title=EN-fallback, data carries titleKey/titleParams/bodyKey/
--          bodyParams for render-time i18n resolution
--        - notification_recipients: KH+ at this location + MoO + Owner,
--          DISTINCT-wrapped, explicit role enumeration mirroring lib/roles.ts
--          level >= 3
--        - One notification per under-par entry (N-per-item grain locked)
--
-- Phase 2 update path: same dispatch logic (phase=phase2 entries write
-- prep_data.phase2 in chain-link completion). NO notification emission on
-- update path — original-submission notification is the canonical signal;
-- chain edits don't duplicate (forward-note: revisit when opening edit UI
-- lands in PR 4+).
--
-- Pre-flight verification done before authoring (per AGENTS.md "Pre-INSERT
-- pg_enum query for enum-constrained columns" lesson):
--   - notifications.priority post-0049: TEXT NOT NULL DEFAULT 'info'
--     CHECK ('info', 'urgent') — 'urgent' is valid
--   - notification_recipients.delivery_method CHECK ('in_app', 'sms',
--     'email') — 'in_app' is valid
--   - notification_recipients.delivery_status CHECK ('pending', 'sent',
--     'failed', 'disabled') — 'pending' is valid
--   - lib/roles.ts level >= 3 = all roles except 'trainee' (single
--     exclusion); explicit enumeration locked per Q4 sub-decision 4
--
-- Signature unchanged — CREATE OR REPLACE preserves existing grants
-- (REVOKE/GRANT from 0048 stay in effect).

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
  -- Build #3 PR 3 Step 4 — Phase 2 dispatch + under-par notification emission
  v_phase text;
  v_phase2_data jsonb;
  v_location_id uuid;
  v_opening_date date;
  v_location_code text;
  v_actor_name text;
  v_item_label text;
  v_under_par jsonb;
  v_notif_id uuid;
  v_notif_ids uuid[] := ARRAY[]::uuid[];
  v_notif_title text;
  v_par_delta numeric;
BEGIN
  IF NOT p_is_update THEN
    -- ================================================================
    -- ORIGINAL-SUBMISSION PATH
    -- ================================================================

    -- Pre-load location + opening_date + location_code + actor_name once
    -- per submission (used by Phase 2 entries' under-par notification
    -- emission; reduces per-entry query cost).
    SELECT ci.location_id, ci.date, l.code, u.name
    INTO v_location_id, v_opening_date, v_location_code, v_actor_name
    FROM checklist_instances ci
    JOIN locations l ON l.id = ci.location_id
    JOIN users u ON u.id = p_actor_id
    WHERE ci.id = p_opening_instance_id;

    IF v_location_id IS NULL THEN
      RAISE EXCEPTION 'submit_opening_atomic: opening instance % not found OR actor % not found',
        p_opening_instance_id, p_actor_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    -- 1. Insert one checklist_completion per entry; dispatch on phase.
    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
    LOOP
      v_phase := COALESCE(v_entry->>'phase', 'phase1');

      IF v_phase = 'phase1' THEN
        -- Phase 1 (existing): top-level count_value/photo_id/notes
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

      ELSIF v_phase = 'phase2' THEN
        -- Phase 2 (new): prep_data.phase2 JSONB
        v_phase2_data := v_entry->'phase2';
        IF v_phase2_data IS NULL OR v_phase2_data = 'null'::jsonb THEN
          RAISE EXCEPTION 'submit_opening_atomic: phase=phase2 entry % missing phase2 sub-object',
            v_entry->>'templateItemId'
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
          prep_data
        )
        VALUES (
          p_opening_instance_id,
          (v_entry->>'templateItemId')::uuid,
          p_actor_id,
          v_submitted_at,
          NULL,
          NULL,
          NULL,
          jsonb_build_object('phase2', v_phase2_data)
        )
        RETURNING id INTO v_completion_id;

        -- Under-par detection + notification emission (transactional with submit).
        v_under_par := v_phase2_data->'underPar';
        IF v_under_par IS NOT NULL AND v_under_par <> 'null'::jsonb THEN
          -- Lookup item label (en source-of-truth; fallback rendering uses
          -- this string + locationCode).
          SELECT label INTO v_item_label
          FROM checklist_template_items
          WHERE id = (v_entry->>'templateItemId')::uuid;

          v_par_delta :=
            COALESCE((v_phase2_data->>'openerPrepped')::numeric, 0)
            - COALESCE((v_phase2_data->'closerEstimateSnapshot'->>'parValue')::numeric, 0);

          v_notif_title := 'Under-par: ' || v_item_label || ' at ' || v_location_code;

          INSERT INTO notifications (
            type,
            category,
            priority,
            title,
            body,
            data,
            related_table,
            related_id,
            location_id,
            created_by
          )
          VALUES (
            'under_par_alert',
            NULL,
            'urgent',
            v_notif_title,
            NULL,
            jsonb_build_object(
              'titleKey', 'notifications.under_par_alert.title',
              'titleParams', jsonb_build_object(
                'itemName', v_item_label,
                'locationCode', v_location_code
              ),
              'bodyKey', 'notifications.under_par_alert.body',
              'bodyParams', jsonb_build_object(
                'openerName', v_actor_name,
                'itemName', v_item_label,
                'prepped', v_phase2_data->>'openerPrepped',
                'par', v_phase2_data->'closerEstimateSnapshot'->>'parValue',
                'closer', v_phase2_data->'closerEstimateSnapshot'->>'total',
                'reasonCategory', v_under_par->>'reasonCategory',
                'freeText', v_under_par->>'freeText'
              ),
              'itemName', v_item_label,
              'templateItemId', v_entry->>'templateItemId',
              'completionId', v_completion_id::text,
              'instanceId', p_opening_instance_id::text,
              'openingDate', v_opening_date::text,
              'parValue', v_phase2_data->'closerEstimateSnapshot'->'parValue',
              'closerEstimate', v_phase2_data->'closerEstimateSnapshot'->'total',
              'openerActual', v_phase2_data->'openerActual',
              'openerPrepped', v_phase2_data->'openerPrepped',
              'parDelta', v_par_delta,
              'reasonCategory', v_under_par->'reasonCategory',
              'freeText', v_under_par->'freeText'
            ),
            'checklist_completions',
            v_completion_id,
            v_location_id,
            p_actor_id
          )
          RETURNING id INTO v_notif_id;

          -- Insert recipients: KH+ at this location + MoO + Owner (DISTINCT).
          -- Role list mirrors lib/roles.ts level >= 3 (all roles except 'trainee').
          -- When new roles are added to lib/roles.ts, refactor here to use the
          -- corresponding SQL helper function (planned: get_role_level(role) per
          -- Phase 5+ admin tooling). Until then, explicit enumeration prevents
          -- silent inclusion/exclusion bugs from role name drift.
          INSERT INTO notification_recipients (
            notification_id,
            user_id,
            delivery_method,
            delivery_status
          )
          SELECT v_notif_id, recipients.user_id, 'in_app', 'pending'
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

          v_notif_ids := array_append(v_notif_ids, v_notif_id);
        END IF;

      ELSE
        RAISE EXCEPTION 'submit_opening_atomic: unknown phase "%" in entry %',
          v_phase, v_entry->>'templateItemId'
          USING ERRCODE = 'check_violation';
      END IF;

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
      finalized_at_actor_type = 'closer_confirm'
    WHERE id = p_opening_instance_id
      AND status = 'open';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'submit_opening_atomic: opening instance % is not open or does not exist', p_opening_instance_id
        USING ERRCODE = 'check_violation';
    END IF;

    -- 4. Auto-complete the closing's "Opening verified" item if one exists.
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
    -- UPDATE PATH (C.46) — chained attribution; cap-checked
    -- Phase 2 dispatch supported; NO notification emission on update path.
    -- ================================================================

    IF p_original_submission_id IS NULL THEN
      RAISE EXCEPTION 'submit_opening_atomic: p_original_submission_id required when p_is_update = true'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

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

    -- Insert new completions, dispatching on phase.
    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
    LOOP
      v_phase := COALESCE(v_entry->>'phase', 'phase1');

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

      IF v_phase = 'phase1' THEN
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

      ELSIF v_phase = 'phase2' THEN
        v_phase2_data := v_entry->'phase2';
        IF v_phase2_data IS NULL OR v_phase2_data = 'null'::jsonb THEN
          RAISE EXCEPTION 'submit_opening_atomic: phase=phase2 entry % missing phase2 sub-object (update path)',
            v_entry->>'templateItemId'
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
          prep_data,
          original_completion_id,
          edit_count
        )
        VALUES (
          p_opening_instance_id,
          (v_entry->>'templateItemId')::uuid,
          p_actor_id,
          v_submitted_at,
          NULL,
          NULL,
          NULL,
          jsonb_build_object('phase2', v_phase2_data),
          v_original_completion_id,
          v_new_edit_count
        )
        RETURNING id INTO v_completion_id;

      ELSE
        RAISE EXCEPTION 'submit_opening_atomic: unknown phase "%" in update entry %',
          v_phase, v_entry->>'templateItemId'
          USING ERRCODE = 'check_violation';
      END IF;

      v_completion_ids := array_append(v_completion_ids, v_completion_id);
    END LOOP;

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
    'originalSubmissionId', CASE WHEN p_is_update THEN p_original_submission_id ELSE NULL END,
    'underParNotificationIds', to_jsonb(v_notif_ids)
  );
END;
$function$;
