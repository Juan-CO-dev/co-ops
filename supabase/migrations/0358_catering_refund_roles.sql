-- Migration 0358_catering_refund_roles
-- AUTHORED 2026-11-26 (refund round 2 Part A, CO CC Fable lead, for CC). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod on Juan's word.
-- APPLIED TO SIM 2026-11-26 UTC (schema_migrations version 20261126055240, name '0358_catering_refund_roles')
-- APPLIED TO PROD 2026-11-27 UTC (schema_migrations version 20261127204650, name '0358_catering_refund_roles')
-- NUMBER: 0357 is the highest on main; 0358 is claimed for this build in co-ops-wt/.mig-claims (Part A only).
-- Plan: co-ops-wt/PLAN-refund2.md revision 2, PART A (A1 to A7). Astra's re-check: Part A = GO. Parts B1 / B2 of that
--   plan are NOT in this file and are not approved.
-- Juan 2026-11-25 (ruling 1): GM and AGM may refund a catering order from inside the app, at a shop they belong to.
--   Ships DARK like 0357: the app refuses every refund unless CATERING_REFUNDS=1 (lib/catering/refunds-shared.ts), and
--   that switch is unset everywhere. Applying this file turns nothing on.
--
-- WHAT THIS IS. ONE function is re-emitted FROM 0357: public.catering_refund_actor_ok(uuid, uuid), THE actor rule the
--   reserve (0357 catering_refund_reserve) and the retry's re-check (lib/catering/refunds.ts) both ask. Same signature,
--   same return type, same language, SECURITY DEFINER, the same pinned search_path, the same first statement (the
--   FOR SHARE read of the active users row). ONE change in the body: the membership branch reads
--     v_role in ('moo', 'catering_mgr', 'gm', 'agm')        (0357: v_role in ('moo', 'catering_mgr'))
--   so a GM or an AGM passes exactly as a MoO or a catering manager does: an ACTIVE user with an ACTIVE user_locations
--   row at the order's shop. Owner / CGS stay any-shop. Everyone else, an inactive user and an inactive or missing
--   membership stay false. It is a ROLE list, never a level: level 6 also holds prep_mgr and social_media_mgr, who
--   stay out. The app's twin is REFUND_ROLES (lib/catering/refunds-shared.ts), held equal by
--   tests/catering-refund-0358-migration.test.ts.
--   No table, column, trigger, policy, index or other function is created, altered or dropped. No row is read for a
--   decision or written. 0357's file is not edited.
--
-- PRE-FLIGHT (in this file; it refuses a drifted database by name and changes nothing):
--   0357's two tables and its six functions exist; catering_refund_actor_ok has exactly one overload; the live body
--   is 0357's by TWO fingerprints that must both match: the house one (md5 of prosrc with every non-printing character
--   removed, the 0354 convention) and an EXACT one that keeps every character inside a line, string literals included
--   (md5 of prosrc with only its line breaks, and the whitespace around them, normalized). The house one alone cannot
--   see a space inside a literal ('catering_ mgr' reads as 'catering_mgr'); the exact one can (review, Astra P2).
--   A live body that is already this file's = "already applied". Any other body = a later definer exists: re-emit
--   from it.
-- PRIVILEGES (stated again, never inherited): revoke all from PUBLIC, anon and authenticated; grant EXECUTE to
--   service_role. CREATE OR REPLACE keeps the function's ACL, so this is a restatement; the assertions below prove it.
-- ASSERTIONS (in this file, after the replace; any failure raises and the transaction changes nothing):
--   the function is SECURITY DEFINER, plpgsql, volatile, returns boolean, and its only setting is the pinned
--   search_path; its body is this file's; PUBLIC, anon and authenticated cannot execute it and service_role can;
--   and 0357's OTHER privileges are still 0357's (compared, not rewritten): its other five functions are not
--   executable by PUBLIC, anon or authenticated, its four RPCs are executable by service_role and are SECURITY DEFINER
--   with the pinned search_path; on catering_refund_requests service_role holds table SELECT and UPDATE on exactly
--   0357's nine outcome / claim columns and nothing else; on catering_refund_stripe_snapshots service_role holds
--   SELECT only; PUBLIC, anon and authenticated hold nothing on either table or any of their columns; both tables are
--   RLS-enabled with no policy.
--   THE WHOLE ACL, not four named roles (review, Astra P1 / P2): on each of the six functions nobody but the owner
--   and service_role holds any privilege, and service_role holds no grant option; each table's ACL, the owner's own
--   entry aside, is exactly `service_role=SELECT`, and the column ACLs are exactly the nine `service_role=UPDATE`
--   (none on the snapshots table) -- so another role, a grant option, or Postgres 17's MAINTAIN is refused by name.
--   The guard trigger is 0357's: that name, enabled, BEFORE UPDATE FOR EACH ROW, calling
--   catering_refund_requests_guard() with no arguments, on EVERY update: no column list (UPDATE OF ...) and no WHEN
--   condition, either of which would let some updates through unguarded (re-check, Astra P2).
--   A grant this file does not expect is REFUSED, never silently revoked: who put it there is a question for a person.
-- DEPLOY ORDER: safe both ways. App first: the SQL rule still answers `forbidden` to a GM / AGM. This file first: the
--   app's role list still refuses them before the database is asked. Nothing opens until both are in, and the switch
--   is off regardless.
-- LOCKS: CREATE OR REPLACE FUNCTION takes no table lock; a call already running finishes on the old body.
-- DEPENDS ON: 0357 only (applied to sim 2026-11-24 and prod 2026-11-25).
-- SIM, STATED EXACTLY: the sim apply above ran this file as it stood at commit f9ebc936. The post-build review then
--   strengthened the PRE-FLIGHT and the ASSERTIONS only (the exact fingerprint, the whole-ACL checks, the trigger's
--   identity). The function, the REVOKE and the GRANT are unchanged, so what is live on the sim is what this file
--   creates. The strengthened blocks were then run against the sim in a rolled-back transaction (the pre-flight
--   answers "already applied"; the assertion block passes on the real Supabase ACLs).
-- PROOF: scripts/sql-harness-0358.mjs (PGlite, the REAL 0357 then the REAL 0358), CI-pinned by
--   tests/catering-refund-0358-migration.test.ts.
-- PRE-FLIGHT (read-only, before apply): the house fingerprint, then the exact one.
--   select md5(regexp_replace(prosrc, '[^\x21-\x7E]+', '', 'g')) from pg_proc where oid = 'public.catering_refund_actor_ok(uuid, uuid)'::regprocedure; -- e33880cdb5aab577a829ef45c2afa61a
--   select md5(btrim(regexp_replace(prosrc, '\s*[\r\n]+\s*', E'\n', 'g'), E' \t\r\n')) from pg_proc where oid = 'public.catering_refund_actor_ok(uuid, uuid)'::regprocedure; -- b08aab6eb05f8ec251ea2cf8e3785af5
-- VERIFY AFTER APPLY:
--   select md5(regexp_replace(prosrc, '[^\x21-\x7E]+', '', 'g')) from pg_proc where oid = 'public.catering_refund_actor_ok(uuid, uuid)'::regprocedure; -- 4076029ec89d7b777af23ff3d8fcbdee
--   select md5(btrim(regexp_replace(prosrc, '\s*[\r\n]+\s*', E'\n', 'g'), E' \t\r\n')) from pg_proc where oid = 'public.catering_refund_actor_ok(uuid, uuid)'::regprocedure; -- d78c4f8d7e4aa13351cde97c7541b884
--   select has_function_privilege('authenticated', 'public.catering_refund_actor_ok(uuid, uuid)', 'EXECUTE');           -- false
--   select has_function_privilege('service_role', 'public.catering_refund_actor_ok(uuid, uuid)', 'EXECUTE');            -- true
-- ROLLBACK: reverting the APP change alone withdraws the permission (the SQL rule is reachable only through
--   service-role code that checks the app's role list first). To restore the SQL rule too: a NEW migration that
--   re-emits this function with 0357's body (kept verbatim in 0357's file and in scripts/sql-harness-0358.mjs) and the
--   same revoke / grant / assertions. No data is involved. Never edit or delete this file once applied.
begin;

