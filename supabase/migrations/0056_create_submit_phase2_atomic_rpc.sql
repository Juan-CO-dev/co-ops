-- Migration 0056_create_submit_phase2_atomic_rpc
-- Applied via Supabase MCP apply_migration on 2026-05-31 (after Juan first-eyes
-- clearance + plpgsql BEGIN/ROLLBACK dry-run GREEN + both code gates pass).
-- Canonical reference: lib/opening.ts savePhase2Item + submitPhase2Atomic;
--   AGENTS.md "preserved-from-prior logic must be re-verified" (C.54 §9 / d49d1504).
--
-- Canonical references:
--   - Build doc v2.2: docs/coops_C53-C54_phase2_builddoc_v2.md (Model Y universe;
--     §8.4 14-field contract = 12 core + 2 provenance; SPLIT: per-item save is the
--     §8.4 write path, submit_phase2_atomic is finalize-ONLY; NO auto-complete)
--   - docs/SPEC_AMENDMENTS.md C.53 §3 (1959-1997 Phase 2 prep_data shape — 14 fields
--     incl. saved_at/saved_by; 2173 "Phase 2 dispatch only; spot-check done in Phase 1"),
--     C.50 §8.4 invariant, C.54 §2.A (NO opening→closing auto-complete; Phase 3 owns it)
--   - Migration 0053:319-401 — the C.50 compute + §8.4 12-core jsonb (shape source);
--     0053:539-584 auto-complete branch is DELIBERATELY NOT inherited (Discipline 1)
--   - Migration 0055:388-397 — the 8-key prep_data->phase1 read contract this RPC sources
--   - lib/types.ts:832 OpeningEntryPhase2 (wire contract); :323 OpeningPhase2Meta (parValue)
--   - lib/opening.ts:358 OpeningPhase2NotEligibleError (REUSED; not recreated),
--     :1568 Phase1RpcResult (Phase2RpcResult mirror target)
--
-- AGENTS.md durable lessons applied:
--   - "Preserved-from-prior logic must be re-verified" — this RPC does NOT carry 0053's
--     auto-complete branch; it was the C.54 §9 (d49d1504) bug site. Discipline 1 enforces.
--   - "RPC-side audit_log INSERTs must mirror the actual column shape" — no RPC-side
--     original-path audit here (fires JS-side in lib per 0055 convention); any future
--     RPC-side audit puts ip/ua INSIDE metadata jsonb.
--   - "RLS helper functions must be SECURITY DEFINER with locked search_path" — applied.
--   - "REVOKE EXECUTE FROM PUBLIC is not enough" — explicit REVOKE anon/authenticated.
--
-- WHAT THIS MIGRATION DOES
--   (A.0) opening_phase2_compute_delta — single-source delta/over_under_status derivation.
--   (A.5 SQL) save_phase2_item_atomic — the §8.4 14-field WRITE for one prep item.
--   (A.1) submit_phase2_atomic — FINALIZE-ONLY: read-back, completeness validation over
--         the Model Y universe, authoritative recompute via the shared helper, under-prep
--         notification dispatch, phase1_complete → phase2_complete transition.
--
-- WHAT THIS MIGRATION INTENTIONALLY DOES NOT DO
--   (a) NO opening→closing auto-complete (C.54 §2.A — Phase 3 owns it). The 0053
--       auto-complete branch is NOT inherited. Discipline-check (A.6) blocks its symbols.
--   (b) submit_phase2_atomic does NOT write per-item §8.4 (SPLIT — that's save_phase2_item
--       _atomic). No p_is_final dual-mode flag.
--   (c) NO RPC-side original-path audit (fires JS-side in lib/opening.ts).
--
-- DESIGN DECISIONS (Juan-ruled at first-eyes 2026-05-30 — all CONFIRMED):
--   [D1] Per-item save = supersede-then-INSERT (append-only). Each save is a new
--        immutable row; prior live phase2 row for the item is superseded. Preserves
--        the saved_at/saved_by provenance chain across saves (who touched the item).
--        claim(POST)-vs-save(PUT) split is a Commit-B endpoint concern; here
--        completed_by stakes ownership at save time.
--   [D2] count_provenance MIRRORED from the item's phase1 completion (NOT hardcoded
--        'closer_captured' — that lies on opener-recount/NULL-source items). Phase 1
--        established true provenance; Phase 2 preps the same count, carries it forward.
--   [D3] Finalize chain-edit (p_is_update) DEFERRED — is_update raises a typed inert
--        error (no UI trigger), mirroring how Phase 1 chain-edit sits dormant in 0055.
--        C.46 Phase 2 re-finalize is undesigned scope; recorded in the deferral log.
--   [D4] Finalize re-sources prep_need/ground_truth_count/closer_count from the FROZEN
--        prep_data->phase1 contract and recomputes delta authoritatively via the shared
--        helper — does NOT trust the values mirrored onto the phase2 row at save (those
--        are UX convenience). Save-time and finalize values agree by design.

