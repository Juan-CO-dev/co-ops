-- 0336 Meta lead ad refs (item 1, PR A). AUTHORED 2026-11-16, NOT applied.
-- Apply order: SIM first (CC runs the acceptance list in the PR body / plan r2 §7), then PROD on
-- Juan's word, BEFORE the app that calls the 7-argument meta_lead_record merges (the app's call is
-- coupled to this signature). Stamp this header with the schema_migrations versions in the same or
-- the next PR. No database access during authoring; proof: scripts/sql-harness-0336.mjs (PGlite,
-- the real 0300 then this file, CI-pinned by tests/meta-leads-migration.test.ts).
--
-- What it adds (additive only; nothing is dropped but the exact 0300 five-argument function, which
-- is recreated in the SAME transaction with two trailing nullable parameters):
--   * meta_lead_events.ad_id / adset_id      — the Graph Lead node's ids, written under the worker's
--                                              lease (meta_lead_record_ad_refs) or by the terminal-only
--                                              backfill helper (meta_lead_backfill_ad_refs);
--   * meta_lead_events.webhook_ad_id /
--     webhook_adgroup_id                     — the leadgen webhook's ids, written once at receipt;
--     adgroup_id's meaning is UNVERIFIED (it may equal ad_id): stored under its own name, never
--     treated as the ad set;
--   * meta_lead_events.ad_refs_at            — when a Graph id was first filled.
-- Attribution is never identity and never fails a receipt or an intake: every id goes through
-- meta_ad_ref(), which answers NULL (never raises) for '' or anything but 1–30 digits. Every fill is
-- null-only: a stored id is never overwritten (a later, different value counts as 'unchanged').
-- A duplicate receipt still changes nothing (ON CONFLICT DO NOTHING, as 0300).
-- Lock order: the ad-ref writers take ONE row lock (the receipt row, FOR UPDATE) and nothing else —
-- the meta_lead_fail pattern; no advisory lock, no new edge.
-- Privileges: the table stays service_role SELECT only (no column grants); the four functions this
-- file creates are service_role EXECUTE only; every other 0300 function's ACL is re-ASSERTED (not
-- re-granted). Ad ids are service-role data; managers see aggregates only (later phase).
--
-- ROLLBACK (documented, NOT run): roll back the APP first (the 6f34d736 app calls meta_lead_record
-- with five named arguments, which this file keeps working). The columns are never dropped. Only if
-- the five-argument function itself must return, after no deployment calls the 7-argument form:
--   begin;
--   drop function public.meta_lead_record(text,text,text,timestamptz,boolean,text,text);
--   drop function public.meta_lead_record_ad_refs(text,uuid,text,text);
--   drop function public.meta_lead_backfill_ad_refs(text,text,text);
--   -- recreate public.meta_lead_record(text,text,text,timestamptz,boolean) verbatim from 0300,
--   revoke all on function public.meta_lead_record(text,text,text,timestamptz,boolean) from public, anon, authenticated, service_role;
--   grant execute on function public.meta_lead_record(text,text,text,timestamptz,boolean) to service_role;
--   notify pgrst, 'reload schema';
--   commit;
-- (meta_ad_ref may stay; it reads nothing.)
begin;

-- Pre-flight: refuse a re-apply and refuse 0300 drift, by name, before any DDL.
do $$
declare v_count integer; v_src text;
begin
  if to_regclass('public.meta_lead_events') is null then raise exception '0336: missing 0300 meta_lead_events'; end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='meta_lead_events'
      and column_name in ('ad_id','adset_id','webhook_ad_id','webhook_adgroup_id','ad_refs_at'))
    or to_regprocedure('public.meta_ad_ref(text)') is not null
    or to_regprocedure('public.meta_lead_record_ad_refs(text,uuid,text,text)') is not null
    or to_regprocedure('public.meta_lead_backfill_ad_refs(text,text,text)') is not null then
    raise exception '0336: already applied';
  end if;
  select count(*) into v_count from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='meta_lead_record';
  if v_count<>1 or to_regprocedure('public.meta_lead_record(text,text,text,timestamptz,boolean)') is null then
    raise exception '0336: meta_lead_record drift (expected exactly the 0300 five-argument function, found % overloads)', v_count;
  end if;
  select prosrc into v_src from pg_proc where oid='public.meta_lead_record(text,text,text,timestamptz,boolean)'::regprocedure;
  -- md5 of the 0300 body with carriage returns removed (a CRLF checkout must not read as drift).
  if md5(replace(v_src, chr(13), '')) is distinct from 'f48b9e0a3255ab943f623d462ba85a73' then
    raise exception '0336: meta_lead_record drift (body differs from 0300)';
  end if;
