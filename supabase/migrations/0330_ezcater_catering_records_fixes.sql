-- Migration 0330_ezcater_catering_records_fixes
-- AUTHORED 2026-11-15. NOT YET APPLIED - sim first, prod on Juan's word.
-- Provenance: bug-audit wave W23 "ezCater orders and catering customer records" (found at 7494f738).
--   Bugs B126 (owner decision W23-1 a), B127, B129 (owner decision W23-4 b), B209. Reviewed plan:
--   audit/plans/W23.md. B125, B128, B130, B207, B208 and B210 are TypeScript only (same PR).
--   W23-5 b (orders linked to a shop whose ezCater mapping was cleared) is the SEPARATE 0331.
-- WHAT:
--   1. B129 - create_catering_company(actor, name, notes, domains[]) (NEW): the company row and its
--      auto-attribution domains in ONE transaction. A domain another company already holds raises
--      `domain_taken` and the company insert rolls back with it. Before, the app committed the
--      company first and a refused domain left it behind, so the operator's retry made a second
--      company with the same name. Domain RULES (normalize, a dot, not a personal domain) stay in
--      TypeScript (lib/catering/companies.ts normalizeCompanyDomain), the one place they live, and
--      run before this is called. SECURITY DEFINER, service_role only.
--   2. B129, owner decision W23-4 b - switch off the EMPTY duplicate companies already in prod
--      (active = false; reversible with active = true; nothing is deleted). A company is an empty
--      duplicate when it is active, unclaimed, has NO domain row (active or not), NO contact, and
--      another active company with the same name (trimmed, case-insensitive) was created after it.
--      The newest of a name is never picked, so one company per name always stays. GUARDED: the
--      applier runs the read-only listing (the SELECT in step 2 below, also at the top of the PR),
--      shows it to Juan, then applies in a session where
--        select set_config('co_ops.w23_company_switchoff', '<that exact count>', false);
--      was run first. A different count (more OR fewer rows than the listing found) refuses the
--      whole migration. A count of 0 needs nothing. AUDITED: one `catering.company.deactivate_duplicate`
--      row per company (destructive, actor_context migration_apply).
--   3. B127 - customer_orders_sync_ezcater_cancelled() (NEW): a customer_orders link to an ezCater
--      order that is cancelled (status /cancel|reject|fail/, its lead Lost, or a loss notification
--      still pending) is marked voided_at (0312's column: counted nowhere, shown "voided"); the mark
--      is cleared if the order is un-cancelled. Touches source_kind = 'ezcater' rows only (0312's
--      customer_orders_sync_voided keeps the Toast rows). Never deletes. The app also stops linking
--      cancelled orders (lib/customers/customers.ts linkCateringOrders) and calls this after linking.
--      It needs 0312's customer_orders.voided_at at CALL time, not at create time (PL/pgSQL resolves
--      columns when it runs), so 0330 and 0312 apply in either order; until both are in, the app
--      treats the call as unavailable (42883 / 42703) and changes nothing.
--   4. B126, owner decision W23-1 a - reopen_ezcater_lead(lead, actor) (NEW): the one human path out
--      of Lost for an ezCater lead whose order ezCater UN-cancelled. Refuses by name unless: the actor
--      is active at level 6+ (`reopen_forbidden`), the lead is an ezCater lead (`reopen_not_ezcater`)
--      and still Lost under the lock (`reopen_not_lost`), a signed `uncancelled` notification is newer
--      than every signed cancelled/rejected/failed one (`reopen_no_uncancel`), and the order is no
--      longer cancelled (`reopen_still_cancelled`). Target: Confirmed when ezCater's status is
--      "accepted" (inquiry = not paid yet), else Inquiry. Writes the stage and one pipeline event;
--      the app (lib/catering/pipeline.ts reopenEzcaterLead) binds the shop first, re-reserves prep on
--      Confirmed and audits `catering.pipeline.reopen`. canTransition and the board are unchanged.
--   5. B209 - reconcile_ezcater_toast(from, to) <- 0229, ONE change: it no longer takes one advisory
--      lock per ezCater order EVER stored (at ~64 x max_connections orders that is "out of shared
--      memory" and every capture tick fails). It plans, takes the provider locks only for the orders
--      this run will retire or insert links for, re-plans, and repeats until the plan needs no new
--      lock (at most 4 rounds, else `ezcater_reconcile_unstable`). The write block is 0229's,
--      verbatim. plan_ezcater_toast (0231) is untouched.
-- LOCK ORDER: create_catering_company and the switch-off take no advisory lock. reopen_ezcater_lead
--   takes the provider lock, then the lead row FOR UPDATE (apply / transfer's order). The reconciler
--   keeps the global reconcile lock first; it then takes provider locks in sorted batches while it
--   holds NO row lock (the planner only reads), so a later batch cannot form a cycle: every other
--   provider-lock taker (apply_ezcater_order, transfer_catering_lead) holds exactly one provider lock
--   and never waits for the reconcile lock, and publish_ezcater_shadow takes the reconcile lock first.
-- ROLLOUT: SQL and app in either order. Before apply the app keeps working: createCompany falls back
--   to its pre-checked two-step write, the customer link skips cancelled orders and reports
--   voided: null, and Reopen answers 503 `reopen_unavailable`. Read-only checks before apply:
--     -- (a) W23-4 b: the empty duplicate companies this migration switches off (count = the ack)
--     select c.id, c.name, c.created_at from public.catering_companies c
--      where c.active and c.claimed_by_customer_id is null
--        and not exists (select 1 from public.catering_company_domains d where d.company_id = c.id)
--        and not exists (select 1 from public.catering_customers u where u.company_id = c.id)
--        and exists (select 1 from public.catering_companies k where k.active and k.id <> c.id
--          and lower(btrim(k.name)) = lower(btrim(c.name)) and (k.created_at, k.id) > (c.created_at, c.id))
--      order by lower(btrim(c.name)), c.created_at;
--     -- (b) B127: links to cancelled ezCater orders the first run of "link catering" marks voided
--     select count(*) from public.customer_orders co join public.ezcater_orders o on o.id = co.ezcater_order_id
--       left join public.catering_pipeline p on p.id = o.lead_id
--      where co.source_kind = 'ezcater' and (lower(coalesce(o.status,'')) ~ '(cancel|reject|fail)'
--        or p.stage = 'lost' or coalesce(o.pending_event_key,'') in ('cancelled','rejected','failed'));
--     -- (c) B126: lost ezCater leads a manager may now reopen
--     select p.id from public.catering_pipeline p where p.stage = 'lost' and p.lead_source = 'ezcater'
--       and exists (select 1 from public.ezcater_events e where e.entity_id = p.external_ref and e.signature_valid
--         and e.event_key = 'uncancelled');
-- VERIFY AFTER APPLY:
--   select strpos(pg_get_functiondef('public.reconcile_ezcater_toast(date,date)'::regprocedure), 'v_locked') > 0; -- t
--   select routine_name, grantee from information_schema.routine_privileges where routine_schema = 'public'
--     and routine_name in ('create_catering_company','customer_orders_sync_ezcater_cancelled','reopen_ezcater_lead',
--       'reconcile_ezcater_toast'); -- service_role (+ postgres)
--   Then watch the next capture-intraday ticks (reconcile runs 2-3 planner passes per tick now).
-- PROOF: scripts/sql-harness-0330.mjs (PGlite, offline; pinned by tests/ezcater-w23-migration.test.ts).
--   The lock-count proof at scale (about 4,000 orders, out of shared memory before, success after)
--   needs a real server: scripts/sim/ezcater-0330-reconcile-lock-check-management.mjs, sim only, run by CC.
-- ROLLBACK: forward-only. Re-emit 0229's reconcile body in a NEW migration; a switched-off company is
--   switched back on with active = true (its audit row names it); never rewrite history.
begin;

-- ───────────────────────────── pre-flight: refuse drift before any DDL ─────────────────────────────
do $$
declare v_def text; v_dupes bigint; v_ack text;
begin
  if to_regprocedure('public.create_catering_company(uuid,text,text,text[])') is not null
     or to_regprocedure('public.customer_orders_sync_ezcater_cancelled()') is not null
     or to_regprocedure('public.reopen_ezcater_lead(uuid,uuid)') is not null then
    raise exception '0330: already applied';
  end if;
  if to_regprocedure('public.reconcile_ezcater_toast(date,date)') is null
     or to_regprocedure('public.plan_ezcater_toast()') is null then
    raise exception '0330: missing reconcile_ezcater_toast / plan_ezcater_toast (0229, 0231)';
  end if;
  v_def := pg_get_functiondef('public.reconcile_ezcater_toast(date,date)'::regprocedure);
  if strpos(v_def, 'perform pg_advisory_xact_lock(hashtext(provider_uuid)) from public.ezcater_orders order by provider_uuid;') = 0
     or strpos(v_def, '''ezcater.toast_reconciled''') = 0 then
    raise exception '0330: reconcile_ezcater_toast drifted from 0229';
  end if;
  if to_regclass('public.catering_companies') is null or to_regclass('public.catering_company_domains') is null
     or to_regclass('public.catering_pipeline') is null or to_regclass('public.catering_pipeline_events') is null
     or to_regclass('public.ezcater_events') is null or to_regclass('public.ezcater_orders') is null
     or to_regclass('public.customer_orders') is null or to_regclass('public.ezcater_toast_links') is null
     or to_regclass('public.audit_log') is null then
    raise exception '0330: missing a table this migration reads or writes';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'catering_company_domains_one_active') then
    raise exception '0330: catering_company_domains_one_active missing (0122)';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'catering_companies' and column_name = 'claimed_by_customer_id') then
    raise exception '0330: catering_companies.claimed_by_customer_id missing (0124)';
  end if;
  -- W23-4 b: the switch-off is never silent. See the header for the acknowledgement.
  select count(*) into v_dupes from public.catering_companies c
   where c.active and c.claimed_by_customer_id is null
     and not exists (select 1 from public.catering_company_domains d where d.company_id = c.id)
     and not exists (select 1 from public.catering_customers u where u.company_id = c.id)
     and exists (select 1 from public.catering_companies k where k.active and k.id <> c.id
       and lower(btrim(k.name)) = lower(btrim(c.name)) and (k.created_at, k.id) > (c.created_at, c.id));
  v_ack := current_setting('co_ops.w23_company_switchoff', true);
  if v_dupes > 0 and v_ack is distinct from v_dupes::text then
    raise exception '0330: % empty duplicate catering company(ies) would be switched off (owner decision W23-4 b); run the listing, show it to Juan, and acknowledge it with set_config(''co_ops.w23_company_switchoff'', ''%'', false) before applying (got %)', v_dupes, v_dupes, coalesce(v_ack, 'none');
  end if;
  raise notice '0330 preflight: % empty duplicate catering company(ies) to switch off (W23-4 b)', v_dupes;
