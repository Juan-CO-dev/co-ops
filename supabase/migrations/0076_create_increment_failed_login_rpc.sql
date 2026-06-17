-- Migration 0076_create_increment_failed_login_rpc
-- Applied via Supabase MCP apply_migration on 2026-06-17.
-- Canonical reference: lib/auth-flows.ts recordFailedAttempt (atomic lockout counter).
--
-- BUG 1 fix: the prior recordFailedAttempt read failed_login_count, computed
-- current+1 in JS, then UPDATEd with no error check and non-atomically — two
-- concurrent failed attempts both read N and write N+1, undercounting toward
-- the lockout threshold and weakening brute-force defense. This RPC makes the
-- increment atomic (single UPDATE ... RETURNING) so the count is always
-- accurate under concurrency.
--
-- SECURITY DEFINER + locked search_path mirrors the 0029 helper convention.
-- Service-role-only: recordFailedAttempt calls it via the service-role client.
-- Grant EXECUTE to service_role; REVOKE from anon + authenticated so a misrouted
-- user-JWT call fails loudly (Supabase default ACLs grant EXECUTE to all roles).

create or replace function public.increment_failed_login(p_user_id uuid)
returns integer
language sql
security definer
set search_path = pg_catalog, public
as $$
  update public.users
     set failed_login_count = coalesce(failed_login_count, 0) + 1
   where id = p_user_id
  returning failed_login_count
$$;

revoke execute on function public.increment_failed_login(uuid) from public;
revoke execute on function public.increment_failed_login(uuid) from anon;
revoke execute on function public.increment_failed_login(uuid) from authenticated;
grant execute on function public.increment_failed_login(uuid) to service_role;
