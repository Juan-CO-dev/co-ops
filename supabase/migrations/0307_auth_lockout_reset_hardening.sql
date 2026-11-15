-- Migration 0307_auth_lockout_reset_hardening
-- AUTHORED 2026-11-15. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word, AFTER 0076 and 0279).
-- Provenance: bug-audit wave W07 "PINs, lockouts and password resets" (found at 7494f738).
--
-- WHAT:
--   1. auth_reserve_attempt(p_user) — NEW (B049 + B050). The lock check and the attempt count become ONE step under
--      the users row lock, taken BEFORE the PIN / password is checked. A live lock answers
--      { allowed: false, locked_until, retry_after_seconds } and writes nothing. Otherwise the attempt is counted:
--      an account whose lock has RUN OUT restarts at 1 (B049: the count used to keep climbing, so one wrong answer
--      after a lockout re-locked the account for another 15 minutes, forever), and the attempt that reaches 5 writes
--      locked_until = now + 15 minutes in the same statement. Concurrent attempts queue on the row lock, so a burst
--      gets exactly 5 through and the rest are refused before bcrypt runs (B050: all of them used to pass a separate
--      read of locked_until). The limits are the twins of lib/auth-lockout-shared.ts FAILURE_LIMIT / LOCKOUT_MINUTES.
--   2. increment_failed_login(p_user_id) — 0076's counter RE-EMITTED with the same restart (B049), same signature and
--      return. It is the app's fallback counter (when auth_reserve_attempt is missing or errors), so the fallback
--      path no longer re-locks on the first wrong answer after an expired lock either.
--
-- LOCK ORDER (unchanged from 0279): the identity lock → the per-person advisory lock → users rows → password_resets /
--   email_verifications / sessions. auth_reserve_attempt takes ONE users row lock and nothing else.
--
-- EXISTING ROWS: none rewritten by sections 1–2. An account sitting on an expired lock restarts at its next attempt.
--
-- APP COMPATIBILITY: every app caller of a function created here falls back to its pre-0307 path while the function
--   is missing (PGRST202 / 42883), so the app works unchanged before this file is applied; applying it switches each
--   path with no deploy. The re-emitted functions keep their signatures, so code deployed before this wave keeps
--   working after the apply. Details per path are in the PR for audit wave W07.
--
-- DEPENDS ON: users (failed_login_count, locked_until, last_login_at), 0076 (increment_failed_login), 0279.
--
-- PRE-FLIGHT (MCP, read-only, before apply):
--   select count(*) from users where failed_login_count >= 5 and locked_until <= now();  -- accounts B049 frees on their next try
--
-- VERIFY AFTER APPLY:
--   select proname, prosecdef, proconfig from pg_proc where proname in ('auth_reserve_attempt', 'increment_failed_login');
--     -- t, {search_path=pg_catalog, public} on each
--   select routine_name, grantee from information_schema.routine_privileges where routine_schema = 'public'
--    and routine_name in ('auth_reserve_attempt', 'increment_failed_login');  -- service_role (+ postgres) only
--
-- ROLLBACK: none needed for the app (it falls back on a missing function). Re-emit through a new reviewed migration.

begin;

-- ── PRE-FLIGHT: not applied twice; 0076 and 0279 present and un-drifted; the columns this file writes exist ──
do $$
declare v_def text;
begin
  if to_regprocedure('public.auth_reserve_attempt(uuid)') is not null then
    raise exception '0307: already applied (auth_reserve_attempt exists)';
  end if;
  if to_regprocedure('public.increment_failed_login(uuid)') is null then
    raise exception '0307: 0076 (increment_failed_login) must be applied first';
  end if;
  if to_regprocedure('public.user_admin_lock(uuid,uuid)') is null
     or to_regprocedure('public.user_admin_role_level(text)') is null then
    raise exception '0307: 0279 (user_admin_lock and the user-admin writers) must be applied first';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'users'
       and column_name in ('failed_login_count', 'locked_until', 'last_login_at', 'pin_hash', 'password_hash', 'email',
                           'email_verified', 'email_verified_at', 'active', 'role')) <> 10 then
    raise exception '0307: the users columns the auth functions use must exist';
  end if;
  select prosrc into v_def from pg_proc where oid = 'public.increment_failed_login(uuid)'::regprocedure;
  if strpos(v_def, 'coalesce(failed_login_count, 0) + 1') = 0 or strpos(v_def, 'locked_until') > 0 then
    raise exception '0307: increment_failed_login differs from 0076: refusing to overwrite it';
  end if;