-- ── Pre-flight: 0357 is here, and the body this file replaces is 0357's ─────────────────────────────────
do $$
declare
  t text;
  v_live text;   -- the house fingerprint (every non-printing character removed)
  v_exact text;  -- the exact fingerprint (only line breaks and the whitespace around them normalized)
begin
  foreach t in array array['catering_refund_requests', 'catering_refund_stripe_snapshots', 'users', 'user_locations'] loop
    if to_regclass('public.' || t) is null then raise exception '0358: public.% is missing (0357 must be applied first)', t; end if;
  end loop;
  foreach t in array array['catering_refund_actor_ok(uuid, uuid)', 'catering_refund_figures(uuid)',
                           'catering_refund_reserve(uuid, uuid, uuid, bigint, text, text, text)', 'catering_refund_claim(uuid)',
                           'catering_refund_record_snapshot(uuid, timestamptz, bigint, jsonb)', 'catering_refund_requests_guard()'] loop
    if to_regprocedure('public.' || t) is null then
      raise exception '0358: function public.% is missing (0357 must be applied first)', t;
    end if;
  end loop;
  if (select count(*) from pg_proc p where p.proname = 'catering_refund_actor_ok' and p.pronamespace = 'public'::regnamespace) <> 1 then
    raise exception '0358: public.catering_refund_actor_ok has more than one overload. Refusing.';
  end if;
  select md5(regexp_replace(p.prosrc, '[^\x21-\x7E]+', '', 'g')),
         md5(btrim(regexp_replace(p.prosrc, '\s*[\r\n]+\s*', E'\n', 'g'), E' \t\r\n'))
    into v_live, v_exact from pg_proc p
   where p.oid = 'public.catering_refund_actor_ok(uuid, uuid)'::regprocedure;
  if v_live = '4076029ec89d7b777af23ff3d8fcbdee' and v_exact = 'd78c4f8d7e4aa13351cde97c7541b884' then
    raise exception '0358: already applied';
  end if;
  -- The live body this file replaces must be 0357's, character for character inside every line (a later definer, or
  -- a body that differs only by a space inside a string literal, would be silently lost).
  if v_live is distinct from 'e33880cdb5aab577a829ef45c2afa61a' or v_exact is distinct from 'b08aab6eb05f8ec251ea2cf8e3785af5' then
    raise exception '0358: the live body of public.catering_refund_actor_ok(uuid, uuid) (md5 %, exact %) is not its 0357 definition -- a later definer exists; re-emit from it. Refusing.', v_live, v_exact;
  end if;
