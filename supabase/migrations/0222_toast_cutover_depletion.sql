-- Migration 0222: launch cutover. AUTHORED 2026-10-07, NOT APPLIED -- GATE CC/JUAN.
-- The authoring-time gate above is retained as history.
-- APPLIED TO SIM 20261008005718; NOT on prod. Revised in place: revert SIM before re-applying.
-- Stage A section: atomic debounce; no cursor, lease or fencing protocol.
begin;
create table public.toast_capture_debounce (
 location_id uuid not null references public.locations(id), business_date date not null,
 last_claimed_at timestamptz not null default now(), primary key(location_id,business_date)
);
alter table public.toast_capture_debounce enable row level security;
create policy toast_capture_debounce_no_user_select on public.toast_capture_debounce for select using(false);
create policy toast_capture_debounce_no_user_insert on public.toast_capture_debounce for insert with check(false);
create policy toast_capture_debounce_no_user_update on public.toast_capture_debounce for update using(false);
create policy toast_capture_debounce_no_user_delete on public.toast_capture_debounce for delete using(false);
revoke all on public.toast_capture_debounce from public, anon, authenticated, service_role;
grant select on public.toast_capture_debounce to service_role;

create function public.toast_capture_claim(p_run_id uuid,p_location_id uuid,p_business_date date,p_min_interval interval default interval '5 minutes')
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if p_min_interval is null or p_min_interval < interval '5 minutes' then raise exception 'toast_capture_invalid_interval'; end if;
 insert into public.toast_capture_debounce(location_id,business_date)
 values(p_location_id,p_business_date) on conflict do nothing;
 perform 1 from public.toast_capture_debounce where location_id=p_location_id and business_date=p_business_date for update;
 -- Serialized with other claims; non-backfill captures have a 60-second maximum.
 update public.toast_capture_runs set status='failed',error_code='capture_stale',finished_at=clock_timestamp()
 where location_id=p_location_id and business_date=p_business_date and status='running'
   and started_at < clock_timestamp()-interval '2 minutes';
 if exists(select 1 from public.toast_capture_runs where location_id=p_location_id and business_date=p_business_date
   and (status='running' or (error_code is distinct from 'capture_stale' and finished_at > clock_timestamp()-p_min_interval))) then
   return false;
 end if;
 insert into public.toast_capture_runs(id,location_id,business_date,status)
 values(p_run_id,p_location_id,p_business_date,'running');
 update public.toast_capture_debounce set last_claimed_at=clock_timestamp()
 where location_id=p_location_id and business_date=p_business_date;
 return true;
end $$;
revoke all on function public.toast_capture_claim(uuid,uuid,date,interval) from public,anon,authenticated;
grant execute on function public.toast_capture_claim(uuid,uuid,date,interval) to service_role;

-- Stage B: atomically published derived depletion. This is a replaceable cache;
-- capture/order evidence remains append-only.
alter table public.toast_capture_runs
 add column catering_status text not null default 'pending' check(catering_status in ('pending','complete','degraded')),
 add column catering_error_code text;
grant update(catering_status,catering_error_code) on public.toast_capture_runs to service_role;
-- A reviewed channel correction may remove an existing order from catering.
-- Preserve the restricted ledger row and linked human work instead of deleting it.
alter table public.toast_catering_orders drop constraint toast_catering_orders_classification_check;
alter table public.toast_catering_orders add constraint toast_catering_orders_classification_check
 check(classification in ('catering','ezcater','third_party','not_catering'));
