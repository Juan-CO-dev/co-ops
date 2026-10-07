-- Migration 0221_toast_order_capture
-- AUTHORED 2026-10-07. NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod.
-- Immutable order versions preserve history. Only completed run membership publishes a
-- snapshot; source modified_at wins, then run start time. Config tables are mutable caches.
-- No raw payloads/customer fields. Free-text discount notes deliberately excluded: reason GUID and configured name only.
begin;
create table public.toast_capture_runs (
 id uuid primary key default gen_random_uuid(), location_id uuid not null references public.locations(id),
 business_date date not null, pages integer not null default 0 check(pages >= 0), orders integer not null default 0 check(orders >= 0),
 started_at timestamptz not null default now(), finished_at timestamptz,
 status text not null default 'running' check(status in ('running','completed','failed')), error_code text,
 unique(id,location_id,business_date), check((status = 'running') = (finished_at is null))
);
create index toast_capture_runs_location_date on public.toast_capture_runs(location_id,business_date,status);
create table public.toast_orders (
 id uuid primary key default gen_random_uuid(), location_id uuid not null references public.locations(id),
 order_guid text not null, business_date date not null, content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
 opened_at timestamptz, closed_at timestamptz, paid_at timestamptz, modified_at timestamptz, promised_at timestamptz,
 source text, revenue_center_guid text, dining_option_guid text, server_guid text,
 deleted boolean not null, voided boolean not null, excess_food boolean not null,
 third_party_provider_guid text,
 unique(location_id,order_guid,content_hash), unique(id,location_id,business_date)
);
create index toast_orders_location_date on public.toast_orders(location_id,business_date);
create table public.toast_order_checks (
 snapshot_id uuid not null references public.toast_orders(id), check_guid text not null,
 amount_cents bigint, tax_cents bigint, total_cents bigint, voided boolean not null,
 primary key(snapshot_id,check_guid)
);
create table public.toast_check_discounts (
 snapshot_id uuid not null, check_guid text not null, ordinal integer not null,
 selection_guid text, applied_discount_guid text, discount_guid text, name text, amount_cents bigint,
 reason_guid text, reason_name text, approver_guid text,
 primary key(snapshot_id,check_guid,ordinal),
 foreign key(snapshot_id,check_guid) references public.toast_order_checks(snapshot_id,check_guid)
);
create table public.toast_check_service_charges (
 snapshot_id uuid not null, check_guid text not null, ordinal integer not null,
 service_charge_guid text, name text, amount_cents bigint, gratuity boolean not null, taxable boolean not null,
 primary key(snapshot_id,check_guid,ordinal),
 foreign key(snapshot_id,check_guid) references public.toast_order_checks(snapshot_id,check_guid)
);
create table public.toast_payments (
 snapshot_id uuid not null, check_guid text not null, payment_guid text not null, type text,
 amount_cents bigint, tip_cents bigint, paid_business_date date, refund_amount_cents bigint,
 refund_tip_cents bigint, refund_business_date date, void_business_date date, server_guid text,
 primary key(snapshot_id,payment_guid),
 foreign key(snapshot_id,check_guid) references public.toast_order_checks(snapshot_id,check_guid)
);
create index toast_payments_refund_date on public.toast_payments(refund_business_date) where refund_business_date is not null;
create table public.toast_capture_pages (
 run_id uuid not null references public.toast_capture_runs(id), page integer not null check(page>0),
 orders integer not null check(orders between 0 and 100), payload_hash text not null, primary key(run_id,page)
);
create table public.toast_capture_run_orders (
 run_id uuid not null, snapshot_id uuid not null, location_id uuid not null, business_date date not null,
 order_guid text not null, page integer not null,
 primary key(run_id,order_guid),
 foreign key(run_id,location_id,business_date) references public.toast_capture_runs(id,location_id,business_date),
 foreign key(snapshot_id,location_id,business_date) references public.toast_orders(id,location_id,business_date),
 foreign key(run_id,page) references public.toast_capture_pages(run_id,page)
);
create table public.toast_discounts (location_id uuid not null references public.locations(id), guid text not null, name text not null, updated_at timestamptz not null default now(), primary key(location_id,guid));
create table public.toast_revenue_centers (location_id uuid not null references public.locations(id), guid text not null, name text not null, updated_at timestamptz not null default now(), primary key(location_id,guid));
create table public.toast_dining_options (location_id uuid not null references public.locations(id), guid text not null, name text not null, behavior text, updated_at timestamptz not null default now(), primary key(location_id,guid));
create table public.sales_channel_map (
 dining_option_label text primary key, channel text not null, provider text, fulfillment text,
 reviewed_at timestamptz, check(channel in ('Unknown','in_store','online','3rd_party','catering'))
);
insert into public.sales_channel_map(dining_option_label,channel)
select distinct dining_option,'Unknown' from public.toast_sales_events where dining_option is not null and btrim(dining_option)<>'';
-- Seed is intentionally gated on CC/Juan's actual label export and review; never infer
-- 29 production labels. Missing labels are Unknown in the future reporting consumer.
insert into public.sales_channel_map(dining_option_label,channel,provider,fulfillment)
values ('Uber Eats - Delivery','3rd_party','Uber Eats','delivery')
on conflict(dining_option_label) do update set channel=excluded.channel,provider=excluded.provider,fulfillment=excluded.fulfillment;

