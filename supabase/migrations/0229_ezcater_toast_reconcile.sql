-- 0229 ezCater source of truth / Toast cross-check.
-- APPLIED TO PROD 2026-10-08 (schema_migrations version 20261008191517, name '0229_ezcater_toast_reconcile'; sim first, version 20261008190731 + CC threshold/orphan-floor patch; harness PASS; prod rolled-back dry run: 38 resolved, idempotent).
begin;
alter table public.ezcater_toast_links drop constraint ezcater_toast_links_evidence_check;
alter table public.ezcater_toast_links add constraint ezcater_toast_links_evidence_check check(evidence in ('normalized_code','late_code','daily_batch'));
alter table public.ezcater_toast_links add column amount_diff_cents bigint;
alter table public.ezcater_toast_links add column amount_mismatch boolean not null default false;
alter table public.ezcater_toast_links add column reconciliation_details jsonb not null default '{}'::jsonb;
drop index public.ezcater_toast_links_selection;
create unique index ezcater_toast_links_selection on public.ezcater_toast_links(order_id,location_id,check_guid,selection_guid) where is_current;
create table public.ezcater_review_resolutions (
 id uuid primary key default gen_random_uuid(),review_id uuid not null unique references public.ezcater_review_queue(id),
 rule text not null check(rule in ('normalized_code','late_code','daily_batch','not_rung_in_toast')),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.ezcater_review_resolutions enable row level security;
create policy ezcater_review_resolutions_no_user_select on public.ezcater_review_resolutions for select using(false);
create policy ezcater_review_resolutions_no_user_insert on public.ezcater_review_resolutions for insert with check(false);
create policy ezcater_review_resolutions_no_user_update on public.ezcater_review_resolutions for update using(false);
create policy ezcater_review_resolutions_no_user_delete on public.ezcater_review_resolutions for delete using(false);
revoke all on public.ezcater_review_resolutions from public,anon,authenticated,service_role;
grant select on public.ezcater_review_resolutions to service_role;
create function public.plan_ezcater_toast() returns table(
 order_id uuid,snapshot_id uuid,location_id uuid,toast_snapshot_id uuid,order_guid text,check_guid text,selection_guid text,
 business_date date,evidence text,amount_diff_cents bigint,amount_mismatch boolean,reconciliation_details jsonb)
language sql stable security definer set search_path=pg_catalog,public as $plan$
with eligible as (
 select o.id order_id,o.snapshot_id,coalesce(p.location_id,o.location_id) location_id,o.event_date,o.order_number,o.subtotal_cents
 from public.ezcater_orders o left join public.catering_pipeline p on p.id=o.lead_id
 where o.snapshot_id is not null and o.event_date is not null and coalesce(p.stage,'')<>'lost'
 and lower(coalesce(o.status,'')) !~ '(cancel|reject|fail)'
), checks as (
 select t.id toast_snapshot_id,t.location_id,t.order_guid,c.check_guid,t.business_date,c.amount_cents,t.selection_units,
 exists(select 1 from public.toast_dining_options d where d.location_id=t.location_id and d.guid=t.dining_option_guid
 and lower(regexp_replace(d.name,'[^a-zA-Z0-9]','','g'))='ezcater') is_ezcater
 from public.toast_orders_latest t join public.toast_order_checks c on c.snapshot_id=t.id
 where not t.voided and not t.deleted and not t.excess_food and not c.voided and not c.deleted
), candidates as (
 select distinct e.*,c.toast_snapshot_id,c.order_guid,c.check_guid,c.business_date,
 s->>'selection_guid' selection_guid,case when c.business_date-e.event_date<=1 then 'normalized_code' else 'late_code' end evidence
 from eligible e join checks c on c.location_id=e.location_id and c.business_date between e.event_date-1 and e.event_date+7
 cross join lateral jsonb_array_elements(c.selection_units) s
 where s->>'check_guid'=c.check_guid and not coalesce((s->>'voided')::boolean,false) and not coalesce((s->>'deleted')::boolean,false)
 and nullif(e.order_number,'') is not null and exists(
 select 1 from regexp_matches(coalesce(s->>'name',''),'[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*','g') token
 where upper(replace(token[1],'-',''))=upper(replace(btrim(e.order_number),'-','')))
 union
 select e.*,c.toast_snapshot_id,c.order_guid,c.check_guid,c.business_date,l.selection_guid,
 case when c.business_date-e.event_date<=1 then 'normalized_code' else 'late_code' end
 from eligible e join public.ezcater_toast_links l on l.order_id=e.order_id and l.snapshot_id=e.snapshot_id
 and l.location_id=e.location_id and l.is_current and l.evidence in ('normalized_code','late_code')
 join checks c on c.toast_snapshot_id=l.toast_snapshot_id and c.check_guid=l.check_guid
 and c.business_date between e.event_date-1 and e.event_date+7
 and exists(select 1 from jsonb_array_elements(c.selection_units) s where s->>'check_guid'=c.check_guid
 and s->>'selection_guid'=l.selection_guid and not coalesce((s->>'voided')::boolean,false) and not coalesce((s->>'deleted')::boolean,false))
), prioritized as (
 select *,min(case evidence when 'normalized_code' then 1 else 2 end) over(partition by toast_snapshot_id,check_guid,selection_guid) priority
 from candidates
), codes as (
 select c.* from prioritized c where (case evidence when 'normalized_code' then 1 else 2 end)=priority
 and 1=(select count(distinct x.order_id) from prioritized x where x.toast_snapshot_id=c.toast_snapshot_id and x.check_guid=c.check_guid
 and x.selection_guid=c.selection_guid and (case x.evidence when 'normalized_code' then 1 else 2 end)=x.priority)
), remaining as (
 select e.* from eligible e where not exists(select 1 from codes c where c.order_id=e.order_id)
), batch_checks as (
 select c.*,case when exists(select 1 from eligible e where e.location_id=c.location_id and e.event_date=c.business_date)
 then c.business_date else c.business_date-1 end target_date
 from checks c where c.is_ezcater and not exists(select 1 from codes k where k.toast_snapshot_id=c.toast_snapshot_id and k.check_guid=c.check_guid)
) , batches as (
 -- Same-day batches claim their day first; D+1 fallback cannot claim it again.
 select b.* from batch_checks b where b.target_date=b.business_date or not exists(
 select 1 from batch_checks direct where direct.location_id=b.location_id
 and direct.business_date=b.target_date and direct.target_date=b.target_date)
), batch_totals as (
 select b.location_id,b.target_date,sum(b.amount_cents) toast_cents,
 (select sum(r.subtotal_cents) from remaining r where r.location_id=b.location_id and r.event_date=b.target_date) ez_cents
 from batches b group by b.location_id,b.target_date
), planned as (
 select order_id,snapshot_id,location_id,toast_snapshot_id,order_guid,check_guid,selection_guid,business_date,evidence,
 null::bigint amount_diff_cents,false amount_mismatch,'{}'::jsonb reconciliation_details from codes
 union all
 select r.order_id,r.snapshot_id,r.location_id,b.toast_snapshot_id,b.order_guid,b.check_guid,''::text,b.business_date,'daily_batch',
 (t.toast_cents-t.ez_cents)::bigint,coalesce(abs(t.toast_cents-t.ez_cents)>5000 and abs(t.toast_cents-t.ez_cents)>abs(t.ez_cents)*0.15,false),
 jsonb_build_object('toast_subtotal_cents',t.toast_cents,'ezcater_subtotal_cents',t.ez_cents,'event_date',b.target_date,'fallback',b.target_date<>b.business_date)
 from remaining r join batches b on b.location_id=r.location_id and b.target_date=r.event_date
 join batch_totals t on t.location_id=b.location_id and t.target_date=b.target_date
)
select * from planned
$plan$;
revoke all on function public.plan_ezcater_toast() from public,anon,authenticated;
grant execute on function public.plan_ezcater_toast() to service_role;

create view public.ezcater_current_toast_links with (security_invoker=true) as
select l.*,l.order_guid toast_order_guid from public.ezcater_toast_links l
join public.ezcater_orders e on e.id=l.order_id and e.snapshot_id=l.snapshot_id
left join public.catering_pipeline p on p.id=e.lead_id
join public.toast_orders_latest t on t.id=l.toast_snapshot_id and t.location_id=l.location_id and t.order_guid=l.order_guid
join public.toast_order_checks c on c.snapshot_id=t.id and c.check_guid=l.check_guid
where l.is_current and l.location_id=coalesce(p.location_id,e.location_id) and coalesce(p.stage,'')<>'lost'
and lower(coalesce(e.status,'')) !~ '(cancel|reject|fail)'
and not t.voided and not t.deleted and not t.excess_food and not c.voided and not c.deleted
and ((l.evidence='normalized_code' and abs(t.business_date-e.event_date)<=1)
 or (l.evidence='late_code' and t.business_date-e.event_date between 2 and 7)
 or (l.evidence='daily_batch' and t.business_date-e.event_date between 0 and 1));
create view public.ezcater_valid_toast_links with (security_invoker=true) as select * from public.ezcater_current_toast_links;
create view public.ezcater_reconciliation_status with (security_invoker=true) as
select e.id order_id,coalesce(p.location_id,e.location_id) location_id,e.event_date,e.order_number,
case when bool_or(l.amount_mismatch) then 'amount_mismatch' when count(l.id)>0 then 'matched' else 'not_rung_in_toast' end status,
case when bool_or(l.evidence='normalized_code') then 'normalized_code'
 when bool_or(l.evidence='late_code') then 'late_code'
 when bool_or(l.evidence='daily_batch') then 'daily_batch' else null end rule,
max(l.amount_diff_cents) amount_diff_cents,
e.lead_id,e.handoff_time,e.event_timestamp,e.headcount,e.total_cents
from public.ezcater_orders e left join public.catering_pipeline p on p.id=e.lead_id
left join public.ezcater_current_toast_links l on l.order_id=e.id
where e.snapshot_id is not null and e.event_date is not null and coalesce(p.stage,'')<>'lost'
and lower(coalesce(e.status,'')) !~ '(cancel|reject|fail)'
group by e.id,p.location_id;
create view public.ezcater_toast_orphans with (security_invoker=true) as
select t.location_id,t.business_date,t.order_guid,c.check_guid,c.amount_cents
from public.toast_orders_latest t join public.toast_order_checks c on c.snapshot_id=t.id
where not t.voided and not t.deleted and not t.excess_food and not c.voided and not c.deleted
and exists(select 1 from public.toast_dining_options d where d.location_id=t.location_id and d.guid=t.dining_option_guid
 and lower(regexp_replace(d.name,'[^a-zA-Z0-9]','','g'))='ezcater')
and not exists(select 1 from public.ezcater_current_toast_links l where l.toast_snapshot_id=t.id and l.check_guid=c.check_guid)
-- Only where ezCater history exists: Toast sales reach back 12 months, ezCater orders do not.
and t.business_date >= (select min(e.event_date) - 1 from public.ezcater_orders e where e.event_date is not null);
revoke all on public.ezcater_current_toast_links,public.ezcater_valid_toast_links,public.ezcater_reconciliation_status,public.ezcater_toast_orphans from public,anon,authenticated,service_role;
grant select on public.ezcater_current_toast_links,public.ezcater_valid_toast_links,public.ezcater_reconciliation_status,public.ezcater_toast_orphans to service_role;

create function public.reconcile_ezcater_toast(p_from date,p_to date) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare changed integer:=0; retired integer:=0; resolved integer:=0;
begin
 if p_from is null or p_to is null or p_to<p_from then raise exception 'ezcater_reconcile_invalid_range'; end if;
 perform pg_advisory_xact_lock(hashtext('ezcater-toast-reconcile'));
 -- Acquire the same provider locks as snapshot/transfer/publisher before row locks.
 perform pg_advisory_xact_lock(hashtext(provider_uuid)) from public.ezcater_orders order by provider_uuid;
 create temporary table ezcater_reconcile_plan on commit drop as select * from public.plan_ezcater_toast() with no data;
 insert into pg_temp.ezcater_reconcile_plan select * from public.plan_ezcater_toast();
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

-- Re-emitted 0225 publisher; maps/reviews/shadow bodies unchanged.
create or replace function public.publish_ezcater_shadow(p_order_id uuid,p_snapshot_id uuid,p_location_id uuid,p_payload jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.ezcater_orders%rowtype; l public.catering_pipeline%rowtype; r jsonb;
begin
 perform pg_advisory_xact_lock(hashtext('ezcater-toast-reconcile'));
 -- Share apply/transfer's provider lock before any row locks; snapshot/shop fence stale work.
 select * into o from public.ezcater_orders where id=p_order_id;
 if o.id is null then raise exception 'ezcater_shadow_source_changed'; end if;
 perform pg_advisory_xact_lock(hashtext(o.provider_uuid));
 select * into l from public.catering_pipeline where id=o.lead_id for update;
 select * into o from public.ezcater_orders where id=p_order_id for update;
 if o.id is null or o.snapshot_id is distinct from p_snapshot_id or l.location_id is distinct from p_location_id then
  raise exception 'ezcater_shadow_source_changed';
 end if;
 -- Lock every existing identity used by this publication, including review-only payloads.
 -- A decision cannot race a status check and leave a newly inserted unresolved candidate.
 perform 1 from public.ezcater_item_map m where m.location_id=p_location_id and m.identity_key in (
  select value->>'identity_key' from jsonb_array_elements(p_payload->'maps')
  union select value->>'identity_key' from jsonb_array_elements(p_payload->'reviews')
 ) order by m.identity_key for update;
 -- Retire only stale code evidence; daily batches are recomputed by the reconciler.
 update public.ezcater_toast_links lk set is_current=false where lk.order_id=o.id and lk.is_current
 and lk.evidence in ('normalized_code','late_code') and not exists(
 select 1 from jsonb_array_elements(p_payload->'links') x where lk.snapshot_id=o.snapshot_id
 and lk.location_id=p_location_id and lk.toast_snapshot_id=(x->>'toast_snapshot_id')::uuid
 and lk.order_guid=x->>'order_guid' and lk.check_guid=x->>'check_guid' and lk.selection_guid=x->>'selection_guid'
 and lk.evidence=coalesce(x->>'evidence','normalized_code'));

 update public.ezcater_shadow_depletion set is_current=false where order_id=o.id and is_current;
 for r in select value from jsonb_array_elements(p_payload->'links') loop
  if not exists(select 1 from public.toast_order_latest_pointers p join public.toast_orders t on t.id=p.snapshot_id
   where p.snapshot_id=(r->>'toast_snapshot_id')::uuid and p.location_id=p_location_id
    and t.order_guid=r->>'order_guid' and ((coalesce(r->>'evidence','normalized_code')='normalized_code' and abs(t.business_date-o.event_date)<=1)
     or (r->>'evidence'='late_code' and t.business_date-o.event_date between 2 and 7))
    and not t.voided and not t.deleted and not t.excess_food
    and exists(select 1 from jsonb_array_elements(t.selection_units) s
      where s->>'check_guid'=r->>'check_guid' and s->>'selection_guid'=r->>'selection_guid'
       and not (s->>'voided')::boolean and not (s->>'deleted')::boolean)) then
   raise exception 'ezcater_shadow_toast_changed';
  end if;
  insert into public.ezcater_toast_links(order_id,snapshot_id,location_id,toast_snapshot_id,order_guid,check_guid,selection_guid,business_date,evidence)
  values(o.id,o.snapshot_id,p_location_id,(r->>'toast_snapshot_id')::uuid,r->>'order_guid',r->>'check_guid',r->>'selection_guid',(r->>'business_date')::date,coalesce(r->>'evidence','normalized_code'))
  on conflict(order_id,location_id,check_guid,selection_guid) where is_current do nothing;
 end loop;
 for r in select value from jsonb_array_elements(p_payload->'maps') order by value->>'identity_key' loop
  insert into public.ezcater_item_map(location_id,identity_key,provider_item_uuid,menu_item_size_id,pos_item_id,toast_item_guid,item_id,menu_item_id,package_id,toast_map_id,status,evidence,candidates)
  values(p_location_id,r->>'identity_key',r->>'provider_item_uuid',r->>'menu_item_size_id',nullif(btrim(r->>'pos_item_id'),''),r->>'toast_item_guid',(r->>'item_id')::uuid,(r->>'menu_item_id')::uuid,(r->>'package_id')::uuid,(r->>'toast_map_id')::uuid,r->>'status',r->>'evidence',r->'candidates')
  on conflict(location_id,identity_key) do update set pos_item_id=excluded.pos_item_id,toast_item_guid=excluded.toast_item_guid,
   item_id=excluded.item_id,menu_item_id=excluded.menu_item_id,package_id=excluded.package_id,toast_map_id=excluded.toast_map_id,status=excluded.status,evidence=excluded.evidence,candidates=excluded.candidates,updated_at=clock_timestamp()
   where ezcater_item_map.status='review';
 end loop;
 for r in select value from jsonb_array_elements(p_payload->'reviews') loop
  if r->>'source'='ezcater' and exists(select 1 from public.ezcater_item_map
   where location_id=p_location_id and identity_key=r->>'identity_key' and status in ('confirmed','ignored')) then continue; end if;
  insert into public.ezcater_review_queue(order_id,snapshot_id,location_id,source,code,identity_key,candidates)
  values(o.id,o.snapshot_id,p_location_id,r->>'source',r->>'code',r->>'identity_key',r->'candidates')
  on conflict(order_id,location_id,source,code,identity_key) do update set snapshot_id=excluded.snapshot_id,location_id=excluded.location_id,
   candidates=excluded.candidates,last_seen_at=clock_timestamp();
 end loop;
 for r in select value from jsonb_array_elements(p_payload->'shadow') loop
  insert into public.ezcater_shadow_depletion(order_id,snapshot_id,location_id,event_date,ordinal,sku_id,sales_oz,suppressed_oz,shadow_oz,current_day_sales_oz)
  values(o.id,o.snapshot_id,p_location_id,o.event_date,(r->>'ordinal')::int,(r->>'sku_id')::uuid,
   (r->>'sales_oz')::numeric,(r->>'suppressed_oz')::numeric,(r->>'shadow_oz')::numeric,(r->>'current_day_sales_oz')::numeric);
 end loop;
end $$;
revoke all on function public.publish_ezcater_shadow(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.publish_ezcater_shadow(uuid,uuid,uuid,jsonb) to service_role;

alter table public.ezcater_shadow_depletion add column reconciled_day_sales_oz numeric check(reconciled_day_sales_oz>=0);
create function public.record_ezcater_reconciled_comparison(p_from date,p_to date,p_rows jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if p_from is null or p_to is null or p_to<p_from or jsonb_typeof(p_rows) is distinct from 'array' then
 raise exception 'ezcater_comparison_invalid'; end if;
 if exists(select 1 from jsonb_to_recordset(p_rows) as x(location_id uuid,business_date date,sku_id uuid,direct_oz numeric)
 where location_id is null or sku_id is null or business_date is null or business_date not between p_from and p_to
 or direct_oz is null or direct_oz<0 or direct_oz::text in ('NaN','Infinity','-Infinity')) then raise exception 'ezcater_comparison_invalid'; end if;
 if exists(select 1 from jsonb_to_recordset(p_rows) as x(location_id uuid,business_date date,sku_id uuid,direct_oz numeric)
 group by location_id,business_date,sku_id having count(*)>1) then raise exception 'ezcater_comparison_duplicate'; end if;
 perform pg_advisory_xact_lock(hashtext('ezcater-toast-reconcile'));
 update public.ezcater_shadow_depletion s set reconciled_day_sales_oz=coalesce((
 select x.direct_oz from jsonb_to_recordset(p_rows) as x(location_id uuid,business_date date,sku_id uuid,direct_oz numeric)
 where x.location_id=s.location_id and x.business_date=s.event_date and x.sku_id=s.sku_id),0)
 where s.is_current and s.event_date between p_from and p_to;
end $$;
revoke all on function public.record_ezcater_reconciled_comparison(date,date,jsonb) from public,anon,authenticated;
grant execute on function public.record_ezcater_reconciled_comparison(date,date,jsonb) to service_role;

-- Effective privileges, including PUBLIC and column ACLs. Service writes only via RPC.
do $$ declare t text; r text; f regprocedure; begin
 foreach t in array array['ezcater_review_resolutions','ezcater_current_toast_links','ezcater_valid_toast_links','ezcater_reconciliation_status','ezcater_toast_orphans'] loop
 foreach r in array array['anon','authenticated','service_role'] loop
 if has_table_privilege(r,'public.'||t,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 or has_any_column_privilege(r,'public.'||t,'INSERT,UPDATE,REFERENCES')
 or (r<>'service_role' and has_any_column_privilege(r,'public.'||t,'SELECT'))
 or (r='service_role' and not has_table_privilege(r,'public.'||t,'SELECT')) then raise exception '0229 table ACL'; end if;
 end loop;
 if exists(select 1 from pg_class c,lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
 where c.oid=('public.'||t)::regclass and a.grantee=0)
 or exists(select 1 from pg_attribute c,lateral aclexplode(c.attacl) a where c.attrelid=('public.'||t)::regclass and a.grantee=0)
 then raise exception '0229 PUBLIC table ACL'; end if;
 end loop;
 foreach f in array array['public.plan_ezcater_toast()'::regprocedure,'public.reconcile_ezcater_toast(date,date)'::regprocedure,
 'public.record_ezcater_reconciled_comparison(date,date,jsonb)'::regprocedure,'public.publish_ezcater_shadow(uuid,uuid,uuid,jsonb)'::regprocedure] loop
 if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
 or not has_function_privilege('service_role',f,'EXECUTE') or exists(select 1 from pg_proc p,
 lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=f and a.grantee=0)
 then raise exception '0229 function ACL'; end if;
 end loop;
end $$;
commit;