end $$;

-- ── The actor rule, re-emitted FROM 0357 with one change: gm and agm join the membership branch ─────────
create or replace function public.catering_refund_actor_ok(p_actor_id uuid, p_shop_id uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_role text;
begin
  select u.role into v_role from public.users u where u.id = p_actor_id and u.active for share;
  if v_role is null then return false; end if;
  if v_role in ('owner', 'cgs') then return true; end if;
  if v_role in ('moo', 'catering_mgr', 'gm', 'agm') and p_shop_id is not null and exists (
       select 1 from public.user_locations m where m.user_id = p_actor_id and m.location_id = p_shop_id and m.active) then
    return true;
  end if;
  return false;
end $$;

-- ── Privileges, stated again and not inherited ──────────────────────────────────────────────────────────
revoke all on function public.catering_refund_actor_ok(uuid, uuid) from public, anon, authenticated;
grant execute on function public.catering_refund_actor_ok(uuid, uuid) to service_role;

-- ── Assertions (raise = nothing in this file is kept) ───────────────────────────────────────────────────
do $$
declare
  f regprocedure;
  r text;
  t text;
  c text;
  v_fn pg_proc%rowtype;
  v_cols text;
  v_acl text;
begin
  -- (1) The re-emitted function: what it is.
  select * into v_fn from pg_proc p where p.oid = 'public.catering_refund_actor_ok(uuid, uuid)'::regprocedure;
  if not v_fn.prosecdef then raise exception '0358: catering_refund_actor_ok is not SECURITY DEFINER'; end if;
  if v_fn.provolatile <> 'v' or v_fn.prorettype <> 'boolean'::regtype or v_fn.proretset
     or v_fn.prolang <> (select l.oid from pg_language l where l.lanname = 'plpgsql') then
    raise exception '0358: catering_refund_actor_ok changed shape (volatility, return type or language)';
  end if;
  if v_fn.proconfig is null or array_length(v_fn.proconfig, 1) <> 1
     or replace(v_fn.proconfig[1], ' ', '') <> 'search_path=pg_catalog,public' then
    raise exception '0358: catering_refund_actor_ok search_path is not pinned to pg_catalog, public (%)', v_fn.proconfig;
  end if;
  if md5(regexp_replace(v_fn.prosrc, '[^\x21-\x7E]+', '', 'g')) <> '4076029ec89d7b777af23ff3d8fcbdee'
     or md5(btrim(regexp_replace(v_fn.prosrc, '\s*[\r\n]+\s*', E'\n', 'g'), E' \t\r\n')) <> 'd78c4f8d7e4aa13351cde97c7541b884' then
    raise exception '0358: the body written is not this file''s (md5 %)', md5(regexp_replace(v_fn.prosrc, '[^\x21-\x7E]+', '', 'g'));
  end if;

  -- (2) Who may execute it, and 0357's other five functions (compared with what 0357 granted, not rewritten).
  foreach f in array array[
    'public.catering_refund_actor_ok(uuid, uuid)'::regprocedure,
    'public.catering_refund_figures(uuid)'::regprocedure,
    'public.catering_refund_reserve(uuid, uuid, uuid, bigint, text, text, text)'::regprocedure,
    'public.catering_refund_claim(uuid)'::regprocedure,
    'public.catering_refund_record_snapshot(uuid, timestamptz, bigint, jsonb)'::regprocedure,
    'public.catering_refund_requests_guard()'::regprocedure] loop
    foreach r in array array['public', 'anon', 'authenticated'] loop
      if has_function_privilege(r, f, 'EXECUTE') then raise exception '0358: % may execute % (RPC escape)', r, f; end if;
    end loop;
    -- PUBLIC again, straight from the ACL (grantee 0), so the check does not rest on the pseudo-role's name alone.
    if exists (select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.oid = f and a.grantee = 0) then
      raise exception '0358: PUBLIC holds a privilege on % (RPC escape)', f;
    end if;
    -- THE WHOLE ACL: nobody but the owner and service_role holds anything on it (any other role that kept an EXECUTE
    -- across the replace is an escape the three names above would not see), and service_role cannot grant it on.
    if exists (select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.oid = f and a.grantee <> p.proowner
                  and (a.grantee <> 'service_role'::regrole::oid or a.is_grantable)) then
      raise exception '0358: % has an unexpected grantee or a grant option in its ACL (RPC escape)', f;
    end if;
    if f <> 'public.catering_refund_requests_guard()'::regprocedure then
      if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception '0358: service_role cannot execute %', f; end if;
      if not (select p.prosecdef and p.proconfig is not null and array_length(p.proconfig, 1) = 1
                     and replace(p.proconfig[1], ' ', '') = 'search_path=pg_catalog,public' from pg_proc p where p.oid = f) then
        raise exception '0358: % is not SECURITY DEFINER with the pinned search_path', f;
      end if;
    end if;
  end loop;

  -- (3) 0357's two tables: still deny-all RLS, still 0357's grants and nothing more.
  foreach t in array array['public.catering_refund_requests', 'public.catering_refund_stripe_snapshots'] loop
    if not (select cl.relrowsecurity from pg_class cl where cl.oid = t::regclass) then raise exception '0358: RLS is off on %', t; end if;
    if exists (select 1 from pg_policy po where po.polrelid = t::regclass) then raise exception '0358: % has a policy', t; end if;
    foreach r in array array['public', 'anon', 'authenticated'] loop
      foreach c in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
        if has_table_privilege(r, t, c) then raise exception '0358: % holds % on %', r, c, t; end if;
      end loop;
      foreach c in array array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] loop
        if has_any_column_privilege(r, t, c) then raise exception '0358: % holds column % on %', r, c, t; end if;
      end loop;
    end loop;
    if not has_table_privilege('service_role', t, 'SELECT') then raise exception '0358: service_role cannot SELECT %', t; end if;
    foreach c in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege('service_role', t, c) then raise exception '0358: service_role holds table-level % on %', c, t; end if;
    end loop;
    if has_any_column_privilege('service_role', t, 'INSERT') or has_any_column_privilege('service_role', t, 'REFERENCES') then
      raise exception '0358: service_role holds a column INSERT / REFERENCES on %', t;
    end if;
    -- THE WHOLE table ACL, the owner's own entry aside: exactly service_role SELECT, with no grant option. This is
    -- what catches another role, a grant option, and Postgres 17's MAINTAIN, which the named checks above do not.
    select coalesce(string_agg(x.e, ',' order by x.e), '') into v_acl from (
      select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end || '=' || a.privilege_type
             || case when a.is_grantable then '*' else '' end as e
        from pg_class cl, lateral aclexplode(coalesce(cl.relacl, acldefault('r', cl.relowner))) a
       where cl.oid = t::regclass and a.grantee <> cl.relowner) x;
    if v_acl <> 'service_role=SELECT' then
      raise exception '0358: the ACL of % is not 0357''s (%)', t, v_acl;
    end if;
    -- THE WHOLE column ACL: exactly 0357's nine UPDATE grants on the requests table, none on the snapshots table.
    select coalesce(string_agg(x.e, ',' order by x.e), '') into v_acl from (
      select att.attname::text || ':' || case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end || '=' || a.privilege_type
             || case when a.is_grantable then '*' else '' end as e
        from pg_attribute att, lateral aclexplode(att.attacl) a
       where att.attrelid = t::regclass and att.attnum > 0 and not att.attisdropped and att.attacl is not null) x;
    if v_acl <> (case when t = 'public.catering_refund_requests' then
         'claim_token:service_role=UPDATE,claimed_until:service_role=UPDATE,last_error_code:service_role=UPDATE,last_error_message:service_role=UPDATE,settled_at:service_role=UPDATE,status:service_role=UPDATE,stripe_refund_id:service_role=UPDATE,stripe_status:service_role=UPDATE,updated_at:service_role=UPDATE'
         else '' end) then
      raise exception '0358: the column ACL of % is not 0357''s (%)', t, v_acl;
    end if;
  end loop;
  select string_agg(a.attname::text, ',' order by a.attname::text) into v_cols
    from pg_attribute a
   where a.attrelid = 'public.catering_refund_requests'::regclass and a.attnum > 0 and not a.attisdropped
     and has_column_privilege('service_role', a.attrelid, a.attnum, 'UPDATE');
  if v_cols is distinct from 'claim_token,claimed_until,last_error_code,last_error_message,settled_at,status,stripe_refund_id,stripe_status,updated_at' then
    raise exception '0358: service_role UPDATE columns on catering_refund_requests are not 0357''s (%)', v_cols;
  end if;
  if has_any_column_privilege('service_role', 'public.catering_refund_stripe_snapshots', 'UPDATE') then
    raise exception '0358: service_role holds a column UPDATE on catering_refund_stripe_snapshots';
  end if;
  -- The guard trigger is 0357's own: that name, enabled, calling the guard function, BEFORE UPDATE FOR EACH ROW
  -- (pg_trigger.tgtype 19 = ROW 1 + BEFORE 2 + UPDATE 16). A same-named trigger on another event guards nothing.
  -- And it fires on EVERY update: no column list (tgattr empty: `UPDATE OF status` would skip a write to
  -- stripe_refund_id alone), no WHEN condition (tgqual null), no arguments.
  if (select count(*) from pg_trigger tg where tg.tgrelid = 'public.catering_refund_requests'::regclass
        and tg.tgname = 'catering_refund_requests_guard' and not tg.tgisinternal and tg.tgenabled = 'O'
        and tg.tgfoid = 'public.catering_refund_requests_guard()'::regprocedure and tg.tgtype = 19
        and tg.tgattr::text = '' and tg.tgqual is null and tg.tgnargs = 0) <> 1 then
    raise exception '0358: the catering_refund_requests_guard trigger is missing, disabled, or not 0357''s BEFORE UPDATE row trigger';
  end if;

  -- (4) It answers: nobody is nobody.
  if public.catering_refund_actor_ok(null, null) is distinct from false then
    raise exception '0358: catering_refund_actor_ok(null, null) did not answer false';
  end if;
end $$;

commit;
