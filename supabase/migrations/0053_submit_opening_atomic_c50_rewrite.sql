-- Migration 0053_submit_opening_atomic_c50_rewrite
-- Applied via Supabase MCP apply_migration on 2026-05-09.
-- Canonical references:
--   - docs/SPEC_AMENDMENTS.md C.50 §1, §2, §4, §5, §8.3, §8.4
--   - lib/opening.ts (OpeningEntryPhase2 C.50 redesign + submitOpening rpcEntries
--     marshaling; raw-inputs-only payload per §8.3 lock)
--   - lib/notifications.ts (Step 5 — under_par_alert vocabulary;
--     loadUnreadForUser dashboard polling read; body template references
--     prepped + par + closer params)
--   - components/opening/OpeningPrepEntry.tsx (Phase 3 form rewrite — section-
--     verify CTAs + per-item recount drill-in + live prep_need preview)
--   - AGENTS.md durable lessons:
--       "RPC-side audit_log INSERTs must mirror the actual column shape"
--       "Pre-INSERT pg_enum query for enum-constrained columns"
--       "Form validation must iterate the source of truth"
--       "RLS helper functions must be SECURITY DEFINER with locked search_path"
--   - Migration 0050 (the OLD RPC being replaced)
--   - Migration 0051 (opening_closer_count_snapshots + opening_section_verifications
--     tables — created here, populated by THIS RPC at submit time)
--
-- Phase 5 of Step 12+13 bundled commit. Originally planned as 0052; bumped
-- to 0053 because Step 11 review-time tightening (Confirm 2 atomicity hole)
-- claimed 0052 for the create_opening_instance_atomic RPC.

