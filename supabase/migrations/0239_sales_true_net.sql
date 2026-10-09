-- Migration 0239_sales_true_net
-- APPLIED TO PROD 2026-10-09 (20261009044826; sim 20261009044742, harness pass; prod dry run pass).
-- Approved plan: docs/superpowers/plans/2026-10-09-sales-true-net.md (CC review).
-- Item-sales basis: all non-gratuity service charges removed once, tax/tips excluded,
-- discounts/comps combined without name heuristics, priced selection voids restored to gross.
-- No data rewrite/backfill. Historical immutable snapshots stay unknown until normal recapture.
-- 0221 capture writer reproduced with ONLY additive child insert fields; locks, retry,
-- membership, and pointer publication unchanged. Apply this BEFORE deploying the new normalizer:
-- the old writer ignores new fields, but hashes would already contain them, preventing enrichment
-- by an identical later recapture. No capture orchestration or additional API requests here.
-- 0237 toast_modified_save uses the toast_payments rowtype dynamically: the new nullable column
-- participates in payment dedup without replacing that function. Check-only changes still need
-- full-day recapture. One payment per reconciled transaction carries sales refunds (others zero).
-- 0232 daily reader retained, with bounded accounting joins/aggregates only. Null means unknown;
-- refunds stay on their REFUND dates, same classifier, latest snapshots, 31-day guard unchanged.
-- Existing deny-all RLS/table grants remain; no new table, policy, direct writer or index.
begin;
alter table public.toast_order_checks add column accounting jsonb
  check (accounting is null or (jsonb_typeof(accounting) = 'object' and accounting->>'version' = '1'));
alter table public.toast_payments add column sales_refund_cents bigint
  check (sales_refund_cents is null or sales_refund_cents >= 0);
create or replace function public.toast_capture_page(p_run_id uuid,p_location_id uuid,p_business_date date,p_page integer,p_orders jsonb)
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
  insert into public.toast_orders(location_id,order_guid,business_date,content_hash,opened_at,closed_at,paid_at,modified_at,promised_at,source,revenue_center_guid,dining_option_guid,server_guid,deleted,voided,excess_food,third_party_provider_guid,third_party_provider_name,selection_units)
  values(p_location_id,v_order->>'order_guid',p_business_date,v_entry->>'content_hash',(v_order->>'opened_at')::timestamptz,(v_order->>'closed_at')::timestamptz,(v_order->>'paid_at')::timestamptz,(v_order->>'modified_at')::timestamptz,(v_order->>'promised_at')::timestamptz,v_order->>'source',v_order->>'revenue_center_guid',v_order->>'dining_option_guid',v_order->>'server_guid',(v_order->>'deleted')::boolean,(v_order->>'voided')::boolean,(v_order->>'excess_food')::boolean,v_order->>'third_party_provider_guid',v_order->>'third_party_provider_name',coalesce(v_order->'selection_units','[]'::jsonb))
  on conflict(location_id,order_guid,content_hash) do nothing returning id into v_snapshot;
  v_new := v_snapshot is not null;
  if not v_new then select id into strict v_snapshot from public.toast_orders where location_id=p_location_id and order_guid=v_order->>'order_guid' and content_hash=v_entry->>'content_hash'; end if;
  if v_new then
   insert into public.toast_order_checks(snapshot_id,check_guid,amount_cents,tax_cents,total_cents,voided,deleted,accounting) select v_snapshot,x.* from jsonb_to_recordset(v_entry->'checks') as x(check_guid text,amount_cents bigint,tax_cents bigint,total_cents bigint,voided boolean,deleted boolean,accounting jsonb);
   insert into public.toast_check_discounts(snapshot_id,check_guid,ordinal,selection_guid,applied_discount_guid,discount_guid,name,amount_cents,reason_guid,reason_name,approver_guid) select v_snapshot,x.* from jsonb_to_recordset(v_entry->'discounts') as x(check_guid text,ordinal integer,selection_guid text,applied_discount_guid text,discount_guid text,name text,amount_cents bigint,reason_guid text,reason_name text,approver_guid text);
   insert into public.toast_check_service_charges(snapshot_id,check_guid,ordinal,service_charge_guid,name,amount_cents,gratuity,taxable) select v_snapshot,x.* from jsonb_to_recordset(v_entry->'service_charges') as x(check_guid text,ordinal integer,service_charge_guid text,name text,amount_cents bigint,gratuity boolean,taxable boolean);
   insert into public.toast_payments(snapshot_id,check_guid,payment_guid,type,payment_status,refund_status,amount_cents,tip_cents,paid_business_date,refund_amount_cents,refund_tip_cents,refund_business_date,void_business_date,server_guid,sales_refund_cents) select v_snapshot,x.* from jsonb_to_recordset(v_entry->'payments') as x(check_guid text,payment_guid text,type text,payment_status text,refund_status text,amount_cents bigint,tip_cents bigint,paid_business_date date,refund_amount_cents bigint,refund_tip_cents bigint, refund_business_date date,void_business_date date,server_guid text,sales_refund_cents bigint);
  end if;
  -- Repeated orders across pages indicate an unstable paginated response: refuse publication.
  insert into public.toast_capture_run_orders(run_id,snapshot_id,location_id,business_date,order_guid,page) values(p_run_id,v_snapshot,p_location_id,p_business_date,v_order->>'order_guid',p_page);
 end loop;
 update public.toast_capture_runs set pages=pages+1,orders=orders+jsonb_array_length(p_orders) where id=p_run_id;
