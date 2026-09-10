-- Migration 0200_current_user_id_session_bound
-- Applied via Supabase MCP 2026-09-10 (sim first, prod on Juan's word). Provenance: LRA Wave A #3, row LRA-013 (approach Juan-approved 2026-09-10: "yes to 3").
--
-- WHAT: current_user_id() — the helper every user-scoped RLS policy calls, directly or through
-- current_user_role_level() / current_user_locations() — now resolves the JWT's `session_id` claim against
-- public.sessions and returns the user only while that session is LIVE (not revoked, not expired) and
-- belongs to the JWT's `user_id`. Signature, volatility (STABLE), SECURITY DEFINER and search_path unchanged.
--
-- WHY (LRA-013, 09-01 P2-1b, re-confirmed 2026-09-10): the app path dual-verifies every request against
-- sessions.token_hash, so revocation bites on every route — but a staff JWT is also a valid PostgREST bearer,
-- and PostgREST never consults sessions. A revoked-but-unexpired token (logout, admin revoke after a role
-- change, password reset "assume compromise") therefore kept every RLS policy open for up to 12 h on the curl
-- path. Binding the helper to the session closes that path at the database: the moment revoked_at is set, or
-- expires_at passes, every policy evaluates as nobody — reads return no rows, writes are 42501.
--
-- Claim shape is locked (AGENTS § Auth): { user_id, app_role, role_level, locations, session_id, role }.
-- Every JWT is minted by lib/session.ts from a freshly inserted sessions row, so a token without a session_id
-- claim, or whose session row is missing, is not a legitimate staff token and resolves to NULL by design.
-- Service-role callers bypass RLS and never reach this function; the customer portal uses current_customer_id().
--
-- Idle timeout (SESSION_IDLE_MINUTES / last_activity_at) stays app-layer, exactly as before; this migration binds
-- the hard lifecycle (revoked_at / expires_at) only.
--
-- VERIFY AFTER APPLY (personas contract in the sim, and read-only on prod):
--   select pg_get_functiondef('public.current_user_id()'::regprocedure);   -- joins sessions, both predicates
--   select grantee from information_schema.routine_privileges where routine_name = 'current_user_id';
--   → authenticated (RLS quals call it) and service_role/postgres; anon unchanged.
--
-- Rollback: restore 0054's body (claims-only) — which re-opens LRA-013; prefer fixing forward.

CREATE OR REPLACE FUNCTION public.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT s.user_id
  FROM public.sessions s
  WHERE s.id = NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'session_id', '')::uuid
    AND s.user_id = NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'user_id', '')::uuid
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
$function$;

-- Guard: the helper must reference sessions and both lifecycle predicates, or refuse to apply.
DO $$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('public.current_user_id()'::regprocedure);
  IF def !~ 'FROM public\.sessions' OR def !~ 'revoked_at IS NULL' OR def !~ 'expires_at > now\(\)' OR def !~ 'session_id' THEN
    RAISE EXCEPTION '0200: current_user_id() is not session-bound after apply';
  END IF;
END $$;

INSERT INTO public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
VALUES (
  NULL, NULL, 'security.grants_change', 'sessions', NULL, true,
  jsonb_build_object(
    'actor_context', 'migration_apply',
    'migration', '0200_current_user_id_session_bound',
    'function', 'public.current_user_id()',
    'change', 'resolves user_id only for a live sessions row matching the session_id + user_id claims',
    'ledger', jsonb_build_array('LRA-013')
  )
);