end $$;

-- ───────────────────────────── 1. B129: one transaction for a company and its domains ─────────────────────────────
create function public.create_catering_company(p_actor_id uuid, p_name text, p_notes text, p_domains text[])
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_company uuid; v_domain text; v_id uuid; v_ids uuid[] := '{}';
begin
  -- Parity with COMPANY_WRITE_MIN (6): the level-6+ role codes of lib/roles.ts, active only.
  if not exists (select 1 from public.users where id = p_actor_id and active
      and role in ('agm','catering_mgr','prep_mgr','social_media_mgr','gm','moo','owner','cgs')) then
    raise exception 'company_forbidden';
  end if;
  if nullif(btrim(p_name), '') is null then raise exception 'company_invalid_name'; end if;
  insert into public.catering_companies(name, notes, created_by, updated_by)
    values (btrim(p_name), p_notes, p_actor_id, p_actor_id) returning id into v_company;
  foreach v_domain in array coalesce(p_domains, '{}'::text[]) loop
    begin
      insert into public.catering_company_domains(company_id, domain, created_by)
        values (v_company, v_domain, p_actor_id) returning id into v_id;
    exception when unique_violation then
      -- Re-raised by name: the whole call aborts, so the company row above rolls back with it.
      raise exception 'domain_taken';
    end;
    v_ids := v_ids || v_id;
  end loop;
  return jsonb_build_object('company_id', v_company, 'domain_ids', to_jsonb(v_ids));
