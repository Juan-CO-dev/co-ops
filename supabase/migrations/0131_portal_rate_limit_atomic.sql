-- Migration 0131_portal_rate_limit_atomic
-- Applied via Supabase MCP apply_migration on 2026-07-19.
-- Canonical reference: docs/security/2026-07-18-coops-security-hardening.md (finding A-M1)
--                      + lib/portal/rate-limit.ts checkAndRecord
--
-- A-M1 (security hardening): the in-DB fixed-window limiter did a non-atomic SELECT→check→UPDATE,
-- so N concurrent requests all read the same count, all passed the cap, and last-writer-wins also
-- under-counted the stored value — a burst blew past the limit by ~the concurrency factor. This
-- RPC does an atomic INSERT … ON CONFLICT DO UPDATE … RETURNING, which Postgres serializes on the
-- (bucket_key, window_start) unique index, so every hit is counted exactly once. Returns TRUE when
-- the action is ALLOWED (post-increment count <= max), FALSE when throttled.

CREATE OR REPLACE FUNCTION public.portal_rate_limit_hit(
  p_bucket_key   text,
  p_window_start timestamptz,
  p_max          integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  new_count integer;
BEGIN
  INSERT INTO public.catering_portal_rate_limits (bucket_key, window_start, count)
  VALUES (p_bucket_key, p_window_start, 1)
  ON CONFLICT (bucket_key, window_start)
    DO UPDATE SET count = catering_portal_rate_limits.count + 1
  RETURNING count INTO new_count;
  RETURN new_count <= p_max;
END;
$$;

-- Called only via the service-role client from lib/portal/rate-limit.ts. Revoke from the end-user
-- roles (defense-in-depth; mirrors the helper-function anon-revocation discipline).
REVOKE EXECUTE ON FUNCTION public.portal_rate_limit_hit(text, timestamptz, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.portal_rate_limit_hit(text, timestamptz, integer) FROM authenticated;
