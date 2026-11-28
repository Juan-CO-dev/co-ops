-- Migration 0359_catering_refund_reconciler
-- AUTHORED 2026-11-27 (catering refunds Part B1 "money", CO CC Fable lead, for CC). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod on Juan's word.
-- APPLIED TO SIM 2026-11-28 UTC (schema_migrations version 20261128031445, name '0359_catering_refund_reconciler')
-- NUMBER: 0358 is the highest refund migration on main; 0359 is claimed for this build in co-ops-wt/.mig-claims
--   (B1 only). B2 (email) = 0362 and B3 (digest) = 0363 are LATER files; 0360 belongs to other work; 0361 is released.
-- Plan: PLAN-refund2B-r5 (Astra lead design) section B1 + CC's binding addendum RULINGS-refundB-r5-addendum (A1-A3).
-- Ships DARK like 0357 / 0358: the app refuses every refund unless CATERING_REFUNDS=1, that switch is unset
--   everywhere, and this file opens NO epoch. Applying it turns nothing on. With the switch OFF no code path of the
--   deployed app calls anything this file creates or changes.
--
-- WHAT THIS IS. The money half of catering refunds, Part B: ONE financial writer (catering_refund_apply) fed by an
--   evidence contract, the ledgers it writes, durable webhook ingress, recovery, the sweep's due lists, the operator
--   exits, and the epoch that admits any of it.
--
--   TABLES (all new; RLS on, four explicit _no_user_* denies each, NO privilege for PUBLIC / anon / authenticated /
--   service_role: every read and write is a SECURITY DEFINER function of this file)
--     catering_refund_install_contracts  one CURRENT (part, version) record per installed part (B1 here; 0362 writes
--                                        B2, 0363 writes B3). Written ONLY by its owning migration, after that
--                                        migration's assertions pass. No application-facing registration function.
--                                        A later reviewed migration may SUPERSEDE a part's record (addendum A3 i).
--     catering_refund_epochs             the admission barrier. At most one open epoch: recovering -> live ->
--                                        draining -> closed. Holds the accepted install manifest, the recovery cutoff
--                                        and cursors, the promotion / close instants, the ingress seal, the drain report.
--     catering_refund_payment_work       one row per settled Stripe payment the reconciler knows: PaymentIntent, mode,
--                                        verified charge and capture, the GENERATION every staged read is fenced on,
--                                        the staged discovery pass, due times, the stored projection, checkout cleanup.
--     catering_refund_identities         permanent provider refund ids. A HINT (unverified) stays distinguishable from
--                                        a VERIFIED identity (exact read: payment, charge, currency, amount, creation
--                                        time). Optional unique request binding. Current class: reserved / returned / void.
--     catering_refund_event_work         one row per verified Stripe refund event: endpoint context, mode, PI / charge,
--                                        the event's own creation time, cumulative amount, id hints. source = ingress
--                                        | recovery_seed. Floor state, coverage members, operator disposition and
--                                        financial application are kept apart from the transport verdict.
--     catering_payment_refund_outcomes   append-only identity class transitions (observed time, provider evidence
--                                        time, generation, shop, payment, quote, amount, epoch / baseline).
--     catering_refund_issues             actionable operational issues and their audited dispositions (closed
--                                        vocabulary: the hold codes; lib/catering/refund-outcomes-shared.ts is the twin).
--   0357 REQUEST EXTENSIONS  create_armed_at (write-once: a POST may have left), arm_epoch_id, arm_payment_intent,
--                            arm_count, reconcile_seq (the protected sequence), first_reversed_at (write-once),
--                            binding_hold, legacy_possibly_sent (a row attempted before this file: possibly sent).
--   THE REQUEST GUARD        re-emitted FROM 0357: same trigger, invoker, pinned path. Only an advance of
--                            reconcile_seq (which nobody but this file's definer functions can write) allows the
--                            enumerated provider moves and lifts the terminal stripe_status / last_error_code freeze.
--   THE CRON LEASE           claim_cron_route(text) and its table CHECK re-emitted FROM 0343 with the previous eight
--                            names plus 'catering-refund-sweep'. Same 330-second lease, conflict condition and ACL.
--
--   WITHDRAWN (the stale sender, plan B1.5 / ruling 8): service_role loses all nine direct UPDATE column grants on
--     catering_refund_requests and EXECUTE on 0357's snapshot writer, catering_refund_claim(uuid) and
--     catering_refund_reserve(uuid,uuid,uuid,bigint,text,text,text). The historical definitions stay for provenance.
--     main @ 9ce98df5 with the switch ON therefore fails BEFORE any reservation row, destructive audit or Stripe POST.
--     Revocation cannot recall a network call already admitted: drain old senders first; this file REFUSES while a
--     live 0357 claim exists (checked under its own table lock).
--
--   FUNCTIONS. Every worker function takes p_caller = the deployment's compiled contract version as its FIRST,
--   REQUIRED argument (no defaults anywhere) and fails closed on a missing or incompatible one.
--     operator-only lifecycle (EXECUTE revoked from PUBLIC, anon, authenticated AND service_role; CC runs them as the owner)
--       catering_refund_open_recovery, _promote, _start_drain, _finish_drain, _break_glass_close,
--       _adopt_contract_upgrade, _recovery_report
--     private (no EXECUTE for anyone but the owner)
--       catering_refund_admit, catering_refund_install_manifest, catering_refund_requests_guard,
--       catering_refund_outcomes_append_only, catering_refund_apply_inner, catering_refund_raise_issue,
--       catering_refund_attach_event, catering_refund_register_hints, catering_refund_class_of
--     worker (service_role EXECUTE only)
--       catering_refund_epoch_state, catering_refund_effective_figures, catering_refund_summary,
--       catering_refund_reserve_admitted, catering_refund_claim_admitted, catering_refund_arm, catering_refund_finish,
--       catering_refund_release, catering_refund_event_register, catering_refund_settlement_attach,
--       catering_refund_pass_begin, catering_refund_pass_remember, catering_refund_apply, catering_refund_defer,
--       catering_refund_resolve_anomaly, catering_refund_sweep_due, catering_refund_sweep_housekeeping,
--       catering_refund_recovery_seed_batch, catering_refund_cleanup_done, catering_refund_watch_state
--
-- THE EVIDENCE CONTRACT (plan B1.2 + addendum A1), enforced in catering_refund_apply_inner under the payment lock:
--   · only an EXACT read of a refund id drives its provider status; a list or an event contributes hints;
--   · a live `charge.refunded` cumulative is a FLOOR from ingress; it is discharged when verified identities on the
--     same payment, charge and currency, created at or before the event, sum to it WHATEVER their current class --
--     EXCEPT (A1) a void identity the app holds an observation of as void (a signed event's `created`, or the first
--     database observation of the void class) from at or before the event's own creation time: that one cannot
--     explain the event. Money is projected from CURRENT classes. A historical recovery seed creates no floor.
--   · the effective provider deduction is at least the largest outstanding floor, also against a newer snapshot.
-- LOCKS TAKEN BY THIS FILE (for its one transaction; seconds): SHARE ROW EXCLUSIVE then ACCESS EXCLUSIVE on
--   catering_refund_requests (the explicit lock, then ALTER TABLE), ACCESS EXCLUSIVE on cron_route_leases (its CHECK),
--   and SHARE ROW EXCLUSIVE on every table a new foreign key references (catering_payments, catering_quotes,
--   locations, users, stripe_events). Writers of those tables wait for the file; apply it in a quiet window.
-- LOCK ORDER: epoch admission (advisory key 7359035900: shared for admission, exclusive for lifecycle) -> actor /
--   session -> payments FOR NO KEY UPDATE in id order -> work -> identities -> requests -> snapshot / outcomes -> issues.
--   No database lock is ever held across provider I/O: every function here is one short transaction.
--
-- INSTALL AND CALLER CONTRACT (plan B1.5 r5 + addendum A3):
--   · catering_refund_install_manifest() holds the release's fixed expected versions. A corrective migration re-emits it.
--   · open_recovery and promote each compare the CURRENT install records with it under the lifecycle lock and refuse
--     a missing, duplicate, unexpected or incompatible version BEFORE any epoch mutation. A 0359-only database refuses.
--   · the accepted manifest is stored on the epoch. A worker call is admitted only when p_caller equals the open
--     epoch's B1 version; with no open epoch (signed ingress, settlement attach) it must equal the current B1 record.
--   · A3 (i): a later reviewed migration may replace a part's record (it marks the old one superseded and declares
--     supersedes_version); catering_refund_adopt_contract_upgrade adopts it for the open epoch, draining included.
--   · A3 (ii): catering_refund_break_glass_close closes a draining epoch with undrained work ONLY on Juan's recorded
--     word; it stores the full undrained list and re-stamps every event-backed item to main's `payment_not_found`.
--
-- PRE-FLIGHT (in this file; refuses a drifted database by name and changes nothing): 0333, 0343, 0357 and 0358 are
--   here as their files define them (body fingerprints, house + exact, of every function this file re-emits or relies
--   on; the guard trigger's binding; the cron CHECK; the actor rule; the whole ACLs of 0357's two tables and nine
--   column grants; the dependency columns), and no live 0357 claim exists.
-- ASSERTIONS (in this file, before the install record is written; any failure raises and nothing is kept): RLS and
--   the four denies on every new table, the WHOLE ACL of every new table (owner only) and of 0357's two tables,
--   PUBLIC grantee zero, no grant option, the effective permissions of the four roles, the function modes
--   (SECURITY DEFINER + pinned search_path), who may execute what (worker / operator / private), the withdrawn
--   grants, the indexes, the trigger's identity, and 0358's actor rule unchanged.
-- DEPLOY ORDER: safe both ways while the switch is OFF. This file first: main's OFF paths touch nothing here; main
--   with the switch ON is refused before the Stripe POST (see WITHDRAWN). App first: the new code with the switch ON
--   answers `refunds_unavailable` (the functions are missing) and never falls back to the old money writer.
-- DEPENDS ON: 0127, 0120, 0204 (stripe_events), 0243 / 0343 (cron lease), 0303, 0333, 0357, 0358, sessions (0257 clocks).
-- SIM, STATED EXACTLY: the sim apply above ran this file as it stood at commit e4297115 (file sha256 97f52839...). This
--   stamp is a later, header-only commit: what is live on the sim is what this file creates.
-- PROOF: scripts/sql-harness-0359.mjs (PGlite, the REAL 0357 -> 0358 -> 0359), CI-pinned by
--   tests/catering-refund-0359-migration.test.ts. Two-session lock proof: scripts/sim/refund-0359-lock-check.mjs (sim only, CC).
-- ROLLBACK (only while no epoch was ever opened): a NEW reviewed migration that drops this file's functions, tables
--   and columns, re-emits 0357's guard and 0343's lease, and restores 0357's grants. The install record goes with the
--   table. After operational use a schema reversal needs a separately reviewed correction; never edit this file.
begin;

-- Old senders are drained before DDL: nothing may be mid-send while the privileges change.
lock table public.catering_refund_requests in share row exclusive mode;

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
  if to_regclass('public.catering_refund_install_contracts') is not null then
    raise exception '0359: already applied';
  end if;
  foreach t in array array['catering_payments', 'catering_quotes', 'catering_payment_refund_events', 'stripe_events',
                           'cron_route_leases', 'catering_refund_requests', 'catering_refund_stripe_snapshots', 'users',
                           'user_locations', 'locations', 'audit_log', 'sessions'] loop
    if to_regclass('public.' || t) is null then raise exception '0359: public.% is missing', t; end if;
  end loop;
  foreach t in array array['catering_refund_epochs', 'catering_refund_payment_work', 'catering_refund_identities',
                           'catering_refund_event_work', 'catering_payment_refund_outcomes', 'catering_refund_issues'] loop
    if to_regclass('public.' || t) is not null then raise exception '0359: public.% already exists', t; end if;
  end loop;
  -- Dependency columns (the live schema, never a helper's idea of it).
  for fp in select * from (values
      ('catering_payments', 'settlement_cleanup_at'), ('catering_payments', 'provider_ref'), ('catering_payments', 'provider'),
      ('catering_payments', 'status'), ('catering_payments', 'quote_id'), ('catering_payments', 'amount_cents'),
      ('catering_quotes', 'root_id'), ('catering_quotes', 'location_id'),
      ('stripe_events', 'outcome'), ('stripe_events', 'processed_at'), ('stripe_events', 'payload'), ('stripe_events', 'type'),
      ('stripe_events', 'livemode'), ('stripe_events', 'received_at'), ('stripe_events', 'location_id'),
      ('catering_payment_refund_events', 'stripe_event_id'), ('catering_payment_refund_events', 'cumulative_refunded_cents'),
      ('catering_payment_refund_events', 'charge_amount_cents'), ('catering_payment_refund_events', 'refunded_at'),
      ('catering_payment_refund_events', 'refunded_at_approximate'),
      ('sessions', 'user_id'), ('sessions', 'revoked_at'), ('sessions', 'expires_at'), ('sessions', 'step_up_unlocked'),
      ('sessions', 'step_up_unlocked_at'),
      ('audit_log', 'destructive'), ('audit_log', 'metadata'), ('audit_log', 'resource_id'),
      ('cron_route_leases', 'lease_until')) as x(tbl, col) loop
    if not exists (select 1 from information_schema.columns c where c.table_schema = 'public'
                    and c.table_name = fp.tbl and c.column_name = fp.col) then
      raise exception '0359: public.%.% is missing', fp.tbl, fp.col;
    end if;
  end loop;
  foreach t in array array['create_armed_at', 'arm_epoch_id', 'arm_payment_intent', 'reconcile_seq', 'first_reversed_at', 'binding_hold',
                           'arm_count', 'legacy_possibly_sent'] loop
    if exists (select 1 from information_schema.columns c where c.table_schema = 'public'
                and c.table_name = 'catering_refund_requests' and c.column_name = t) then
      raise exception '0359: public.catering_refund_requests.% already exists', t;
    end if;
  end loop;

  -- The bodies this file re-emits or relies on must be their source files', by BOTH fingerprints (0358's convention):
  -- house = md5 of prosrc with every non-printing character removed; exact = only line breaks normalized.
  for fp in select * from (values
      ('catering_refund_requests_guard()',                                        '9650ed5236df567bb4761af3ad3d1728',    '2807cdc25ef8d80c0399aa7ce089ae05',    '0357'),
      ('catering_refund_figures(uuid)',                                           'd62aacb7a65ed6abce7445f7b54c1bd9',  'a015ff3f2ef702c35f0d65b7484dfec5',  '0357'),
      ('catering_refund_record_snapshot(uuid, timestamptz, bigint, jsonb)',       '98c1cce5298eb4d1d44c37cc6525e819', '8f824d7ddf91e4446b5b1162b422d579', '0357'),
      ('catering_refund_reserve(uuid, uuid, uuid, bigint, text, text, text)',     '76d984e1425af5c7c90f2092a4b0e051',  'e6864c42ff5bdf2fc0d9f411795a4be4',  '0357'),
      ('catering_refund_claim(uuid)',                                             '1b9fb185db2bf0c4ab109bfa160aa424',    '03b982529716ca8f985d5c7f2999f370',    '0357'),
      ('catering_refund_actor_ok(uuid, uuid)',                                    '4076029ec89d7b777af23ff3d8fcbdee', 'd78c4f8d7e4aa13351cde97c7541b884', '0358'),
      ('claim_cron_route(text)',                                                  'e66e3151a8c249588892b79de48a2fad',     'a48209a1ed19e3c2fa263b0053bd802b',     '0343')
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
  foreach f in array array['catering_refund_reserve_admitted', 'catering_refund_claim_admitted', 'catering_refund_apply',
                           'catering_refund_apply_inner', 'catering_refund_event_register', 'catering_refund_open_recovery',
                           'catering_refund_promote', 'catering_refund_finish_drain', 'catering_refund_resolve_anomaly'] loop
    if exists (select 1 from pg_proc p where p.proname = f and p.pronamespace = 'public'::regnamespace) then
      raise exception '0359: function public.% already exists', f;
    end if;
  end loop;

  -- 0357's guard trigger, exactly (0358's check): that name, enabled, BEFORE UPDATE FOR EACH ROW, no column list, no WHEN.
  if (select count(*) from pg_trigger tg where tg.tgrelid = 'public.catering_refund_requests'::regclass
        and tg.tgname = 'catering_refund_requests_guard' and not tg.tgisinternal and tg.tgenabled = 'O'
        and tg.tgfoid = 'public.catering_refund_requests_guard()'::regprocedure and tg.tgtype = 19
        and tg.tgattr::text = '' and tg.tgqual is null and tg.tgnargs = 0) <> 1 then
    raise exception '0359: the catering_refund_requests_guard trigger is missing, disabled, or not 0357''s BEFORE UPDATE row trigger';
  end if;
  if (select count(*) from pg_trigger tg where tg.tgrelid = 'public.catering_refund_requests'::regclass and not tg.tgisinternal) <> 1 then
    raise exception '0359: public.catering_refund_requests carries a trigger that is not 0357''s';
  end if;

  -- 0343's cron CHECK: exactly the eight names.
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = 'public.cron_route_leases'::regclass and c.conname = 'cron_route_leases_job_check' and c.contype = 'c' and c.convalidated;
  if v_def is null then raise exception '0359: cron_route_leases_job_check is missing or not validated'; end if;
  if (select array_agg(m[1] order by m[1]) from regexp_matches(v_def, '''([a-z0-9-]+)''', 'g') m)
       is distinct from array['catering-inbox-delivery', 'demand-signals', 'fact-build', 'meta-leads', 'schedule-draft',
                              'sevenshifts-sync', 'toast-catering-scan', 'toast-sales-today'] then
    raise exception '0359: cron_route_leases_job_check is not the 0343 eight-job union (%)', v_def;
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
                           'catering_refund_record_snapshot(uuid, timestamptz, bigint, jsonb)', 'catering_refund_requests_guard()',
                           'claim_cron_route(text)'] loop
    if exists (select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.oid = ('public.' || f)::regprocedure and a.grantee <> p.proowner
                  and (a.grantee <> 'service_role'::regrole::oid or a.is_grantable)) then
      raise exception '0359: public.% has an unexpected grantee or a grant option in its ACL', f;
    end if;
  end loop;

  -- No old sender may be mid-send: a live 0357 claim is an admitted network call this file cannot recall.
  if exists (select 1 from public.catering_refund_requests r where r.claimed_until is not null and r.claimed_until > clock_timestamp()) then
    raise exception '0359: a live refund claim exists (an old sender may be mid-send). Drain it and re-run. Refusing.';
  end if;
end $$;

-- ── Tables ──────────────────────────────────────────────────────────────────────────────────────────────
create table public.catering_refund_install_contracts (
  part               text not null check (part in ('B1', 'B2', 'B3')),
  version            text not null check (version ~ '^b[123]-[0-9]{1,6}$' and lower(left(version, 2)) = lower(part)),
  supersedes_version text check (supersedes_version is null or supersedes_version ~ '^b[123]-[0-9]{1,6}$'),
  migration          text not null check (migration ~ '^[0-9]{4}_[a-z0-9_]{1,80}$'),
  installed_at       timestamptz not null default clock_timestamp(),
  superseded_at      timestamptz,
  primary key (part, version)
);
create unique index catering_refund_install_contracts_current on public.catering_refund_install_contracts (part) where superseded_at is null;

create table public.catering_refund_epochs (
  id                   uuid primary key default gen_random_uuid(),
  seq                  bigint generated always as identity unique,
  state                text not null check (state in ('recovering', 'live', 'draining', 'closed')),
  generation           bigint not null default 1 check (generation > 0),
  manifest             jsonb not null check (jsonb_typeof(manifest) = 'object'),
  opened_at            timestamptz not null default clock_timestamp(),
  opened_by            text not null check (length(opened_by) between 1 and 80),
  recovery_cutoff      timestamptz not null,
  recovery_cursors     jsonb not null default '{}'::jsonb check (jsonb_typeof(recovery_cursors) = 'object'),
  recovery_complete_at timestamptz,
  promoted_at          timestamptz,
  promote_ack          jsonb,
  draining_at          timestamptz,
  closed_at            timestamptz,
  close_kind           text check (close_kind in ('drained', 'break_glass')),
  ingress_sealed_at    timestamptz,
  seal_released_at     timestamptz,
  drain_report         jsonb,
  constraint catering_refund_epochs_closed_is_stamped check ((state = 'closed') = (closed_at is not null and close_kind is not null)),
  constraint catering_refund_epochs_seal_needs_close check (ingress_sealed_at is null or state = 'closed'),
  constraint catering_refund_epochs_live_is_promoted check (state not in ('live', 'draining') or promoted_at is not null or draining_at is not null)
);
create unique index catering_refund_epochs_one_open on public.catering_refund_epochs ((true)) where state <> 'closed';

create table public.catering_refund_payment_work (
  payment_id               uuid primary key references public.catering_payments(id),
  location_id              uuid not null references public.locations(id),
  payment_intent_id        text not null unique check (payment_intent_id ~ '^pi_[A-Za-z0-9_]{1,250}$'),
  livemode                 boolean,
  charge_id                text check (charge_id is null or charge_id ~ '^[A-Za-z0-9_]{1,255}$'),
  currency                 text check (currency is null or currency ~ '^[a-z]{3}$'),
  captured_cents           bigint check (captured_cents is null or captured_cents >= 0),
  capture_known            boolean not null default false,
  generation               bigint not null default 1 check (generation > 0),
  baseline_at              timestamptz,
  baseline_source          text not null check (baseline_source in ('recovery', 'settlement', 'ingress', 'staff')),
  pass_token               uuid,
  pass_generation          bigint,
  pass_started_at          timestamptz,
  pass_run_id              uuid,
  discovery_cursor         jsonb check (discovery_cursor is null or jsonb_typeof(discovery_cursor) = 'object'),
  last_complete_pass_at    timestamptz,
  last_complete_generation bigint,
  returned_cents           bigint not null default 0 check (returned_cents >= 0),
  reserved_cents           bigint not null default 0 check (reserved_cents >= 0),
  next_due_at              timestamptz not null default clock_timestamp(),
  retry_count              integer not null default 0 check (retry_count >= 0),
  deferrals                integer not null default 0 check (deferrals >= 0),
  oldest_unresolved_at     timestamptz,
  restricted_at            timestamptz,
  checkout_cleanup_owed_at timestamptz,
  checkout_cleanup_done_at timestamptz,
  checkout_cleanup_report  jsonb,
  created_at               timestamptz not null default clock_timestamp(),
  updated_at               timestamptz not null default clock_timestamp()
);
create index catering_refund_payment_work_due on public.catering_refund_payment_work (next_due_at, payment_id);
create index catering_refund_payment_work_unresolved on public.catering_refund_payment_work (oldest_unresolved_at) where oldest_unresolved_at is not null;
create index catering_refund_payment_work_cleanup on public.catering_refund_payment_work (checkout_cleanup_owed_at)
  where checkout_cleanup_owed_at is not null and checkout_cleanup_done_at is null;

create table public.catering_refund_identities (
  refund_id            text primary key check (refund_id ~ '^[A-Za-z0-9_]{1,255}$'),
  payment_id           uuid not null references public.catering_payments(id),
  verified             boolean not null default false,
  charge_id            text check (charge_id is null or charge_id ~ '^[A-Za-z0-9_]{1,255}$'),
  amount_cents         bigint check (amount_cents is null or amount_cents > 0),
  currency             text check (currency is null or currency ~ '^[a-z]{3}$'),
  provider_created_at  timestamptz,
  provider_status      text check (provider_status is null or length(provider_status) <= 40),
  class                text check (class is null or class in ('reserved', 'returned', 'void')),
  unfamiliar           boolean not null default false,
  wrong_charge         boolean not null default false,
  request_id           uuid unique references public.catering_refund_requests(id),
  candidate_request_id uuid references public.catering_refund_requests(id),
  external_at          timestamptz,
  first_seen_at        timestamptz not null default clock_timestamp(),
  first_source         text not null check (first_source in ('event', 'create_response', 'list', 'snapshot', 'request_binding', 'recovery_seed')),
  verified_at          timestamptz,
  last_read_at         timestamptz,
  void_evidence_at     timestamptz,
  unreadable_since     timestamptz,
  not_found_passes     integer not null default 0 check (not_found_passes >= 0),
  not_found_last_run   uuid,
  quarantined_at       timestamptz,
  excluded_at          timestamptz,
  next_poll_at         timestamptz,
  constraint catering_refund_identities_verified_has_facts check (not verified or (charge_id is not null
    and amount_cents is not null and currency is not null and provider_created_at is not null and class is not null and verified_at is not null)),
  constraint catering_refund_identities_binding_is_verified check (request_id is null or verified)
);
create index catering_refund_identities_payment on public.catering_refund_identities (payment_id);
create index catering_refund_identities_poll on public.catering_refund_identities (next_poll_at, refund_id) where verified and next_poll_at is not null;

