-- Migration 0058_role_model_renumber
-- Applied via Supabase MCP apply_migration on 2026-06-04.
-- Pre-apply gate: full live policy-census cross-check against pg_policies
-- (regex-fingerprint of every current_user_role_level() threshold) confirmed
-- 100 touched + 22 untouched = 122 function-referencing policies, zero drift —
-- every ALTER POLICY target matched a live policy by name AND its current
-- literal matched the artifact's expected FROM-state. Step 7 post-apply: live
-- current_user_role_level() CASE verified byte-equal to lib/roles.ts (all 15
-- roles). Task 10 post-apply probe: employee (level 3) flips to FAIL the new
-- KH+ >= 4 gate; key_holder (level 4) stays PASS — C.41 collision resolved.
-- Single atomic apply_migration call (one BEGIN..COMMIT): CHECK + function +
-- ~100 RLS thresholds + audit row all-or-nothing.
--
-- Canonical references:
--   - lib/roles.ts — ROLES registry is the source-of-truth the Step 2 CASE mirrors.
--   - lib/destructive-actions.ts — "role_model.renumber" registry entry (the
--     audit row sets destructive=true SQL-side, not via isDestructive()).
--   - AGENTS.md "Migration-driven audit emission convention (precedent set by
--     0045)" — actor_context=migration_apply, literal actor UUID, top-level
--     destructive set explicitly.

-- ============================================================
-- Migration 0058_role_model_renumber
-- SINGLE TRANSACTION via one apply_migration call.
-- C.41 employee/key_holder level-collision fix — full 0-10 renumber.
-- ============================================================

-- ---- Step 1: extend the users.role CHECK (4 new codes) ----
ALTER TABLE public.users DROP CONSTRAINT users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (
  role = ANY (ARRAY[
    'cgs','owner','moo','gm','agm','catering_mgr','prep_mgr','social_media_mgr',
    'shift_lead','key_holder','trainer','employee','trainee',
    'hired_not_yet_worked','prospect'
  ]::text[])
);

-- ---- Step 2: rewrite current_user_role_level() (mirrors lib/roles.ts) ----
CREATE OR REPLACE FUNCTION public.current_user_role_level()
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT CASE role
    WHEN 'cgs' THEN 10
    WHEN 'owner' THEN 9
    WHEN 'moo' THEN 8
    WHEN 'gm' THEN 7
    WHEN 'agm' THEN 6
    WHEN 'catering_mgr' THEN 6
    WHEN 'prep_mgr' THEN 6
    WHEN 'social_media_mgr' THEN 6
    WHEN 'shift_lead' THEN 5
    WHEN 'key_holder' THEN 4
    WHEN 'trainer' THEN 4
    WHEN 'employee' THEN 3
    WHEN 'trainee' THEN 2
    WHEN 'hired_not_yet_worked' THEN 1
    WHEN 'prospect' THEN 0
    ELSE 0
  END FROM public.users WHERE id = public.current_user_id()
$function$;

-- ============================================================
-- Step 3: KH+ split — these six gates move 3 -> 4 (key_holder+)
-- ============================================================
ALTER POLICY ocs_read ON public.opening_closer_count_snapshots
  USING (current_user_role_level() >= 4);

ALTER POLICY osv_read ON public.opening_section_verifications
  USING (current_user_role_level() >= 4);

ALTER POLICY opening_setup_items_delete_policy ON public.opening_setup_items
  USING (current_user_role_level() >= 4);

ALTER POLICY opening_setup_items_insert_policy ON public.opening_setup_items
  WITH CHECK (current_user_role_level() >= 4);

ALTER POLICY opening_setup_items_update_policy ON public.opening_setup_items
  USING (current_user_role_level() >= 4);

-- compound: level + instance/location EXISTS — only 3->4 changed:
ALTER POLICY opening_setup_verifications_insert_policy ON public.opening_setup_verifications
  WITH CHECK (
    (current_user_role_level() >= 4) AND (EXISTS (
      SELECT 1 FROM checklist_instances ci
      WHERE ((ci.id = opening_setup_verifications.opening_instance_id)
        AND (ci.location_id IN (
          SELECT user_locations.location_id FROM user_locations
          WHERE (user_locations.user_id = current_user_id()))))))
  );