end $$;

create or replace function public.sales_report_daily(p_location_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.sales_report_assert_window(p_location_id, p_from, p_to);
  with f as materialized (
    select facts.*, c.accounting from public.sales_report_facts(p_location_id, p_from, p_to) facts
    join public.toast_order_checks c on c.snapshot_id = facts.snapshot_id and c.check_guid = facts.check_guid
  ), refund_facts as materialized (
    select pm.*, p.business_date as order_business_date
    from public.toast_payments pm
    join public.toast_order_latest_pointers p on p.snapshot_id = pm.snapshot_id and p.location_id = p_location_id
    join public.toast_orders o on o.id = p.snapshot_id
    join public.toast_order_checks c on c.snapshot_id = o.id and c.check_guid = pm.check_guid
    left join public.toast_dining_options d on d.location_id = p.location_id and d.guid = o.dining_option_guid
    left join public.sales_channel_map m on m.dining_option_label = d.name
    where (pm.refund_business_date between p_from and p_to
      or (pm.refund_business_date is null and p.business_date <= p_to
        and pm.sales_refund_cents is distinct from 0
        and (pm.refund_amount_cents is not null or pm.refund_status in ('PARTIAL', 'FULL')
          or (pm.sales_refund_cents is null and c.accounting is not null))))
      and not o.deleted and not c.deleted
      and public.sales_report_class(o.voided or c.voided, o.excess_food, m.reviewed_at is not null, m.provider,
            exists (select 1 from public.ezcater_current_toast_links l where l.location_id = p_location_id
                     and l.business_date = p.business_date and l.toast_snapshot_id = o.id and l.check_guid = c.check_guid)) = 'sale'
  ), undated as (
    -- A refund without a date can affect any report day on/after the original sale,
    -- including when that sale predates this window. Never invent a monetary allocation.
    -- Group BEFORE expanding to the <=31 report days (at most 31 start-date groups).
    -- New captures distinguish no refund (sales_refund_cents=0) from unallocatable (NULL).
    -- Legacy captures need refund amount/status evidence; NULL alone predates this feature.
    select greatest(order_business_date, p_from) as first_possible_day, count(*) as missing
    from refund_facts where refund_business_date is null
    group by greatest(order_business_date, p_from)
  )
  select jsonb_build_object(
    'classes', coalesce((select jsonb_agg(x order by x->>'business_date', x->>'sale_class') from (
      select jsonb_build_object('business_date', business_date, 'sale_class', sale_class, 'checks', count(*),
        'amount_cents', coalesce(sum(amount_cents), 0), 'tax_cents', coalesce(sum(tax_cents), 0),
        
        'gross_cents', case when count(*) filter (where accounting->>'gross_cents' is null) > 0 then null else coalesce(sum((accounting->>'gross_cents')::bigint), 0) end,
        'discounts_comps_cents', case when count(*) filter (where accounting->>'discounts_comps_cents' is null) > 0 then null else coalesce(sum((accounting->>'discounts_comps_cents')::bigint), 0) end,
        'voids_cents', case when count(*) filter (where accounting->>'voids_cents' is null) > 0 then null else coalesce(sum((accounting->>'voids_cents')::bigint), 0) end,
        'service_charges_cents', case when count(*) filter (where accounting->>'service_charges_cents' is null) > 0 then null else coalesce(sum((accounting->>'service_charges_cents')::bigint), 0) end,
        'accounting_missing', count(*) filter (where accounting->>'gross_cents' is null or accounting->>'discounts_comps_cents' is null or accounting->>'voids_cents' is null or accounting->>'service_charges_cents' is null or accounting->>'pre_refund_cents' is null),
        'amount_missing', count(*) filter (where amount_cents is null),
        'tax_missing', count(*) filter (where tax_cents is null)) x
      from f group by business_date, sale_class) s), '[]'::jsonb),
    'tips', coalesce((select jsonb_agg(x order by x->>'business_date') from (
      select jsonb_build_object('business_date', f.business_date, 'tip_cents', coalesce(sum(pm.tip_cents), 0),
        'tip_missing', count(*) filter (where pm.tip_cents is null)) x
      from f join public.toast_payments pm on pm.snapshot_id = f.snapshot_id and pm.check_guid = f.check_guid
      where f.sale_class = 'sale' and coalesce(pm.payment_status, '') not in ('VOIDED', 'DENIED')
      group by f.business_date) s), '[]'::jsonb),
    'discounts', coalesce((select jsonb_agg(x order by x->>'business_date') from (
      select jsonb_build_object('business_date', f.business_date, 'count', count(*), 'cents', coalesce(sum(dc.amount_cents), 0),
        'amount_missing', count(*) filter (where dc.amount_cents is null)) x
      from f join public.toast_check_discounts dc on dc.snapshot_id = f.snapshot_id and dc.check_guid = f.check_guid
      where f.sale_class = 'sale' and public.sales_report_discount_counts(f.selection_units, f.check_guid, dc.selection_guid)
      group by f.business_date) s), '[]'::jsonb),
    -- Refunds keep their REFUND date and may belong to an order from any earlier date: the order's own
    -- check is classified with the same rules (an E-Gift Card or ezCater-linked refund is not a Sales
    -- refund). The ezCater link lookup is bounded to that order's shop + business date.
    'refunds', coalesce((select jsonb_agg(x order by x->>'business_date') from (
      select jsonb_build_object('business_date', pm.refund_business_date, 'count', count(*),
        'refund_cents', coalesce(sum(pm.refund_amount_cents), 0), 'refund_tip_cents', coalesce(sum(pm.refund_tip_cents), 0),
        'sales_refund_cents', case when count(*) filter (where pm.sales_refund_cents is null) > 0 then null else coalesce(sum(pm.sales_refund_cents), 0) end,
        'sales_refund_missing', count(*) filter (where pm.sales_refund_cents is null)) x
      from refund_facts pm
      -- A dated refund with a missing amount is unknown, not absent (and not zero sales refunds).
      where pm.refund_business_date between p_from and p_to
      group by pm.refund_business_date
      union all
      -- Uncertainty-only rows: no invented dated refunds, dollars or tips. The existing
      -- summary propagates NULL and missing counts through day/week/window exact net.
      select jsonb_build_object('business_date', p_from + days.offset_days,
        'count', 0, 'refund_cents', 0, 'refund_tip_cents', 0,
        'sales_refund_cents', null, 'sales_refund_missing', sum(u.missing)) x
      from generate_series(0, p_to - p_from) as days(offset_days)
      join undated u on u.first_possible_day <= p_from + days.offset_days
      group by days.offset_days) s), '[]'::jsonb),
    'captured_days', coalesce((select jsonb_agg(distinct r.business_date) from public.toast_capture_runs r
      where r.location_id = p_location_id and r.business_date between p_from and p_to and r.status = 'completed'), '[]'::jsonb),
    -- ezCater: subtotal AS REPORTED by ezCater. Whether it is before or after ezCater's own discounts is
    -- unverified (no discounted ezCater order exists yet); discounts are NOT subtracted speculatively.
    'ezcater', coalesce((select jsonb_agg(x order by x->>'business_date') from (
      select jsonb_build_object('business_date', e.event_date, 'orders', count(*),
        'subtotal_cents', coalesce(sum(e.subtotal_cents), 0), 'amount_missing', count(*) filter (where e.subtotal_cents is null)) x
      from public.ezcater_orders e left join public.catering_pipeline cp on cp.id = e.lead_id
      where e.event_date between p_from and p_to and coalesce(cp.location_id, e.location_id) = p_location_id
        and e.snapshot_id is not null and coalesce(cp.stage, '') <> 'lost'
        and lower(coalesce(e.status, '')) !~ '(cancel|reject|fail)'
      group by e.event_date) s), '[]'::jsonb)
  ) into v;
  return v;
end $$;

revoke all on function public.toast_capture_page(uuid,uuid,date,integer,jsonb),
  public.sales_report_daily(uuid,date,date) from public, anon, authenticated, service_role;
grant execute on function public.toast_capture_page(uuid,uuid,date,integer,jsonb),
  public.sales_report_daily(uuid,date,date) to service_role;
commit;