end $$;

alter table public.meta_lead_events
  add column ad_id text check (ad_id ~ '^[0-9]{1,30}$'),
  add column adset_id text check (adset_id ~ '^[0-9]{1,30}$'),
  add column webhook_ad_id text check (webhook_ad_id ~ '^[0-9]{1,30}$'),
  add column webhook_adgroup_id text check (webhook_adgroup_id ~ '^[0-9]{1,30}$'),
  add column ad_refs_at timestamptz;

-- Attribution never raises: '' / malformed / over-long / NULL → NULL; whitespace is trimmed.
create function public.meta_ad_ref(p text)
returns text language sql immutable set search_path=pg_catalog,public as $$
  select case when btrim(p) ~ '^[0-9]{1,30}$' then btrim(p) else null end
$$;

drop function public.meta_lead_record(text,text,text,timestamptz,boolean);
create function public.meta_lead_record(p_leadgen_id text,p_page_id text,p_form_id text,p_created_at timestamptz,p_enabled boolean,
  p_webhook_ad_id text default null,p_webhook_adgroup_id text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id text;
begin
  insert into public.meta_lead_events(leadgen_id,page_id,form_id,provider_created_at,state,webhook_ad_id,webhook_adgroup_id)
  values(p_leadgen_id,p_page_id,p_form_id,p_created_at,case when p_enabled is true then 'received' else 'disabled' end,
    public.meta_ad_ref(p_webhook_ad_id),public.meta_ad_ref(p_webhook_adgroup_id))
  on conflict(leadgen_id) do nothing returning leadgen_id into v_id;
  return jsonb_build_object('inserted',v_id is not null);
end $$;

-- The live writer: only the CURRENT lease holder, checked after the row lock; null-only fill.
create function public.meta_lead_record_ad_refs(p_leadgen_id text,p_lease_id uuid,p_ad_id text,p_adset_id text)
returns text language plpgsql security definer set search_path=pg_catalog,public as $$
declare e public.meta_lead_events%rowtype; v_ad text := public.meta_ad_ref(p_ad_id); v_adset text := public.meta_ad_ref(p_adset_id);
begin
  select * into e from public.meta_lead_events where leadgen_id=p_leadgen_id for update;
  if not found then return 'not_found'; end if;
  if e.state<>'processing' or p_lease_id is null or e.lease_id is distinct from p_lease_id or e.lease_until<=clock_timestamp() then
    return 'stale_lease';
  end if;
  if (e.ad_id is null and v_ad is not null) or (e.adset_id is null and v_adset is not null) then
    update public.meta_lead_events set ad_id=coalesce(ad_id,v_ad),adset_id=coalesce(adset_id,v_adset),ad_refs_at=clock_timestamp()
      where leadgen_id=p_leadgen_id;
    return 'recorded';
  end if;
  return 'unchanged';
end $$;

-- The backfill helper: TERMINAL receipts only, checked after the row lock; touches ad_id, adset_id
-- and ad_refs_at and nothing else (never state, attempts, the lease, email_*, snapshot or ids).
create function public.meta_lead_backfill_ad_refs(p_leadgen_id text,p_ad_id text,p_adset_id text)
returns text language plpgsql security definer set search_path=pg_catalog,public as $$
declare e public.meta_lead_events%rowtype; v_ad text := public.meta_ad_ref(p_ad_id); v_adset text := public.meta_ad_ref(p_adset_id);
begin
  select * into e from public.meta_lead_events where leadgen_id=p_leadgen_id for update;
  if not found then return 'not_found'; end if;
  if e.state not in ('created','attached','needs_human') or e.lease_id is not null then return 'not_terminal'; end if;
  if (e.ad_id is null and v_ad is not null) or (e.adset_id is null and v_adset is not null) then
    update public.meta_lead_events set ad_id=coalesce(ad_id,v_ad),adset_id=coalesce(adset_id,v_adset),ad_refs_at=clock_timestamp()
      where leadgen_id=p_leadgen_id;
    return 'recorded';
  end if;
  return 'unchanged';
end $$;

-- Privileges: the 0300 table ceiling re-asserted (RLS stays on, its delete policy untouched), the
-- new functions service_role only, every other 0300 function's ACL asserted unchanged.
do $$ declare r text; privilege text; f regprocedure; begin
  revoke all on public.meta_lead_events from public, anon, authenticated, service_role;
  grant select on public.meta_lead_events to service_role;
  assert (select relrowsecurity from pg_class where oid='public.meta_lead_events'::regclass),'0336: meta_lead_events RLS off';
  foreach r in array array['anon','authenticated','service_role'] loop
    foreach privilege in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      assert has_table_privilege(r,'public.meta_lead_events',privilege)=(r='service_role' and privilege='SELECT'),'0336: meta table privilege escape';
    end loop;
    assert not has_any_column_privilege(r,'public.meta_lead_events','INSERT') and not has_any_column_privilege(r,'public.meta_lead_events','UPDATE')
      and not has_any_column_privilege(r,'public.meta_lead_events','REFERENCES')
      and has_any_column_privilege(r,'public.meta_lead_events','SELECT')=(r='service_role'),'0336: meta column privilege escape';
  end loop;
  assert not exists(select 1 from pg_attribute a where a.attrelid='public.meta_lead_events'::regclass and a.attnum>0 and a.attacl is not null),'0336: meta column grant added';
  assert not exists(select 1 from pg_class c,lateral aclexplode(c.relacl) a where c.oid='public.meta_lead_events'::regclass and a.grantee=0),'0336: meta PUBLIC table escape';
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='meta_lead_record')=1,'0336: meta_lead_record overload';
  foreach f in array array[
    'public.meta_ad_ref(text)'::regprocedure,
    'public.meta_lead_record(text,text,text,timestamptz,boolean,text,text)'::regprocedure,
    'public.meta_lead_record_ad_refs(text,uuid,text,text)'::regprocedure,
    'public.meta_lead_backfill_ad_refs(text,text,text)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
  foreach f in array array[
    'public.meta_ad_ref(text)'::regprocedure,
    'public.meta_lead_record(text,text,text,timestamptz,boolean,text,text)'::regprocedure,
    'public.meta_lead_record_ad_refs(text,uuid,text,text)'::regprocedure,
    'public.meta_lead_backfill_ad_refs(text,text,text)'::regprocedure,
    'public.meta_lead_claim(text,uuid)'::regprocedure,
    'public.meta_lead_fail(text,uuid,text,boolean,text[])'::regprocedure,
    'public.meta_lead_intake_apply(text,uuid,uuid,uuid,uuid,jsonb,text[])'::regprocedure,
    'public.customer_consent_record_explicit(text,text,text,timestamptz,text,text)'::regprocedure,
    'public.meta_lead_email_claim(text)'::regprocedure,
    'public.meta_lead_email_result(text,text,uuid,text)'::regprocedure,
    'public.portal_intake_attach(uuid,uuid,jsonb)'::regprocedure,
    'public.claim_cron_route(text)'::regprocedure
  ] loop
    assert not has_function_privilege('anon',f,'EXECUTE') and not has_function_privilege('authenticated',f,'EXECUTE') and has_function_privilege('service_role',f,'EXECUTE'),'0336: meta RPC escape '||f::text;
    assert not exists(select 1 from pg_proc p,lateral aclexplode(p.proacl) a where p.oid=f and a.grantee=0),'0336: meta PUBLIC RPC escape '||f::text;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
