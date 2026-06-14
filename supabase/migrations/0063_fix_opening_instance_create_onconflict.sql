-- Migration 0063_fix_opening_instance_create_onconflict
-- Applied via Supabase MCP apply_migration on 2026-06-14.
-- Canonical reference: lib/opening.ts loadOpeningState; fixes regression from 0059.
--
-- Migration 0059 (C.43) dropped the named UNIQUE constraint
-- checklist_instances_template_id_location_id_date_key and replaced it with a
-- partial unique index (checklist_instances_single_per_day_key, WHERE NOT
-- allows_multiple_per_day). create_opening_instance_atomic referenced the old
-- constraint by name in ON CONFLICT ON CONSTRAINT, so every opening instance
-- create threw "constraint ... does not exist". This repoints ON CONFLICT to the
-- partial index via column+predicate inference (opening instances are
-- single-per-day, so allows_multiple_per_day=false -> covered by the index).
-- Body otherwise identical to migration 0052.

CREATE OR REPLACE FUNCTION public.create_opening_instance_atomic(
  p_template_id uuid,
  p_location_id uuid,
  p_date date,
  p_actor_user_id uuid,
  p_snapshots jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_instance_id uuid;
  v_existing_id uuid;
  v_trigger_ts timestamptz := NOW();
  v_snapshot jsonb;
  v_snapshot_count int := 0;
  v_with_count int := 0;
  v_closer_count_text text;
BEGIN
  INSERT INTO checklist_instances (
    template_id, location_id, date, shift_start_at, status,
    triggered_by_user_id, triggered_at
  )
  VALUES (
    p_template_id, p_location_id, p_date, v_trigger_ts, 'open',
    p_actor_user_id, v_trigger_ts
  )
  ON CONFLICT (template_id, location_id, date) WHERE NOT allows_multiple_per_day
    DO NOTHING
  RETURNING id INTO v_instance_id;

  IF v_instance_id IS NULL THEN
    SELECT id INTO v_existing_id
    FROM checklist_instances
    WHERE template_id = p_template_id
      AND location_id = p_location_id
      AND date = p_date;

    IF v_existing_id IS NULL THEN
      RAISE EXCEPTION 'create_opening_instance_atomic: race re-read failed (instance constraint conflict but no row found)';
    END IF;

    RETURN jsonb_build_object('instance_id', v_existing_id, 'was_created', false);
  END IF;

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
$function$;