create view public.toast_orders_latest with (security_invoker=true) as
select distinct on (o.location_id,o.order_guid) o.*
from public.toast_orders o join public.toast_capture_run_orders ro on ro.snapshot_id=o.id
join public.toast_capture_runs r on r.id=ro.run_id
where r.status='completed'
order by o.location_id,o.order_guid,o.modified_at desc nulls last,r.started_at desc,r.id desc;

create function public.toast_capture_page(p_run_id uuid,p_location_id uuid,p_business_date date,p_page integer,p_orders jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_run public.toast_capture_runs%rowtype; v_entry jsonb; v_order jsonb; v_snapshot uuid; v_new boolean;
begin
 select * into v_run from public.toast_capture_runs where id=p_run_id and location_id=p_location_id and business_date=p_business_date for update;
 if not found or v_run.status <> 'running' then raise exception 'toast_capture_run_not_running'; end if;
 if p_page is null or p_page<1 or p_orders is null or jsonb_typeof(p_orders)<>'array' or jsonb_array_length(p_orders)>100 then raise exception 'toast_capture_invalid_page'; end if;
 -- A retry of a committed page never rewrites its historical snapshot membership.
 if exists(select 1 from public.toast_capture_pages where run_id=p_run_id and page=p_page) then
  if not exists(select 1 from public.toast_capture_pages where run_id=p_run_id and page=p_page and payload_hash=md5(p_orders::text)) then raise exception 'toast_capture_page_changed'; end if;
  return;
 end if;
 insert into public.toast_capture_pages(run_id,page,orders,payload_hash) values(p_run_id,p_page,jsonb_array_length(p_orders),md5(p_orders::text));
 for v_entry in select value from jsonb_array_elements(p_orders) loop
  v_order := v_entry->'order';
  if (v_order->>'business_date')::date is distinct from p_business_date then raise exception 'toast_capture_date_mismatch'; end if;
  v_snapshot := null;
  insert into public.toast_orders(location_id,order_guid,business_date,content_hash,opened_at,closed_at,paid_at,modified_at,promised_at,source,revenue_center_guid,dining_option_guid,server_guid,deleted,voided,excess_food,third_party_provider_guid)
  values(p_location_id,v_order->>'order_guid',p_business_date,v_entry->>'content_hash',(v_order->>'opened_at')::timestamptz,(v_order->>'closed_at')::timestamptz,(v_order->>'paid_at')::timestamptz,(v_order->>'modified_at')::timestamptz,(v_order->>'promised_at')::timestamptz,v_order->>'source',v_order->>'revenue_center_guid',v_order->>'dining_option_guid',v_order->>'server_guid',(v_order->>'deleted')::boolean,(v_order->>'voided')::boolean,(v_order->>'excess_food')::boolean,v_order->>'third_party_provider_guid')
  on conflict(location_id,order_guid,content_hash) do nothing returning id into v_snapshot;
  v_new := v_snapshot is not null;
  if not v_new then select id into strict v_snapshot from public.toast_orders where location_id=p_location_id and order_guid=v_order->>'order_guid' and content_hash=v_entry->>'content_hash'; end if;
  if v_new then
   insert into public.toast_order_checks(snapshot_id,check_guid,amount_cents,tax_cents,total_cents,voided) select v_snapshot,x.* from jsonb_to_recordset(v_entry->'checks') as x(check_guid text,amount_cents bigint,tax_cents bigint,total_cents bigint,voided boolean);
   insert into public.toast_check_discounts(snapshot_id,check_guid,ordinal,selection_guid,applied_discount_guid,discount_guid,name,amount_cents,reason_guid,reason_name,approver_guid) select v_snapshot,x.* from jsonb_to_recordset(v_entry->'discounts') as x(check_guid text,ordinal integer,selection_guid text,applied_discount_guid text,discount_guid text,name text,amount_cents bigint,reason_guid text,reason_name text,approver_guid text);
   insert into public.toast_check_service_charges(snapshot_id,check_guid,ordinal,service_charge_guid,name,amount_cents,gratuity,taxable) select v_snapshot,x.* from jsonb_to_recordset(v_entry->'service_charges') as x(check_guid text,ordinal integer,service_charge_guid text,name text,amount_cents bigint,gratuity boolean,taxable boolean);
   insert into public.toast_payments(snapshot_id,check_guid,payment_guid,type,amount_cents,tip_cents,paid_business_date,refund_amount_cents,refund_tip_cents,refund_business_date,void_business_date,server_guid) select v_snapshot,x.* from jsonb_to_recordset(v_entry->'payments') as x(check_guid text,payment_guid text,type text,amount_cents bigint,tip_cents bigint,paid_business_date date,refund_amount_cents bigint,refund_tip_cents bigint, refund_business_date date,void_business_date date,server_guid text);
  end if;
  -- Repeated orders across pages indicate an unstable paginated response: refuse publication.
  insert into public.toast_capture_run_orders(run_id,snapshot_id,location_id,business_date,order_guid,page) values(p_run_id,v_snapshot,p_location_id,p_business_date,v_order->>'order_guid',p_page);
 end loop;
 update public.toast_capture_runs set pages=pages+1,orders=orders+jsonb_array_length(p_orders) where id=p_run_id;
end $$;

create function public.toast_capture_finish(p_run_id uuid,p_location_id uuid,p_business_date date,p_pages integer)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_run public.toast_capture_runs%rowtype;
begin
 select * into v_run from public.toast_capture_runs where id=p_run_id and location_id=p_location_id and business_date=p_business_date for update;
 if not found then raise exception 'toast_capture_run_not_found'; end if;
 if v_run.status='completed' and v_run.pages=p_pages then return; end if;
 if v_run.status<>'running' or p_pages is null or p_pages<1 or v_run.pages<>p_pages then raise exception 'toast_capture_incomplete'; end if;
 if exists(select 1 from generate_series(1,p_pages) n where not exists(select 1 from public.toast_capture_pages p where p.run_id=p_run_id and p.page=n and ((n<p_pages and p.orders=100) or (n=p_pages and p.orders<100)))) then raise exception 'toast_capture_incomplete'; end if;
 update public.toast_capture_runs set status='completed',finished_at=clock_timestamp(),error_code=null where id=p_run_id;
end $$;

-- RLS has no allow policies and an explicit DELETE denial. Even service_role
-- has no destructive table grants.
do $$ declare t text; begin
 foreach t in array array['toast_capture_runs','toast_orders','toast_order_checks','toast_check_discounts','toast_check_service_charges','toast_payments','toast_capture_pages','toast_capture_run_orders','toast_discounts','toast_revenue_centers','toast_dining_options','sales_channel_map'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy %I on public.%I for delete using (false)',t || '_no_user_delete',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to service_role',t);
 end loop;
end $$;
grant insert on public.toast_capture_runs to service_role;
grant update(status,finished_at,error_code) on public.toast_capture_runs to service_role;
grant insert,update on public.toast_discounts,public.toast_revenue_centers,public.toast_dining_options to service_role;
revoke all on public.toast_orders_latest from public,anon,authenticated,service_role;
grant select on public.toast_orders_latest to service_role;
revoke all on function public.toast_capture_page(uuid,uuid,date,integer,jsonb),public.toast_capture_finish(uuid,uuid,date,integer) from public,anon,authenticated;
grant execute on function public.toast_capture_page(uuid,uuid,date,integer,jsonb),public.toast_capture_finish(uuid,uuid,date,integer) to service_role;
do $$ begin
 if exists(select 1 from information_schema.routine_privileges where routine_schema='public' and routine_name in ('toast_capture_page','toast_capture_finish') and grantee in ('PUBLIC','anon','authenticated')) then raise exception '0221 unexpected RPC grant'; end if;
 if exists(select 1 from information_schema.role_table_grants where table_schema='public' and table_name in ('toast_capture_runs','toast_orders','toast_order_checks','toast_check_discounts','toast_check_service_charges','toast_payments','toast_capture_pages','toast_capture_run_orders','toast_discounts','toast_revenue_centers','toast_dining_options','sales_channel_map','toast_orders_latest') and (grantee in ('PUBLIC','anon','authenticated') or (grantee='service_role' and privilege_type in ('DELETE','TRUNCATE')))) then raise exception '0221 unexpected table grant'; end if;
end $$;
commit;


