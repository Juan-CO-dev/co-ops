-- Migration 0289_marketing_scorecard
-- AUTHORED 2026-11-01. NOT YET APPLIED - sim first, prod on Juan's word, AFTER 0287 (0288 reserved).
-- APPLIED TO SIM 2026-11-01 (schema_migrations version 20261102033734, name '0289_marketing_scorecard').
-- APPLIED TO PROD 2026-11-02 (schema_migrations version 20261102054004, name '0289_marketing_scorecard').
-- Provenance: reviewed marketing-scorecard BUILD SPEC and CC's binding rulings.
-- REFUSALS: entry_overlaps (overlapping live spend periods); code_not_found (missing
-- registry code; its i18n key ships in chunk 5), already_retired (existing inactive code).
-- ROLLOUT: keep all flags OFF; verify the counter is empty, apply on sim, run the
-- Management API concurrency proof, then apply on prod only on Juan's word.
-- VERIFY: run scripts/sql-harness-0289.mjs offline; inspect effective ACLs and
-- owners below, then prove two concurrent registry creates allocate distinct slots.
-- ROLLBACK: keep flags OFF. Retain append-only evidence; any SQL reversal is a
-- new migration. Never restore UTC bucketing over populated ET counter rows.
begin;

do $$ begin
  if to_regclass('public.marketing_milestones') is not null then
    raise exception '0289: already installed';
  end if;
end $$;
-- Match the increment's registry -> counter order before checking emptiness.
-- An in-flight increment cannot escape preflight or deadlock the re-key.
lock table public.landing_ad_codes in access exclusive mode;
lock table public.landing_order_click_counts in access exclusive mode;
do $$ begin
  if exists(select 1 from public.landing_order_click_counts) then
    raise exception '0289: counter must be empty';
  end if;
end $$;
alter table public.landing_ad_codes add constraint landing_ad_codes_code_slot unique(code, slot);
alter table public.landing_order_click_counts
  add column day_et date not null,
  add column ad_slot smallint not null,
  drop constraint landing_order_click_counts_pkey,
  add primary key(day_et, store_key, ad_slot),
  add foreign key(ad_code, ad_slot) references public.landing_ad_codes(code, slot);

create or replace function public.increment_landing_order_click(p_store_key text, p_ad_code text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_ad text; v_slot smallint;
begin
  if p_store_key is null or p_store_key not in ('capitol-hill', 'dupont') then
    raise exception 'invalid_store' using errcode = '22023';
  end if;
  if p_ad_code is null or length(p_ad_code) > 64 then
    raise exception 'invalid_ad' using errcode = '22023';
  end if;
  select code, slot into v_ad, v_slot from public.landing_ad_codes
    where code = p_ad_code and active for share;
  if not found then
    select code, slot into v_ad, v_slot from public.landing_ad_codes where code = 'unattributed';
  end if;
  insert into public.landing_order_click_counts(day_utc, day_et, store_key, ad_code, ad_slot, click_count)
  values ((clock_timestamp() at time zone 'UTC')::date, (now() at time zone 'America/New_York')::date,
    p_store_key, v_ad, v_slot, 1)
  on conflict(day_et, store_key, ad_slot) do update
    set click_count = public.landing_order_click_counts.click_count + 1;
end $$;
revoke all on function public.increment_landing_order_click(text,text) from public, anon, authenticated, service_role;
grant execute on function public.increment_landing_order_click(text,text) to service_role;

create table public.marketing_milestones (
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in ('first_ad_spend','landing_live','counter_on','capi_on')),
  milestone_date date not null,
  corrects_id uuid unique references public.marketing_milestones(id),
  reason text check(length(reason) <= 300 and length(btrim(reason)) > 0),
  recorded_by uuid not null references public.users(id),
  recorded_at timestamptz not null default clock_timestamp(),
  check(corrects_id is null or reason is not null)
);
create unique index marketing_milestones_root on public.marketing_milestones(kind) where corrects_id is null;
create table public.marketing_manual_entries (
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in ('meta_spend','promo_spend','email_list_size')),
  location_id uuid references public.locations(id),
  platform text,
  period_start date not null,
  period_end date not null check(period_end >= period_start and period_end - period_start <= 29),
  amount_cents bigint check(amount_cents between 0 and 100000000),
  list_count integer check(list_count >= 0),
  note text check(length(note) <= 200),
  corrects_id uuid unique references public.marketing_manual_entries(id),
  reason text check(length(reason) <= 300 and length(btrim(reason)) > 0),
  recorded_by uuid not null references public.users(id),
  recorded_at timestamptz not null default clock_timestamp(),
  check(corrects_id is null or reason is not null),
  check((kind = 'promo_spend' and platform is not null and platform in ('uber_eats','doordash','grubhub','other'))
    or (kind <> 'promo_spend' and platform is null)),
  check((kind = 'email_list_size' and period_start = period_end and list_count is not null and amount_cents is null)
    or (kind in ('meta_spend','promo_spend') and amount_cents is not null and list_count is null and period_end = period_start + 6)),
  check(kind <> 'meta_spend' or location_id is null)
);
create unique index marketing_manual_entries_root on public.marketing_manual_entries
  (kind, location_id, platform, period_start, period_end) nulls not distinct where corrects_id is null;
