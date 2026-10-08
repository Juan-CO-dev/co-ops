-- Read-only shared planner. No notes, contacts or credentials. Current stored snapshots only.
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
select * from planned;
