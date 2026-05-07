-- Captured retroactively 2026-05-06 from supabase.migrations table.
-- Functional equivalent of applied migration; may differ in whitespace
-- or transaction wrapping from original MCP apply_migration input.
-- Canonical reference:
--   - lib/checklists.ts (consumer of state_finalize columns + release_overdue_closings)
--   - BUILD_3_OPENING_REPORT_DESIGN.md §4.4 (auto-release backstop) and §4.6 (state finalize)
--   - Note: design doc §4.4 + §4.6 anticipated potential split; implementation merged
--     state-finalize columns AND auto-release backstop into this single migration.

-- ─────────────────────────────────────────────────────────────────────
-- Build #3 PR 1 — state-finalize columns + auto-release infrastructure
-- Per BUILD_3_OPENING_REPORT_DESIGN.md §4.4 + locked decisions A.2,
-- A.3-A.5, C.2, C.3 (= SPEC_AMENDMENTS.md C.48), E.1.
-- ─────────────────────────────────────────────────────────────────────

-- 1. Status enum: add 'auto_finalized'
ALTER TABLE checklist_instances
  DROP CONSTRAINT checklist_instances_status_check;
ALTER TABLE checklist_instances
  ADD CONSTRAINT checklist_instances_status_check
  CHECK (status IN ('open', 'confirmed', 'incomplete_confirmed', 'auto_finalized'));

-- 2. Finalize discriminator (A.2 locked: three production-path values;
-- 'migration_backfill' lives in audit metadata only, NOT in CHECK).
ALTER TABLE checklist_instances
  ADD COLUMN finalized_at_actor_type TEXT NULL
  CHECK (finalized_at_actor_type IN ('closer_confirm', 'opener_release', 'system_auto'));

COMMENT ON COLUMN checklist_instances.finalized_at_actor_type IS
  'Build #3 PR 1: discriminator for the operational path that finalized this instance. NULL on open rows. closer_confirm = PIN-attestation; opener_release = opener tapped Release UI; system_auto = pg_cron / lazy-eval. Migration-backfill provenance is captured separately on audit_log.metadata.release_source = ''migration_backfill''.';

-- 3. Assignment / drop columns (A.3, A.4)
ALTER TABLE checklist_instances
  ADD COLUMN assigned_to UUID NULL REFERENCES users(id),
  ADD COLUMN assignment_locked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN dropped_at TIMESTAMPTZ NULL,
  ADD COLUMN dropped_by UUID NULL REFERENCES users(id),
  ADD COLUMN dropped_reason TEXT NULL;

ALTER TABLE checklist_instances
  ADD CONSTRAINT checklist_instances_assignment_locked_check
  CHECK ((assignment_locked = false) OR (assigned_to IS NOT NULL));

COMMENT ON COLUMN checklist_instances.assigned_to IS
  'Build #3 PR 1: current assignee. NULL = unclaimed. Set on self-claim (anyone with creation permission can self-initiate by setting this to their own user_id) and on manager-assignment (KH+/AGM+ via C.42 mechanic).';
COMMENT ON COLUMN checklist_instances.assignment_locked IS
  'Build #3 PR 1: when true, assigned_to cannot self-drop; only assigner+ can reassign. False on self-claims (droppable by self).';
COMMENT ON COLUMN checklist_instances.dropped_at IS
  'Build #3 PR 1: most-recent drop timestamp. Full drop history lives in audit_log via report.drop events.';