-- ============================================================
-- Step 4a: checklist_instances_insert -> type-aware (Flag #1 Option B)
-- LIVE location predicate is `= ANY (current_user_locations())`
-- (NOT the plan template's IN-subquery) — reproduced verbatim per plan line 812.
-- ============================================================
ALTER POLICY checklist_instances_insert ON public.checklist_instances
  WITH CHECK (
    (CASE
       WHEN (SELECT t.type FROM checklist_templates t
             WHERE t.id = checklist_instances.template_id) IN ('opening','prep')
       THEN current_user_role_level() >= 4
       ELSE current_user_role_level() >= 3   -- closing + any other type: any-staff
     END)
    AND (location_id = ANY (current_user_locations()))
  );

-- ============================================================
-- Step 5: mechanical band shifts (verbatim expr, only literal changed)
-- ============================================================

-- ---- >=4 -> >=5 ----
ALTER POLICY maintenance_tickets_insert ON public.maintenance_tickets
  WITH CHECK ((location_id = ANY (current_user_locations())) AND (current_user_role_level() >= 5));
ALTER POLICY maintenance_tickets_update ON public.maintenance_tickets
  USING ((location_id = ANY (current_user_locations())) AND (current_user_role_level() >= 5))
  WITH CHECK ((location_id = ANY (current_user_locations())) AND (current_user_role_level() >= 5));
ALTER POLICY shift_overlay_corrections_insert ON public.shift_overlay_corrections
  WITH CHECK ((submitted_by = current_user_id()) AND (current_user_role_level() >= 5) AND (EXISTS (
    SELECT 1 FROM shift_overlays r
    WHERE ((r.id = shift_overlay_corrections.original_overlay_id)
      AND (r.location_id = ANY (current_user_locations()))))));

-- ---- >=5 -> >=6 ----
ALTER POLICY announcement_acks_read ON public.announcement_acknowledgements
  USING ((user_id = current_user_id()) OR (current_user_role_level() >= 6));
ALTER POLICY announcements_insert ON public.announcements
  WITH CHECK ((current_user_role_level() >= 6) AND (posted_by = current_user_id()));
ALTER POLICY announcements_update ON public.announcements
  USING ((posted_by = current_user_id()) AND (current_user_role_level() >= 6) AND (posted_at > (now() - '03:00:00'::interval)))
  WITH CHECK ((posted_by = current_user_id()) AND (current_user_role_level() >= 6) AND (posted_at > (now() - '03:00:00'::interval)));
ALTER POLICY catering_customers_insert ON public.catering_customers
  WITH CHECK ((primary_location_id = ANY (current_user_locations())) AND (current_user_role_level() >= 6));
ALTER POLICY catering_customers_update ON public.catering_customers
  USING ((primary_location_id = ANY (current_user_locations())) AND (current_user_role_level() >= 6))
  WITH CHECK ((primary_location_id = ANY (current_user_locations())) AND (current_user_role_level() >= 6));
ALTER POLICY catering_orders_insert ON public.catering_orders
  WITH CHECK ((location_id = ANY (current_user_locations())) AND (current_user_role_level() >= 6));
ALTER POLICY catering_orders_update ON public.catering_orders
  USING ((location_id = ANY (current_user_locations())) AND (current_user_role_level() >= 6))
  WITH CHECK ((location_id = ANY (current_user_locations())) AND (current_user_role_level() >= 6));
ALTER POLICY catering_pipeline_insert ON public.catering_pipeline
  WITH CHECK ((current_user_role_level() >= 6) AND ((location_id IS NULL) OR (location_id = ANY (current_user_locations()))));
ALTER POLICY catering_pipeline_update ON public.catering_pipeline
  USING ((current_user_role_level() >= 6) AND ((location_id IS NULL) OR (location_id = ANY (current_user_locations()))))
  WITH CHECK ((current_user_role_level() >= 6) AND ((location_id IS NULL) OR (location_id = ANY (current_user_locations()))));
ALTER POLICY deep_clean_assignments_insert ON public.deep_clean_assignments
  WITH CHECK ((location_id = ANY (current_user_locations())) AND (current_user_role_level() >= 6));
ALTER POLICY deep_clean_assignments_update ON public.deep_clean_assignments
  USING ((location_id = ANY (current_user_locations())) AND (current_user_role_level() >= 6))
  WITH CHECK ((location_id = ANY (current_user_locations())) AND (current_user_role_level() >= 6));
ALTER POLICY training_progress_insert ON public.training_progress
  WITH CHECK ((current_user_role_level() >= 6) AND ((signed_off_by IS NULL) OR (signed_off_by <> current_user_id())));
ALTER POLICY training_progress_read ON public.training_progress
  USING ((user_id = current_user_id()) OR (current_user_role_level() >= 6));
ALTER POLICY training_progress_update ON public.training_progress
  USING (current_user_role_level() >= 6)
  WITH CHECK ((current_user_role_level() >= 6) AND ((signed_off_by IS NULL) OR (signed_off_by <> current_user_id())));
ALTER POLICY vendor_items_insert ON public.vendor_items
  WITH CHECK (current_user_role_level() >= 6);
ALTER POLICY vendor_items_update ON public.vendor_items
  USING (current_user_role_level() >= 6)
  WITH CHECK (current_user_role_level() >= 6);
ALTER POLICY vendor_price_history_read ON public.vendor_price_history
  USING (current_user_role_level() >= 6);
-- vendors_update_trivial: live was >=5 (AGM+ trivial-vendor-edit gate). AGM moves
-- 5->6, so this gate moves with it (else the new shift_lead(5) would gain trivial
-- vendor edit). Confirmed by Juan as a plan omission to include.
ALTER POLICY vendors_update_trivial ON public.vendors
  USING (current_user_role_level() >= 6)
  WITH CHECK (current_user_role_level() >= 6);

-- ---- >=6 -> >=7 ----
ALTER POLICY checklist_template_items_insert ON public.checklist_template_items
  WITH CHECK (current_user_role_level() >= 7);
ALTER POLICY checklist_template_items_update ON public.checklist_template_items
  USING (current_user_role_level() >= 7)
  WITH CHECK (current_user_role_level() >= 7);
ALTER POLICY checklist_templates_insert ON public.checklist_templates
  WITH CHECK (current_user_role_level() >= 7);
ALTER POLICY checklist_templates_update ON public.checklist_templates
  USING (current_user_role_level() >= 7)
  WITH CHECK (current_user_role_level() >= 7);
ALTER POLICY deep_clean_tasks_insert ON public.deep_clean_tasks
  WITH CHECK (current_user_role_level() >= 7);
ALTER POLICY deep_clean_tasks_update ON public.deep_clean_tasks
  USING (current_user_role_level() >= 7)
  WITH CHECK (current_user_role_level() >= 7);
ALTER POLICY lto_performance_insert ON public.lto_performance
  WITH CHECK ((location_id = ANY (current_user_locations())) AND (current_user_role_level() >= 7));
ALTER POLICY lto_performance_update ON public.lto_performance
  USING ((location_id = ANY (current_user_locations())) AND (current_user_role_level() >= 7))
  WITH CHECK ((location_id = ANY (current_user_locations())) AND (current_user_role_level() >= 7));
ALTER POLICY par_levels_insert ON public.par_levels
  WITH CHECK (current_user_role_level() >= 7);
ALTER POLICY par_levels_update ON public.par_levels
  USING (current_user_role_level() >= 7)
  WITH CHECK (current_user_role_level() >= 7);
ALTER POLICY recipe_ingredients_insert ON public.recipe_ingredients
  WITH CHECK (current_user_role_level() >= 7);
ALTER POLICY recipe_ingredients_update ON public.recipe_ingredients
  USING (current_user_role_level() >= 7)
  WITH CHECK (current_user_role_level() >= 7);
ALTER POLICY recipe_steps_insert ON public.recipe_steps
  WITH CHECK (current_user_role_level() >= 7);
ALTER POLICY recipe_steps_update ON public.recipe_steps
  USING (current_user_role_level() >= 7)
  WITH CHECK (current_user_role_level() >= 7);
ALTER POLICY recipes_insert ON public.recipes
  WITH CHECK (current_user_role_level() >= 7);
ALTER POLICY recipes_update ON public.recipes
  USING (current_user_role_level() >= 7)
  WITH CHECK (current_user_role_level() >= 7);
ALTER POLICY tip_pool_distributions_insert ON public.tip_pool_distributions
  WITH CHECK ((current_user_role_level() >= 7) AND (EXISTS (
    SELECT 1 FROM tip_pools tp
    WHERE ((tp.id = tip_pool_distributions.tip_pool_id) AND (tp.location_id = ANY (current_user_locations()))))));
ALTER POLICY tip_pool_distributions_update ON public.tip_pool_distributions
  USING ((current_user_role_level() >= 7) AND (EXISTS (
    SELECT 1 FROM tip_pools tp
    WHERE ((tp.id = tip_pool_distributions.tip_pool_id) AND (tp.location_id = ANY (current_user_locations()))))))
  WITH CHECK ((current_user_role_level() >= 7) AND (EXISTS (
    SELECT 1 FROM tip_pools tp
    WHERE ((tp.id = tip_pool_distributions.tip_pool_id) AND (tp.location_id = ANY (current_user_locations()))))));
ALTER POLICY tip_pools_insert ON public.tip_pools
  WITH CHECK ((location_id = ANY (current_user_locations())) AND (current_user_role_level() >= 7));
ALTER POLICY tip_pools_update ON public.tip_pools
  USING ((location_id = ANY (current_user_locations())) AND (current_user_role_level() >= 7))
  WITH CHECK ((location_id = ANY (current_user_locations())) AND (current_user_role_level() >= 7));
ALTER POLICY user_locations_read ON public.user_locations
  USING ((user_id = current_user_id()) OR (current_user_role_level() >= 7));
ALTER POLICY users_read_self ON public.users
  USING ((id = current_user_id()) OR (current_user_role_level() >= 7));
ALTER POLICY vendor_orders_insert ON public.vendor_orders
  WITH CHECK ((location_id = ANY (current_user_locations())) AND (current_user_role_level() >= 7));
ALTER POLICY vendor_orders_update ON public.vendor_orders
  USING ((location_id = ANY (current_user_locations())) AND (current_user_role_level() >= 7))
  WITH CHECK ((location_id = ANY (current_user_locations())) AND (current_user_role_level() >= 7));
ALTER POLICY vendors_insert ON public.vendors
  WITH CHECK (current_user_role_level() >= 7);

-- ---- >=6.5 -> >=8 ----
ALTER POLICY locations_insert ON public.locations
  WITH CHECK (current_user_role_level() >= 8);
ALTER POLICY locations_update ON public.locations
  USING (current_user_role_level() >= 8)
  WITH CHECK (current_user_role_level() >= 8);
ALTER POLICY position_responsibilities_insert ON public.position_responsibilities
  WITH CHECK (current_user_role_level() >= 8);
ALTER POLICY position_responsibilities_update ON public.position_responsibilities
  USING (current_user_role_level() >= 8)
  WITH CHECK (current_user_role_level() >= 8);
ALTER POLICY positions_insert ON public.positions
  WITH CHECK (current_user_role_level() >= 8);
ALTER POLICY positions_update ON public.positions
  USING (current_user_role_level() >= 8)
  WITH CHECK (current_user_role_level() >= 8);
ALTER POLICY training_modules_insert ON public.training_modules
  WITH CHECK (current_user_role_level() >= 8);
ALTER POLICY training_modules_update ON public.training_modules
  USING (current_user_role_level() >= 8)
  WITH CHECK (current_user_role_level() >= 8);
ALTER POLICY user_locations_insert ON public.user_locations
  WITH CHECK (current_user_role_level() >= 8);
ALTER POLICY user_locations_update ON public.user_locations
  USING (current_user_role_level() >= 8)
  WITH CHECK (current_user_role_level() >= 8);
ALTER POLICY users_insert_admin ON public.users
  WITH CHECK (current_user_role_level() >= 8);
ALTER POLICY users_update_admin ON public.users
  USING (current_user_role_level() >= 8)
  WITH CHECK (current_user_role_level() >= 8);

-- ---- >=7 -> >=9 (all-locations override inside _read quals; location_id half untouched) ----
ALTER POLICY announcements_read ON public.announcements
  USING ((active AND (current_user_role_level() >= target_min_role_level)
    AND ((target_max_role_level IS NULL) OR (current_user_role_level() <= target_max_role_level))
    AND ((location_id IS NULL) OR (location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 9))));
ALTER POLICY audit_read ON public.audit_log
  USING ((actor_id = current_user_id()) OR (current_user_role_level() >= 9));
ALTER POLICY catering_customers_read ON public.catering_customers
  USING ((primary_location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 9));
ALTER POLICY catering_orders_read ON public.catering_orders
  USING ((location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 9));
ALTER POLICY catering_pipeline_read ON public.catering_pipeline
  USING ((location_id IS NULL) OR (location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 9));
ALTER POLICY checklist_completions_read ON public.checklist_completions
  USING (EXISTS (SELECT 1 FROM checklist_instances i
    WHERE ((i.id = checklist_completions.instance_id)
      AND ((i.location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 9)))));
ALTER POLICY checklist_incomplete_reasons_read ON public.checklist_incomplete_reasons
  USING (EXISTS (SELECT 1 FROM checklist_instances i
    WHERE ((i.id = checklist_incomplete_reasons.instance_id)
      AND ((i.location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 9)))));
ALTER POLICY checklist_instances_read ON public.checklist_instances
  USING ((location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 9));
ALTER POLICY checklist_submissions_read ON public.checklist_submissions
  USING (EXISTS (SELECT 1 FROM checklist_instances i
    WHERE ((i.id = checklist_submissions.instance_id)
      AND ((i.location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 9)))));
ALTER POLICY checklist_template_items_read ON public.checklist_template_items
  USING (EXISTS (SELECT 1 FROM checklist_templates t
    WHERE ((t.id = checklist_template_items.template_id)
      AND ((t.location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 9)))));
ALTER POLICY checklist_templates_read ON public.checklist_templates
  USING ((location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 9));
ALTER POLICY customer_feedback_read ON public.customer_feedback
  USING ((location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 9));
ALTER POLICY deep_clean_assignments_read ON public.deep_clean_assignments
  USING ((location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 9));
ALTER POLICY lto_performance_read ON public.lto_performance
  USING ((location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 9));
ALTER POLICY maintenance_tickets_read ON public.maintenance_tickets
  USING ((location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 9));
ALTER POLICY notification_recipients_read ON public.notification_recipients
  USING ((user_id = current_user_id()) OR (current_user_role_level() >= 9));
ALTER POLICY notifications_read ON public.notifications
  USING ((current_user_role_level() >= 9) OR (EXISTS (SELECT 1 FROM notification_recipients nr
    WHERE ((nr.notification_id = notifications.id) AND (nr.user_id = current_user_id())))));
ALTER POLICY par_levels_read ON public.par_levels
  USING ((location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 9));
ALTER POLICY prep_list_resolutions_read ON public.prep_list_resolutions
  USING (EXISTS (SELECT 1 FROM checklist_instances i
    WHERE ((i.id = prep_list_resolutions.instance_id)
      AND ((i.location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 9)))));
ALTER POLICY report_views_read ON public.report_views
  USING ((viewed_by = current_user_id()) OR (current_user_role_level() >= 9));
ALTER POLICY shift_overlay_corrections_read ON public.shift_overlay_corrections
  USING (EXISTS (SELECT 1 FROM shift_overlays r
    WHERE ((r.id = shift_overlay_corrections.original_overlay_id)
      AND ((r.location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 9)))));
ALTER POLICY shift_overlays_read ON public.shift_overlays
  USING ((location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 9));
ALTER POLICY shifts_daily_data_read ON public.shifts_daily_data
  USING ((location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 9));
ALTER POLICY tip_pool_distributions_read ON public.tip_pool_distributions
  USING (EXISTS (SELECT 1 FROM tip_pools tp
    WHERE ((tp.id = tip_pool_distributions.tip_pool_id)
      AND ((tp.location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 9)))));
ALTER POLICY tip_pools_read ON public.tip_pools
  USING ((location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 9));
ALTER POLICY toast_daily_data_read ON public.toast_daily_data
  USING ((location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 9));
ALTER POLICY training_reports_read ON public.training_reports
  USING ((location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 9));
ALTER POLICY user_notification_prefs_read ON public.user_notification_prefs
  USING ((user_id = current_user_id()) OR (current_user_role_level() >= 9));
ALTER POLICY vendor_deliveries_read ON public.vendor_deliveries
  USING ((location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 9));
ALTER POLICY vendor_orders_read ON public.vendor_orders
  USING ((location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 9));
ALTER POLICY weekly_rollups_read ON public.weekly_rollups
  USING ((location_id IS NULL) OR (location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 9));
ALTER POLICY written_reports_read ON public.written_reports
  USING ((current_user_role_level() >= visibility_min_level)
    AND ((location_id IS NULL) OR (location_id = ANY (current_user_locations())) OR (current_user_role_level() >= 9)));

-- ---- >=8 -> >=10 ----
ALTER POLICY sms_queue_read ON public.sms_queue
  USING (current_user_role_level() >= 10);

-- ============================================================
-- THE TWO COMPOUND POLICIES — literal-by-literal (most bug-prone)
-- Each has TWO different literals in one expression. Each is ALTERed
-- exactly ONCE here (not also in the bands above) to avoid a double-write.
-- ============================================================

-- report_assignments_insert (with_check only):
--   live: (lvl >= (5))  AND  ((lvl >= (7)) OR location_id=ANY(...))  AND  assigner_id=current_user_id()
--   change #1: base AGM+ gate     5 -> 6
--   change #2: all-locations OR    7 -> 9
--   unchanged: assigner_id = current_user_id()
ALTER POLICY report_assignments_insert ON public.report_assignments
  WITH CHECK (
    (current_user_role_level() >= 6)
    AND ((current_user_role_level() >= 9) OR (location_id = ANY (current_user_locations())))
    AND (assigner_id = current_user_id())
  );

-- report_assignments_read_admin (using only):
--   live: (lvl >= (6))  AND  ((lvl >= (7)) OR location_id=ANY(...))
--   change #1: base GM+ admin gate   6 -> 7
--   change #2: all-locations OR       7 -> 9
ALTER POLICY report_assignments_read_admin ON public.report_assignments
  USING (
    (current_user_role_level() >= 7)
    AND ((current_user_role_level() >= 9) OR (location_id = ANY (current_user_locations())))
  );

-- ============================================================
-- Step 6: migration audit row (0045 convention). destructive = TRUE per instruction.
-- actor_id = Juan's real CGS account (literal UUID; subquery would return 2 cgs rows).
-- ============================================================
INSERT INTO audit_log (actor_id, actor_role, action, resource_table, resource_id,
  before_state, after_state, metadata, destructive)
VALUES (
  '16329556-900e-4cbb-b6e0-1829c6f4a6ed', 'cgs', 'role_model.renumber',
  'users', NULL,
  jsonb_build_object('scale','pre-renumber: employee=key_holder=3'),
  jsonb_build_object('scale','0-10: employee=3, key_holder=4, +4 new roles'),
  jsonb_build_object(
    'actor_context','migration_apply',
    'migration','0058_role_model_renumber',
    'phase','3_role_model_reconciliation',
    'reason','C.41 employee/key_holder level collision fix — full 0-10 renumber',
    'new_roles', jsonb_build_array('prospect','hired_not_yet_worked','prep_mgr','social_media_mgr'),
    'rls_policies_remapped', true,
    'ip_address', null, 'user_agent', null,
    'durable_lesson_captured_in','AGENTS.md'),
  true
);