create table public.catering_refund_event_work (
  event_id                 text primary key references public.stripe_events(id),
  event_type               text not null check (event_type in ('charge.refunded', 'refund.created', 'refund.updated', 'refund.failed', 'charge.refund.updated')),
  source                   text not null check (source in ('ingress', 'recovery_seed')),
  endpoint_location_id     uuid references public.locations(id),
  livemode                 boolean not null,
  payment_intent_id        text check (payment_intent_id is null or payment_intent_id ~ '^pi_[A-Za-z0-9_]{1,250}$'),
  charge_id                text check (charge_id is null or charge_id ~ '^[A-Za-z0-9_]{1,255}$'),
  provider_created_at      timestamptz,
  cumulative_cents         bigint check (cumulative_cents is null or cumulative_cents >= 0),
  charge_amount_cents      bigint check (charge_amount_cents is null or charge_amount_cents >= 0),
  charge_fully_refunded    boolean,
  hints                    jsonb not null default '[]'::jsonb check (jsonb_typeof(hints) = 'array'),
  payment_id               uuid references public.catering_payments(id),
  state                    text not null check (state in ('unmatched', 'attached', 'no_payment', 'quarantined')),
  floor_state              text not null default 'none' check (floor_state in ('none', 'outstanding', 'discharged', 'operator_resolved')),
  floor_cents              bigint check (floor_cents is null or floor_cents > 0),
  coverage                 jsonb,
  floor_closed_at          timestamptz,
  floor_generation         bigint,
  disposition_by           uuid references public.users(id),
  disposition_evidence_ref text check (disposition_evidence_ref is null or length(disposition_evidence_ref) between 1 and 120),
  applied_at               timestamptz,
  applied_generation       bigint,
  history_appended         boolean not null default false,
  legacy_verdict           text check (legacy_verdict is null or length(legacy_verdict) <= 40),
  restamped_at             timestamptz,
  received_at              timestamptz not null default clock_timestamp(),
  parked_at                timestamptz,
  constraint catering_refund_event_work_floor_is_live_ingress check (floor_state = 'none' or (source = 'ingress'
    and event_type = 'charge.refunded' and floor_cents is not null and payment_id is not null)),
  constraint catering_refund_event_work_attached_has_payment check ((state in ('attached', 'quarantined')) = (payment_id is not null))
);
create index catering_refund_event_work_pi on public.catering_refund_event_work (payment_intent_id);
create index catering_refund_event_work_payment on public.catering_refund_event_work (payment_id) where payment_id is not null;
create index catering_refund_event_work_unmatched on public.catering_refund_event_work (received_at, event_id) where state = 'unmatched';
create index catering_refund_event_work_floors on public.catering_refund_event_work (payment_id) where floor_state = 'outstanding';

create table public.catering_payment_refund_outcomes (
  id                   bigint generated always as identity primary key,
  refund_id            text not null references public.catering_refund_identities(refund_id),
  payment_id           uuid not null references public.catering_payments(id),
  quote_id             uuid not null references public.catering_quotes(id),
  location_id          uuid not null references public.locations(id),
  request_id           uuid references public.catering_refund_requests(id),
  from_class           text check (from_class is null or from_class in ('reserved', 'returned', 'void')),
  to_class             text not null check (to_class in ('reserved', 'returned', 'void')),
  provider_status      text check (provider_status is null or length(provider_status) <= 40),
  amount_cents         bigint not null check (amount_cents > 0),
  observed_at          timestamptz not null default clock_timestamp(),
  provider_evidence_at timestamptz,
  generation           bigint not null,
  epoch_id             uuid references public.catering_refund_epochs(id),
  baseline             boolean not null,
  source               text not null check (source in ('apply', 'recovery'))
);
create index catering_payment_refund_outcomes_payment on public.catering_payment_refund_outcomes (payment_id, id);
create index catering_payment_refund_outcomes_observed on public.catering_payment_refund_outcomes (observed_at, id);

create table public.catering_refund_issues (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null check (code in ('awaiting_identity', 'verified_unreadable', 'ambiguous_binding', 'refund_revived',
                         'released_request_has_refund', 'unfamiliar_identity', 'capture_review', 'wrong_charge', 'owner_indeterminate',
                         'quarantined_hint', 'reserved_not_sent', 'submission_unconfirmed', 'checkout_still_open')),
  payment_id           uuid not null references public.catering_payments(id),
  location_id          uuid not null references public.locations(id),
  request_id           uuid references public.catering_refund_requests(id),
  refund_id            text check (refund_id is null or refund_id ~ '^[A-Za-z0-9_]{1,255}$'),
  event_id             text check (event_id is null or length(event_id) <= 255),
  evidence_fingerprint text not null check (length(evidence_fingerprint) between 1 and 300),
  state                text not null default 'open' check (state in ('open', 'held', 'resolved')),
  blocking             boolean not null,
  opened_at            timestamptz not null default clock_timestamp(),
  last_seen_at         timestamptz not null default clock_timestamp(),
  aged_at              timestamptz,
  generation_at_open   bigint not null,
  disposition          text check (disposition is null or disposition in ('bind_verified_refund', 'treat_as_external',
                         'exclude_unrelated_hint', 'recheck_after_access', 'access_still_required', 'resolve_event_floor',
                         'evidence_reviewed', 'keep_held', 'reopen_recheck', 'release_unsent', 'acknowledge_followup', 'evidence_cleared')),
  disposition_by       uuid references public.users(id),
  disposition_at       timestamptz,
  evidence_ref         text check (evidence_ref is null or evidence_ref ~ '^[A-Za-z0-9_.:/#-]{1,120}$'),
  detail               jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  constraint catering_refund_issues_one_per_evidence unique (payment_id, code, evidence_fingerprint)
);
create index catering_refund_issues_open on public.catering_refund_issues (payment_id) where state <> 'resolved';
create index catering_refund_issues_aging on public.catering_refund_issues (opened_at) where state = 'open';

-- ── 0357 request extensions ─────────────────────────────────────────────────────────────────────────────
alter table public.catering_refund_requests
  add column create_armed_at    timestamptz,
  add column arm_epoch_id       uuid references public.catering_refund_epochs(id),
  add column arm_payment_intent text check (arm_payment_intent is null or arm_payment_intent ~ '^pi_[A-Za-z0-9_]{1,250}$'),
  add column reconcile_seq      bigint not null default 0 check (reconcile_seq >= 0),
  add column first_reversed_at  timestamptz,
  add column binding_hold       text check (binding_hold is null or binding_hold in ('ambiguous_binding', 'released_request_has_refund', 'refund_revived')),
  add column arm_count          integer not null default 0 check (arm_count >= 0),
  add column legacy_possibly_sent boolean not null default false,
  add constraint catering_refund_requests_arm_is_whole check ((create_armed_at is null) = (arm_epoch_id is null) and (create_armed_at is null) = (arm_payment_intent is null));
