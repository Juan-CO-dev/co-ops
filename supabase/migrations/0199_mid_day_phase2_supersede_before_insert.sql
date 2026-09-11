-- Migration 0199_mid_day_phase2_supersede_before_insert
-- Applied via Supabase MCP 2026-09-10 (sim first, prod on Juan's word). Provenance: LRA Wave A, row LRA-215 (Astra D4 sweep 9, CC-verified).
--
-- WHAT: redefine save_mid_day_phase2_item_atomic (last defined by 0064) so the prior live row is superseded BEFORE the
-- replacement is inserted. Signature, checks, payload shape and the superseded_by provenance link are unchanged.
--
-- WHY: 0196 (2026-09-09) made checklist_completions_one_live_head_per_phase UNIQUE (instance_id, template_item_id,
-- coalesce(prep_data ? 'phase2', false)) over live rows. Mid-day prep_data carries no 'phase2' key, so the prior live row
-- and its replacement share the key (instance, item, false); 0064 inserted first and superseded after, which is a 23505
-- on every SECOND save of the same mid-day item — a correction after a wrong number, a re-entry — and lib/prep.ts maps
-- only 23514, so the operator saw a raw failure. Opening's save_phase2_item_atomic (0056) supersedes first; this is the
-- sibling asymmetry the 09-01 audit named, on the surface Gate 1 did not walk. Live on prod from 0196's apply until 0199.
--
-- VERIFY AFTER APPLY: in a transaction on a phase1_complete mid-day instance, call the RPC twice for one item and expect
-- two rows — the first superseded_at/superseded_by set, the second live — then ROLLBACK. The unit spine pins the order
-- (tests/mid-day-phase2-supersede-first.test.ts).
--
-- Rollback: re-apply 0064's body — which re-opens LRA-215; prefer fixing forward.

CREATE OR REPLACE FUNCTION public.save_mid_day_phase2_item_atomic(
  p_instance_id uuid,
  p_template_item_id uuid,
  p_actor_id uuid,
  p_prepped numeric,
  p_snapshot jsonb,
  p_over_under jsonb DEFAULT NULL
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

  -- 0199 (LRA-215): SUPERSEDE FIRST, INSERT SECOND. Under the 0196 live-head index
  -- (instance, item, coalesce(prep_data ? 'phase2', false)) WHERE live, mid-day rows share
  -- the key `false`, so inserting the replacement while the prior row is still live is a
  -- 23505 on every second save of the same item. Mirror of opening's 0056 order.
  IF v_prior_id IS NOT NULL THEN
    UPDATE checklist_completions
    SET superseded_at = v_saved_at
    WHERE id = v_prior_id
      AND superseded_at IS NULL
      AND revoked_at IS NULL;
  END IF;

  INSERT INTO checklist_completions (
    instance_id, template_item_id, completed_by, completed_at, prep_data
  )
  VALUES (
    p_instance_id,
    p_template_item_id,
    p_actor_id,
    v_saved_at,
    jsonb_build_object(
      'inputs', (COALESCE(v_prior_inputs, '{}'::jsonb) - 'freeText') || jsonb_build_object('total', p_prepped),
      'snapshot', p_snapshot,
      'overUnder', p_over_under
    )
  )
  RETURNING id INTO v_new_id;

  -- Keep the 0064 provenance link now that the replacement's id exists.
  IF v_prior_id IS NOT NULL THEN
    UPDATE checklist_completions
    SET superseded_by = v_new_id
    WHERE id = v_prior_id;
  END IF;

  RETURN jsonb_build_object('completionId', v_new_id, 'savedAt', to_jsonb(v_saved_at));
END;
$function$;