-- ─────────────────────────────────────────────────────────────────────────────
-- A.0 — SHARED DELTA HELPER (single source of truth — Juan ruling 1)
-- ─────────────────────────────────────────────────────────────────────────────
-- Derivation lifted verbatim from 0053:326-337. Both save_phase2_item_atomic
-- AND submit_phase2_atomic call this — the arithmetic exists in exactly one
-- place so the per-item write and finalize cannot silently diverge.
CREATE OR REPLACE FUNCTION public.opening_phase2_compute_delta(
  p_opener_prepped numeric,
  p_prep_need numeric
)
RETURNS TABLE (delta numeric, over_under_status text)
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT
    -- delta NULL when prep_need is NULL (par-null items have no delta semantic)
    CASE WHEN p_prep_need IS NOT NULL THEN p_opener_prepped - p_prep_need ELSE NULL END
      AS delta,
    CASE
      WHEN p_prep_need IS NULL THEN 'at_par'   -- par-null items default at_par (0053:333)
      WHEN p_opener_prepped - p_prep_need = 0 THEN 'at_par'
      WHEN p_opener_prepped - p_prep_need > 0 THEN 'over_prep'
      ELSE 'under_prep'
    END AS over_under_status;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A.5 (SQL) — PER-ITEM §8.4 WRITE  (the §8.4 contract write — FIRST-EYES focus)
-- ─────────────────────────────────────────────────────────────────────────────
-- Writes ONE prep item's phase2 completion in the §8.4 14-field shape. Sources
-- ground_truth_count/prep_need from THIS item's own prep_data->phase1 (Model Y).
-- Computes delta/status via the shared A.0 helper. Append-only: supersedes any
-- prior live phase2 completion for the item, then INSERTs the new one. [D1]
CREATE OR REPLACE FUNCTION public.save_phase2_item_atomic(
  p_opening_instance_id uuid,
  p_actor_id uuid,
  p_template_item_id uuid,
  p_opener_prepped numeric,
  p_over_par jsonb DEFAULT NULL,
  p_under_par jsonb DEFAULT NULL,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
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
BEGIN
  -- ──── Eligibility: Phase 2 active only at phase1_complete (Question C) ────
  SELECT status INTO v_status FROM checklist_instances WHERE id = p_opening_instance_id;
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
    IF v_delta > 0 AND (p_over_par IS NULL OR p_over_par = 'null'::jsonb) THEN
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

  RETURN jsonb_build_object(
    'completion', v_completion_row,
    'templateItemId', p_template_item_id,
    'completionId', v_completion_id,
    'deltaVsPrepNeed', v_delta,
    'overUnderStatus', v_over_under_status
  );
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A.1 — FINALIZE  submit_phase2_atomic  (finalize-ONLY; reads phase2 rows back)
-- ─────────────────────────────────────────────────────────────────────────────
-- Validates the instance is at phase1_complete, that EVERY Model Y universe item
-- (= every openingPhase2 template item) has a live phase2 completion, recomputes
-- deltas authoritatively via the shared helper, dispatches under-prep notifications
-- per item (0053:414-485 pattern), advances phase1_complete → phase2_complete.
-- NO §8.4 write here. NO auto-complete (C.54 §2.A). NO p_is_final.
CREATE OR REPLACE FUNCTION public.submit_phase2_atomic(
  p_opening_instance_id uuid,
  p_actor_id uuid,
  p_is_update boolean DEFAULT false,
  p_original_submission_id uuid DEFAULT NULL,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
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
  UPDATE checklist_instances
  SET status = 'phase2_complete'
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

-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTS (SECURITY DEFINER lockdown — mirrors 0055 trailing block)
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.opening_phase2_compute_delta(numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.save_phase2_item_atomic(uuid, uuid, uuid, numeric, jsonb, jsonb, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_phase2_atomic(uuid, uuid, boolean, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.opening_phase2_compute_delta(numeric, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_phase2_item_atomic(uuid, uuid, uuid, numeric, jsonb, jsonb, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_phase2_atomic(uuid, uuid, boolean, uuid, text, text) TO service_role;
