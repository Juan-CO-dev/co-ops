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
--   3. auth_create_session(session id, user, auth method, credential kind, verified hash, login email, token hash,
--      expires at, ip, user agent) — NEW (B051). The sessions row is inserted only if the credential the sign-in
--      VERIFIED is still the one in the users row: under the users row lock it refuses 'credential_changed' when the
--      stored hash of that kind differs from the verified one, or (password sign-in) when the account's email is no
--      longer the one that was looked up. A sign-in that read the old hash, sat in bcrypt while an admin reset the
--      credential (which revokes live sessions in the same transaction), used to insert a NEW live session after
--      that revoke. The admin writers hold the same row FOR UPDATE through their revoke, so either the mint commits
--      first and the revoke kills it, or the mint waits, re-reads the new hash and refuses. It also clears
--      failed_login_count / locked_until and stamps last_login_at in the same transaction (the app used to do that
--      in a separate, unchecked UPDATE after the insert).
--   4. auth_password_reset_consume(p_token_hash, p_password_hash) — NEW (B156 + B157). The WHOLE self-service reset
--      in one transaction: the link is re-checked under lock ('token_consumed' / 'token_expired' / 'token_invalid'),
--      the new password hash is written (clearing the lockout, as before), EVERY open reset link of that person is
--      consumed — the one used and all the others (B157: a second link requested within the hour used to stay
--      usable after the first one was used) — and the live sessions are revoked. Any failure rolls all of it back,
--      so a failed password write no longer burns the link (B156: the route consumed the link, then wrote the
--      password in a separate request; a failure there left the link dead and the password unchanged).
--   5. admin_user_set_credential — 0279's writer RE-EMITTED, same signature, the gate unchanged and still first:
--      + B158: a PIN or password set by an admin also clears failed_login_count / locked_until, as the self-service
--        reset always has. A locked-out person whose PIN a manager just reset used to stay locked for the rest of
--        the 15 minutes (and, before B049, re-lock on the first typo after it).
--      + B157: a password set by an admin also consumes the person's open reset links (an older reset email could
--        otherwise overwrite the password the GM just set). Returns the extra key reset_links_retired.
--
-- LOCK ORDER (unchanged from 0279): the identity lock → the per-person advisory lock → users rows → password_resets /
--   email_verifications / sessions. auth_reserve_attempt and auth_create_session each take ONE users row lock (the mint then
--   inserts its own sessions row); neither can deadlock. auth_password_reset_consume takes the 0279 per-person
--   advisory key, then the users row, then the token row, then the person's other links and sessions — never a
--   password_resets or sessions row before the users row.
--
-- EXISTING ROWS: none rewritten by sections 1–2. An account sitting on an expired lock restarts at its next attempt.
--
-- APP COMPATIBILITY: every app caller of a function created here falls back to its pre-0307 path while the function
--   is missing (PGRST202 / 42883), so the app works unchanged before this file is applied; applying it switches each
--   path with no deploy. The re-emitted functions keep their signatures, so code deployed before this wave keeps
--   working after the apply. Details per path are in the PR for audit wave W07.
--
-- DEPENDS ON: users (failed_login_count, locked_until, last_login_at, pin_hash, password_hash, email, active), sessions
--   (id, user_id, token_hash, auth_method, step_up_unlocked, last_activity_at, expires_at, ip_address, user_agent),
--   password_resets (id, user_id, token_hash, expires_at, consumed_at), 0076 (increment_failed_login), 0279.
--
-- PRE-FLIGHT (MCP, read-only, before apply):
--   select count(*) from users where failed_login_count >= 5 and locked_until <= now();  -- accounts B049 frees on their next try
--   select count(*) from password_resets where consumed_at is null and expires_at > now();  -- open reset links right now
--
-- VERIFY AFTER APPLY:
--   select proname, prosecdef, proconfig from pg_proc where proname in ('auth_reserve_attempt', 'increment_failed_login',
--     'auth_create_session', 'auth_password_reset_consume', 'admin_user_set_credential');
--     -- t, {search_path=pg_catalog, public} on each
--   select routine_name, grantee from information_schema.routine_privileges where routine_schema = 'public'
--    and routine_name in ('auth_reserve_attempt', 'increment_failed_login', 'auth_create_session', 'auth_password_reset_consume',
--      'admin_user_set_credential');  -- service_role (+ postgres) only
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
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'sessions'
       and column_name in ('id', 'user_id', 'token_hash', 'auth_method', 'step_up_unlocked', 'last_activity_at', 'expires_at',
                           'revoked_at', 'ip_address', 'user_agent')) <> 10 then
    raise exception '0307: the sessions columns the session mint writes must exist';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'password_resets'
       and column_name in ('id', 'user_id', 'token_hash', 'expires_at', 'consumed_at')) <> 5 then
    raise exception '0307: password_resets (id, user_id, token_hash, expires_at, consumed_at) must exist';
  end if;
  -- The 0279 writer this file re-emits must still be 0279's (nothing else has re-emitted it): refuse otherwise.
  if to_regprocedure('public.admin_user_set_credential(uuid,uuid,text,text)') is null then
    raise exception '0307: 0279 (user_admin_lock and the user-admin writers) must be applied first';
  end if;
  select prosrc into v_def from pg_proc where oid = 'public.admin_user_set_credential(uuid,uuid,text,text)'::regprocedure;
  if strpos(v_def, 'update public.users set pin_hash = p_hash where id = p_user') = 0
     or strpos(v_def, 'perform public.user_admin_lock(p_actor, p_user);') = 0
     or strpos(v_def, 'password_resets') > 0 or strpos(v_def, 'failed_login_count') > 0 then
    raise exception '0307: admin_user_set_credential differs from 0279: refusing to overwrite it';
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

