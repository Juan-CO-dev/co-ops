-- Migration 0133_scope_opening_setup_verifications_select
-- Applied via Supabase MCP apply_migration on 2026-07-19.
-- Canonical reference: docs/security/2026-07-18-coops-security-hardening.md (finding WB3-03)
--
-- WB3-03: opening_setup_verifications had a SELECT policy of `USING (true)` — any authenticated
-- principal (even level 0–3) could read every location's setup-verification rows via a direct
-- PostgREST GET (cross-location info disclosure). Its sibling opening_section_verifications
-- correctly gates SELECT at `current_user_role_level() >= 4`. Match that role floor.
--
-- Regression-free: no application code reads this table via the RLS-enforced authed client — all
-- access is through the service-role atomic RPCs (submit_opening_atomic etc., SECURITY DEFINER,
-- which bypass RLS). This change only affects a direct authed/anon-client query, which the app
-- never issues. (A further tightening to per-location scope is a documented follow-up; the sibling
-- verification table is likewise role-floored only, so this keeps the two consistent.)

DROP POLICY opening_setup_verifications_select_policy ON public.opening_setup_verifications;
CREATE POLICY opening_setup_verifications_select_policy
  ON public.opening_setup_verifications
  FOR SELECT
  USING (current_user_role_level() >= 4);
