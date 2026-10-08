-- Migration 0222: launch cutover. AUTHORED 2026-10-07, NOT APPLIED -- GATE CC/JUAN.
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

create function public.toast_capture_claim(p_run_id uuid,p_location_id uuid,p_business_date date)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 insert into public.toast_capture_debounce(location_id,business_date)
 values(p_location_id,p_business_date) on conflict do nothing;
 perform 1 from public.toast_capture_debounce where location_id=p_location_id and business_date=p_business_date for update;
 if exists(select 1 from public.toast_capture_runs where location_id=p_location_id and business_date=p_business_date
   and (status='running' or finished_at > clock_timestamp()-interval '5 minutes')) then
   return false;
 end if;
 insert into public.toast_capture_runs(id,location_id,business_date,status)
 values(p_run_id,p_location_id,p_business_date,'running');
 update public.toast_capture_debounce set last_claimed_at=clock_timestamp()
 where location_id=p_location_id and business_date=p_business_date;
 return true;
end $$;
revoke all on function public.toast_capture_claim(uuid,uuid,date) from public,anon,authenticated;
grant execute on function public.toast_capture_claim(uuid,uuid,date) to service_role;

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
 run_id uuid not null, status text not null check(status='success'),
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
 p_source_order_count integer,p_algorithm_version text,p_nested_production_conflict_count integer
) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_aggregate_count integer; v_attribution_count integer;
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
 insert into public.toast_depletion_day_coverage(location_id,business_date,run_id,status,aggregate_count,attribution_count,nested_production_conflict_count,source_order_count,algorithm_version,computed_at)
 values(p_location_id,p_business_date,p_run_id,'success',v_aggregate_count,v_attribution_count,p_nested_production_conflict_count,p_source_order_count,p_algorithm_version,clock_timestamp())
 on conflict(location_id,business_date) do update set run_id=excluded.run_id,status=excluded.status,
  aggregate_count=excluded.aggregate_count,attribution_count=excluded.attribution_count,
  nested_production_conflict_count=excluded.nested_production_conflict_count,
  source_order_count=excluded.source_order_count,algorithm_version=excluded.algorithm_version,computed_at=excluded.computed_at;
end $$;
revoke all on function public.replace_toast_depletion_day(uuid,date,uuid,jsonb,jsonb,integer,text,integer) from public,anon,authenticated;
grant execute on function public.replace_toast_depletion_day(uuid,date,uuid,jsonb,jsonb,integer,text,integer) to service_role;
commit;
