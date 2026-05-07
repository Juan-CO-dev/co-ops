-- Captured retroactively 2026-05-06 from supabase.migrations table.
-- Functional equivalent of applied migration; may differ in whitespace
-- or transaction wrapping from original MCP apply_migration input.
-- Canonical reference: AGENTS.md "Phase 3 — Build #2 cleanup PR
-- (v1 closing flip-to-inactive, 2026-05-05)" section; squash 960d0fa.
-- Established the migration-driven audit emission convention later
-- formalized in AGENTS.md "Migration-driven audit emission convention
-- (precedent set by 0045)".

-- 0045_flip_v1_closing_inactive.sql
--
-- Flip Standard Closing v1 templates at MEP + EM to active=false. Path A
-- supersession per SPEC_AMENDMENTS.md C.19: v2 was seeded 2026-05-04 17:15Z
-- and is operationally serving (confirmed v2 instances at both locations
-- on 2026-05-04). The closing-page resolver (most-recent-active by
-- created_at DESC) has been picking v2 since seed-time, but v1 staying
-- active=true keeps it visible to all-active-templates lookups
-- (loadAmPrepDashboardState in lib/prep.ts:1107). Flipping makes the
-- supersession explicit and tightens those lookups.
--
-- 3 stranded open v1 instances exist (EM 2026-05-03 19 completions,
-- EM 2026-05-04 0 completions, MEP 2026-05-03 3 completions). They were
-- already orphaned at v2 seed time (resolver returns v2.id, instance
-- lookups key on template_id, never find them). Schema status CHECK is
-- ('open', 'confirmed', 'incomplete_confirmed') — no clean cancel state.
-- Leave them at status='open'; document in audit metadata below.
--
-- Append-only philosophy preserved: UPDATE on the template row is a
-- state transition (active flag), not a DELETE. Existing instances
-- retain FK integrity to v1.
--
-- Audit emission convention for migration-driven actions: actor_id =
-- human invoker (Juan); metadata.actor_context = "migration_apply";
-- metadata.migration = "<filename>". Layered with metadata.phase /
-- reason for forensic clarity. Establishes the pattern future
-- migration-driven audit emissions mirror.

DO $$
DECLARE
  v1_mep_id constant uuid := '764eba7a-975d-4a53-b386-952a15cb2d9e';
  v1_em_id  constant uuid := 'b67c9fda-ee22-48f7-9bf5-01054e6ecf6d';
  v2_mep_id constant uuid := '876ba0f4-0b4f-4194-b82e-8fd84655222d';
  v2_em_id  constant uuid := 'da49d8ea-a1b2-4f11-b1bc-172dff9133a1';
  v2_mep_active boolean;
  v2_em_active boolean;
BEGIN
  SELECT active INTO v2_mep_active FROM checklist_templates WHERE id = v2_mep_id;
  SELECT active INTO v2_em_active  FROM checklist_templates WHERE id = v2_em_id;

  IF v2_mep_active IS NOT TRUE OR v2_em_active IS NOT TRUE THEN
    RAISE EXCEPTION 'v2 sibling missing or inactive — refusing to deactivate v1 (mep_v2_active=%, em_v2_active=%)',
      v2_mep_active, v2_em_active;
  END IF;

  UPDATE checklist_templates
     SET active = false
   WHERE id IN (v1_mep_id, v1_em_id)
     AND active = true;
END $$;

INSERT INTO audit_log (
  actor_id, actor_role, action, resource_table, resource_id,
  destructive, before_state, after_state, metadata
) VALUES (
  '16329556-900e-4cbb-b6e0-1829c6f4a6ed',
  'cgs',
  'checklist_template.delete_or_deactivate',
  'checklist_templates',
  '764eba7a-975d-4a53-b386-952a15cb2d9e',
  true,
  jsonb_build_object('active', true),
  jsonb_build_object('active', false),
  jsonb_build_object(
    'phase', '3_module_1_build_2_cleanup_v1_flip',
    'reason', 'Path A supersession — v2 operationally serving since 2026-05-04 17:15Z',
    'actor_context', 'migration_apply',
    'template_name', 'Standard Closing v1',
    'v2_template_id', '876ba0f4-0b4f-4194-b82e-8fd84655222d',
    'stranded_open_instance_ids', jsonb_build_array(
      'd02df486-2b36-4019-8851-dfa3bff79f41'
    ),
    'stranded_completion_counts', jsonb_build_object(
      'd02df486-2b36-4019-8851-dfa3bff79f41', 3
    ),
    'stranded_instances_disposition', 'left at status=open; schema status CHECK has no cancel value',
    'spec_amendments_referenced', jsonb_build_array('C.19'),
    'migration', '0045_flip_v1_closing_inactive',
    'ip_address', null,
    'user_agent', null
  )
);

INSERT INTO audit_log (
  actor_id, actor_role, action, resource_table, resource_id,
  destructive, before_state, after_state, metadata
) VALUES (
  '16329556-900e-4cbb-b6e0-1829c6f4a6ed',
  'cgs',
  'checklist_template.delete_or_deactivate',
  'checklist_templates',
  'b67c9fda-ee22-48f7-9bf5-01054e6ecf6d',
  true,
  jsonb_build_object('active', true),
  jsonb_build_object('active', false),
  jsonb_build_object(
    'phase', '3_module_1_build_2_cleanup_v1_flip',
    'reason', 'Path A supersession — v2 operationally serving since 2026-05-04 17:15Z',
    'actor_context', 'migration_apply',
    'template_name', 'Standard Closing v1',
    'v2_template_id', 'da49d8ea-a1b2-4f11-b1bc-172dff9133a1',
    'stranded_open_instance_ids', jsonb_build_array(
      '6c822126-ca09-45da-89da-53ed6216b6cc',
      'dc2b9dfa-52fb-4b6d-8d69-39d7ffe6285a'
    ),
    'stranded_completion_counts', jsonb_build_object(
      '6c822126-ca09-45da-89da-53ed6216b6cc', 19,
      'dc2b9dfa-52fb-4b6d-8d69-39d7ffe6285a', 0
    ),
    'stranded_instances_disposition', 'left at status=open; schema status CHECK has no cancel value',
    'spec_amendments_referenced', jsonb_build_array('C.19'),
    'migration', '0045_flip_v1_closing_inactive',
    'ip_address', null,
    'user_agent', null
  )
);
