-- Migration 0060_create_submit_mid_day_phase1_atomic_rpc
-- Applied via Supabase MCP apply_migration on 2026-06-14.
-- Canonical reference: lib/prep.ts submitMidDayPhase1; C.43 spec §1 (two-phase).
--
-- Mid-day prep Phase 1 (count → back-to-par need). Lean cousin of
-- submit_am_prep_atomic's original-submission path: insert one completion per
-- counted item (prep_data = {inputs, snapshot}), insert a non-final submission,
-- and pessimistically transition the instance open → phase1_complete. NO closing
-- auto-complete, NO C.46 edit-chains (Phase 1 is single-submit). Column shapes
-- mirror submit_am_prep_atomic verbatim (verified via pg_get_functiondef 0044).

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
BEGIN
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
  LOOP
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