-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT CHANGES vs 0050
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 1. Signature extended with `p_section_verifications jsonb DEFAULT NULL`
--    (CREATE OR REPLACE doesn't allow new params even with defaults — must
--    DROP + CREATE; grants re-applied below).
--
-- 2. Phase 2 entry shape (per C.50 §8.3 raw-inputs-only lock):
--    OLD: { openerActual, openerPrepped, overPar, underPar, closerEstimateSnapshot }
--    NEW: { openerRecount (nullable), openerPrepped, overPar, underPar }
--    Server reads closer_count from opening_closer_count_snapshots table —
--    NOT from entry payload.
--
-- 3. Server-side compute (per C.50 §1):
--      ground_truth_count = openerRecount IF NOT NULL
--                           ELSE (closer_count IF section_verified ELSE NULL)
--      prep_need = MAX(0, par_value - ground_truth_count)
--      delta_vs_prep_need = openerPrepped - prep_need
--      over_under_status = CASE delta WHEN 0 THEN 'at_par'
--                                     WHEN > 0 THEN 'over_prep'
--                                     ELSE 'under_prep'
--
-- 4. Validation gates (server canonical per §8.3 lock):
--    a. ground_truth resolved: section_verified OR openerRecount populated.
--       Throws sqlstate P0001 with 'ground_truth_unresolved' message.
--    b. opener_prepped required (always — even par-null items).
--       Throws sqlstate P0001 with 'opener_prepped_missing'.
--    c. Reason capture if delta != 0:
--       - delta > 0: overPar must be populated (throws 'over_par_reason_missing')
--       - delta < 0: underPar must be populated (throws 'under_par_reason_missing')
--       Skipped when prep_need is NULL (par-null items can't compute delta).
--
-- 5. prep_data JSONB invariant (§8.4 lock):
--    Every Phase 2 completion's prep_data MUST contain:
--      phase=2, closer_count, ground_truth_count, opener_prepped, prep_need,
--      delta_vs_prep_need, over_under_status (one of three enum values).
--    Plus: spot_check_status, opener_recount (nullable), over_under_reason_*
--    (nullable), directed_by (nullable). Even on the section-verified happy
--    path (closer_count == ground_truth_count, delta = 0), all six core
--    fields persist. Future closer-accuracy view materializes from this
--    shape with no backfill.
--
-- 6. Notification dispatch (per Concern 2 lock):
--    Under-prep notification fires N-per-item (one notification per item
--    where delta_vs_prep_need < 0). Recipients = KH+ at this location +
--    MoO + Owner DISTINCT (preserved from 0050). Trigger condition shifts
--    from delta_vs_par to delta_vs_prep_need.
--
-- 7. Section verifications population (per C.50 §4 step 7):
--    For each (sectionKey, verified=true) entry in p_section_verifications,
--    INSERT one row to opening_section_verifications. Append-only — no
--    UNIQUE constraint on (instance, sectionKey); multi-toggle in client
--    state collapsed to final-state at submit per Phase 3 form contract.
--
-- 8. Result jsonb extended:
--    Adds phase2Count + sectionVerifyCount + recountCount + atParCount +
--    overPrepCount + underPrepCount fields. JS-side opening.submit audit
--    consumes these.
--
-- 9. Update path (C.46 chain edit) — same gate logic; same prep_data
--    invariant; section verifications NOT re-inserted (chain edits don't
--    re-do section verification — operator's section-verify state at the
--    original submission moment stands; chain edit only updates per-item
--    values). NO under-prep notification re-emission on update path
--    (preserved from 0050: original-submission notification is canonical).

-- ─────────────────────────────────────────────────────────────────────────────
-- DROP OLD FUNCTION (signature change requires DROP + CREATE)
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.submit_opening_atomic(
  uuid, uuid, jsonb, uuid, boolean, uuid, jsonb, text, text
);

-- ─────────────────────────────────────────────────────────────────────────────
-- CREATE NEW FUNCTION (C.50 redesign)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE FUNCTION public.submit_opening_atomic(
  p_opening_instance_id uuid,
  p_actor_id uuid,
  p_entries jsonb,
  p_closing_report_ref_item_id uuid,
  p_is_update boolean DEFAULT false,
  p_original_submission_id uuid DEFAULT NULL,
  p_changed_fields jsonb DEFAULT NULL,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_section_verifications jsonb DEFAULT NULL
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

  -- C.50 server-side compute locals
  v_template_item_id uuid;
  v_section_key text;
  v_section_verified boolean;
  v_opener_recount numeric;
  v_opener_prepped numeric;
  v_closer_count numeric;
  v_par_value numeric;
  v_ground_truth_count numeric;
  v_prep_need numeric;
  v_delta numeric;
  v_over_under_status text;
  v_spot_check_status text;
  v_section_by_item_id jsonb;
  v_verified_sections text[] := ARRAY[]::text[];
  v_section_ver jsonb;

  -- C.50 prep_data construction locals
  v_over_par jsonb;
  v_over_under_reason_category text;
  v_over_under_reason_text text;
  v_directed_by uuid;
  v_prep_data_phase2 jsonb;

  -- Result counters
  v_phase2_count int := 0;
  v_section_verify_count int := 0;
  v_recount_count int := 0;
  v_at_par_count int := 0;
  v_over_prep_count int := 0;
  v_under_prep_count int := 0;
BEGIN
  -- Pre-load context: location_id + opening_date + location_code + actor_name.
  -- Used by notification emission AND audit metadata. Single query per submit.
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

  -- Pre-load section assignments for all Phase 2 template items in p_entries
  -- into a JSONB lookup map: { template_item_id::text -> section_key }. Used
  -- per-entry to determine if the entry's section is in the verified set.
  -- One query instead of N — manageable for current scale (~34 Phase 2 items).
  SELECT jsonb_object_agg(cti.id::text, cti.prep_meta->>'section')
  INTO v_section_by_item_id
  FROM checklist_template_items cti
  WHERE cti.id IN (
    SELECT (entry->>'templateItemId')::uuid
    FROM jsonb_array_elements(p_entries) entry
    WHERE entry->>'phase' = 'phase2'
  );

  -- Pre-extract verified section keys from p_section_verifications into a
  -- text[] for O(1) membership checks via ANY(). Empty array when no
  -- sections verified (legitimate state per Concern 3 matrix when all items
  -- individually recounted).
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
    -- ================================================================
    -- ORIGINAL-SUBMISSION PATH
    -- ================================================================

    -- 1. Insert one checklist_completion per entry; dispatch on phase.
    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
    LOOP
      v_phase := COALESCE(v_entry->>'phase', 'phase1');

      IF v_phase = 'phase1' THEN
        -- Phase 1 (unchanged from 0050): top-level count_value/photo_id/notes
        v_count_value := NULLIF(v_entry->>'countValue', '')::numeric;
        v_photo_id := NULLIF(v_entry->>'photoId', '')::uuid;
        v_notes := NULLIF(v_entry->>'notes', '');

        INSERT INTO checklist_completions (
          instance_id, template_item_id, completed_by, completed_at,
          count_value, photo_id, notes
        )
        VALUES (
          p_opening_instance_id,
          (v_entry->>'templateItemId')::uuid,
          p_actor_id, v_submitted_at,
          v_count_value, v_photo_id, v_notes
        )
        RETURNING id INTO v_completion_id;

      ELSIF v_phase = 'phase2' THEN
        -- ============================================================
        -- C.50 PHASE 2 — server-side compute + validation + invariant
        -- ============================================================
        v_phase2_data := v_entry->'phase2';
        IF v_phase2_data IS NULL OR v_phase2_data = 'null'::jsonb THEN
          RAISE EXCEPTION 'submit_opening_atomic: phase=phase2 entry % missing phase2 sub-object',
            v_entry->>'templateItemId'
            USING ERRCODE = 'check_violation';
        END IF;

        v_template_item_id := (v_entry->>'templateItemId')::uuid;
        v_phase2_count := v_phase2_count + 1;

        -- Determine section + verification state
        v_section_key := v_section_by_item_id->>(v_template_item_id::text);
        v_section_verified := v_section_key IS NOT NULL
          AND v_section_key = ANY(v_verified_sections);

        -- Read snapshot (frozen at instance create per migration 0051)
        SELECT closer_count, par_value
        INTO v_closer_count, v_par_value
        FROM opening_closer_count_snapshots
        WHERE opening_instance_id = p_opening_instance_id
          AND template_item_id = v_template_item_id;

        -- Item label (used for label-bearing error messages + notification body)
        SELECT label INTO v_item_label
        FROM checklist_template_items
        WHERE id = v_template_item_id;

        -- Extract opener inputs
        v_opener_recount := CASE
          WHEN v_phase2_data->>'openerRecount' IS NULL THEN NULL
          ELSE NULLIF(v_phase2_data->>'openerRecount', '')::numeric
        END;
        v_opener_prepped := NULLIF(v_phase2_data->>'openerPrepped', '')::numeric;

        IF v_opener_recount IS NOT NULL THEN
          v_recount_count := v_recount_count + 1;
        END IF;

        -- Gate 1: ground_truth resolved (section verified OR opener_recount populated)
        IF v_opener_recount IS NULL AND NOT v_section_verified THEN
          RAISE EXCEPTION 'submit_opening_atomic: ground_truth_unresolved for item % (% / section_key=%) — section not verified AND opener_recount NULL',
            v_template_item_id, v_item_label, COALESCE(v_section_key, '<no_section>')
            USING ERRCODE = 'P0001';
        END IF;

        -- Gate 2: opener_prepped required (always)
        IF v_opener_prepped IS NULL THEN
          RAISE EXCEPTION 'submit_opening_atomic: opener_prepped_missing for item % (%)',
            v_template_item_id, v_item_label
            USING ERRCODE = 'P0001';
        END IF;

        -- Compute ground_truth_count: opener_recount IF NOT NULL ELSE closer_count
        v_ground_truth_count := COALESCE(v_opener_recount, v_closer_count);

        -- Defensive: if both null (snapshot absent + no recount + somehow
        -- section verified — shouldn't happen per Gate 1), fail explicitly
        IF v_ground_truth_count IS NULL THEN
          RAISE EXCEPTION 'submit_opening_atomic: ground_truth_unresolved for item % (%) — closer_count NULL AND opener_recount NULL despite gate-pass',
            v_template_item_id, v_item_label
            USING ERRCODE = 'P0001';
        END IF;

        -- Compute prep_need: MAX(0, par - ground_truth). NULL when par_value NULL
        -- (par-null items like Tomato per design — no prep_need; no delta).
        v_prep_need := CASE
          WHEN v_par_value IS NOT NULL
            THEN GREATEST(0, v_par_value - v_ground_truth_count)
          ELSE NULL
        END;

        -- Compute delta_vs_prep_need
        v_delta := CASE
          WHEN v_prep_need IS NOT NULL THEN v_opener_prepped - v_prep_need
          ELSE NULL
        END;

        -- Determine over_under_status
        v_over_under_status := CASE
          WHEN v_delta IS NULL THEN 'at_par'  -- par-null items default to at_par
          WHEN v_delta = 0 THEN 'at_par'
          WHEN v_delta > 0 THEN 'over_prep'
          ELSE 'under_prep'
        END;

        -- Update result counters
        IF v_over_under_status = 'at_par' THEN
          v_at_par_count := v_at_par_count + 1;
        ELSIF v_over_under_status = 'over_prep' THEN
          v_over_prep_count := v_over_prep_count + 1;
        ELSE
          v_under_prep_count := v_under_prep_count + 1;
        END IF;

        -- Determine spot_check_status
        v_spot_check_status := CASE
          WHEN v_opener_recount IS NOT NULL THEN 'flagged_recount'
          ELSE 'matched_via_section_verify'
        END;

        -- Gate 3: reason capture if delta != 0 (only when prep_need computable)
        v_over_par := v_phase2_data->'overPar';
        v_under_par := v_phase2_data->'underPar';

        IF v_prep_need IS NOT NULL AND v_delta IS DISTINCT FROM 0 THEN
          IF v_delta > 0 AND (v_over_par IS NULL OR v_over_par = 'null'::jsonb) THEN
            RAISE EXCEPTION 'submit_opening_atomic: over_par_reason_missing for item % (%) — delta=% > 0 requires overPar capture',
              v_template_item_id, v_item_label, v_delta
              USING ERRCODE = 'P0001';
          END IF;
          IF v_delta < 0 AND (v_under_par IS NULL OR v_under_par = 'null'::jsonb) THEN
            RAISE EXCEPTION 'submit_opening_atomic: under_par_reason_missing for item % (%) — delta=% < 0 requires underPar capture',
              v_template_item_id, v_item_label, v_delta
              USING ERRCODE = 'P0001';
          END IF;
        END IF;

        -- Extract reason fields for prep_data (collapsed regardless of source)
        IF v_over_par IS NOT NULL AND v_over_par <> 'null'::jsonb THEN
          v_over_under_reason_category := v_over_par->>'reasonCategory';
          v_over_under_reason_text := v_over_par->>'freeText';
          v_directed_by := NULLIF(v_over_par->>'directedBy', '')::uuid;
        ELSIF v_under_par IS NOT NULL AND v_under_par <> 'null'::jsonb THEN
          v_over_under_reason_category := v_under_par->>'reasonCategory';
          v_over_under_reason_text := v_under_par->>'freeText';
          v_directed_by := NULL;  -- under-prep doesn't carry directed_by
        ELSE
          v_over_under_reason_category := NULL;
          v_over_under_reason_text := NULL;
          v_directed_by := NULL;
        END IF;

        -- Build prep_data JSONB per §8.4 invariant. All 6 core fields present
        -- regardless of path (section-verified happy path included).
        v_prep_data_phase2 := jsonb_build_object(
          'phase', 2,
          'closer_count', v_closer_count,
          'spot_check_status', v_spot_check_status,
          'opener_recount', v_opener_recount,
          'ground_truth_count', v_ground_truth_count,
          'prep_need', v_prep_need,
          'opener_prepped', v_opener_prepped,
          'delta_vs_prep_need', v_delta,
          'over_under_status', v_over_under_status,
          'over_under_reason_category', v_over_under_reason_category,
          'over_under_reason_text', v_over_under_reason_text,
          'directed_by', v_directed_by
        );

        INSERT INTO checklist_completions (
          instance_id, template_item_id, completed_by, completed_at,
          count_value, photo_id, notes, prep_data
        )
        VALUES (
          p_opening_instance_id, v_template_item_id, p_actor_id, v_submitted_at,
          NULL, NULL, NULL,
          jsonb_build_object('phase2', v_prep_data_phase2)
        )
        RETURNING id INTO v_completion_id;

        -- Under-prep notification dispatch — N-per-item per Concern 2 lock.
        -- Trigger condition shifted from delta_vs_par < 0 to delta_vs_prep_need < 0.
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
              'titleParams', jsonb_build_object(
                'itemName', v_item_label,
                'locationCode', v_location_code
              ),
              'bodyKey', 'notifications.under_par_alert.body',
              'bodyParams', jsonb_build_object(
                'openerName', v_actor_name,
                'itemName', v_item_label,
                'prepped', v_opener_prepped,
                'par', v_par_value,
                'closer', v_closer_count,
                'reasonCategory', v_over_under_reason_category,
                'freeText', COALESCE(v_over_under_reason_text, '')
              ),
              'itemName', v_item_label,
              'templateItemId', v_template_item_id::text,
              'completionId', v_completion_id::text,
              'instanceId', p_opening_instance_id::text,
              'openingDate', v_opening_date::text,
              'parValue', v_par_value,
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

          -- Recipients: KH+ at this location + MoO + Owner DISTINCT (preserved
          -- pattern from 0050; no logic change).
          INSERT INTO notification_recipients (
            notification_id, user_id, delivery_method, delivery_status
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

    -- 2. Insert section verifications. One row per (sectionKey, verified=true)
    -- entry per C.50 §4 step 7. Append-only — no UNIQUE constraint on
    -- (instance, sectionKey).
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
          v_section_verify_count := v_section_verify_count + 1;
        END IF;
      END LOOP;
    END IF;

    -- 3. Insert checklist_submissions row.
    INSERT INTO checklist_submissions (
      instance_id, submitted_by, submitted_at, completion_ids, is_final_confirmation
    )
    VALUES (
      p_opening_instance_id, p_actor_id, v_submitted_at, v_completion_ids, true
    )
    RETURNING id INTO v_submission_id;

    -- 4. Pessimistic transition opening instance → confirmed.
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

    -- 5. Auto-complete the closing's "Opening verified" item if one exists.
    -- Logic preserved from 0050 — no C.50 changes here.
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
        instance_id, template_item_id, completed_by, completed_at, auto_complete_meta
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
    -- UPDATE PATH (C.46 chain edit) — chained attribution; cap-checked
    -- C.50 server-side compute applied to Phase 2 entries; section
    -- verifications NOT re-inserted (chain edit doesn't re-do section-
    -- verify). NO under-prep notification re-emission on update path.
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

    -- Insert new completions, dispatching on phase. C.50 server-side compute
    -- applied to Phase 2 entries (same logic as original-submission path).
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
          instance_id, template_item_id, completed_by, completed_at,
          count_value, photo_id, notes,
          original_completion_id, edit_count
        )
        VALUES (
          p_opening_instance_id, (v_entry->>'templateItemId')::uuid,
          p_actor_id, v_submitted_at,
          v_count_value, v_photo_id, v_notes,
          v_original_completion_id, v_new_edit_count
        )
        RETURNING id INTO v_completion_id;

      ELSIF v_phase = 'phase2' THEN
        -- Apply same C.50 server-side compute as original-submission path.
        v_phase2_data := v_entry->'phase2';
        IF v_phase2_data IS NULL OR v_phase2_data = 'null'::jsonb THEN
          RAISE EXCEPTION 'submit_opening_atomic: phase=phase2 entry % missing phase2 sub-object (update path)',
            v_entry->>'templateItemId'
            USING ERRCODE = 'check_violation';
        END IF;

        v_template_item_id := (v_entry->>'templateItemId')::uuid;
        v_phase2_count := v_phase2_count + 1;

        v_section_key := v_section_by_item_id->>(v_template_item_id::text);
        v_section_verified := v_section_key IS NOT NULL
          AND v_section_key = ANY(v_verified_sections);

        SELECT closer_count, par_value
        INTO v_closer_count, v_par_value
        FROM opening_closer_count_snapshots
        WHERE opening_instance_id = p_opening_instance_id
          AND template_item_id = v_template_item_id;

        SELECT label INTO v_item_label
        FROM checklist_template_items
        WHERE id = v_template_item_id;

        v_opener_recount := CASE
          WHEN v_phase2_data->>'openerRecount' IS NULL THEN NULL
          ELSE NULLIF(v_phase2_data->>'openerRecount', '')::numeric
        END;
        v_opener_prepped := NULLIF(v_phase2_data->>'openerPrepped', '')::numeric;

        IF v_opener_recount IS NOT NULL THEN
          v_recount_count := v_recount_count + 1;
        END IF;

        IF v_opener_recount IS NULL AND NOT v_section_verified THEN
          RAISE EXCEPTION 'submit_opening_atomic: ground_truth_unresolved for item % (% / section_key=%) — section not verified AND opener_recount NULL (update path)',
            v_template_item_id, v_item_label, COALESCE(v_section_key, '<no_section>')
            USING ERRCODE = 'P0001';
        END IF;
        IF v_opener_prepped IS NULL THEN
          RAISE EXCEPTION 'submit_opening_atomic: opener_prepped_missing for item % (%) (update path)',
            v_template_item_id, v_item_label
            USING ERRCODE = 'P0001';
        END IF;

        v_ground_truth_count := COALESCE(v_opener_recount, v_closer_count);
        IF v_ground_truth_count IS NULL THEN
          RAISE EXCEPTION 'submit_opening_atomic: ground_truth_unresolved for item % (%) (update path) — closer_count NULL AND opener_recount NULL despite gate-pass',
            v_template_item_id, v_item_label
            USING ERRCODE = 'P0001';
        END IF;

        v_prep_need := CASE
          WHEN v_par_value IS NOT NULL THEN GREATEST(0, v_par_value - v_ground_truth_count)
          ELSE NULL
        END;
        v_delta := CASE
          WHEN v_prep_need IS NOT NULL THEN v_opener_prepped - v_prep_need
          ELSE NULL
        END;
        v_over_under_status := CASE
          WHEN v_delta IS NULL THEN 'at_par'
          WHEN v_delta = 0 THEN 'at_par'
          WHEN v_delta > 0 THEN 'over_prep'
          ELSE 'under_prep'
        END;

        IF v_over_under_status = 'at_par' THEN
          v_at_par_count := v_at_par_count + 1;
        ELSIF v_over_under_status = 'over_prep' THEN
          v_over_prep_count := v_over_prep_count + 1;
        ELSE
          v_under_prep_count := v_under_prep_count + 1;
        END IF;

        v_spot_check_status := CASE
          WHEN v_opener_recount IS NOT NULL THEN 'flagged_recount'
          ELSE 'matched_via_section_verify'
        END;

        v_over_par := v_phase2_data->'overPar';
        v_under_par := v_phase2_data->'underPar';

        IF v_prep_need IS NOT NULL AND v_delta IS DISTINCT FROM 0 THEN
          IF v_delta > 0 AND (v_over_par IS NULL OR v_over_par = 'null'::jsonb) THEN
            RAISE EXCEPTION 'submit_opening_atomic: over_par_reason_missing for item % (%) (update path) — delta=% > 0',
              v_template_item_id, v_item_label, v_delta
              USING ERRCODE = 'P0001';
          END IF;
          IF v_delta < 0 AND (v_under_par IS NULL OR v_under_par = 'null'::jsonb) THEN
            RAISE EXCEPTION 'submit_opening_atomic: under_par_reason_missing for item % (%) (update path) — delta=% < 0',
              v_template_item_id, v_item_label, v_delta
              USING ERRCODE = 'P0001';
          END IF;
        END IF;

        IF v_over_par IS NOT NULL AND v_over_par <> 'null'::jsonb THEN
          v_over_under_reason_category := v_over_par->>'reasonCategory';
          v_over_under_reason_text := v_over_par->>'freeText';
          v_directed_by := NULLIF(v_over_par->>'directedBy', '')::uuid;
        ELSIF v_under_par IS NOT NULL AND v_under_par <> 'null'::jsonb THEN
          v_over_under_reason_category := v_under_par->>'reasonCategory';
          v_over_under_reason_text := v_under_par->>'freeText';
          v_directed_by := NULL;
        ELSE
          v_over_under_reason_category := NULL;
          v_over_under_reason_text := NULL;
          v_directed_by := NULL;
        END IF;

        v_prep_data_phase2 := jsonb_build_object(
          'phase', 2,
          'closer_count', v_closer_count,
          'spot_check_status', v_spot_check_status,
          'opener_recount', v_opener_recount,
          'ground_truth_count', v_ground_truth_count,
          'prep_need', v_prep_need,
          'opener_prepped', v_opener_prepped,
          'delta_vs_prep_need', v_delta,
          'over_under_status', v_over_under_status,
          'over_under_reason_category', v_over_under_reason_category,
          'over_under_reason_text', v_over_under_reason_text,
          'directed_by', v_directed_by
        );

        INSERT INTO checklist_completions (
          instance_id, template_item_id, completed_by, completed_at,
          count_value, photo_id, notes, prep_data,
          original_completion_id, edit_count
        )
        VALUES (
          p_opening_instance_id, v_template_item_id, p_actor_id, v_submitted_at,
          NULL, NULL, NULL,
          jsonb_build_object('phase2', v_prep_data_phase2),
          v_original_completion_id, v_new_edit_count
        )
        RETURNING id INTO v_completion_id;
        -- NO notification emission on update path (preserved from 0050).

      ELSE
        RAISE EXCEPTION 'submit_opening_atomic: unknown phase "%" in update entry %',
          v_phase, v_entry->>'templateItemId'
          USING ERRCODE = 'check_violation';
      END IF;

      v_completion_ids := array_append(v_completion_ids, v_completion_id);
    END LOOP;

    -- Section verifications NOT re-inserted on update path. Original
    -- submission's section_verifications stand as the operator's verify
    -- state at the original submission moment.

    INSERT INTO checklist_submissions (
      instance_id, submitted_by, submitted_at, completion_ids,
      is_final_confirmation, original_submission_id, edit_count
    )
    VALUES (
      p_opening_instance_id, p_actor_id, v_submitted_at, v_completion_ids,
      true, p_original_submission_id, v_new_edit_count
    )
    RETURNING id INTO v_submission_id;

    -- C.46 update audit row — preserved from 0050.
    INSERT INTO audit_log (
      actor_id, action, resource_table, resource_id, metadata, destructive
    )
    VALUES (
      p_actor_id, 'report.update', 'checklist_submissions', v_submission_id,
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

  -- Result jsonb extended with C.50 counters. JS-side opening.submit audit
  -- consumes these for forensic metadata.
  RETURN jsonb_build_object(
    'instance', v_opening_instance_row,
    'submissionId', v_submission_id,
    'completionIds', to_jsonb(v_completion_ids),
    'autoCompleteId', v_auto_complete_id,
    'editCount', CASE WHEN p_is_update THEN v_new_edit_count ELSE 0 END,
    'originalSubmissionId', CASE WHEN p_is_update THEN p_original_submission_id ELSE NULL END,
    'underParNotificationIds', to_jsonb(v_notif_ids),
    'phase2Count', v_phase2_count,
    'sectionVerifyCount', v_section_verify_count,
    'recountCount', v_recount_count,
    'atParCount', v_at_par_count,
    'overPrepCount', v_over_prep_count,
    'underPrepCount', v_under_prep_count
  );
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Re-grant invocation surface (DROP + CREATE clears grants; re-apply per
-- AGENTS.md "REVOKE EXECUTE FROM PUBLIC is not enough" lesson).
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.submit_opening_atomic(
  uuid, uuid, jsonb, uuid, boolean, uuid, jsonb, text, text, jsonb
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.submit_opening_atomic(
  uuid, uuid, jsonb, uuid, boolean, uuid, jsonb, text, text, jsonb
) FROM anon;

REVOKE EXECUTE ON FUNCTION public.submit_opening_atomic(
  uuid, uuid, jsonb, uuid, boolean, uuid, jsonb, text, text, jsonb
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.submit_opening_atomic(
  uuid, uuid, jsonb, uuid, boolean, uuid, jsonb, text, text, jsonb
) TO service_role;
