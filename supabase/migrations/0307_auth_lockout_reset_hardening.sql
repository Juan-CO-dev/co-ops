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
--   6. admin_user_update_profile — 0279's writer RE-EMITTED, same signature, the identity lock and the gate unchanged
--      and still first:
--      + B052: an email change also consumes the person's open reset links. It already revoked their sessions, but a
--        reset link mailed to the OLD address kept working for its hour and could set the password of the account
--        now at the new address. Returns the extra key reset_links_retired.
--      + B053: an email change also consumes the person's open "confirm your email" links (7).
--   7. auth_email_confirm_issue(p_actor, p_user, p_token_hash, p_expires_at) — NEW (B053, owner decision W07-1 b:
--      "build a confirm-your-email message for promoted managers"). admin_user_create marks a manager's email as
--      verified when a GM CREATES them at level 6+, but nothing ever set email_verified for someone PROMOTED into a
--      manager role, and nothing in the app issued email_verifications links — so a promoted manager could never use
--      email + password sign-in or a password reset ("Email not verified yet. Check your inbox" — and no email came).
--      This function is the issuer: behind the ONE gate (user_admin_lock: the actor rule on the locked rows) it
--      requires an active level-6+ person with an email that is not yet confirmed ('email_confirm_not_available',
--      'email_required', 'email_already_confirmed'), retires that person's older open links (at most ONE link is
--      ever live) and inserts the new one, bound to the address it is mailed to (issued_email). It stores a HASH;
--      the lib mails the raw link, and ONLY when the owner's delivery switches allow it
--      (lib/admin/email-confirm-shared.ts). /api/auth/verify is what the link opens: the person sets their own
--      password, the email is marked confirmed, they are signed in — through 11 below. The level floor (below 6 is
--      refused) is the twin of lib/roles.ts hasEmailAuth (pinned by the migration test). Nothing in this file
--      marks an email verified on anyone's behalf: a promoted manager is confirmed only by USING their link (11).
--   8. A ONE-TIME BACKFILL (B053, owner decision W07-2 a) — see EXISTING ROWS below.
--   9. sessions.reauth_failed_count + session_reauth_reserve(p_session) + session_reauth_clear(p_session) — NEW (B159,
--      owner decisions W07-3 a and W07-4 a). The re-check screens — the password step-up, and the PIN re-entered on
--      counts, the cash deposit and the checklist confirm — took unlimited guesses from anyone holding a signed-in
--      device (the recorded Phase 2 ruling "no lockout on re-checks", now reversed by the owner). The counter is PER
--      SESSION and never locks the ACCOUNT: session_reauth_reserve counts the attempt BEFORE the credential is
--      checked (so a burst cannot slip past, the B050 reasoning) and allows five; a sixth call — or any call on a
--      session already at five — REVOKES that session and answers { allowed: false }. A correct answer calls
--      session_reauth_clear. The app signs the device out on the fifth wrong answer (the person signs in again; a
--      sign-in is where the account lockout lives). '< 5' is the twin of lib/auth-lockout-shared.ts REAUTH_LIMIT.
--  10. password_resets.issued_email + auth_password_reset_issue(p_user, p_email, p_seen_password_hash, p_token_hash,
--      p_expires_at) — NEW (review round 1; completes B052 and B157). 5 and 6 retire the reset links that EXIST when
--      they run, but the request route read the account and then inserted its token in a separate request: a request
--      that read the OLD address, paused while an admin changed the email (retiring nothing — the link was not there
--      yet), then inserted, mailed a usable link to the old mailbox. The same gap let a link land behind a reset's or
--      an admin password set's "retire every open link". Now the link is ISSUED here, in one transaction under the
--      per-person advisory key and the users row lock (the two every retirer holds through its retirement), after
--      re-checking on the LOCKED row everything the request decided on: the email it looked up ('email_changed'),
--      active ('user_inactive'), level 6+ ('role_not_email_auth'), email verified ('email_not_verified') and the
--      password hash it read ('credential_changed' — the reset generation). So against any retirer R: this commits
--      first and R retires the link, or R commits first and this inserts nothing. The link also carries the address
--      it was issued for (issued_email), and auth_password_reset_consume (4) refuses 'email_changed' for an account
--      that is no longer at that address — the same rule a second time, independent of the retirement. A link with
--      no address (issued before this file) is guarded by the retirements alone, as before. Rate limits are the
--      app's and are untouched (the per-email throttle still runs before anything is read).
--  11. email_verifications.issued_email + auth_email_confirm_consume(p_token_hash, p_password_hash) — NEW (review
--      round 1; completes B053). /api/auth/verify consumed the link, THEN hashed the password, THEN wrote the
--      password and email_verified in a separate request. While it hashed, an admin could change the person's email
--      (6 retires the link — but it was already consumed) or demote them: the route still overwrote the password,
--      marked the REPLACEMENT address verified and signed the person in; its role check was a snapshot. A failed
--      write also left the link consumed for good. Now the route hashes FIRST and this function does the rest in
--      one transaction under the per-person advisory key and the users row lock: the link is re-checked
--      ('token_invalid' / 'token_consumed' / 'token_expired'), then the PERSON on the locked row — still level 6+
--      ('role_not_email_auth'), still at the address the link was mailed to ('email_changed'), active
--      ('account_inactive') — then the password hash and email_verified are written, the link (and any reset link)
--      consumed and the sessions revoked. Any refusal or failure rolls all of it back: nothing written, the link
--      still usable. A link with no address on it (inserted before this file) skips only the address comparison.
--
-- LOCK ORDER (unchanged from 0279): the identity lock → the per-person advisory lock → users rows → password_resets /
--   email_verifications / sessions. auth_reserve_attempt and auth_create_session each take ONE users row lock (the mint then
--   inserts its own sessions row); neither can deadlock. auth_password_reset_consume takes the 0279 per-person
--   advisory key, then the users row, then the token row, then the person's other links and sessions — never a
--   password_resets or sessions row before the users row. auth_password_reset_issue takes the same per-person
--   advisory key, then the users row, then inserts its password_resets row — the consumer's order, one person per
--   call. auth_email_confirm_consume is the reset consumer's twin on email_verifications: the per-person advisory
--   key, the users row, its link row, then the person's other links (email_verifications, password_resets) and
--   sessions. session_reauth_reserve / _clear touch ONE sessions row and no users row, so they add no edge to that order.
--   Why issuance is safe against every retirer: each retirer (admin_user_update_profile, admin_user_set_credential,
--   auth_password_reset_consume) holds that advisory key AND the users row FOR UPDATE from before its retirement to
--   its commit, and the issuer holds the same two from before its checks to its commit — the two transactions run
--   one after the other, never interleaved. (PGlite is one connection: scripts/sql-harness-0307.mjs proves each
--   commit order and what each function holds; the two-session wait is CC's sim check, as for 0279.)
--
-- EXISTING ROWS: none rewritten by sections 1–2. An account sitting on an expired lock restarts at its next attempt.
--   B159: sessions.reauth_failed_count is added NOT NULL DEFAULT 0 — every existing session starts at 0, no table rewrite.
--   B053 (owner decision W07-2 a: "unstick the people already promoted and blocked today"): every level-6+ person who
--   HAS an email and is not yet marked verified is marked verified, once, by this file — the same admin-vouched
--   state admin_user_create gives a manager a GM creates. No email is sent. ONE audit row
--   (user.email_vouch_backfill, destructive, actor_context migration_apply) lists the ids. Run the PRE-FLIGHT count
--   first and record it here before the prod apply. A promoted person with NO email on file is not touched (there
--   is nothing to vouch): a GM enters the email and the confirm-your-email link does the rest.
--
-- APP COMPATIBILITY: this file can be applied BEFORE or AFTER the code of audit wave W07 ships.
--   Code first, file later — every caller of a function CREATED here falls back while it is missing (PGRST202 /
--   42883), pinned by tests/auth-lockout-reset-migration.test.ts:
--     auth_reserve_attempt         lib/auth-flows.ts reserveAttempt → the old read of locked_until; failures counted by
--                                  increment_failed_login as before (B049 / B050 stay open until the apply)
--     auth_create_session          lib/session.ts createSession → the old plain insert + separate counter reset (B051 open)
--     auth_password_reset_consume  the reset route → its old consume / write / revoke steps (B156 / B157 open)
--     auth_password_reset_issue    the reset-request route → its old plain insert (the issuance race stays open)
--     auth_email_confirm_consume   the verify route → its old consume / write / revoke steps. (No link issued by 7
--                                  can exist before this file is applied, so that path only ever sees older links.)
--     auth_email_confirm_issue     lib/admin/email-confirm.ts → outcome 'not_installed': nothing issued, nothing sent
--     session_reauth_reserve/clear lib/auth-reauth.ts → the re-check is not counted (B159 open)
--   File first, code later — the three RE-EMITTED functions keep their signatures and only ADD keys to their jsonb
--   answers, so the code in production today keeps working; B052, B158, the admin half of B157 and the B053 backfill
--   take effect at the apply with no deploy.
--
-- DEPENDS ON: users (failed_login_count, locked_until, last_login_at, pin_hash, password_hash, email, active), sessions
--   (id, user_id, token_hash, auth_method, step_up_unlocked, last_activity_at, expires_at, ip_address, user_agent),
--   password_resets and email_verifications (id, user_id, token_hash, expires_at, consumed_at; this file ADDS
--   issued_email to both), audit_log, 0076 (increment_failed_login), 0279.
--
-- PRE-FLIGHT (MCP, read-only, before apply):
--   select count(*) from users where failed_login_count >= 5 and locked_until <= now();  -- accounts B049 frees on their next try
--   select count(*) from password_resets where consumed_at is null and expires_at > now();  -- open reset links right now
--   select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'sessions'
--     and column_name = 'reauth_failed_count';  -- 0 (not applied yet)
--   select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'issued_email'
--     and table_name in ('password_resets', 'email_verifications');  -- 0 (not applied yet)
--   select id, name, role, active from users where not coalesce(email_verified, false) and email is not null and btrim(email) <> ''
--     and coalesce(public.user_admin_role_level(role), 0) >= 6;  -- the B053 backfill: WHO gets marked verified (record the count)
--   select count(*) from users where coalesce(public.user_admin_role_level(role), 0) >= 6 and (email is null or btrim(email) = '');
--     -- managers with no email at all: NOT touched by the backfill; a GM must enter one
--
-- VERIFY AFTER APPLY:
--   select proname, prosecdef, proconfig from pg_proc where proname in ('auth_reserve_attempt', 'increment_failed_login',
--     'auth_create_session', 'auth_password_reset_consume', 'admin_user_set_credential', 'admin_user_update_profile',
--     'auth_email_confirm_issue', 'session_reauth_reserve', 'session_reauth_clear', 'auth_password_reset_issue',
--     'auth_email_confirm_consume');
--     -- t, {search_path=pg_catalog, public} on each
--   select count(*) from users where not coalesce(email_verified, false) and email is not null and btrim(email) <> ''
--     and coalesce(public.user_admin_role_level(role), 0) >= 6;  -- 0 (the backfill ran)
--   select metadata from audit_log where action = 'user.email_vouch_backfill';  -- one row when the count above was > 0 before apply
--   select column_default, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'sessions'
--     and column_name = 'reauth_failed_count';  -- 0, NO
--   select routine_name, grantee from information_schema.routine_privileges where routine_schema = 'public'
--    and routine_name in ('auth_reserve_attempt', 'increment_failed_login', 'auth_create_session', 'auth_password_reset_consume',
--      'admin_user_set_credential', 'admin_user_update_profile', 'auth_email_confirm_issue',
--      'session_reauth_reserve', 'session_reauth_clear', 'auth_password_reset_issue',
--      'auth_email_confirm_consume');  -- service_role (+ postgres) only
--   select table_name, column_name, is_nullable from information_schema.columns where table_schema = 'public'
--     and column_name = 'issued_email';  -- password_resets and email_verifications, YES (existing links keep NULL)
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
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sessions'
              and column_name = 'reauth_failed_count') then
    raise exception '0307: already applied (sessions.reauth_failed_count exists)';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'password_resets'
       and column_name in ('id', 'user_id', 'token_hash', 'expires_at', 'consumed_at')) <> 5 then
    raise exception '0307: password_resets (id, user_id, token_hash, expires_at, consumed_at) must exist';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'password_resets'
              and column_name = 'issued_email') then
    raise exception '0307: already applied (password_resets.issued_email exists)';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'email_verifications'
              and column_name = 'issued_email') then
    raise exception '0307: already applied (email_verifications.issued_email exists)';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'email_verifications'
       and column_name in ('id', 'user_id', 'token_hash', 'expires_at', 'consumed_at')) <> 5 then
    raise exception '0307: email_verifications (id, user_id, token_hash, expires_at, consumed_at) must exist';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'audit_log'
       and column_name in ('actor_id', 'actor_role', 'action', 'resource_table', 'resource_id', 'destructive', 'metadata')) <> 7 then
    raise exception '0307: audit_log must exist with the columns the backfill row writes';
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
  if to_regprocedure('public.admin_user_update_profile(uuid,uuid,jsonb)') is null
     or to_regprocedure('public.user_admin_identity_lock()') is null then
    raise exception '0307: 0279 (user_admin_lock and the user-admin writers) must be applied first';
  end if;
  select prosrc into v_def from pg_proc where oid = 'public.admin_user_update_profile(uuid,uuid,jsonb)'::regprocedure;
  if strpos(v_def, 'if v_email_changed then') = 0
     or strpos(v_def, 'perform public.user_admin_identity_lock();') = 0
     or strpos(v_def, 'perform public.user_admin_lock(p_actor, p_user);') = 0
     or strpos(v_def, 'password_resets') > 0 or strpos(v_def, 'email_verifications') > 0 then
    raise exception '0307: admin_user_update_profile differs from 0279: refusing to overwrite it';
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

