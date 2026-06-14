-- Migration 0061_create_save_mid_day_phase2_item_rpc
-- Applied via Supabase MCP apply_migration on 2026-06-14.
-- Canonical reference: lib/prep.ts saveMidDayPhase2Item; C.43 spec §1 (Phase 2).
--
-- Mid-day Phase 2 collaborative per-item save. Append-only: each save inserts a
-- NEW completion (carrying the item's Phase-1 onHand forward, setting inputs.total
-- = prepped amount, completed_by = the saver) and supersedes the prior live
-- completion for that item. Multi-author, realtime-lite (reconcile on load).
-- Window-gated: the instance must be in phase1_complete.

CREATE OR REPLACE FUNCTION public.save_mid_day_phase2_item_atomic(
  p_instance_id uuid,
  p_template_item_id uuid,
  p_actor_id uuid,
  p_prepped numeric,
  p_snapshot jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_prior_id uuid;
  v_prior_inputs jsonb;
  v_new_id uuid;
  v_saved_at timestamptz := now();
BEGIN
  PERFORM 1 FROM checklist_instances
  WHERE id = p_instance_id AND status = 'phase1_complete';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'save_mid_day_phase2_item_atomic: instance % not in phase1_complete', p_instance_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT id, prep_data->'inputs'
  INTO v_prior_id, v_prior_inputs
  FROM checklist_completions
  WHERE instance_id = p_instance_id
    AND template_item_id = p_template_item_id
    AND superseded_at IS NULL
    AND revoked_at IS NULL
  ORDER BY completed_at DESC
  LIMIT 1;

  INSERT INTO checklist_completions (
    instance_id, template_item_id, completed_by, completed_at, prep_data
  )
  VALUES (
    p_instance_id,
    p_template_item_id,
    p_actor_id,
    v_saved_at,
    jsonb_build_object(
      'inputs', COALESCE(v_prior_inputs, '{}'::jsonb) || jsonb_build_object('total', p_prepped),
      'snapshot', p_snapshot
    )
  )
  RETURNING id INTO v_new_id;

  IF v_prior_id IS NOT NULL THEN
    UPDATE checklist_completions
    SET superseded_at = v_saved_at, superseded_by = v_new_id
    WHERE id = v_prior_id;
  END IF;

  RETURN jsonb_build_object('completionId', v_new_id, 'savedAt', to_jsonb(v_saved_at));
END;
$function$;
