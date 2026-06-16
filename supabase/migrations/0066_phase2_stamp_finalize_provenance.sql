-- Migration 0066_phase2_stamp_finalize_provenance
-- Applied via Supabase MCP apply_migration on 2026-06-16.
-- Canonical reference: lib/opening.ts submitPhase2Atomic; dashboard OpeningTile provenance.
--
-- Opening Phase 2 finalize (phase1_complete → phase2_complete) previously left
-- checklist_instances.confirmed_at / confirmed_by NULL — unlike AM-prep
-- (submit_am_prep_atomic) and mid-day (finalizeMidDayPhase2), which both stamp
-- the finalizer + time. That left the dashboard Opening tile with no "Finalized
-- at {time} by {name}" provenance to render. This adds the two columns to the
-- status-transition UPDATE so opening is consistent with the other reports.
-- Additive only: same body as the prior version + two SET assignments.

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
  -- Universe = ALL openingPhase2 template items on this instance's template.
  -- Each MUST have a live phase2 completion (written by save_phase2_item_atomic).
  SELECT count(*) INTO v_missing_count
  FROM checklist_template_items cti
  WHERE cti.template_id = v_template_id
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

    v_prep_need          := NULLIF(v_phase1->>'prep_need', '')::numeric;
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
            'freeText', COALESCE(v_over_under_reason_text, '')
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
      INSERT INTO notification_recipients (notification_id, user_id, delivery_method, delivery_status)
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