create table public.marketing_baseline_snapshots (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid not null references public.marketing_milestones(id),
  window_from date not null,
  window_to date not null check(window_to = window_from + 27),
  kpi_version smallint not null check(kpi_version > 0),
  payload jsonb not null check(octet_length(payload::text) <= 65536),
  coverage jsonb not null,
  corrects_id uuid unique references public.marketing_baseline_snapshots(id),
  reason text check(length(reason) <= 300 and length(btrim(reason)) > 0),
  recorded_by uuid not null references public.users(id),
  recorded_at timestamptz not null default clock_timestamp(),
  check(corrects_id is null or reason is not null)
);
create unique index marketing_baseline_snapshots_root on public.marketing_baseline_snapshots(milestone_id) where corrects_id is null;

-- Generate identical deny-all policy names and SELECT-only ceilings for all ledgers.
do $$ declare t text; begin
  foreach t in array array['marketing_milestones','marketing_manual_entries','marketing_baseline_snapshots'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using(false)', t || '_read', t);
    execute format('create policy %I on public.%I for insert with check(false)', t || '_no_user_insert', t);
    execute format('create policy %I on public.%I for update using(false) with check(false)', t || '_no_user_update', t);
    execute format('create policy %I on public.%I for delete using(false)', t || '_no_user_delete', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on table public.%I to service_role', t);
  end loop;
end $$;
-- Retire 0273's direct registry write grants, including its column ACL.
revoke all on public.landing_ad_codes from public, anon, authenticated, service_role;
revoke update(active) on public.landing_ad_codes from public, anon, authenticated, service_role;
grant select on public.landing_ad_codes to service_role;

-- Owner-only internal helper. Actor comes from the verified session, never request JSON.
create function public.marketing_assert_actor(p_actor uuid) returns text
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_role text;
begin
  select role::text into v_role from public.users where id = p_actor and active for share;
  if v_role is null or v_role not in ('moo','owner','cgs') then raise exception 'actor_not_allowed'; end if;
  return v_role;
end $$;
revoke all on function public.marketing_assert_actor(uuid) from public, anon, authenticated, service_role;

create function public.record_marketing_milestone(p_actor uuid, p_kind text, p_date date, p_corrects uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_role text; v_head public.marketing_milestones%rowtype; v_id uuid; v_today date;
begin
  v_role := public.marketing_assert_actor(p_actor);
  if p_kind is null or p_kind not in ('first_ad_spend','landing_live','counter_on','capi_on') then raise exception 'entry_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('marketing:milestone:' || p_kind, 0));
  v_today := (clock_timestamp() at time zone 'America/New_York')::date;
  if p_date is null or p_date < v_today - 365 or p_date > v_today + 365 then raise exception 'date_invalid'; end if;
  select m.* into v_head from public.marketing_milestones m where kind = p_kind
    and not exists(select 1 from public.marketing_milestones c where c.corrects_id = m.id);
  if p_corrects is distinct from v_head.id then raise exception 'correction_target_not_head'; end if;
  if v_head.id is not null then
    if nullif(btrim(p_reason),'') is null then raise exception 'reason_required'; end if;
    if p_kind = 'first_ad_spend' and v_head.milestone_date <= v_today and v_role not in ('owner','cgs') then
      raise exception 'milestone_locked';
    end if;
  end if;
  if length(p_reason) > 300 then raise exception 'entry_invalid'; end if;
  insert into public.marketing_milestones(kind,milestone_date,corrects_id,reason,recorded_by)
    values(p_kind,p_date,p_corrects,nullif(btrim(p_reason),''),p_actor) returning id into v_id;
  return v_id;
end $$;

create function public.record_marketing_manual_entry(p_actor uuid, p_kind text, p_location_id uuid, p_platform text,
  p_from date, p_to date, p_amount_cents bigint, p_list_count integer, p_note text, p_corrects uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_head public.marketing_manual_entries%rowtype; v_id uuid;
begin
  perform public.marketing_assert_actor(p_actor);
  if p_kind is null or p_kind not in ('meta_spend','promo_spend','email_list_size') or p_from is null or p_to is null
    or p_to < p_from or p_to - p_from > 29 or length(p_note) > 200 or length(p_reason) > 300
    or (p_location_id is not null and not exists(select 1 from public.locations where id = p_location_id))
    or (p_kind = 'meta_spend' and p_location_id is not null)
    or (p_kind = 'promo_spend' and (p_platform is null or p_platform not in ('uber_eats','doordash','grubhub','other')))
    or (p_kind <> 'promo_spend' and p_platform is not null)
    or (p_kind = 'email_list_size' and (p_to <> p_from or p_list_count is null or p_list_count < 0 or p_amount_cents is not null))
    or (p_kind <> 'email_list_size' and (p_to <> p_from + 6 or p_amount_cents is null or p_amount_cents not between 0 and 100000000 or p_list_count is not null))
  then raise exception 'entry_invalid'; end if;
  -- Serialize the whole series so different overlapping periods cannot race.
  -- JSON encoding keeps nullable identity fields distinct without sentinel collisions.
  perform pg_advisory_xact_lock(hashtextextended('marketing:entry:' || jsonb_build_array(p_kind,p_location_id,p_platform)::text, 0));
  select e.* into v_head from public.marketing_manual_entries e
    where kind = p_kind and location_id is not distinct from p_location_id and platform is not distinct from p_platform
    and period_start = p_from and period_end = p_to
    and not exists(select 1 from public.marketing_manual_entries c where c.corrects_id = e.id);
  if v_head.id is not null and p_corrects is null then raise exception 'entry_exists_use_correct'; end if;
  if p_corrects is distinct from v_head.id then raise exception 'correction_target_not_head'; end if;
  if p_corrects is not null and nullif(btrim(p_reason),'') is null then raise exception 'reason_required'; end if;
  if p_kind <> 'email_list_size' and exists(
    select 1 from public.marketing_manual_entries e
    where e.kind = p_kind and e.location_id is not distinct from p_location_id
      and e.platform is not distinct from p_platform
      and e.period_start <= p_to and e.period_end >= p_from
      and e.id is distinct from p_corrects
      and not exists(select 1 from public.marketing_manual_entries c where c.corrects_id = e.id)
  ) then raise exception 'entry_overlaps'; end if;
  insert into public.marketing_manual_entries(kind,location_id,platform,period_start,period_end,amount_cents,list_count,note,corrects_id,reason,recorded_by)
    values(p_kind,p_location_id,p_platform,p_from,p_to,p_amount_cents,p_list_count,p_note,p_corrects,nullif(btrim(p_reason),''),p_actor) returning id into v_id;
  return v_id;
end $$;

create function public.record_marketing_baseline_snapshot(p_actor uuid, p_milestone_id uuid, p_from date, p_to date,
  p_kpi_version smallint, p_payload jsonb, p_coverage jsonb, p_corrects uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_role text; v_m public.marketing_milestones%rowtype; v_head uuid; v_id uuid;
begin
  v_role := public.marketing_assert_actor(p_actor);
  -- Same lock as milestone correction: a snapshot can never bind a stale D.
  perform pg_advisory_xact_lock(hashtextextended('marketing:milestone:first_ad_spend', 0));
  select m.* into v_m from public.marketing_milestones m where id = p_milestone_id and kind = 'first_ad_spend'
    and not exists(select 1 from public.marketing_milestones c where c.corrects_id = m.id);
  if v_m.id is null or p_from is distinct from v_m.milestone_date - 28 or p_to is distinct from v_m.milestone_date - 1 then
    raise exception 'baseline_window_mismatch';
  end if;
  if p_to >= (clock_timestamp() at time zone 'America/New_York')::date then raise exception 'baseline_not_due'; end if;
  select s.id into v_head from public.marketing_baseline_snapshots s where milestone_id = p_milestone_id
    and not exists(select 1 from public.marketing_baseline_snapshots c where c.corrects_id = s.id);
  if v_head is not null and p_corrects is null then raise exception 'snapshot_exists'; end if;
  if p_corrects is distinct from v_head then raise exception 'correction_target_not_head'; end if;
  if p_corrects is not null then
    if v_role not in ('owner','cgs') then raise exception 'actor_not_allowed'; end if;
    if nullif(btrim(p_reason),'') is null then raise exception 'reason_required'; end if;
  end if;
  if p_kpi_version is null or p_kpi_version <= 0 or p_payload is null or octet_length(p_payload::text) > 65536
    or p_coverage is null or length(p_reason) > 300 then raise exception 'entry_invalid'; end if;
  insert into public.marketing_baseline_snapshots(milestone_id,window_from,window_to,kpi_version,payload,coverage,corrects_id,reason,recorded_by)
    values(p_milestone_id,p_from,p_to,p_kpi_version,p_payload,p_coverage,p_corrects,nullif(btrim(p_reason),''),p_actor) returning id into v_id;
  return v_id;
end $$;

create function public.landing_ad_code_create(p_actor uuid, p_code text) returns smallint
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_slot integer;
begin
  perform public.marketing_assert_actor(p_actor);
  if p_code is null or p_code !~ '^[a-z0-9][a-z0-9_-]{0,63}$' then raise exception 'code_invalid'; end if;
  if p_code = 'unattributed' then raise exception 'code_reserved'; end if;
  lock table public.landing_ad_codes in share row exclusive mode;
  if exists(select 1 from public.landing_ad_codes where code = p_code) then raise exception 'code_taken'; end if;
  select coalesce(max(slot),0) + 1 into v_slot from public.landing_ad_codes;
  if v_slot > 1024 then raise exception 'slots_exhausted'; end if;
  insert into public.landing_ad_codes(code,slot) values(p_code,v_slot);
  return v_slot::smallint;
end $$;
create function public.landing_ad_code_retire(p_actor uuid, p_code text) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  perform public.marketing_assert_actor(p_actor);
  if p_code = 'unattributed' then raise exception 'code_reserved'; end if;
  if p_code is null or p_code !~ '^[a-z0-9][a-z0-9_-]{0,63}$' then raise exception 'code_invalid'; end if;
  update public.landing_ad_codes set active = false where code = p_code and active;
  if not found then
    if not exists(select 1 from public.landing_ad_codes where code = p_code) then raise exception 'code_not_found'; end if;
    raise exception 'already_retired';
  end if;
end $$;

create function public.marketing_scorecard_days(p_location_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.sales_report_assert_window(p_location_id,p_from,p_to);
  if p_to - p_from > 27 then raise exception 'sales_report_window_too_wide'; end if;
  -- LARGE_CHECK_CENTS = 500000, shared with scorecard-shared.ts. Toast only.
  with f as materialized (select * from public.sales_report_facts(p_location_id,p_from,p_to) where sale_class = 'sale'),
  eligible as (select * from f where amount_cents <= 500000 or amount_cents is null),
  ez as (select r.event_date, r.status, e.subtotal_cents from public.ezcater_reconciliation_status r
    join public.ezcater_orders e on e.id = r.order_id
    where r.location_id = p_location_id and r.event_date between p_from and p_to)
  select jsonb_build_object(
    'channels', coalesce((select jsonb_agg(to_jsonb(c) order by business_date,channel,provider) from (
      select business_date, channel, provider, count(*) as checks, count(distinct order_guid) as orders,
        coalesce(sum(amount_cents),0) as cents, count(*) filter(where amount_cents is null) as amount_missing
      from eligible where channel <> 'unknown' group by business_date,channel,provider) c),'[]'::jsonb),
    -- Order IDs stay server-side. The bucket-level distinct count avoids counting an
    -- order twice when it has checks in multiple direct-online channel/provider rows.
    'direct_online_orders', coalesce((select jsonb_agg(to_jsonb(o) order by business_date) from (
      select business_date, count(distinct order_guid) as orders from eligible
      where channel in ('online','app','delivery') group by business_date) o),'[]'::jsonb),
    'large_checks', coalesce((select jsonb_agg(jsonb_build_object('business_date',business_date,'location_id',location_id,
      'channel',channel,'provider',provider,'amount_cents',amount_cents,'check_guid',check_guid) order by business_date,check_guid)
      from f where amount_cents > 500000),'[]'::jsonb),
    'unknown_labels', coalesce((select jsonb_agg(to_jsonb(u) order by business_date,label) from (
      select business_date, coalesce(dining_option,'(no dining option)') as label, count(*) as checks,
        coalesce(sum(amount_cents),0) as cents, count(*) filter(where amount_cents is null) as amount_missing
      from eligible where channel = 'unknown' group by business_date,coalesce(dining_option,'(no dining option)')) u),'[]'::jsonb),
    'ezcater', coalesce((select jsonb_agg(to_jsonb(e) order by business_date,status) from (
      select event_date as business_date, status, count(*) as orders, coalesce(sum(subtotal_cents),0) as subtotal_cents,
        count(*) filter(where subtotal_cents is null) as amount_missing,
        count(*) filter(where subtotal_cents > 500000) as large_orders
      from ez group by event_date,status) e),'[]'::jsonb),
    'captured_days', coalesce((select jsonb_agg(distinct business_date order by business_date) from public.toast_capture_runs
      where location_id = p_location_id and business_date between p_from and p_to and status = 'completed'),'[]'::jsonb)
  ) into v;
  return v;
end $$;
create function public.marketing_order_taps(p_from date, p_to date)
returns table(day date, store_key text, ad_code text, active boolean, click_count bigint)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 365 then raise exception 'taps_window_invalid'; end if;
  return query select c.day_et, c.store_key, c.ad_code, a.active, c.click_count
    from public.landing_order_click_counts c join public.landing_ad_codes a on a.slot = c.ad_slot
    where c.day_et between p_from and p_to order by c.day_et,c.store_key,c.ad_slot;
end $$;

do $$ declare f regprocedure; t text; owner_oid oid; begin
  foreach f in array array[
    'public.record_marketing_milestone(uuid,text,date,uuid,text)'::regprocedure,
    'public.record_marketing_manual_entry(uuid,text,uuid,text,date,date,bigint,integer,text,uuid,text)'::regprocedure,
    'public.record_marketing_baseline_snapshot(uuid,uuid,date,date,smallint,jsonb,jsonb,uuid,text)'::regprocedure,
    'public.landing_ad_code_create(uuid,text)'::regprocedure,
    'public.landing_ad_code_retire(uuid,text)'::regprocedure,
    'public.marketing_scorecard_days(uuid,date,date)'::regprocedure,
    'public.marketing_order_taps(date,date)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
  select proowner into owner_oid from pg_proc where oid = 'public.marketing_assert_actor(uuid)'::regprocedure;
  -- Every SECURITY DEFINER here has the same owner. New ledgers, registry, counter,
  -- actor and FK targets must be owned by it; no reliance on BYPASSRLS alone.
  if exists(select 1 from pg_proc where oid in (
    'public.increment_landing_order_click(text,text)'::regprocedure,
    'public.record_marketing_milestone(uuid,text,date,uuid,text)'::regprocedure,
    'public.record_marketing_manual_entry(uuid,text,uuid,text,date,date,bigint,integer,text,uuid,text)'::regprocedure,
    'public.record_marketing_baseline_snapshot(uuid,uuid,date,date,smallint,jsonb,jsonb,uuid,text)'::regprocedure,
    'public.landing_ad_code_create(uuid,text)'::regprocedure,'public.landing_ad_code_retire(uuid,text)'::regprocedure,
    'public.marketing_scorecard_days(uuid,date,date)'::regprocedure,'public.marketing_order_taps(date,date)'::regprocedure
  ) and proowner <> owner_oid) then raise exception '0289: function owner mismatch'; end if;
  foreach t in array array['marketing_milestones','marketing_manual_entries','marketing_baseline_snapshots',
    'landing_ad_codes','landing_order_click_counts','users','locations','toast_capture_runs','ezcater_orders','ezcater_reconciliation_status'] loop
    if (select relowner from pg_class where oid = ('public.' || t)::regclass) <> owner_oid then
      raise exception '0289: function owner must own every touched table';
    end if;
  end loop;
  foreach t in array array['marketing_milestones','marketing_manual_entries','marketing_baseline_snapshots','landing_ad_codes','landing_order_click_counts'] loop
    if has_table_privilege('service_role','public.' || t,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege('service_role','public.' || t,'INSERT,UPDATE,REFERENCES') then
      raise exception '0289: service_role above SELECT ceiling';
    end if;
  end loop;
end $$;
commit;
