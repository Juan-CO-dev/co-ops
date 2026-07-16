-- Migration 0114_catering_helpers_revoke_public
-- Applied via Supabase MCP apply_migration on 2026-07-16.
-- Canonical reference: 0029_helpers_revoke_anon (the Supabase default-ACL gotcha, AGENTS.md).
-- Fix: 0113 revoked EXECUTE on the catering location helpers FROM anon, but Supabase's
-- CREATE FUNCTION grants EXECUTE to PUBLIC by default, so anon still inherited it via PUBLIC
-- (has_function_privilege('anon', ...) = true). The correct revoke is FROM PUBLIC — it
-- strips the PUBLIC grant, leaving the explicit authenticated/service_role grants, matching
-- the current_user_* helpers' ACL exactly. anon then fails loudly if a helper is mis-invoked
-- without a JWT claim, instead of silently inheriting EXECUTE.
REVOKE EXECUTE ON FUNCTION public.catering_pipeline_loc(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.catering_order_loc(uuid) FROM PUBLIC;