-- 4. SQL function: release_overdue_closings()
-- Per locked decision C.2 + C.48 (SPEC_AMENDMENTS.md): SQL function as
-- source of truth, lib helper as thin wrapper. Anchor on shift_start_at
-- + 16h (NOT locations.closes_at + 12h — column doesn't exist).
CREATE OR REPLACE FUNCTION release_overdue_closings(p_location_ids uuid[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_inst RECORD;
  v_count integer := 0;
  v_grace_hours constant integer := 16;
BEGIN
  FOR v_inst IN
    SELECT ci.id, ci.template_id, ci.location_id, ci.date, ci.shift_start_at
    FROM checklist_instances ci
    JOIN checklist_templates ct ON ct.id = ci.template_id
    WHERE ci.status = 'open'
      AND ct.type = 'closing'
      AND ci.shift_start_at IS NOT NULL
      AND ci.shift_start_at < (now() - (v_grace_hours || ' hours')::interval)
      AND (p_location_ids IS NULL OR ci.location_id = ANY(p_location_ids))
  LOOP
    UPDATE checklist_instances
    SET status = 'auto_finalized',
        finalized_at_actor_type = 'system_auto'
    WHERE id = v_inst.id
      AND status = 'open';

    IF FOUND THEN
      INSERT INTO audit_log (
        actor_id, actor_role, action, resource_table, resource_id,
        before_state, after_state, metadata, destructive
      )
      VALUES (
        NULL, NULL,
        'closing.released_unfinalized',
        'checklist_instances',
        v_inst.id,
        jsonb_build_object('status', 'open'),
        jsonb_build_object(
          'status', 'auto_finalized',
          'finalized_at_actor_type', 'system_auto'
        ),
        jsonb_build_object(
          'release_source', 'system_auto',
          'template_id', v_inst.template_id,
          'location_id', v_inst.location_id,
          'date', v_inst.date,
          'shift_start_at', v_inst.shift_start_at,
          'grace_hours', v_grace_hours,
          'released_at', now(),
          'notification_pending', true,
          'ip_address', NULL,
          'user_agent', NULL
        ),
        true
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION release_overdue_closings(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION release_overdue_closings(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION release_overdue_closings(uuid[]) TO authenticated, service_role;

-- 5. pg_cron 6h backstop (locked decision C.2)
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule(
  'release_overdue_closings_6h',
  '0 */6 * * *',
  $$SELECT release_overdue_closings(NULL)$$
);

-- 6. Backfill 3 stranded v1 closing instances (locked decision E.1)
DO $$
DECLARE
  v_invoker constant uuid := '16329556-900e-4cbb-b6e0-1829c6f4a6ed';  -- Juan
  v_inst RECORD;
BEGIN
  FOR v_inst IN
    SELECT ci.id, ci.template_id, ci.location_id, ci.date, ci.shift_start_at
    FROM checklist_instances ci
    JOIN checklist_templates ct ON ct.id = ci.template_id
    WHERE ci.status = 'open'
      AND ct.type = 'closing'
      AND ct.active = false
  LOOP
    UPDATE checklist_instances
    SET status = 'auto_finalized',
        finalized_at_actor_type = 'system_auto'
    WHERE id = v_inst.id
      AND status = 'open';

    INSERT INTO audit_log (
      actor_id, actor_role, action, resource_table, resource_id,
      before_state, after_state, metadata, destructive
    )
    VALUES (
      v_invoker,
      'cgs',
      'closing.released_unfinalized',
      'checklist_instances',
      v_inst.id,
      jsonb_build_object('status', 'open'),
      jsonb_build_object(
        'status', 'auto_finalized',
        'finalized_at_actor_type', 'system_auto'
      ),
      jsonb_build_object(
        'release_source', 'migration_backfill',
        'actor_context', 'migration_apply',
        'migration', '0046_state_finalize_columns_and_auto_release',
        'phase', '3_build_3_pr_1',
        'reason', 'backfill stranded v1 closing instances (template_active=false; runtime auto-release path cannot reach because resolver picks active template only)',
        'template_id', v_inst.template_id,
        'location_id', v_inst.location_id,
        'date', v_inst.date,
        'shift_start_at', v_inst.shift_start_at,
        'notification_pending', false,
        'ip_address', NULL,
        'user_agent', NULL
      ),
      true
    );
  END LOOP;
END $$;
