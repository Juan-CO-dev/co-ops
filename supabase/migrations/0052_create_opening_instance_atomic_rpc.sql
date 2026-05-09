-- Migration 0052_create_opening_instance_atomic_rpc
-- Applied via Supabase MCP apply_migration on 2026-05-09.
-- Canonical reference: docs/SPEC_AMENDMENTS.md C.50 §2; lib/opening.ts
-- loadOpeningState (post-Step-11 atomic instance + snapshot creation).
--
-- Tightens loadOpeningState's instance + snapshot creation to a single
-- atomic transaction per Juan's Step 11 review-time concern (Confirm 2).
-- Without this RPC the JS-side flow does INSERT(instance) → INSERT(snapshots)
-- as two separate REST calls; if snapshot insert fails, instance row remains
-- as partial state (subsequent loads find instance via existing-fetch path
-- with wasCreated=false; snapshot materialization skipped; form Phase 2
-- broken).
--
-- This RPC commits both inserts in one transaction. Race-aware via
-- ON CONFLICT DO NOTHING on the instance INSERT; loser-path returns
-- was_created=false and skips snapshot insert.
--
-- Migration numbering note: this migration was originally planned as 0052
-- for the Step 13 submit_opening_atomic RPC rewrite. Step 11 review-time
-- tightening claimed 0052 first; planned Step 13 RPC rewrite is now 0053.
--
-- SECURITY DEFINER + locked search_path follows the AGENTS.md durable
-- lesson "RLS helper functions must be SECURITY DEFINER with locked
-- search_path." Function is grant-restricted to service_role exclusively
-- (caller is loadOpeningState via service-role client; never invoked from
-- user-facing code paths).

CREATE OR REPLACE FUNCTION create_opening_instance_atomic(
  p_template_id uuid,
  p_location_id uuid,
  p_date date,
  p_actor_user_id uuid,
  p_snapshots jsonb  -- array of {template_item_id, closing_instance_id?, closer_count?, par_value?, par_unit?}
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_instance_id uuid;
  v_existing_id uuid;
  v_trigger_ts timestamptz := NOW();
  v_snapshot jsonb;
  v_snapshot_count int := 0;
  v_with_count int := 0;
  v_closer_count_text text;
BEGIN
  -- Race-aware insert: try insert; on conflict (existing instance for this
  -- template+location+date) v_instance_id stays NULL and we follow the
  -- loser-path read below. Constraint name verified at apply time.
  INSERT INTO checklist_instances (
    template_id, location_id, date, shift_start_at, status,
    triggered_by_user_id, triggered_at
  )
  VALUES (
    p_template_id, p_location_id, p_date, v_trigger_ts, 'open',
    p_actor_user_id, v_trigger_ts
  )
  ON CONFLICT ON CONSTRAINT checklist_instances_template_id_location_id_date_key
    DO NOTHING
  RETURNING id INTO v_instance_id;

  IF v_instance_id IS NULL THEN
    -- Race-loss path: instance already exists; return it without snapshot
    -- insert. wasCreated=false signals to loadOpeningState that snapshot
    -- materialization should be skipped (winner already materialized OR
    -- instance pre-dates migration 0051).
    SELECT id INTO v_existing_id
    FROM checklist_instances
    WHERE template_id = p_template_id
      AND location_id = p_location_id
      AND date = p_date;

    IF v_existing_id IS NULL THEN
      RAISE EXCEPTION 'create_opening_instance_atomic: race re-read failed (instance constraint conflict but no row found)';
    END IF;

    RETURN jsonb_build_object(
      'instance_id', v_existing_id,
      'was_created', false
    );
  END IF;

  -- We won the create; insert snapshots in the same transaction. Atomicity
  -- guarantee: if any snapshot insert raises (FK violation, type mismatch,
  -- numeric overflow, etc.) the entire transaction rolls back including
  -- the instance insert. No partial state. This is the central reason for
  -- the RPC vs separate-REST-calls JS-side approach.
  IF p_snapshots IS NOT NULL AND jsonb_array_length(p_snapshots) > 0 THEN
    FOR v_snapshot IN SELECT * FROM jsonb_array_elements(p_snapshots)
    LOOP
      v_closer_count_text := v_snapshot->>'closer_count';
      INSERT INTO opening_closer_count_snapshots (
        opening_instance_id, template_item_id, closing_instance_id,
        closer_count, par_value, par_unit, snapshot_by
      )
      VALUES (
        v_instance_id,
        (v_snapshot->>'template_item_id')::uuid,
        NULLIF(v_snapshot->>'closing_instance_id', '')::uuid,
        NULLIF(v_closer_count_text, '')::numeric,
        NULLIF(v_snapshot->>'par_value', '')::numeric,
        v_snapshot->>'par_unit',
        p_actor_user_id
      );
      v_snapshot_count := v_snapshot_count + 1;
      IF v_closer_count_text IS NOT NULL AND v_closer_count_text != '' THEN
        v_with_count := v_with_count + 1;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'instance_id', v_instance_id,
    'was_created', true,
    'snapshot_count', v_snapshot_count,
    'with_closer_count', v_with_count,
    'without_closer_count', v_snapshot_count - v_with_count
  );
END;
$$;

-- Lock invocation surface to service_role. Per AGENTS.md durable lesson
-- "REVOKE EXECUTE ... FROM PUBLIC is not enough" — Supabase's default
-- schema ACLs explicitly grant EXECUTE to anon + authenticated +
-- service_role; REVOKE FROM PUBLIC doesn't strip those role grants. Need
-- per-role REVOKE for anon + authenticated, then explicit GRANT to
-- service_role for clarity.
REVOKE EXECUTE ON FUNCTION
  create_opening_instance_atomic(uuid, uuid, date, uuid, jsonb)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION
  create_opening_instance_atomic(uuid, uuid, date, uuid, jsonb)
  FROM anon;
REVOKE EXECUTE ON FUNCTION
  create_opening_instance_atomic(uuid, uuid, date, uuid, jsonb)
  FROM authenticated;
GRANT EXECUTE ON FUNCTION
  create_opening_instance_atomic(uuid, uuid, date, uuid, jsonb)
  TO service_role;
