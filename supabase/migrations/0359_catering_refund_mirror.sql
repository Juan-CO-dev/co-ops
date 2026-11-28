-- Migration 0359_catering_refund_mirror
-- AUTHORED 2026-11-28 (refund Part B1, REDESIGN v2, CO CC Fable lead, for CC). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod on Juan's word.
-- NUMBER: 0359 is claimed for refund Part B1 in co-ops-wt/.mig-claims. This file REPLACES 0359_catering_refund_reconciler
--   (PR #646, commit 71b7e316), which was applied to the sim only and never reached prod or main.
-- Plan: PLAN-refundB1v2.md sections 0-11 (revision 3) with section 15 (CC's build rulings T1-T9, binding).
-- Juan 2026-11-28 (D1-D3): main's webhook refund leg stays the ONLY writer of catering_payments.status and of the
--   refund events, with either switch in either position; B1 only ADDS its own data; refunds are created in the
--   CO-OPS panel; exactly one POST per request, never an automatic retry.
-- Ships DARK: nothing in this file runs unless CATERING_REFUNDS_OBSERVE=1 (GETs only) or CATERING_REFUNDS=1 (the
--   panel) is set, both are unset everywhere, and the operator statement below has never been run. Applying this
--   file turns nothing on.
--
-- THE ONE RULE (D1, [Q5], restated by [T7]). B1 never WRITES a table or a column that main READS FOR ITS OWN LOGIC:
--   catering_payments, catering_payment_refund_events, stripe_events, users, cron_route_leases are never a write
--   target of any statement here. The permitted, named audit_log APPENDS (as 0357's reserve already makes):
--   `catering.refund.request` (F8), `catering.refund.release` (F12), `catering.refund.attach` (F16); the app adds
--   `catering.refund.stripe_result` and the cron heartbeat. B1's tables hold foreign keys to catering_payments(id)
--   and users(id) exactly as 0357's do: NO ACTION, never CASCADE. What that changes for main, stated: a
--   catering_payments row B1 holds a row for can no longer be DELETEd (as 0357 already refuses for a payment with a
--   refund request). A FUTURE TEST-DATA PURGE (the 0193 pattern) must delete B1's rows (catering_refund_observed,
--   catering_refund_payment_state) BEFORE the payment rows.
--
-- WHAT THIS IS.
--   TABLE catering_refund_observed        the MIRROR: one row per Stripe refund id = the last RETRIEVED refund object
--                                         (never a list item, an event payload or a create response).
--   TABLE catering_refund_payment_state   one row per payment: the read open on it now, the owner facts of the last
--                                         COMPLETE read, when that read started, its one-time token, B1's own dirty stamp.
--   TABLE catering_refund_observation     ONE row: whether the operator RECORDED observation on, the monotonic count
--                                         of recorded ON / OFF transitions, the sweep's lease, its last claim and its
--                                         last FINISHED pass [Q1] [T4] [T6].
--   catering_refund_requests (0357) gains eight write-once columns (the arm, the arm's credential [T5], the reserve's
--     read token, who resolved it) and a UNIQUE partial index: one unresolved (pending) request per payment.
--   FUNCTIONS, private (owner only; no API role can execute them):
--     F1  catering_refund_requests_guard()              re-emitted FROM 0357: its body plus the write-once rules
--     F2  catering_refund_dirty_at(payment)             the dirty instant: B1's stamp, the last recorded turn-on or
--                                                       resume [T4], an abandoned read, and main's webhook ledger
--                                                       since the last complete read started; 'infinity' when the
--                                                       ledger cannot prove it reaches back that far [DR1] [T3]
--     F3  catering_refund_payment_figures(payment)      THE one figures definition; `known` or no number
--     F4  catering_refund_parts_ready()                 the B2 / B3 database gate (false today)
--     F14 catering_refund_sweep_due(limit)              the sweep's work list, one set-based pass over the ledger
--     F17 catering_refund_observe_set(on)               THE operator statement [Q1]
--     helpers: catering_refund_claims(payment), catering_refund_answer_matches(request, refund),
--              catering_refund_release_role(actor, shop); constants: settle 5 min, liveness 60 min, fresh 5 min,
--              read_max_age 15 min, reread 45 min [T3]
--   FUNCTIONS, worker (service_role EXECUTE only):
--     F5  catering_refund_read_begin(payment)           opens the read: the database's id and clock [P3-6] [T2]
--     F6  catering_refund_record_read(...)              the ONLY writer of the mirror and of the complete stamp;
--                                                       never raises for evidence [R3]; binds only the unique
--                                                       candidate of a complete read, created at or after the arm
--                                                       at full precision [Q2] [T1]
--     F7  catering_refund_summary(quotes)               the panel's read model; zero Stripe calls
--     F8  catering_refund_reserve_fresh(...)            0357's reserve on v2's figures (probe, replay, tokens)
--     F9  catering_refund_arm(request, token, wait)     the write-once arm; every check again under the locks
--     F10 catering_refund_finish(request, outcome, ...) records the ONE POST's answer
--     F11 catering_refund_cancel_unarmed(request, why)  a reserved row that was never armed
--     F12 catering_refund_release(...)                  the staff exit when NOTHING was sent (24 h, a finding)
--     F16 catering_refund_attach(...)                   the staff exit when a refund DID land [Q4]
--     F13 catering_refund_sweep_begin(limit)            the sweep's ONE claim and its work list, one transaction
--     F18 catering_refund_sweep_end(claim, reads, ok)   the pass-END stamp = "last finished pass" [T6]
--     F15 catering_refund_inventory()                   the sign-off page's read model
--   ANSWER CONVENTION: F5, F6, F9, F10, F11, F13, F18 never raise for a refusal; they RETURN { result: ... } so the
--     stamps they made commit, and the caller switches on `result`. F8, F12 and F16 refuse by RAISING a named P0001
--     (0357's convention): a refusal there has nothing to commit.
--
-- LOCK ORDER (one order, [S8]): the actor's users row FOR SHARE (F8, F12, F16) -> payment rows FOR NO KEY UPDATE in id
--   order -> the payment's state row -> mirror rows -> request rows. F13 and F17 lock the observation row, then state
--   rows; they take no payment row. Every other function only READS the observation row, without a lock.
-- ROW-COUNT LAW: every conditional write reads its row count; zero rows is never "done".
-- TIME: every decision uses clock_timestamp() (the database's clock, after any lock wait), never now().
--
-- PRE-FLIGHT (in this file; it refuses by name and changes nothing): already applied; a dependency missing; ANY
--   object of the old 0359 present; a cron lease that is not 0343's; a body this file re-emits or relies on that is
--   not its source file's (both fingerprints, 0358's convention); 0357's ACLs; an old sender that may still be alive
--   (a live 0357 claim, or a pending / submitted request row touched in the last 15 minutes); two pending rows on one
--   payment; an attempted row whose payment has no PaymentIntent.
-- PRECONDITION (the runbook's, not checkable from here): CATERING_REFUNDS has been unset in every serving deployment
--   for longer than a function can live (15 minutes). The grant withdrawal below stops a NEW reserve or claim by
--   0357's sender; it cannot recall an invocation that already claimed. Such a row carries attempts >= 1, so this
--   file arms it (possibly sent): it stays reserved and is bound by a read or resolved by a person.
-- LOCKS: catering_refund_requests ACCESS EXCLUSIVE (taken first, once); SHARE ROW EXCLUSIVE on catering_payments and
--   users (the new foreign keys). stripe_events and cron_route_leases are not locked or touched.
-- DEPENDS ON: 0357, 0358 (applied to sim and prod); 0127, 0120, 0204, 0333, 0343 for what they created.
-- PROOF: scripts/sql-harness-0359.mjs (PGlite, the REAL 0357 -> 0358 -> this file), CI-pinned by
--   tests/catering-refund-0359-migration.test.ts. Two-session proof: scripts/sim/refund-0359-lock-check.mjs (sim only).
-- ROLLBACK. While the mirror and state tables are empty and no request row is armed: a NEW reviewed migration that
--   drops the functions, the three tables, the eight columns and the index, re-emits 0357's guard and restores
--   0357's grants. After observation has run (rows exist): the rollback is "both switches off + revert the PR"; the
--   schema stays, nothing reads it, and removing it is a separately reviewed migration.
begin;

-- Nothing may reserve, claim or settle a request while the privileges and the guard change. Taken once, no upgrade.
lock table public.catering_refund_requests in access exclusive mode;

-- ── Pre-flight ──────────────────────────────────────────────────────────────────────────────────────────
do $$
declare
  t text;
  f text;
  v_house text;
  v_exact text;
  v_acl text;
  v_def text;
  fp record;
begin
  if to_regclass('public.catering_refund_observed') is not null then
    raise exception '0359: already applied';
  end if;
  foreach t in array array['catering_payments', 'catering_quotes', 'catering_payment_refund_events', 'stripe_events',
                           'cron_route_leases', 'catering_refund_requests', 'catering_refund_stripe_snapshots', 'users',
                           'user_locations', 'locations', 'audit_log'] loop
    if to_regclass('public.' || t) is null then raise exception '0359: public.% is missing', t; end if;
  end loop;
  foreach t in array array['catering_refund_payment_state', 'catering_refund_observation'] loop
    if to_regclass('public.' || t) is not null then raise exception '0359: public.% already exists', t; end if;
  end loop;
  -- Dependency columns (the live schema, never a helper's idea of it).
  for fp in select * from (values
      ('catering_payments', 'provider_ref'), ('catering_payments', 'provider'), ('catering_payments', 'status'),
      ('catering_payments', 'quote_id'), ('catering_payments', 'amount_cents'), ('catering_payments', 'kind'),
      ('catering_payments', 'paid_at'), ('catering_payments', 'provider_session_id'),
      ('catering_quotes', 'root_id'), ('catering_quotes', 'location_id'),
      ('stripe_events', 'payload'), ('stripe_events', 'type'), ('stripe_events', 'received_at'),
      ('users', 'role'), ('users', 'active'), ('user_locations', 'active'),
      ('audit_log', 'actor_id'), ('audit_log', 'actor_role'), ('audit_log', 'action'), ('audit_log', 'resource_table'),
      ('audit_log', 'resource_id'), ('audit_log', 'metadata'), ('audit_log', 'destructive'),
      ('catering_refund_requests', 'attempts'), ('catering_refund_requests', 'first_attempt_at'),
      ('catering_refund_requests', 'claimed_until'), ('catering_refund_requests', 'updated_at')) as x(tbl, col) loop
    if not exists (select 1 from information_schema.columns c where c.table_schema = 'public'
                    and c.table_name = fp.tbl and c.column_name = fp.col) then
      raise exception '0359: public.%.% is missing', fp.tbl, fp.col;
    end if;
  end loop;

  -- ANY object of the old 0359 (commit 71b7e316, sim only) refuses: the sim is reset first (R8), by name.
  foreach t in array array['catering_refund_install_contracts', 'catering_refund_epochs', 'catering_refund_payment_work',
                           'catering_refund_identities', 'catering_refund_event_work', 'catering_payment_refund_outcomes',
                           'catering_refund_issues'] loop
    if to_regclass('public.' || t) is not null then
      raise exception '0359: public.% exists (the old 0359 is installed; run the guarded reset first). Refusing.', t;
    end if;
  end loop;
  foreach t in array array['create_armed_at', 'arm_payment_intent', 'arm_epoch_id', 'reconcile_seq', 'first_reversed_at',
                           'binding_hold', 'arm_count', 'legacy_possibly_sent', 'arm_account_slot', 'arm_livemode',
                           'arm_credential_fp', 'reserve_read_token', 'resolved_by', 'resolved_at'] loop
    if exists (select 1 from information_schema.columns c where c.table_schema = 'public'
                and c.table_name = 'catering_refund_requests' and c.column_name = t) then
      raise exception '0359: public.catering_refund_requests.% already exists (an old or partial 0359). Refusing.', t;
    end if;
  end loop;
  -- Every function of the refund family that is not 0357's six: the old file's 45 names (and any other) refuse.
  select string_agg(x.sig, '; ' order by x.sig) into v_def
    from (select p.proname || '(' || oidvectortypes(p.proargtypes) || ')' as sig
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname like 'catering\_refund\_%') x
   where x.sig not in (
       'catering_refund_actor_ok(uuid, uuid)', 'catering_refund_figures(uuid)',
       'catering_refund_reserve(uuid, uuid, uuid, bigint, text, text, text)', 'catering_refund_claim(uuid)',
       'catering_refund_record_snapshot(uuid, timestamp with time zone, bigint, jsonb)', 'catering_refund_requests_guard()');
  if v_def is not null then
    raise exception '0359: refund functions that are not 0357''s exist (%). Refusing.', v_def;
  end if;
  if exists (select 1 from pg_trigger tg where tg.tgrelid = 'public.catering_refund_requests'::regclass
              and not tg.tgisinternal and tg.tgname <> 'catering_refund_requests_guard') then
    raise exception '0359: public.catering_refund_requests carries a trigger that is not 0357''s';
  end if;
  if exists (select 1 from pg_indexes i where i.schemaname = 'public' and i.tablename = 'catering_refund_requests'
              and i.indexname in ('catering_refund_requests_attempted_unbound', 'catering_refund_requests_unarmed',
                                  'catering_refund_requests_one_unresolved')) then
    raise exception '0359: an index of an old or partial 0359 exists on public.catering_refund_requests. Refusing.';
  end if;

  -- The cron lease is 0343's and stays 0343's [DR13]: the eight names, the function body, no row for this sweep.
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = 'public.cron_route_leases'::regclass and c.conname = 'cron_route_leases_job_check' and c.contype = 'c' and c.convalidated;
  if v_def is null then raise exception '0359: cron_route_leases_job_check is missing or not validated'; end if;
  if (select array_agg(m[1] order by m[1]) from regexp_matches(v_def, '''([a-z0-9-]+)''', 'g') m)
       is distinct from array['catering-inbox-delivery', 'demand-signals', 'fact-build', 'meta-leads', 'schedule-draft',
                              'sevenshifts-sync', 'toast-catering-scan', 'toast-sales-today'] then
    raise exception '0359: cron_route_leases_job_check is not the 0343 eight-job union (%)', v_def;
  end if;
  if exists (select 1 from public.cron_route_leases l where l.job = 'catering-refund-sweep') then
    raise exception '0359: a catering-refund-sweep lease row exists (the old 0359 was not reset). Refusing.';
  end if;

  -- The bodies this file re-emits or relies on must be their source files', by BOTH fingerprints (0358's convention):
  -- house = md5 of prosrc with every non-printing character removed; exact = only line breaks normalized.
  for fp in select * from (values
      ('catering_refund_requests_guard()',                                        '9650ed5236df567bb4761af3ad3d1728', '2807cdc25ef8d80c0399aa7ce089ae05', '0357'),
      ('catering_refund_figures(uuid)',                                           'd62aacb7a65ed6abce7445f7b54c1bd9', 'a015ff3f2ef702c35f0d65b7484dfec5', '0357'),
      ('catering_refund_record_snapshot(uuid, timestamptz, bigint, jsonb)',       '98c1cce5298eb4d1d44c37cc6525e819', '8f824d7ddf91e4446b5b1162b422d579', '0357'),
      ('catering_refund_reserve(uuid, uuid, uuid, bigint, text, text, text)',     '76d984e1425af5c7c90f2092a4b0e051', 'e6864c42ff5bdf2fc0d9f411795a4be4', '0357'),
      ('catering_refund_claim(uuid)',                                             '1b9fb185db2bf0c4ab109bfa160aa424', '03b982529716ca8f985d5c7f2999f370', '0357'),
      ('catering_refund_actor_ok(uuid, uuid)',                                    '4076029ec89d7b777af23ff3d8fcbdee', 'd78c4f8d7e4aa13351cde97c7541b884', '0358'),
      ('claim_cron_route(text)',                                                  'e66e3151a8c249588892b79de48a2fad', 'a48209a1ed19e3c2fa263b0053bd802b', '0343')
    ) as x(sig, house, exact, src) loop
    if to_regprocedure('public.' || fp.sig) is null then
      raise exception '0359: function public.% is missing (% must be applied first)', fp.sig, fp.src;
    end if;
    select md5(regexp_replace(p.prosrc, '[^\x21-\x7E]+', '', 'g')),
           md5(btrim(regexp_replace(p.prosrc, '\s*[\r\n]+\s*', E'\n', 'g'), E' \t\r\n'))
      into v_house, v_exact from pg_proc p where p.oid = ('public.' || fp.sig)::regprocedure;
    if v_house is distinct from fp.house or v_exact is distinct from fp.exact then
      raise exception '0359: the live body of public.% (md5 %, exact %) is not its % definition -- a later definer exists; re-emit from it. Refusing.',
        fp.sig, v_house, v_exact, fp.src;
    end if;
  end loop;
  foreach f in array array['catering_refund_requests_guard', 'catering_refund_figures', 'catering_refund_record_snapshot',
                           'catering_refund_reserve', 'catering_refund_claim', 'catering_refund_actor_ok', 'claim_cron_route'] loop
    if (select count(*) from pg_proc p where p.proname = f and p.pronamespace = 'public'::regnamespace) <> 1 then
      raise exception '0359: public.% has more than one overload. Refusing.', f;
    end if;
  end loop;

  -- 0357's guard trigger, exactly (0358's check): that name, enabled, BEFORE UPDATE FOR EACH ROW, no column list, no WHEN.
  if (select count(*) from pg_trigger tg where tg.tgrelid = 'public.catering_refund_requests'::regclass
        and tg.tgname = 'catering_refund_requests_guard' and not tg.tgisinternal and tg.tgenabled = 'O'
        and tg.tgfoid = 'public.catering_refund_requests_guard()'::regprocedure and tg.tgtype = 19
        and tg.tgattr::text = '' and tg.tgqual is null and tg.tgnargs = 0) <> 1 then
    raise exception '0359: the catering_refund_requests_guard trigger is missing, disabled, or not 0357''s BEFORE UPDATE row trigger';
  end if;

  -- 0357's whole table ACLs and its nine column grants (0358 asserted them; a drift since is refused, never rewritten).
  foreach t in array array['public.catering_refund_requests', 'public.catering_refund_stripe_snapshots'] loop
    if not (select cl.relrowsecurity from pg_class cl where cl.oid = t::regclass) then raise exception '0359: RLS is off on %', t; end if;
    if exists (select 1 from pg_policy po where po.polrelid = t::regclass) then raise exception '0359: % has a policy', t; end if;
    select coalesce(string_agg(x.e, ',' order by x.e), '') into v_acl from (
      select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end || '=' || a.privilege_type
             || case when a.is_grantable then '*' else '' end as e
        from pg_class cl, lateral aclexplode(coalesce(cl.relacl, acldefault('r', cl.relowner))) a
       where cl.oid = t::regclass and a.grantee <> cl.relowner) x;
    if v_acl <> 'service_role=SELECT' then raise exception '0359: the ACL of % is not 0357''s (%)', t, v_acl; end if;
    select coalesce(string_agg(x.e, ',' order by x.e), '') into v_acl from (
      select att.attname::text || ':' || case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end || '=' || a.privilege_type
             || case when a.is_grantable then '*' else '' end as e
        from pg_attribute att, lateral aclexplode(att.attacl) a
       where att.attrelid = t::regclass and att.attnum > 0 and not att.attisdropped and att.attacl is not null) x;
    if v_acl <> (case when t = 'public.catering_refund_requests' then
         'claim_token:service_role=UPDATE,claimed_until:service_role=UPDATE,last_error_code:service_role=UPDATE,last_error_message:service_role=UPDATE,settled_at:service_role=UPDATE,status:service_role=UPDATE,stripe_refund_id:service_role=UPDATE,stripe_status:service_role=UPDATE,updated_at:service_role=UPDATE'
         else '' end) then
      raise exception '0359: the column ACL of % is not 0357''s (%)', t, v_acl;
    end if;
  end loop;
  -- Every 0357 / 0358 function: nobody but the owner and service_role holds anything, no grant option.
  foreach f in array array['catering_refund_actor_ok(uuid, uuid)', 'catering_refund_figures(uuid)',
                           'catering_refund_reserve(uuid, uuid, uuid, bigint, text, text, text)', 'catering_refund_claim(uuid)',
                           'catering_refund_record_snapshot(uuid, timestamptz, bigint, jsonb)', 'catering_refund_requests_guard()'] loop
    if exists (select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.oid = ('public.' || f)::regprocedure and a.grantee <> p.proowner
                  and (a.grantee <> 'service_role'::regrole::oid or a.is_grantable)) then
      raise exception '0359: public.% has an unexpected grantee or a grant option in its ACL', f;
    end if;
  end loop;

  -- An old sender may still be alive. A live 0357 claim is an admitted network call this file cannot recall; a claim
  -- lasts 3 minutes but the function that took it can outlive it, and 15 minutes is longer than any function lives.
  if exists (select 1 from public.catering_refund_requests r where r.claimed_until is not null and r.claimed_until > clock_timestamp()) then
    raise exception '0359: a live refund claim exists (an old sender may be mid-send). Wait for it and re-run. Refusing.';
  end if;
  if exists (select 1 from public.catering_refund_requests r
              where r.status in ('pending', 'submitted') and r.updated_at > clock_timestamp() - interval '15 minutes') then
    raise exception '0359: a pending or submitted refund request changed in the last 15 minutes (an old sender may be alive). Wait and re-run. Refusing.';
  end if;
  -- The unique index below could not be built: named, for a person to resolve.
  select string_agg(x.payment_id::text, ', ' order by x.payment_id::text) into v_def from (
    select r.payment_id from public.catering_refund_requests r where r.status = 'pending' group by r.payment_id having count(*) > 1) x;
  if v_def is not null then
    raise exception '0359: more than one pending refund request on one payment (%). A person resolves them first. Refusing.', v_def;
  end if;
  -- The backfill below could not arm it: named.
  select string_agg(r.id::text, ', ' order by r.id::text) into v_def
    from public.catering_refund_requests r join public.catering_payments p on p.id = r.payment_id
   where (r.attempts > 0 or r.first_attempt_at is not null) and coalesce(p.provider_ref, '') !~ '^pi_[A-Za-z0-9_]{1,250}$';
  if v_def is not null then
    raise exception '0359: an attempted refund request whose payment has no PaymentIntent (%). Refusing.', v_def;
  end if;

  -- [Q5] [R12] What stands on the tables main writes BEFORE this file, kept for the comparison at the end:
  -- their user triggers, indexes and every constraint ON them, and the internal triggers they carry now.
  perform set_config('catering_refund_0359.before', (
    select md5(coalesce(string_agg(x.e, '|' order by x.e), '')) from (
      select 'T:' || tg.tgrelid::regclass::text || ':' || tg.tgname || ':' || tg.tgtype::text || ':' || tg.tgfoid::regproc::text
             || ':' || tg.tgenabled::text as e
        from pg_trigger tg
       where tg.tgrelid in ('public.catering_payments'::regclass, 'public.catering_payment_refund_events'::regclass,
                            'public.stripe_events'::regclass, 'public.users'::regclass, 'public.cron_route_leases'::regclass)
         and not tg.tgisinternal
      union all
      select 'I:' || pg_get_indexdef(i.indexrelid)
        from pg_index i
       where i.indrelid in ('public.catering_payments'::regclass, 'public.catering_payment_refund_events'::regclass,
                            'public.stripe_events'::regclass, 'public.users'::regclass, 'public.cron_route_leases'::regclass)
      union all
      select 'C:' || c.conrelid::regclass::text || ':' || c.conname || ':' || pg_get_constraintdef(c.oid)
        from pg_constraint c
       where c.conrelid in ('public.catering_payments'::regclass, 'public.catering_payment_refund_events'::regclass,
                            'public.stripe_events'::regclass, 'public.users'::regclass, 'public.cron_route_leases'::regclass)) x), true);
  perform set_config('catering_refund_0359.before_internal', (
    select coalesce(string_agg(tg.oid::text, ',' order by tg.oid), '')
      from pg_trigger tg
     where tg.tgrelid in ('public.catering_payments'::regclass, 'public.catering_payment_refund_events'::regclass,
                          'public.stripe_events'::regclass, 'public.users'::regclass, 'public.cron_route_leases'::regclass)
       and tg.tgisinternal), true);
end $$;

-- ── Tables ──────────────────────────────────────────────────────────────────────────────────────────────
alter table public.catering_refund_requests
  add column create_armed_at    timestamptz,
  add column arm_payment_intent text check (arm_payment_intent is null or arm_payment_intent ~ '^pi_[A-Za-z0-9_]{1,250}$'),
  add column arm_account_slot   text check (arm_account_slot is null or arm_account_slot in ('location', 'default')),
  add column arm_livemode       boolean,
  add column arm_credential_fp  text check (arm_credential_fp is null or arm_credential_fp ~ '^[0-9a-f]{16}$'),
  add column reserve_read_token uuid,
  add column resolved_by        uuid,
  add column resolved_at        timestamptz,
  add constraint catering_refund_requests_resolved_by_fk foreign key (resolved_by) references public.users(id),
  add constraint catering_refund_requests_arm_is_whole check ((create_armed_at is null) = (arm_payment_intent is null)),
  add constraint catering_refund_requests_arm_credential_is_whole
    check (num_nulls(arm_account_slot, arm_livemode, arm_credential_fp) in (0, 3)),
  add constraint catering_refund_requests_arm_credential_needs_arm
    check (create_armed_at is not null or arm_credential_fp is null),
  add constraint catering_refund_requests_resolved_is_whole check ((resolved_by is null) = (resolved_at is null));
-- A row 0357's sender already ATTEMPTED (its claim and its send were one step) is "possibly sent" by the same
-- predicate as every v2 row: armed. It carries no credential fingerprint, so only a read can bind it; a person's
-- release or attach is refused (credential_changed) and it goes to CC [T5]. Prod is expected to hold none.
update public.catering_refund_requests r
   set create_armed_at = coalesce(r.first_attempt_at, r.updated_at),
       arm_payment_intent = (select p.provider_ref from public.catering_payments p where p.id = r.payment_id)
 where r.attempts > 0 or r.first_attempt_at is not null;
create unique index catering_refund_requests_one_unresolved on public.catering_refund_requests (payment_id)
  where status = 'pending';

create table public.catering_refund_observed (
  refund_id         text primary key check (refund_id ~ '^(re|pyr)_[A-Za-z0-9_]{1,250}$'),
  payment_id        uuid not null,
  payment_intent_id text check (payment_intent_id is null or payment_intent_id ~ '^pi_[A-Za-z0-9_]{1,250}$'),
  charge_id         text check (charge_id is null or charge_id ~ '^[a-z]{2,4}_[A-Za-z0-9_]{1,250}$'),
  amount_cents      bigint not null check (amount_cents > 0),
  currency          text not null check (currency ~ '^[a-z]{3}$'),
  status            text check (status is null or length(status) <= 40),
  previous_status   text check (previous_status is null or length(previous_status) <= 40),
  status_changed_at timestamptz,
  stripe_created_at timestamptz not null,
  meta_request_id   uuid,
  request_id        uuid unique,
  read_started_at   timestamptz not null,
  recorded_at       timestamptz not null,
  first_seen_at     timestamptz not null default clock_timestamp(),
  constraint catering_refund_observed_payment_fk foreign key (payment_id) references public.catering_payments(id),
  constraint catering_refund_observed_request_fk foreign key (request_id) references public.catering_refund_requests(id),
  constraint catering_refund_observed_has_owner check (payment_intent_id is not null or charge_id is not null)
);
create index catering_refund_observed_payment on public.catering_refund_observed (payment_id);

create table public.catering_refund_payment_state (
  payment_id                     uuid primary key,
  open_read_id                   uuid,
  open_read_started_at           timestamptz,
  open_read_transitions          bigint,
  payment_intent_id              text check (payment_intent_id is null or payment_intent_id ~ '^pi_[A-Za-z0-9_]{1,250}$'),
  charge_id                      text check (charge_id is null or charge_id ~ '^[a-z]{2,4}_[A-Za-z0-9_]{1,250}$'),
  currency                       text check (currency is null or currency ~ '^[a-z]{3}$'),
  livemode                       boolean,
  captured_cents                 bigint check (captured_cents is null or captured_cents >= 0),
  account_slot                   text check (account_slot is null or account_slot in ('location', 'default')),
  credential_fp                  text check (credential_fp is null or credential_fp ~ '^[0-9a-f]{16}$'),
  last_complete_read_started_at  timestamptz,
  last_complete_read_recorded_at timestamptz,
  last_complete_read_token       uuid,
  last_complete_read_transitions bigint,
  dirty_since                    timestamptz,
  last_attempt_at                timestamptz,
  last_attempt_result            text check (last_attempt_result is null or length(last_attempt_result) <= 40),
  last_attempt_conflict_with     uuid,
  constraint catering_refund_payment_state_payment_fk foreign key (payment_id) references public.catering_payments(id),
  constraint catering_refund_payment_state_open_read_is_whole
    check (num_nulls(open_read_id, open_read_started_at, open_read_transitions) in (0, 3)),
  constraint catering_refund_payment_state_complete_is_whole
    check (num_nulls(payment_intent_id, charge_id, currency, livemode, captured_cents, account_slot, credential_fp,
                     last_complete_read_started_at, last_complete_read_recorded_at, last_complete_read_token,
                     last_complete_read_transitions) in (0, 11))
);

create table public.catering_refund_observation (
  id                     boolean primary key default true check (id),
  transitions            bigint not null default 0 check (transitions >= 0),
  observe_on             boolean not null default false,
  transitioned_at        timestamptz,
  resumed_at             timestamptz,
  lease_until            timestamptz,
  last_claim_at          timestamptz,
  last_claim_transitions bigint,
  last_claim_id          uuid,
  last_pass_ended_at     timestamptz,
  last_pass_reads        integer check (last_pass_reads is null or last_pass_reads >= 0),
  last_pass_complete     integer check (last_pass_complete is null or last_pass_complete >= 0)
);
insert into public.catering_refund_observation (id) values (true);

-- ── RLS: deny-all with the four explicit denials; no privilege for any API role ─────────────────────────
do $$ declare t text; begin
  foreach t in array array['catering_refund_observed', 'catering_refund_payment_state', 'catering_refund_observation'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (false)', t || '_no_user_select', t);
    execute format('create policy %I on public.%I for insert with check (false)', t || '_no_user_insert', t);
    execute format('create policy %I on public.%I for update using (false)', t || '_no_user_update', t);
    execute format('create policy %I on public.%I for delete using (false)', t || '_no_user_delete', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
  end loop;
end $$;

-- ── The stale sender is withdrawn: no direct request UPDATE, no 0357 reserve / claim / snapshot writer ───
-- The definitions stay for provenance. 0357's catering_refund_figures and catering_refund_stripe_snapshots are left
-- as they are (nothing in v2 reads them).
revoke update (status, stripe_refund_id, stripe_status, last_error_code, last_error_message, updated_at, settled_at,
               claim_token, claimed_until)
  on table public.catering_refund_requests from service_role;
revoke all on function public.catering_refund_reserve(uuid, uuid, uuid, bigint, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.catering_refund_claim(uuid) from public, anon, authenticated, service_role;
revoke all on function public.catering_refund_record_snapshot(uuid, timestamptz, bigint, jsonb) from public, anon, authenticated, service_role;

-- ── F1 The request guard, re-emitted FROM 0357 ──────────────────────────────────────────────────────────
-- 0357's body, unchanged, plus: reserve_read_token never changes; the arm (its instant, PaymentIntent, account slot,
-- mode and credential fingerprint [T5]) and the resolution (who, when) are write-once. No new status transition.
-- A later definer of this function is re-emitted FROM THIS FILE.
create or replace function public.catering_refund_requests_guard() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.id is distinct from old.id or new.payment_id is distinct from old.payment_id
     or new.quote_id is distinct from old.quote_id or new.location_id is distinct from old.location_id
     or new.client_token is distinct from old.client_token or new.amount_cents is distinct from old.amount_cents
     or new.reason_code is distinct from old.reason_code or new.reason_note is distinct from old.reason_note
     or new.trigger_kind is distinct from old.trigger_kind or new.requested_by is distinct from old.requested_by
     or new.requested_at is distinct from old.requested_at then
    raise exception 'refund_request_immutable' using errcode = 'P0001';
  end if;
  if new.attempts < old.attempts or (old.first_attempt_at is not null and new.first_attempt_at is distinct from old.first_attempt_at) then
    raise exception 'refund_request_immutable' using errcode = 'P0001';
  end if;
  if old.stripe_refund_id is not null and new.stripe_refund_id is distinct from old.stripe_refund_id then
    raise exception 'refund_request_immutable' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'pending' and new.status in ('submitted', 'succeeded', 'failed'))
    or (old.status = 'submitted' and new.status in ('succeeded', 'failed'))) then
    raise exception 'refund_request_bad_transition' using errcode = 'P0001';
  end if;
  if old.status in ('succeeded', 'failed') and (new.stripe_status is distinct from old.stripe_status
     or new.last_error_code is distinct from old.last_error_code) then
    raise exception 'refund_request_immutable' using errcode = 'P0001';
  end if;
  if new.reserve_read_token is distinct from old.reserve_read_token then
    raise exception 'refund_request_immutable' using errcode = 'P0001';
  end if;
  if (old.create_armed_at is not null and new.create_armed_at is distinct from old.create_armed_at)
     or (old.arm_payment_intent is not null and new.arm_payment_intent is distinct from old.arm_payment_intent)
     or (old.arm_account_slot is not null and new.arm_account_slot is distinct from old.arm_account_slot)
     or (old.arm_livemode is not null and new.arm_livemode is distinct from old.arm_livemode)
     or (old.arm_credential_fp is not null and new.arm_credential_fp is distinct from old.arm_credential_fp)
     or (old.resolved_by is not null and new.resolved_by is distinct from old.resolved_by)
     or (old.resolved_at is not null and new.resolved_at is distinct from old.resolved_at) then
    raise exception 'refund_request_immutable' using errcode = 'P0001';
  end if;
  -- The credential of an arm is written WITH the arm or never: it cannot be added to a row that is already armed.
  if old.create_armed_at is not null and old.arm_credential_fp is null and new.arm_credential_fp is not null then
    raise exception 'refund_request_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ── Constants (one immutable function each; owner only) ─────────────────────────────────────────────────
-- settle: how long after any sign of change a read must START to count [DR10] [Q6]. liveness: how long after the
-- sweep's last CLAIM observation still counts as live [Q1]. fresh: how old a same-request read may be. read_max_age:
-- how long an opened read may take to record. reread: a known payment is read again when its last complete read
-- started this long ago, so with the 15-minute cron every payment in the window is read within the hour [T3].
create function public.catering_refund_settle_interval() returns interval
language sql immutable set search_path = pg_catalog, public as $$ select interval '5 minutes' $$;
create function public.catering_refund_liveness_interval() returns interval
language sql immutable set search_path = pg_catalog, public as $$ select interval '60 minutes' $$;
create function public.catering_refund_fresh_interval() returns interval
language sql immutable set search_path = pg_catalog, public as $$ select interval '5 minutes' $$;
create function public.catering_refund_read_max_age() returns interval
language sql immutable set search_path = pg_catalog, public as $$ select interval '15 minutes' $$;
create function public.catering_refund_reread_interval() returns interval
language sql immutable set search_path = pg_catalog, public as $$ select interval '45 minutes' $$;

-- ── F2 The dirty instant of one payment ─────────────────────────────────────────────────────────────────
-- null = nothing has made it dirty; 'infinity' = main's ledger cannot prove it covers the window [DR1].
-- The LATEST of: B1's own stamp; the last recorded ON / OFF and the sweep's last resume, for EVERY payment, read or
-- never read [T4]; the start of a read that is still open 15 minutes after it began [R3]; and the newest row of
-- main's webhook ledger that names the payment's PaymentIntent or charge among ALL rows received since the last
-- complete read started, less the settle interval [DR1] [A1]. No lookback constant: the window is the read's own.
-- "Coverage" is retention only [T3]: one retained row at or before the window's start proves the ledger reaches
-- back that far; a row lost INSIDE the ledger is not seen from here (accepted residual; the hourly re-read covers it).
create function public.catering_refund_dirty_at(p_payment_id uuid) returns timestamptz
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  s public.catering_refund_payment_state%rowtype;
  o public.catering_refund_observation%rowtype;
  v_pi text;
  v_w timestamptz;
  v_out timestamptz;
  v_ledger timestamptz;
begin
  select p.provider_ref into v_pi from public.catering_payments p where p.id = p_payment_id;
  select * into s from public.catering_refund_payment_state x where x.payment_id = p_payment_id;
  select * into o from public.catering_refund_observation x where x.id;
  v_out := greatest(s.dirty_since, o.transitioned_at, o.resumed_at);
  if s.open_read_id is not null and s.open_read_started_at <= clock_timestamp() - public.catering_refund_read_max_age() then
    v_out := greatest(v_out, s.open_read_started_at);
  end if;
  if s.last_complete_read_started_at is null then
    return v_out; -- never completely read: there is no window to cover
  end if;
  v_w := s.last_complete_read_started_at - public.catering_refund_settle_interval();
  if not exists (select 1 from public.stripe_events e where e.received_at <= v_w) then
    return 'infinity'::timestamptz;
  end if;
  select max(e.received_at) into v_ledger
    from public.stripe_events e
   where e.received_at > v_w
     and (coalesce(e.payload #>> '{data,object,payment_intent,id}', e.payload #>> '{data,object,payment_intent}') in (v_pi, s.payment_intent_id)
       or (e.type like 'payment\_intent.%' and e.payload #>> '{data,object,id}' in (v_pi, s.payment_intent_id))
       or coalesce(e.payload #>> '{data,object,charge,id}', e.payload #>> '{data,object,charge}') = s.charge_id
       or (e.type like 'charge.%' and e.payload #>> '{data,object,id}' = s.charge_id));
  return greatest(v_out, v_ledger);
end $$;

-- ── F3 The figures of one payment: THE one definition ───────────────────────────────────────────────────
-- o_state: paused (observation not recorded on, or the sweep has not CLAIMED within the liveness interval: at
-- exactly 60:00 it is paused [S12]) -> never_read -> dirty -> known. Not known = no number and no refund button.
-- counted = every mirrored refund that is not failed / canceled, once, whatever it claims. in_flight = our own
-- requests that are not closed and that no mirrored refund accounts for. B1 never corrects main's status: it
-- reports the disagreement.
create function public.catering_refund_payment_figures(p_payment_id uuid,
  out o_eligible boolean, out o_state text, out o_known boolean, out o_captured bigint, out o_counted bigint,
  out o_in_flight bigint, out o_refundable bigint, out o_blocked boolean, out o_stripe_whole boolean,
  out o_disagrees boolean, out o_checked_at timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_pay record;
  s public.catering_refund_payment_state%rowtype;
  o public.catering_refund_observation%rowtype;
  v_now timestamptz := clock_timestamp();
  v_dirty timestamptz;
begin
  o_eligible := false; o_state := 'never_read'; o_known := false; o_counted := 0; o_in_flight := 0; o_blocked := false;
  o_stripe_whole := false; o_disagrees := false;
  select p.status, p.provider, p.provider_ref into v_pay from public.catering_payments p where p.id = p_payment_id;
  if not found then return; end if;
  o_eligible := v_pay.status in ('paid', 'refunded') and v_pay.provider is not distinct from 'stripe'
                and coalesce(v_pay.provider_ref, '') ~ '^pi_[A-Za-z0-9_]+$';
  select * into s from public.catering_refund_payment_state x where x.payment_id = p_payment_id;
  select * into o from public.catering_refund_observation x where x.id;
  if not coalesce(o.observe_on, false) or o.last_claim_at is null
     or o.last_claim_at <= v_now - public.catering_refund_liveness_interval() then
    o_state := 'paused';
  elsif s.last_complete_read_started_at is null then
    o_state := 'never_read';
  else
    v_dirty := public.catering_refund_dirty_at(p_payment_id);
    if s.last_complete_read_transitions is distinct from o.transitions
       or s.payment_intent_id is distinct from v_pay.provider_ref
       or v_dirty = 'infinity'::timestamptz
       or (v_dirty is not null and s.last_complete_read_started_at < v_dirty + public.catering_refund_settle_interval()) then
      o_state := 'dirty';
    else
      o_state := 'known';
    end if;
  end if;
  o_known := (o_state = 'known');
  o_captured := s.captured_cents;
  o_checked_at := s.last_complete_read_started_at;
  select coalesce(sum(m.amount_cents) filter (where coalesce(m.status, '') not in ('failed', 'canceled')), 0)
    into o_counted from public.catering_refund_observed m where m.payment_id = p_payment_id;
  select coalesce(sum(r.amount_cents) filter (where r.status <> 'failed' and not exists (
             select 1 from public.catering_refund_observed m
              where m.request_id = r.id or (r.stripe_refund_id is not null and m.refund_id = r.stripe_refund_id))), 0),
         coalesce(bool_or(r.status = 'pending'), false)
    into o_in_flight, o_blocked
    from public.catering_refund_requests r where r.payment_id = p_payment_id;
  if o_known and o_eligible and o_captured is not null then
    o_refundable := case when o_blocked then 0 else greatest(0, o_captured - o_counted - o_in_flight) end;
  else
    o_refundable := null; -- unknown is never 0
  end if;
  o_stripe_whole := coalesce(o_captured > 0 and o_counted >= o_captured, false);
  o_disagrees := o_known and ((v_pay.status = 'refunded') <> o_stripe_whole);
end $$;

-- ── F4 The B2 / B3 database gate [DR2] ──────────────────────────────────────────────────────────────────
-- True only when BOTH later parts have installed their readiness function, each returns boolean, and each answers
-- true. A missing function, another return type, a set, NULL, false or ANY error is false. False today.
create function public.catering_refund_parts_ready() returns boolean
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  f text;
  v_oid oid;
  v boolean;
begin
  foreach f in array array['public.catering_refund_b2_ready()', 'public.catering_refund_b3_ready()'] loop
    v_oid := to_regprocedure(f);
    if v_oid is null then return false; end if;
    if not exists (select 1 from pg_proc p where p.oid = v_oid and p.prorettype = 'boolean'::regtype and not p.proretset) then
      return false;
    end if;
    begin
      execute 'select ' || f into v;
    exception when others then
      return false;
    end;
    if v is distinct from true then return false; end if;
  end loop;
  return true;
end $$;

-- ── The claims of one payment's mirrored refunds (helper of F6, F7, F12, F15, F16; ONE definition) ───────
-- kind:  bound      a request holds it
--        none       its metadata names no request (a refund not made in the app, or its metadata was removed)
--        candidate  the UNIQUE refund that names this payment's unresolved armed request and matches it (amount,
--                   currency, PaymentIntent or owner charge) AND was created at or after the arm, compared at the
--                   arm's full precision [Q2] [T1]: the only kind a complete read binds by itself
--        ambiguous  two or more such refunds
--        mismatch   names that request but another amount / PaymentIntent, or was created before the arm
--        unarmed | released | duplicate | foreign   names a request that is reserved only, closed with no refund,
--                   bound to another refund, or not this payment's
-- attachable_to: the unresolved armed request a PERSON could attach this refund to (F16): unbound and unheld, names
--   no OTHER request, the request's amount and the owner's currency, the armed PaymentIntent (or none and the owner's
--   charge), retrieved by the payment's last complete read. NO time condition [T1].
create function public.catering_refund_claims(p_payment_id uuid)
returns table (refund_id text, kind text, attachable_to uuid)
language sql stable security definer set search_path = pg_catalog, public as $$
  with s as (
    select x.currency, x.charge_id, x.last_complete_read_started_at
      from public.catering_refund_payment_state x where x.payment_id = p_payment_id),
  pend as (
    select r.id, r.amount_cents, r.arm_payment_intent, r.create_armed_at
      from public.catering_refund_requests r
     where r.payment_id = p_payment_id and r.status = 'pending' and r.create_armed_at is not null and r.stripe_refund_id is null),
  m as (
    select o.*, exists (select 1 from public.catering_refund_requests q where q.stripe_refund_id = o.refund_id) as held
      from public.catering_refund_observed o where o.payment_id = p_payment_id),
  fit as ( -- matches the request in everything but time
    select m.refund_id, pend.id as request_id, (m.stripe_created_at >= pend.create_armed_at) as in_time,
           (m.meta_request_id is not distinct from pend.id) as names_it
      from m cross join pend cross join s
     where m.request_id is null and not m.held
       and (m.meta_request_id is null or m.meta_request_id = pend.id)
       and m.amount_cents = pend.amount_cents and m.currency = s.currency
       and (m.payment_intent_id = pend.arm_payment_intent or (m.payment_intent_id is null and m.charge_id = s.charge_id))),
  cand as (select f.refund_id, f.request_id from fit f where f.names_it and f.in_time)
  select m.refund_id,
         case when m.request_id is not null or m.held then 'bound'
              when m.meta_request_id is null then 'none'
              when q.id is null or q.payment_id <> p_payment_id then 'foreign'
              when q.status = 'failed' then 'released'
              when q.stripe_refund_id is not null then 'duplicate'
              when q.status <> 'pending' then 'duplicate'
              when q.create_armed_at is null then 'unarmed'
              when exists (select 1 from cand c where c.refund_id = m.refund_id) then
                case when (select count(*) from cand c where c.request_id = q.id) > 1 then 'ambiguous' else 'candidate' end
              else 'mismatch' end as kind,
         (select f.request_id from fit f cross join s
           where f.refund_id = m.refund_id and m.read_started_at = s.last_complete_read_started_at limit 1) as attachable_to
    from m left join public.catering_refund_requests q on q.id = m.meta_request_id
$$;

-- ── Does a create ANSWER belong to this request? (helper of F10; both of its `created` branches [R8] [S9]) ─
-- The response must carry our request id in its metadata, the request's amount, the owner's currency, the armed
-- PaymentIntent (or no PaymentIntent and the owner's charge) and, when it names a charge, the owner's charge.
create function public.catering_refund_answer_matches(p_request_id uuid, p_refund jsonb) returns boolean
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  r record;
  s record;
begin
  if p_refund is null or jsonb_typeof(p_refund) <> 'object' then return false; end if;
  select q.id, q.payment_id, q.amount_cents, q.arm_payment_intent into r from public.catering_refund_requests q where q.id = p_request_id;
  if not found or r.arm_payment_intent is null then return false; end if;
  select x.currency, x.charge_id into s from public.catering_refund_payment_state x where x.payment_id = r.payment_id;
  if not found or s.currency is null or s.charge_id is null then return false; end if;
  return coalesce(
        coalesce(p_refund ->> 'id', '') ~ '^(re|pyr)_[A-Za-z0-9_]{1,250}$'
    and lower(coalesce(p_refund ->> 'request_id', '')) = r.id::text
    and jsonb_typeof(p_refund -> 'amount') = 'number' and (p_refund ->> 'amount') = r.amount_cents::text
    and lower(coalesce(p_refund ->> 'currency', '')) = s.currency
    and (   coalesce(p_refund ->> 'payment_intent', '') = r.arm_payment_intent
         or (coalesce(p_refund ->> 'payment_intent', '') = '' and coalesce(p_refund ->> 'charge', '') = s.charge_id))
    and (coalesce(p_refund ->> 'charge', '') = '' or (p_refund ->> 'charge') = s.charge_id), false);
end $$;

-- ── Who may release or attach [DR3]: the role, or null ──────────────────────────────────────────────────
-- An ACTIVE owner / cgs at any shop; an ACTIVE moo with an ACTIVE membership at the request's shop. The users row is
-- read FOR SHARE first, before any payment lock (the same order as 0357's reserve).
create function public.catering_refund_release_role(p_actor_id uuid, p_shop_id uuid) returns text
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_role text;
begin
  select u.role into v_role from public.users u where u.id = p_actor_id and u.active for share;
  if v_role is null then return null; end if;
  if v_role in ('owner', 'cgs') then return v_role; end if;
  if v_role = 'moo' and p_shop_id is not null and exists (
       select 1 from public.user_locations m where m.user_id = p_actor_id and m.location_id = p_shop_id and m.active) then
    return v_role;
  end if;
  return null;
end $$;

-- ── F14 The sweep's work list (called only by F13, in the claim's own transaction) ──────────────────────
-- Scope = F3-eligible payments. ONE set-based pass over the ledger (the rows newer than the oldest complete read in
-- scope, less settle), never one scan per payment [P3-7]; `ledger_rows_read` says how many. It classifies each
-- payment by F3's own rule (the harness holds the two equal), with observation taken as live: F13 has just claimed.
--   A (needs a read now; least recently attempted first): never read, or not known, and a read begun now could make
--     it known (the settle interval after its dirty instant has passed); or an armed unresolved request exists (every
--     run); or coverage cannot be proven and the last attempt is older than 20 hours.
--   C (the re-read [T3]; oldest read first): known, last complete read started 45 minutes ago or more, activity
--     within 120 days (the latest of paid_at, a mirrored refund's created / status change, a request's requested_at).
-- A payment with a read in flight (opened less than 15 minutes ago, not recorded) is in neither list: beginning
-- another read would replace it [T2]. The two lists are returned SEPARATELY; who gets the run's time is the worker's.
create function public.catering_refund_sweep_due(p_limit integer) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_now timestamptz := clock_timestamp();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_settle interval := public.catering_refund_settle_interval();
  v_max_age interval := public.catering_refund_read_max_age();
  v_reread interval := public.catering_refund_reread_interval();
  o public.catering_refund_observation%rowtype;
  v_oldest_ledger timestamptz;
  v_w_min timestamptz;
  v_ledger_rows bigint := 0;
  v_stale jsonb;
  v_out jsonb;
begin
  select * into o from public.catering_refund_observation x where x.id;
  select min(e.received_at) into v_oldest_ledger from public.stripe_events e;
  select min(s.last_complete_read_started_at) - v_settle into v_w_min
    from public.catering_refund_payment_state s join public.catering_payments p on p.id = s.payment_id
   where p.status in ('paid', 'refunded') and p.provider is not distinct from 'stripe'
     and coalesce(p.provider_ref, '') ~ '^pi_[A-Za-z0-9_]+$';
  if v_w_min is not null then
    select count(*) into v_ledger_rows from public.stripe_events e where e.received_at > v_w_min;
  end if;

  with scope as (
    select p.id, p.provider_ref, p.paid_at, p.created_at,
           s.open_read_id, s.open_read_started_at, s.payment_intent_id, s.charge_id,
           s.last_complete_read_started_at as read_at, s.last_complete_read_transitions as read_tr,
           s.dirty_since, s.last_attempt_at
      from public.catering_payments p left join public.catering_refund_payment_state s on s.payment_id = p.id
     where p.status in ('paid', 'refunded') and p.provider is not distinct from 'stripe'
       and coalesce(p.provider_ref, '') ~ '^pi_[A-Za-z0-9_]+$'),
  ev as materialized (
    select e.received_at,
           coalesce(e.payload #>> '{data,object,payment_intent,id}', e.payload #>> '{data,object,payment_intent}') as pi,
           case when e.type like 'payment\_intent.%' then e.payload #>> '{data,object,id}' end as own_pi,
           coalesce(e.payload #>> '{data,object,charge,id}', e.payload #>> '{data,object,charge}') as ch,
           case when e.type like 'charge.%' then e.payload #>> '{data,object,id}' end as own_ch
      from public.stripe_events e
     where v_w_min is not null and e.received_at > v_w_min),
  led as (
    select sc.id, max(ev.received_at) as ledger_at
      from scope sc join ev
        on ev.received_at > sc.read_at - v_settle
       and (ev.pi in (sc.provider_ref, sc.payment_intent_id) or ev.own_pi in (sc.provider_ref, sc.payment_intent_id)
            or ev.ch = sc.charge_id or ev.own_ch = sc.charge_id)
     where sc.read_at is not null
     group by sc.id),
  j as (
    select sc.*,
           case when sc.read_at is not null and (v_oldest_ledger is null or v_oldest_ledger > sc.read_at - v_settle)
                  then 'infinity'::timestamptz
                else greatest(sc.dirty_since, o.transitioned_at, o.resumed_at,
                              case when sc.open_read_id is not null and sc.open_read_started_at <= v_now - v_max_age
                                   then sc.open_read_started_at end,
                              led.ledger_at) end as dirty_at,
           (sc.open_read_id is not null and sc.open_read_started_at > v_now - v_max_age) as in_flight,
           exists (select 1 from public.catering_refund_requests r
                    where r.payment_id = sc.id and r.status = 'pending' and r.create_armed_at is not null) as unconfirmed,
           greatest(sc.paid_at,
                    (select max(greatest(m.stripe_created_at, m.status_changed_at)) from public.catering_refund_observed m where m.payment_id = sc.id),
                    (select max(r.requested_at) from public.catering_refund_requests r where r.payment_id = sc.id)) as activity_at
      from scope sc left join led on led.id = sc.id),
  k as (
    select j.*,
           case when j.read_at is null then 'never_read'
                when j.read_tr is distinct from o.transitions or j.payment_intent_id is distinct from j.provider_ref
                     or j.dirty_at = 'infinity'::timestamptz
                     or (j.dirty_at is not null and j.read_at < j.dirty_at + v_settle) then 'dirty'
                else 'known' end as st
      from j),
  a as (
    select k.id, k.last_attempt_at from k
     where not k.in_flight
       and (   (k.st in ('never_read', 'dirty') and (k.dirty_at is null or (k.dirty_at <> 'infinity'::timestamptz and v_now >= k.dirty_at + v_settle)))
            or k.unconfirmed
            or (k.dirty_at = 'infinity'::timestamptz and (k.last_attempt_at is null or k.last_attempt_at <= v_now - interval '20 hours')))),
  c as (
    select k.id, k.read_at from k
     where not k.in_flight and k.st = 'known' and k.read_at <= v_now - v_reread
       and k.activity_at > v_now - interval '120 days')
  select jsonb_build_object(
           'a', coalesce((select jsonb_agg(x.id order by x.last_attempt_at asc nulls first, x.id)
                            from (select a.id, a.last_attempt_at from a order by a.last_attempt_at asc nulls first, a.id limit v_limit) x), '[]'::jsonb),
           'c', coalesce((select jsonb_agg(x.id order by x.read_at, x.id)
                            from (select c.id, c.read_at from c order by c.read_at, c.id limit v_limit) x), '[]'::jsonb),
           'counts', jsonb_build_object(
             'in_scope', (select count(*) from k),
             'never_read', (select count(*) from k where k.st = 'never_read'),
             'dirty', (select count(*) from k where k.st = 'dirty'),
             'known', (select count(*) from k where k.st = 'known'),
             'unconfirmed', (select count(*) from k where k.unconfirmed),
             'a_due', (select count(*) from a),
             'c_due', (select count(*) from c),
             'ledger_rows_read', v_ledger_rows),
           'states', coalesce((select jsonb_object_agg(k.id::text, k.st) from k), '{}'::jsonb),
           'oldest_unchecked_at', (select min(coalesce(k.read_at, k.paid_at, k.created_at)) from k where k.st <> 'known'),
           'oldest_read_started_at', (select min(k.read_at) from k where k.st = 'known' and k.activity_at > v_now - interval '120 days'))
    into v_out;

  select coalesce(jsonb_agg(x.id order by x.requested_at, x.id), '[]'::jsonb) into v_stale from (
    select r.id, r.requested_at from public.catering_refund_requests r
     where r.status = 'pending' and r.create_armed_at is null and r.requested_at <= v_now - interval '15 minutes'
     order by r.requested_at, r.id limit 50) x;
  return v_out || jsonb_build_object('stale_unarmed', v_stale, 'generated_at', v_now);
end $$;

-- ── F17 THE operator statement [Q1]: select public.catering_refund_observe_set(true | false); ───────────
-- EXECUTE for the owner only: no application role can call it, so no app path can record a transition. Every call
-- adds one to the transition count (ON after ON included: EVERY turn-on invalidates) and stamps the instant, which is
-- a dirty instant for every payment, read or never read [T4]; a turn-on also stamps every state row. F3 compares
-- each complete read's transition count with the current one, so a read in flight across the statement is
-- invalidated as well.
create function public.catering_refund_observe_set(p_on boolean) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  o public.catering_refund_observation%rowtype;
  v_now timestamptz;
  v_n bigint := 0;
  v_rows bigint;
begin
  if p_on is null then raise exception 'invalid_request' using errcode = 'P0001'; end if;
  select * into o from public.catering_refund_observation x where x.id for update;
  if not found then raise exception 'observation_row_missing' using errcode = 'P0001'; end if;
  v_now := clock_timestamp();
  update public.catering_refund_observation x
     set transitions = x.transitions + 1, observe_on = p_on, transitioned_at = v_now
   where x.id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'observation_row_missing' using errcode = 'P0001'; end if;
  if p_on then
    update public.catering_refund_payment_state x set dirty_since = v_now;
    get diagnostics v_n = row_count;
  end if;
  return jsonb_build_object('transitions', o.transitions + 1, 'observe_on', p_on, 'transitioned_at', v_now, 'stamped', v_n);
end $$;

-- ── F5 Open a read [P3-6] [R13] [T2] ────────────────────────────────────────────────────────────────────
-- The read is the DATABASE's: its id and its start (taken AFTER the payment lock is held) live on the payment's
-- state row, and F6 accepts only the id that is still the open one. A newer begin REPLACES the open read; when it
-- does, the payment is stamped dirty in the same statement, whatever the old read's age [T2]: a read that was begun
-- and never recorded is a read that did not end complete, and the read that replaced it cannot read `known` by
-- itself. The start is strictly later than every earlier read's start on this payment (a coarse clock cannot make
-- two reads share an instant). A first call creates the state row with every complete-read column null [R13].
-- It never returns a token and takes no time from the caller. Not eligible: nothing is written.
create function public.catering_refund_read_begin(p_payment_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_pay record;
  s public.catering_refund_payment_state%rowtype;
  v_id uuid := gen_random_uuid();
  v_start timestamptz;
  v_tr bigint;
  v_shop uuid;
  v_replaced boolean := false;
begin
  if p_payment_id is null then raise exception 'invalid_request' using errcode = 'P0001'; end if;
  select p.id, p.status, p.provider, p.provider_ref, p.quote_id into v_pay
    from public.catering_payments p where p.id = p_payment_id for no key update;
  if not found or not (v_pay.status in ('paid', 'refunded') and v_pay.provider is not distinct from 'stripe'
                       and coalesce(v_pay.provider_ref, '') ~ '^pi_[A-Za-z0-9_]+$') then
    return jsonb_build_object('eligible', false);
  end if;
  select * into s from public.catering_refund_payment_state x where x.payment_id = p_payment_id for update;
  v_replaced := s.open_read_id is not null;
  select x.transitions into v_tr from public.catering_refund_observation x where x.id;
  v_start := greatest(clock_timestamp(),
                      s.open_read_started_at + interval '1 microsecond',
                      s.last_complete_read_started_at + interval '1 microsecond',
                      (select max(m.read_started_at) from public.catering_refund_observed m where m.payment_id = p_payment_id)
                        + interval '1 microsecond');
  -- Unconditional upsert under the payment lock (census allowlist: F5's upsert).
  insert into public.catering_refund_payment_state as x (payment_id, open_read_id, open_read_started_at, open_read_transitions)
    values (p_payment_id, v_id, v_start, coalesce(v_tr, 0))
  on conflict (payment_id) do update
    set dirty_since = case when x.open_read_id is not null then greatest(x.dirty_since, v_start) else x.dirty_since end,
        open_read_id = excluded.open_read_id,
        open_read_started_at = excluded.open_read_started_at,
        open_read_transitions = excluded.open_read_transitions;
  select q.location_id into v_shop from public.catering_quotes q where q.id = v_pay.quote_id;
  return jsonb_build_object(
    'eligible', true, 'read_id', v_id, 'started_at', v_start, 'replaced', v_replaced,
    'payment_id', p_payment_id, 'payment_intent', v_pay.provider_ref, 'quote_id', v_pay.quote_id, 'location_id', v_shop,
    'mirrored_ids', coalesce((select jsonb_agg(m.refund_id order by m.refund_id)
                                from public.catering_refund_observed m where m.payment_id = p_payment_id), '[]'::jsonb),
    'request_refund_ids', coalesce((select jsonb_agg(r.stripe_refund_id order by r.stripe_refund_id)
                                      from public.catering_refund_requests r
                                     where r.payment_id = p_payment_id and r.stripe_refund_id is not null), '[]'::jsonb));
end $$;

-- ── F6 Record a read: the ONLY writer of the mirror and of the complete stamp ───────────────────────────
-- It NEVER raises for evidence [R3]: the only uncaught errors are `invalid_request` (a null id: there is nothing to
-- mark) and the bind's defect guard (CRB03: both rows are under this payment's lock, so it would be a defect, never
-- a state; it undoes the call and the read is then an opened read that never recorded). Every other outcome RETURNS,
-- so the dirty stamp and the reason commit.
--   p_owner   { payment_intent, charge, currency, livemode, captured, account_slot, credential_fp }
--   p_lists   [ { by: 'payment_intent' | 'charge', terminal: bool, ids: [...] } ]   (the app attests the terminal page)
--   p_refunds [ { id, amount, currency, payment_intent, charge, status, created, request_id } ]  RETRIEVED objects only;
--             request_id = metadata.refund_request_id as retrieved (a CLAIM, never proof)
--   result    complete | not_complete (+ reason) | read_replaced
-- COMPLETE (decided here, from what the read hands over): p_result = 'complete'; the owner is whole and its
-- PaymentIntent is the row's; both lists are present and terminal; every listed id, every id already mirrored for the
-- payment and every refund id a request holds was retrieved; nothing failed verification or belongs elsewhere.
-- The charge's own amount_refunded is NOT used anywhere [Q3].
create function public.catering_refund_record_read(p_payment_id uuid, p_read_id uuid, p_result text, p_owner jsonb,
  p_lists jsonb, p_refunds jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  c_refund constant text := '^(re|pyr)_[A-Za-z0-9_]{1,250}$';
  c_pi constant text := '^pi_[A-Za-z0-9_]{1,250}$';
  c_charge constant text := '^[a-z]{2,4}_[A-Za-z0-9_]{1,250}$';
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_pay record;
  s public.catering_refund_payment_state%rowtype;
  v_now timestamptz;
  v_start timestamptz;
  v_tr bigint;
  v_reason text;
  v_conflict uuid;
  v_owner_ok boolean := false;
  v_refunds jsonb := coalesce(p_refunds, '[]'::jsonb);
  v_lists jsonb := coalesce(p_lists, '[]'::jsonb);
  v_ids text[];
  x record;
  v_prev record;
  r record;
  v_other uuid;
  v_n bigint;
  v_mirrored integer := 0;
  v_token uuid;
  v_bound jsonb := '[]'::jsonb;
  v_linked bigint := 0;
  v_cand_n bigint;
  v_cand text;
  v_cand_status text;
begin
  if p_payment_id is null or p_read_id is null then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  -- 1. The locks: the payment row, then its state row.
  select p.id, p.provider_ref into v_pay from public.catering_payments p where p.id = p_payment_id for no key update;
  select * into s from public.catering_refund_payment_state y where y.payment_id = p_payment_id for update;
  v_now := clock_timestamp();

  -- 2. Not the open read (a later read was begun, this one was already recorded, or the id was never issued):
  --    nothing of it is written to the mirror, and the payment is marked dirty all the same [T2].
  if s.payment_id is null or s.open_read_id is distinct from p_read_id then
    if s.payment_id is not null then
      update public.catering_refund_payment_state y
         set dirty_since = v_now, last_attempt_at = v_now, last_attempt_result = 'read_replaced', last_attempt_conflict_with = null
       where y.payment_id = p_payment_id;
    end if;
    return jsonb_build_object('result', 'read_replaced', 'reason', 'read_replaced');
  end if;

  -- 3. This is the payment's open read; its start is the database's own value.
  v_start := s.open_read_started_at;
  v_tr := s.open_read_transitions;

  -- 4. Too old, or evidence that is not of the expected shape. (Each test is its own statement: a set-returning
  --    function is never applied to a value whose type was not checked first, so nothing here can raise.)
  if v_start <= v_now - public.catering_refund_read_max_age() then
    v_reason := 'read_too_old';
  elsif p_result is null or p_result !~ '^[a-z][a-z0-9_]{0,39}$' or p_result in ('not_complete', 'read_replaced') then
    v_reason := 'evidence_malformed';
  elsif (p_owner is not null and jsonb_typeof(p_owner) not in ('object', 'null'))
        or jsonb_typeof(v_lists) <> 'array' or jsonb_typeof(v_refunds) <> 'array' then
    v_reason := 'evidence_malformed';
  end if;
  if v_reason is null and exists (
       select 1 from jsonb_array_elements(v_lists) l
        where jsonb_typeof(l) <> 'object' or coalesce(l ->> 'by', '') not in ('payment_intent', 'charge')
           or coalesce(jsonb_typeof(l -> 'terminal'), '') <> 'boolean' or coalesce(jsonb_typeof(l -> 'ids'), '') <> 'array') then
    v_reason := 'evidence_malformed';
  end if;
  if v_reason is null and (
       (select count(*) from jsonb_array_elements(v_lists) l) <> (select count(distinct l ->> 'by') from jsonb_array_elements(v_lists) l)
       or exists (select 1 from jsonb_array_elements(v_lists) l, jsonb_array_elements(l -> 'ids') i
                   where jsonb_typeof(i) <> 'string' or (i #>> '{}') !~ c_refund)) then
    v_reason := 'evidence_malformed';
  end if;
  if v_reason is null and exists (
       select 1 from jsonb_array_elements(v_refunds) e
        where jsonb_typeof(e) <> 'object'
           or coalesce(e ->> 'id', '') !~ c_refund
           or coalesce(jsonb_typeof(e -> 'amount'), '') <> 'number' or (e ->> 'amount') !~ '^[0-9]{1,15}$'
           or coalesce(jsonb_typeof(e -> 'created'), '') <> 'number' or (e ->> 'created') !~ '^[0-9]{1,11}$'
           or coalesce(jsonb_typeof(e -> 'currency'), '') <> 'string' or lower(e ->> 'currency') !~ '^[a-z]{3}$'
           or coalesce(jsonb_typeof(e -> 'payment_intent'), 'null') not in ('string', 'null')
           or (jsonb_typeof(e -> 'payment_intent') = 'string' and (e ->> 'payment_intent') !~ c_pi)
           or coalesce(jsonb_typeof(e -> 'charge'), 'null') not in ('string', 'null')
           or (jsonb_typeof(e -> 'charge') = 'string' and (e ->> 'charge') !~ c_charge)
           or coalesce(jsonb_typeof(e -> 'status'), 'null') not in ('string', 'null')
           or coalesce(jsonb_typeof(e -> 'request_id'), 'null') not in ('string', 'null')) then
    v_reason := 'evidence_malformed';
  end if;
  if v_reason is null and (select count(*) from jsonb_array_elements(v_refunds) e)
                          <> (select count(distinct e ->> 'id') from jsonb_array_elements(v_refunds) e) then
    v_reason := 'evidence_malformed';
  end if;

  -- The owner is WHOLE when every fact a complete read stores is present and well formed and its PaymentIntent is the
  -- payment row's. Refunds are verified against a whole owner only.
  if v_reason is null and p_owner is not null and jsonb_typeof(p_owner) = 'object' then
    v_owner_ok := coalesce(
          coalesce(p_owner ->> 'payment_intent', '') ~ c_pi and (p_owner ->> 'payment_intent') = v_pay.provider_ref
      and coalesce(p_owner ->> 'charge', '') ~ c_charge
      and lower(coalesce(p_owner ->> 'currency', '')) ~ '^[a-z]{3}$'
      and coalesce(jsonb_typeof(p_owner -> 'livemode'), '') = 'boolean'
      and coalesce(jsonb_typeof(p_owner -> 'captured'), '') = 'number' and (p_owner ->> 'captured') ~ '^[0-9]{1,15}$'
      and coalesce(p_owner ->> 'account_slot', '') in ('location', 'default')
      and coalesce(p_owner ->> 'credential_fp', '') ~ '^[0-9a-f]{16}$', false);
  end if;

  -- 5. VERIFY every retrieved refund against the owner. Any failure: no refund of this call is written.
  if v_reason is null and jsonb_array_length(v_refunds) > 0 then
    if not v_owner_ok then
      v_reason := 'evidence_mismatch';
    elsif exists (
        select 1 from jsonb_array_elements(v_refunds) e
         where (e ->> 'amount')::bigint <= 0
            or lower(e ->> 'currency') <> lower(p_owner ->> 'currency')
            or (jsonb_typeof(e -> 'payment_intent') = 'string' and (e ->> 'payment_intent') <> v_pay.provider_ref)
            or (jsonb_typeof(e -> 'charge') = 'string' and (e ->> 'charge') <> (p_owner ->> 'charge'))
            or (coalesce(jsonb_typeof(e -> 'payment_intent'), 'null') = 'null' and coalesce(jsonb_typeof(e -> 'charge'), 'null') = 'null')) then
      v_reason := 'evidence_mismatch';
    end if;
  end if;

  -- 6. WRITE the mirror inside ONE inner block. Ownership is decided in the write, never by a pre-check: an id that
  --    is another payment's (CRB01) or a stored row that is not older than this read (CRB02) leaves the block through
  --    its handler, which undoes every mirror write of this call and nothing else. Ids are written in ascending
  --    order so two reads of two payments can never wait on each other in a cycle.
  if v_reason is null then
    begin
      for x in
        select e ->> 'id' as id, (e ->> 'amount')::bigint as amount, lower(e ->> 'currency') as currency,
               case when jsonb_typeof(e -> 'payment_intent') = 'string' then e ->> 'payment_intent' end as pi,
               case when jsonb_typeof(e -> 'charge') = 'string' then e ->> 'charge' end as charge,
               case when jsonb_typeof(e -> 'status') = 'string' then left(e ->> 'status', 40) end as status,
               to_timestamp((e ->> 'created')::bigint) as created,
               case when coalesce(e ->> 'request_id', '') ~ c_uuid then (e ->> 'request_id')::uuid end as meta
          from jsonb_array_elements(v_refunds) e
         order by e ->> 'id'
      loop
        select m.payment_id into v_prev from public.catering_refund_observed m where m.refund_id = x.id;
        if not found then
          insert into public.catering_refund_observed (refund_id, payment_id, payment_intent_id, charge_id, amount_cents, currency,
              status, stripe_created_at, meta_request_id, read_started_at, recorded_at, first_seen_at)
            values (x.id, p_payment_id, x.pi, x.charge, x.amount, x.currency, x.status, x.created, x.meta, v_start, v_now, v_now)
          on conflict (refund_id) do nothing;
          get diagnostics v_n = row_count;
          if v_n = 0 then
            select m.payment_id into v_other from public.catering_refund_observed m where m.refund_id = x.id;
            if v_other is distinct from p_payment_id then
              v_conflict := v_other;
              raise exception using errcode = 'CRB01', message = 'refund_under_another_payment';
            end if;
            raise exception using errcode = 'CRB02', message = 'read_contested';
          end if;
        elsif v_prev.payment_id <> p_payment_id then
          v_conflict := v_prev.payment_id;
          raise exception using errcode = 'CRB01', message = 'refund_under_another_payment';
        else
          update public.catering_refund_observed m
             set payment_intent_id = x.pi, charge_id = x.charge, amount_cents = x.amount, currency = x.currency,
                 previous_status = case when m.status is distinct from x.status then m.status else m.previous_status end,
                 status_changed_at = case when m.status is distinct from x.status then v_now else m.status_changed_at end,
                 status = x.status, stripe_created_at = x.created, meta_request_id = x.meta,
                 read_started_at = v_start, recorded_at = v_now
           where m.refund_id = x.id and m.payment_id = p_payment_id and m.read_started_at < v_start;
          get diagnostics v_n = row_count;
          if v_n = 0 then
            raise exception using errcode = 'CRB02', message = 'read_contested';
          end if;
        end if;
        v_mirrored := v_mirrored + 1;
      end loop;
    exception
      when sqlstate 'CRB01' then v_reason := 'evidence_conflict'; v_mirrored := 0;
      when sqlstate 'CRB02' then v_reason := 'contested'; v_mirrored := 0;
    end;
  end if;

  -- 7. COMPLETE, or the named reason it is not.
  if v_reason is null and p_result <> 'complete' then
    v_reason := p_result; -- the app's own named reason (a provider problem, a timeout, a spent budget)
  end if;
  if v_reason is null then
    select array_agg(e ->> 'id') into v_ids from jsonb_array_elements(v_refunds) e;
    v_ids := coalesce(v_ids, array[]::text[]);
    if not v_owner_ok
       or (select count(*) from jsonb_array_elements(v_lists) l where (l -> 'terminal')::boolean) <> 2
       or exists (select 1 from jsonb_array_elements(v_lists) l, jsonb_array_elements_text(l -> 'ids') i where not (i = any(v_ids)))
       or exists (select 1 from public.catering_refund_observed m where m.payment_id = p_payment_id and not (m.refund_id = any(v_ids)))
       or exists (select 1 from public.catering_refund_requests q
                   where q.payment_id = p_payment_id and q.stripe_refund_id is not null and not (q.stripe_refund_id = any(v_ids))) then
      v_reason := 'incomplete_evidence';
    end if;
  end if;

  if v_reason is not null then
    -- 8. Every read that does not end complete marks the payment dirty, durably, and closes its slot.
    update public.catering_refund_payment_state y
       set dirty_since = v_now, last_attempt_at = v_now, last_attempt_result = left(v_reason, 40),
           last_attempt_conflict_with = v_conflict,
           open_read_id = null, open_read_started_at = null, open_read_transitions = null
     where y.payment_id = p_payment_id and y.open_read_id = p_read_id;
    get diagnostics v_n = row_count;
    if v_n <> 1 then
      return jsonb_build_object('result', 'read_replaced', 'reason', 'read_replaced');
    end if;
    return jsonb_build_object('result', 'not_complete', 'reason', v_reason, 'started_at', v_start, 'mirrored', v_mirrored,
                              'bound', '[]'::jsonb, 'conflict_with', v_conflict);
  end if;

  -- The complete stamp. The slot is closed by THIS statement, whose WHERE still needs the slot (Opus P3-d).
  v_token := gen_random_uuid();
  update public.catering_refund_payment_state y
     set last_complete_read_started_at = v_start, last_complete_read_recorded_at = v_now,
         last_complete_read_token = v_token, last_complete_read_transitions = v_tr,
         payment_intent_id = p_owner ->> 'payment_intent', charge_id = p_owner ->> 'charge',
         currency = lower(p_owner ->> 'currency'), livemode = (p_owner -> 'livemode')::boolean,
         captured_cents = (p_owner ->> 'captured')::bigint, account_slot = p_owner ->> 'account_slot',
         credential_fp = p_owner ->> 'credential_fp',
         last_attempt_at = v_now, last_attempt_result = 'complete', last_attempt_conflict_with = null,
         open_read_id = null, open_read_started_at = null, open_read_transitions = null
   where y.payment_id = p_payment_id and y.open_read_id = p_read_id;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    return jsonb_build_object('result', 'read_replaced', 'reason', 'read_replaced');
  end if;

  -- BIND [Q2] [T1], only now, inside a read that ended complete: the UNIQUE candidate (catering_refund_claims).
  for r in
    select q.id from public.catering_refund_requests q
     where q.payment_id = p_payment_id and q.status = 'pending' and q.create_armed_at is not null and q.stripe_refund_id is null
     order by q.id
  loop
    select count(*), min(c.refund_id) into v_cand_n, v_cand
      from public.catering_refund_claims(p_payment_id) c join public.catering_refund_observed m on m.refund_id = c.refund_id
     where c.kind = 'candidate' and m.meta_request_id = r.id;
    if v_cand_n = 1 then
      select m.status into v_cand_status from public.catering_refund_observed m where m.refund_id = v_cand;
      update public.catering_refund_requests q
         set status = 'submitted', stripe_refund_id = v_cand, stripe_status = v_cand_status, settled_at = v_now, updated_at = v_now
       where q.id = r.id and q.status = 'pending' and q.create_armed_at is not null and q.stripe_refund_id is null;
      get diagnostics v_n = row_count;
      if v_n = 1 then
        update public.catering_refund_observed m set request_id = r.id where m.refund_id = v_cand and m.request_id is null;
        get diagnostics v_n = row_count;
        if v_n <> 1 then
          raise exception using errcode = 'CRB03', message = 'refund_bind_defect';
        end if;
        v_bound := v_bound || jsonb_build_object('request_id', r.id, 'refund_id', v_cand);
      end if;
    end if;
  end loop;
  -- A request that F10 (or 0357's sender) already bound to a refund id now mirrored gets its link only.
  update public.catering_refund_observed m
     set request_id = q.id
    from public.catering_refund_requests q
   where m.payment_id = p_payment_id and m.request_id is null and q.payment_id = p_payment_id and q.stripe_refund_id = m.refund_id;
  get diagnostics v_linked = row_count;

  return jsonb_build_object('result', 'complete', 'reason', null, 'read_token', v_token, 'started_at', v_start,
                            'mirrored', v_mirrored, 'bound', v_bound, 'linked', v_linked, 'conflict_with', null);
end $$;

-- ── F7 The panel's read model: stored state only, zero Stripe calls, no token ───────────────────────────
-- For each quote (at most 50): the family's payments with F3's figures and the account slot, mode and credential
-- fingerprint of the last complete read; their mirrored refunds with the claim kind and `attachable_to`; their
-- requests. Ids, cents, states and instants only.
create function public.catering_refund_summary(p_quote_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_quote uuid;
  v_root uuid;
  v_shop uuid;
  v_payments jsonb;
begin
  if p_quote_ids is null or coalesce(array_length(p_quote_ids, 1), 0) > 50 then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  foreach v_quote in array p_quote_ids loop
    select coalesce(q.root_id, q.id), q.location_id into v_root, v_shop from public.catering_quotes q where q.id = v_quote;
    if v_root is null then continue; end if;
    select coalesce(jsonb_agg(jsonb_build_object(
             'payment_id', p.id, 'kind', p.kind, 'status', p.status, 'amount_cents', p.amount_cents, 'paid_at', p.paid_at,
             'payment_intent', case when f.o_eligible then p.provider_ref end,
             'eligible', f.o_eligible, 'state', f.o_state, 'known', f.o_known, 'checked_at', f.o_checked_at,
             'captured_cents', case when f.o_known then f.o_captured end,
             'counted_cents', case when f.o_known then f.o_counted end,
             'in_flight_cents', case when f.o_known then f.o_in_flight end,
             'refundable_cents', f.o_refundable,
             'blocked', f.o_blocked, 'stripe_whole', case when f.o_known then f.o_stripe_whole end, 'disagrees', f.o_disagrees,
             'account_slot', s.account_slot, 'livemode', s.livemode, 'credential_fp', s.credential_fp,
             'last_attempt_at', s.last_attempt_at, 'last_attempt_result', s.last_attempt_result,
             'refunds', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'refund_id', m.refund_id, 'amount_cents', m.amount_cents, 'currency', m.currency, 'status', m.status,
                        'previous_status', m.previous_status, 'status_changed_at', m.status_changed_at,
                        'created_at', m.stripe_created_at, 'request_id', coalesce(m.request_id, hq.id), 'names_request', m.meta_request_id is not null,
                        'kind', c.kind, 'attachable_to', c.attachable_to) order by m.stripe_created_at, m.refund_id)
                 from public.catering_refund_observed m
                 join public.catering_refund_claims(p.id) c on c.refund_id = m.refund_id
                 left join public.catering_refund_requests hq on hq.stripe_refund_id = m.refund_id
                where m.payment_id = p.id), '[]'::jsonb),
             'requests', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id', r.id, 'amount_cents', r.amount_cents, 'status', r.status, 'reason_code', r.reason_code,
                        'trigger', r.trigger_kind, 'requested_by', r.requested_by, 'requested_at', r.requested_at,
                        'armed', r.create_armed_at is not null, 'armed_at', r.create_armed_at,
                        'releasable_at', r.create_armed_at + interval '24 hours',
                        'stripe_refund_id', r.stripe_refund_id, 'last_error_code', r.last_error_code,
                        'resolved_by', r.resolved_by, 'resolved_at', r.resolved_at, 'settled_at', r.settled_at,
                        'arm_account_slot', r.arm_account_slot, 'arm_livemode', r.arm_livemode, 'arm_credential_fp', r.arm_credential_fp,
                        'legacy', r.create_armed_at is not null and r.arm_credential_fp is null) order by r.requested_at, r.id)
                 from public.catering_refund_requests r where r.payment_id = p.id), '[]'::jsonb)
           ) order by p.created_at, p.id), '[]'::jsonb)
      into v_payments
      from public.catering_payments p
      join public.catering_quotes q on q.id = p.quote_id
      cross join lateral public.catering_refund_payment_figures(p.id) f
      left join public.catering_refund_payment_state s on s.payment_id = p.id
     where coalesce(q.root_id, q.id) = v_root;
    v_out := v_out || jsonb_build_object(
      'quote_id', v_quote, 'location_id', v_shop, 'payments', v_payments,
      'all_known', coalesce((select bool_and((e ->> 'known')::boolean) from jsonb_array_elements(v_payments) e
                              where (e ->> 'eligible')::boolean), true),
      'eligible_payments', (select count(*) from jsonb_array_elements(v_payments) e where (e ->> 'eligible')::boolean),
      'refundable_total_cents', case
        when exists (select 1 from jsonb_array_elements(v_payments) e where (e ->> 'eligible')::boolean and not (e ->> 'known')::boolean) then null
        else coalesce((select sum((e ->> 'refundable_cents')::bigint) from jsonb_array_elements(v_payments) e
                        where (e ->> 'eligible')::boolean and e ->> 'refundable_cents' is not null), 0) end);
  end loop;
  return jsonb_build_object('quotes', v_out, 'generated_at', clock_timestamp(),
                            'parts_ready', public.catering_refund_parts_ready());
end $$;

-- ── F8 Reserve: 0357's reserve on v2's figures ──────────────────────────────────────────────────────────
-- In this order: validation, the quote, the actor rule (0358; it reads the actor row FOR SHARE), the family's payment
-- rows FOR NO KEY UPDATE in id order (0357's order); then
--   REPLAY, with ONE scoped contract on every path, BEFORE every freshness check and under the locks [R7]: a call
--     that lost its read still learns, under the lock the winner takes, whether the same press already reserved;
--   the B2 / B3 gate (F4);
--   the PROBE (p_reads null): the eligible payment ids, nothing written;
--   for every ELIGIBLE payment: p_reads carries the token the F6 call that stamped it returned, that read started
--     within the fresh interval, and F3 says `known`; else `figures_stale` (nothing inserted, no audit row);
--   the total and the allocation run over the verified set ONLY [R11]: an ineligible payment (a `due` balance, a
--     non-Stripe tender) is never looked at, so no NULL figure can reach the allocation;
--   `nothing_refundable`; `over_refundable`; `figures_changed` when the total is not the one the person saw [DR6].
-- Refusals RAISE by name (0357's convention). p_reads = [ { payment_id, read_token } ].
create function public.catering_refund_reserve_fresh(p_actor_id uuid, p_quote_id uuid, p_client_token uuid,
  p_amount_cents bigint, p_seen_refundable_cents bigint, p_reason_code text, p_reason_note text, p_trigger text,
  p_reads jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_shop uuid;
  v_root uuid;
  v_role text;
  v_note text := nullif(btrim(coalesce(p_reason_note, '')), '');
  v_ids uuid[];
  v_existing jsonb;
  v_existing_total bigint;
  v_existing_bad boolean;
  v_now timestamptz;
  v_total bigint := 0;
  v_left bigint;
  v_take bigint;
  v_row record;
  v_fig record;
  v_tokens jsonb := '{}'::jsonb;
  v_token uuid;
  v_out jsonb := '[]'::jsonb;
  v_new uuid;
  s record;
begin
  if p_actor_id is null or p_quote_id is null or p_client_token is null then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  if p_reason_code is null or p_reason_code not in
       ('customer_cancelled', 'event_lost', 'quote_declined', 'duplicate_charge', 'service_issue', 'other') then
    raise exception 'invalid_reason' using errcode = 'P0001';
  end if;
  if p_trigger is null or p_trigger not in ('panel', 'declined', 'lost') then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'note_too_long' using errcode = 'P0001'; end if;
  if p_reason_code = 'other' and v_note is null then raise exception 'note_required' using errcode = 'P0001'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'invalid_amount' using errcode = 'P0001'; end if;
  if p_reads is not null and jsonb_typeof(p_reads) <> 'array' then raise exception 'invalid_request' using errcode = 'P0001'; end if;
  if p_reads is not null and (p_seen_refundable_cents is null or p_seen_refundable_cents < 0) then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;

  select q.location_id, coalesce(q.root_id, q.id) into v_shop, v_root from public.catering_quotes q where q.id = p_quote_id;
  if v_shop is null then raise exception 'quote_not_found' using errcode = 'P0001'; end if;
  if not public.catering_refund_actor_ok(p_actor_id, v_shop) then raise exception 'forbidden' using errcode = 'P0001'; end if;
  select u.role into v_role from public.users u where u.id = p_actor_id;

  -- (1) THE LOCKS: every payment row of the order (the whole quote family), in id order.
  select array_agg(p.id order by p.id) into v_ids
    from public.catering_payments p join public.catering_quotes q on q.id = p.quote_id
   where coalesce(q.root_id, q.id) = v_root;
  v_ids := coalesce(v_ids, array[]::uuid[]);
  perform 1 from public.catering_payments p where p.id = any(v_ids) order by p.id for no key update;
  v_now := clock_timestamp();

  -- (2) REPLAY: a token already used is the same press. Return what it made, or refuse a different ask under it.
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'payment_id', r.payment_id, 'amount_cents', r.amount_cents,
                                               'status', r.status, 'armed', r.create_armed_at is not null,
                                               'stripe_refund_id', r.stripe_refund_id, 'last_error_code', r.last_error_code)
                            order by r.requested_at, r.id), '[]'::jsonb),
         coalesce(sum(r.amount_cents), 0),
         coalesce(bool_or(not (r.payment_id = any(v_ids))), false)
    into v_existing, v_existing_total, v_existing_bad
    from public.catering_refund_requests r where r.client_token = p_client_token;
  if jsonb_array_length(v_existing) > 0 then
    if v_existing_bad or p_amount_cents <> v_existing_total then
      raise exception 'token_reused' using errcode = 'P0001';
    end if;
    return jsonb_build_object('replay', true, 'probe', false, 'location_id', v_shop, 'requests', v_existing);
  end if;

  -- (3) The B2 / B3 gate, in the database.
  if not public.catering_refund_parts_ready() then
    raise exception 'refunds_not_activated' using errcode = 'P0001';
  end if;

  -- (4) THE PROBE: which payments a read is needed for. Nothing is written.
  if p_reads is null then
    return jsonb_build_object('replay', false, 'probe', true, 'location_id', v_shop,
      'payments', coalesce((select jsonb_agg(jsonb_build_object('payment_id', p.id, 'payment_intent', p.provider_ref) order by p.id)
                              from public.catering_payments p cross join lateral public.catering_refund_payment_figures(p.id) f
                             where p.id = any(v_ids) and f.o_eligible), '[]'::jsonb));
  end if;

  -- (5) Every ELIGIBLE payment was read by THIS request, just now, completely, and is known.
  if exists (select 1 from jsonb_array_elements(p_reads) e
              where jsonb_typeof(e) <> 'object'
                 or coalesce(e ->> 'payment_id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                 or (e ->> 'read_token' is not null
                     and (e ->> 'read_token') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')) then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  for v_row in select p.id from public.catering_payments p where p.id = any(v_ids) order by p.id loop
    select * into v_fig from public.catering_refund_payment_figures(v_row.id);
    continue when not v_fig.o_eligible;
    select x.last_complete_read_token, x.last_complete_read_started_at into s
      from public.catering_refund_payment_state x where x.payment_id = v_row.id;
    select (e ->> 'read_token') into v_token from jsonb_array_elements(p_reads) e
     where lower(e ->> 'payment_id') = v_row.id::text and e ->> 'read_token' is not null limit 1;
    if not found or v_token is null or s.last_complete_read_token is null
       or v_token is distinct from s.last_complete_read_token
       or s.last_complete_read_started_at <= v_now - public.catering_refund_fresh_interval()
       or not v_fig.o_known or v_fig.o_refundable is null then
      raise exception 'figures_stale' using errcode = 'P0001', detail = v_row.id::text;
    end if;
    v_tokens := v_tokens || jsonb_build_object(v_row.id::text, v_token);
    v_total := v_total + v_fig.o_refundable;
  end loop;

  -- (6) The total, over the verified set only.
  if v_total <= 0 then raise exception 'nothing_refundable' using errcode = 'P0001'; end if;
  if p_amount_cents > v_total then
    raise exception 'over_refundable' using errcode = 'P0001', detail = v_total::text;
  end if;
  if p_seen_refundable_cents <> v_total then
    raise exception 'figures_changed' using errcode = 'P0001', detail = v_total::text;
  end if;

  -- (7) Allocate in 0357's order (the balance first, then a full payment, then the deposit; newest first within a
  --     kind) over the verified set; one pending row per payment, each remembering its read's token [R9].
  v_left := p_amount_cents;
  for v_row in
    select p.id, p.kind, p.paid_at, p.provider_ref from public.catering_payments p
     where p.id = any(v_ids) and v_tokens ? p.id::text
     order by case p.kind when 'balance' then 1 when 'full' then 2 else 3 end, p.paid_at desc nulls last, p.id
  loop
    exit when v_left <= 0;
    select * into v_fig from public.catering_refund_payment_figures(v_row.id);
    continue when v_fig.o_refundable is null or v_fig.o_refundable <= 0;
    v_take := least(v_left, v_fig.o_refundable);
    insert into public.catering_refund_requests (payment_id, quote_id, location_id, client_token, amount_cents,
                                                  reason_code, reason_note, trigger_kind, requested_by, reserve_read_token,
                                                  requested_at, updated_at)
      values (v_row.id, p_quote_id, v_shop, p_client_token, v_take, p_reason_code, v_note, p_trigger, p_actor_id,
              (v_tokens ->> v_row.id::text)::uuid, v_now, v_now)
      returning id into v_new;
    insert into public.audit_log(actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
      values (p_actor_id, v_role, 'catering.refund.request', 'catering_refund_requests', v_new,
              jsonb_build_object('quote_id', p_quote_id, 'payment_id', v_row.id, 'location_id', v_shop,
                                 'amount_cents', v_take, 'requested_total_cents', p_amount_cents, 'refundable_before_cents', v_total,
                                 'reason_code', p_reason_code, 'trigger', p_trigger, 'has_note', v_note is not null,
                                 'full', p_amount_cents = v_total), true);
    v_out := v_out || jsonb_build_object('id', v_new, 'payment_id', v_row.id, 'amount_cents', v_take, 'status', 'pending',
                                         'armed', false, 'payment_intent', v_row.provider_ref,
                                         'read_token', v_tokens ->> v_row.id::text);
    v_left := v_left - v_take;
  end loop;
  if v_left <> 0 then raise exception 'over_refundable' using errcode = 'P0001', detail = v_total::text; end if;
  return jsonb_build_object('replay', false, 'probe', false, 'location_id', v_shop, 'requests', v_out);
end $$;

-- ── F9 Arm: write-once, and every check again under the locks [R9] [S8] [T5] ────────────────────────────
-- The database clock is noted at entry; then the payment row FOR NO KEY UPDATE and the payment's state row FOR
-- UPDATE, BOTH before any check, so a wait for either (the operator statement's or the sweep's bulk stamp holds the
-- state row) is inside the measured budget. Then, all measured AFTER the waits:
--   not_armable      the row is not `pending` and unarmed: its ACTUAL state is returned, never "not sent" by assumption
--   deadline_passed  the locks took longer than p_max_wait_ms
--   figures_stale    unless ALL hold: the payment is still eligible; the state row's PaymentIntent is the row's;
--                    p_read_token is this row's own reserve token AND the payment's current complete-read token; that
--                    read started within the fresh interval of NOW; F3 says `known` (no ledger event, no stamp,
--                    observation live, the same transition count); the figures are not negative with this row counted
-- On any refusal the caller sends NOTHING and cancels the row (F11). Otherwise the arm is written ONCE, with the
-- account slot, mode and credential fingerprint of that read [T5], and the payment is stamped dirty.
create function public.catering_refund_arm(p_request_id uuid, p_read_token uuid, p_max_wait_ms integer) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_t0 timestamptz := clock_timestamp();
  v_wait integer := least(greatest(coalesce(p_max_wait_ms, 5000), 0), 60000);
  v_pid uuid;
  v_pay record;
  s public.catering_refund_payment_state%rowtype;
  r public.catering_refund_requests%rowtype;
  f record;
  v_now timestamptz;
  v_n bigint;
begin
  if p_request_id is null then raise exception 'invalid_request' using errcode = 'P0001'; end if;
  select q.payment_id into v_pid from public.catering_refund_requests q where q.id = p_request_id;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  select p.id, p.provider_ref into v_pay from public.catering_payments p where p.id = v_pid for no key update;
  select * into s from public.catering_refund_payment_state x where x.payment_id = v_pid for update;
  v_now := clock_timestamp();
  select * into r from public.catering_refund_requests q where q.id = p_request_id;
  if r.status <> 'pending' or r.create_armed_at is not null then
    return jsonb_build_object('result', 'not_armable', 'status', r.status, 'armed', r.create_armed_at is not null,
                              'stripe_refund_id', r.stripe_refund_id);
  end if;
  if v_now - v_t0 > v_wait * interval '1 millisecond' then
    return jsonb_build_object('result', 'deadline_passed', 'status', r.status, 'armed', false);
  end if;
  select * into f from public.catering_refund_payment_figures(v_pid);
  if not coalesce(
           f.o_eligible and s.payment_id is not null
       and s.payment_intent_id = v_pay.provider_ref
       and p_read_token is not null and p_read_token = r.reserve_read_token and p_read_token = s.last_complete_read_token
       and s.last_complete_read_started_at > v_now - public.catering_refund_fresh_interval()
       and f.o_known and s.credential_fp is not null
       and f.o_captured - f.o_counted - f.o_in_flight >= 0, false) then
    return jsonb_build_object('result', 'figures_stale', 'status', r.status, 'armed', false, 'state', f.o_state);
  end if;
  v_now := clock_timestamp();
  update public.catering_refund_requests q
     set create_armed_at = v_now, arm_payment_intent = v_pay.provider_ref,
         arm_account_slot = s.account_slot, arm_livemode = s.livemode, arm_credential_fp = s.credential_fp,
         attempts = 1, first_attempt_at = v_now, updated_at = v_now
   where q.id = p_request_id and q.status = 'pending' and q.create_armed_at is null;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    select * into r from public.catering_refund_requests q where q.id = p_request_id;
    return jsonb_build_object('result', 'not_armable', 'status', r.status, 'armed', r.create_armed_at is not null,
                              'stripe_refund_id', r.stripe_refund_id);
  end if;
  -- After the checks, so they stay meaningful: our own arm is a change on this payment.
  update public.catering_refund_payment_state x set dirty_since = v_now where x.payment_id = v_pid;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'refund_arm_defect' using errcode = 'P0001'; end if;
  return jsonb_build_object('result', 'armed', 'request_id', p_request_id, 'payment_id', v_pid, 'quote_id', r.quote_id,
    'location_id', r.location_id, 'amount_cents', r.amount_cents, 'reason_code', r.reason_code,
    'payment_intent', v_pay.provider_ref, 'charge', s.charge_id, 'currency', s.currency, 'livemode', s.livemode,
    'account_slot', s.account_slot, 'credential_fp', s.credential_fp, 'armed_at', v_now);
end $$;

-- ── F10 Record the ONE POST's answer [R8] [S9] ──────────────────────────────────────────────────────────
-- The payment is stamped dirty first, unconditionally. Then by the row AS IT IS; the answer always names the row's
-- resulting state. The mirror is NOT written here: a create response is not a retrieve.
--   created                           pending, armed, unbound, and the response is this request's (helper above)
--   answer_mismatch                   a 2xx that is not this request's: recorded as unconfirmed; also the SAME refund
--                                     id on an already-bound row whose response fails that verification [S9]
--   unconfirmed                       no 2xx carrying the matching refund: the row stays reserved, is never POSTed
--                                     again by any path, and blocks the payment
--   created + already_bound           a read bound the same refund first, and the response verifies
--   already_bound_unconfirmed_answer  a read bound it while the transport answer was lost
--   answer_conflict                   bound to ANOTHER refund id, or another request holds the id answered
--   answered_after_release            closed with no refund, and a refund came back
--   closed                            closed (failed, or 0357's `succeeded`) and nothing came back / legacy
--   not_armed                         pending and never armed: the caller finishes only what it armed
create function public.catering_refund_finish(p_request_id uuid, p_outcome text, p_refund jsonb, p_error_code text,
  p_error_message text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_pid uuid;
  r public.catering_refund_requests%rowtype;
  v_now timestamptz;
  v_n bigint;
  v_id text;
  v_ok boolean;
  v_result text;
  v_already boolean := false;
begin
  if p_request_id is null or p_outcome is null or p_outcome not in ('created', 'unconfirmed') then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  select q.payment_id into v_pid from public.catering_refund_requests q where q.id = p_request_id;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  perform 1 from public.catering_payments p where p.id = v_pid for no key update;
  perform 1 from public.catering_refund_payment_state x where x.payment_id = v_pid for update;
  v_now := clock_timestamp();
  -- The unconditional dirty stamp (census allowlist: an upsert under the payment lock).
  insert into public.catering_refund_payment_state as x (payment_id, dirty_since) values (v_pid, v_now)
  on conflict (payment_id) do update set dirty_since = excluded.dirty_since;
  select * into r from public.catering_refund_requests q where q.id = p_request_id;
  v_id := case when p_outcome = 'created' and p_refund is not null and jsonb_typeof(p_refund) = 'object' then p_refund ->> 'id' end;

  if r.status = 'pending' and r.create_armed_at is null then
    v_result := 'not_armed';
  elsif r.status = 'pending' then
    if p_outcome = 'created' then
      v_ok := public.catering_refund_answer_matches(p_request_id, p_refund);
      if v_ok and exists (select 1 from public.catering_refund_requests q where q.stripe_refund_id = v_id and q.id <> p_request_id) then
        v_result := 'answer_conflict'; -- another request already holds the refund this answer names
        update public.catering_refund_requests q
           set last_error_code = 'answer_conflict', last_error_message = null, updated_at = v_now
         where q.id = p_request_id and q.status = 'pending' and q.create_armed_at is not null and q.stripe_refund_id is null;
        get diagnostics v_n = row_count;
        if v_n <> 1 then v_result := 'state_changed'; end if;
      elsif v_ok then
        update public.catering_refund_requests q
           set status = 'submitted', stripe_refund_id = v_id,
               stripe_status = case when jsonb_typeof(p_refund -> 'status') = 'string' then left(p_refund ->> 'status', 40) end,
               settled_at = v_now, updated_at = v_now
         where q.id = p_request_id and q.status = 'pending' and q.create_armed_at is not null and q.stripe_refund_id is null;
        get diagnostics v_n = row_count;
        v_result := case when v_n = 1 then 'created' else 'state_changed' end;
      else
        update public.catering_refund_requests q
           set last_error_code = 'answer_mismatch', last_error_message = left(nullif(btrim(coalesce(p_error_message, '')), ''), 500), updated_at = v_now
         where q.id = p_request_id and q.status = 'pending' and q.create_armed_at is not null and q.stripe_refund_id is null;
        get diagnostics v_n = row_count;
        v_result := case when v_n = 1 then 'answer_mismatch' else 'state_changed' end;
      end if;
    else
      update public.catering_refund_requests q
         set last_error_code = left(coalesce(nullif(btrim(coalesce(p_error_code, '')), ''), 'unconfirmed'), 80),
             last_error_message = left(nullif(btrim(coalesce(p_error_message, '')), ''), 500), updated_at = v_now
       where q.id = p_request_id and q.status = 'pending' and q.create_armed_at is not null and q.stripe_refund_id is null;
      get diagnostics v_n = row_count;
      v_result := case when v_n = 1 then 'unconfirmed' else 'state_changed' end;
    end if;
  elsif r.status = 'submitted' then
    if p_outcome = 'unconfirmed' then
      v_result := 'already_bound_unconfirmed_answer';
    elsif v_id is not null and v_id = r.stripe_refund_id then
      v_already := true;
      v_result := case when public.catering_refund_answer_matches(p_request_id, p_refund) then 'created' else 'answer_mismatch' end;
    else
      v_result := 'answer_conflict';
    end if;
  elsif r.status = 'failed' then
    v_result := case when p_outcome = 'created' then 'answered_after_release' else 'closed' end;
  else
    v_result := 'closed'; -- 0357's `succeeded`: v2 never writes it
  end if;

  select * into r from public.catering_refund_requests q where q.id = p_request_id;
  return jsonb_build_object('result', v_result, 'already_bound', v_already, 'request_id', p_request_id, 'payment_id', v_pid,
    'status', r.status, 'armed', r.create_armed_at is not null, 'stripe_refund_id', r.stripe_refund_id,
    'answered_refund_id', v_id);
end $$;

-- ── F11 Cancel a reserved row that was never armed ──────────────────────────────────────────────────────
-- It races F9 on the same payment lock and the same predicate: exactly one of "armed" and "cancelled" happens.
-- Zero rows = the row's ACTUAL state is returned.
create function public.catering_refund_cancel_unarmed(p_request_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_pid uuid;
  r public.catering_refund_requests%rowtype;
  v_now timestamptz;
  v_n bigint;
begin
  if p_request_id is null then raise exception 'invalid_request' using errcode = 'P0001'; end if;
  select q.payment_id into v_pid from public.catering_refund_requests q where q.id = p_request_id;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  perform 1 from public.catering_payments p where p.id = v_pid for no key update;
  v_now := clock_timestamp();
  update public.catering_refund_requests q
     set status = 'failed', last_error_code = 'never_sent',
         last_error_message = left(nullif(btrim(coalesce(p_reason, '')), ''), 500), settled_at = v_now, updated_at = v_now
   where q.id = p_request_id and q.status = 'pending' and q.create_armed_at is null;
  get diagnostics v_n = row_count;
  select * into r from public.catering_refund_requests q where q.id = p_request_id;
  return jsonb_build_object('result', case when v_n = 1 then 'cancelled' else 'not_cancelled' end,
    'request_id', p_request_id, 'payment_id', v_pid, 'status', r.status, 'armed', r.create_armed_at is not null,
    'stripe_refund_id', r.stripe_refund_id);
end $$;

-- ── F12 Release: the staff exit when NOTHING was sent [R6] [T5] ─────────────────────────────────────────
-- The actor row first (FOR SHARE), then the payment lock, then the state row. Refusals RAISE by name:
--   forbidden              not an active owner / cgs, nor an active moo with an active membership at the request's shop
--   not_releasable         not pending, or not armed (an unarmed row is F11's)
--   not_releasable_yet     before create_armed_at + 24 hours (detail = that instant)
--   use_attach             the finding says the request SUCCEEDED: a refund exists; attach it
--   finding_not_releasable anything but `no_request` (Stripe's request log shows no refund request with this key) or
--                          `request_failed` (it shows the request answered with an error and no refund); `unclear`
--                          is refused: a timeout or an unreadable log cannot establish that nothing was sent
--   figures_stale          p_read_token is not the stored token, or that read started before create_armed_at + 24 h
--                          or longer ago than the fresh interval, or the payment is not `known`
--   credential_changed     the account slot, mode or credential fingerprint that read resolved is not the one the arm
--                          recorded (or the arm recorded none: a row 0357's sender attempted) [T5]: it goes to CC
--   wrong_account          the slot / mode the PERSON says they read is not the one that read resolved
--   refund_candidates      a mirrored refund of this payment names this request and matches it (whatever its time):
--                          a person attaches it instead. A claim that does NOT match never refuses: it is counted.
-- The audit row (destructive) is written only after the row count is 1. The note text is never stored.
create function public.catering_refund_release(p_actor_id uuid, p_request_id uuid, p_read_token uuid, p_finding text,
  p_account_slot text, p_livemode boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_pid uuid;
  v_shop uuid;
  v_role text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  r public.catering_refund_requests%rowtype;
  s public.catering_refund_payment_state%rowtype;
  f record;
  v_now timestamptz;
  v_n bigint;
  v_unmatched bigint;
begin
  if p_actor_id is null or p_request_id is null then raise exception 'invalid_request' using errcode = 'P0001'; end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'note_too_long' using errcode = 'P0001'; end if;
  select q.payment_id, q.location_id into v_pid, v_shop from public.catering_refund_requests q where q.id = p_request_id;
  if not found then raise exception 'request_not_found' using errcode = 'P0001'; end if;
  v_role := public.catering_refund_release_role(p_actor_id, v_shop);
  if v_role is null then raise exception 'forbidden' using errcode = 'P0001'; end if;
  perform 1 from public.catering_payments p where p.id = v_pid for no key update;
  select * into s from public.catering_refund_payment_state x where x.payment_id = v_pid for update;
  v_now := clock_timestamp();
  select * into r from public.catering_refund_requests q where q.id = p_request_id;
  if r.status <> 'pending' or r.create_armed_at is null or r.stripe_refund_id is not null then
    raise exception 'not_releasable' using errcode = 'P0001', detail = r.status;
  end if;
  if v_now < r.create_armed_at + interval '24 hours' then
    raise exception 'not_releasable_yet' using errcode = 'P0001', detail = to_char((r.create_armed_at + interval '24 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;
  if p_finding = 'request_succeeded' then raise exception 'use_attach' using errcode = 'P0001'; end if;
  if p_finding is null or p_finding not in ('no_request', 'request_failed') then
    raise exception 'finding_not_releasable' using errcode = 'P0001';
  end if;
  select * into f from public.catering_refund_payment_figures(v_pid);
  if not coalesce(
           s.payment_id is not null and p_read_token is not null and p_read_token = s.last_complete_read_token
       and s.last_complete_read_started_at >= r.create_armed_at + interval '24 hours'
       and s.last_complete_read_started_at > v_now - public.catering_refund_fresh_interval()
       and f.o_known, false) then
    raise exception 'figures_stale' using errcode = 'P0001';
  end if;
  if r.arm_credential_fp is null or s.credential_fp is distinct from r.arm_credential_fp
     or s.account_slot is distinct from r.arm_account_slot or s.livemode is distinct from r.arm_livemode then
    raise exception 'credential_changed' using errcode = 'P0001';
  end if;
  if p_account_slot is distinct from s.account_slot or p_livemode is distinct from s.livemode then
    raise exception 'wrong_account' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.catering_refund_claims(v_pid) c
               join public.catering_refund_observed m on m.refund_id = c.refund_id
              where c.attachable_to = p_request_id and m.meta_request_id = p_request_id) then
    raise exception 'refund_candidates' using errcode = 'P0001';
  end if;
  select count(*) into v_unmatched from public.catering_refund_observed m
   where m.payment_id = v_pid and m.meta_request_id = p_request_id and m.request_id is null;

  update public.catering_refund_requests q
     set status = 'failed', last_error_code = 'released_no_refund', last_error_message = null,
         resolved_by = p_actor_id, resolved_at = v_now, settled_at = v_now, updated_at = v_now
   where q.id = p_request_id and q.status = 'pending' and q.create_armed_at is not null and q.stripe_refund_id is null;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'not_releasable' using errcode = 'P0001'; end if;
  insert into public.audit_log(actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
    values (p_actor_id, v_role, 'catering.refund.release', 'catering_refund_requests', p_request_id,
            jsonb_build_object('quote_id', r.quote_id, 'payment_id', v_pid, 'location_id', r.location_id,
                               'amount_cents', r.amount_cents, 'armed_at', r.create_armed_at, 'finding', p_finding,
                               'account_slot', s.account_slot, 'livemode', s.livemode, 'credential_fp', s.credential_fp,
                               'unmatched_claims', v_unmatched, 'has_note', v_note is not null), true);
  return jsonb_build_object('result', 'released', 'request_id', p_request_id, 'payment_id', v_pid, 'status', 'failed',
                            'resolved_at', v_now);
end $$;

-- ── F16 Attach: the staff exit when a refund DID land and no read could bind it by itself [Q4] [T1] [T5] ─
-- It sends nothing and creates nothing at Stripe. The same locks as F12. Refusals RAISE by name:
--   forbidden             F12's roles
--   not_attachable        the request is not pending, armed and unbound
--   figures_stale         p_read_token is not the stored token, or that read started longer ago than the fresh
--                         interval, or the payment is not `known`
--   credential_changed    as F12 [T5]
--   refund_not_attachable unless the mirrored refund is THIS payment's, was retrieved by exactly that read, is bound
--                         to no request and held by none, names no OTHER request, has the request's amount and the
--                         owner's currency, and the armed PaymentIntent (or none and the owner's charge). There is NO
--                         time condition [T1]: a person with an exact read decides. No 24-hour wait: this exit rests
--                         on a retrieved object, not on an absence.
create function public.catering_refund_attach(p_actor_id uuid, p_request_id uuid, p_refund_id text, p_read_token uuid,
  p_note text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_pid uuid;
  v_shop uuid;
  v_role text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  r public.catering_refund_requests%rowtype;
  s public.catering_refund_payment_state%rowtype;
  m public.catering_refund_observed%rowtype;
  f record;
  v_now timestamptz;
  v_n bigint;
begin
  if p_actor_id is null or p_request_id is null or p_refund_id is null then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'note_too_long' using errcode = 'P0001'; end if;
  select q.payment_id, q.location_id into v_pid, v_shop from public.catering_refund_requests q where q.id = p_request_id;
  if not found then raise exception 'request_not_found' using errcode = 'P0001'; end if;
  v_role := public.catering_refund_release_role(p_actor_id, v_shop);
  if v_role is null then raise exception 'forbidden' using errcode = 'P0001'; end if;
  perform 1 from public.catering_payments p where p.id = v_pid for no key update;
  select * into s from public.catering_refund_payment_state x where x.payment_id = v_pid for update;
  v_now := clock_timestamp();
  select * into r from public.catering_refund_requests q where q.id = p_request_id;
  if r.status <> 'pending' or r.create_armed_at is null or r.stripe_refund_id is not null then
    raise exception 'not_attachable' using errcode = 'P0001', detail = r.status;
  end if;
  select * into f from public.catering_refund_payment_figures(v_pid);
  if not coalesce(
           s.payment_id is not null and p_read_token is not null and p_read_token = s.last_complete_read_token
       and s.last_complete_read_started_at > v_now - public.catering_refund_fresh_interval()
       and f.o_known, false) then
    raise exception 'figures_stale' using errcode = 'P0001';
  end if;
  if r.arm_credential_fp is null or s.credential_fp is distinct from r.arm_credential_fp
     or s.account_slot is distinct from r.arm_account_slot or s.livemode is distinct from r.arm_livemode then
    raise exception 'credential_changed' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.catering_refund_claims(v_pid) c
                  where c.refund_id = p_refund_id and c.attachable_to = p_request_id) then
    raise exception 'refund_not_attachable' using errcode = 'P0001';
  end if;
  select * into m from public.catering_refund_observed x where x.refund_id = p_refund_id;

  update public.catering_refund_requests q
     set status = 'submitted', stripe_refund_id = p_refund_id, stripe_status = m.status,
         resolved_by = p_actor_id, resolved_at = v_now, settled_at = v_now, updated_at = v_now
   where q.id = p_request_id and q.status = 'pending' and q.create_armed_at is not null and q.stripe_refund_id is null;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'not_attachable' using errcode = 'P0001'; end if;
  update public.catering_refund_observed x set request_id = p_request_id
   where x.refund_id = p_refund_id and x.payment_id = v_pid and x.request_id is null;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'refund_bind_defect' using errcode = 'P0001'; end if;
  insert into public.audit_log(actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
    values (p_actor_id, v_role, 'catering.refund.attach', 'catering_refund_requests', p_request_id,
            jsonb_build_object('quote_id', r.quote_id, 'payment_id', v_pid, 'location_id', r.location_id,
                               'refund_id', p_refund_id, 'amount_cents', r.amount_cents, 'refund_status', m.status,
                               'refund_created_at', m.stripe_created_at, 'armed_at', r.create_armed_at,
                               'metadata_named_request', m.meta_request_id is not null,
                               'account_slot', s.account_slot, 'livemode', s.livemode, 'credential_fp', s.credential_fp,
                               'has_note', v_note is not null), true);
  return jsonb_build_object('result', 'attached', 'request_id', p_request_id, 'payment_id', v_pid, 'refund_id', p_refund_id,
                            'status', 'submitted', 'resolved_at', v_now);
end $$;

-- ── F13 The sweep's ONE claim, and its work list, in ONE transaction [R1] [R2] [Q1] [P3-7] [T4] [T6] ────
-- The lease lives on B1's own row [DR13]; the generic claim_cron_route does not know this job and cannot move it.
--   observe_not_recorded  the env switch is on but the operator statement was not run, or OFF was recorded: no GET
--   busy                  another run holds the 330-second lease
-- `resumed` = this is the first claim, or the last claim is 60 minutes old or more (at exactly 60:00 it is [S12]), or
-- a transition was recorded since the last claim (detected even when both flips fell between two ticks). A resume
-- stamps every state row dirty and records the instant, which is a dirty instant for every payment [T4].
-- If selecting the work fails, the claim is not recorded either.
create function public.catering_refund_sweep_begin(p_limit integer) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  o public.catering_refund_observation%rowtype;
  v_now timestamptz;
  v_resumed boolean;
  v_rows bigint := 0;
  v_claim uuid := gen_random_uuid();
  v_n bigint;
  v_due jsonb;
begin
  select * into o from public.catering_refund_observation x where x.id for update;
  if not found then raise exception 'observation_row_missing' using errcode = 'P0001'; end if;
  v_now := clock_timestamp();
  if not o.observe_on then
    return jsonb_build_object('claimed', false, 'reason', 'observe_not_recorded');
  end if;
  if o.lease_until is not null and o.lease_until > v_now then
    return jsonb_build_object('claimed', false, 'reason', 'busy');
  end if;
  v_resumed := o.last_claim_at is null
            or o.last_claim_at <= v_now - public.catering_refund_liveness_interval()
            or o.last_claim_transitions is distinct from o.transitions;
  if v_resumed then
    update public.catering_refund_payment_state x set dirty_since = v_now;
    get diagnostics v_rows = row_count;
  end if;
  update public.catering_refund_observation x
     set lease_until = v_now + interval '330 seconds', last_claim_at = v_now, last_claim_transitions = x.transitions,
         last_claim_id = v_claim, resumed_at = case when v_resumed then v_now else x.resumed_at end
   where x.id;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'observation_row_missing' using errcode = 'P0001'; end if;
  v_due := public.catering_refund_sweep_due(p_limit);
  return jsonb_build_object('claimed', true, 'claim_id', v_claim, 'claimed_at', v_now, 'resumed', v_resumed,
                            'resumed_rows', v_rows, 'transitions', o.transitions, 'due', v_due);
end $$;

-- ── F18 The pass-END stamp: "last finished pass" [T6] [S6] ──────────────────────────────────────────────
-- The worker calls it once, after its last read, on every run that reached the end of its loop. Only the run that
-- holds the newest claim can stamp (zero rows = `superseded`). Liveness is still measured from the CLAIM [Q1]; this
-- stamp is what the inventory shows as success, beside the claim.
create function public.catering_refund_sweep_end(p_claim_id uuid, p_reads integer, p_complete integer) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_now timestamptz := clock_timestamp();
  v_n bigint;
begin
  if p_claim_id is null then raise exception 'invalid_request' using errcode = 'P0001'; end if;
  update public.catering_refund_observation x
     set last_pass_ended_at = v_now, last_pass_reads = greatest(coalesce(p_reads, 0), 0),
         last_pass_complete = greatest(coalesce(p_complete, 0), 0)
   where x.id and x.last_claim_id = p_claim_id;
  get diagnostics v_n = row_count;
  if v_n <> 1 then return jsonb_build_object('result', 'superseded'); end if;
  return jsonb_build_object('result', 'ended', 'ended_at', v_now);
end $$;

-- ── F15 The inventory: the sign-off page's read model ───────────────────────────────────────────────────
-- Counts, and lists of at most 200 (ids, cents, states, reasons and instants only; no customer or staff data).
-- `unsettled_checkouts` = due / void rows that still carry a checkout session: money B1 cannot see until main records
-- it as paid; reported as NOT covered, never as checked.
create function public.catering_refund_inventory() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  o public.catering_refund_observation%rowtype;
  v_now timestamptz := clock_timestamp();
  v_max_age interval := public.catering_refund_read_max_age();
  v_live boolean;
  v_out jsonb;
begin
  select * into o from public.catering_refund_observation x where x.id;
  v_live := coalesce(o.observe_on and o.last_claim_at > v_now - public.catering_refund_liveness_interval(), false);
  with scope as (
    select p.id, p.status, p.paid_at, p.created_at, f.o_state as st, f.o_disagrees, f.o_captured, f.o_counted, f.o_stripe_whole,
           s.last_attempt_at, s.last_attempt_result, s.last_attempt_conflict_with, s.open_read_id, s.open_read_started_at,
           s.last_complete_read_started_at as read_at
      from public.catering_payments p
      cross join lateral public.catering_refund_payment_figures(p.id) f
      left join public.catering_refund_payment_state s on s.payment_id = p.id
     where f.o_eligible),
  cl as (
    select sc.id as payment_id, c.refund_id, c.kind, c.attachable_to, m.amount_cents, m.status, m.stripe_created_at
      from scope sc cross join lateral public.catering_refund_claims(sc.id) c
      join public.catering_refund_observed m on m.refund_id = c.refund_id),
  nc as (select sc.* from scope sc where sc.last_attempt_result is not null and sc.last_attempt_result <> 'complete'),
  pend as (
    select r.id, r.payment_id, r.amount_cents, r.create_armed_at, r.requested_at, r.arm_credential_fp, r.last_error_code
      from public.catering_refund_requests r where r.status = 'pending'),
  uc as (
    select p.id, p.status from public.catering_payments p
     where p.status in ('due', 'void') and p.provider_session_id is not null)
  select jsonb_build_object(
    'generated_at', v_now,
    'observation', jsonb_build_object(
      'observe_on', o.observe_on, 'transitions', o.transitions, 'transitioned_at', o.transitioned_at, 'resumed_at', o.resumed_at,
      'live', v_live, 'lease_until', o.lease_until,
      'last_claim_at', o.last_claim_at, 'last_claim_transitions', o.last_claim_transitions,
      'last_pass_ended_at', o.last_pass_ended_at, 'last_pass_reads', o.last_pass_reads, 'last_pass_complete', o.last_pass_complete,
      'last_pass_is_of_last_claim', coalesce(o.last_pass_ended_at >= o.last_claim_at, false)),
    'counts', jsonb_build_object(
      'in_scope', (select count(*) from scope),
      'paused', (select count(*) from scope where st = 'paused'),
      'never_read', (select count(*) from scope where st = 'never_read'),
      'dirty', (select count(*) from scope where st = 'dirty'),
      'known', (select count(*) from scope where st = 'known'),
      'not_complete', (select count(*) from nc),
      'open_reads', (select count(*) from scope where open_read_id is not null),
      'abandoned_reads', (select count(*) from scope where open_read_id is not null and open_read_started_at <= v_now - v_max_age),
      'disagreements', (select count(*) from scope where o_disagrees),
      'unresolved_requests', (select count(*) from pend),
      'unconfirmed', (select count(*) from pend where create_armed_at is not null),
      'legacy_attempted', (select count(*) from pend where create_armed_at is not null and arm_credential_fp is null),
      'attachable', (select count(*) from cl where attachable_to is not null),
      'released_with_refund', (select count(*) from cl where kind = 'released'),
      'unsettled_checkouts', (select count(*) from uc),
      'claims', coalesce((select jsonb_object_agg(x.kind, x.n) from (
                            select cl.kind, count(*) as n from cl where cl.kind not in ('bound', 'none') group by cl.kind) x), '{}'::jsonb),
      'unbound_claims', (select count(*) from cl where kind not in ('bound', 'none'))),
    'not_complete_by_reason', coalesce((select jsonb_object_agg(x.reason, x.n) from (
                                          select nc.last_attempt_result as reason, count(*) as n from nc group by nc.last_attempt_result) x), '{}'::jsonb),
    'lists', jsonb_build_object(
      'not_complete', coalesce((select jsonb_agg(jsonb_build_object('payment_id', x.id, 'reason', x.last_attempt_result,
                                  'conflict_with', x.last_attempt_conflict_with, 'attempted_at', x.last_attempt_at) order by x.last_attempt_at, x.id)
                                  from (select * from nc order by nc.last_attempt_at, nc.id limit 200) x), '[]'::jsonb),
      'never_read', coalesce((select jsonb_agg(x.id order by x.id) from (select id from scope where st = 'never_read' order by id limit 200) x), '[]'::jsonb),
      'dirty', coalesce((select jsonb_agg(x.id order by x.id) from (select id from scope where st = 'dirty' order by id limit 200) x), '[]'::jsonb),
      'open_reads', coalesce((select jsonb_agg(jsonb_build_object('payment_id', x.id, 'started_at', x.open_read_started_at,
                                  'abandoned', x.open_read_started_at <= v_now - v_max_age) order by x.open_read_started_at, x.id)
                                from (select * from scope where open_read_id is not null order by open_read_started_at, id limit 200) x), '[]'::jsonb),
      'disagreements', coalesce((select jsonb_agg(jsonb_build_object('payment_id', x.id, 'status', x.status, 'captured_cents', x.o_captured,
                                  'counted_cents', x.o_counted, 'stripe_whole', x.o_stripe_whole) order by x.id)
                                   from (select * from scope where o_disagrees order by id limit 200) x), '[]'::jsonb),
      'unresolved_requests', coalesce((select jsonb_agg(jsonb_build_object('request_id', x.id, 'payment_id', x.payment_id,
                                  'amount_cents', x.amount_cents, 'armed', x.create_armed_at is not null, 'armed_at', x.create_armed_at,
                                  'releasable_at', x.create_armed_at + interval '24 hours', 'requested_at', x.requested_at,
                                  'legacy', x.create_armed_at is not null and x.arm_credential_fp is null,
                                  'last_error_code', x.last_error_code) order by x.requested_at, x.id)
                                         from (select * from pend order by requested_at, id limit 200) x), '[]'::jsonb),
      'claims', coalesce((select jsonb_agg(jsonb_build_object('refund_id', x.refund_id, 'payment_id', x.payment_id, 'kind', x.kind,
                                  'amount_cents', x.amount_cents, 'status', x.status, 'attachable_to', x.attachable_to) order by x.refund_id)
                            from (select * from cl where kind not in ('bound', 'none') or attachable_to is not null order by refund_id limit 200) x), '[]'::jsonb),
      'unsettled_checkouts', coalesce((select jsonb_agg(jsonb_build_object('payment_id', x.id, 'status', x.status) order by x.id)
                                         from (select * from uc order by id limit 200) x), '[]'::jsonb)),
    'oldest_unchecked_at', (select min(coalesce(sc.read_at, sc.paid_at, sc.created_at)) from scope sc where sc.st <> 'known'),
    'oldest_read_started_at', (select min(sc.read_at) from scope sc where sc.st = 'known'))
  into v_out;
  return v_out;
end $$;

-- ── Privileges: stated, never inherited ─────────────────────────────────────────────────────────────────
do $$
declare
  f text;
begin
  -- PRIVATE: the owner only.
  foreach f in array array[
    'catering_refund_settle_interval()', 'catering_refund_liveness_interval()', 'catering_refund_fresh_interval()',
    'catering_refund_read_max_age()', 'catering_refund_reread_interval()',
    'catering_refund_dirty_at(uuid)', 'catering_refund_payment_figures(uuid)', 'catering_refund_parts_ready()',
    'catering_refund_claims(uuid)', 'catering_refund_answer_matches(uuid, jsonb)', 'catering_refund_release_role(uuid, uuid)',
    'catering_refund_sweep_due(integer)', 'catering_refund_observe_set(boolean)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', f);
  end loop;
  -- WORKER: service_role only.
  foreach f in array array[
    'catering_refund_read_begin(uuid)', 'catering_refund_record_read(uuid, uuid, text, jsonb, jsonb, jsonb)',
    'catering_refund_summary(uuid[])',
    'catering_refund_reserve_fresh(uuid, uuid, uuid, bigint, bigint, text, text, text, jsonb)',
    'catering_refund_arm(uuid, uuid, integer)', 'catering_refund_finish(uuid, text, jsonb, text, text)',
    'catering_refund_cancel_unarmed(uuid, text)',
    'catering_refund_release(uuid, uuid, uuid, text, text, boolean, text)',
    'catering_refund_attach(uuid, uuid, text, uuid, text)',
    'catering_refund_sweep_begin(integer)', 'catering_refund_sweep_end(uuid, integer, integer)',
    'catering_refund_inventory()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
revoke all on function public.catering_refund_requests_guard() from public, anon, authenticated;

-- ── Assertions (raise = nothing in this file is kept) ───────────────────────────────────────────────────
do $$
declare
  t text;
  f text;
  r text;
  c text;
  v_acl text;
  v_n bigint;
  v_private constant text[] := array[
    'catering_refund_settle_interval()', 'catering_refund_liveness_interval()', 'catering_refund_fresh_interval()',
    'catering_refund_read_max_age()', 'catering_refund_reread_interval()',
    'catering_refund_dirty_at(uuid)', 'catering_refund_payment_figures(uuid)', 'catering_refund_parts_ready()',
    'catering_refund_claims(uuid)', 'catering_refund_answer_matches(uuid, jsonb)', 'catering_refund_release_role(uuid, uuid)',
    'catering_refund_sweep_due(integer)', 'catering_refund_observe_set(boolean)',
    -- 0357's three, withdrawn above: nobody but the owner any more.
    'catering_refund_reserve(uuid, uuid, uuid, bigint, text, text, text)', 'catering_refund_claim(uuid)',
    'catering_refund_record_snapshot(uuid, timestamp with time zone, bigint, jsonb)',
    'catering_refund_requests_guard()'];
  v_worker constant text[] := array[
    'catering_refund_read_begin(uuid)', 'catering_refund_record_read(uuid, uuid, text, jsonb, jsonb, jsonb)',
    'catering_refund_summary(uuid[])',
    'catering_refund_reserve_fresh(uuid, uuid, uuid, bigint, bigint, text, text, text, jsonb)',
    'catering_refund_arm(uuid, uuid, integer)', 'catering_refund_finish(uuid, text, jsonb, text, text)',
    'catering_refund_cancel_unarmed(uuid, text)',
    'catering_refund_release(uuid, uuid, uuid, text, text, boolean, text)',
    'catering_refund_attach(uuid, uuid, text, uuid, text)',
    'catering_refund_sweep_begin(integer)', 'catering_refund_sweep_end(uuid, integer, integer)',
    'catering_refund_inventory()',
    -- 0357 / 0358, unchanged: still service_role's.
    'catering_refund_actor_ok(uuid, uuid)', 'catering_refund_figures(uuid)'];
  v_sig text;
  v_oid oid;
  v_now_digest text;
begin
  -- (1) The three new tables: RLS on, exactly the four denials, and NO privilege for anyone but the owner.
  foreach t in array array['catering_refund_observed', 'catering_refund_payment_state', 'catering_refund_observation'] loop
    if not (select cl.relrowsecurity from pg_class cl where cl.oid = ('public.' || t)::regclass) then
      raise exception '0359: RLS is off on %', t;
    end if;
    if (select coalesce(string_agg(po.polname::text, ',' order by po.polname::text), '') from pg_policy po
         where po.polrelid = ('public.' || t)::regclass)
       <> t || '_no_user_delete,' || t || '_no_user_insert,' || t || '_no_user_select,' || t || '_no_user_update' then
      raise exception '0359: the policies of % are not the four denials', t;
    end if;
    if exists (select 1 from pg_class cl, lateral aclexplode(coalesce(cl.relacl, acldefault('r', cl.relowner))) a
                where cl.oid = ('public.' || t)::regclass and a.grantee <> cl.relowner) then
      raise exception '0359: someone other than the owner holds a privilege on %', t;
    end if;
    if exists (select 1 from pg_attribute att where att.attrelid = ('public.' || t)::regclass and att.attnum > 0
                and not att.attisdropped and att.attacl is not null) then
      raise exception '0359: % carries a column privilege', t;
    end if;
  end loop;
  if (select count(*) from public.catering_refund_observation) <> 1 then
    raise exception '0359: catering_refund_observation does not hold exactly one row';
  end if;

  -- (2) THE WHOLE refund family, by signature: every function is one this file expects, in the class it expects.
  for v_oid, v_sig in
    select p.oid, p.proname || '(' || oidvectortypes(p.proargtypes) || ')'
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'catering\_refund\_%'
  loop
    if v_sig = any(v_private) then
      if exists (select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where p.oid = v_oid and a.grantee <> p.proowner) then
        raise exception '0359: % is private and someone other than the owner may execute it', v_sig;
      end if;
    elsif v_sig = any(v_worker) then
      if exists (select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where p.oid = v_oid and a.grantee <> p.proowner
                    and (a.grantee <> 'service_role'::regrole::oid or a.is_grantable)) then
        raise exception '0359: % has an unexpected grantee or a grant option in its ACL', v_sig;
      end if;
      if not has_function_privilege('service_role', v_oid, 'EXECUTE') then
        raise exception '0359: service_role cannot execute %', v_sig;
      end if;
    else
      raise exception '0359: an unexpected refund function exists: %', v_sig;
    end if;
    foreach r in array array['public', 'anon', 'authenticated'] loop
      if has_function_privilege(r, v_oid, 'EXECUTE') then raise exception '0359: % may execute % (RPC escape)', r, v_sig; end if;
    end loop;
    -- Modes: every function pins its search_path; all but the trigger guard and the five constants are SECURITY DEFINER.
    if not (select p.proconfig is not null and array_length(p.proconfig, 1) = 1
                   and replace(p.proconfig[1], ' ', '') = 'search_path=pg_catalog,public' from pg_proc p where p.oid = v_oid) then
      raise exception '0359: % does not pin search_path to pg_catalog, public', v_sig;
    end if;
    if (select p.prosecdef from pg_proc p where p.oid = v_oid)
       is distinct from (v_sig <> 'catering_refund_requests_guard()' and v_sig not like 'catering\_refund\_%\_interval()'
                         and v_sig <> 'catering_refund_read_max_age()') then
      raise exception '0359: % has the wrong security mode', v_sig;
    end if;
  end loop;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'catering\_refund\_%')
     <> array_length(v_private, 1) + array_length(v_worker, 1) then
    raise exception '0359: the refund family is not the % functions this file expects', array_length(v_private, 1) + array_length(v_worker, 1);
  end if;

  -- (3) The stale-sender fence: 0357's table grants are gone, and nothing else moved on 0357's tables.
  foreach t in array array['public.catering_refund_requests', 'public.catering_refund_stripe_snapshots'] loop
    select coalesce(string_agg(x.e, ',' order by x.e), '') into v_acl from (
      select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end || '=' || a.privilege_type
             || case when a.is_grantable then '*' else '' end as e
        from pg_class cl, lateral aclexplode(coalesce(cl.relacl, acldefault('r', cl.relowner))) a
       where cl.oid = t::regclass and a.grantee <> cl.relowner) x;
    if v_acl <> 'service_role=SELECT' then raise exception '0359: the ACL of % is not service_role=SELECT (%)', t, v_acl; end if;
    select coalesce(string_agg(x.e, ',' order by x.e), '') into v_acl from (
      select att.attname::text || ':' || a.grantee::text || '=' || a.privilege_type as e
        from pg_attribute att, lateral aclexplode(att.attacl) a
       where att.attrelid = t::regclass and att.attnum > 0 and not att.attisdropped and att.attacl is not null) x;
    if v_acl <> '' then raise exception '0359: % still carries a column privilege (%)', t, v_acl; end if;
    if not (select cl.relrowsecurity from pg_class cl where cl.oid = t::regclass) then raise exception '0359: RLS is off on %', t; end if;
    if exists (select 1 from pg_policy po where po.polrelid = t::regclass) then raise exception '0359: % has a policy', t; end if;
  end loop;
  if has_any_column_privilege('service_role', 'public.catering_refund_requests', 'UPDATE') then
    raise exception '0359: service_role can still UPDATE a column of catering_refund_requests';
  end if;

  -- (4) The guard: this file's body, and still bound as 0357 bound it.
  if (select md5(regexp_replace(p.prosrc, '[^\x21-\x7E]+', '', 'g')) from pg_proc p
       where p.oid = 'public.catering_refund_requests_guard()'::regprocedure) <> 'd8a3a4d9d1d401f19b7dd6fcf58bc7ee'
     or (select md5(btrim(regexp_replace(p.prosrc, '\s*[\r\n]+\s*', E'\n', 'g'), E' \t\r\n')) from pg_proc p
          where p.oid = 'public.catering_refund_requests_guard()'::regprocedure) <> '5ffea50368b69f2fa3288e18e572d9b7' then
    raise exception '0359: the guard body written is not this file''s';
  end if;
  if (select count(*) from pg_trigger tg where tg.tgrelid = 'public.catering_refund_requests'::regclass
        and tg.tgname = 'catering_refund_requests_guard' and not tg.tgisinternal and tg.tgenabled = 'O'
        and tg.tgfoid = 'public.catering_refund_requests_guard()'::regprocedure and tg.tgtype = 19
        and tg.tgattr::text = '' and tg.tgqual is null and tg.tgnargs = 0) <> 1
     or (select count(*) from pg_trigger tg where tg.tgrelid = 'public.catering_refund_requests'::regclass and not tg.tgisinternal) <> 1 then
    raise exception '0359: the catering_refund_requests_guard trigger is not 0357''s BEFORE UPDATE row trigger, alone';
  end if;
  -- 0358's actor rule is unchanged.
  if (select md5(regexp_replace(p.prosrc, '[^\x21-\x7E]+', '', 'g')) from pg_proc p
       where p.oid = 'public.catering_refund_actor_ok(uuid, uuid)'::regprocedure) <> '4076029ec89d7b777af23ff3d8fcbdee' then
    raise exception '0359: catering_refund_actor_ok is no longer 0358''s';
  end if;
  if not exists (select 1 from pg_indexes i where i.schemaname = 'public' and i.tablename = 'catering_refund_requests'
                  and i.indexname = 'catering_refund_requests_one_unresolved' and i.indexdef ilike 'create unique index%') then
    raise exception '0359: the one-unresolved-request index is missing or not unique';
  end if;

  -- (5) [Q5] [R12] [P3-3] What this file put on the tables main writes. Their user triggers, indexes and every
  -- constraint ON them are IDENTICAL to what the pre-flight saw.
  select md5(coalesce(string_agg(x.e, '|' order by x.e), '')) into v_now_digest from (
    select 'T:' || tg.tgrelid::regclass::text || ':' || tg.tgname || ':' || tg.tgtype::text || ':' || tg.tgfoid::regproc::text
           || ':' || tg.tgenabled::text as e
      from pg_trigger tg
     where tg.tgrelid in ('public.catering_payments'::regclass, 'public.catering_payment_refund_events'::regclass,
                          'public.stripe_events'::regclass, 'public.users'::regclass, 'public.cron_route_leases'::regclass)
       and not tg.tgisinternal
    union all
    select 'I:' || pg_get_indexdef(i.indexrelid)
      from pg_index i
     where i.indrelid in ('public.catering_payments'::regclass, 'public.catering_payment_refund_events'::regclass,
                          'public.stripe_events'::regclass, 'public.users'::regclass, 'public.cron_route_leases'::regclass)
    union all
    select 'C:' || c2.conrelid::regclass::text || ':' || c2.conname || ':' || pg_get_constraintdef(c2.oid)
      from pg_constraint c2
     where c2.conrelid in ('public.catering_payments'::regclass, 'public.catering_payment_refund_events'::regclass,
                           'public.stripe_events'::regclass, 'public.users'::regclass, 'public.cron_route_leases'::regclass)) x;
  if v_now_digest is distinct from current_setting('catering_refund_0359.before', true) then
    raise exception '0359: a user trigger, an index or a constraint ON one of main''s tables changed in this file';
  end if;
  -- The only NEW things that name them are the foreign keys of B1's own tables and columns, each NO ACTION; the
  -- internal triggers Postgres added on the referenced tables are exactly the ones that belong to them.
  foreach c in array array['catering_refund_observed_payment_fk', 'catering_refund_payment_state_payment_fk',
                           'catering_refund_requests_resolved_by_fk', 'catering_refund_observed_request_fk'] loop
    if (select count(*) from pg_constraint k where k.conname = c and k.contype = 'f' and k.confdeltype = 'a' and k.confupdtype = 'a'
          and k.connamespace = 'public'::regnamespace) <> 1 then
      raise exception '0359: foreign key % is missing or is not NO ACTION', c;
    end if;
  end loop;
  select count(*) into v_n
    from pg_trigger tg
   where tg.tgrelid in ('public.catering_payments'::regclass, 'public.catering_payment_refund_events'::regclass,
                        'public.stripe_events'::regclass, 'public.users'::regclass, 'public.cron_route_leases'::regclass)
     and tg.tgisinternal
     and not (tg.oid::text = any(string_to_array(current_setting('catering_refund_0359.before_internal', true), ',')))
     and not exists (select 1 from pg_constraint k
                      where k.oid = tg.tgconstraint
                        and k.conname in ('catering_refund_observed_payment_fk', 'catering_refund_payment_state_payment_fk',
                                          'catering_refund_requests_resolved_by_fk'));
  if v_n <> 0 then
    raise exception '0359: % internal trigger(s) on main''s tables do not belong to the three named foreign keys', v_n;
  end if;
  select count(*) into v_n
    from pg_trigger tg
   where tg.tgrelid in ('public.catering_payments'::regclass, 'public.users'::regclass) and tg.tgisinternal
     and not (tg.oid::text = any(string_to_array(current_setting('catering_refund_0359.before_internal', true), ',')));
  if v_n <> 6 then
    raise exception '0359: expected 6 new internal foreign-key triggers on catering_payments and users, found %', v_n;
  end if;

  -- (6) It answers: nothing is on, nothing is ready, nobody is nobody.
  if public.catering_refund_parts_ready() is distinct from false then
    raise exception '0359: catering_refund_parts_ready() did not answer false';
  end if;
  if (select x.observe_on or x.transitions <> 0 from public.catering_refund_observation x where x.id) then
    raise exception '0359: observation is not OFF at install';
  end if;
end $$;

commit;