-- ── 3. B051: the session mint — compare-and-set on the credential the sign-in verified ──
-- p_ip is TEXT and cast under a guard: a malformed address must never fail a sign-in (it is stored as null).
create function public.auth_create_session(p_session_id uuid, p_user uuid, p_auth_method text, p_credential_kind text,
  p_verified_hash text, p_login_email text, p_token_hash text, p_expires_at timestamptz, p_ip text, p_user_agent text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_active boolean; v_pin text; v_pw text; v_email text; v_now timestamptz; v_ip inet;
begin
  if p_session_id is null or p_user is null or p_auth_method is null or p_auth_method not in ('pin', 'password')
     or p_credential_kind is null or p_credential_kind not in ('pin', 'password')
     or p_verified_hash is null or p_verified_hash = '' or p_token_hash is null or p_token_hash = '' or p_expires_at is null then
    raise exception 'invalid_payload';
  end if;
  select active, pin_hash, password_hash, email into v_active, v_pin, v_pw, v_email
    from public.users where id = p_user for update;
  if not found then raise exception 'user_not_found'; end if;
  if not coalesce(v_active, false) then raise exception 'account_inactive'; end if;
  -- The compare-and-set. An admin reset, a self-service reset or an email change that committed after the sign-in
  -- read the row is SEEN here (this statement waited for it on the row lock), and the mint is refused.
  if (p_credential_kind = 'pin' and v_pin is distinct from p_verified_hash)
     or (p_credential_kind = 'password' and v_pw is distinct from p_verified_hash)
     or (p_login_email is not null and lower(v_email) is distinct from lower(p_login_email)) then
    raise exception 'credential_changed';
  end if;
  v_now := clock_timestamp();
  if p_expires_at <= v_now then raise exception 'invalid_payload'; end if;
  begin
    v_ip := nullif(btrim(p_ip), '')::inet;
  exception when others then
    v_ip := null;
  end;
  insert into public.sessions (id, user_id, token_hash, auth_method, step_up_unlocked, last_activity_at, expires_at, ip_address, user_agent)
    values (p_session_id, p_user, p_token_hash, p_auth_method, false, v_now, p_expires_at, v_ip, p_user_agent);
  -- A successful sign-in ends the failure window (also what clears the count auth_reserve_attempt just took).
  update public.users set failed_login_count = 0, locked_until = null, last_login_at = v_now where id = p_user;
  return jsonb_build_object('session_id', p_session_id);
end $$;
comment on function public.auth_create_session(uuid, uuid, text, text, text, text, text, timestamptz, text, text) is
  '0307 (audit W07 B051): mints the sessions row only while the verified credential (and, for a password sign-in, '
  'the looked-up email) is still the stored one, under the users row lock; clears the lockout counters and stamps '
  'last_login_at in the same transaction. Refusals: credential_changed, account_inactive, user_not_found, invalid_payload.';
revoke all on function public.auth_create_session(uuid, uuid, text, text, text, text, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.auth_create_session(uuid, uuid, text, text, text, text, text, timestamptz, text, text) to service_role;

-- ── 4. B156 + B157: the whole self-service reset in ONE transaction ──
-- The route hashes the new password first (bcrypt is slow and must not run inside the transaction), then calls this.
create function public.auth_password_reset_consume(p_token_hash text, p_password_hash text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_user uuid; v_role text; v_id uuid; v_expires timestamptz; v_consumed timestamptz;
  v_retired integer := 0; v_revoked integer := 0; v_now timestamptz;
begin
  if p_token_hash is null or p_token_hash = '' or p_password_hash is null or char_length(p_password_hash) not between 20 and 255 then
    raise exception 'invalid_payload';
  end if;
  -- Learn whose link this is WITHOUT a lock, so the locks below are taken in the 0279 order.
  select user_id into v_user from public.password_resets where token_hash = p_token_hash;
  if not found then raise exception 'token_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('user-employment/' || v_user::text, 0));
  select role into v_role from public.users where id = v_user for update;
  if not found then raise exception 'token_invalid'; end if;
  select id, expires_at, consumed_at into v_id, v_expires, v_consumed
    from public.password_resets where token_hash = p_token_hash for update;
  if not found then raise exception 'token_invalid'; end if;
  v_now := clock_timestamp();
  if v_consumed is not null then raise exception 'token_consumed'; end if;
  if v_expires <= v_now then raise exception 'token_expired'; end if;
  -- The password, and the lockout it clears (the person proved control of the mailbox).
  update public.users set password_hash = p_password_hash, failed_login_count = 0, locked_until = null where id = v_user;
  -- B157: this link AND every other open link of the person.
  update public.password_resets set consumed_at = v_now where user_id = v_user and consumed_at is null;
  get diagnostics v_retired = row_count;
  -- Defense: assume the old password was compromised; kill every live session.
  update public.sessions set revoked_at = v_now where user_id = v_user and revoked_at is null;
  get diagnostics v_revoked = row_count;
  return jsonb_build_object('reset_id', v_id, 'user_id', v_user, 'role', v_role,
    'other_links_retired', greatest(v_retired - 1, 0), 'sessions_revoked', v_revoked);
end $$;
comment on function public.auth_password_reset_consume(text, text) is
  '0307 (audit W07 B156/B157): the self-service password reset in one transaction — re-checks the link under lock, '
  'writes the hash (clearing the lockout), consumes every open reset link of the person, revokes live sessions. '
  'Refusals: token_invalid, token_consumed, token_expired, invalid_payload. A failure leaves the link usable.';
revoke all on function public.auth_password_reset_consume(text, text) from public, anon, authenticated;
grant execute on function public.auth_password_reset_consume(text, text) to service_role;

-- ── 5. admin_user_set_credential: 0279's writer, re-emitted. Identical but for the lines marked 0307. ──
create or replace function public.admin_user_set_credential(p_actor uuid, p_user uuid, p_kind text, p_hash text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_revoked integer := 0;
  v_retired integer := 0;  -- 0307
begin
  if p_kind is null or p_kind not in ('pin', 'password') or p_hash is null or char_length(p_hash) not between 20 and 255 then
    raise exception 'invalid_payload';
  end if;
  perform public.user_admin_lock(p_actor, p_user);
  if p_kind = 'pin' then update public.users set pin_hash = p_hash where id = p_user;
  else update public.users set password_hash = p_hash where id = p_user; end if;
  -- 0307 B158: a manager's reset also ends the lockout — the person can sign in with the new credential at once.
  update public.users set failed_login_count = 0, locked_until = null where id = p_user;
  -- 0307 B157: a password set by an admin retires the person's open reset links (an older email must not overwrite it).
  if p_kind = 'password' then
    update public.password_resets set consumed_at = clock_timestamp() where user_id = p_user and consumed_at is null;
    get diagnostics v_retired = row_count;
  end if;
  update public.sessions set revoked_at = clock_timestamp() where user_id = p_user and revoked_at is null;
  get diagnostics v_revoked = row_count;
  return jsonb_build_object('kind', p_kind, 'sessions_revoked', v_revoked, 'reset_links_retired', v_retired);  -- 0307: + reset_links_retired
end $$;
revoke all on function public.admin_user_set_credential(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_user_set_credential(uuid, uuid, text, text) to service_role;

-- ── POST-APPLY: every function this file creates or re-emits is definer, search_path pinned, service_role only ──
do $$
declare
  v_fn text; f regprocedure;
  v_fns text[] := array[
    'public.auth_reserve_attempt(uuid)',
    'public.increment_failed_login(uuid)',
    'public.auth_create_session(uuid,uuid,text,text,text,text,text,timestamptz,text,text)',
    'public.auth_password_reset_consume(text,text)',
    'public.admin_user_set_credential(uuid,uuid,text,text)'
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
  -- The re-emitted 0279 writer still takes the ONE gate, and no lock of its own.
  if strpos((select prosrc from pg_proc where oid = 'public.admin_user_set_credential(uuid,uuid,text,text)'::regprocedure),
            'perform public.user_admin_lock(p_actor, p_user);') = 0 then
    raise exception '0307: admin_user_set_credential lost its gate';
  end if;
end $$;

commit;
