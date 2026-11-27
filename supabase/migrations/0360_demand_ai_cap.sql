-- Migration 0360_demand_ai_cap
-- AUTHORED 2026-11-27 (demand AI cap raise, CO CC Fable lead, for CC). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod on Juan's word.
-- NUMBER: 0358 is the highest on main; 0359 (refund Part B) and 0361 (digest reserve) are claimed by other builds in
--   co-ops-wt/.mig-claims; 0360 is claimed there for this one. It touches no object of theirs.
-- Juan 2026-11-27: raise the Demand AI monthly spend ceiling. CC picked $50.00. Plan: co-ops-wt/PLAN-demand0360.md
--   revision 2 (plan check: Astra and a fresh Opus, both GO WITH CHANGES, every finding answered there).
--
-- WHAT THIS IS. ONE function is re-emitted FROM 0352: public.demand_ai_cap_ceiling_micro(), the most the demand-signals
--   AI insights may cost in one ET month, in microdollars, all shops together. 0352's statement, character for
--   character, with ONE literal changed:
--     select 50000000::bigint        (0352: select 5000000::bigint)       = $50.00 a month (was $5.00)
--   Same name, no arguments, returns bigint, language sql, IMMUTABLE, the same pinned search_path, NOT security definer,
--   the same owner and the same ACL. The app's twin is DEMAND_AI_CODE_CAP_MICRO (lib/demand-signals/insights-shared.ts),
--   held equal by tests/demand-signals-0360-migration.test.ts. A later definer of this function is re-emitted FROM 0360.
--   The two places that read it are 0352's and are NOT re-emitted: demand_ai_reserve refuses a caller's cap above it
--   (demand_ai_invalid), and demand_ai_today reports it. The environment value DEMAND_AI_MONTHLY_CAP_CENTS can still
--   only LOWER the cap.
--   NOT CHANGED: the per-reservation bound, 0352's table check `reserved_micro between 1 and 5000000`. A reservation is
--   ONE call's worst case: at most (16,000 bytes + 1,024) x 4 + 2,000 x 20 = 108,096 microdollars with today's prices
--   and limits, 46 times below that bound. The pre-flight names the check so this file says out loud that it stays.
--   No table, column, row, policy, trigger, index or other function is created, altered or dropped. No row is written.
--   0352's file is not edited.
--
-- PRE-FLIGHT (in this file; it refuses a drifted database by name and changes nothing):
--   0352's two tables and six functions exist; demand_ai_cap_ceiling_micro has exactly one overload; its live body is
--   0352's by TWO fingerprints that must both match (the 0358 convention: the house one = md5 of prosrc with every
--   non-printing character removed; the exact one = only line breaks, and the whitespace around them, normalized); a
--   live body that is already this file's = "already applied"; any other body = a later definer exists: re-emit from it.
--   The live VALUE is 5000000 (called, not only fingerprinted). Its shape is 0352's (a plain sql function, immutable,
--   bigint, no arguments, not security definer, its only setting the pinned search_path).
--   THE CODE THAT ENFORCES THE LIMIT IS 0352's TOO (plan check, Astra P2 / Opus P2): demand_ai_reserve,
--   demand_ai_month_spent_micro and demand_ai_today carry 0352's bodies by the same two fingerprints, so "the ceiling
--   is held in code and in the database" is true of the database this file is applied to.
--   All six 0352 functions are owned by postgres, and the WHOLE ACL of each is 0352's: nobody but the owner and
--   service_role holds anything, service_role holds EXECUTE with no grant option, PUBLIC / anon / authenticated cannot
--   execute. A grant this file does not expect is REFUSED, never silently revoked: who put it there is a question for
--   a person. The per-reservation check is 0352's (1 to 5000000).
-- PRIVILEGES (stated again, never inherited): revoke all from PUBLIC, anon and authenticated; grant EXECUTE to
--   service_role. CREATE OR REPLACE keeps the function's ACL, so this is a restatement; the assertions prove it. It is
--   0358's form, not 0352's literal statement (which also revoked from service_role before granting): the pre-flight
--   has already proved the ACL is exactly 0352's result, and service_role's grant is never removed, even for an instant.
-- ASSERTIONS (in this file, after the replace; any failure raises and the transaction keeps nothing):
--   the function returns exactly 50000000, a bigint, and its body is this file's by both fingerprints;
--   EQUAL TO BEFORE: its whole pg_proc row except the body (owner, ACL, settings, volatility, definer flag, language,
--   return type, arguments, cost, parallel, strict, leakproof) equals what the pre-flight stashed; the named shape, owner
--   and whole-ACL checks hold again on all six functions;
--   NOTHING ELSE IN public CHANGED: a digest of the catalog of schema public, taken by the pre-flight and again here,
--   is equal. EXACTLY what it covers (raw catalog columns, every aggregate in a fixed order): every other pg_proc row
--   (whole row); pg_class (name, kind, owner, ACL, row security flags, persistence, column and check counts, options,
--   replica identity, partition flag; NOT the statistics columns autovacuum moves); pg_attribute (name, type, typmod,
--   not null, default flag, identity, generated, dropped, collation, column ACL, options); pg_attrdef; pg_policy;
--   pg_trigger; pg_constraint; pg_index (not its transient validity flags); pg_rewrite (views and rules); pg_type and
--   pg_enum; pg_sequence (parameters, not the current value); the comments on its relations and functions; the
--   schema's own owner and ACL. NOT covered: table DATA, other schemas, default privileges, extensions, event triggers,
--   publications. A change by ANOTHER session between the two reads also refuses: nothing is applied; INVESTIGATE what
--   changed before running it again.
--   THE READER SEES IT: demand_ai_today(<the nil uuid>) reports cap_ceiling_micro = 50000000 (a pure read).
--   The pre-flight hands its two readings to the assertions in transaction-local settings (set_config(..., true));
--   a missing one raises, and every comparison is IS DISTINCT FROM (a NULL never passes).
-- NOT EXCLUDED, STATED (plan check, Astra P2): Postgres takes no lock on a function for CREATE OR REPLACE, and this
--   role cannot row-lock pg_proc. Another session that COMMITS its own definer of this one function between the
--   pre-flight statement and the re-emit below (consecutive statements of this transaction) would be overwritten
--   unseen. Migrations to this database are applied by one operator, through the pinned tooling.
-- DEPLOY ORDER: THIS FILE FIRST, THEN THE APP. Never the other way round.
--   This file first: the app still passes its own cap (5,000,000 <= 50,000,000). Nothing changes for anyone, and
--   applying this file alone raises nothing: the database only accepts what the app asks for.
--   App first: the new app passes 50,000,000 and 0352's demand_ai_reserve refuses EVERY request with demand_ai_invalid
--   (HTTP 400) until this file is applied. Nothing is sent and nothing is spent, but the feature is down.
--   So the PR that carries this file is merged only AFTER this file is on prod (the 0358 flow: applied from the
--   pinned PR head, header stamped, then merged).
-- CACHED PLANS: the function is IMMUTABLE, so the question is whether a session that already ran demand_ai_reserve
--   keeps the old constant. It does not: proven on the sim's Postgres 17.6 on two backends (a backend with warm plans
--   sees the ceiling another backend committed), with twins first and then with the real functions around the sim
--   apply (scratchpad demand-0360: two-session-twin-probe.out, apply-sim.out).
-- LOCKS: CREATE OR REPLACE FUNCTION takes no table lock; a call already running finishes on the old body. The
--   assertions read catalogs and call demand_ai_today (ACCESS SHARE on the two ledger tables, released at commit).
-- DEPENDS ON: 0352 only (applied to sim 2026-11-20 and prod 2026-11-20 UTC).
-- PROOF: tests/demand-signals-0360-harness.test.ts (PGlite: the REAL 0342, 0343 and 0352, then the REAL 0360) and
--   tests/demand-signals-0360-migration.test.ts (the file's shape, its fingerprints, code = migration).
-- PRE-FLIGHT (read-only, before apply): the house fingerprint, then the exact one, then the value.
--   select md5(regexp_replace(prosrc, '[^\x21-\x7E]+', '', 'g')) from pg_proc where oid = 'public.demand_ai_cap_ceiling_micro()'::regprocedure; -- 49a1a404ee56db730709500d5fe93f75
--   select md5(btrim(regexp_replace(prosrc, '\s*[\r\n]+\s*', E'\n', 'g'), E' \t\r\n')) from pg_proc where oid = 'public.demand_ai_cap_ceiling_micro()'::regprocedure; -- 1ab3425fc64bd3d111fb014488d8cffa
--   select public.demand_ai_cap_ceiling_micro();                                                                      -- 5000000
-- VERIFY AFTER APPLY:
--   select md5(regexp_replace(prosrc, '[^\x21-\x7E]+', '', 'g')) from pg_proc where oid = 'public.demand_ai_cap_ceiling_micro()'::regprocedure; -- 9b5eeb4964ab11ee7ee3242c3dc3d64d
--   select md5(btrim(regexp_replace(prosrc, '\s*[\r\n]+\s*', E'\n', 'g'), E' \t\r\n')) from pg_proc where oid = 'public.demand_ai_cap_ceiling_micro()'::regprocedure; -- e501588e358cf93f888cbcb4d4b21fb5
--   select public.demand_ai_cap_ceiling_micro();                                                                      -- 50000000
--   select has_function_privilege('authenticated', 'public.demand_ai_cap_ceiling_micro()', 'EXECUTE');                -- false
--   select has_function_privilege('service_role', 'public.demand_ai_cap_ceiling_micro()', 'EXECUTE');                 -- true
-- ROLLBACK: no migration is needed to bring the limit back down. Set DEMAND_AI_MONTHLY_CAP_CENTS=500 and REDEPLOY (an
--   environment change reaches only new deployments), or revert the app change: the app then passes at most
--   5,000,000 and the higher database ceiling is never reached. To lower the database ceiling too: FIRST make sure no
--   serving deployment can pass more than the new number (deploy, then let older deployments drain), THEN a NEW
--   migration that re-emits this function FROM 0360 with the lower number and the same pre-flight / revoke / grant /
--   assertions. Lowering it first refuses every request the same way "app first" does. Spend already in the ledger
--   stays; a month already above the lowered cap stops admitting requests. No data is involved. Never edit or delete
--   this file once applied.
begin;

-- ── Pre-flight: 0352 is here, untouched, and the body this file replaces is 0352's ──────────────────────
do $$
declare
  t text;
  f regprocedure;
  r text;
  v_fn regprocedure;
  v_row pg_proc%rowtype;
  v_house text;   -- the house fingerprint (every non-printing character removed)
  v_exact text;   -- the exact fingerprint (only line breaks and the whitespace around them normalized)
  v_acl text;
  v_digest text;
begin
  foreach t in array array['demand_ai_reservations', 'demand_ai_settlements'] loop
    if to_regclass('public.' || t) is null then raise exception '0360: public.% is missing (0352 must be applied first)', t; end if;
  end loop;
  foreach t in array array['demand_ai_cap_ceiling_micro()', 'demand_ai_month_spent_micro(date)',
                           'demand_ai_reserve(uuid,uuid,text,text,integer,bigint,bigint)', 'demand_ai_claims_valid(jsonb)',
                           'demand_ai_settle(uuid,text,integer,integer,bigint,text,text,jsonb,integer)', 'demand_ai_today(uuid)',
                           'demand_today_et()'] loop
    if to_regprocedure('public.' || t) is null then
      raise exception '0360: function public.% is missing (0352 must be applied first)', t;
    end if;
  end loop;
  if (select count(*) from pg_proc p where p.proname = 'demand_ai_cap_ceiling_micro' and p.pronamespace = 'public'::regnamespace) <> 1 then
    raise exception '0360: public.demand_ai_cap_ceiling_micro has more than one overload. Refusing.';
  end if;
  v_fn := 'public.demand_ai_cap_ceiling_micro()'::regprocedure;

  -- The body this file replaces: already this file's, or 0352's character for character, or refused.
  select md5(regexp_replace(p.prosrc, '[^\x21-\x7E]+', '', 'g')),
         md5(btrim(regexp_replace(p.prosrc, '\s*[\r\n]+\s*', E'\n', 'g'), E' \t\r\n'))
    into v_house, v_exact from pg_proc p where p.oid = v_fn;
  if v_house = '9b5eeb4964ab11ee7ee3242c3dc3d64d' and v_exact = 'e501588e358cf93f888cbcb4d4b21fb5' then
    raise exception '0360: already applied';
  end if;
  if v_house is distinct from '49a1a404ee56db730709500d5fe93f75' or v_exact is distinct from '1ab3425fc64bd3d111fb014488d8cffa' then
    raise exception '0360: the live body of public.demand_ai_cap_ceiling_micro() (md5 %, exact %) is not its 0352 definition -- a later definer exists; re-emit from it. Refusing.', v_house, v_exact;
  end if;
  if public.demand_ai_cap_ceiling_micro() is distinct from 5000000 then
    raise exception '0360: the live ceiling is % and not 0352''s 5000000. Refusing.', public.demand_ai_cap_ceiling_micro();
  end if;
  select * into v_row from pg_proc p where p.oid = v_fn;
  if v_row.prokind <> 'f' or v_row.provolatile <> 'i' or v_row.prosecdef or v_row.proretset or v_row.pronargs <> 0
     or v_row.prorettype <> 'bigint'::regtype or v_row.prosqlbody is not null
     or v_row.prolang <> (select l.oid from pg_language l where l.lanname = 'sql')
     or v_row.proconfig is null or array_length(v_row.proconfig, 1) <> 1
     or replace(v_row.proconfig[1], ' ', '') <> 'search_path=pg_catalog,public' then
    raise exception '0360: public.demand_ai_cap_ceiling_micro() is not 0352''s shape (plain sql, immutable, bigint, no arguments, not security definer, search_path pinned). Refusing.';
  end if;

  -- The code that ENFORCES the limit is 0352's too: the reserve, the month's accounting and the reader.
  for t, v_house, v_exact in select * from (values
      ('demand_ai_month_spent_micro(date)', 'df9b2c390e8656f8553ff3a3086cfca1', '0e6898abe3b82f4ed8fb652fbd149a16'),
      ('demand_ai_reserve(uuid,uuid,text,text,integer,bigint,bigint)', '9d51577f28a29aa028c330a526abfffc', 'a05f1889f3ee423466fa5ce133bfbd3f'),
      ('demand_ai_today(uuid)', 'c73869c6fb87710517dec2462ae6cb17', '20ff246a9df821d81a84a18623b40257')) x loop
    if (select md5(regexp_replace(p.prosrc, '[^\x21-\x7E]+', '', 'g')) from pg_proc p where p.oid = ('public.' || t)::regprocedure) is distinct from v_house
       or (select md5(btrim(regexp_replace(p.prosrc, '\s*[\r\n]+\s*', E'\n', 'g'), E' \t\r\n')) from pg_proc p where p.oid = ('public.' || t)::regprocedure) is distinct from v_exact then
      raise exception '0360: the live body of public.% is not its 0352 definition -- the code that enforces the ceiling has changed; review it and re-emit from the later definer. Refusing.', t;
    end if;
  end loop;

  -- Owner and the WHOLE ACL of all six 0352 functions (an unexpected grant is refused, never silently revoked).
  foreach f in array array[
    'public.demand_ai_cap_ceiling_micro()'::regprocedure,
    'public.demand_ai_month_spent_micro(date)'::regprocedure,
    'public.demand_ai_reserve(uuid,uuid,text,text,integer,bigint,bigint)'::regprocedure,
    'public.demand_ai_claims_valid(jsonb)'::regprocedure,
    'public.demand_ai_settle(uuid,text,integer,integer,bigint,text,text,jsonb,integer)'::regprocedure,
    'public.demand_ai_today(uuid)'::regprocedure] loop
    if (select p.proowner::regrole::text from pg_proc p where p.oid = f) is distinct from 'postgres' then
      raise exception '0360: % is not owned by postgres. Refusing.', f;
    end if;
    foreach r in array array['public', 'anon', 'authenticated'] loop
      if has_function_privilege(r, f, 'EXECUTE') then raise exception '0360: % may execute % (RPC escape). Refusing.', r, f; end if;
    end loop;
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception '0360: service_role cannot execute %. Refusing.', f; end if;
    select coalesce(string_agg(x.e, ',' order by x.e), '') into v_acl from (
      select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end || '=' || a.privilege_type
             || case when a.is_grantable then '*' else '' end as e
        from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where p.oid = f and a.grantee <> p.proowner) x;
    if v_acl is distinct from 'service_role=EXECUTE' then
      raise exception '0360: the ACL of % is not 0352''s (owner aside: %). An unexpected grant is refused, never silently revoked.', f, v_acl;
    end if;
  end loop;

  -- The per-reservation bound is 0352's, and this file leaves it: one call's worst case is far below it.
  if (select count(*) from pg_constraint co
       where co.conrelid = 'public.demand_ai_reservations'::regclass and co.contype = 'c'
         and regexp_replace(pg_get_constraintdef(co.oid), '[\s()]', '', 'g') = 'CHECKreserved_micro>=1ANDreserved_micro<=5000000') <> 1 then
    raise exception '0360: the per-reservation bound on demand_ai_reservations.reserved_micro is not 0352''s (1 to 5000000). This file does not change it. Refusing.';
  end if;

  -- Hand the two "before" readings to the assertions below (transaction-local).
  perform set_config('co_ops.m0360_fn_before', (select (to_jsonb(p) - 'prosrc')::text from pg_proc p where p.oid = v_fn), true);
  -- DIGEST-BEGIN (the same text is in the assertion block; tests/demand-signals-0360-migration.test.ts holds them equal)
  select concat_ws(' ',
    'fn:' || (select count(*)::text || ':' || coalesce(md5(string_agg(to_jsonb(p)::text, '|' order by p.oid)), '-')
                from pg_proc p where p.pronamespace = 'public'::regnamespace and p.oid <> v_fn),
    'rel:' || (select count(*)::text || ':' || coalesce(md5(string_agg(jsonb_build_array(c.oid, c.relname, c.relkind, c.relowner, c.relacl::text, c.relrowsecurity,
                  c.relforcerowsecurity, c.relpersistence, c.relnatts, c.relchecks, c.reloptions::text, c.relreplident, c.relispartition)::text, '|' order by c.oid)), '-')
                from pg_class c where c.relnamespace = 'public'::regnamespace),
    'col:' || (select count(*)::text || ':' || coalesce(md5(string_agg(jsonb_build_array(a.attrelid, a.attnum, a.attname, a.atttypid, a.atttypmod, a.attnotnull, a.atthasdef,
                  a.attidentity, a.attgenerated, a.attisdropped, a.attcollation, a.attacl::text, a.attoptions::text)::text, '|' order by a.attrelid, a.attnum)), '-')
                from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace = 'public'::regnamespace and a.attnum > 0),
    'def:' || (select count(*)::text || ':' || coalesce(md5(string_agg(jsonb_build_array(d.adrelid, d.adnum, d.adbin::text)::text, '|' order by d.adrelid, d.adnum)), '-')
                from pg_attrdef d join pg_class c on c.oid = d.adrelid where c.relnamespace = 'public'::regnamespace),
    'pol:' || (select count(*)::text || ':' || coalesce(md5(string_agg(jsonb_build_array(po.oid, po.polname, po.polrelid, po.polcmd, po.polpermissive, po.polroles::text,
                  po.polqual::text, po.polwithcheck::text)::text, '|' order by po.oid)), '-')
                from pg_policy po join pg_class c on c.oid = po.polrelid where c.relnamespace = 'public'::regnamespace),
    'trg:' || (select count(*)::text || ':' || coalesce(md5(string_agg(jsonb_build_array(tg.oid, tg.tgrelid, tg.tgname, tg.tgfoid, tg.tgtype, tg.tgenabled, tg.tgisinternal,
                  tg.tgconstraint, tg.tgdeferrable, tg.tginitdeferred, tg.tgnargs, tg.tgattr::text, encode(tg.tgargs, 'hex'), tg.tgqual::text)::text, '|' order by tg.oid)), '-')
                from pg_trigger tg join pg_class c on c.oid = tg.tgrelid where c.relnamespace = 'public'::regnamespace),
    'con:' || (select count(*)::text || ':' || coalesce(md5(string_agg(jsonb_build_array(co.oid, co.conname, co.contype, co.condeferrable, co.condeferred, co.convalidated,
                  co.conrelid, co.contypid, co.conindid, co.confrelid, co.confupdtype, co.confdeltype, co.confmatchtype, co.conkey::text, co.confkey::text,
                  co.conbin::text)::text, '|' order by co.oid)), '-')
                from pg_constraint co where co.connamespace = 'public'::regnamespace),
    'idx:' || (select count(*)::text || ':' || coalesce(md5(string_agg(jsonb_build_array(i.indexrelid, i.indrelid, i.indnatts, i.indnkeyatts, i.indisunique, i.indisprimary,
                  i.indisexclusion, i.indimmediate, i.indisreplident, i.indkey::text, i.indcollation::text, i.indclass::text, i.indoption::text, i.indexprs::text,
                  i.indpred::text)::text, '|' order by i.indexrelid)), '-')
                from pg_index i join pg_class c on c.oid = i.indexrelid where c.relnamespace = 'public'::regnamespace),
    'rul:' || (select count(*)::text || ':' || coalesce(md5(string_agg(jsonb_build_array(rw.oid, rw.rulename, rw.ev_class, rw.ev_type, rw.ev_enabled, rw.is_instead,
                  md5(rw.ev_qual::text), md5(rw.ev_action::text))::text, '|' order by rw.oid)), '-')
                from pg_rewrite rw join pg_class c on c.oid = rw.ev_class where c.relnamespace = 'public'::regnamespace),
    'typ:' || (select count(*)::text || ':' || coalesce(md5(string_agg(jsonb_build_array(ty.oid, ty.typname, ty.typtype, ty.typowner, ty.typacl::text, ty.typbasetype,
                  ty.typnotnull, ty.typdefault)::text, '|' order by ty.oid)), '-')
                from pg_type ty where ty.typnamespace = 'public'::regnamespace),
    'enm:' || (select count(*)::text || ':' || coalesce(md5(string_agg(jsonb_build_array(en.oid, en.enumtypid, en.enumsortorder, en.enumlabel)::text, '|' order by en.oid)), '-')
                from pg_enum en join pg_type ty on ty.oid = en.enumtypid where ty.typnamespace = 'public'::regnamespace),
    'seq:' || (select count(*)::text || ':' || coalesce(md5(string_agg(jsonb_build_array(sq.seqrelid, sq.seqtypid, sq.seqstart, sq.seqincrement, sq.seqmax, sq.seqmin,
                  sq.seqcache, sq.seqcycle)::text, '|' order by sq.seqrelid)), '-')
                from pg_sequence sq join pg_class c on c.oid = sq.seqrelid where c.relnamespace = 'public'::regnamespace),
    'cmt:' || (select count(*)::text || ':' || coalesce(md5(string_agg(jsonb_build_array(de.classoid, de.objoid, de.objsubid, de.description)::text, '|'
                  order by de.classoid, de.objoid, de.objsubid)), '-')
                from pg_description de
               where (de.classoid = 'pg_class'::regclass and de.objoid in (select c.oid from pg_class c where c.relnamespace = 'public'::regnamespace))
                  or (de.classoid = 'pg_proc'::regclass and de.objoid in (select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace))),
    'nsp:' || (select md5(jsonb_build_array(n.nspowner, n.nspacl::text)::text) from pg_namespace n where n.oid = 'public'::regnamespace))
    into v_digest;
  -- DIGEST-END
  if v_digest is null then raise exception '0360: the catalog digest could not be taken'; end if;
  perform set_config('co_ops.m0360_public_before', v_digest, true);
end $$;

-- ── The ceiling, re-emitted FROM 0352 with one change: 50000000 ($50.00 a month; 0352: 5000000) ──────────
create or replace function public.demand_ai_cap_ceiling_micro() returns bigint language sql immutable set search_path = pg_catalog, public as $$
  select 50000000::bigint
$$;

-- ── Privileges, stated again and not inherited ──────────────────────────────────────────────────────────
revoke all on function public.demand_ai_cap_ceiling_micro() from public, anon, authenticated;
grant execute on function public.demand_ai_cap_ceiling_micro() to service_role;

-- ── Assertions (raise = nothing in this file is kept) ───────────────────────────────────────────────────
do $$
declare
  f regprocedure;
  r text;
  v_fn regprocedure := 'public.demand_ai_cap_ceiling_micro()'::regprocedure;
  v_row pg_proc%rowtype;
  v_before text;
  v_now text;
  v_acl text;
  v_digest text;
begin
  -- (1) The new value: what it returns, and the body that returns it.
  if public.demand_ai_cap_ceiling_micro() is distinct from 50000000
     or pg_typeof(public.demand_ai_cap_ceiling_micro()) is distinct from 'bigint'::regtype then
    raise exception '0360: demand_ai_cap_ceiling_micro() does not return 50000000 as a bigint (%)', public.demand_ai_cap_ceiling_micro();
  end if;
  select * into v_row from pg_proc p where p.oid = v_fn;
  if md5(regexp_replace(v_row.prosrc, '[^\x21-\x7E]+', '', 'g')) is distinct from '9b5eeb4964ab11ee7ee3242c3dc3d64d'
     or md5(btrim(regexp_replace(v_row.prosrc, '\s*[\r\n]+\s*', E'\n', 'g'), E' \t\r\n')) is distinct from 'e501588e358cf93f888cbcb4d4b21fb5' then
    raise exception '0360: the body written is not this file''s (md5 %)', md5(regexp_replace(v_row.prosrc, '[^\x21-\x7E]+', '', 'g'));
  end if;
  if (select count(*) from pg_proc p where p.proname = 'demand_ai_cap_ceiling_micro' and p.pronamespace = 'public'::regnamespace) <> 1 then
    raise exception '0360: public.demand_ai_cap_ceiling_micro has more than one overload';
  end if;

  -- (2) Equal to before: everything about the function except its body (signature, immutability, search_path,
  --     owner, ACL). The stash must exist; a NULL never passes.
  v_before := current_setting('co_ops.m0360_fn_before', true);
  if v_before is null or v_before = '' then raise exception '0360: the pre-flight reading of the function is missing'; end if;
  select (to_jsonb(p) - 'prosrc')::text into v_now from pg_proc p where p.oid = v_fn;
  if v_now is distinct from v_before then
    raise exception '0360: demand_ai_cap_ceiling_micro() changed in more than its body (before %, now %)', v_before, v_now;
  end if;
  if v_row.prokind <> 'f' or v_row.provolatile <> 'i' or v_row.prosecdef or v_row.proretset or v_row.pronargs <> 0
     or v_row.prorettype <> 'bigint'::regtype or v_row.prosqlbody is not null
     or v_row.prolang <> (select l.oid from pg_language l where l.lanname = 'sql')
     or v_row.proconfig is null or array_length(v_row.proconfig, 1) <> 1
     or replace(v_row.proconfig[1], ' ', '') <> 'search_path=pg_catalog,public' then
    raise exception '0360: demand_ai_cap_ceiling_micro() changed shape (kind, volatility, definer flag, return type, language or search_path)';
  end if;
  foreach f in array array[
    'public.demand_ai_cap_ceiling_micro()'::regprocedure,
    'public.demand_ai_month_spent_micro(date)'::regprocedure,
    'public.demand_ai_reserve(uuid,uuid,text,text,integer,bigint,bigint)'::regprocedure,
    'public.demand_ai_claims_valid(jsonb)'::regprocedure,
    'public.demand_ai_settle(uuid,text,integer,integer,bigint,text,text,jsonb,integer)'::regprocedure,
    'public.demand_ai_today(uuid)'::regprocedure] loop
    if (select p.proowner::regrole::text from pg_proc p where p.oid = f) is distinct from 'postgres' then
      raise exception '0360: % is not owned by postgres', f;
    end if;
    foreach r in array array['public', 'anon', 'authenticated'] loop
      if has_function_privilege(r, f, 'EXECUTE') then raise exception '0360: % may execute % (RPC escape)', r, f; end if;
    end loop;
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception '0360: service_role cannot execute %', f; end if;
    select coalesce(string_agg(x.e, ',' order by x.e), '') into v_acl from (
      select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end || '=' || a.privilege_type
             || case when a.is_grantable then '*' else '' end as e
        from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where p.oid = f and a.grantee <> p.proowner) x;
    if v_acl is distinct from 'service_role=EXECUTE' then
      raise exception '0360: the ACL of % is not 0352''s (owner aside: %)', f, v_acl;
    end if;
  end loop;

  -- (3) Nothing else in the catalog of schema public changed between the pre-flight and here.
  v_before := current_setting('co_ops.m0360_public_before', true);
  if v_before is null or v_before = '' then raise exception '0360: the pre-flight catalog digest is missing'; end if;
  -- DIGEST-BEGIN (the same text is in the pre-flight block)
  select concat_ws(' ',
    'fn:' || (select count(*)::text || ':' || coalesce(md5(string_agg(to_jsonb(p)::text, '|' order by p.oid)), '-')
                from pg_proc p where p.pronamespace = 'public'::regnamespace and p.oid <> v_fn),
    'rel:' || (select count(*)::text || ':' || coalesce(md5(string_agg(jsonb_build_array(c.oid, c.relname, c.relkind, c.relowner, c.relacl::text, c.relrowsecurity,
                  c.relforcerowsecurity, c.relpersistence, c.relnatts, c.relchecks, c.reloptions::text, c.relreplident, c.relispartition)::text, '|' order by c.oid)), '-')
                from pg_class c where c.relnamespace = 'public'::regnamespace),
    'col:' || (select count(*)::text || ':' || coalesce(md5(string_agg(jsonb_build_array(a.attrelid, a.attnum, a.attname, a.atttypid, a.atttypmod, a.attnotnull, a.atthasdef,
                  a.attidentity, a.attgenerated, a.attisdropped, a.attcollation, a.attacl::text, a.attoptions::text)::text, '|' order by a.attrelid, a.attnum)), '-')
                from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace = 'public'::regnamespace and a.attnum > 0),
    'def:' || (select count(*)::text || ':' || coalesce(md5(string_agg(jsonb_build_array(d.adrelid, d.adnum, d.adbin::text)::text, '|' order by d.adrelid, d.adnum)), '-')
                from pg_attrdef d join pg_class c on c.oid = d.adrelid where c.relnamespace = 'public'::regnamespace),
    'pol:' || (select count(*)::text || ':' || coalesce(md5(string_agg(jsonb_build_array(po.oid, po.polname, po.polrelid, po.polcmd, po.polpermissive, po.polroles::text,
                  po.polqual::text, po.polwithcheck::text)::text, '|' order by po.oid)), '-')
                from pg_policy po join pg_class c on c.oid = po.polrelid where c.relnamespace = 'public'::regnamespace),
    'trg:' || (select count(*)::text || ':' || coalesce(md5(string_agg(jsonb_build_array(tg.oid, tg.tgrelid, tg.tgname, tg.tgfoid, tg.tgtype, tg.tgenabled, tg.tgisinternal,
                  tg.tgconstraint, tg.tgdeferrable, tg.tginitdeferred, tg.tgnargs, tg.tgattr::text, encode(tg.tgargs, 'hex'), tg.tgqual::text)::text, '|' order by tg.oid)), '-')
                from pg_trigger tg join pg_class c on c.oid = tg.tgrelid where c.relnamespace = 'public'::regnamespace),
    'con:' || (select count(*)::text || ':' || coalesce(md5(string_agg(jsonb_build_array(co.oid, co.conname, co.contype, co.condeferrable, co.condeferred, co.convalidated,
                  co.conrelid, co.contypid, co.conindid, co.confrelid, co.confupdtype, co.confdeltype, co.confmatchtype, co.conkey::text, co.confkey::text,
                  co.conbin::text)::text, '|' order by co.oid)), '-')
                from pg_constraint co where co.connamespace = 'public'::regnamespace),
    'idx:' || (select count(*)::text || ':' || coalesce(md5(string_agg(jsonb_build_array(i.indexrelid, i.indrelid, i.indnatts, i.indnkeyatts, i.indisunique, i.indisprimary,
                  i.indisexclusion, i.indimmediate, i.indisreplident, i.indkey::text, i.indcollation::text, i.indclass::text, i.indoption::text, i.indexprs::text,
                  i.indpred::text)::text, '|' order by i.indexrelid)), '-')
                from pg_index i join pg_class c on c.oid = i.indexrelid where c.relnamespace = 'public'::regnamespace),
    'rul:' || (select count(*)::text || ':' || coalesce(md5(string_agg(jsonb_build_array(rw.oid, rw.rulename, rw.ev_class, rw.ev_type, rw.ev_enabled, rw.is_instead,
                  md5(rw.ev_qual::text), md5(rw.ev_action::text))::text, '|' order by rw.oid)), '-')
                from pg_rewrite rw join pg_class c on c.oid = rw.ev_class where c.relnamespace = 'public'::regnamespace),
    'typ:' || (select count(*)::text || ':' || coalesce(md5(string_agg(jsonb_build_array(ty.oid, ty.typname, ty.typtype, ty.typowner, ty.typacl::text, ty.typbasetype,
                  ty.typnotnull, ty.typdefault)::text, '|' order by ty.oid)), '-')
                from pg_type ty where ty.typnamespace = 'public'::regnamespace),
    'enm:' || (select count(*)::text || ':' || coalesce(md5(string_agg(jsonb_build_array(en.oid, en.enumtypid, en.enumsortorder, en.enumlabel)::text, '|' order by en.oid)), '-')
                from pg_enum en join pg_type ty on ty.oid = en.enumtypid where ty.typnamespace = 'public'::regnamespace),
    'seq:' || (select count(*)::text || ':' || coalesce(md5(string_agg(jsonb_build_array(sq.seqrelid, sq.seqtypid, sq.seqstart, sq.seqincrement, sq.seqmax, sq.seqmin,
                  sq.seqcache, sq.seqcycle)::text, '|' order by sq.seqrelid)), '-')
                from pg_sequence sq join pg_class c on c.oid = sq.seqrelid where c.relnamespace = 'public'::regnamespace),
    'cmt:' || (select count(*)::text || ':' || coalesce(md5(string_agg(jsonb_build_array(de.classoid, de.objoid, de.objsubid, de.description)::text, '|'
                  order by de.classoid, de.objoid, de.objsubid)), '-')
                from pg_description de
               where (de.classoid = 'pg_class'::regclass and de.objoid in (select c.oid from pg_class c where c.relnamespace = 'public'::regnamespace))
                  or (de.classoid = 'pg_proc'::regclass and de.objoid in (select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace))),
    'nsp:' || (select md5(jsonb_build_array(n.nspowner, n.nspacl::text)::text) from pg_namespace n where n.oid = 'public'::regnamespace))
    into v_digest;
  -- DIGEST-END
  if v_digest is distinct from v_before then
    raise exception '0360: something else in schema public changed while this ran (before %, now %). Nothing is applied. Investigate what changed before running it again.', v_before, v_digest;
  end if;

  -- (4) The reader reports it (0352's demand_ai_today, a pure read; the nil uuid is no shop).
  if (public.demand_ai_today('00000000-0000-0000-0000-000000000000'::uuid) ->> 'cap_ceiling_micro') is distinct from '50000000' then
    raise exception '0360: demand_ai_today does not report the new ceiling';
  end if;
end $$;

commit;