create table public.toast_depletion_item_attribution (
 id uuid primary key default gen_random_uuid(),
 location_id uuid not null references public.locations(id), business_date date not null,
 item_id uuid not null references public.items(id), item_path uuid[] not null check(cardinality(item_path)>0 and item_path[1]=item_id),
 sku_id uuid not null references public.vendor_items(id),
 sales_oz numeric not null check(sales_oz >= 0),
 unique(location_id,business_date,item_path,sku_id)
);
create table public.toast_capture_daily_depletion (
 id uuid primary key default gen_random_uuid(), location_id uuid not null references public.locations(id),
 business_date date not null, sku_id uuid not null references public.vendor_items(id),
 direct_oz numeric not null check(direct_oz>=0), flattened_oz numeric not null check(flattened_oz>=0),
 computed_at timestamptz not null default now(), unique(location_id,business_date,sku_id)
);
create index toast_capture_depletion_loc_sku_date on public.toast_capture_daily_depletion(location_id,sku_id,business_date);
create table public.toast_depletion_day_coverage (
 location_id uuid not null references public.locations(id), business_date date not null,
 run_id uuid not null, status text not null check(status in ('success','degraded')), reason text,
 suspect_check_count integer not null check(suspect_check_count>=0),
 suspect_qty numeric not null check(suspect_qty>=0), counted_qty numeric not null check(counted_qty>=0),
 diagnostics jsonb not null default '{}'::jsonb check(jsonb_typeof(diagnostics)='object'),
 check(status='success' or nullif(btrim(reason),'') is not null),
 aggregate_count integer not null check(aggregate_count>=0), attribution_count integer not null check(attribution_count>=0),
 nested_production_conflict_count integer not null check(nested_production_conflict_count>=0),
 source_order_count integer not null check(source_order_count>=0), algorithm_version text not null,
 computed_at timestamptz not null default now(),
 primary key(location_id,business_date), unique(run_id,location_id,business_date),
 foreign key(run_id,location_id,business_date) references public.toast_capture_runs(id,location_id,business_date)
);
do $$ declare t text; begin
 foreach t in array array['toast_capture_daily_depletion','toast_depletion_item_attribution','toast_depletion_day_coverage'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy %I on public.%I for select using(false)',t||'_no_user_select',t);
  execute format('create policy %I on public.%I for insert with check(false)',t||'_no_user_insert',t);
  execute format('create policy %I on public.%I for update using(false)',t||'_no_user_update',t);
  execute format('create policy %I on public.%I for delete using(false)',t||'_no_user_delete',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to service_role',t);
 end loop;
end $$;

create function public.replace_toast_depletion_day(
 p_location_id uuid,p_business_date date,p_run_id uuid,p_aggregates jsonb,p_attributions jsonb,
 p_source_order_count integer,p_algorithm_version text,p_nested_production_conflict_count integer,
 p_suspect_check_count integer,p_suspect_qty numeric,p_counted_qty numeric,
 p_diagnostics jsonb default '{}'::jsonb,p_status text default 'success',p_reason text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_aggregate_count integer; v_attribution_count integer; v_mismatch_count integer;
 v_diagnostics jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_location_id::text||':'||p_business_date::text,0));
 if p_business_date >= (clock_timestamp() at time zone 'America/New_York')::date then raise exception 'toast_depletion_open_day'; end if;
 if not exists(select 1 from public.toast_capture_runs where id=p_run_id and location_id=p_location_id
   and business_date=p_business_date and status='completed') then raise exception 'toast_depletion_capture_incomplete'; end if;
 if p_run_id <> (select id from public.toast_capture_runs where location_id=p_location_id and business_date=p_business_date
   and status='completed' order by finished_at desc,id desc limit 1) then raise exception 'toast_depletion_obsolete_run'; end if;
 if p_aggregates is null or p_attributions is null
   or jsonb_typeof(p_aggregates)<>'array' or jsonb_typeof(p_attributions)<>'array'
   or p_source_order_count is null or p_source_order_count<0
   or p_nested_production_conflict_count is null or p_nested_production_conflict_count<0
   or p_suspect_check_count is null or p_suspect_check_count<0
   or p_suspect_qty is null or p_suspect_qty<0 or p_counted_qty is null or p_counted_qty<0
   or p_diagnostics is null or jsonb_typeof(p_diagnostics)<>'object'
   or p_status is null or p_status not in ('success','degraded')
   or (p_status='degraded' and nullif(btrim(p_reason),'') is null)
   or nullif(btrim(p_algorithm_version),'') is null then raise exception 'toast_depletion_invalid'; end if;
 delete from public.toast_capture_daily_depletion where location_id=p_location_id and business_date=p_business_date;
 insert into public.toast_capture_daily_depletion(location_id,business_date,sku_id,direct_oz,flattened_oz)
 select p_location_id,p_business_date,x.sku_id,x.direct_oz,x.flattened_oz
 from jsonb_to_recordset(p_aggregates) x(sku_id uuid,direct_oz numeric,flattened_oz numeric);
 get diagnostics v_aggregate_count=row_count;
 delete from public.toast_depletion_item_attribution where location_id=p_location_id and business_date=p_business_date;
 insert into public.toast_depletion_item_attribution(location_id,business_date,item_id,item_path,sku_id,sales_oz)
 select p_location_id,p_business_date,x.item_id,x.item_path,x.sku_id,x.sales_oz
 from jsonb_to_recordset(p_attributions) x(item_id uuid,item_path uuid[],sku_id uuid,sales_oz numeric);
 get diagnostics v_attribution_count=row_count;
 if p_run_id <> (select id from public.toast_capture_runs where location_id=p_location_id and business_date=p_business_date
   and status='completed' order by finished_at desc,id desc limit 1) then raise exception 'toast_depletion_source_changed'; end if;
 -- A mismatch is diagnostic only; it must not reject otherwise publishable coverage.
 select count(*) into v_mismatch_count from
 (select sku_id,flattened_oz from public.toast_capture_daily_depletion
  where location_id=p_location_id and business_date=p_business_date) a
 full join (select sku_id,sum(sales_oz) sales_oz from public.toast_depletion_item_attribution
  where location_id=p_location_id and business_date=p_business_date group by sku_id) b using(sku_id)
 where abs(coalesce(a.flattened_oz,0)-coalesce(b.sales_oz,0))>0.000001;
 v_diagnostics:=p_diagnostics||jsonb_build_object('attribution_mismatch_sku_count',v_mismatch_count);
 insert into public.toast_depletion_day_coverage(location_id,business_date,run_id,status,aggregate_count,attribution_count,nested_production_conflict_count,source_order_count,algorithm_version,suspect_check_count,suspect_qty,counted_qty,diagnostics,reason,computed_at)
 values(p_location_id,p_business_date,p_run_id,p_status,v_aggregate_count,v_attribution_count,p_nested_production_conflict_count,p_source_order_count,p_algorithm_version,p_suspect_check_count,p_suspect_qty,p_counted_qty,v_diagnostics,p_reason,clock_timestamp())
 on conflict(location_id,business_date) do update set run_id=excluded.run_id,status=excluded.status,
  suspect_check_count=excluded.suspect_check_count,suspect_qty=excluded.suspect_qty,counted_qty=excluded.counted_qty,
  diagnostics=excluded.diagnostics,reason=excluded.reason,
  aggregate_count=excluded.aggregate_count,attribution_count=excluded.attribution_count,
  nested_production_conflict_count=excluded.nested_production_conflict_count,
  source_order_count=excluded.source_order_count,algorithm_version=excluded.algorithm_version,computed_at=excluded.computed_at;
 return jsonb_build_object('aggregate_count',v_aggregate_count,'attribution_count',v_attribution_count,'coverage_count',1);
end $$;
revoke all on function public.replace_toast_depletion_day(uuid,date,uuid,jsonb,jsonb,integer,text,integer,integer,numeric,numeric,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.replace_toast_depletion_day(uuid,date,uuid,jsonb,jsonb,integer,text,integer,integer,numeric,numeric,jsonb,text,text) to service_role;
-- Fail closed even when plpgsql.check_asserts is disabled. Check effective privileges,
-- including inherited/default ACLs, and PUBLIC separately (it is not a role).
do $$ declare t text; r text; f regprocedure; begin
 foreach t in array array['toast_capture_debounce','toast_capture_daily_depletion','toast_depletion_item_attribution','toast_depletion_day_coverage'] loop
  foreach r in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(r,'public.'||t,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     or (r<>'service_role' and has_any_column_privilege(r,'public.'||t,'SELECT'))
     or (r='service_role' and not has_table_privilege(r,'public.'||t,'SELECT'))
     or has_any_column_privilege(r,'public.'||t,'INSERT,UPDATE,REFERENCES') then
    raise exception 'toast_cutover_table_grants_wrong: % %',t,r;
   end if;
  end loop;
  if exists(select 1 from pg_class c, lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    where c.oid=('public.'||t)::regclass and a.grantee=0) then raise exception 'toast_cutover_public_table_grant'; end if;
 end loop;
 foreach f in array array[
  'public.toast_capture_claim(uuid,uuid,date,interval)'::regprocedure,
  'public.replace_toast_depletion_day(uuid,date,uuid,jsonb,jsonb,integer,text,integer,integer,numeric,numeric,jsonb,text,text)'::regprocedure] loop
  if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
    or not has_function_privilege('service_role',f,'EXECUTE')
    or exists(select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid=f and a.grantee=0) then raise exception 'toast_cutover_function_grants_wrong'; end if;
 end loop;
 if not has_column_privilege('service_role','public.toast_capture_runs','catering_status','UPDATE')
 or not has_column_privilege('service_role','public.toast_capture_runs','catering_error_code','UPDATE') then
  raise exception 'toast_cutover_catering_grants_wrong';
 end if;
end $$;
commit;