-- A row attempted BEFORE this file (0357's claim and send were one step, with no way to reconstruct an arm) is treated
-- as possibly sent: it can never be closed as "nothing was sent". No such row can be made after this file: the old
-- claim is withdrawn below, in this same transaction, under the table lock taken above.
update public.catering_refund_requests set legacy_possibly_sent = true where first_attempt_at is not null or attempts > 0;
create index catering_refund_requests_attempted_unbound on public.catering_refund_requests (first_attempt_at, id)
  where status = 'pending' and stripe_refund_id is null and first_attempt_at is not null;
create index catering_refund_requests_unarmed on public.catering_refund_requests (requested_at, id)
  where status = 'pending' and create_armed_at is null;

-- ── RLS: deny-all with the four explicit denials; no privilege for any API role ─────────────────────────
do $$ declare t text; begin
  foreach t in array array['catering_refund_install_contracts', 'catering_refund_epochs', 'catering_refund_payment_work',
                           'catering_refund_identities', 'catering_refund_event_work', 'catering_payment_refund_outcomes',
                           'catering_refund_issues'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (false)', t || '_no_user_select', t);
    execute format('create policy %I on public.%I for insert with check (false)', t || '_no_user_insert', t);
    execute format('create policy %I on public.%I for update using (false)', t || '_no_user_update', t);
    execute format('create policy %I on public.%I for delete using (false)', t || '_no_user_delete', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
  end loop;
end $$;

-- ── The stale sender is withdrawn (plan B1.5): no direct request UPDATE, no historical reserve / claim / snapshot ──
revoke update (status, stripe_refund_id, stripe_status, last_error_code, last_error_message, updated_at, settled_at,
               claim_token, claimed_until)
  on table public.catering_refund_requests from service_role;
revoke all on function public.catering_refund_reserve(uuid, uuid, uuid, bigint, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.catering_refund_claim(uuid) from public, anon, authenticated, service_role;
revoke all on function public.catering_refund_record_snapshot(uuid, timestamptz, bigint, jsonb) from public, anon, authenticated, service_role;

-- ── The request guard, re-emitted FROM 0357 ─────────────────────────────────────────────────────────────
-- 0357's body, plus: the arm and the first reversal are write-once, reconcile_seq never goes back, and ONLY an
-- advance of reconcile_seq allows the enumerated provider moves (succeeded -> submitted | failed, failed ->
-- submitted | succeeded) and a change of a terminal row's stripe_status / last_error_code.
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
  if new.reconcile_seq < old.reconcile_seq then
    raise exception 'refund_request_immutable' using errcode = 'P0001';
  end if;
  if old.create_armed_at is not null and (new.create_armed_at is distinct from old.create_armed_at
     or new.arm_epoch_id is distinct from old.arm_epoch_id or new.arm_payment_intent is distinct from old.arm_payment_intent) then
    raise exception 'refund_request_immutable' using errcode = 'P0001';
  end if;
  if old.first_reversed_at is not null and new.first_reversed_at is distinct from old.first_reversed_at then
    raise exception 'refund_request_immutable' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'pending' and new.status in ('submitted', 'succeeded', 'failed'))
    or (old.status = 'submitted' and new.status in ('succeeded', 'failed'))
    or (new.reconcile_seq > old.reconcile_seq and (
            (old.status = 'succeeded' and new.status in ('submitted', 'failed'))
         or (old.status = 'failed' and new.status in ('submitted', 'succeeded'))))) then
    raise exception 'refund_request_bad_transition' using errcode = 'P0001';
  end if;
  if old.status in ('succeeded', 'failed') and new.reconcile_seq = old.reconcile_seq
     and (new.stripe_status is distinct from old.stripe_status or new.last_error_code is distinct from old.last_error_code) then
    raise exception 'refund_request_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Outcomes are append-only for everyone, the owner's functions included.
create function public.catering_refund_outcomes_append_only() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception 'refund_outcome_append_only' using errcode = 'P0001';
end $$;
create trigger catering_payment_refund_outcomes_append_only before update or delete on public.catering_payment_refund_outcomes
  for each row execute function public.catering_refund_outcomes_append_only();

-- ── The cron lease, re-emitted FROM 0343 with 'catering-refund-sweep' added; no job is dropped ───────────
alter table public.cron_route_leases drop constraint cron_route_leases_job_check,
  add constraint cron_route_leases_job_check check(job in ('toast-sales-today','toast-catering-scan','sevenshifts-sync','schedule-draft','catering-inbox-delivery','meta-leads','fact-build','demand-signals','catering-refund-sweep'));
create or replace function public.claim_cron_route(p_job text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare claimed text;
begin
  if p_job is null or p_job not in ('toast-sales-today','toast-catering-scan','sevenshifts-sync','schedule-draft','catering-inbox-delivery','meta-leads','fact-build','demand-signals','catering-refund-sweep') then raise exception 'invalid_cron_route'; end if;
  insert into public.cron_route_leases(job,lease_until) values(p_job,clock_timestamp()+interval '330 seconds')
  on conflict(job) do update set lease_until=clock_timestamp()+interval '330 seconds'
    where cron_route_leases.lease_until<=clock_timestamp() returning job into claimed;
  return claimed is not null;
end $$;

-- ── Private helpers ─────────────────────────────────────────────────────────────────────────────────────
-- The release's fixed expected install matrix. A corrective migration re-emits this function (addendum A3 i).
create function public.catering_refund_install_manifest() returns jsonb
language sql immutable set search_path = pg_catalog, public as $$
  select '{"B1": "b1-1", "B2": "b2-1", "B3": "b3-1"}'::jsonb
$$;

-- A provider status -> the money class. `succeeded` alone is returned; failed / canceled release the provider-side
-- amount; pending, requires_action, null and any unfamiliar value RESERVE.
create function public.catering_refund_class_of(p_status text) returns text
language sql immutable set search_path = pg_catalog, public as $$
  select case when p_status = 'succeeded' then 'returned' when p_status in ('failed', 'canceled') then 'void' else 'reserved' end
$$;

-- THE ADMISSION. p_mode: 'ingress' (signed webhook ingress, settlement attach: allowed with no epoch, refused once
-- sealed) | 'create' (reserve, claim, arm: live only) | 'work' (pass, apply, defer, release, disposition, sweep:
-- any open epoch) | 'evidence' (a create response id: any state). Takes the shared admission lock, which every
-- lifecycle function takes exclusively, and validates the caller's compiled contract version.
create function public.catering_refund_admit(p_caller text, p_mode text, out o_epoch uuid, out o_state text)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_ep record;
  v_b1 text;
  v_sealed boolean;
begin
  if p_caller is null or p_caller !~ '^b1-[0-9]{1,6}$' or p_mode is null
     or p_mode not in ('ingress', 'create', 'work', 'evidence') then
    raise exception 'caller_incompatible' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock_shared(7359035900);
  select e.id, e.state, e.manifest into v_ep from public.catering_refund_epochs e where e.state <> 'closed';
  if found then
    if p_caller is distinct from (v_ep.manifest->>'B1') then raise exception 'caller_incompatible' using errcode = 'P0001'; end if;
    o_epoch := v_ep.id; o_state := v_ep.state;
  else
    select c.version into v_b1 from public.catering_refund_install_contracts c where c.part = 'B1' and c.superseded_at is null;
    if v_b1 is null or p_caller is distinct from v_b1 then raise exception 'caller_incompatible' using errcode = 'P0001'; end if;
    select (e.ingress_sealed_at is not null and e.seal_released_at is null) into v_sealed
      from public.catering_refund_epochs e order by e.seq desc limit 1;
    o_epoch := null; o_state := case when coalesce(v_sealed, false) then 'sealed' else 'none' end;
  end if;
  if p_mode = 'ingress' and o_state = 'sealed' then raise exception 'refunds_sealed' using errcode = 'P0001'; end if;
  if p_mode = 'create' then
    if o_state in ('none', 'sealed') then raise exception 'refunds_no_epoch' using errcode = 'P0001'; end if;
    if o_state = 'recovering' then raise exception 'refunds_recovering' using errcode = 'P0001'; end if;
    if o_state = 'draining' then raise exception 'refunds_draining' using errcode = 'P0001'; end if;
  end if;
  if p_mode = 'work' and o_state in ('none', 'sealed') then raise exception 'refunds_no_epoch' using errcode = 'P0001'; end if;
end $$;

-- An active session of an active user (the JWT's session id; never a client-supplied actor).
create function public.catering_refund_session_user(p_session_id uuid) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_user uuid;
begin
  select s.user_id into v_user from public.sessions s join public.users u on u.id = s.user_id and u.active
   where s.id = p_session_id and s.revoked_at is null and s.expires_at > clock_timestamp();
  return v_user;
end $$;

create function public.catering_refund_raise_issue(p_code text, p_payment_id uuid, p_location_id uuid, p_request_id uuid,
  p_refund_id text, p_event_id text, p_fingerprint text, p_blocking boolean, p_generation bigint, p_detail jsonb) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_id uuid;
begin
  -- The same reviewed evidence never opens (or re-opens) an occurrence: the fingerprint is the occurrence.
  insert into public.catering_refund_issues (code, payment_id, location_id, request_id, refund_id, event_id,
                                             evidence_fingerprint, blocking, generation_at_open, detail)
    values (p_code, p_payment_id, p_location_id, p_request_id, p_refund_id, p_event_id, left(p_fingerprint, 300), p_blocking,
            p_generation, coalesce(p_detail, '{}'::jsonb))
  on conflict (payment_id, code, evidence_fingerprint) do update
    set last_seen_at = clock_timestamp(),
        -- Cleared by EVIDENCE and now back: the occurrence re-opens. Dispositioned by a PERSON: it stands, and the same
        -- reviewed evidence never pages staff again.
        state = case when catering_refund_issues.state = 'resolved' and catering_refund_issues.disposition = 'evidence_cleared' then 'open' else catering_refund_issues.state end,
        opened_at = case when catering_refund_issues.state = 'resolved' and catering_refund_issues.disposition = 'evidence_cleared' then clock_timestamp() else catering_refund_issues.opened_at end,
        aged_at = case when catering_refund_issues.state = 'resolved' and catering_refund_issues.disposition = 'evidence_cleared' then null else catering_refund_issues.aged_at end,
        disposition = case when catering_refund_issues.state = 'resolved' and catering_refund_issues.disposition = 'evidence_cleared' then null else catering_refund_issues.disposition end,
        disposition_at = case when catering_refund_issues.state = 'resolved' and catering_refund_issues.disposition = 'evidence_cleared' then null else catering_refund_issues.disposition_at end
  returning id into v_id;
  update public.catering_refund_payment_work w set oldest_unresolved_at = coalesce(w.oldest_unresolved_at, clock_timestamp())
   where w.payment_id = p_payment_id and exists (select 1 from public.catering_refund_issues i where i.id = v_id and i.state = 'open');
  return v_id;
end $$;

-- The work row of a settled Stripe payment (created on first need). false = not a Stripe payment with a PaymentIntent.
create function public.catering_refund_ensure_work(p_payment_id uuid, p_source text) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_pay record; v_shop uuid;
begin
  if exists (select 1 from public.catering_refund_payment_work w where w.payment_id = p_payment_id) then return true; end if;
  select p.id, p.quote_id, p.provider, p.provider_ref, p.status into v_pay from public.catering_payments p where p.id = p_payment_id;
  if not found or v_pay.provider is distinct from 'stripe' or coalesce(v_pay.provider_ref, '') !~ '^pi_[A-Za-z0-9_]{1,250}$'
     or v_pay.status not in ('paid', 'refunded') then
    return false;
  end if;
  select q.location_id into v_shop from public.catering_quotes q where q.id = v_pay.quote_id;
  if v_shop is null then return false; end if;
  insert into public.catering_refund_payment_work (payment_id, location_id, payment_intent_id, baseline_source)
    values (p_payment_id, v_shop, v_pay.provider_ref, p_source)
  on conflict (payment_id) do nothing;
  return true;
end $$;

-- Id hints for one payment (from a signed event, a create response, a list page, a retained snapshot or request).
-- A hint never carries provider status into the money: only an exact read does. It can carry VOID EVIDENCE TIME
-- (addendum A1): a signed event naming the refund failed / canceled dates that fact at the event's own `created` --
-- whether it arrived through live ingress or was imported by the recovery seed -- and a retained 0357 snapshot that
-- lists it void dates it at the snapshot's listing time (a database observation the app already holds).
-- A hint names a REQUEST only when it is our own create response or an existing binding: list or event metadata is
-- never a candidate before the exact read has verified it.
create function public.catering_refund_register_hints(p_payment_id uuid, p_location_id uuid, p_hints jsonb, p_source text,
  p_evidence_at timestamptz, p_generation bigint) returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  h jsonb;
  v_id text;
  v_owner uuid;
  v_req uuid;
  v_n integer := 0;
begin
  if p_hints is null or jsonb_typeof(p_hints) <> 'array' then return 0; end if;
  for h in select x from jsonb_array_elements(p_hints) x loop
    v_id := h->>'id';
    continue when v_id is null or v_id !~ '^[A-Za-z0-9_]{1,255}$';
    v_req := null;
    if coalesce(h->>'request', '') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      select r.id into v_req from public.catering_refund_requests r where r.id = (h->>'request')::uuid and r.payment_id = p_payment_id;
    end if;
    select i.payment_id into v_owner from public.catering_refund_identities i where i.refund_id = v_id for update;
    if not found then
      insert into public.catering_refund_identities (refund_id, payment_id, first_source, candidate_request_id, void_evidence_at)
        values (v_id, p_payment_id, p_source, case when p_source in ('create_response', 'request_binding') then v_req end,
                case when h->>'status' in ('failed', 'canceled') and p_source in ('event', 'recovery_seed', 'snapshot') then p_evidence_at end);
      v_n := v_n + 1;
    elsif v_owner <> p_payment_id then
      -- Another payment already owns this id: conflicting ownership holds THIS payment and moves nothing.
      perform public.catering_refund_raise_issue('wrong_charge', p_payment_id, p_location_id, null, v_id, null,
        'foreign:' || v_id, true, p_generation, jsonb_build_object('reason', 'owned_by_another_payment'));
    else
      update public.catering_refund_identities i
         set candidate_request_id = coalesce(i.candidate_request_id, case when p_source in ('create_response', 'request_binding') then v_req end),
             void_evidence_at = case when h->>'status' in ('failed', 'canceled') and p_source in ('event', 'recovery_seed', 'snapshot') and p_evidence_at is not null
                                     then least(coalesce(i.void_evidence_at, p_evidence_at), p_evidence_at) else i.void_evidence_at end,
             -- New evidence re-opens a quarantined hint.
             quarantined_at = case when p_source in ('event', 'create_response') then null else i.quarantined_at end,
             not_found_passes = case when p_source in ('event', 'create_response') and i.quarantined_at is not null then 0 else i.not_found_passes end
       where i.refund_id = v_id;
      if p_source in ('event', 'create_response') then
        update public.catering_refund_issues s set state = 'resolved', disposition = 'evidence_cleared', disposition_at = clock_timestamp()
         where s.payment_id = p_payment_id and s.code = 'quarantined_hint' and s.refund_id = v_id and s.state <> 'resolved';
      end if;
    end if;
  end loop;
  return v_n;
end $$;

-- Attach ONE event to its settled payment. THE CALLER HOLDS THE PAYMENT LOCK. Idempotent: an event already attached
-- keeps everything (its floor, its coverage, its disposition); a duplicate adds nothing.
create function public.catering_refund_attach_event(p_event_id text, p_payment_id uuid) returns text
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_ev record;
  v_w record;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_ev from public.catering_refund_event_work e where e.event_id = p_event_id for update;
  if not found then return 'missing'; end if;
  if v_ev.state in ('attached', 'quarantined') then return v_ev.state; end if;
  if not public.catering_refund_ensure_work(p_payment_id, case when v_ev.source = 'recovery_seed' then 'recovery' else 'ingress' end) then
    return 'unsettled';
  end if;
  select * into v_w from public.catering_refund_payment_work w where w.payment_id = p_payment_id for update;
  -- Wrong-shop (or wrong-mode) work cannot alter either shop's money: kept as quarantined evidence, nothing else.
  if (v_ev.endpoint_location_id is not null and v_ev.endpoint_location_id <> v_w.location_id) or v_ev.legacy_verdict = 'location_mismatch'
     or (v_w.livemode is not null and v_w.livemode <> v_ev.livemode) then
    update public.catering_refund_event_work e set payment_id = p_payment_id, state = 'quarantined', parked_at = null where e.event_id = p_event_id;
    return 'quarantined';
  end if;
  update public.catering_refund_event_work e
     set payment_id = p_payment_id, state = 'attached', parked_at = null,
         -- A LIVE cumulative is a floor from this instant; a historical seed creates none (plan B1.2 r5).
         floor_state = case when e.source = 'ingress' and e.event_type = 'charge.refunded' and coalesce(e.cumulative_cents, 0) > 0
                            then 'outstanding' else 'none' end,
         floor_cents = case when e.source = 'ingress' and e.event_type = 'charge.refunded' and coalesce(e.cumulative_cents, 0) > 0
                            then e.cumulative_cents end
   where e.event_id = p_event_id;
  perform public.catering_refund_register_hints(p_payment_id, v_w.location_id, v_ev.hints,
    case when v_ev.source = 'recovery_seed' then 'recovery_seed' else 'event' end, v_ev.provider_created_at, v_w.generation);
  -- 0333's charge history, once per event, exactly as main's webhook appends it (ingress only: a seed's row is main's own).
  if v_ev.source = 'ingress' and v_ev.event_type = 'charge.refunded' and v_ev.cumulative_cents is not null and not v_ev.history_appended then
    insert into public.catering_payment_refund_events (stripe_event_id, payment_id, refunded_at, cumulative_refunded_cents,
                                                       charge_amount_cents, refunded_at_approximate)
      values (p_event_id, p_payment_id, least(coalesce(v_ev.provider_created_at, v_now), v_now), v_ev.cumulative_cents,
              v_ev.charge_amount_cents, v_ev.provider_created_at is null)
    on conflict do nothing;
    update public.catering_refund_event_work e set history_appended = true where e.event_id = p_event_id;
  end if;
  update public.catering_refund_payment_work w
     set generation = w.generation + 1, next_due_at = v_now, retry_count = 0, updated_at = v_now,
         oldest_unresolved_at = coalesce(w.oldest_unresolved_at, v_now)
   where w.payment_id = p_payment_id;
  return 'attached';
end $$;

-- ── Install matrix and lifecycle (operator-only) ────────────────────────────────────────────────────────
-- The CURRENT install records must be exactly the release's expected matrix: a missing, duplicate, unexpected or
-- incompatible version refuses. Returns the accepted manifest.
create function public.catering_refund_install_check() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_expected jsonb := public.catering_refund_install_manifest();
  v_live jsonb;
  v_n integer;
begin
  select coalesce(jsonb_object_agg(c.part, c.version), '{}'::jsonb), count(*) into v_live, v_n
    from public.catering_refund_install_contracts c where c.superseded_at is null;
  if v_n <> 3 or v_live is distinct from v_expected then
    raise exception 'install_incomplete' using errcode = 'P0001', detail = v_live::text;
  end if;
  return v_live;
end $$;

create function public.catering_refund_epoch_audit(p_epoch uuid, p_transition text, p_operator text, p_destructive boolean, p_meta jsonb) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
    values (null, null, case when p_transition = 'break_glass_close' then 'catering.refund.break_glass' else 'catering.refund.epoch' end,
            'catering_refund_epochs', p_epoch,
            jsonb_build_object('actor_context', 'operator', 'operator', p_operator, 'transition', p_transition) || coalesce(p_meta, '{}'::jsonb),
            p_destructive);
end $$;

-- What recovery found, for CC to read and acknowledge before promotion. `counts` is what promote compares.
create function public.catering_refund_recovery_report() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_counts jsonb; v_gaps jsonb; v_shops jsonb;
begin
  select jsonb_build_object(
    'payments', (select count(*) from public.catering_refund_payment_work),
    'unbaselined', (select count(*) from public.catering_refund_payment_work w where w.baseline_at is null),
    'held_payments', (select count(distinct i.payment_id) from public.catering_refund_issues i where i.blocking and i.state in ('open', 'held')),
    'quarantined_events', (select count(*) from public.catering_refund_event_work e where e.state = 'quarantined'),
    'unmatched_payment_intents', (select count(distinct e.payment_intent_id) from public.catering_refund_event_work e where e.state in ('unmatched', 'no_payment')),
    'seeded_events', (select count(*) from public.catering_refund_event_work e where e.source = 'recovery_seed'),
    'prior_successes', (select count(*) from public.catering_refund_identities i where i.verified and i.class = 'returned'),
    'unarmed_reservations', (select count(*) from public.catering_refund_requests r where r.status = 'pending' and r.create_armed_at is null),
    'attempted_unbound', (select count(*) from public.catering_refund_requests r where r.status = 'pending' and r.first_attempt_at is not null and r.stripe_refund_id is null)
  ) into v_counts;
  -- Opus P3-c: a seeded payment whose historical cumulative is above its verified non-void sum (ON would show more
  -- available money than main's legacy contract did). Listed for CC; counted, so promote cannot pass it unseen.
  select coalesce(jsonb_agg(jsonb_build_object('payment_id', g.payment_id, 'location_id', g.location_id,
                                               'historical_cumulative_cents', g.cum, 'verified_cents', g.verified) order by g.payment_id), '[]'::jsonb)
    into v_gaps
    from (select w.payment_id, w.location_id,
                 (select max(e.cumulative_cents) from public.catering_refund_event_work e
                   where e.payment_id = w.payment_id and e.source = 'recovery_seed' and e.state = 'attached') as cum,
                 (select coalesce(sum(i.amount_cents), 0) from public.catering_refund_identities i
                   where i.payment_id = w.payment_id and i.verified and not i.wrong_charge and i.class <> 'void') as verified
            from public.catering_refund_payment_work w) g
   where g.cum is not null and g.cum > g.verified;
  select coalesce(jsonb_object_agg(s.location_id, s.c), '{}'::jsonb) into v_shops
    from (select w.location_id, jsonb_build_object('payments', count(*), 'unbaselined', count(*) filter (where w.baseline_at is null),
                                                   'oldest_work_at', min(w.oldest_unresolved_at)) as c
            from public.catering_refund_payment_work w group by w.location_id) s;
  return jsonb_build_object('counts', v_counts || jsonb_build_object('cumulative_gaps', jsonb_array_length(v_gaps)),
                            'cumulative_gaps', v_gaps, 'by_shop', v_shops,
                            'oldest_work_at', (select min(w.oldest_unresolved_at) from public.catering_refund_payment_work w));
end $$;

create function public.catering_refund_open_recovery(p_operator text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_manifest jsonb;
  v_id uuid;
  v_now timestamptz;
begin
  if p_operator is null or length(btrim(p_operator)) not between 1 and 80 then raise exception 'invalid_request' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(7359035900);
  v_now := clock_timestamp();
  v_manifest := public.catering_refund_install_check(); -- refuses BEFORE any epoch mutation
  if exists (select 1 from public.catering_refund_epochs e where e.state <> 'closed') then
    raise exception 'epoch_already_open' using errcode = 'P0001';
  end if;
  -- Re-enable: the prior stop seal is released under the same lifecycle lock that opens the fresh recovering epoch.
  update public.catering_refund_epochs e set seal_released_at = v_now where e.ingress_sealed_at is not null and e.seal_released_at is null;
  insert into public.catering_refund_epochs (state, manifest, opened_by, recovery_cutoff, opened_at)
    values ('recovering', v_manifest, btrim(p_operator), v_now, v_now) returning id into v_id;
  perform public.catering_refund_epoch_audit(v_id, 'open_recovery', btrim(p_operator), false, jsonb_build_object('manifest', v_manifest));
  return jsonb_build_object('epoch_id', v_id, 'state', 'recovering', 'generation', 1, 'recovery_cutoff', v_now, 'manifest', v_manifest);
end $$;

create function public.catering_refund_promote(p_epoch_id uuid, p_expected_generation bigint, p_ack jsonb, p_operator text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_manifest jsonb;
  v_ep record;
  v_report jsonb;
  v_now timestamptz;
begin
  if p_operator is null or length(btrim(p_operator)) not between 1 and 80 or p_epoch_id is null or p_expected_generation is null
     or p_ack is null or jsonb_typeof(p_ack) <> 'object' then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(7359035900);
  v_manifest := public.catering_refund_install_check(); -- checked again, independently of open_recovery
  select * into v_ep from public.catering_refund_epochs e where e.id = p_epoch_id for update;
  if not found or v_ep.state <> 'recovering' then raise exception 'epoch_not_recovering' using errcode = 'P0001'; end if;
  if v_ep.generation <> p_expected_generation then raise exception 'stale_generation' using errcode = 'P0001'; end if;
  if v_ep.manifest is distinct from v_manifest then raise exception 'install_incomplete' using errcode = 'P0001', detail = v_manifest::text; end if;
  if v_ep.recovery_complete_at is null then raise exception 'recovery_incomplete' using errcode = 'P0001'; end if;
  v_report := public.catering_refund_recovery_report();
  if (v_report->'counts') is distinct from p_ack then
    raise exception 'ack_mismatch' using errcode = 'P0001', detail = (v_report->'counts')::text;
  end if;
  v_now := clock_timestamp();
  update public.catering_refund_epochs e set state = 'live', promoted_at = v_now, promote_ack = p_ack, generation = e.generation + 1
   where e.id = p_epoch_id;
  perform public.catering_refund_epoch_audit(p_epoch_id, 'promote', btrim(p_operator), false, jsonb_build_object('ack', p_ack, 'manifest', v_manifest));
  return jsonb_build_object('epoch_id', p_epoch_id, 'state', 'live', 'generation', v_ep.generation + 1, 'promoted_at', v_now);
end $$;

create function public.catering_refund_start_drain(p_epoch_id uuid, p_expected_generation bigint, p_operator text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_ep record; v_now timestamptz;
begin
  if p_operator is null or length(btrim(p_operator)) not between 1 and 80 or p_epoch_id is null or p_expected_generation is null then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(7359035900);
  select * into v_ep from public.catering_refund_epochs e where e.id = p_epoch_id for update;
  if not found or v_ep.state not in ('recovering', 'live') then raise exception 'epoch_not_open' using errcode = 'P0001'; end if;
  if v_ep.generation <> p_expected_generation then raise exception 'stale_generation' using errcode = 'P0001'; end if;
  v_now := clock_timestamp();
  update public.catering_refund_epochs e set state = 'draining', draining_at = v_now, generation = e.generation + 1 where e.id = p_epoch_id;
  perform public.catering_refund_epoch_audit(p_epoch_id, 'start_drain', btrim(p_operator), false, jsonb_build_object('from', v_ep.state));
  return jsonb_build_object('epoch_id', p_epoch_id, 'state', 'draining', 'generation', v_ep.generation + 1, 'draining_at', v_now);
end $$;

-- What stands between a draining epoch and OFF (addendum A2). Every class is defined:
--   outstanding_events  accepted ingress that can still change a payment: attached and not applied, attached with an
--                       outstanding floor, or unmatched while a payment row now carries its PaymentIntent (attach owed).
--   admitted_senders    a live sender claim, or an arm younger than the route budget + margin (180 s): a create
--                       response may still add evidence.
--   out_of_scope        parked / unmatched / no_payment ingress whose PaymentIntent matches no catering_payments row.
--   pending_whole       a payment still `paid` whose verified reserved refunds cover its capture (listed, not blocking).
--   cleanup_open        post-reversal checkout cleanup still owed (listed, not blocking; Fable P3-5).
--   quarantined_events  wrong-shop / wrong-mode ingress: changed no money, never re-stamped (listed, not blocking).
--   An applied event on a payment under an open capture review is outstanding too (`capture_review`): its refund may
--   be whole while the stored status OFF readers use still says `paid`.
create function public.catering_refund_drain_report() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_out jsonb; v_send jsonb; v_scope jsonb; v_pending jsonb; v_cleanup jsonb; v_unconf jsonb; v_quar jsonb;
  v_now timestamptz := clock_timestamp();
begin
  select coalesce(jsonb_agg(jsonb_build_object('event_id', x.event_id, 'payment_id', x.payment_id, 'location_id', x.location_id, 'reason', x.reason)
                            order by x.event_id), '[]'::jsonb) into v_out
    from (select e.event_id, coalesce(e.payment_id, p.id) as payment_id, w.location_id,
                 case when e.state = 'unmatched' or e.state = 'no_payment' then 'attach_owed'
                      when e.applied_at is null then 'unapplied'
                      when e.floor_state = 'outstanding' then 'floor_outstanding' else 'capture_review' end as reason
            from public.catering_refund_event_work e
            left join public.catering_payments p on e.state in ('unmatched', 'no_payment') and p.provider = 'stripe' and p.provider_ref = e.payment_intent_id
                                                and p.status in ('paid', 'refunded')
            left join public.catering_refund_payment_work w on w.payment_id = coalesce(e.payment_id, p.id)
           where e.source = 'ingress' and e.restamped_at is null
             and ((e.state = 'attached' and (e.applied_at is null or e.floor_state = 'outstanding'
                     -- applied, yet the payment's status could not be published (capture review): a refund that may
                     -- already be whole is NOT visible to OFF readers, so the event is still owed.
                     or exists (select 1 from public.catering_refund_issues s where s.payment_id = e.payment_id
                                  and s.code = 'capture_review' and s.state in ('open', 'held'))))
               or (e.state in ('unmatched', 'no_payment') and p.id is not null))) x;
  select coalesce(jsonb_agg(jsonb_build_object('request_id', r.id, 'payment_id', r.payment_id, 'location_id', r.location_id,
           'reason', case when r.claimed_until is not null and r.claimed_until > v_now then 'live_claim' else 'recent_arm' end) order by r.id), '[]'::jsonb)
    into v_send
    from public.catering_refund_requests r
   where (r.claimed_until is not null and r.claimed_until > v_now)
      or (r.status = 'pending' and r.stripe_refund_id is null and r.create_armed_at is not null and r.create_armed_at > v_now - interval '180 seconds');
  select coalesce(jsonb_agg(jsonb_build_object('event_id', e.event_id, 'event_type', e.event_type, 'state', e.state) order by e.event_id), '[]'::jsonb)
    into v_scope
    from public.catering_refund_event_work e
   where e.source = 'ingress' and e.restamped_at is null and e.state in ('unmatched', 'no_payment')
     and not exists (select 1 from public.catering_payments p where p.provider = 'stripe' and p.provider_ref = e.payment_intent_id
                        and p.status in ('paid', 'refunded'));
  -- Quarantined (wrong-shop / wrong-mode) ingress: it changed no money and is never re-stamped; LISTED so nothing is unaccounted.
  select coalesce(jsonb_agg(jsonb_build_object('event_id', e.event_id, 'event_type', e.event_type, 'payment_id', e.payment_id) order by e.event_id), '[]'::jsonb)
    into v_quar
    from public.catering_refund_event_work e where e.source = 'ingress' and e.state = 'quarantined';
  select coalesce(jsonb_agg(jsonb_build_object('payment_id', w.payment_id, 'location_id', w.location_id, 'reserved_cents', w.reserved_cents,
                                               'captured_cents', w.captured_cents) order by w.payment_id), '[]'::jsonb)
    into v_pending
    from public.catering_refund_payment_work w join public.catering_payments p on p.id = w.payment_id
   where p.status = 'paid' and w.capture_known and w.captured_cents > 0 and w.reserved_cents + w.returned_cents >= w.captured_cents and w.reserved_cents > 0;
  select coalesce(jsonb_agg(jsonb_build_object('payment_id', w.payment_id, 'location_id', w.location_id) order by w.payment_id), '[]'::jsonb)
    into v_cleanup
    from public.catering_refund_payment_work w where w.checkout_cleanup_owed_at is not null and w.checkout_cleanup_done_at is null;
  select coalesce(jsonb_agg(jsonb_build_object('request_id', r.id, 'payment_id', r.payment_id, 'location_id', r.location_id) order by r.id), '[]'::jsonb)
    into v_unconf
    from public.catering_refund_requests r where r.status = 'pending' and r.stripe_refund_id is null and r.create_armed_at is not null;
  return jsonb_build_object(
    'outstanding_events', v_out, 'admitted_senders', v_send, 'out_of_scope', v_scope, 'pending_whole_refunds', v_pending,
    'cleanup_open', v_cleanup, 'unconfirmed_requests', v_unconf, 'quarantined_events', v_quar,
    'counts', jsonb_build_object(
      'accepted', (select count(*) from public.catering_refund_event_work e where e.source = 'ingress'),
      'applied', (select count(*) from public.catering_refund_event_work e where e.source = 'ingress' and e.state = 'attached'
                    and e.applied_at is not null and e.floor_state <> 'outstanding'),
      'quarantined', (select count(*) from public.catering_refund_event_work e where e.source = 'ingress' and e.state = 'quarantined'),
      'out_of_scope', jsonb_array_length(v_scope), 'still_owed', jsonb_array_length(v_out), 'admitted_senders', jsonb_array_length(v_send)));
end $$;

-- Hand an event-backed item to main's own OFF replay: its ledger verdict becomes main's `payment_not_found`
-- (lib/stripe/webhook.ts REFUND_NOT_APPLIED and the duplicate gate read exactly that). A verdict handoff, never a
-- money replay. Only a verdict this file's ingress stamped is replaced.
create function public.catering_refund_restamp_events(p_event_ids text[]) returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_n integer;
begin
  update public.stripe_events s set outcome = 'payment_not_found', processed_at = clock_timestamp()
   where s.id = any(coalesce(p_event_ids, array[]::text[])) and s.outcome = 'refund_state_owed';
  get diagnostics v_n = row_count;
  update public.catering_refund_event_work e set restamped_at = clock_timestamp()
   where e.event_id = any(coalesce(p_event_ids, array[]::text[])) and e.restamped_at is null;
  return v_n;
end $$;

create function public.catering_refund_finish_drain(p_epoch_id uuid, p_expected_generation bigint, p_operator text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_ep record;
  v_report jsonb;
  v_ids text[];
  v_now timestamptz;
  v_restamped integer;
begin
  if p_operator is null or length(btrim(p_operator)) not between 1 and 80 or p_epoch_id is null or p_expected_generation is null then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  -- The SAME lock ingress registration takes shared: an ingress that wins creates work this read then sees.
  perform pg_advisory_xact_lock(7359035900);
  select * into v_ep from public.catering_refund_epochs e where e.id = p_epoch_id for update;
  if not found or v_ep.state <> 'draining' then raise exception 'epoch_not_draining' using errcode = 'P0001'; end if;
  if v_ep.generation <> p_expected_generation then raise exception 'stale_generation' using errcode = 'P0001'; end if;
  v_report := public.catering_refund_drain_report();
  if jsonb_array_length(v_report->'outstanding_events') > 0 or jsonb_array_length(v_report->'admitted_senders') > 0 then
    -- A list alone cannot authorize OFF: the epoch stays draining, creates and mail stay closed.
    return jsonb_build_object('closed', false, 'epoch_id', p_epoch_id, 'state', 'draining', 'report', v_report);
  end if;
  -- THE SEAL. Every remaining parked / out-of-scope event goes to main's `payment_not_found` (addendum A2), then
  -- ingress is sealed and the epoch closed, in this one transaction.
  select array_agg(x->>'event_id') into v_ids from jsonb_array_elements(v_report->'out_of_scope') x;
  v_restamped := public.catering_refund_restamp_events(v_ids);
  v_now := clock_timestamp();
  v_report := v_report || jsonb_build_object('restamped', v_restamped, 'sealed_at', v_now);
  update public.catering_refund_epochs e
     set state = 'closed', closed_at = v_now, close_kind = 'drained', ingress_sealed_at = v_now, drain_report = v_report,
         generation = e.generation + 1
   where e.id = p_epoch_id;
  perform public.catering_refund_epoch_audit(p_epoch_id, 'finish_drain', btrim(p_operator), false, jsonb_build_object('counts', v_report->'counts', 'restamped', v_restamped));
  return jsonb_build_object('closed', true, 'epoch_id', p_epoch_id, 'state', 'closed', 'report', v_report);
end $$;

-- BREAK GLASS (addendum A3 ii): OFF with undrained work, ONLY on Juan's explicit recorded word. Records the full
-- undrained list and re-stamps every event-backed item per A2. Audited destructive.
create function public.catering_refund_break_glass_close(p_epoch_id uuid, p_expected_generation bigint, p_operator text, p_juan_word text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_ep record;
  v_report jsonb;
  v_ids text[];
  v_now timestamptz;
  v_restamped integer;
begin
  if p_operator is null or length(btrim(p_operator)) not between 1 and 80 or p_epoch_id is null or p_expected_generation is null
     or p_juan_word is null or p_juan_word !~ '^[A-Za-z0-9_.:/#-]{8,120}$' then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(7359035900);
  select * into v_ep from public.catering_refund_epochs e where e.id = p_epoch_id for update;
  if not found or v_ep.state <> 'draining' then raise exception 'epoch_not_draining' using errcode = 'P0001'; end if;
  if v_ep.generation <> p_expected_generation then raise exception 'stale_generation' using errcode = 'P0001'; end if;
  v_report := public.catering_refund_drain_report();
  select array_agg(x.id) into v_ids from (
    select y->>'event_id' as id from jsonb_array_elements(v_report->'outstanding_events') y
    union select y->>'event_id' from jsonb_array_elements(v_report->'out_of_scope') y) x;
  v_restamped := public.catering_refund_restamp_events(v_ids);
  v_now := clock_timestamp();
  v_report := v_report || jsonb_build_object('restamped', v_restamped, 'sealed_at', v_now, 'break_glass', true, 'juan_word_ref', p_juan_word);
  update public.catering_refund_epochs e
     set state = 'closed', closed_at = v_now, close_kind = 'break_glass', ingress_sealed_at = v_now, drain_report = v_report,
         generation = e.generation + 1
   where e.id = p_epoch_id;
  perform public.catering_refund_epoch_audit(p_epoch_id, 'break_glass_close', btrim(p_operator), true,
    jsonb_build_object('juan_word_ref', p_juan_word, 'undrained', jsonb_build_object('outstanding_events', v_report->'outstanding_events',
      'admitted_senders', v_report->'admitted_senders', 'out_of_scope', v_report->'out_of_scope',
      'pending_whole_refunds', v_report->'pending_whole_refunds', 'cleanup_open', v_report->'cleanup_open',
      'unconfirmed_requests', v_report->'unconfirmed_requests', 'quarantined_events', v_report->'quarantined_events'), 'restamped', v_restamped));
  return jsonb_build_object('closed', true, 'epoch_id', p_epoch_id, 'state', 'closed', 'break_glass', true, 'report', v_report);
end $$;

-- A3 (i): adopt a reviewed contract upgrade for the OPEN epoch (draining included). The later migration has already
-- superseded the part's install record (declaring which version it supersedes) and re-emitted the expected matrix.
create function public.catering_refund_adopt_contract_upgrade(p_epoch_id uuid, p_expected_generation bigint, p_operator text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_ep record;
  v_live jsonb;
  v_part text;
  v_changed integer := 0;
begin
  if p_operator is null or length(btrim(p_operator)) not between 1 and 80 or p_epoch_id is null or p_expected_generation is null then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(7359035900);
  select * into v_ep from public.catering_refund_epochs e where e.id = p_epoch_id for update;
  if not found or v_ep.state = 'closed' then raise exception 'epoch_not_open' using errcode = 'P0001'; end if;
  if v_ep.generation <> p_expected_generation then raise exception 'stale_generation' using errcode = 'P0001'; end if;
  v_live := public.catering_refund_install_check(); -- the records are exactly the (re-emitted) expected matrix
  foreach v_part in array array['B1', 'B2', 'B3'] loop
    if (v_live->>v_part) is distinct from (v_ep.manifest->>v_part) then
      -- Only a record that DECLARES it supersedes the version this epoch admitted is a reviewed upgrade.
      if not exists (select 1 from public.catering_refund_install_contracts c
                      where c.part = v_part and c.version = v_live->>v_part and c.superseded_at is null
                        and c.supersedes_version = v_ep.manifest->>v_part)
         or not exists (select 1 from public.catering_refund_install_contracts c
                         where c.part = v_part and c.version = v_ep.manifest->>v_part and c.superseded_at is not null) then
        raise exception 'upgrade_not_recorded' using errcode = 'P0001', detail = v_part;
      end if;
      v_changed := v_changed + 1;
    end if;
  end loop;
  if v_changed = 0 then raise exception 'nothing_to_adopt' using errcode = 'P0001'; end if;
  update public.catering_refund_epochs e set manifest = v_live, generation = e.generation + 1 where e.id = p_epoch_id;
  perform public.catering_refund_epoch_audit(p_epoch_id, 'adopt_contract_upgrade', btrim(p_operator), false,
    jsonb_build_object('before', v_ep.manifest, 'after', v_live, 'state', v_ep.state));
  return jsonb_build_object('epoch_id', p_epoch_id, 'state', v_ep.state, 'generation', v_ep.generation + 1, 'manifest', v_live);
end $$;

-- ── Reads (worker) ──────────────────────────────────────────────────────────────────────────────────────
-- Where admission stands, without taking the admission lock and without raising: routes and the cron branch on it.
create function public.catering_refund_epoch_state(p_caller text) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_ep record; v_b1 text; v_sealed boolean;
begin
  select c.version into v_b1 from public.catering_refund_install_contracts c where c.part = 'B1' and c.superseded_at is null;
  select e.id, e.state, e.generation, e.manifest, e.opened_at, e.promoted_at into v_ep from public.catering_refund_epochs e where e.state <> 'closed';
  if found then
    return jsonb_build_object('state', v_ep.state, 'epoch_id', v_ep.id, 'generation', v_ep.generation, 'opened_at', v_ep.opened_at,
                              'promoted_at', v_ep.promoted_at, 'caller_ok', p_caller is not null and p_caller = (v_ep.manifest->>'B1'));
  end if;
  select (e.ingress_sealed_at is not null and e.seal_released_at is null) into v_sealed from public.catering_refund_epochs e order by e.seq desc limit 1;
  return jsonb_build_object('state', case when coalesce(v_sealed, false) then 'sealed' else 'none' end, 'epoch_id', null,
                            'caller_ok', p_caller is not null and v_b1 is not null and p_caller = v_b1);
end $$;

-- THE ON FIGURES CONTRACT (the TS twin is effectiveRefundFigures, lib/catering/refund-outcomes-shared.ts).
--   verified  = a complete pass has published this payment: money comes from verified identities by CURRENT class.
--               Otherwise (never baselined) 0357's legacy evidence is the provider deduction's lower bound.
--   deduction = greatest(returned + reserved by the provider, the LARGEST OUTSTANDING FLOOR) -- also against a newer
--               snapshot: a floor is honoured until it is explained or dispositioned.
--   reservations = our own requests not already counted through a verified bound identity (pending, and accepted
--               ones whose refund is not verified yet): the independent unbound reservation is kept.
--   available = captured - deduction - reservations, never below 0; 0 unless eligible (0357's rule).
--   held      = a blocking issue is open or held on the payment, or a signed refund event for its PaymentIntent is
--               still waiting for settlement to attach it (admission is refused; the figure is still shown).
create function public.catering_refund_effective_figures(p_payment_id uuid, p_exclude_request uuid,
  out o_captured bigint, out o_returned bigint, out o_reserved bigint, out o_floor bigint, out o_deduction bigint,
  out o_reservations bigint, out o_available bigint, out o_eligible boolean, out o_held boolean, out o_verified boolean)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_pay record;
  v_w record;
  v_snap record;
  v_charge bigint;
  v_cum bigint;
  v_listed bigint := 0;
begin
  o_captured := 0; o_returned := 0; o_reserved := 0; o_floor := 0; o_deduction := 0; o_reservations := 0; o_available := 0;
  o_eligible := false; o_held := false; o_verified := false;
  select p.amount_cents, p.status, p.provider, p.provider_ref into v_pay from public.catering_payments p where p.id = p_payment_id;
  if not found then return; end if;
  select * into v_w from public.catering_refund_payment_work w where w.payment_id = p_payment_id;
  select max(e.charge_amount_cents), max(e.cumulative_refunded_cents) into v_charge, v_cum
    from public.catering_payment_refund_events e where e.payment_id = p_payment_id;
  select s.listed_at, s.captured_cents, s.refunds into v_snap from public.catering_refund_stripe_snapshots s where s.payment_id = p_payment_id;
  o_verified := v_w.last_complete_pass_at is not null;
  if o_verified then
    o_captured := coalesce(case when v_w.capture_known then v_w.captured_cents end, v_charge, v_pay.amount_cents::bigint);
    select coalesce(sum(i.amount_cents) filter (where i.class = 'returned'), 0), coalesce(sum(i.amount_cents) filter (where i.class = 'reserved'), 0)
      into o_returned, o_reserved
      from public.catering_refund_identities i where i.payment_id = p_payment_id and i.verified and not i.wrong_charge;
  else
    o_captured := coalesce(v_snap.captured_cents, v_charge, v_pay.amount_cents::bigint);
    if v_snap.listed_at is not null then
      select coalesce(sum((x->>'amount')::bigint) filter (where coalesce(x->>'status', '') not in ('failed', 'canceled')), 0)
        into v_listed from jsonb_array_elements(v_snap.refunds) x;
    end if;
    o_returned := greatest(coalesce(v_cum, 0), v_listed, case when v_pay.status = 'refunded' then o_captured else 0 end);
  end if;
  select coalesce(max(e.floor_cents), 0) into o_floor
    from public.catering_refund_event_work e where e.payment_id = p_payment_id and e.floor_state = 'outstanding';
  o_deduction := greatest(o_returned + o_reserved, o_floor);
  select coalesce(sum(r.amount_cents), 0) into o_reservations
    from public.catering_refund_requests r
   where r.payment_id = p_payment_id and r.id is distinct from p_exclude_request and r.status in ('pending', 'submitted', 'succeeded')
     and not exists (select 1 from public.catering_refund_identities i where i.request_id = r.id and i.verified and not i.wrong_charge)
     and not (not o_verified and v_snap.listed_at is not null and r.stripe_refund_id is not null and exists (
                select 1 from jsonb_array_elements(v_snap.refunds) x where x->>'id' = r.stripe_refund_id));
  o_held := (v_w.restricted_at is not null) or exists (
    select 1 from public.catering_refund_issues i where i.payment_id = p_payment_id and i.blocking and i.state in ('open', 'held'))
    -- A refund event seen FIRST for this PaymentIntent that settlement has not attached yet: no admission before it is.
    or exists (select 1 from public.catering_refund_event_work e
                where e.payment_intent_id = v_pay.provider_ref and e.source = 'ingress' and e.state in ('unmatched', 'no_payment')
                  and e.restamped_at is null);
  o_eligible := v_pay.status in ('paid', 'refunded') and v_pay.provider = 'stripe' and coalesce(v_pay.provider_ref, '') ~ '^pi_[A-Za-z0-9_]+$';
  o_available := case when o_eligible then greatest(0, o_captured - o_deduction - o_reservations) else 0 end;
end $$;

-- THE STORED SUMMARY for a batch of quotes (the panel GET, both post-mutation reloads and the pipeline banner).
-- ONE call for the whole batch, whatever the number of quotes in it. Reads only: no provider call, no enqueue, no apply.
create function public.catering_refund_summary(p_caller text, p_quote_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_state jsonb := public.catering_refund_epoch_state(p_caller);
  v_out jsonb := '[]'::jsonb;
  v_q record;
  v_pays jsonb;
  v_reqs jsonb;
  v_issues jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_quote_ids is null or cardinality(p_quote_ids) > 60 then raise exception 'invalid_request' using errcode = 'P0001'; end if;
  for v_q in
    select q.id, q.location_id, coalesce(q.root_id, q.id) as root from public.catering_quotes q where q.id = any(p_quote_ids) order by q.id
  loop
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', p.id, 'kind', p.kind, 'status', p.status, 'provider', p.provider, 'amount_cents', p.amount_cents, 'paid_at', p.paid_at,
             'captured_cents', f.o_captured, 'returned_cents', f.o_returned, 'reserved_cents', f.o_reserved, 'floor_cents', f.o_floor,
             'deduction_cents', f.o_deduction, 'reservations_cents', f.o_reservations, 'available_cents', f.o_available,
             'eligible', f.o_eligible, 'held', f.o_held, 'verified', f.o_verified,
             'last_verified_at', w.last_complete_pass_at, 'baseline_at', w.baseline_at, 'restricted', w.restricted_at is not null,
             'cleanup_owed', w.checkout_cleanup_owed_at is not null and w.checkout_cleanup_done_at is null,
             'cleanup_report', w.checkout_cleanup_report) order by p.created_at, p.id), '[]'::jsonb)
      into v_pays
      from public.catering_payments p
      join public.catering_quotes fq on fq.id = p.quote_id and coalesce(fq.root_id, fq.id) = v_q.root
      left join public.catering_refund_payment_work w on w.payment_id = p.id
      cross join lateral public.catering_refund_effective_figures(p.id, null) f;
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', r.id, 'payment_id', r.payment_id, 'amount_cents', r.amount_cents, 'status', r.status, 'reason_code', r.reason_code,
             'reason_note', r.reason_note, 'trigger_kind', r.trigger_kind, 'stripe_status', r.stripe_status,
             'last_error_code', r.last_error_code, 'attempts', r.attempts, 'first_attempt_at', r.first_attempt_at,
             'requested_at', r.requested_at, 'requested_by', r.requested_by, 'armed', r.create_armed_at is not null,
             'legacy_possibly_sent', r.legacy_possibly_sent,
             'bound', r.stripe_refund_id is not null or exists (select 1 from public.catering_refund_identities i where i.request_id = r.id),
             'binding_hold', r.binding_hold, 'first_reversed_at', r.first_reversed_at,
             'claim_live', r.claimed_until is not null and r.claimed_until > v_now) order by r.requested_at desc, r.id), '[]'::jsonb)
      into v_reqs
      from public.catering_refund_requests r
      join public.catering_payments p on p.id = r.payment_id
      join public.catering_quotes fq on fq.id = p.quote_id and coalesce(fq.root_id, fq.id) = v_q.root;
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', i.id, 'code', i.code, 'state', i.state, 'blocking', i.blocking, 'payment_id', i.payment_id, 'request_id', i.request_id,
             'refund_id', i.refund_id, 'event_id', i.event_id, 'opened_at', i.opened_at, 'aged', i.aged_at is not null,
             'disposition', i.disposition, 'detail', i.detail,
             'generation', (select w.generation from public.catering_refund_payment_work w where w.payment_id = i.payment_id))
             order by i.opened_at, i.id), '[]'::jsonb)
      into v_issues
      from public.catering_refund_issues i
      join public.catering_payments p on p.id = i.payment_id
      join public.catering_quotes fq on fq.id = p.quote_id and coalesce(fq.root_id, fq.id) = v_q.root
     where i.state <> 'resolved';
    v_out := v_out || jsonb_build_object('quote_id', v_q.id, 'location_id', v_q.location_id, 'payments', v_pays, 'requests', v_reqs, 'issues', v_issues);
  end loop;
  return jsonb_build_object('epoch', v_state, 'quotes', v_out);
end $$;

-- ── Staff entry points (worker; create admission = a LIVE epoch) ────────────────────────────────────────
-- THE CONFIRM TAP. 0357's reserve re-emitted under a new, epoch-, caller-, actor- and session-aware signature (no
-- defaults; the historical function keeps its definition and loses its grant). Same validations, same token replay,
-- same locked multi-payment allocation, same destructive audit row. What changed: live admission is re-checked here
-- under the admission lock, the actor must be the session's user, every figure is the ON contract's
-- (catering_refund_effective_figures: floors honoured), and a payment under a blocking hold gives nothing.
create function public.catering_refund_reserve_admitted(p_caller text, p_actor_id uuid, p_session_id uuid, p_quote_id uuid,
  p_client_token uuid, p_amount_cents bigint, p_reason_code text, p_reason_note text, p_trigger text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_adm record;
  v_shop uuid;
  v_root uuid;
  v_role text;
  v_note text := nullif(btrim(coalesce(p_reason_note, '')), '');
  v_ids uuid[];
  v_existing jsonb;
  v_existing_total bigint;
  v_existing_bad boolean;
  v_total bigint := 0;
  v_held_total bigint := 0;
  v_want bigint;
  v_left bigint;
  v_take bigint;
  v_row record;
  v_fig record;
  v_out jsonb := '[]'::jsonb;
  v_new uuid;
begin
  if p_actor_id is null or p_session_id is null or p_quote_id is null or p_client_token is null then
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

  select * into v_adm from public.catering_refund_admit(p_caller, 'create');
  if public.catering_refund_session_user(p_session_id) is distinct from p_actor_id then raise exception 'forbidden' using errcode = 'P0001'; end if;

  select q.location_id, coalesce(q.root_id, q.id) into v_shop, v_root from public.catering_quotes q where q.id = p_quote_id;
  if v_shop is null then raise exception 'quote_not_found' using errcode = 'P0001'; end if;
  if not public.catering_refund_actor_ok(p_actor_id, v_shop) then raise exception 'forbidden' using errcode = 'P0001'; end if;
  select u.role into v_role from public.users u where u.id = p_actor_id;

  -- (1) THE LOCKS: every payment row of the order (the whole quote family), in id order.
  select array_agg(p.id order by p.id) into v_ids
    from public.catering_payments p join public.catering_quotes q on q.id = p.quote_id
   where coalesce(q.root_id, q.id) = v_root;
  if v_ids is not null then
    perform 1 from public.catering_payments p where p.id = any(v_ids) order by p.id for no key update;
  end if;

  -- (2) A token already used: the same tap. Return what it made, or refuse a different ask under the same token.
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'payment_id', r.payment_id, 'amount_cents', r.amount_cents,
                                               'status', r.status) order by r.requested_at, r.id), '[]'::jsonb),
         coalesce(sum(r.amount_cents), 0),
         coalesce(bool_or(not (r.payment_id = any(coalesce(v_ids, array[]::uuid[])))), false)
    into v_existing, v_existing_total, v_existing_bad
    from public.catering_refund_requests r where r.client_token = p_client_token;
  if jsonb_array_length(v_existing) > 0 then
    if v_existing_bad or p_amount_cents <> v_existing_total then
      raise exception 'token_reused' using errcode = 'P0001';
    end if;
    return jsonb_build_object('replay', true, 'location_id', v_shop, 'requests', v_existing);
  end if;

  -- (3) What is refundable now, under the locks: the ON contract, per payment; a held payment gives nothing.
  for v_row in
    select p.id from public.catering_payments p where p.id = any(coalesce(v_ids, array[]::uuid[]))
  loop
    select * into v_fig from public.catering_refund_effective_figures(v_row.id, null);
    if v_fig.o_held then v_held_total := v_held_total + v_fig.o_available;
    else v_total := v_total + v_fig.o_available; end if;
  end loop;
  v_want := p_amount_cents;
  if v_total <= 0 then
    if v_held_total > 0 then raise exception 'payment_held' using errcode = 'P0001'; end if;
    raise exception 'nothing_refundable' using errcode = 'P0001';
  end if;
  if v_want > v_total then
    if v_want <= v_total + v_held_total then raise exception 'payment_held' using errcode = 'P0001', detail = v_total::text; end if;
    raise exception 'over_refundable' using errcode = 'P0001', detail = v_total::text;
  end if;

  -- (4) Allocate: the balance first, then a full payment, then the deposit; newest first within a kind.
  v_left := v_want;
  for v_row in
    select p.id, p.kind, p.paid_at from public.catering_payments p where p.id = any(v_ids)
     order by case p.kind when 'balance' then 1 when 'full' then 2 else 3 end, p.paid_at desc nulls last, p.id
  loop
    exit when v_left <= 0;
    select * into v_fig from public.catering_refund_effective_figures(v_row.id, null);
    continue when v_fig.o_held or v_fig.o_available <= 0;
    v_take := least(v_left, v_fig.o_available);
    perform public.catering_refund_ensure_work(v_row.id, 'staff');
    insert into public.catering_refund_requests (payment_id, quote_id, location_id, client_token, amount_cents,
                                                  reason_code, reason_note, trigger_kind, requested_by)
      values (v_row.id, p_quote_id, v_shop, p_client_token, v_take, p_reason_code, v_note, p_trigger, p_actor_id)
      returning id into v_new;
    insert into public.audit_log(actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
      values (p_actor_id, v_role, 'catering.refund.request', 'catering_refund_requests', v_new,
              jsonb_build_object('quote_id', p_quote_id, 'payment_id', v_row.id, 'location_id', v_shop,
                                 'amount_cents', v_take, 'requested_total_cents', v_want, 'refundable_before_cents', v_total,
                                 'reason_code', p_reason_code, 'trigger', p_trigger, 'has_note', v_note is not null,
                                 'full', p_amount_cents = v_total, 'epoch_id', v_adm.o_epoch), true);
    v_out := v_out || jsonb_build_object('id', v_new, 'payment_id', v_row.id, 'amount_cents', v_take, 'status', 'pending');
    v_left := v_left - v_take;
  end loop;
  if v_left <> 0 then raise exception 'over_refundable' using errcode = 'P0001', detail = v_total::text; end if;
  return jsonb_build_object('replay', false, 'location_id', v_shop, 'requests', v_out);
end $$;

-- THE SENDER CLAIM (0357's claim under the new signature): an exclusive, expiring 3-minute claim on a PENDING row,
-- for a re-authorized actor in a live epoch. A submitted row needs status retrieval only (a pass), never a claim.
create function public.catering_refund_claim_admitted(p_caller text, p_actor_id uuid, p_session_id uuid, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_adm record;
  v_pay uuid;
  v_r record;
  v_w record;
  v_now timestamptz;
begin
  if p_actor_id is null or p_session_id is null or p_request_id is null then raise exception 'invalid_request' using errcode = 'P0001'; end if;
  select * into v_adm from public.catering_refund_admit(p_caller, 'create');
  if public.catering_refund_session_user(p_session_id) is distinct from p_actor_id then raise exception 'forbidden' using errcode = 'P0001'; end if;
  select r.payment_id into v_pay from public.catering_refund_requests r where r.id = p_request_id;
  if v_pay is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  perform 1 from public.catering_payments p where p.id = v_pay for no key update;
  perform public.catering_refund_ensure_work(v_pay, 'staff');
  select * into v_w from public.catering_refund_payment_work w where w.payment_id = v_pay for update;
  select * into v_r from public.catering_refund_requests r where r.id = p_request_id for update;
  if not public.catering_refund_actor_ok(p_actor_id, v_r.location_id) then raise exception 'forbidden' using errcode = 'P0001'; end if;
  v_now := clock_timestamp();
  if v_r.status <> 'pending' then return jsonb_build_object('claimed', false, 'reason', 'not_pending', 'status', v_r.status); end if;
  if v_r.claimed_until is not null and v_r.claimed_until > v_now then return jsonb_build_object('claimed', false, 'reason', 'in_progress', 'status', v_r.status); end if;
  if v_r.binding_hold is not null then return jsonb_build_object('claimed', false, 'reason', 'payment_held', 'status', v_r.status); end if;
  update public.catering_refund_requests r
     set claim_token = gen_random_uuid(), claimed_until = v_now + interval '3 minutes', attempts = r.attempts + 1,
         first_attempt_at = coalesce(r.first_attempt_at, v_now), updated_at = v_now
   where r.id = p_request_id
  returning * into v_r;
  return jsonb_build_object('claimed', true, 'claim_token', v_r.claim_token, 'claimed_until', v_r.claimed_until, 'attempts', v_r.attempts,
                            'first_attempt_at', v_r.first_attempt_at, 'status', v_r.status, 'payment_id', v_r.payment_id,
                            'armed_before', v_r.create_armed_at is not null or v_r.legacy_possibly_sent,
                            'create_armed_at', v_r.create_armed_at, 'generation', v_w.generation);
end $$;

-- THE ARM: the last database step before network I/O. claim -> complete discovery and financial check -> COMMIT ARM
-- -> POST. create_armed_at is the write-once evidence that a POST may have left. Everything is re-checked under the
-- locks: the epoch, the actor and shop, the request, the claim token and its expiry, the immutable PaymentIntent,
-- the charge, the mode, the amount against the ON figures, the generation (a COMPLETE pass at the current
-- generation), the holds, and the remaining 24-hour window with the one-minute resend margin.
create function public.catering_refund_arm(p_caller text, p_actor_id uuid, p_session_id uuid, p_request_id uuid, p_claim_token uuid,
  p_expected_generation bigint, p_payment_intent text, p_charge text, p_livemode boolean) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_adm record;
  v_pay record;
  v_payment uuid;
  v_r record;
  v_w record;
  v_fig record;
  v_now timestamptz;
begin
  if p_actor_id is null or p_session_id is null or p_request_id is null or p_claim_token is null or p_expected_generation is null
     or p_payment_intent is null or p_charge is null or p_livemode is null then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  select * into v_adm from public.catering_refund_admit(p_caller, 'create');
  if public.catering_refund_session_user(p_session_id) is distinct from p_actor_id then raise exception 'forbidden' using errcode = 'P0001'; end if;
  select r.payment_id into v_payment from public.catering_refund_requests r where r.id = p_request_id;
  if v_payment is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  select p.id, p.status, p.provider, p.provider_ref into v_pay from public.catering_payments p where p.id = v_payment for no key update;
  select * into v_w from public.catering_refund_payment_work w where w.payment_id = v_payment for update;
  select * into v_r from public.catering_refund_requests r where r.id = p_request_id for update;
  if not public.catering_refund_actor_ok(p_actor_id, v_r.location_id) then raise exception 'forbidden' using errcode = 'P0001'; end if;
  v_now := clock_timestamp();
  if v_r.status <> 'pending' then return jsonb_build_object('result', 'not_pending', 'status', v_r.status); end if;
  if v_r.claim_token is distinct from p_claim_token or v_r.claimed_until is null or v_r.claimed_until <= v_now + interval '5 seconds' then
    return jsonb_build_object('result', 'claim_lost');
  end if;
  if v_w.payment_id is null or v_w.generation <> p_expected_generation or v_w.last_complete_generation is distinct from v_w.generation then
    return jsonb_build_object('result', 'stale_generation', 'generation', v_w.generation);
  end if;
  if v_pay.provider is distinct from 'stripe' or v_pay.provider_ref is distinct from p_payment_intent
     or v_w.payment_intent_id <> p_payment_intent or (v_r.arm_payment_intent is not null and v_r.arm_payment_intent <> p_payment_intent)
     or v_w.charge_id is null or v_w.charge_id <> p_charge or v_w.livemode is distinct from p_livemode then
    return jsonb_build_object('result', 'wrong_charge');
  end if;
  -- A refund already known for this request (bound, or a candidate from metadata / a create response): adopt, never send.
  if v_r.stripe_refund_id is not null or exists (select 1 from public.catering_refund_identities i
       where i.payment_id = v_payment and (i.request_id = v_r.id or i.candidate_request_id = v_r.id) and i.excluded_at is null) then
    return jsonb_build_object('result', 'already_exists');
  end if;
  if v_r.binding_hold is not null then return jsonb_build_object('result', 'payment_held'); end if;
  select * into v_fig from public.catering_refund_effective_figures(v_payment, v_r.id);
  if v_fig.o_held then return jsonb_build_object('result', 'payment_held'); end if;
  if not v_fig.o_eligible or v_fig.o_captured - v_fig.o_deduction - v_fig.o_reservations < v_r.amount_cents then
    return jsonb_build_object('result', 'over_refundable', 'available_cents', greatest(0, v_fig.o_captured - v_fig.o_deduction - v_fig.o_reservations));
  end if;
  -- The conservative 24-hour clock is first_attempt_at; a re-send (armed before) keeps the one-minute margin, and so
  -- does a first send: after the deadline only GETs are performed.
  if v_r.first_attempt_at is null or v_now - v_r.first_attempt_at + interval '60 seconds' > interval '24 hours' then
    return jsonb_build_object('result', 'window_closed');
  end if;
  update public.catering_refund_requests r
     set create_armed_at = coalesce(r.create_armed_at, v_now), arm_epoch_id = coalesce(r.arm_epoch_id, v_adm.o_epoch),
         arm_payment_intent = coalesce(r.arm_payment_intent, p_payment_intent), arm_count = r.arm_count + 1, updated_at = v_now
   where r.id = p_request_id
  returning * into v_r;
  update public.catering_refund_issues s set state = 'resolved', disposition = 'evidence_cleared', disposition_at = v_now
   where s.request_id = p_request_id and s.code = 'reserved_not_sent' and s.state <> 'resolved';
  -- A POST may leave now. If this process dies before `finish`, the sweep must look within minutes, not at the
  -- healthy poll the pass before the arm scheduled.
  update public.catering_refund_payment_work w set next_due_at = least(w.next_due_at, v_now + interval '5 minutes'), updated_at = v_now
   where w.payment_id = v_payment;
  return jsonb_build_object('result', 'armed', 'armed_before', v_r.arm_count > 1 or v_r.legacy_possibly_sent, 'create_armed_at', v_r.create_armed_at,
                            'first_attempt_at', v_r.first_attempt_at, 'deadline', v_r.first_attempt_at + interval '24 hours',
                            'claimed_until', v_r.claimed_until, 'amount_cents', v_r.amount_cents, 'reason_code', v_r.reason_code,
                            'quote_id', v_r.quote_id, 'payment_id', v_r.payment_id);
end $$;

-- THE FINISH: what the sender learned, written under the claim it holds.
--   created            a refund id came back: DURABLE EVIDENCE EVEN IF THE CLAIM EXPIRED. It is registered as a hint
--                      bound for this request; the financial apply (after an exact retrieve) decides the outcome.
--   refused_unexecuted a FIRST, positively identified, unexecuted refusal: the request closes and its amount is
--                      released -- only when this was the row's first possible POST and nothing names a refund for it.
--   local_refusal      our own stop before any arm: closes only a row that was never armed.
--   uncertain          timeout, generic 4xx, conflict, unclassified, or a refusal after an uncertain POST: the row
--                      stays pending and reserved; an empty list never disarms it.
--   not_sent           the claim is released, nothing else.
create function public.catering_refund_finish(p_caller text, p_request_id uuid, p_claim_token uuid, p_outcome text,
  p_refund_id text, p_error_code text, p_error_message text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_adm record;
  v_payment uuid;
  v_r record;
  v_w record;
  v_now timestamptz;
  v_holds boolean;
  v_named boolean;
begin
  if p_request_id is null or p_outcome is null or p_outcome not in ('created', 'refused_unexecuted', 'local_refusal', 'uncertain', 'not_sent') then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  if p_outcome = 'created' and (p_refund_id is null or p_refund_id !~ '^[A-Za-z0-9_]{1,255}$') then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  select * into v_adm from public.catering_refund_admit(p_caller, 'evidence');
  select r.payment_id into v_payment from public.catering_refund_requests r where r.id = p_request_id;
  if v_payment is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  perform 1 from public.catering_payments p where p.id = v_payment for no key update;
  perform public.catering_refund_ensure_work(v_payment, 'staff');
  select * into v_w from public.catering_refund_payment_work w where w.payment_id = v_payment for update;
  select * into v_r from public.catering_refund_requests r where r.id = p_request_id for update;
  v_now := clock_timestamp();
  v_holds := p_claim_token is not null and v_r.claim_token is not distinct from p_claim_token;
  v_named := v_r.stripe_refund_id is not null or exists (select 1 from public.catering_refund_identities i
       where i.payment_id = v_payment and (i.request_id = v_r.id or i.candidate_request_id = v_r.id) and i.excluded_at is null);

  if p_outcome = 'created' then
    perform public.catering_refund_register_hints(v_payment, v_w.location_id,
      jsonb_build_array(jsonb_build_object('id', p_refund_id, 'request', v_r.id)), 'create_response', null, v_w.generation);
    update public.catering_refund_payment_work w set generation = w.generation + 1, next_due_at = v_now, retry_count = 0, updated_at = v_now
     where w.payment_id = v_payment;
    if v_holds then
      update public.catering_refund_requests r set claim_token = null, claimed_until = null, last_error_code = null, last_error_message = null, updated_at = v_now
       where r.id = p_request_id and r.status = 'pending';
    end if;
    return jsonb_build_object('result', 'registered', 'claim_held', v_holds, 'generation', v_w.generation + 1);
  end if;

  if not v_holds then return jsonb_build_object('result', 'claim_lost'); end if;

  if (p_outcome = 'refused_unexecuted' and v_r.status = 'pending' and v_r.arm_count = 1 and not v_r.legacy_possibly_sent and not v_named)
     or (p_outcome = 'local_refusal' and v_r.status = 'pending' and v_r.create_armed_at is null and not v_r.legacy_possibly_sent and not v_named) then
    update public.catering_refund_requests r
       set status = 'failed', last_error_code = left(coalesce(p_error_code, p_outcome), 80), last_error_message = left(p_error_message, 500),
           claim_token = null, claimed_until = null, settled_at = v_now, updated_at = v_now
     where r.id = p_request_id;
    update public.catering_refund_payment_work w set generation = w.generation + 1, updated_at = v_now where w.payment_id = v_payment;
    return jsonb_build_object('result', 'closed', 'status', 'failed');
  end if;

  update public.catering_refund_requests r
     set claim_token = null, claimed_until = null, updated_at = v_now,
         last_error_code = case when p_outcome = 'not_sent' then r.last_error_code else left(coalesce(p_error_code, p_outcome), 80) end,
         last_error_message = case when p_outcome = 'not_sent' then r.last_error_message else left(p_error_message, 500) end
   where r.id = p_request_id and r.status = 'pending';
  if p_outcome <> 'not_sent' and (v_r.create_armed_at is not null or v_r.legacy_possibly_sent) then
    -- A create that may have landed is looked for again within the minute.
    update public.catering_refund_payment_work w set next_due_at = least(w.next_due_at, v_now + interval '1 minute'), updated_at = v_now
     where w.payment_id = v_payment;
  end if;
  return jsonb_build_object('result', 'kept_pending', 'status', v_r.status);
end $$;

-- ORDINARY RELEASE (Juan's approved path, unchanged in authority: the refund role set, shop-gated, no password):
-- after the ORIGINAL 24-hour window, with staff verification of the owning charge in Stripe, a fresh complete
-- discovery at the current generation, no matching refund, no live sender, no unresolved evidence, no binding hold.
-- Fenced on the same generation. The released request stays watched: a late matching refund raises
-- released_request_has_refund in the apply.
create function public.catering_refund_release(p_caller text, p_actor_id uuid, p_session_id uuid, p_request_id uuid,
  p_expected_generation bigint, p_staff_verified boolean) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_adm record;
  v_payment uuid;
  v_r record;
  v_w record;
  v_fig record;
  v_now timestamptz;
begin
  if p_actor_id is null or p_session_id is null or p_request_id is null or p_expected_generation is null then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  select * into v_adm from public.catering_refund_admit(p_caller, 'work');
  if public.catering_refund_session_user(p_session_id) is distinct from p_actor_id then raise exception 'forbidden' using errcode = 'P0001'; end if;
  select r.payment_id into v_payment from public.catering_refund_requests r where r.id = p_request_id;
  if v_payment is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  perform 1 from public.catering_payments p where p.id = v_payment for no key update;
  select * into v_w from public.catering_refund_payment_work w where w.payment_id = v_payment for update;
  select * into v_r from public.catering_refund_requests r where r.id = p_request_id for update;
  if not public.catering_refund_actor_ok(p_actor_id, v_r.location_id) then raise exception 'forbidden' using errcode = 'P0001'; end if;
  v_now := clock_timestamp();
  if v_r.status <> 'pending' or v_now - coalesce(v_r.first_attempt_at, v_r.requested_at) <= interval '24 hours' then
    return jsonb_build_object('result', 'not_releasable');
  end if;
  if p_staff_verified is not true then return jsonb_build_object('result', 'staff_verification_required'); end if;
  if v_w.payment_id is null or v_w.generation <> p_expected_generation or v_w.last_complete_generation is distinct from v_w.generation
     or v_w.last_complete_pass_at is null or v_w.last_complete_pass_at < v_now - interval '10 minutes' then
    return jsonb_build_object('result', 'stale_generation', 'generation', v_w.generation);
  end if;
  if v_r.claimed_until is not null and v_r.claimed_until > v_now then return jsonb_build_object('result', 'in_progress'); end if;
  if v_r.stripe_refund_id is not null or exists (select 1 from public.catering_refund_identities i
       where i.payment_id = v_payment and (i.request_id = v_r.id or i.candidate_request_id = v_r.id) and i.excluded_at is null) then
    return jsonb_build_object('result', 'has_refund');
  end if;
  select * into v_fig from public.catering_refund_effective_figures(v_payment, null);
  if v_r.binding_hold is not null or v_fig.o_held or v_fig.o_floor > 0
     or exists (select 1 from public.catering_refund_identities i where i.payment_id = v_payment and not i.verified
                   and i.excluded_at is null and i.quarantined_at is null) then
    return jsonb_build_object('result', 'payment_held');
  end if;
  update public.catering_refund_requests r
     set status = 'failed', last_error_code = 'released_no_refund',
         last_error_message = 'Released by a person after Stripe showed no refund for it',
         claim_token = null, claimed_until = null, settled_at = v_now, updated_at = v_now
   where r.id = p_request_id;
  update public.catering_refund_payment_work w set generation = w.generation + 1, updated_at = v_now where w.payment_id = v_payment;
  update public.catering_refund_issues s set state = 'resolved', disposition = 'evidence_cleared', disposition_at = v_now
   where s.request_id = p_request_id and s.code in ('reserved_not_sent', 'submission_unconfirmed') and s.state <> 'resolved';
  return jsonb_build_object('result', 'released', 'status', 'failed', 'generation', v_w.generation + 1);
end $$;

-- ── Ingress and settlement (worker; allowed with no open epoch, refused once sealed) ────────────────────
-- ONE transaction: find or append the event's immutable work and hints, apply the matched reservation floor,
-- preserve the matched 0333 charge-history append once, and stamp the terminal transport verdict
-- `refund_state_owed` on the ledger row. No provider call. A duplicate whose work already committed answers again.
create function public.catering_refund_event_register(p_caller text, p_event_id text, p_event_type text, p_endpoint_location_id uuid,
  p_livemode boolean, p_payment_intent text, p_charge text, p_created_sec bigint, p_cumulative_cents bigint,
  p_charge_amount_cents bigint, p_fully_refunded boolean, p_hints jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_adm record;
  v_ev record;
  v_pay record;
  v_payment uuid;
  v_state text := 'unmatched';
  v_shop uuid;
  v_gen bigint;
  v_promoted boolean := false;
  v_now timestamptz;
begin
  if p_event_id is null or length(p_event_id) not between 1 and 255 or p_livemode is null
     or p_event_type is null or p_event_type not in ('charge.refunded', 'refund.created', 'refund.updated', 'refund.failed', 'charge.refund.updated')
     or (p_hints is not null and jsonb_typeof(p_hints) <> 'array') or (p_hints is not null and jsonb_array_length(p_hints) > 200)
     or (p_payment_intent is not null and p_payment_intent !~ '^pi_[A-Za-z0-9_]{1,250}$')
     or (p_charge is not null and p_charge !~ '^[A-Za-z0-9_]{1,255}$')
     or (p_cumulative_cents is not null and p_cumulative_cents < 0) or (p_charge_amount_cents is not null and p_charge_amount_cents < 0)
     or (p_created_sec is not null and (p_created_sec <= 0 or p_created_sec > 99999999999)) then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  -- The same admission lock finish_drain takes exclusively. Sealed = a retryable refusal before any verdict.
  select * into v_adm from public.catering_refund_admit(p_caller, 'ingress');
  v_now := clock_timestamp();
  select * into v_ev from public.catering_refund_event_work e where e.event_id = p_event_id for update;
  if not found then
    insert into public.catering_refund_event_work (event_id, event_type, source, endpoint_location_id, livemode, payment_intent_id,
        charge_id, provider_created_at, cumulative_cents, charge_amount_cents, charge_fully_refunded, hints, state)
      values (p_event_id, p_event_type, 'ingress', p_endpoint_location_id, p_livemode, p_payment_intent, p_charge,
              case when p_created_sec is not null then to_timestamp(p_created_sec) end, p_cumulative_cents, p_charge_amount_cents,
              p_fully_refunded, coalesce(p_hints, '[]'::jsonb), 'unmatched');
    if p_payment_intent is not null then
      -- Match by PaymentIntent BEFORE any limiting or paging; `paid` and `refunded` both count as settled.
      select p.id, p.status into v_pay from public.catering_payments p
       where p.provider = 'stripe' and p.provider_ref = p_payment_intent order by p.id limit 1 for no key update;
      if found and v_pay.status in ('paid', 'refunded') then
        v_state := public.catering_refund_attach_event(p_event_id, v_pay.id);
        if v_state in ('attached', 'quarantined') then v_payment := v_pay.id; end if;
      end if;
    end if;
  elsif v_ev.source = 'recovery_seed' then
    -- A GENUINE SIGNED DELIVERY of an event the recovery scan imported first (a retry of a delivery that had failed, or
    -- the scan running between the ledger append and this call): it KEEPS its ingress obligation. The row becomes
    -- ingress, gets the floor and the 0333 row it would have had, and is owed to the sweep again.
    v_promoted := true;
    update public.catering_refund_event_work e
       set source = 'ingress', endpoint_location_id = p_endpoint_location_id,
           provider_created_at = coalesce(case when p_created_sec is not null then to_timestamp(p_created_sec) end, e.provider_created_at),
           cumulative_cents = coalesce(p_cumulative_cents, e.cumulative_cents), charge_amount_cents = coalesce(p_charge_amount_cents, e.charge_amount_cents),
           charge_fully_refunded = coalesce(p_fully_refunded, e.charge_fully_refunded), charge_id = coalesce(p_charge, e.charge_id),
           hints = case when jsonb_array_length(coalesce(p_hints, '[]'::jsonb)) > 0 then p_hints else e.hints end
     where e.event_id = p_event_id
    returning * into v_ev;
    if v_ev.state = 'attached' then
      perform 1 from public.catering_payments p where p.id = v_ev.payment_id for no key update;
      select w.location_id, w.generation into v_shop, v_gen from public.catering_refund_payment_work w where w.payment_id = v_ev.payment_id for update;
      if p_endpoint_location_id is not null and p_endpoint_location_id <> v_shop then
        update public.catering_refund_event_work e set state = 'quarantined' where e.event_id = p_event_id;
      else
        update public.catering_refund_event_work e
           set floor_state = case when e.event_type = 'charge.refunded' and coalesce(e.cumulative_cents, 0) > 0 and e.floor_state = 'none' then 'outstanding' else e.floor_state end,
               floor_cents = case when e.event_type = 'charge.refunded' and coalesce(e.cumulative_cents, 0) > 0 and e.floor_state = 'none' then e.cumulative_cents else e.floor_cents end,
               applied_at = null, applied_generation = null
         where e.event_id = p_event_id;
        perform public.catering_refund_register_hints(v_ev.payment_id, v_shop, v_ev.hints, 'event', v_ev.provider_created_at, v_gen);
        if v_ev.event_type = 'charge.refunded' and v_ev.cumulative_cents is not null and not v_ev.history_appended then
          insert into public.catering_payment_refund_events (stripe_event_id, payment_id, refunded_at, cumulative_refunded_cents,
                                                             charge_amount_cents, refunded_at_approximate)
            values (p_event_id, v_ev.payment_id, least(coalesce(v_ev.provider_created_at, v_now), v_now), v_ev.cumulative_cents,
                    v_ev.charge_amount_cents, v_ev.provider_created_at is null)
          on conflict do nothing;
          update public.catering_refund_event_work e set history_appended = true where e.event_id = p_event_id;
        end if;
        update public.catering_refund_payment_work w
           set generation = w.generation + 1, next_due_at = v_now, retry_count = 0, updated_at = v_now,
               oldest_unresolved_at = coalesce(w.oldest_unresolved_at, v_now)
         where w.payment_id = v_ev.payment_id;
      end if;
    elsif v_ev.state in ('unmatched', 'no_payment') and v_ev.payment_intent_id is not null then
      select p.id, p.status into v_pay from public.catering_payments p
       where p.provider = 'stripe' and p.provider_ref = v_ev.payment_intent_id order by p.id limit 1 for no key update;
      if found and v_pay.status in ('paid', 'refunded') then
        perform public.catering_refund_attach_event(p_event_id, v_pay.id);
      end if;
    end if;
    select e.state, e.payment_id into v_state, v_payment from public.catering_refund_event_work e where e.event_id = p_event_id;
  else
    v_state := v_ev.state;
    v_payment := v_ev.payment_id;
  end if;
  if v_payment is not null then
    select w.location_id into v_shop from public.catering_refund_payment_work w where w.payment_id = v_payment;
  end if;
  -- The terminal transport verdict, in the SAME transaction as the work. Only an unfinished ledger row is stamped.
  update public.stripe_events s set outcome = 'refund_state_owed', processed_at = v_now,
         location_id = coalesce(s.location_id, case when v_state = 'attached' then v_shop end)
   where s.id = p_event_id and (s.outcome is null or s.outcome = 'processing_failed');
  return jsonb_build_object('result', case when v_ev.event_id is null or v_promoted then 'registered' else 'duplicate' end, 'state', v_state,
                            'payment_id', v_payment, 'location_id', v_shop,
                            'floor', exists (select 1 from public.catering_refund_event_work e where e.event_id = p_event_id and e.floor_state = 'outstanding'));
end $$;

-- SETTLEMENT: under the payment lock, before settlement makes refund admission possible, attach every event that
-- was seen first for this payment's PaymentIntent (however old: a parked `no_payment` event is reawakened by PI),
-- with its hints and applicable floor. An event already handed to main's replay (re-stamped at a seal) is left to it.
create function public.catering_refund_settlement_attach(p_caller text, p_payment_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_adm record;
  v_pay record;
  v_ev record;
  v_ids jsonb := '[]'::jsonb;
  v_floors integer := 0;
  v_r text;
begin
  if p_payment_id is null then raise exception 'invalid_request' using errcode = 'P0001'; end if;
  select * into v_adm from public.catering_refund_admit(p_caller, 'ingress');
  select p.id, p.status, p.provider, p.provider_ref into v_pay from public.catering_payments p where p.id = p_payment_id for no key update;
  if not found or v_pay.status not in ('paid', 'refunded') or v_pay.provider is distinct from 'stripe'
     or coalesce(v_pay.provider_ref, '') !~ '^pi_[A-Za-z0-9_]{1,250}$' then
    return jsonb_build_object('result', 'not_settled', 'events', v_ids, 'floors', 0);
  end if;
  if not public.catering_refund_ensure_work(p_payment_id, 'settlement') then
    return jsonb_build_object('result', 'not_settled', 'events', v_ids, 'floors', 0);
  end if;
  for v_ev in
    select e.event_id from public.catering_refund_event_work e
     where e.payment_intent_id = v_pay.provider_ref and e.state in ('unmatched', 'no_payment') and e.restamped_at is null
     order by e.received_at, e.event_id
  loop
    v_r := public.catering_refund_attach_event(v_ev.event_id, p_payment_id);
    if v_r in ('attached', 'quarantined') then v_ids := v_ids || to_jsonb(v_ev.event_id);
    else raise exception 'attach_failed' using errcode = 'P0001', detail = v_r; end if;
  end loop;
  select count(*) into v_floors from public.catering_refund_event_work e where e.payment_id = p_payment_id and e.floor_state = 'outstanding';
  return jsonb_build_object('result', 'attached', 'events', v_ids, 'floors', v_floors);
end $$;

-- ── The pass: begin, remember, apply, defer (worker; any open epoch) ────────────────────────────────────
-- BEGIN a discovery pass for one settled payment. Returns the pass token, the GENERATION every later step is fenced
-- on, the ids whose exact retrieval the coverage contract requires (event and create-response hints, bound ids,
-- retained snapshot / request ids, permanent identities, ids learned by an earlier incomplete pass) and the
-- continuation of a list that did not reach its terminal page at the same generation.
create function public.catering_refund_pass_begin(p_caller text, p_payment_id uuid, p_run_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_adm record;
  v_pay record;
  v_w record;
  v_snap jsonb;
  v_snap_at timestamptz;
  v_hints jsonb;
  v_token uuid := gen_random_uuid();
  v_now timestamptz;
  v_cursor jsonb;
begin
  if p_payment_id is null then raise exception 'invalid_request' using errcode = 'P0001'; end if;
  select * into v_adm from public.catering_refund_admit(p_caller, 'work');
  select p.id, p.status, p.provider, p.provider_ref into v_pay from public.catering_payments p where p.id = p_payment_id for no key update;
  if not found or not public.catering_refund_ensure_work(p_payment_id, 'staff') then
    return jsonb_build_object('result', 'unsettled_payment');
  end if;
  select * into v_w from public.catering_refund_payment_work w where w.payment_id = p_payment_id for update;
  v_now := clock_timestamp();
  -- Bound conflicts: one staged pass per payment at a time; a competing caller defers.
  if v_w.pass_token is not null and v_w.pass_generation = v_w.generation and v_w.pass_started_at > v_now - interval '150 seconds' then
    return jsonb_build_object('result', 'busy', 'generation', v_w.generation);
  end if;
  -- Retained historical ids are hints too (0357 bindings and the newest legacy snapshot).
  select coalesce(jsonb_agg(jsonb_build_object('id', r.stripe_refund_id, 'request', r.id)), '[]'::jsonb) into v_hints
    from public.catering_refund_requests r where r.payment_id = p_payment_id and r.stripe_refund_id is not null;
  perform public.catering_refund_register_hints(p_payment_id, v_w.location_id, v_hints, 'request_binding', null, v_w.generation);
  select s.refunds, s.listed_at into v_snap, v_snap_at from public.catering_refund_stripe_snapshots s where s.payment_id = p_payment_id;
  if v_snap is not null then
    select coalesce(jsonb_agg(jsonb_build_object('id', x->>'id', 'status', x->>'status')), '[]'::jsonb) into v_hints from jsonb_array_elements(v_snap) x;
    perform public.catering_refund_register_hints(p_payment_id, v_w.location_id, v_hints, 'snapshot', v_snap_at, v_w.generation);
  end if;
  -- A changed generation invalidates the staged continuation.
  v_cursor := case when v_w.discovery_cursor is not null and (v_w.discovery_cursor->>'generation')::bigint = v_w.generation
                   then v_w.discovery_cursor end;
  update public.catering_refund_payment_work w
     set pass_token = v_token, pass_generation = w.generation, pass_started_at = v_now, pass_run_id = p_run_id,
         discovery_cursor = v_cursor, updated_at = v_now
   where w.payment_id = p_payment_id;
  return jsonb_build_object(
    'result', 'begun', 'pass_token', v_token, 'generation', v_w.generation, 'epoch_state', v_adm.o_state,
    'payment_id', p_payment_id, 'payment_status', v_pay.status, 'location_id', v_w.location_id,
    'payment_intent', v_w.payment_intent_id, 'charge', v_w.charge_id, 'currency', v_w.currency, 'livemode', v_w.livemode,
    'cursor', v_cursor,
    'ids', (select coalesce(jsonb_agg(jsonb_build_object('id', i.refund_id, 'verified', i.verified) order by i.refund_id), '[]'::jsonb)
              from public.catering_refund_identities i
             where i.payment_id = p_payment_id and i.excluded_at is null and i.quarantined_at is null),
    'requests', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'amount_cents', r.amount_cents, 'status', r.status,
                          'quote_id', r.quote_id, 'bound', r.stripe_refund_id) order by r.id), '[]'::jsonb)
                   from public.catering_refund_requests r where r.payment_id = p_payment_id));
end $$;

-- REMEMBER what a list page taught (cumulative id registration) and how far the list got, so completion can span
-- more than one invocation. Fenced on the pass token and the generation; a stale pass writes nothing.
create function public.catering_refund_pass_remember(p_caller text, p_payment_id uuid, p_pass_token uuid, p_learned jsonb,
  p_cursor text, p_pages integer) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_adm record;
  v_w record;
begin
  if p_payment_id is null or p_pass_token is null or (p_learned is not null and jsonb_typeof(p_learned) <> 'array')
     or (p_cursor is not null and p_cursor !~ '^[A-Za-z0-9_]{1,255}$') or coalesce(p_pages, 0) < 0 then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  select * into v_adm from public.catering_refund_admit(p_caller, 'work');
  perform 1 from public.catering_payments p where p.id = p_payment_id for no key update;
  select * into v_w from public.catering_refund_payment_work w where w.payment_id = p_payment_id for update;
  if not found or v_w.pass_token is distinct from p_pass_token or v_w.pass_generation is distinct from v_w.generation then
    return jsonb_build_object('result', 'stale_generation');
  end if;
  perform public.catering_refund_register_hints(p_payment_id, v_w.location_id, p_learned, 'list', null, v_w.generation);
  update public.catering_refund_payment_work w
     set discovery_cursor = jsonb_build_object('generation', w.generation, 'after', p_cursor, 'pages', coalesce(p_pages, 0)),
         pass_started_at = clock_timestamp(), updated_at = clock_timestamp()
   where w.payment_id = p_payment_id;
  return jsonb_build_object('result', 'remembered', 'generation', v_w.generation);
end $$;

-- THE ONE FINANCIAL WRITER. Private: the public entry point below admits and calls it, and that seam is where B2
-- (0362) adds the first-success decision to this same transaction. Writes, atomically: identities, outcomes, event
-- floors and coverage, request bindings and transitions, the payment status, the derived snapshot, operational
-- issues and audits. Returns a NAMED result; it never takes an arbitrary patch.
--   p_evidence = { complete: bool, scheduled: bool, run_id: uuid|null,
--                  owner: { status: resolved|indeterminate|conflict|unreachable, payment_intent, charge, currency,
--                           livemode, captured_cents|null },
--                  refunds: [ { id, read: ok|not_found_all|denied|transient,
--                               payment_intent, charge, amount, currency, status, created (epoch seconds),
--                               request (uuid|null), meta_payment (uuid|null), meta_quote (uuid|null) } ] }
create function public.catering_refund_apply_inner(p_epoch uuid, p_epoch_state text, p_payment_id uuid, p_pass_token uuid,
  p_expected_generation bigint, p_evidence jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_pay record;
  v_w record;
  v_owner jsonb := p_evidence->'owner';
  v_refunds jsonb := coalesce(p_evidence->'refunds', '[]'::jsonb);
  v_complete boolean := coalesce((p_evidence->>'complete')::boolean, false);
  v_scheduled boolean := coalesce((p_evidence->>'scheduled')::boolean, false);
  v_run uuid;
  v_now timestamptz := clock_timestamp();
  v_gen bigint;
  v_new_gen bigint;
  e jsonb;
  v_i record;
  v_r record;
  v_ev record;
  v_id text;
  v_read text;
  v_blocked boolean := false;
  v_incomplete text := null;
  v_class text;
  v_unfamiliar boolean;
  v_created timestamptz;
  v_sum bigint;
  v_members jsonb;
  v_n integer;
  v_cand text;
  v_target text;
  v_quote uuid;
  v_fig record;
  v_returned bigint;
  v_reserved bigint;
  v_capture_ok boolean;
  v_floors integer;
  v_status text;
  v_transitions integer := 0;
  v_next interval;
  v_req uuid;
  v_outcomes jsonb := '[]'::jsonb;
begin
  if p_payment_id is null or p_pass_token is null or p_expected_generation is null or p_evidence is null
     or jsonb_typeof(p_evidence) <> 'object' or jsonb_typeof(v_refunds) <> 'array' or v_owner is null or jsonb_typeof(v_owner) <> 'object' then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  if coalesce(p_evidence->>'run_id', '') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    v_run := (p_evidence->>'run_id')::uuid;
  end if;

  -- LOCKS: the payment, then its work row; identities, requests and events below. Coverage is re-checked under them.
  select p.id, p.quote_id, p.status, p.provider, p.provider_ref, p.kind, p.amount_cents into v_pay
    from public.catering_payments p where p.id = p_payment_id for no key update;
  if not found or v_pay.status not in ('paid', 'refunded') then return jsonb_build_object('result', 'unsettled_payment'); end if;
  select * into v_w from public.catering_refund_payment_work w where w.payment_id = p_payment_id for update;
  if not found or v_w.pass_token is distinct from p_pass_token or v_w.generation <> p_expected_generation
     or v_w.pass_generation is distinct from v_w.generation then
    return jsonb_build_object('result', 'stale_generation', 'generation', v_w.generation);
  end if;
  v_gen := v_w.generation;
  v_quote := v_pay.quote_id;

  -- ── A. The owner. A failed lookup never defaults to another account; an indeterminate owner holds the payment.
  if coalesce(v_owner->>'status', '') <> 'resolved' then
    if v_owner->>'status' in ('indeterminate', 'conflict') then
      perform public.catering_refund_raise_issue('owner_indeterminate', p_payment_id, v_w.location_id, null, null, null,
        'owner:' || (v_owner->>'status'), true, v_gen, jsonb_build_object('status', v_owner->>'status'));
    end if;
    v_incomplete := 'owner_' || coalesce(v_owner->>'status', 'missing');
  elsif (v_owner->>'payment_intent') is distinct from v_w.payment_intent_id or coalesce(v_owner->>'charge', '') !~ '^[A-Za-z0-9_]{1,255}$'
        or coalesce(v_owner->>'currency', '') !~ '^[a-z]{3}$' or (v_owner->>'livemode') is null
        or (jsonb_typeof(v_owner->'captured_cents') = 'number' and ((v_owner->>'captured_cents')::numeric < 0
              or (v_owner->>'captured_cents')::numeric <> trunc((v_owner->>'captured_cents')::numeric)
              or (v_owner->>'captured_cents')::numeric > 9007199254740991)) then
    raise exception 'invalid_request' using errcode = 'P0001';
  elsif (v_w.charge_id is not null and v_w.charge_id <> v_owner->>'charge')
        or (v_w.livemode is not null and v_w.livemode <> (v_owner->>'livemode')::boolean) then
    -- The payment's owning charge (or mode) is not the one verified before: review, never a silent switch.
    perform public.catering_refund_raise_issue('wrong_charge', p_payment_id, v_w.location_id, null, null, null,
      'charge:' || (v_owner->>'charge'), true, v_gen, jsonb_build_object('reason', 'charge_changed'));
    v_blocked := true;
  elsif v_w.currency is not null and v_w.currency <> v_owner->>'currency' then
    perform public.catering_refund_raise_issue('capture_review', p_payment_id, v_w.location_id, null, null, null,
      'currency:' || (v_owner->>'currency'), true, v_gen, jsonb_build_object('reason', 'mixed_currency'));
    v_blocked := true;
  end if;

  -- ── B. Read-only classification of every refund in the evidence (no money write yet). ─────────────────
  if not v_blocked and v_incomplete is null then
    -- Coverage, re-checked under the lock: every id the contract requires must be in the evidence.
    if exists (select 1 from public.catering_refund_identities i
                where i.payment_id = p_payment_id and i.excluded_at is null and i.quarantined_at is null
                  and not exists (select 1 from jsonb_array_elements(v_refunds) x where x->>'id' = i.refund_id)) then
      v_incomplete := 'coverage';
    end if;
    for e in select x from jsonb_array_elements(v_refunds) x order by x->>'id' loop
      v_id := e->>'id';
      v_read := e->>'read';
      if v_id is null or v_id !~ '^[A-Za-z0-9_]{1,255}$' or v_read is null or v_read not in ('ok', 'not_found_all', 'denied', 'transient') then
        raise exception 'invalid_request' using errcode = 'P0001';
      end if;
      select * into v_i from public.catering_refund_identities i where i.refund_id = v_id for update;
      -- An id that is NOT this payment's: another payment already owns it, or (never seen before) its exact read names
      -- another PaymentIntent. It is never scoped to this payment; it holds this payment until an operator excludes it.
      if (found and v_i.payment_id <> p_payment_id)
         or (not found and v_read = 'ok' and (e->>'payment_intent') is distinct from v_w.payment_intent_id) then
        if not exists (select 1 from public.catering_refund_issues s where s.payment_id = p_payment_id and s.code = 'wrong_charge'
                          and s.evidence_fingerprint = 'foreign:' || v_id and s.disposition = 'exclude_unrelated_hint') then
          perform public.catering_refund_raise_issue('wrong_charge', p_payment_id, v_w.location_id, null, v_id, null,
            'foreign:' || v_id, true, v_gen, jsonb_build_object('reason', 'owned_by_another_payment'));
          v_blocked := true;
        end if;
        continue;
      end if;
      if not found then
        insert into public.catering_refund_identities (refund_id, payment_id, first_source) values (v_id, p_payment_id, 'list');
        select * into v_i from public.catering_refund_identities i where i.refund_id = v_id for update;
      end if;
      continue when v_i.excluded_at is not null;
      if v_read = 'ok' then
        if coalesce(e->>'currency', '') !~ '^[a-z]{3}$' or coalesce(e->>'charge', '') !~ '^[A-Za-z0-9_]{1,255}$'
           or jsonb_typeof(e->'amount') <> 'number' or (e->>'amount')::numeric <= 0 or (e->>'amount')::numeric <> trunc((e->>'amount')::numeric)
           or (e->>'amount')::numeric > 9007199254740991
           or jsonb_typeof(e->'created') <> 'number' or (e->>'created')::numeric <= 0 or (e->>'created')::numeric > 99999999999 then
          raise exception 'invalid_request' using errcode = 'P0001';
        end if;
        v_created := to_timestamp((e->>'created')::bigint);
        -- An immutable fact that contradicts what was verified before is an evidence failure, never an overwrite.
        if v_i.verified and (v_i.amount_cents <> (e->>'amount')::bigint or v_i.charge_id <> e->>'charge'
                             or v_i.currency <> e->>'currency' or v_i.provider_created_at <> v_created) then
          perform public.catering_refund_raise_issue('capture_review', p_payment_id, v_w.location_id, null, v_id, null,
            'immutable:' || v_id, true, v_gen, jsonb_build_object('reason', 'immutable_fact_changed'));
          v_blocked := true;
        end if;
      elsif v_read in ('not_found_all', 'denied') and v_i.verified then
        -- A previously VERIFIED id that cannot be read any more: its last verified facts stay, this payment's apply
        -- is blocked, an anomaly with its age is shown. Other payments go on.
        update public.catering_refund_identities i set unreadable_since = coalesce(i.unreadable_since, v_now), last_read_at = v_now where i.refund_id = v_id;
        perform public.catering_refund_raise_issue('verified_unreadable', p_payment_id, v_w.location_id, v_i.request_id, v_id, null,
          'unreadable:' || v_id, true, v_gen, jsonb_build_object('read', v_read));
        v_blocked := true;
      elsif v_read = 'not_found_all' then
        -- A NEVER-verified hint. Only a COMPLETE pass on a distinct SCHEDULED attempt in which EVERY permitted account
        -- answered 404 counts; three of them quarantine the hint (its provenance stays) and the pass proceeds.
        if v_complete and v_scheduled and v_run is not null and v_i.not_found_last_run is distinct from v_run then
          update public.catering_refund_identities i
             set not_found_passes = i.not_found_passes + 1, not_found_last_run = v_run, last_read_at = v_now,
                 quarantined_at = case when i.not_found_passes + 1 >= 3 then v_now else i.quarantined_at end
           where i.refund_id = v_id
          returning * into v_i;
          if v_i.quarantined_at is not null then
            perform public.catering_refund_raise_issue('quarantined_hint', p_payment_id, v_w.location_id, null, v_id, null,
              'hint:' || v_id, false, v_gen, jsonb_build_object('source', v_i.first_source));
          end if;
        end if;
        if v_i.quarantined_at is null then v_incomplete := coalesce(v_incomplete, 'hint_unresolved'); end if;
      else
        -- transient (timeout, 429, 5xx, no credentials), or denied on a never-verified hint: nothing is counted.
        v_incomplete := coalesce(v_incomplete, 'read_' || v_read);
      end if;
    end loop;
  end if;
  if not v_complete then v_incomplete := coalesce(v_incomplete, 'list_incomplete'); end if;

  if v_blocked or v_incomplete is not null then
    -- Nothing is published. The staged pass ends; the retry ladder (1, 5, then 15 minutes) owns the next attempt.
    v_next := case least(v_w.retry_count, 2) when 0 then interval '1 minute' when 1 then interval '5 minutes' else interval '15 minutes' end;
    update public.catering_refund_payment_work w
       set pass_token = null, retry_count = w.retry_count + 1, next_due_at = v_now + v_next, updated_at = v_now,
           oldest_unresolved_at = coalesce(w.oldest_unresolved_at, v_now),
           discovery_cursor = case when v_complete then null else w.discovery_cursor end
     where w.payment_id = p_payment_id;
    return jsonb_build_object('result', case when v_blocked then 'held' else 'incomplete_evidence' end,
                              'reason', coalesce(v_incomplete, 'blocked'), 'generation', v_gen);
  end if;

  -- ── C. The writes. The owner's facts, stored once verified. ────────────────────────────────────────────
  v_new_gen := v_gen + 1;
  -- The owner resolved, on the verified charge and currency: the holds that said otherwise are cleared BY THIS EVIDENCE
  -- (an indeterminate owner after access is restored; a charge or currency that reads as verified again).
  update public.catering_refund_issues s set state = 'resolved', disposition = 'evidence_cleared', disposition_at = v_now
   where s.payment_id = p_payment_id and s.state <> 'resolved'
     and (s.code = 'owner_indeterminate' or (s.code = 'wrong_charge' and s.evidence_fingerprint like 'charge:%')
          or (s.code = 'capture_review' and s.evidence_fingerprint like 'currency:%'));
  update public.catering_refund_payment_work w
     set charge_id = coalesce(w.charge_id, v_owner->>'charge'), currency = coalesce(w.currency, v_owner->>'currency'),
         livemode = coalesce(w.livemode, (v_owner->>'livemode')::boolean),
         captured_cents = case when jsonb_typeof(v_owner->'captured_cents') = 'number' then (v_owner->>'captured_cents')::bigint else w.captured_cents end,
         capture_known = case when jsonb_typeof(v_owner->'captured_cents') = 'number' then (v_owner->>'captured_cents')::bigint > 0 else w.capture_known end
   where w.payment_id = p_payment_id
  returning * into v_w;

  -- Identities: only an EXACT read drives provider status.
  for e in select x from jsonb_array_elements(v_refunds) x where x->>'read' = 'ok' order by x->>'id' loop
    v_id := e->>'id';
    select * into v_i from public.catering_refund_identities i where i.refund_id = v_id for update;
    continue when v_i.excluded_at is not null;
    continue when v_i.payment_id <> p_payment_id; -- another payment's id (excluded by an operator above): never written here
    v_unfamiliar := coalesce(e->>'status', '') not in ('pending', 'requires_action', 'succeeded', 'failed', 'canceled') or v_id !~ '^(re|pyr)_';
    -- An unfamiliar id prefix or provider status RESERVES its verified amount: it is never counted as returned.
    v_class := case when v_unfamiliar then 'reserved' else public.catering_refund_class_of(e->>'status') end;
    v_created := to_timestamp((e->>'created')::bigint);
    v_req := null;
    if coalesce(e->>'request', '') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       and (e->>'meta_payment') = p_payment_id::text then
      -- Request metadata is a candidate only with consistent original facts: this payment, that request's quote and amount.
      select r.id into v_req from public.catering_refund_requests r
       where r.id = (e->>'request')::uuid and r.payment_id = p_payment_id and r.quote_id::text = e->>'meta_quote'
         and r.amount_cents = (e->>'amount')::bigint;
    end if;
    update public.catering_refund_identities i
       set verified = true, charge_id = e->>'charge', amount_cents = (e->>'amount')::bigint, currency = e->>'currency',
           provider_created_at = v_created, provider_status = left(e->>'status', 40), class = v_class, unfamiliar = v_unfamiliar,
           wrong_charge = (e->>'payment_intent') is distinct from v_w.payment_intent_id or (e->>'charge') <> v_w.charge_id
                          or (e->>'currency') <> v_w.currency,
           -- The EXACT read decides the candidate: its verified metadata wins; metadata that names a request and
           -- does not verify (another quote, another amount) clears a candidate; no metadata keeps what we hold.
           candidate_request_id = case when v_req is not null then v_req when (e->>'request') is null then i.candidate_request_id else null end,
           verified_at = coalesce(i.verified_at, v_now), last_read_at = v_now, unreadable_since = null, not_found_passes = 0,
           -- A1: the FIRST database observation of the void class (a signed event's earlier `created` is kept).
           void_evidence_at = case when v_class = 'void' then coalesce(i.void_evidence_at, v_now) else i.void_evidence_at end,
           next_poll_at = v_now + case v_class when 'reserved' then interval '1 hour' when 'returned' then interval '1 day' else interval '7 days' end
     where i.refund_id = v_id;
    if (select i.wrong_charge from public.catering_refund_identities i where i.refund_id = v_id) then
      perform public.catering_refund_raise_issue('wrong_charge', p_payment_id, v_w.location_id, null, v_id, null,
        'refund:' || v_id, true, v_new_gen, jsonb_build_object('reason', 'refund_on_another_charge'));
    else
      if v_i.class is distinct from v_class then
        -- Staged: the outcome row is appended after the bindings below, so it carries the request it belongs to.
        v_outcomes := v_outcomes || jsonb_build_object('id', v_id, 'from', v_i.class, 'to', v_class, 'status', left(e->>'status', 40),
                                                       'amount', (e->>'amount')::bigint, 'first', v_i.class is null);
      end if;
      if v_unfamiliar then
        perform public.catering_refund_raise_issue('unfamiliar_identity', p_payment_id, v_w.location_id, v_i.request_id, v_id, null,
          'unfamiliar:' || v_id || ':' || coalesce(e->>'status', 'null'), false, v_new_gen, jsonb_build_object('status', left(e->>'status', 40)));
      end if;
    end if;
    update public.catering_refund_issues s set state = 'resolved', disposition = 'evidence_cleared', disposition_at = v_now
     where s.payment_id = p_payment_id and s.code = 'verified_unreadable' and s.refund_id = v_id and s.state <> 'resolved';
  end loop;

  -- Event floors (plan B1.2 r5 + addendum A1). Each OUTSTANDING live floor is explained by distinct verified
  -- identities on this payment, charge and currency created at or before the event (provider seconds; equality
  -- qualifies), summed across ALL current classes -- except a void identity held as void from at or before the
  -- event's own creation time, which cannot explain it.
  for v_ev in
    select * from public.catering_refund_event_work x where x.payment_id = p_payment_id and x.floor_state = 'outstanding' order by x.event_id for update
  loop
    select coalesce(sum(i.amount_cents), 0),
           coalesce(jsonb_agg(jsonb_build_object('id', i.refund_id, 'created', i.provider_created_at, 'amount_cents', i.amount_cents,
                                                 'class', i.class) order by i.refund_id), '[]'::jsonb)
      into v_sum, v_members
      from public.catering_refund_identities i
     where i.payment_id = p_payment_id and i.verified and not i.wrong_charge and i.excluded_at is null
       -- The EVENT's own charge and mode: an event about another charge of this PaymentIntent (or another mode) is
       -- never explained by this charge's identities.
       and v_ev.livemode = v_w.livemode and (v_ev.charge_id is null or v_ev.charge_id = v_w.charge_id)
       and v_ev.provider_created_at is not null and i.provider_created_at <= v_ev.provider_created_at
       and not (i.class = 'void' and i.void_evidence_at is not null and i.void_evidence_at <= v_ev.provider_created_at);
    if v_sum >= v_ev.floor_cents then
      update public.catering_refund_event_work x
         set floor_state = 'discharged', floor_closed_at = v_now, floor_generation = v_new_gen,
             coverage = jsonb_build_object('members', v_members, 'explained_cents', v_sum, 'event_cumulative_cents', v_ev.floor_cents,
                                           'event_id', v_ev.event_id, 'generation', v_new_gen)
       where x.event_id = v_ev.event_id;
      update public.catering_refund_issues s set state = 'resolved', disposition = 'evidence_cleared', disposition_at = v_now
       where s.payment_id = p_payment_id and s.code = 'awaiting_identity' and s.event_id = v_ev.event_id and s.state <> 'resolved';
    else
      perform public.catering_refund_raise_issue('awaiting_identity', p_payment_id, v_w.location_id, null, null, v_ev.event_id,
        'floor:' || v_ev.event_id, true, v_new_gen,
        jsonb_build_object('event_cumulative_cents', v_ev.floor_cents, 'explained_cents', v_sum, 'remainder_cents', v_ev.floor_cents - v_sum));
    end if;
  end loop;

  -- Bindings. (1) A request that already carries its refund id (0357) is followed by that id.
  update public.catering_refund_identities i set request_id = r.id
    from public.catering_refund_requests r
   where r.payment_id = p_payment_id and r.stripe_refund_id = i.refund_id and i.payment_id = p_payment_id
     and i.verified and not i.wrong_charge and i.request_id is null;
  -- (2) An unbound request: exactly one verified candidate with matching request, payment and amount, and no other owner.
  for v_r in
    select * from public.catering_refund_requests r
     where r.payment_id = p_payment_id and r.stripe_refund_id is null
       and not exists (select 1 from public.catering_refund_identities i where i.request_id = r.id)
     order by r.id for update
  loop
    select count(*), min(i.refund_id) into v_n, v_cand
      from public.catering_refund_identities i
     where i.payment_id = p_payment_id and i.candidate_request_id = v_r.id and i.verified and not i.wrong_charge
       and i.request_id is null and i.external_at is null and i.excluded_at is null;
    if v_n = 1 and (select i.amount_cents = v_r.amount_cents and i.currency = v_w.currency from public.catering_refund_identities i where i.refund_id = v_cand) then
      update public.catering_refund_identities i set request_id = v_r.id where i.refund_id = v_cand;
      if v_r.status = 'failed' then
        -- Released or locally refused, and a matching refund turned up: the money is counted, the human disposition
        -- is preserved, and staff are told a replacement may already have been made.
        update public.catering_refund_requests r set binding_hold = 'released_request_has_refund', reconcile_seq = r.reconcile_seq + 1, updated_at = v_now
         where r.id = v_r.id;
        perform public.catering_refund_raise_issue('released_request_has_refund', p_payment_id, v_w.location_id, v_r.id, v_cand, null,
          'late:' || v_cand, true, v_new_gen, jsonb_build_object('closed_as', v_r.last_error_code));
      elsif v_cand ~ '^(re|pyr)_[A-Za-z0-9_]{1,250}$' then
        update public.catering_refund_requests r set stripe_refund_id = v_cand, binding_hold = null, updated_at = v_now where r.id = v_r.id;
      end if;
    elsif v_n >= 1 then
      -- Several candidates, or one that contradicts the request: hold. Every verified identity is still counted
      -- once for money and the independent unbound reservation is kept.
      update public.catering_refund_requests r set binding_hold = 'ambiguous_binding', updated_at = v_now
       where r.id = v_r.id and r.binding_hold is distinct from 'ambiguous_binding';
      perform public.catering_refund_raise_issue('ambiguous_binding', p_payment_id, v_w.location_id, v_r.id, null, null,
        'request:' || v_r.id::text || ':' || (select string_agg(i.refund_id, ',' order by i.refund_id) from public.catering_refund_identities i
            where i.payment_id = p_payment_id and i.candidate_request_id = v_r.id and i.verified and i.request_id is null and i.external_at is null and i.excluded_at is null),
        true, v_new_gen, jsonb_build_object('candidates', v_n));
    end if;
  end loop;

  -- The append-only outcomes of this pass: one row per identity class transition, with its (possibly new) binding.
  insert into public.catering_payment_refund_outcomes (refund_id, payment_id, quote_id, location_id, request_id, from_class, to_class,
      provider_status, amount_cents, observed_at, provider_evidence_at, generation, epoch_id, baseline, source)
    select i.refund_id, p_payment_id, v_quote, v_w.location_id, i.request_id, x->>'from', x->>'to', x->>'status', (x->>'amount')::bigint,
           v_now, case when (x->>'first')::boolean then i.provider_created_at end, v_new_gen, p_epoch, p_epoch_state <> 'live',
           case when p_epoch_state = 'recovering' then 'recovery' else 'apply' end
      from jsonb_array_elements(v_outcomes) x join public.catering_refund_identities i on i.refund_id = x->>'id'
     order by i.refund_id;

  -- Request transitions (plan B1.4), from the bound identity's CURRENT class. Only a protected advance of
  -- reconcile_seq (the guard) allows the provider moves out of a terminal state.
  for v_r in
    select r.*, i.refund_id as i_refund, i.class as i_class, i.provider_status as i_status
      from public.catering_refund_requests r join public.catering_refund_identities i on i.request_id = r.id and i.verified and not i.wrong_charge
     where r.payment_id = p_payment_id order by r.id for update of r
  loop
    continue when v_r.binding_hold = 'released_request_has_refund';
    v_target := case v_r.i_class when 'returned' then 'succeeded' when 'reserved' then 'submitted' else 'failed' end;
    if v_r.status = v_target then
      if v_r.stripe_status is distinct from v_r.i_status then
        -- The same class again (an idempotent diagnostic refresh): no second occurrence, no audit.
        update public.catering_refund_requests r set stripe_status = v_r.i_status, reconcile_seq = r.reconcile_seq + 1, updated_at = v_now where r.id = v_r.id;
      end if;
      continue;
    end if;
    v_transitions := v_transitions + 1;
    update public.catering_refund_requests r
       set status = v_target, stripe_status = v_r.i_status, reconcile_seq = r.reconcile_seq + 1, updated_at = v_now,
           claim_token = null, claimed_until = null,
           last_error_code = case when v_target = 'failed' then left('provider_' || coalesce(v_r.i_status, 'void'), 80) else null end,
           last_error_message = case when v_target = 'failed' then 'Stripe reports this refund ' || coalesce(v_r.i_status, 'void') else null end,
           settled_at = case when v_target = 'submitted' then null else v_now end,
           first_reversed_at = case when v_r.status = 'succeeded' then coalesce(r.first_reversed_at, v_now) else r.first_reversed_at end,
           binding_hold = case when v_r.status = 'failed' then 'refund_revived' else r.binding_hold end
     where r.id = v_r.id;
    if v_r.status = 'failed' then
      perform public.catering_refund_raise_issue('refund_revived', p_payment_id, v_w.location_id, v_r.id, v_r.i_refund, null,
        'revived:' || v_r.i_refund || ':' || v_r.i_class, true, v_new_gen, jsonb_build_object('class', v_r.i_class));
    end if;
    -- The request has a verified outcome now: "reserved, not sent" / "submission unconfirmed" no longer describe it.
    update public.catering_refund_issues s set state = 'resolved', disposition = 'evidence_cleared', disposition_at = v_now
     where s.request_id = v_r.id and s.code in ('reserved_not_sent', 'submission_unconfirmed') and s.state <> 'resolved';
    if v_r.status = 'succeeded' or v_target = 'failed' or v_r.status = 'failed' then
      insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
        values (null, null, case when v_r.status = 'succeeded' then 'catering.refund.reversed'
                                 when v_target = 'failed' then 'catering.refund.provider_failed' else 'catering.refund.anomaly' end,
                'catering_refund_requests', v_r.id,
                jsonb_build_object('actor_context', 'refund_reconciler', 'payment_id', p_payment_id, 'quote_id', v_r.quote_id,
                                   'location_id', v_w.location_id, 'amount_cents', v_r.amount_cents, 'from_status', v_r.status,
                                   'to_status', v_target, 'stripe_refund_id', v_r.i_refund, 'stripe_status', v_r.i_status,
                                   'generation', v_new_gen), false);
    end if;
  end loop;

  -- The projection: available / reserved / returned, with unresolved floors honoured.
  update public.catering_refund_payment_work w set last_complete_pass_at = v_now where w.payment_id = p_payment_id;
  select * into v_fig from public.catering_refund_effective_figures(p_payment_id, null);
  v_returned := v_fig.o_returned;
  v_reserved := v_fig.o_reserved;
  v_capture_ok := v_w.capture_known and coalesce(v_w.captured_cents, 0) > 0;
  select count(*) into v_floors from public.catering_refund_event_work x where x.payment_id = p_payment_id and x.floor_state = 'outstanding';
  v_status := v_pay.status;
  if (v_capture_ok and v_returned + v_reserved > v_w.captured_cents) or (not v_capture_ok and v_returned > 0) then
    -- Over-capture, or a return against an unknown capture: review; the payment status is not moved.
    perform public.catering_refund_raise_issue('capture_review', p_payment_id, v_w.location_id, null, null, null,
      'capture:' || coalesce(v_w.captured_cents::text, 'unknown') || ':' || v_returned::text || ':' || v_reserved::text, true, v_new_gen,
      jsonb_build_object('captured_cents', v_w.captured_cents, 'returned_cents', v_returned, 'reserved_cents', v_reserved,
                         'reason', case when v_capture_ok then 'over_capture' else 'capture_unknown' end));
  elsif v_pay.status = 'paid' and v_capture_ok and v_returned >= v_w.captured_cents then
    -- paid -> refunded ONLY when verified SUCCEEDED cents cover a known positive capture.
    update public.catering_payments p set status = 'refunded' where p.id = p_payment_id and p.status = 'paid';
    v_status := 'refunded';
    insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
      values (null, null, 'catering.payment.provider_refunded', 'catering_payments', p_payment_id,
              jsonb_build_object('actor_context', 'refund_reconciler', 'quote_id', v_quote, 'kind', v_pay.kind, 'amount_cents', v_pay.amount_cents,
                                 'refunded_amount_cents', v_returned, 'charge_amount_cents', v_w.captured_cents, 'partial', false,
                                 'row_status', 'refunded', 'payment_intent_id', v_w.payment_intent_id, 'location_id', v_w.location_id,
                                 'generation', v_new_gen), false);
  elsif v_pay.status = 'refunded' and v_floors = 0 and not v_fig.o_held
        and ((v_capture_ok and v_returned < v_w.captured_cents) or (v_returned = 0 and v_reserved = 0)) then
    -- refunded -> paid: verified returns below the known capture, or complete, non-contradictory evidence of none.
    -- The family-checkout cleanup obligation is written in THIS commit; the cleanup itself runs after it.
    update public.catering_payments p set status = 'paid' where p.id = p_payment_id and p.status = 'refunded';
    v_status := 'paid';
    update public.catering_refund_payment_work w set checkout_cleanup_owed_at = v_now, checkout_cleanup_done_at = null, checkout_cleanup_report = null
     where w.payment_id = p_payment_id;
    insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
      values (null, null, 'catering.refund.reversed', 'catering_payments', p_payment_id,
              jsonb_build_object('actor_context', 'refund_reconciler', 'quote_id', v_quote, 'kind', v_pay.kind, 'amount_cents', v_pay.amount_cents,
                                 'returned_cents', v_returned, 'captured_cents', v_w.captured_cents, 'row_status', 'paid',
                                 'payment_intent_id', v_w.payment_intent_id, 'location_id', v_w.location_id, 'generation', v_new_gen), false);
  end if;

  -- The derived snapshot, in 0357's shape (request_id only for an actual verified binding). Opaque unfamiliar ids
  -- stay in it conservatively; they never go through 0357's `re_` / `pyr_` writer.
  insert into public.catering_refund_stripe_snapshots (payment_id, listed_at, captured_cents, refunds)
    values (p_payment_id, v_now, case when v_capture_ok then v_w.captured_cents end,
            (select coalesce(jsonb_agg(jsonb_build_object('id', i.refund_id, 'amount', i.amount_cents, 'status', i.provider_status,
                                                          'request_id', i.request_id) order by i.refund_id), '[]'::jsonb)
               from public.catering_refund_identities i where i.payment_id = p_payment_id and i.verified and not i.wrong_charge))
  on conflict (payment_id) do update set listed_at = excluded.listed_at, captured_cents = excluded.captured_cents,
    refunds = excluded.refunds, recorded_at = v_now;

  -- Acknowledged events are applied (independently of the transport verdict stamped at ingress).
  update public.catering_refund_event_work x set applied_at = v_now, applied_generation = v_new_gen
   where x.payment_id = p_payment_id and x.state = 'attached' and x.applied_at is null;

  select * into v_fig from public.catering_refund_effective_figures(p_payment_id, null);
  v_next := case
    when v_floors > 0 then (case least(v_w.retry_count, 2) when 0 then interval '1 minute' when 1 then interval '5 minutes' else interval '15 minutes' end)
    when v_reserved > 0 or exists (select 1 from public.catering_refund_requests r where r.payment_id = p_payment_id and r.status = 'pending'
                                     and (r.create_armed_at is not null or r.legacy_possibly_sent)) then interval '1 hour'
    when v_returned > 0 then interval '1 day'
    else interval '7 days' end;
  update public.catering_refund_payment_work w
     set generation = v_new_gen, last_complete_generation = v_new_gen, baseline_at = coalesce(w.baseline_at, v_now),
         returned_cents = v_returned, reserved_cents = v_reserved, pass_token = null, discovery_cursor = null,
         retry_count = case when v_floors > 0 then w.retry_count + 1 else 0 end, next_due_at = v_now + v_next, updated_at = v_now,
         oldest_unresolved_at = case when v_floors > 0 or exists (select 1 from public.catering_refund_issues s
                                       where s.payment_id = p_payment_id and s.state = 'open') then coalesce(w.oldest_unresolved_at, v_now) else null end
   where w.payment_id = p_payment_id;
  return jsonb_build_object('result', 'applied', 'generation', v_new_gen, 'payment_status', v_status, 'previous_payment_status', v_pay.status,
                            'transitions', v_transitions, 'floors_outstanding', v_floors, 'held', v_fig.o_held,
                            'captured_cents', v_fig.o_captured, 'returned_cents', v_fig.o_returned, 'reserved_cents', v_fig.o_reserved,
                            'floor_cents', v_fig.o_floor, 'available_cents', v_fig.o_available,
                            'cleanup_owed', v_status = 'paid' and v_pay.status = 'refunded');
end $$;

-- The public entry point of the financial writer: admission + the private writer, one transaction. B2 (0362)
-- re-emits THIS function (under an exact fingerprint of it) to add the first-success decision to the same commit.
create function public.catering_refund_apply(p_caller text, p_payment_id uuid, p_pass_token uuid, p_expected_generation bigint,
  p_evidence jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_adm record;
begin
  select * into v_adm from public.catering_refund_admit(p_caller, 'work');
  return public.catering_refund_apply_inner(v_adm.o_epoch, v_adm.o_state, p_payment_id, p_pass_token, p_expected_generation, p_evidence);
end $$;

-- DEFER fairly: a pass that could not finish (contention, an unavailable account, an exhausted budget) steps back
-- so one payment cannot consume every run. Fenced on the pass token: a stale defer writes nothing.
create function public.catering_refund_defer(p_caller text, p_payment_id uuid, p_pass_token uuid, p_reason text, p_retry_seconds integer) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_adm record; v_w record; v_now timestamptz;
begin
  if p_payment_id is null or p_pass_token is null then raise exception 'invalid_request' using errcode = 'P0001'; end if;
  select * into v_adm from public.catering_refund_admit(p_caller, 'work');
  select * into v_w from public.catering_refund_payment_work w where w.payment_id = p_payment_id for update;
  -- Fenced on the token AND the generation: new evidence since the pass began (it made the payment due at once)
  -- is never pushed back by that pass's own defer.
  if not found or v_w.pass_token is distinct from p_pass_token or v_w.pass_generation is distinct from v_w.generation then
    return jsonb_build_object('result', 'stale_generation');
  end if;
  v_now := clock_timestamp();
  update public.catering_refund_payment_work w
     set pass_token = null, deferrals = w.deferrals + 1, updated_at = v_now,
         next_due_at = v_now + make_interval(secs => least(greatest(coalesce(p_retry_seconds, 60), 60), 3600)),
         oldest_unresolved_at = coalesce(w.oldest_unresolved_at, v_now)
   where w.payment_id = p_payment_id;
  return jsonb_build_object('result', 'deferred', 'reason', left(coalesce(p_reason, ''), 80));
end $$;

-- ── Operator disposition (worker grant; the HUMAN authority is enforced here, never taken from the caller) ─────
-- The actor is the SESSION's user. Required: an active session with a FRESH Tier B step-up (the 120-second clock on
-- the session row), an active MoO with an active membership at the issue's shop, or an active Owner / CGS. A
-- service-role caller cannot supply an actor or a `stepped_up` flag. Fenced on the payment's generation (a stale
-- one is the named conflict `stale_generation`). Every disposition appends a destructive audit row with the actor,
-- the issue, the old and new disposition and the bounded evidence reference. No free-form customer data.
--   action x code (anything else is `invalid_action`):
--     resolve_event_floor     awaiting_identity                      (the FINANCIAL exit of an unexplained floor)
--     bind_verified_refund    ambiguous_binding                      (p_target = the refund id)
--     treat_as_external       ambiguous_binding                      (p_target = the refund id; the money stays counted)
--     exclude_unrelated_hint  quarantined_hint, wrong_charge         (p_target = a never-verified or wrong-charge id)
--     recheck_after_access    awaiting_identity, verified_unreadable, wrong_charge, owner_indeterminate, capture_review
--     access_still_required   verified_unreadable, owner_indeterminate, awaiting_identity   (the block stays)
--     evidence_reviewed       refund_revived, released_request_has_refund, unfamiliar_identity, capture_review
--     keep_held               every blocking code                    (an explicit, audited, restricted payment)
--     reopen_recheck          any HELD issue
--     release_unsent          reserved_not_sent                      (a proved never-armed reservation, no live claim)
--     acknowledge_followup    reserved_not_sent, submission_unconfirmed, checkout_still_open, quarantined_hint, unfamiliar_identity
create function public.catering_refund_resolve_anomaly(p_caller text, p_issue_id uuid, p_expected_generation bigint, p_action text,
  p_evidence_ref text, p_session_id uuid, p_target text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_adm record;
  v_actor uuid;
  v_role text;
  v_s record;
  v_issue record;
  v_w record;
  v_ev record;
  v_i record;
  v_r record;
  v_now timestamptz;
  v_before record;
  v_after record;
  v_old text;
  v_state text := 'resolved';
  v_members jsonb;
  v_sum bigint;
  v_n integer;
  v_ok boolean;
begin
  if p_issue_id is null or p_expected_generation is null or p_session_id is null or p_action is null
     or p_action not in ('resolve_event_floor', 'bind_verified_refund', 'treat_as_external', 'exclude_unrelated_hint', 'recheck_after_access',
                         'access_still_required', 'evidence_reviewed', 'keep_held', 'reopen_recheck', 'release_unsent', 'acknowledge_followup')
     or (p_evidence_ref is not null and p_evidence_ref !~ '^[A-Za-z0-9_.:/#-]{1,120}$')
     or (p_target is not null and p_target !~ '^[A-Za-z0-9_]{1,255}$') then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  select * into v_adm from public.catering_refund_admit(p_caller, 'work');
  v_now := clock_timestamp();
  -- The actor and the freshness of their password, from the session row itself.
  select s.user_id, s.step_up_unlocked, s.step_up_unlocked_at into v_s
    from public.sessions s where s.id = p_session_id and s.revoked_at is null and s.expires_at > v_now;
  if not found then raise exception 'forbidden' using errcode = 'P0001'; end if;
  v_actor := v_s.user_id;
  if v_s.step_up_unlocked is not true or v_s.step_up_unlocked_at is null or v_s.step_up_unlocked_at < v_now - interval '120 seconds' then
    raise exception 'step_up_stale' using errcode = 'P0001';
  end if;
  select i.* into v_issue from public.catering_refund_issues i where i.id = p_issue_id;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  select u.role into v_role from public.users u where u.id = v_actor and u.active for share;
  if v_role is null or not (v_role in ('owner', 'cgs') or (v_role = 'moo' and exists (
       select 1 from public.user_locations m where m.user_id = v_actor and m.location_id = v_issue.location_id and m.active))) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  perform 1 from public.catering_payments p where p.id = v_issue.payment_id for no key update;
  select * into v_w from public.catering_refund_payment_work w where w.payment_id = v_issue.payment_id for update;
  select i.* into v_issue from public.catering_refund_issues i where i.id = p_issue_id for update;
  if v_w.payment_id is null or v_w.generation <> p_expected_generation then raise exception 'stale_generation' using errcode = 'P0001'; end if;
  if v_issue.state = 'resolved' then raise exception 'issue_closed' using errcode = 'P0001'; end if;
  if p_action in ('resolve_event_floor', 'bind_verified_refund', 'treat_as_external', 'exclude_unrelated_hint', 'access_still_required',
                  'evidence_reviewed', 'keep_held', 'release_unsent') and p_evidence_ref is null then
    raise exception 'evidence_required' using errcode = 'P0001';
  end if;
  v_ok := case p_action
       when 'resolve_event_floor' then v_issue.code = 'awaiting_identity'
       when 'bind_verified_refund' then v_issue.code = 'ambiguous_binding'
       when 'treat_as_external' then v_issue.code = 'ambiguous_binding'
       when 'exclude_unrelated_hint' then v_issue.code in ('quarantined_hint', 'wrong_charge')
       when 'recheck_after_access' then v_issue.code in ('awaiting_identity', 'verified_unreadable', 'wrong_charge', 'owner_indeterminate', 'capture_review')
       when 'access_still_required' then v_issue.code in ('verified_unreadable', 'owner_indeterminate', 'awaiting_identity')
       when 'evidence_reviewed' then v_issue.code in ('refund_revived', 'released_request_has_refund', 'unfamiliar_identity', 'capture_review')
       when 'keep_held' then v_issue.blocking
       when 'reopen_recheck' then v_issue.state = 'held'
       when 'release_unsent' then v_issue.code = 'reserved_not_sent'
       when 'acknowledge_followup' then v_issue.code in ('reserved_not_sent', 'submission_unconfirmed', 'checkout_still_open', 'quarantined_hint', 'unfamiliar_identity')
       else false end;
  if v_ok is not true then
    raise exception 'invalid_action' using errcode = 'P0001';
  end if;
  select * into v_before from public.catering_refund_effective_figures(v_issue.payment_id, null);
  v_old := coalesce(v_issue.disposition, v_issue.state);

  if p_action = 'resolve_event_floor' then
    -- ONE event's floor. Needs a fresh complete pass at the current generation; cannot mark a refund succeeded,
    -- release a request, clear a second event, or authorize a Stripe POST.
    select * into v_ev from public.catering_refund_event_work x where x.event_id = v_issue.event_id and x.payment_id = v_issue.payment_id for update;
    if not found or v_ev.floor_state <> 'outstanding' then raise exception 'invalid_action' using errcode = 'P0001'; end if;
    if v_w.last_complete_generation is distinct from v_w.generation or v_w.last_complete_pass_at is null
       or v_w.last_complete_pass_at < v_now - interval '10 minutes' then
      raise exception 'stale_evidence' using errcode = 'P0001';
    end if;
    select coalesce(sum(i.amount_cents), 0), coalesce(jsonb_agg(jsonb_build_object('id', i.refund_id, 'amount_cents', i.amount_cents, 'class', i.class)
                                                                order by i.refund_id), '[]'::jsonb)
      into v_sum, v_members
      from public.catering_refund_identities i
     where i.payment_id = v_issue.payment_id and i.verified and not i.wrong_charge and i.excluded_at is null
       and v_ev.livemode = v_w.livemode and (v_ev.charge_id is null or v_ev.charge_id = v_w.charge_id)
       and v_ev.provider_created_at is not null and i.provider_created_at <= v_ev.provider_created_at
       and not (i.class = 'void' and i.void_evidence_at is not null and i.void_evidence_at <= v_ev.provider_created_at);
    update public.catering_refund_event_work x
       set floor_state = 'operator_resolved', floor_closed_at = v_now, floor_generation = v_w.generation + 1,
           disposition_by = v_actor, disposition_evidence_ref = p_evidence_ref,
           coverage = jsonb_build_object('operator_resolved', true, 'members', v_members, 'explained_cents', v_sum,
                                         'event_cumulative_cents', v_ev.floor_cents, 'remainder_cents', v_ev.floor_cents - v_sum,
                                         'event_id', v_ev.event_id, 'generation', v_w.generation + 1,
                                         'before', jsonb_build_object('deduction_cents', v_before.o_deduction, 'available_cents', v_before.o_available,
                                                                      'floor_cents', v_before.o_floor))
     where x.event_id = v_ev.event_id;
  elsif p_action in ('bind_verified_refund', 'treat_as_external') then
    if p_target is null then raise exception 'invalid_request' using errcode = 'P0001'; end if;
    select * into v_i from public.catering_refund_identities i where i.refund_id = p_target for update;
    select * into v_r from public.catering_refund_requests r where r.id = v_issue.request_id for update;
    if v_i.refund_id is null or v_i.payment_id <> v_issue.payment_id or not v_i.verified or v_i.wrong_charge or v_i.request_id is not null
       or v_r.id is null then
      raise exception 'invalid_action' using errcode = 'P0001';
    end if;
    if p_action = 'bind_verified_refund' then
      -- An unclaimed exact refund on this payment with the request's amount and currency. Never moves a binding.
      if v_i.external_at is not null or v_i.amount_cents <> v_r.amount_cents or v_i.currency is distinct from v_w.currency
         or v_r.stripe_refund_id is not null or exists (select 1 from public.catering_refund_identities x where x.request_id = v_r.id) then
        raise exception 'invalid_action' using errcode = 'P0001';
      end if;
      update public.catering_refund_identities i set request_id = v_r.id, candidate_request_id = v_r.id where i.refund_id = p_target;
      update public.catering_refund_requests r
         set stripe_refund_id = case when p_target ~ '^(re|pyr)_[A-Za-z0-9_]{1,250}$' then p_target else r.stripe_refund_id end,
             binding_hold = null, updated_at = v_now
       where r.id = v_r.id;
    else
      -- External money stays counted; it is simply no longer a candidate for this request.
      update public.catering_refund_identities i set external_at = v_now, candidate_request_id = null where i.refund_id = p_target;
      select count(*) into v_n from public.catering_refund_identities i
       where i.payment_id = v_issue.payment_id and i.candidate_request_id = v_r.id and i.verified and i.request_id is null
         and i.external_at is null and i.excluded_at is null;
      if v_n <= 1 then
        update public.catering_refund_requests r set binding_hold = null, updated_at = v_now where r.id = v_r.id and r.binding_hold = 'ambiguous_binding';
      else
        v_state := 'open'; -- more than one candidate is left: the ambiguity stands until the next choice
      end if;
    end if;
  elsif p_action = 'exclude_unrelated_hint' and v_issue.evidence_fingerprint like 'foreign:%' then
    -- The id is ANOTHER payment's (or its exact read names another PaymentIntent): nothing of this payment is excluded.
    -- The recorded disposition is what stops this payment being held by that id again (the apply reads it).
    null;
  elsif p_action = 'exclude_unrelated_hint' then
    if coalesce(p_target, v_issue.refund_id) is null then raise exception 'invalid_action' using errcode = 'P0001'; end if;
    select * into v_i from public.catering_refund_identities i where i.refund_id = coalesce(p_target, v_issue.refund_id) for update;
    -- Only a never-verified hint or wrong-charge evidence of THIS payment; a verified refund of this charge is money.
    if v_i.refund_id is null or v_i.payment_id <> v_issue.payment_id or (v_i.verified and not v_i.wrong_charge) then
      raise exception 'invalid_action' using errcode = 'P0001';
    end if;
    update public.catering_refund_identities i set excluded_at = v_now where i.refund_id = v_i.refund_id;
  elsif p_action in ('recheck_after_access', 'reopen_recheck') then
    v_state := 'open';
  elsif p_action in ('access_still_required', 'keep_held') then
    v_state := 'held';
  elsif p_action = 'evidence_reviewed' then
    -- A revived refund's hold is lifted. A RELEASED request keeps its marker for good: the human disposition is
    -- preserved, so a reviewed late refund never turns the released request into a success.
    update public.catering_refund_requests r set binding_hold = null, updated_at = v_now
     where r.id = v_issue.request_id and r.binding_hold = 'refund_revived';
    if v_issue.code = 'capture_review' and v_issue.evidence_fingerprint like 'immutable:%' and v_issue.refund_id is not null then
      -- The operator reviewed a refund whose immutable facts no longer read as verified: its facts are verified
      -- AFRESH by the next exact read (it is a hint again until then, and its binding is re-established by that read).
      update public.catering_refund_identities i
         set verified = false, class = null, request_id = null, candidate_request_id = coalesce(i.candidate_request_id, i.request_id), verified_at = null
       where i.refund_id = v_issue.refund_id and i.payment_id = v_issue.payment_id;
    end if;
  elsif p_action = 'release_unsent' then
    select * into v_r from public.catering_refund_requests r where r.id = v_issue.request_id for update;
    if v_r.id is null or v_r.status <> 'pending' or v_r.create_armed_at is not null or v_r.legacy_possibly_sent
       or (v_r.claimed_until is not null and v_r.claimed_until > v_now) or v_r.stripe_refund_id is not null
       or exists (select 1 from public.catering_refund_identities i where i.payment_id = v_issue.payment_id
                    and (i.request_id = v_r.id or i.candidate_request_id = v_r.id) and i.excluded_at is null) then
      raise exception 'invalid_action' using errcode = 'P0001';
    end if;
    update public.catering_refund_requests r
       set status = 'failed', last_error_code = 'released_unsent', last_error_message = 'Closed as never sent',
           claim_token = null, claimed_until = null, settled_at = v_now, updated_at = v_now
     where r.id = v_r.id;
  end if;

  update public.catering_refund_issues i
     set state = v_state, disposition = p_action, disposition_by = v_actor, disposition_at = v_now,
         evidence_ref = coalesce(p_evidence_ref, i.evidence_ref)
   where i.id = p_issue_id;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'stale_generation' using errcode = 'P0001'; end if;
  -- A disposition invalidates every staged read; a recheck is due at once.
  update public.catering_refund_payment_work w
     set generation = w.generation + 1, pass_token = null, updated_at = v_now,
         next_due_at = case when p_action in ('recheck_after_access', 'reopen_recheck', 'bind_verified_refund', 'treat_as_external',
                                              'exclude_unrelated_hint', 'resolve_event_floor', 'evidence_reviewed') then v_now else w.next_due_at end,
         retry_count = case when p_action in ('recheck_after_access', 'reopen_recheck') then 0 else w.retry_count end,
         last_complete_generation = case when p_action in ('resolve_event_floor', 'keep_held', 'access_still_required', 'evidence_reviewed',
                                                           'acknowledge_followup', 'release_unsent')
                                         and w.last_complete_generation = w.generation then w.generation + 1 else w.last_complete_generation end,
         restricted_at = case when exists (select 1 from public.catering_refund_issues s where s.payment_id = w.payment_id and s.state = 'held' and s.blocking)
                              then coalesce(w.restricted_at, v_now) else null end
   where w.payment_id = v_issue.payment_id;
  select * into v_after from public.catering_refund_effective_figures(v_issue.payment_id, null);
  insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
    values (v_actor, v_role, 'catering.refund.disposition', 'catering_refund_issues', p_issue_id,
            jsonb_build_object('payment_id', v_issue.payment_id, 'location_id', v_issue.location_id, 'issue_code', v_issue.code,
                               'action', p_action, 'old_disposition', v_old, 'new_disposition', p_action, 'new_state', v_state,
                               'evidence_ref', p_evidence_ref, 'event_id', v_issue.event_id, 'refund_id', coalesce(p_target, v_issue.refund_id),
                               'request_id', v_issue.request_id, 'generation', v_w.generation + 1,
                               'before', jsonb_build_object('deduction_cents', v_before.o_deduction, 'available_cents', v_before.o_available,
                                                            'floor_cents', v_before.o_floor, 'held', v_before.o_held),
                               'after', jsonb_build_object('deduction_cents', v_after.o_deduction, 'available_cents', v_after.o_available,
                                                           'floor_cents', v_after.o_floor, 'held', v_after.o_held)), true);
  return jsonb_build_object('result', 'ok', 'issue_id', p_issue_id, 'state', v_state, 'action', p_action, 'generation', v_w.generation + 1,
                            'held', v_after.o_held, 'available_cents', v_after.o_available);
end $$;

-- ── The sweep (worker; any open epoch) ──────────────────────────────────────────────────────────────────
-- Fair, SEPARATELY bounded due lists, each by indexed due time then a stable id. A deferred or blocked payment has
-- already moved its own due time back, so it cannot consume every run. There is no success-retirement age.
create function public.catering_refund_sweep_due(p_caller text, p_limit integer) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_adm record;
  v_now timestamptz;
  v_lim integer := least(greatest(coalesce(p_limit, 10), 1), 50);
begin
  select * into v_adm from public.catering_refund_admit(p_caller, 'work');
  v_now := clock_timestamp();
  return jsonb_build_object('epoch_state', v_adm.o_state, 'epoch_id', v_adm.o_epoch,
    'armed_unbound', (select coalesce(jsonb_agg(x.payment_id), '[]'::jsonb) from (
        select w.payment_id from public.catering_refund_payment_work w
         where w.next_due_at <= v_now and exists (select 1 from public.catering_refund_requests r where r.payment_id = w.payment_id
                 and r.status = 'pending' and r.stripe_refund_id is null and (r.create_armed_at is not null or r.legacy_possibly_sent))
         order by w.next_due_at, w.payment_id limit v_lim) x),
    'reserved_unarmed', (select coalesce(jsonb_agg(x.payment_id), '[]'::jsonb) from (
        select w.payment_id from public.catering_refund_payment_work w
         where w.next_due_at <= v_now and exists (select 1 from public.catering_refund_requests r where r.payment_id = w.payment_id
                 and r.status = 'pending' and r.create_armed_at is null and not r.legacy_possibly_sent)
         order by w.next_due_at, w.payment_id limit v_lim) x),
    'event_work', (select coalesce(jsonb_agg(x.payment_id), '[]'::jsonb) from (
        select w.payment_id from public.catering_refund_payment_work w
         where w.next_due_at <= v_now and exists (select 1 from public.catering_refund_event_work e where e.payment_id = w.payment_id
                 and e.state = 'attached' and (e.applied_at is null or e.floor_state = 'outstanding'))
         order by w.next_due_at, w.payment_id limit v_lim) x),
    'identity_polls', (select coalesce(jsonb_agg(x.payment_id), '[]'::jsonb) from (
        select i.payment_id from public.catering_refund_identities i join public.catering_refund_payment_work w on w.payment_id = i.payment_id
         where i.verified and i.next_poll_at is not null and i.next_poll_at <= v_now
           and not (w.retry_count > 0 and w.next_due_at > v_now) -- in its retry ladder: it comes back through its own due time
         group by i.payment_id order by min(i.next_poll_at), i.payment_id limit v_lim) x),
    'discovery', (select coalesce(jsonb_agg(x.payment_id), '[]'::jsonb) from (
        select w.payment_id from public.catering_refund_payment_work w
         where w.next_due_at <= v_now order by w.next_due_at, w.payment_id limit v_lim) x),
    'cleanup', (select coalesce(jsonb_agg(x.payment_id), '[]'::jsonb) from (
        select w.payment_id from public.catering_refund_payment_work w
         where w.checkout_cleanup_owed_at is not null and w.checkout_cleanup_done_at is null
         order by w.checkout_cleanup_owed_at, w.payment_id limit v_lim) x));
end $$;

-- Time-driven occurrences. One `reserved_not_sent` per live reservation still unarmed after 15 minutes with no live
-- claim (the second payment of a split tap; an expired first claim that never armed). `submission_unconfirmed` for
-- an armed row whose response is lost. Unmatched events park as `no_payment` after 24 hours of confirmed absence
-- (still indexed by PI: settlement reawakens them). An unexplained floor is marked aged at 24 hours.
create function public.catering_refund_sweep_housekeeping(p_caller text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_adm record;
  v_now timestamptz;
  v_r record;
  v_e record;
  v_pay record;
  v_unsent integer := 0; v_unconfirmed integer := 0; v_parked integer := 0; v_aged integer := 0; v_attached integer := 0;
begin
  select * into v_adm from public.catering_refund_admit(p_caller, 'work');
  v_now := clock_timestamp();
  for v_r in
    select r.id, r.payment_id, r.location_id, r.create_armed_at, r.legacy_possibly_sent,
           (select w.generation from public.catering_refund_payment_work w where w.payment_id = r.payment_id) as gen
      from public.catering_refund_requests r
     where r.status = 'pending' and r.stripe_refund_id is null and (r.claimed_until is null or r.claimed_until <= v_now)
       and ((r.create_armed_at is null and not r.legacy_possibly_sent and r.requested_at < v_now - interval '15 minutes')
         or ((r.create_armed_at is not null and r.create_armed_at < v_now - interval '180 seconds') or r.legacy_possibly_sent))
       and not exists (select 1 from public.catering_refund_issues s where s.request_id = r.id
             and s.code = case when r.create_armed_at is null and not r.legacy_possibly_sent then 'reserved_not_sent' else 'submission_unconfirmed' end)
     order by r.requested_at, r.id limit 200
  loop
    if v_r.create_armed_at is null and not v_r.legacy_possibly_sent then
      perform public.catering_refund_raise_issue('reserved_not_sent', v_r.payment_id, v_r.location_id, v_r.id, null, null,
        'request:' || v_r.id::text, false, coalesce(v_r.gen, 1), '{}'::jsonb);
      v_unsent := v_unsent + 1;
    else
      perform public.catering_refund_raise_issue('submission_unconfirmed', v_r.payment_id, v_r.location_id, v_r.id, null, null,
        'request:' || v_r.id::text, false, coalesce(v_r.gen, 1), '{}'::jsonb);
      v_unconfirmed := v_unconfirmed + 1;
    end if;
  end loop;
  -- Unmatched events: attach when their payment has settled since (a safety net behind settlement), else park.
  -- Payment locks are taken in payment-id order here too (the stated lock order), never in event order.
  for v_e in
    select e.event_id, e.received_at, p.id as pid, p.status as pstatus
      from public.catering_refund_event_work e
      left join lateral (select p.id, p.status from public.catering_payments p
                          where p.provider = 'stripe' and p.provider_ref = e.payment_intent_id order by p.id limit 1) p on true
     where e.state = 'unmatched' and e.restamped_at is null
     order by p.id nulls last, e.received_at, e.event_id limit 200
  loop
    if v_e.pid is not null and v_e.pstatus in ('paid', 'refunded') then
      perform 1 from public.catering_payments p where p.id = v_e.pid for no key update;
      if public.catering_refund_attach_event(v_e.event_id, v_e.pid) in ('attached', 'quarantined') then v_attached := v_attached + 1; end if;
    elsif v_e.pid is null and v_e.received_at < v_now - interval '24 hours' then
      update public.catering_refund_event_work e set state = 'no_payment', parked_at = v_now where e.event_id = v_e.event_id and e.state = 'unmatched';
      v_parked := v_parked + 1;
    end if;
  end loop;
  update public.catering_refund_issues s set aged_at = v_now
   where s.code = 'awaiting_identity' and s.state = 'open' and s.aged_at is null and s.opened_at < v_now - interval '24 hours';
  get diagnostics v_aged = row_count;
  return jsonb_build_object('epoch_state', v_adm.o_state, 'reserved_not_sent', v_unsent, 'submission_unconfirmed', v_unconfirmed,
                            'parked', v_parked, 'attached', v_attached, 'aged', v_aged);
end $$;

create function public.catering_refund_json_id(p jsonb) returns text
language sql immutable set search_path = pg_catalog, public as $$
  select case jsonb_typeof(p) when 'string' then p #>> '{}' when 'object' then p->>'id' end
$$;

-- RECOVERY SEEDING (recovering epochs only), in bounded, idempotent batches with the cursor persisted atomically
-- with each batch. Stage 1: every settled Stripe payment gets its work row and its retained ids (0357 bindings, the
-- legacy snapshot) as hints. Stage 2: every historical refund event on the webhook ledger -- whatever its verdict,
-- `ignored` included -- is imported by its ORIGINAL event id as provenance, hints and baseline discovery work, and
-- creates NO floor. A row a genuine signed ingress already wrote is never touched (on conflict do nothing), so a
-- seed cannot erase, demote or discharge a live-ingress floor. `location_mismatch` rows are quarantined evidence.
create function public.catering_refund_recovery_seed_batch(p_caller text, p_limit integer) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_adm record;
  v_ep record;
  v_cur jsonb;
  v_lim integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_now timestamptz;
  v_n integer := 0;
  v_p record;
  v_s record;
  v_obj jsonb;
  v_pi text;
  v_charge text;
  v_hints jsonb;
  v_last_id uuid;
  v_last_at timestamptz;
  v_last_ev text;
  v_pay record;
  v_new integer;
  v_stage text;
begin
  select * into v_adm from public.catering_refund_admit(p_caller, 'work');
  if v_adm.o_state <> 'recovering' then return jsonb_build_object('result', 'not_recovering', 'epoch_state', v_adm.o_state); end if;
  select * into v_ep from public.catering_refund_epochs e where e.id = v_adm.o_epoch for update;
  v_cur := v_ep.recovery_cursors;
  v_now := clock_timestamp();
  if coalesce((v_cur->>'payments_done')::boolean, false) is not true then
    v_stage := 'payments';
    for v_p in
      select p.id from public.catering_payments p
       where p.provider = 'stripe' and p.status in ('paid', 'refunded') and coalesce(p.provider_ref, '') ~ '^pi_[A-Za-z0-9_]{1,250}$'
         and (v_cur->>'payments_after' is null or p.id > (v_cur->>'payments_after')::uuid)
       order by p.id limit v_lim for no key update
    loop
      v_n := v_n + 1; v_last_id := v_p.id;
      if public.catering_refund_ensure_work(v_p.id, 'recovery') then
        select coalesce(jsonb_agg(jsonb_build_object('id', r.stripe_refund_id, 'request', r.id)), '[]'::jsonb) into v_hints
          from public.catering_refund_requests r where r.payment_id = v_p.id and r.stripe_refund_id is not null;
        perform public.catering_refund_register_hints(v_p.id, (select w.location_id from public.catering_refund_payment_work w where w.payment_id = v_p.id),
          v_hints, 'request_binding', null, 1);
        select coalesce(jsonb_agg(jsonb_build_object('id', x->>'id', 'status', x->>'status')), '[]'::jsonb), max(s.listed_at) into v_hints, v_last_at
          from public.catering_refund_stripe_snapshots s, jsonb_array_elements(s.refunds) x where s.payment_id = v_p.id;
        perform public.catering_refund_register_hints(v_p.id, (select w.location_id from public.catering_refund_payment_work w where w.payment_id = v_p.id),
          v_hints, 'snapshot', v_last_at, 1);
      end if;
    end loop;
    v_cur := v_cur || case when v_n < v_lim then jsonb_build_object('payments_done', true)
                           else jsonb_build_object('payments_after', v_last_id) end;
  else
    v_stage := 'events';
    for v_s in
      select s.id, s.type, s.livemode, s.received_at, s.payload, s.outcome from public.stripe_events s
       where s.type in ('charge.refunded', 'refund.created', 'refund.updated', 'refund.failed', 'charge.refund.updated')
         -- HISTORY only: received before this epoch opened, or carrying a terminal legacy verdict. A delivery of this
         -- epoch that is not finished yet (NULL / processing_failed) is live ingress and is never taken as a seed.
         and (s.received_at < v_ep.recovery_cutoff or (s.outcome is not null and s.outcome not in ('processing_failed', 'refund_state_owed')))
         and (v_cur->>'events_after_at' is null or (s.received_at, s.id) > ((v_cur->>'events_after_at')::timestamptz, v_cur->>'events_after_id'))
       order by s.received_at, s.id limit v_lim
    loop
      v_n := v_n + 1; v_last_at := v_s.received_at; v_last_ev := v_s.id;
      v_obj := v_s.payload->'data'->'object';
      v_pi := public.catering_refund_json_id(v_obj->'payment_intent');
      if v_s.type = 'charge.refunded' then
        v_charge := v_obj->>'id';
        select coalesce(jsonb_agg(jsonb_build_object('id', x->>'id', 'status', x->>'status')), '[]'::jsonb) into v_hints
          from jsonb_array_elements(case when jsonb_typeof(v_obj->'refunds'->'data') = 'array' then v_obj->'refunds'->'data' else '[]'::jsonb end) x
         where coalesce(x->>'id', '') ~ '^[A-Za-z0-9_]{1,255}$';
      else
        v_charge := public.catering_refund_json_id(v_obj->'charge');
        v_hints := case when coalesce(v_obj->>'id', '') ~ '^[A-Za-z0-9_]{1,255}$'
                        then jsonb_build_array(jsonb_build_object('id', v_obj->>'id', 'status', v_obj->>'status')) else '[]'::jsonb end;
      end if;
      insert into public.catering_refund_event_work (event_id, event_type, source, endpoint_location_id, livemode, payment_intent_id,
          charge_id, provider_created_at, cumulative_cents, charge_amount_cents, charge_fully_refunded, hints, state, legacy_verdict, received_at)
        values (v_s.id, v_s.type, 'recovery_seed', null, v_s.livemode,
                case when coalesce(v_pi, '') ~ '^pi_[A-Za-z0-9_]{1,250}$' then v_pi end,
                case when coalesce(v_charge, '') ~ '^[A-Za-z0-9_]{1,255}$' then v_charge end,
                case when jsonb_typeof(v_s.payload->'created') = 'number' and (v_s.payload->>'created')::numeric between 1 and 99999999999
                     then to_timestamp((v_s.payload->>'created')::numeric) end,
                case when v_s.type = 'charge.refunded' and jsonb_typeof(v_obj->'amount_refunded') = 'number'
                      and (v_obj->>'amount_refunded')::numeric >= 0 and (v_obj->>'amount_refunded')::numeric = trunc((v_obj->>'amount_refunded')::numeric)
                     then (v_obj->>'amount_refunded')::bigint end,
                case when v_s.type = 'charge.refunded' and jsonb_typeof(v_obj->'amount') = 'number'
                      and (v_obj->>'amount')::numeric >= 0 and (v_obj->>'amount')::numeric = trunc((v_obj->>'amount')::numeric)
                     then (v_obj->>'amount')::bigint end,
                case when v_s.type = 'charge.refunded' and jsonb_typeof(v_obj->'refunded') = 'boolean' then (v_obj->>'refunded')::boolean end,
                v_hints, 'unmatched', left(v_s.outcome, 40), v_s.received_at)
      on conflict (event_id) do nothing;
      get diagnostics v_new = row_count;
      if v_new = 1 and coalesce(v_pi, '') ~ '^pi_[A-Za-z0-9_]{1,250}$' then
        select p.id, p.status into v_pay from public.catering_payments p
         where p.provider = 'stripe' and p.provider_ref = v_pi order by p.id limit 1 for no key update;
        if found and v_pay.status in ('paid', 'refunded') then
          perform public.catering_refund_attach_event(v_s.id, v_pay.id);
        end if;
      end if;
    end loop;
    if v_n > 0 then
      v_cur := v_cur || jsonb_build_object('events_after_at', v_last_at, 'events_after_id', v_last_ev);
    end if;
    if v_n < v_lim then v_cur := v_cur || jsonb_build_object('events_done', true); end if;
  end if;
  update public.catering_refund_epochs e
     set recovery_cursors = v_cur,
         recovery_complete_at = case when coalesce((v_cur->>'payments_done')::boolean, false) and coalesce((v_cur->>'events_done')::boolean, false)
                                     then coalesce(e.recovery_complete_at, v_now) else null end
   where e.id = v_ep.id;
  return jsonb_build_object('result', 'seeded', 'stage', v_stage, 'rows', v_n,
                            'complete', coalesce((v_cur->>'payments_done')::boolean, false) and coalesce((v_cur->>'events_done')::boolean, false));
end $$;

-- Post-reversal checkout cleanup: the report of what closeQuoteCheckouts did after a `refunded -> paid` commit.
-- Anything still open stays owed (the sweep resumes it after a crash) and is raised to staff; nothing is ever
-- reimbursed automatically.
create function public.catering_refund_cleanup_done(p_caller text, p_payment_id uuid, p_complete boolean, p_report jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_adm record; v_w record; v_now timestamptz;
begin
  if p_payment_id is null or p_complete is null or (p_report is not null and (jsonb_typeof(p_report) <> 'object' or length(p_report::text) > 2000)) then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  select * into v_adm from public.catering_refund_admit(p_caller, 'work');
  perform 1 from public.catering_payments p where p.id = p_payment_id for no key update;
  select * into v_w from public.catering_refund_payment_work w where w.payment_id = p_payment_id for update;
  if not found or v_w.checkout_cleanup_owed_at is null then return jsonb_build_object('result', 'not_owed'); end if;
  v_now := clock_timestamp();
  update public.catering_refund_payment_work w
     set checkout_cleanup_done_at = case when p_complete then v_now else null end, checkout_cleanup_report = coalesce(p_report, '{}'::jsonb), updated_at = v_now
   where w.payment_id = p_payment_id;
  if not p_complete or coalesce((p_report->>'still_open')::integer, 0) > 0 or coalesce((p_report->>'completing')::integer, 0) > 0
     or coalesce((p_report->>'already_paid_duplicates')::integer, 0) > 0 then
    perform public.catering_refund_raise_issue('checkout_still_open', p_payment_id, v_w.location_id, null, null, null,
      'cleanup:' || v_w.checkout_cleanup_owed_at::text || ':' || md5(coalesce(p_report, '{}'::jsonb)::text), false, v_w.generation, coalesce(p_report, '{}'::jsonb));
  end if;
  return jsonb_build_object('result', case when p_complete then 'done' else 'still_owed' end);
end $$;

-- What the job watch needs, in one read, without raising: the epoch (the earliest heartbeat expectation) and the
-- OLDEST DUE, ACTIONABLE obligation without progress. Excluded: healthy future polls, parked foreign PIs,
-- quarantined hints, existing manual follow-ups (an open issue is already with staff) and restricted payments with
-- a current disposition. A genuinely overdue EVENT on such a payment stays visible. The fingerprint changes with
-- new evidence (the payment's generation), so an aged occurrence is alerted once per obligation and evidence.
create function public.catering_refund_watch_state(p_caller text) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_state jsonb := public.catering_refund_epoch_state(p_caller);
  v_now timestamptz := clock_timestamp();
  v_ob record;
begin
  if (v_state->>'state') not in ('recovering', 'live', 'draining') then return jsonb_build_object('epoch', v_state, 'aged', null); end if;
  select * into v_ob from (
    select 'event' as kind, e.event_id as key, e.received_at as due_at, w.generation, w.location_id
      from public.catering_refund_event_work e join public.catering_refund_payment_work w on w.payment_id = e.payment_id
     where e.source = 'ingress' and e.state = 'attached' and e.applied_at is null and e.restamped_at is null
    union all
    select 'payment', w.payment_id::text, least(coalesce(w.oldest_unresolved_at, 'infinity'::timestamptz), w.next_due_at), w.generation, w.location_id
      from public.catering_refund_payment_work w
     where w.restricted_at is null
       and not exists (select 1 from public.catering_refund_issues s where s.payment_id = w.payment_id and s.state in ('open', 'held'))
  ) x where x.due_at < v_now - interval '24 hours' order by x.due_at, x.key limit 1;
  if not found then return jsonb_build_object('epoch', v_state, 'aged', null); end if;
  return jsonb_build_object('epoch', v_state, 'aged', jsonb_build_object('kind', v_ob.kind, 'due_at', v_ob.due_at, 'location_id', v_ob.location_id,
    'fingerprint', md5(v_ob.kind || ':' || v_ob.key || ':' || v_ob.generation::text)));
end $$;

-- ── Privileges, stated and not inherited ────────────────────────────────────────────────────────────────
do $$
declare f regprocedure;
begin
  -- Every function of this file: nothing for PUBLIC, anon, authenticated or service_role ...
  for f in select p.oid::regprocedure from pg_proc p
            where p.pronamespace = 'public'::regnamespace and (p.proname like 'catering\_refund\_%' or p.proname = 'claim_cron_route') loop
    if f::text not in ('catering_refund_actor_ok(uuid,uuid)', 'catering_refund_figures(uuid)', 'claim_cron_route(text)') then
      execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    else
      execute format('revoke all on function %s from public, anon, authenticated', f);
    end if;
  end loop;
  -- ... and then EXECUTE for service_role on the worker surface only. Trigger, private and operator-only lifecycle
  -- functions keep nothing but the owner.
  foreach f in array array[
    'public.catering_refund_epoch_state(text)'::regprocedure,
    'public.catering_refund_effective_figures(uuid, uuid)'::regprocedure,
    'public.catering_refund_summary(text, uuid[])'::regprocedure,
    'public.catering_refund_reserve_admitted(text, uuid, uuid, uuid, uuid, bigint, text, text, text)'::regprocedure,
    'public.catering_refund_claim_admitted(text, uuid, uuid, uuid)'::regprocedure,
    'public.catering_refund_arm(text, uuid, uuid, uuid, uuid, bigint, text, text, boolean)'::regprocedure,
    'public.catering_refund_finish(text, uuid, uuid, text, text, text, text)'::regprocedure,
    'public.catering_refund_release(text, uuid, uuid, uuid, bigint, boolean)'::regprocedure,
    'public.catering_refund_event_register(text, text, text, uuid, boolean, text, text, bigint, bigint, bigint, boolean, jsonb)'::regprocedure,
    'public.catering_refund_settlement_attach(text, uuid)'::regprocedure,
    'public.catering_refund_pass_begin(text, uuid, uuid)'::regprocedure,
    'public.catering_refund_pass_remember(text, uuid, uuid, jsonb, text, integer)'::regprocedure,
    'public.catering_refund_apply(text, uuid, uuid, bigint, jsonb)'::regprocedure,
    'public.catering_refund_defer(text, uuid, uuid, text, integer)'::regprocedure,
    'public.catering_refund_resolve_anomaly(text, uuid, bigint, text, text, uuid, text)'::regprocedure,
    'public.catering_refund_sweep_due(text, integer)'::regprocedure,
    'public.catering_refund_sweep_housekeeping(text)'::regprocedure,
    'public.catering_refund_recovery_seed_batch(text, integer)'::regprocedure,
    'public.catering_refund_cleanup_done(text, uuid, boolean, jsonb)'::regprocedure,
    'public.catering_refund_watch_state(text)'::regprocedure] loop
    execute format('grant execute on function %s to service_role', f);
  end loop;
  grant execute on function public.catering_refund_actor_ok(uuid, uuid) to service_role;
  grant execute on function public.catering_refund_figures(uuid) to service_role;
  grant execute on function public.claim_cron_route(text) to service_role;
end $$;

-- ── Assertions (raise = nothing in this file is kept) ───────────────────────────────────────────────────
do $$
declare
  f regprocedure;
  r text;
  t text;
  c text;
  v_acl text;
  v_n integer;
  v_worker text[] := array[
    'catering_refund_epoch_state(text)', 'catering_refund_effective_figures(uuid,uuid)', 'catering_refund_summary(text,uuid[])',
    'catering_refund_reserve_admitted(text,uuid,uuid,uuid,uuid,bigint,text,text,text)', 'catering_refund_claim_admitted(text,uuid,uuid,uuid)',
    'catering_refund_arm(text,uuid,uuid,uuid,uuid,bigint,text,text,boolean)', 'catering_refund_finish(text,uuid,uuid,text,text,text,text)',
    'catering_refund_release(text,uuid,uuid,uuid,bigint,boolean)',
    'catering_refund_event_register(text,text,text,uuid,boolean,text,text,bigint,bigint,bigint,boolean,jsonb)',
    'catering_refund_settlement_attach(text,uuid)', 'catering_refund_pass_begin(text,uuid,uuid)',
    'catering_refund_pass_remember(text,uuid,uuid,jsonb,text,integer)', 'catering_refund_apply(text,uuid,uuid,bigint,jsonb)',
    'catering_refund_defer(text,uuid,uuid,text,integer)', 'catering_refund_resolve_anomaly(text,uuid,bigint,text,text,uuid,text)',
    'catering_refund_sweep_due(text,integer)', 'catering_refund_sweep_housekeeping(text)',
    'catering_refund_recovery_seed_batch(text,integer)', 'catering_refund_cleanup_done(text,uuid,boolean,jsonb)',
    'catering_refund_watch_state(text)', 'catering_refund_actor_ok(uuid,uuid)', 'catering_refund_figures(uuid)', 'claim_cron_route(text)'];
begin
  -- (1) Every function of the refund family: exactly the expected set, each either worker (owner + service_role,
  -- no grant option) or closed (owner only). PUBLIC (grantee 0), anon and authenticated hold nothing anywhere.
  select count(*) into v_n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'catering\_refund\_%';
  if v_n <> 48 then raise exception '0359: the catering_refund_* function family has % members, expected 48', v_n; end if;
  for f in select p.oid::regprocedure from pg_proc p
            where p.pronamespace = 'public'::regnamespace and (p.proname like 'catering\_refund\_%' or p.proname = 'claim_cron_route') loop
    foreach r in array array['public', 'anon', 'authenticated'] loop
      if has_function_privilege(r, f, 'EXECUTE') then raise exception '0359: % may execute % (RPC escape)', r, f; end if;
    end loop;
    if exists (select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = f and a.grantee = 0) then
      raise exception '0359: PUBLIC holds a privilege on %', f;
    end if;
    if exists (select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.oid = f and a.grantee <> p.proowner and (a.grantee <> 'service_role'::regrole::oid or a.is_grantable)) then
      raise exception '0359: % has an unexpected grantee or a grant option in its ACL', f;
    end if;
    if f::text = any(v_worker) then
      if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception '0359: service_role cannot execute %', f; end if;
    elsif has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '0359: service_role may execute % (trigger, private, operator-only or withdrawn)', f;
    end if;
    -- SECURITY DEFINER with the pinned path (the two trigger functions are invoker by design, path pinned all the same).
    if not (select p.proconfig is not null and array_length(p.proconfig, 1) = 1
                   and replace(p.proconfig[1], ' ', '') = 'search_path=pg_catalog,public' from pg_proc p where p.oid = f) then
      raise exception '0359: % does not have the pinned search_path', f;
    end if;
    if (select p.prosecdef from pg_proc p where p.oid = f)
       is distinct from (f::text not in ('catering_refund_requests_guard()', 'catering_refund_outcomes_append_only()',
                                         'catering_refund_install_manifest()', 'catering_refund_class_of(text)', 'catering_refund_json_id(jsonb)')) then
      raise exception '0359: % has the wrong security mode', f;
    end if;
  end loop;
  foreach t in array v_worker loop
    if to_regprocedure('public.' || t) is null then raise exception '0359: worker function public.% is missing', t; end if;
  end loop;

  -- (2) The seven new tables: RLS on, exactly the four explicit denies, and the WHOLE ACL is the owner's alone.
  foreach t in array array['catering_refund_install_contracts', 'catering_refund_epochs', 'catering_refund_payment_work',
                           'catering_refund_identities', 'catering_refund_event_work', 'catering_payment_refund_outcomes',
                           'catering_refund_issues'] loop
    if not (select cl.relrowsecurity from pg_class cl where cl.oid = ('public.' || t)::regclass) then raise exception '0359: RLS is off on %', t; end if;
    select coalesce(string_agg(po.polname || ':' || po.polcmd::text || ':' || po.polpermissive::text, ',' order by po.polname), '') into v_acl
      from pg_policy po where po.polrelid = ('public.' || t)::regclass;
    if v_acl <> t || '_no_user_delete:d:true,' || t || '_no_user_insert:a:true,' || t || '_no_user_select:r:true,' || t || '_no_user_update:w:true' then
      raise exception '0359: the policies of % are not the four explicit denies (%)', t, v_acl;
    end if;
    select coalesce(string_agg(x.e, ',' order by x.e), '') into v_acl from (
      select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end || '=' || a.privilege_type as e
        from pg_class cl, lateral aclexplode(coalesce(cl.relacl, acldefault('r', cl.relowner))) a
       where cl.oid = ('public.' || t)::regclass and a.grantee <> cl.relowner) x;
    if v_acl <> '' then raise exception '0359: the ACL of % is not the owner''s alone (%)', t, v_acl; end if;
    if exists (select 1 from pg_attribute att where att.attrelid = ('public.' || t)::regclass and att.attnum > 0 and not att.attisdropped and att.attacl is not null) then
      raise exception '0359: % carries a column grant', t;
    end if;
    foreach r in array array['public', 'anon', 'authenticated', 'service_role'] loop
      foreach c in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
        if has_table_privilege(r, 'public.' || t, c) then raise exception '0359: % holds % on %', r, c, t; end if;
      end loop;
      foreach c in array array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] loop
        if has_any_column_privilege(r, 'public.' || t, c) then raise exception '0359: % holds column % on %', r, c, t; end if;
      end loop;
    end loop;
  end loop;

  -- (3) 0357's two tables after the withdrawal: service_role SELECT only, and NO column grant left.
  foreach t in array array['public.catering_refund_requests', 'public.catering_refund_stripe_snapshots'] loop
    if not (select cl.relrowsecurity from pg_class cl where cl.oid = t::regclass) then raise exception '0359: RLS is off on %', t; end if;
    if exists (select 1 from pg_policy po where po.polrelid = t::regclass) then raise exception '0359: % has a policy', t; end if;
    select coalesce(string_agg(x.e, ',' order by x.e), '') into v_acl from (
      select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end || '=' || a.privilege_type
             || case when a.is_grantable then '*' else '' end as e
        from pg_class cl, lateral aclexplode(coalesce(cl.relacl, acldefault('r', cl.relowner))) a
       where cl.oid = t::regclass and a.grantee <> cl.relowner) x;
    if v_acl <> 'service_role=SELECT' then raise exception '0359: the ACL of % is not service_role=SELECT (%)', t, v_acl; end if;
    if exists (select 1 from pg_attribute att where att.attrelid = t::regclass and att.attnum > 0 and not att.attisdropped and att.attacl is not null) then
      raise exception '0359: % still carries a column grant (the nine UPDATE grants must be withdrawn)', t;
    end if;
    foreach r in array array['public', 'anon', 'authenticated', 'service_role'] loop
      if has_any_column_privilege(r, t, 'UPDATE') or has_any_column_privilege(r, t, 'INSERT') then
        raise exception '0359: % can still write a column of %', r, t;
      end if;
    end loop;
  end loop;

  -- (4) The guard trigger is still 0357's binding, and the outcomes table is append-only by trigger.
  if (select count(*) from pg_trigger tg where tg.tgrelid = 'public.catering_refund_requests'::regclass
        and tg.tgname = 'catering_refund_requests_guard' and not tg.tgisinternal and tg.tgenabled = 'O'
        and tg.tgfoid = 'public.catering_refund_requests_guard()'::regprocedure and tg.tgtype = 19
        and tg.tgattr::text = '' and tg.tgqual is null and tg.tgnargs = 0) <> 1
     or (select count(*) from pg_trigger tg where tg.tgrelid = 'public.catering_refund_requests'::regclass and not tg.tgisinternal) <> 1 then
    raise exception '0359: the catering_refund_requests_guard trigger is not 0357''s BEFORE UPDATE row trigger';
  end if;
  if (select count(*) from pg_trigger tg where tg.tgrelid = 'public.catering_payment_refund_outcomes'::regclass
        and tg.tgname = 'catering_payment_refund_outcomes_append_only' and not tg.tgisinternal and tg.tgenabled = 'O' and tg.tgtype = 27) <> 1 then
    raise exception '0359: the outcomes append-only trigger is missing or is not BEFORE UPDATE OR DELETE FOR EACH ROW';
  end if;

  -- (5) The indexes this file's due lists and fences rest on.
  foreach t in array array['catering_refund_install_contracts_current', 'catering_refund_epochs_one_open', 'catering_refund_payment_work_due',
                           'catering_refund_identities_payment', 'catering_refund_identities_poll', 'catering_refund_event_work_pi',
                           'catering_refund_event_work_payment', 'catering_refund_event_work_unmatched', 'catering_refund_event_work_floors',
                           'catering_refund_issues_open', 'catering_refund_requests_attempted_unbound', 'catering_refund_requests_unarmed',
                           'catering_payment_refund_outcomes_payment'] loop
    if not exists (select 1 from pg_index ix where ix.indexrelid = to_regclass('public.' || t) and ix.indisvalid) then
      raise exception '0359: index public.% is missing or invalid', t;
    end if;
  end loop;

  -- (6) 0358's authority is unchanged, and the cron lease holds exactly the nine names.
  if (select md5(regexp_replace(p.prosrc, '[^\x21-\x7E]+', '', 'g')) from pg_proc p
       where p.oid = 'public.catering_refund_actor_ok(uuid, uuid)'::regprocedure) <> '4076029ec89d7b777af23ff3d8fcbdee' then
    raise exception '0359: catering_refund_actor_ok is no longer 0358''s';
  end if;
  if public.catering_refund_actor_ok(null, null) is distinct from false then raise exception '0359: catering_refund_actor_ok(null, null) did not answer false'; end if;
  if (select array_agg(m[1] order by m[1]) from regexp_matches(
        (select pg_get_constraintdef(co.oid) from pg_constraint co where co.conrelid = 'public.cron_route_leases'::regclass
           and co.conname = 'cron_route_leases_job_check' and co.convalidated), '''([a-z0-9-]+)''', 'g') m)
       is distinct from array['catering-inbox-delivery', 'catering-refund-sweep', 'demand-signals', 'fact-build', 'meta-leads', 'schedule-draft',
                              'sevenshifts-sync', 'toast-catering-scan', 'toast-sales-today'] then
    raise exception '0359: cron_route_leases_job_check is not the nine-job union';
  end if;

  -- (7) Dark: no epoch, no install record yet, and a 0359-only database cannot open recovery.
  if exists (select 1 from public.catering_refund_epochs) or exists (select 1 from public.catering_refund_install_contracts) then
    raise exception '0359: an epoch or an install record exists before this file wrote one';
  end if;
end $$;

-- ── The install record: written LAST, only after every assertion above passed ───────────────────────────
insert into public.catering_refund_install_contracts (part, version, migration) values ('B1', 'b1-1', '0359_catering_refund_reconciler');

commit;