end $$;
revoke all on function public.create_catering_company(uuid,text,text,text[]) from public, anon, authenticated;
grant execute on function public.create_catering_company(uuid,text,text,text[]) to service_role;

-- ───────────────────────────── 2. W23-4 b: switch off the empty duplicates (guarded, audited) ─────────────────────────────
do $$
declare v_expected bigint; v_done bigint; v_ack text;
begin
  create temporary table w23_duplicate_companies on commit drop as
  select c.id, c.name from public.catering_companies c
   where c.active and c.claimed_by_customer_id is null
     and not exists (select 1 from public.catering_company_domains d where d.company_id = c.id)
     and not exists (select 1 from public.catering_customers u where u.company_id = c.id)
     and exists (select 1 from public.catering_companies k where k.active and k.id <> c.id
       and lower(btrim(k.name)) = lower(btrim(c.name)) and (k.created_at, k.id) > (c.created_at, c.id));
  select count(*) into v_expected from pg_temp.w23_duplicate_companies;
  v_ack := current_setting('co_ops.w23_company_switchoff', true);
  -- Same rule as the pre-flight, re-checked on the set this step will write.
  if v_expected > 0 and v_ack is distinct from v_expected::text then
    raise exception '0330: duplicate-company set changed since the pre-flight (% now, ack %)', v_expected, coalesce(v_ack, 'none');
  end if;
  update public.catering_companies c set active = false, updated_at = clock_timestamp(), updated_by = null
    from pg_temp.w23_duplicate_companies d where c.id = d.id and c.active;
  get diagnostics v_done = row_count;
  if v_done <> v_expected then
    raise exception '0330: switched off % company(ies), the listing found %', v_done, v_expected;
  end if;
  insert into public.audit_log(actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
  select null, null, 'catering.company.deactivate_duplicate', 'catering_companies', d.id,
    jsonb_build_object('actor_context', 'migration_apply', 'migration', '0330_ezcater_catering_records_fixes',
      'decision', 'W23-4 b', 'bug', 'B129', 'reason', 'empty_duplicate_of_a_later_same_name_company',
      'reversible', 'set active = true'), true
  from pg_temp.w23_duplicate_companies d;
  raise notice '0330: switched off % empty duplicate catering company(ies) (W23-4 b)', v_done;
end $$;

-- ───────────────────────────── 3. B127: cancelled ezCater orders stop counting for a customer ─────────────────────────────
create function public.customer_orders_sync_ezcater_cancelled()
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_voided int; v_restored int;
begin
  -- The same cancellation rule as lib/ezcater/lifecycle-shared.ts isEzcaterOrderCancelled.
  update public.customer_orders co set voided_at = clock_timestamp()
  from public.ezcater_orders o left join public.catering_pipeline p on p.id = o.lead_id
  where co.source_kind = 'ezcater' and co.ezcater_order_id = o.id and co.voided_at is null
    and (lower(coalesce(o.status, '')) ~ '(cancel|reject|fail)' or p.stage = 'lost'
      or coalesce(o.pending_event_key, '') in ('cancelled', 'rejected', 'failed'));
  get diagnostics v_voided = row_count;
  -- An un-cancelled order counts again.
  update public.customer_orders co set voided_at = null
  from public.ezcater_orders o left join public.catering_pipeline p on p.id = o.lead_id
  where co.source_kind = 'ezcater' and co.ezcater_order_id = o.id and co.voided_at is not null
    and not (lower(coalesce(o.status, '')) ~ '(cancel|reject|fail)' or coalesce(p.stage, '') = 'lost'
      or coalesce(o.pending_event_key, '') in ('cancelled', 'rejected', 'failed'));
  get diagnostics v_restored = row_count;
  return jsonb_build_object('voided', v_voided, 'restored', v_restored);
end $$;
revoke all on function public.customer_orders_sync_ezcater_cancelled() from public, anon, authenticated;
grant execute on function public.customer_orders_sync_ezcater_cancelled() to service_role;

-- ───────────────────────────── 4. B126: reopen an un-cancelled ezCater lead ─────────────────────────────
create function public.reopen_ezcater_lead(p_lead_id uuid, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_provider text; v_stage text; v_status text; v_pending text; v_loss timestamptz; v_unc timestamptz; v_target text;
begin
  -- Parity with PIPELINE_WRITE_MIN (6); the shop bind is the app's (assertCanWriteLead), before this call.
  if not exists (select 1 from public.users where id = p_actor_id and active
      and role in ('agm','catering_mgr','prep_mgr','social_media_mgr','gm','moo','owner','cgs')) then
    raise exception 'reopen_forbidden';
  end if;
  select external_ref into v_provider from public.catering_pipeline
   where id = p_lead_id and lead_source = 'ezcater' and nullif(btrim(external_ref), '') is not null;
  if v_provider is null then raise exception 'reopen_not_ezcater'; end if;
  -- Same lock order as apply_ezcater_order / transfer_catering_lead: provider advisory, then the lead.
  perform pg_advisory_xact_lock(hashtext(v_provider));
  select stage into v_stage from public.catering_pipeline where id = p_lead_id for update;
  if v_stage is distinct from 'lost' then raise exception 'reopen_not_lost'; end if;
  select max(received_at) filter (where event_key in ('cancelled','rejected','failed')),
         max(received_at) filter (where event_key = 'uncancelled')
    into v_loss, v_unc
    from public.ezcater_events where entity_id = v_provider and signature_valid;
  if v_unc is null or (v_loss is not null and v_unc <= v_loss) then raise exception 'reopen_no_uncancel'; end if;
  select status, pending_event_key into v_status, v_pending from public.ezcater_orders where provider_uuid = v_provider;
  if lower(coalesce(v_status, '')) ~ '(cancel|reject|fail)' or coalesce(v_pending, '') in ('cancelled','rejected','failed') then
    raise exception 'reopen_still_cancelled';
  end if;
  -- Owner decision W23-1 a: accepted = confirmed (inquiry = not paid yet).
  v_target := case when lower(coalesce(v_status, '')) = 'accepted' then 'confirmed' else 'inquiry' end;
  update public.catering_pipeline set stage = v_target, updated_at = clock_timestamp()
   where id = p_lead_id and stage = 'lost';
  insert into public.catering_pipeline_events(pipeline_id, from_stage, to_stage, note, actor_id)
    values (p_lead_id, 'lost', v_target, 'Reopened after ezCater un-cancel', p_actor_id);
  return jsonb_build_object('from_stage', 'lost', 'to_stage', v_target);
end $$;
revoke all on function public.reopen_ezcater_lead(uuid,uuid) from public, anon, authenticated;
grant execute on function public.reopen_ezcater_lead(uuid,uuid) to service_role;

-- ───────────────────────────── 5. B209: reconcile_ezcater_toast <- 0229, provider locks bounded ─────────────────────────────
create or replace function public.reconcile_ezcater_toast(p_from date,p_to date) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare changed integer:=0; retired integer:=0; resolved integer:=0;
 v_locked text[]:='{}'; v_need text[]; v_round integer:=0;
begin
 if p_from is null or p_to is null or p_to<p_from then raise exception 'ezcater_reconcile_invalid_range'; end if;
 perform pg_advisory_xact_lock(hashtext('ezcater-toast-reconcile'));
 create temporary table ezcater_reconcile_plan on commit drop as select * from public.plan_ezcater_toast() with no data;
 -- W23/B209: lock only the providers this run will WRITE (the same predicates as the retire and
 -- insert below), then re-plan under those locks until the plan needs no new lock. 0229 locked
 -- every ezCater order ever stored, one advisory lock each, before any row lock.
 loop
  v_round:=v_round+1;
  truncate pg_temp.ezcater_reconcile_plan;
  insert into pg_temp.ezcater_reconcile_plan select * from public.plan_ezcater_toast();
  select coalesce(array_agg(distinct o.provider_uuid order by o.provider_uuid),'{}') into v_need
  from public.ezcater_orders o where o.id in (
   select l.order_id from public.ezcater_toast_links l where l.is_current and not exists(
   select 1 from pg_temp.ezcater_reconcile_plan x where x.order_id=l.order_id and x.snapshot_id=l.snapshot_id
   and x.location_id=l.location_id and x.toast_snapshot_id=l.toast_snapshot_id and x.order_guid=l.order_guid
   and x.check_guid=l.check_guid and x.selection_guid=l.selection_guid and x.business_date=l.business_date and x.evidence=l.evidence
   and x.amount_diff_cents is not distinct from l.amount_diff_cents and x.amount_mismatch=l.amount_mismatch
   and x.reconciliation_details=l.reconciliation_details)
   union
   select x.order_id from pg_temp.ezcater_reconcile_plan x where not exists(
   select 1 from public.ezcater_toast_links l where l.is_current and l.order_id=x.order_id and l.location_id=x.location_id
   and l.check_guid=x.check_guid and l.selection_guid=x.selection_guid))
  and not (o.provider_uuid=any(v_locked));
  exit when cardinality(v_need)=0;
  if v_round>4 then raise exception 'ezcater_reconcile_unstable'; end if;
  -- Acquire the same provider locks as snapshot/transfer/publisher, sorted, before row locks.
  perform pg_advisory_xact_lock(hashtext(p)) from unnest(v_need) p order by p;
  v_locked:=v_locked||v_need;
 end loop;
 -- Plan globally: a batch's D presence/fallback must not depend on the caller's window.
 -- Publishing globally also retires previously linked cancelled/transferred orders.
 update public.ezcater_toast_links l set is_current=false where l.is_current and not exists(
 select 1 from pg_temp.ezcater_reconcile_plan x where x.order_id=l.order_id and x.snapshot_id=l.snapshot_id
 and x.location_id=l.location_id and x.toast_snapshot_id=l.toast_snapshot_id and x.order_guid=l.order_guid
 and x.check_guid=l.check_guid and x.selection_guid=l.selection_guid and x.business_date=l.business_date and x.evidence=l.evidence
 and x.amount_diff_cents is not distinct from l.amount_diff_cents and x.amount_mismatch=l.amount_mismatch
 and x.reconciliation_details=l.reconciliation_details);
 get diagnostics retired=row_count;
 insert into public.ezcater_toast_links(order_id,snapshot_id,location_id,toast_snapshot_id,order_guid,check_guid,selection_guid,business_date,evidence,amount_diff_cents,amount_mismatch,reconciliation_details)
 select x.* from pg_temp.ezcater_reconcile_plan x where not exists(
 select 1 from public.ezcater_toast_links l where l.is_current and l.order_id=x.order_id and l.location_id=x.location_id
 and l.check_guid=x.check_guid and l.selection_guid=x.selection_guid);
 get diagnostics changed=row_count;
 perform 1 from public.ezcater_review_queue q join public.ezcater_reconciliation_status s on s.order_id=q.order_id
 and s.location_id=q.location_id where q.source='toast' and q.code='unmatched_code' and q.resolved_at is null
 and s.event_date between p_from and p_to order by q.id for update of q;
 insert into public.ezcater_review_resolutions(review_id,rule)
 select q.id,coalesce(s.rule,'not_rung_in_toast') from public.ezcater_review_queue q join public.ezcater_reconciliation_status s on s.order_id=q.order_id
 and s.location_id=q.location_id where q.source='toast' and q.code='unmatched_code' and q.resolved_at is null
 and s.event_date between p_from and p_to on conflict(review_id) do nothing;
 get diagnostics resolved=row_count;
 update public.ezcater_review_queue q set resolved_at=r.created_at from public.ezcater_review_resolutions r
 where r.review_id=q.id and q.resolved_at is null;
 if changed+retired+resolved>0 then
 insert into public.audit_log(actor_id,actor_role,action,resource_table,resource_id,metadata,destructive)
 values(null,null,'ezcater.toast_reconciled','ezcater_toast_links',null,
 jsonb_build_object('added',changed,'retired',retired,'resolved',resolved,'from',p_from,'to',p_to),false);
 end if;
 drop table pg_temp.ezcater_reconcile_plan;
 return jsonb_build_object('added',changed,'retired',retired,'resolved',resolved);
end $$;
revoke all on function public.reconcile_ezcater_toast(date,date) from public,anon,authenticated;
grant execute on function public.reconcile_ezcater_toast(date,date) to service_role;

-- ───────────────────────────── closing: no RPC grant escaped ─────────────────────────────
do $$
declare f regprocedure;
begin
  foreach f in array array[
    'public.create_catering_company(uuid,text,text,text[])'::regprocedure,
    'public.customer_orders_sync_ezcater_cancelled()'::regprocedure,
    'public.reopen_ezcater_lead(uuid,uuid)'::regprocedure,
    'public.reconcile_ezcater_toast(date,date)'::regprocedure
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
      or not has_function_privilege('service_role', f, 'EXECUTE')
      or exists (select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.oid = f and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      raise exception '0330: RPC execution grant escaped for %', f;
    end if;
    if exists (select 1 from pg_proc where oid = f and (not prosecdef or
      not ('search_path=pg_catalog, public' = any(coalesce(proconfig, '{}'::text[]))))) then
      raise exception '0330: RPC execution context escaped for %', f;
    end if;
  end loop;
end $$;

INSERT INTO public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
VALUES (NULL, NULL, 'security.grants_change', 'catering_companies', NULL, true,
  jsonb_build_object('actor_context', 'migration_apply', 'migration', '0330_ezcater_catering_records_fixes',
    'change', 'company + domains in one transaction; cancelled ezCater links voided; reopen an un-cancelled ezCater lead; reconcile locks only the providers it writes',
    'bugs', jsonb_build_array('B126', 'B127', 'B129', 'B209')));
commit;