-- ── 3a. The address a link was issued for (10, 12) ──
-- NULL = a link issued before this file (or by the app's pre-0307 fallback): such a link is guarded by the
-- retirements alone, exactly as before. A link issued by this file's functions carries the lowercased address of
-- the LOCKED users row, and its consumer refuses it for an account that now sits at any other address.
alter table public.password_resets add column issued_email text;
comment on column public.password_resets.issued_email is
  '0307 (audit W07 B052, review round 1): the lowercased account email this reset link was issued for, written by '
  'auth_password_reset_issue under the users row lock. auth_password_reset_consume refuses the link (email_changed) '
  'when the account is no longer at that address. NULL = issued before 0307 / by the pre-0307 fallback.';
alter table public.email_verifications add column issued_email text;
comment on column public.email_verifications.issued_email is
  '0307 (audit W07 B053, review round 1): the lowercased address this "confirm your email" link was mailed to, written '
  'by auth_email_confirm_issue under the user-admin gate. auth_email_confirm_consume confirms ONLY that address '
  '(email_changed otherwise). NULL = a link inserted before 0307.';

-- ── 4. B156 + B157: the whole self-service reset in ONE transaction ──
-- The route hashes the new password first (bcrypt is slow and must not run inside the transaction), then calls this.
create function public.auth_password_reset_consume(p_token_hash text, p_password_hash text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_user uuid; v_role text; v_email text; v_id uuid; v_expires timestamptz; v_consumed timestamptz; v_issued text;
  v_retired integer := 0; v_revoked integer := 0; v_now timestamptz;
begin
  if p_token_hash is null or p_token_hash = '' or p_password_hash is null or char_length(p_password_hash) not between 20 and 255 then
    raise exception 'invalid_payload';
  end if;
  -- Learn whose link this is WITHOUT a lock, so the locks below are taken in the 0279 order.
  select user_id into v_user from public.password_resets where token_hash = p_token_hash;
  if not found then raise exception 'token_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('user-employment/' || v_user::text, 0));
  select role, email into v_role, v_email from public.users where id = v_user for update;
  if not found then raise exception 'token_invalid'; end if;
  select id, expires_at, consumed_at, issued_email into v_id, v_expires, v_consumed, v_issued
    from public.password_resets where token_hash = p_token_hash for update;
  if not found then raise exception 'token_invalid'; end if;
  v_now := clock_timestamp();
  if v_consumed is not null then raise exception 'token_consumed'; end if;
  if v_expires <= v_now then raise exception 'token_expired'; end if;
  -- Review round 1: a link is good only for the address it was issued for (B052, independent of the retirement).
  if v_issued is not null and v_issued is distinct from lower(btrim(v_email)) then raise exception 'email_changed'; end if;
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
  'Refusals: token_invalid, token_consumed, token_expired, email_changed, invalid_payload. A failure leaves the link usable.';
revoke all on function public.auth_password_reset_consume(text, text) from public, anon, authenticated;
grant execute on function public.auth_password_reset_consume(text, text) to service_role;

-- ── 4a. B052 / B157, review round 1: ISSUE a reset link under the retirers' locks ──
-- The route passes what it READ (the account, the email it looked up, the password hash stored then). Under the
-- per-person advisory key and the users row lock — the two every retirer holds through its retirement — this
-- re-checks all of it on the LOCKED row and only then inserts. So for any retirer R (an email change, an admin
-- password set, a reset): this commits first and R's `update password_resets … where consumed_at is null` (a
-- statement that starts after R got the row lock, so it SEES the new link) retires it; or R commits first and this
-- sees R's row — a changed email or a changed password hash — and inserts nothing.
create function public.auth_password_reset_issue(p_user uuid, p_email text, p_seen_password_hash text, p_token_hash text,
  p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_role text; v_active boolean; v_email text; v_verified boolean; v_pw text; v_now timestamptz; v_id uuid;
begin
  -- A SHA-256 hex digest, never a raw token.
  if p_user is null or p_email is null or btrim(p_email) = '' or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_expires_at is null then
    raise exception 'invalid_payload';
  end if;
  -- The 0279 order: the per-person advisory key, then the users row.
  perform pg_advisory_xact_lock(hashtextextended('user-employment/' || p_user::text, 0));
  select role, active, email, coalesce(email_verified, false), password_hash into v_role, v_active, v_email, v_verified, v_pw
    from public.users where id = p_user for update;
  if not found then raise exception 'user_not_found'; end if;
  -- Everything the request decided on, judged again on the locked row.
  if v_email is null or lower(btrim(v_email)) is distinct from lower(btrim(p_email)) then raise exception 'email_changed'; end if;
  if not coalesce(v_active, false) then raise exception 'user_inactive'; end if;
  -- Manager sign-in exists only at level 6+ (the twin of lib/roles.ts hasEmailAuth).
  if coalesce(public.user_admin_role_level(v_role), 0) < 6 then raise exception 'role_not_email_auth'; end if;
  if not v_verified then raise exception 'email_not_verified'; end if;
  -- The password generation: a reset or an admin password set that committed after the request's read retired the
  -- links that existed THEN; this request must not add one behind it.
  if v_pw is distinct from p_seen_password_hash then raise exception 'credential_changed'; end if;
  v_now := clock_timestamp();
  -- A reset link is short-lived (lib/auth-lockout-shared.ts PASSWORD_RESET_EXPIRES_HOURS = 1; 2 hours is the ceiling).
  if p_expires_at <= v_now or p_expires_at > v_now + interval '2 hours' then raise exception 'invalid_payload'; end if;
  insert into public.password_resets (user_id, token_hash, expires_at, issued_email)
    values (p_user, p_token_hash, p_expires_at, lower(btrim(v_email)))
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'email', lower(btrim(v_email)), 'role', v_role);
end $$;
comment on function public.auth_password_reset_issue(uuid, text, text, text, timestamptz) is
  '0307 (audit W07 B052/B157, review round 1): issues a self-service reset link (a token HASH) in one transaction under '
  'the per-person advisory lock and the users row lock, only while the account is still at the requested email, on '
  'the password hash the request read, active, level 6+ and email-verified. Returns {id, email, role}. Refusals: '
  'user_not_found, email_changed, user_inactive, role_not_email_auth, email_not_verified, credential_changed, invalid_payload.';
revoke all on function public.auth_password_reset_issue(uuid, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.auth_password_reset_issue(uuid, text, text, text, timestamptz) to service_role;

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

-- ── 6. admin_user_update_profile: 0279's writer, re-emitted. Identical but for the lines marked 0307. ──
create or replace function public.admin_user_update_profile(p_actor uuid, p_user uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_key text; v_name text; v_phone text; v_email text; v_old_email text; v_fields text[] := '{}'; v_revoked integer := 0;
  v_email_changed boolean := false;
  v_retired integer := 0;  -- 0307
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'invalid_payload'; end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('name', 'phone', 'email') then raise exception 'invalid_payload'; end if;
    if jsonb_typeof(p_patch -> v_key) not in ('string', 'null') then raise exception 'invalid_payload'; end if;
  end loop;
  -- RANK 1 first: this writer changes phones (Astra BC-007/004 r3) — the identity lock, then the gate (ranks 2 and 3).
  perform public.user_admin_identity_lock();
  perform public.user_admin_lock(p_actor, p_user);
  select email into v_old_email from public.users where id = p_user;
  if p_patch ? 'name' then
    v_name := btrim(coalesce(p_patch ->> 'name', ''));
    if v_name = '' then raise exception 'invalid_name'; end if;
    update public.users set name = v_name where id = p_user;
    v_fields := array_append(v_fields, 'name');
  end if;
  if p_patch ? 'phone' then
    v_phone := nullif(btrim(coalesce(p_patch ->> 'phone', '')), '');
    if char_length(v_phone) > 40 then raise exception 'invalid_payload'; end if;
    update public.users set phone = v_phone where id = p_user;
    v_fields := array_append(v_fields, 'phone');
  end if;
  if p_patch ? 'email' then
    v_email := nullif(lower(btrim(coalesce(p_patch ->> 'email', ''))), '');
    if v_email is not null and exists (select 1 from public.users where lower(email) = v_email and id <> p_user) then
      raise exception 'email_taken';
    end if;
    begin
      update public.users set email = v_email where id = p_user;
    exception when unique_violation then
      get stacked diagnostics v_old_email = constraint_name;
      if v_old_email ilike '%email%' then raise exception 'email_taken'; end if;
      raise;
    end;
    v_fields := array_append(v_fields, 'email');
    v_email_changed := v_email is distinct from v_old_email;
  end if;
  if v_email_changed then
    -- 0307 B052: a reset link mailed to the OLD address must not set the password of the account at the new one.
    update public.password_resets set consumed_at = clock_timestamp() where user_id = p_user and consumed_at is null;
    get diagnostics v_retired = row_count;
    -- 0307 B053: nor may a "confirm your email" link mailed to the old address confirm the new one.
    update public.email_verifications set consumed_at = clock_timestamp() where user_id = p_user and consumed_at is null;
    update public.sessions set revoked_at = clock_timestamp() where user_id = p_user and revoked_at is null;
    get diagnostics v_revoked = row_count;
  end if;
  return jsonb_build_object('fields', to_jsonb(v_fields), 'email_changed', v_email_changed, 'sessions_revoked', v_revoked,
    'reset_links_retired', v_retired);  -- 0307: + reset_links_retired
end $$;
revoke all on function public.admin_user_update_profile(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.admin_user_update_profile(uuid, uuid, jsonb) to service_role;

-- ── 7. B053: issue a "confirm your email" link (the lib mails it only when the owner's delivery switches allow) ──
create function public.auth_email_confirm_issue(p_actor uuid, p_user uuid, p_token_hash text, p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_ctx jsonb; v_email text; v_verified boolean; v_now timestamptz; v_retired integer := 0; v_id uuid;
begin
  -- A SHA-256 hex digest, never a raw token.
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_expires_at is null then raise exception 'invalid_payload'; end if;
  -- The ONE gate (0279): the per-person lock, the target row FOR UPDATE, the actor rule on the locked rows.
  v_ctx := public.user_admin_lock(p_actor, p_user);
  select email, coalesce(email_verified, false) into v_email, v_verified from public.users where id = p_user;
  -- Manager sign-in exists only at level 6+ (lib/roles.ts hasEmailAuth), and only for an active person.
  if not coalesce((v_ctx ->> 'target_active')::boolean, false) or coalesce((v_ctx ->> 'target_level')::integer, 0) < 6 then
    raise exception 'email_confirm_not_available';
  end if;
  if v_email is null or btrim(v_email) = '' then raise exception 'email_required'; end if;
  if v_verified then raise exception 'email_already_confirmed'; end if;
  v_now := clock_timestamp();
  if p_expires_at <= v_now or p_expires_at > v_now + interval '7 days' then raise exception 'invalid_payload'; end if;
  -- At most ONE live link per person: a newer email replaces every older one.
  update public.email_verifications set consumed_at = v_now where user_id = p_user and consumed_at is null;
  get diagnostics v_retired = row_count;
  -- Review round 1: the link is bound to the address it is mailed to (the LOCKED row's).
  insert into public.email_verifications (user_id, token_hash, expires_at, issued_email)
    values (p_user, p_token_hash, p_expires_at, lower(btrim(v_email)))
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'email', lower(btrim(v_email)), 'links_retired', v_retired);
end $$;
comment on function public.auth_email_confirm_issue(uuid, uuid, text, timestamptz) is
  '0307 (audit W07 B053): behind user_admin_lock, issues the one live "confirm your email" link (a token HASH) for an '
  'active level-6+ person whose email is not yet confirmed, retiring older links. Returns {id, email, links_retired}. '
  'Refusals: email_confirm_not_available, email_required, email_already_confirmed, invalid_payload + the gate''s.';
revoke all on function public.auth_email_confirm_issue(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.auth_email_confirm_issue(uuid, uuid, text, timestamptz) to service_role;

-- ── 7a. B053, review round 1: USE a "confirm your email" link — ONE transaction ──
-- The route hashes the new password FIRST (bcrypt is slow and must not run inside the transaction, nor between the
-- consume and the write), then calls this. Under the per-person advisory key and the users row lock — the two the
-- email change (6), the role change, the deactivation and the issuer (7) hold through 0279's gate — it re-checks the
-- link AND the person, then writes the password + the verification, consumes the link and revokes the sessions.
-- An admin change that lands while the route is hashing is therefore SEEN here, and any refusal or failure rolls
-- everything back: nothing is written and the link is exactly as it was.
create function public.auth_email_confirm_consume(p_token_hash text, p_password_hash text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_user uuid; v_role text; v_active boolean; v_email text; v_id uuid; v_expires timestamptz; v_consumed timestamptz;
  v_issued text; v_retired integer := 0; v_revoked integer := 0; v_now timestamptz;
begin
  if p_token_hash is null or p_token_hash = '' or p_password_hash is null or char_length(p_password_hash) not between 20 and 255 then
    raise exception 'invalid_payload';
  end if;
  -- Learn whose link this is WITHOUT a lock, so the locks below are taken in the 0279 order.
  select user_id into v_user from public.email_verifications where token_hash = p_token_hash;
  if not found then raise exception 'token_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('user-employment/' || v_user::text, 0));
  select role, active, email into v_role, v_active, v_email from public.users where id = v_user for update;
  if not found then raise exception 'token_invalid'; end if;
  select id, expires_at, consumed_at, issued_email into v_id, v_expires, v_consumed, v_issued
    from public.email_verifications where token_hash = p_token_hash for update;
  if not found then raise exception 'token_invalid'; end if;
  v_now := clock_timestamp();
  if v_consumed is not null then raise exception 'token_consumed'; end if;
  if v_expires <= v_now then raise exception 'token_expired'; end if;
  -- The PERSON, on the locked row. Still a manager role (the twin of lib/roles.ts hasEmailAuth) …
  if coalesce(public.user_admin_role_level(v_role), 0) < 6 then raise exception 'role_not_email_auth'; end if;
  -- … still at the address the link was mailed to (an email change also retires the link; this is the same rule
  -- on the link itself, so a link can never confirm a replacement address) …
  if v_email is null or btrim(v_email) = '' or (v_issued is not null and v_issued is distinct from lower(btrim(v_email))) then
    raise exception 'email_changed';
  end if;
  -- … and active: an inactive account gets no password and no confirmation.
  if not coalesce(v_active, false) then raise exception 'account_inactive'; end if;
  -- The credential and the verification, together.
  update public.users set password_hash = p_password_hash, email_verified = true, email_verified_at = v_now where id = v_user;
  -- This link (and any other still open: at most one is ever live).
  update public.email_verifications set consumed_at = v_now where user_id = v_user and consumed_at is null;
  -- A password was just set: an open reset link must not overwrite it (the B157 rule, for every password writer).
  update public.password_resets set consumed_at = v_now where user_id = v_user and consumed_at is null;
  get diagnostics v_retired = row_count;
  -- A first password is a credential change: retire the pre-confirmation (PIN) sessions.
  update public.sessions set revoked_at = v_now where user_id = v_user and revoked_at is null;
  get diagnostics v_revoked = row_count;
  return jsonb_build_object('verification_id', v_id, 'user_id', v_user, 'role', v_role, 'email', lower(btrim(v_email)),
    'sessions_revoked', v_revoked, 'reset_links_retired', v_retired);
end $$;
comment on function public.auth_email_confirm_consume(text, text) is
  '0307 (audit W07 B053, review round 1): uses a "confirm your email" link in one transaction under the per-person '
  'advisory lock and the users row lock — re-checks the link and the person (level 6+, the address the link was '
  'mailed to, active), writes the password hash + email_verified, consumes the link, retires reset links, revokes '
  'sessions. Returns {verification_id, user_id, role, email, sessions_revoked, reset_links_retired}. Refusals: '
  'token_invalid, token_consumed, token_expired, role_not_email_auth, email_changed, account_inactive, invalid_payload. '
  'A refusal or a failure writes nothing and leaves the link usable.';
revoke all on function public.auth_email_confirm_consume(text, text) from public, anon, authenticated;
grant execute on function public.auth_email_confirm_consume(text, text) to service_role;

-- ── 8. EXISTING ROWS — B053, owner decision W07-2 a: unstick the managers already blocked ──
-- Admin-vouched, exactly as admin_user_create does for a manager a GM creates: level 6+, an email on file, not yet
-- marked verified. Not filtered on active (a manager reactivated later must not be stuck again). No email is sent.
do $$
declare v_ids uuid[];
begin
  with vouched as (
    update public.users set email_verified = true, email_verified_at = clock_timestamp()
     where not coalesce(email_verified, false) and email is not null and btrim(email) <> ''
       and coalesce(public.user_admin_role_level(role), 0) >= 6
    returning id)
  select coalesce(array_agg(id order by id), '{}') into v_ids from vouched;
  if cardinality(v_ids) > 0 then
    insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
    values (null, null, 'user.email_vouch_backfill', 'users', null, true,
      jsonb_build_object('actor_context', 'migration_apply', 'migration', '0307_auth_lockout_reset_hardening',
        'reason', 'audit W07 B053: managers promoted into a level-6+ role were never marked email-verified and could not use manager sign-in',
        'count', cardinality(v_ids), 'user_ids', to_jsonb(v_ids)));
  end if;
  raise notice '0307: B053 backfill marked % manager email(s) verified', cardinality(v_ids);
end $$;

-- ── 9. B159: the per-session re-check counter (the ACCOUNT is never locked; the SESSION is signed out) ──
alter table public.sessions add column reauth_failed_count integer not null default 0
  constraint sessions_reauth_failed_count_nonneg check (reauth_failed_count >= 0);
comment on column public.sessions.reauth_failed_count is
  '0307 (audit W07 B159): wrong password / PIN re-checks in a row on this session. Counted by session_reauth_reserve '
  'BEFORE the check, cleared by a correct answer; at 5 the session is revoked. Never an account lockout.';

create function public.session_reauth_reserve(p_session uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_n integer; v_revoked integer := 0;
begin
  if p_session is null then raise exception 'invalid_payload'; end if;
  -- ONE statement decides and counts: concurrent re-checks on one session queue on its row, so exactly five get through.
  update public.sessions set reauth_failed_count = reauth_failed_count + 1
   where id = p_session and revoked_at is null and reauth_failed_count < 5   -- the twin of REAUTH_LIMIT
  returning reauth_failed_count into v_n;
  if found then return jsonb_build_object('allowed', true, 'attempt', v_n); end if;
  -- Out of attempts (or already revoked / unknown): the session ends here, whatever the caller does next.
  update public.sessions set revoked_at = clock_timestamp() where id = p_session and revoked_at is null;
  get diagnostics v_revoked = row_count;
  return jsonb_build_object('allowed', false, 'session_revoked', v_revoked > 0);
end $$;
comment on function public.session_reauth_reserve(uuid) is
  '0307 (audit W07 B159): reserves one password / PIN re-check on a live session BEFORE the credential is checked. '
  '{allowed:true, attempt:1..5} while under the limit; otherwise revokes the session and returns {allowed:false, session_revoked}.';
revoke all on function public.session_reauth_reserve(uuid) from public, anon, authenticated;
grant execute on function public.session_reauth_reserve(uuid) to service_role;

create function public.session_reauth_clear(p_session uuid)
returns void language sql security definer set search_path = pg_catalog, public as $$
  update public.sessions set reauth_failed_count = 0 where id = p_session and reauth_failed_count <> 0
$$;
comment on function public.session_reauth_clear(uuid) is
  '0307 (audit W07 B159): a correct password / PIN re-check ends the run of wrong ones on that session.';
revoke all on function public.session_reauth_clear(uuid) from public, anon, authenticated;
grant execute on function public.session_reauth_clear(uuid) to service_role;

-- ── POST-APPLY: every function this file creates or re-emits is definer, search_path pinned, service_role only ──
do $$
declare
  v_fn text; f regprocedure;
  v_fns text[] := array[
    'public.auth_reserve_attempt(uuid)',
    'public.increment_failed_login(uuid)',
    'public.auth_create_session(uuid,uuid,text,text,text,text,text,timestamptz,text,text)',
    'public.auth_password_reset_consume(text,text)',
    'public.auth_password_reset_issue(uuid,text,text,text,timestamptz)',
    'public.admin_user_set_credential(uuid,uuid,text,text)',
    'public.admin_user_update_profile(uuid,uuid,jsonb)',
    'public.auth_email_confirm_issue(uuid,uuid,text,timestamptz)',
    'public.auth_email_confirm_consume(text,text)',
    'public.session_reauth_reserve(uuid)',
    'public.session_reauth_clear(uuid)'
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
  -- The re-emitted 0279 writers still take the ONE gate (and the profile writer the identity lock before it).
  if strpos((select prosrc from pg_proc where oid = 'public.admin_user_set_credential(uuid,uuid,text,text)'::regprocedure),
            'perform public.user_admin_lock(p_actor, p_user);') = 0 then
    raise exception '0307: admin_user_set_credential lost its gate';
  end if;
  select prosrc into v_fn from pg_proc where oid = 'public.admin_user_update_profile(uuid,uuid,jsonb)'::regprocedure;
  if strpos(v_fn, 'perform public.user_admin_identity_lock();') = 0
     or strpos(v_fn, 'perform public.user_admin_lock(p_actor, p_user);') < strpos(v_fn, 'perform public.user_admin_identity_lock();') then
    raise exception '0307: admin_user_update_profile lost its identity lock or its gate';
  end if;
  -- The backfill left nobody behind.
  if exists (select 1 from public.users where not coalesce(email_verified, false) and email is not null and btrim(email) <> ''
              and coalesce(public.user_admin_role_level(role), 0) >= 6) then
    raise exception '0307: the B053 backfill left an unverified level-6+ email';
  end if;
end $$;

commit;
