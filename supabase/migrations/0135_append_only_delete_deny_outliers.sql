-- Migration 0135_append_only_delete_deny_outliers
-- Applied via Supabase MCP apply_migration on 2026-07-19.
-- Canonical reference: docs/security/2026-07-18-coops-security-hardening.md (finding WB3-04)
--
-- WB3-04: two tables with an end-user-facing surface lacked the explicit `FOR DELETE USING(false)`
-- append-only deny that AGENTS.md mandates (migration 0106 locked the analogous outliers). No
-- permissive DELETE policy exists on either today, so DELETE is default-denied for anon/authenticated
-- already — this is defense-in-depth: if a future `FOR ALL` or permissive write policy is ever added
-- without splitting INSERT/UPDATE/DELETE, the explicit deny prevents the FOR-ALL→DELETE footgun.
-- catering_rate_rules is prioritized (it has a staff authoring UI); catering_portal_rate_limits added
-- for uniformity.

CREATE POLICY catering_rate_rules_no_user_delete
  ON public.catering_rate_rules FOR DELETE USING (false);

CREATE POLICY catering_portal_rate_limits_no_user_delete
  ON public.catering_portal_rate_limits FOR DELETE USING (false);
