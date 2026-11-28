-- Migration 0360_demand_ai_cap
-- AUTHORED 2026-11-27 (demand AI cap raise, CO CC Fable lead, for CC). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod on Juan's word.
-- APPLIED TO SIM 2026-11-27 UTC (schema_migrations version 20261127233259, name '0360_demand_ai_cap')
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
--   A database whose ledger RECORDS 0360 while the body is 0352's again was lowered on purpose after 0360: refused,
--   this file never raises it a second time (review, Astra P2; a database with no Supabase ledger has nothing to say).
--   The live VALUE is 5000000 (called, not only fingerprinted).
--   THE CODE THAT ENFORCES THE LIMIT IS 0352's TOO (plan check, Astra P2 / Opus P2): demand_ai_reserve,
--   demand_ai_month_spent_micro and demand_ai_today carry 0352's bodies by the same two fingerprints, so "the ceiling
--   is held in code and in the database" is true of the database this file is applied to.
--   WHAT EACH OF THE SIX 0352 FUNCTIONS IS, not only its text (review, Astra P2: a reserve made STABLE keeps its source
--   and then fails every reservation at its FOR SHARE): language, volatility, definer flag, return type, argument count,
--   a plain function that returns no set and is not strict, leakproof or parallel-marked, its only setting the pinned
--   search_path. All six are owned by postgres, and the WHOLE ACL of each, the owner's own entry and every grantor
--   included, is exactly 0352's: postgres and service_role hold EXECUTE, both granted by postgres, no grant option,
--   nobody else (review, Astra P2 / Opus P3: an owner who lost EXECUTE, or a grant made by another role, is refused
--   here and not later). PUBLIC / anon / authenticated cannot execute. A grant this file does not expect is REFUSED,
--   never silently revoked: who put it there is a question for a person. The per-reservation check is 0352's.
-- PRIVILEGES (stated again, never inherited): revoke all from PUBLIC, anon and authenticated; grant EXECUTE to
--   service_role. CREATE OR REPLACE keeps the function's ACL, so this is a restatement; the assertions prove it. It is
--   0358's form, not 0352's literal statement (which also revoked from service_role before granting): the pre-flight
--   has already proved the ACL is exactly 0352's result, and service_role's grant is never removed, even for an instant.
-- ASSERTIONS (in this file, after the replace; any failure raises and the transaction keeps nothing):
--   the function returns exactly 50000000, a bigint, and its body is this file's by both fingerprints;
--   EQUAL TO BEFORE: its whole pg_proc row except the body (owner, ACL, settings, volatility, definer flag, language,
--   return type, arguments, cost, parallel, strict, leakproof) equals what the pre-flight stashed; the shape, owner and
--   whole-ACL checks hold again on all six functions;
--   THE CATALOG OF SCHEMA public IS OTHERWISE AS THE PRE-FLIGHT READ IT: a digest taken by the pre-flight and again
--   here is equal. EXACTLY what it compares (every aggregate in a fixed order): the WHOLE row of every other pg_proc
--   entry, and the whole rows of pg_class, pg_attrdef, pg_policy, pg_trigger, pg_constraint, pg_index, pg_rewrite (views
--   and rules), pg_type, pg_enum and pg_sequence for the schema's objects, EXCEPT these columns, which other sessions'
--   maintenance moves: pg_class reltuples, relpages, relallvisible, relallfrozen, relfrozenxid, relminmxid, relfilenode,
--   relhasindex, relhasrules, relhastriggers, relhassubclass; pg_index indisvalid, indisready, indislive, indcheckxmin.
--   For pg_attribute a named list of columns (everything but the statistics target and the missing-value array):
--   name, type, length, typmod, dimensions, by-value, alignment, STORAGE, compression, not null, default and missing
--   flags, identity, generated, dropped, local, inheritance count, collation, column ACL, options, FDW options. Also
--   the comments on its relations and functions, and the schema's own owner and ACL.
--   NOT compared (so "otherwise as the pre-flight read it" means the list above and nothing more): table DATA,
--   sequence positions, other schemas, operators, casts, collations, extended statistics, inheritance and partition
--   links, dependencies, default privileges, extensions, event triggers, publications. No statement of this file can
--   touch any of them. A change by ANOTHER session between the two reads also refuses: nothing is applied;
--   INVESTIGATE what changed before running it again.
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
--   App first: the new app passes its cap, 50,000,000 unless DEMAND_AI_MONTHLY_CAP_CENTS lowers it, and 0352's
--   demand_ai_reserve refuses EVERY request whose cap is above 5,000,000 with demand_ai_invalid (HTTP 400) until this
--   file is applied. (With the environment value at 500 or less the new app asks for at most $5.00 and is admitted as
--   before.) Nothing is sent and nothing is spent, but the feature is down.
--   So the PR that carries this file is merged only AFTER this file is on prod (the 0358 flow: applied from the
--   pinned PR head, header stamped, then merged).
-- CACHED PLANS: the function is IMMUTABLE, so the question is whether a session that already ran demand_ai_reserve
--   keeps the old constant. It does not: proven on the sim's Postgres 17.6 on two backends, with twins first and then
--   with the real functions around the sim apply. A backend that had run the reserve's comparison and the reader
--   eight times under 5,000,000 (same backend pid before and after) refused a 50,000,001 cap, admitted a 50,000,000
--   cap and reported 50000000 once another backend had committed this file. The outputs are kept with the build
--   record (co-ops-wt/READY-demand0360.md names them).
-- LOCKS: CREATE OR REPLACE FUNCTION takes no table lock; a call already running finishes on the old body. The
--   assertions read catalogs and call demand_ai_today (ACCESS SHARE on the two ledger tables, released at commit).
-- DEPENDS ON: 0352 only (applied to sim 2026-11-20 and prod 2026-11-20 UTC).
-- SIM, STATED EXACTLY: the sim apply above ran this file as it stood at commit 99386ef6. The post-build review then
--   strengthened the PRE-FLIGHT and the ASSERTIONS only (the ledger check, what each of the six functions is, the
--   whole ACL with the owner's entry and the grantors, more of the catalog in the digest) and the wording of this
--   header. The function, the REVOKE and the GRANT are unchanged, so what is live on the sim is what this file
--   creates. The strengthened file was then rehearsed on the sim in ONE rolled-back transaction that first put
--   0352's body back and took the ledger row out: its pre-flight, re-emit, assertions and ledger insert all passed
--   on real Supabase, and nothing was kept.
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
-- ROLLBACK: to bring the limit back down quickly, set DEMAND_AI_MONTHLY_CAP_CENTS=500 and REDEPLOY (an environment
--   change reaches only new deployments), or revert the app change: that deployment then passes at most 5,000,000.
--   THAT IS NOT A HARD STOP: an older deployment of the new app that is still addressable keeps passing 50,000,000,
--   and the database accepts it. The hard stop is the database: FIRST make sure no serving deployment can pass more
--   than the new number (deploy, then remove or let drain the older ones), THEN a NEW migration that re-emits this
--   function FROM 0360 with the lower number and the same pre-flight / revoke / grant / assertions. Lowering the
--   database first refuses every request above the new number, the same way "app first" does. Spend already in the
--   ledger stays; a month already above the lowered cap stops admitting requests. No data is involved. Never edit or
--   delete this file once applied.
begin;

-- ── Pre-flight: 0352 is here, untouched, and the body this file replaces is 0352's ──────────────────────
do $$
declare
  t text;
  f regprocedure;
  r text;
  v_fn regprocedure;
  v_house text;   -- the house fingerprint (every non-printing character removed)
  v_exact text;   -- the exact fingerprint (only line breaks and the whitespace around them normalized)
  v_shape text;
  v_now text;
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
  -- 0352's body on a database that RECORDS 0360: the ceiling was lowered again after 0360. Never raised twice by this file.
  -- (Read only where Supabase's ledger exists; the statement inside is not planned unless the table is there.)
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    if exists (select 1 from supabase_migrations.schema_migrations m where m.name = '0360_demand_ai_cap') then
      raise exception '0360: already recorded as applied, and the live body is 0352''s again: the ceiling was lowered after 0360. Re-emit from the later definer. Refusing.';
    end if;
  end if;
  if public.demand_ai_cap_ceiling_micro() is distinct from 5000000 then
    raise exception '0360: the live ceiling is % and not 0352''s 5000000. Refusing.', public.demand_ai_cap_ceiling_micro();
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

  -- SHAPE-BEGIN (the same text is in the assertion block)
  -- What each of the six IS, by 0352: language : volatility : security definer : return type : argument count. A plain
  -- function that returns no set and is not strict, leakproof or parallel-marked (else ":odd"), whose only setting is
  -- the pinned search_path (else ":config").
  for t, v_shape in select * from (values
      ('demand_ai_cap_ceiling_micro()', 'sql:i:f:bigint:0'),
      ('demand_ai_month_spent_micro(date)', 'sql:s:t:bigint:1'),
      ('demand_ai_reserve(uuid,uuid,text,text,integer,bigint,bigint)', 'plpgsql:v:t:jsonb:7'),
      ('demand_ai_claims_valid(jsonb)', 'plpgsql:i:f:boolean:1'),
      ('demand_ai_settle(uuid,text,integer,integer,bigint,text,text,jsonb,integer)', 'plpgsql:v:t:jsonb:9'),
      ('demand_ai_today(uuid)', 'plpgsql:v:t:jsonb:1')) x loop
    select l.lanname::text || ':' || p.provolatile::text || ':' || case when p.prosecdef then 't' else 'f' end || ':' || p.prorettype::regtype::text || ':' || p.pronargs::text
           || case when p.prokind = 'f' and not p.proretset and p.prosqlbody is null and not p.proisstrict and not p.proleakproof and p.proparallel = 'u' then '' else ':odd' end
           || case when p.proconfig is not null and array_length(p.proconfig, 1) = 1 and replace(p.proconfig[1], ' ', '') = 'search_path=pg_catalog,public' then '' else ':config' end
      into v_now from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = ('public.' || t)::regprocedure;
    if v_now is distinct from v_shape then
      raise exception '0360: public.% is not 0352''s shape (it is %, 0352 made it %). Refusing.', t, v_now, v_shape;
    end if;
  end loop;
  -- Owner and the WHOLE ACL of all six, the owner's own entry and every grantor included (an unexpected grant is
  -- refused, never silently revoked).
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
             || case when a.is_grantable then '*' else '' end || '/' || a.grantor::regrole::text as e
        from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where p.oid = f) x;
    if v_acl is distinct from 'postgres=EXECUTE/postgres,service_role=EXECUTE/postgres' then
      raise exception '0360: the ACL of % is not 0352''s (it is: %). An unexpected grant is refused, never silently revoked.', f, v_acl;
    end if;
  end loop;
  -- SHAPE-END

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
    'rel:' || (select count(*)::text || ':' || coalesce(md5(string_agg((to_jsonb(c) - array['reltuples', 'relpages', 'relallvisible', 'relallfrozen', 'relfrozenxid',
                  'relminmxid', 'relfilenode', 'relhasindex', 'relhasrules', 'relhastriggers', 'relhassubclass'])::text, '|' order by c.oid)), '-')
                from pg_class c where c.relnamespace = 'public'::regnamespace),
    'col:' || (select count(*)::text || ':' || coalesce(md5(string_agg(jsonb_build_array(a.attrelid, a.attnum, a.attname, a.atttypid, a.attlen, a.atttypmod, a.attndims,
                  a.attbyval, a.attalign, a.attstorage, a.attcompression, a.attnotnull, a.atthasdef, a.atthasmissing, a.attidentity, a.attgenerated, a.attisdropped,
                  a.attislocal, a.attinhcount, a.attcollation, a.attacl::text, a.attoptions::text, a.attfdwoptions::text)::text, '|' order by a.attrelid, a.attnum)), '-')
                from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace = 'public'::regnamespace and a.attnum > 0),
    'def:' || (select count(*)::text || ':' || coalesce(md5(string_agg(to_jsonb(d)::text, '|' order by d.oid)), '-')
                from pg_attrdef d join pg_class c on c.oid = d.adrelid where c.relnamespace = 'public'::regnamespace),
    'pol:' || (select count(*)::text || ':' || coalesce(md5(string_agg(to_jsonb(po)::text, '|' order by po.oid)), '-')
                from pg_policy po join pg_class c on c.oid = po.polrelid where c.relnamespace = 'public'::regnamespace),
    'trg:' || (select count(*)::text || ':' || coalesce(md5(string_agg(to_jsonb(tg)::text, '|' order by tg.oid)), '-')
                from pg_trigger tg join pg_class c on c.oid = tg.tgrelid where c.relnamespace = 'public'::regnamespace),
    'con:' || (select count(*)::text || ':' || coalesce(md5(string_agg(to_jsonb(co)::text, '|' order by co.oid)), '-')
                from pg_constraint co where co.connamespace = 'public'::regnamespace),
    'idx:' || (select count(*)::text || ':' || coalesce(md5(string_agg((to_jsonb(i) - array['indisvalid', 'indisready', 'indislive', 'indcheckxmin'])::text, '|'
                  order by i.indexrelid)), '-')
                from pg_index i join pg_class c on c.oid = i.indexrelid where c.relnamespace = 'public'::regnamespace),
    'rul:' || (select count(*)::text || ':' || coalesce(md5(string_agg(to_jsonb(rw)::text, '|' order by rw.oid)), '-')
                from pg_rewrite rw join pg_class c on c.oid = rw.ev_class where c.relnamespace = 'public'::regnamespace),
    'typ:' || (select count(*)::text || ':' || coalesce(md5(string_agg(to_jsonb(ty)::text, '|' order by ty.oid)), '-')
                from pg_type ty where ty.typnamespace = 'public'::regnamespace),
    'enm:' || (select count(*)::text || ':' || coalesce(md5(string_agg(to_jsonb(en)::text, '|' order by en.oid)), '-')
                from pg_enum en join pg_type ty on ty.oid = en.enumtypid where ty.typnamespace = 'public'::regnamespace),
    'seq:' || (select count(*)::text || ':' || coalesce(md5(string_agg(to_jsonb(sq)::text, '|' order by sq.seqrelid)), '-')
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
  t text;
  f regprocedure;
  r text;
  v_fn regprocedure := 'public.demand_ai_cap_ceiling_micro()'::regprocedure;
  v_row pg_proc%rowtype;
  v_before text;
  v_shape text;
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
  -- SHAPE-BEGIN (the same text is in the pre-flight block)
  -- What each of the six IS, by 0352: language : volatility : security definer : return type : argument count. A plain
  -- function that returns no set and is not strict, leakproof or parallel-marked (else ":odd"), whose only setting is
  -- the pinned search_path (else ":config").
  for t, v_shape in select * from (values
      ('demand_ai_cap_ceiling_micro()', 'sql:i:f:bigint:0'),
      ('demand_ai_month_spent_micro(date)', 'sql:s:t:bigint:1'),
      ('demand_ai_reserve(uuid,uuid,text,text,integer,bigint,bigint)', 'plpgsql:v:t:jsonb:7'),
      ('demand_ai_claims_valid(jsonb)', 'plpgsql:i:f:boolean:1'),
      ('demand_ai_settle(uuid,text,integer,integer,bigint,text,text,jsonb,integer)', 'plpgsql:v:t:jsonb:9'),
      ('demand_ai_today(uuid)', 'plpgsql:v:t:jsonb:1')) x loop
    select l.lanname::text || ':' || p.provolatile::text || ':' || case when p.prosecdef then 't' else 'f' end || ':' || p.prorettype::regtype::text || ':' || p.pronargs::text
           || case when p.prokind = 'f' and not p.proretset and p.prosqlbody is null and not p.proisstrict and not p.proleakproof and p.proparallel = 'u' then '' else ':odd' end
           || case when p.proconfig is not null and array_length(p.proconfig, 1) = 1 and replace(p.proconfig[1], ' ', '') = 'search_path=pg_catalog,public' then '' else ':config' end
      into v_now from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = ('public.' || t)::regprocedure;
    if v_now is distinct from v_shape then
      raise exception '0360: public.% is not 0352''s shape (it is %, 0352 made it %). Refusing.', t, v_now, v_shape;
    end if;
  end loop;
  -- Owner and the WHOLE ACL of all six, the owner's own entry and every grantor included (an unexpected grant is
  -- refused, never silently revoked).
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
             || case when a.is_grantable then '*' else '' end || '/' || a.grantor::regrole::text as e
        from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where p.oid = f) x;
    if v_acl is distinct from 'postgres=EXECUTE/postgres,service_role=EXECUTE/postgres' then
      raise exception '0360: the ACL of % is not 0352''s (it is: %). An unexpected grant is refused, never silently revoked.', f, v_acl;
    end if;
  end loop;
  -- SHAPE-END

  -- (3) The catalog of schema public is otherwise as the pre-flight read it.
  v_before := current_setting('co_ops.m0360_public_before', true);
  if v_before is null or v_before = '' then raise exception '0360: the pre-flight catalog digest is missing'; end if;
  -- DIGEST-BEGIN (the same text is in the pre-flight block)
  select concat_ws(' ',
    'fn:' || (select count(*)::text || ':' || coalesce(md5(string_agg(to_jsonb(p)::text, '|' order by p.oid)), '-')
                from pg_proc p where p.pronamespace = 'public'::regnamespace and p.oid <> v_fn),
    'rel:' || (select count(*)::text || ':' || coalesce(md5(string_agg((to_jsonb(c) - array['reltuples', 'relpages', 'relallvisible', 'relallfrozen', 'relfrozenxid',
                  'relminmxid', 'relfilenode', 'relhasindex', 'relhasrules', 'relhastriggers', 'relhassubclass'])::text, '|' order by c.oid)), '-')
                from pg_class c where c.relnamespace = 'public'::regnamespace),
    'col:' || (select count(*)::text || ':' || coalesce(md5(string_agg(jsonb_build_array(a.attrelid, a.attnum, a.attname, a.atttypid, a.attlen, a.atttypmod, a.attndims,
                  a.attbyval, a.attalign, a.attstorage, a.attcompression, a.attnotnull, a.atthasdef, a.atthasmissing, a.attidentity, a.attgenerated, a.attisdropped,
                  a.attislocal, a.attinhcount, a.attcollation, a.attacl::text, a.attoptions::text, a.attfdwoptions::text)::text, '|' order by a.attrelid, a.attnum)), '-')
                from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace = 'public'::regnamespace and a.attnum > 0),
    'def:' || (select count(*)::text || ':' || coalesce(md5(string_agg(to_jsonb(d)::text, '|' order by d.oid)), '-')
                from pg_attrdef d join pg_class c on c.oid = d.adrelid where c.relnamespace = 'public'::regnamespace),
    'pol:' || (select count(*)::text || ':' || coalesce(md5(string_agg(to_jsonb(po)::text, '|' order by po.oid)), '-')
                from pg_policy po join pg_class c on c.oid = po.polrelid where c.relnamespace = 'public'::regnamespace),
    'trg:' || (select count(*)::text || ':' || coalesce(md5(string_agg(to_jsonb(tg)::text, '|' order by tg.oid)), '-')
                from pg_trigger tg join pg_class c on c.oid = tg.tgrelid where c.relnamespace = 'public'::regnamespace),
    'con:' || (select count(*)::text || ':' || coalesce(md5(string_agg(to_jsonb(co)::text, '|' order by co.oid)), '-')
                from pg_constraint co where co.connamespace = 'public'::regnamespace),
    'idx:' || (select count(*)::text || ':' || coalesce(md5(string_agg((to_jsonb(i) - array['indisvalid', 'indisready', 'indislive', 'indcheckxmin'])::text, '|'
                  order by i.indexrelid)), '-')
                from pg_index i join pg_class c on c.oid = i.indexrelid where c.relnamespace = 'public'::regnamespace),
    'rul:' || (select count(*)::text || ':' || coalesce(md5(string_agg(to_jsonb(rw)::text, '|' order by rw.oid)), '-')
                from pg_rewrite rw join pg_class c on c.oid = rw.ev_class where c.relnamespace = 'public'::regnamespace),
    'typ:' || (select count(*)::text || ':' || coalesce(md5(string_agg(to_jsonb(ty)::text, '|' order by ty.oid)), '-')
                from pg_type ty where ty.typnamespace = 'public'::regnamespace),
    'enm:' || (select count(*)::text || ':' || coalesce(md5(string_agg(to_jsonb(en)::text, '|' order by en.oid)), '-')
                from pg_enum en join pg_type ty on ty.oid = en.enumtypid where ty.typnamespace = 'public'::regnamespace),
    'seq:' || (select count(*)::text || ':' || coalesce(md5(string_agg(to_jsonb(sq)::text, '|' order by sq.seqrelid)), '-')
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