end $$;

-- ── 1. B049 + B050: reserve the attempt — decide and count under one row lock, before the credential check ──
create function public.auth_reserve_attempt(p_user uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_now timestamptz; v_count integer; v_until timestamptz;
begin
  if p_user is null then raise exception 'invalid_payload'; end if;
  select failed_login_count, locked_until into v_count, v_until from public.users where id = p_user for update;
  if not found then raise exception 'user_not_found'; end if;
  -- The clock is read AFTER the row lock: a call that queued behind a burst judges the lock as it stands now.
  v_now := clock_timestamp();
  if v_until is not null and v_until > v_now then
    return jsonb_build_object('allowed', false, 'locked_until', v_until,
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_until - v_now))))::integer);
  end if;
  -- B049: a lock that has run out restarts the window — the next attempt is 1, never 6.
  v_count := case when v_until is not null then 1 else coalesce(v_count, 0) + 1 end;
  -- The twins of lib/auth-lockout-shared.ts FAILURE_LIMIT (5) and LOCKOUT_MINUTES (15).
  v_until := case when v_count >= 5 then v_now + interval '15 minutes' else null end;
  update public.users set failed_login_count = v_count, locked_until = v_until where id = p_user;
  return jsonb_build_object('allowed', true, 'attempt', v_count, 'locked_until', v_until);
end $$;
comment on function public.auth_reserve_attempt(uuid) is
  '0307 (audit W07 B049/B050): the sign-in lock check and attempt count in one users row lock, called BEFORE the '
  'credential check. A live lock → {allowed:false, locked_until, retry_after_seconds}, nothing written. Otherwise '
  '{allowed:true, attempt, locked_until}: an expired lock restarts at 1; attempt 5 writes a 15-minute lock.';
revoke all on function public.auth_reserve_attempt(uuid) from public, anon, authenticated;
grant execute on function public.auth_reserve_attempt(uuid) to service_role;

-- ── 2. B049 on the fallback path: 0076's counter, re-emitted with the same restart ──
-- Inside one UPDATE both CASEs read the OLD row, so the restart and the clearing of the dead lock agree.
create or replace function public.increment_failed_login(p_user_id uuid)
returns integer
language sql
security definer
set search_path = pg_catalog, public
as $$
  update public.users
     set failed_login_count = case when locked_until is not null and locked_until <= clock_timestamp() then 1
                                   else coalesce(failed_login_count, 0) + 1 end,
         locked_until = case when locked_until is not null and locked_until <= clock_timestamp() then null
                             else locked_until end
   where id = p_user_id
  returning failed_login_count
$$;
revoke all on function public.increment_failed_login(uuid) from public, anon, authenticated;
grant execute on function public.increment_failed_login(uuid) to service_role;

-- ── POST-APPLY: every function this file creates or re-emits is definer, search_path pinned, service_role only ──
do $$
declare
  v_fn text; f regprocedure;
  v_fns text[] := array[
    'public.auth_reserve_attempt(uuid)',
    'public.increment_failed_login(uuid)'
  ];
begin
  foreach v_fn in array v_fns loop
    f := v_fn::regprocedure;
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
       or not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '0307: RPC grant escaped on %', f;
    end if;
    if not (select prosecdef from pg_proc where oid = f)
       or not coalesce((select proconfig from pg_proc where oid = f) @> array['search_path=pg_catalog, public'], false) then
      raise exception '0307: % must be SECURITY DEFINER with a pinned search_path', f;
    end if;
  end loop;
end $$;

commit;
