-- Migration 0247_sales_refund_candidates
-- AUTHORED 2026-10-11, NOT YET APPLIED -- GATE CC: sim first, then prod.
-- Plan: docs/plans/2026-10-11-sales-report-refund-scan.md.
-- Performance only: replace ONLY 0239's refund_facts CTE; every other function
-- byte and the exact revoke/grant statements are retained. No data rewrite.
-- A uses toast_payments_refund_date (0221). B and C use the partial indexes below.
begin;
create index toast_payments_undated_refund_evidence
  on public.toast_payments(snapshot_id, check_guid)
  where refund_business_date is null and sales_refund_cents is distinct from 0
    and (refund_amount_cents is not null or refund_status in ('PARTIAL', 'FULL'));
create index toast_order_checks_accounted
  on public.toast_order_checks(snapshot_id, check_guid)
  where accounting is not null;

create or replace function public.sales_report_daily(p_location_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.sales_report_assert_window(p_location_id, p_from, p_to);
  with f as materialized (
    select facts.*, c.accounting from public.sales_report_facts(p_location_id, p_from, p_to) facts
    join public.toast_order_checks c on c.snapshot_id = facts.snapshot_id and c.check_guid = facts.check_guid
  ), refund_facts as materialized (
    -- Materialize only the three disjoint candidate sets BEFORE the latest-pointer
    -- and classification joins. Legacy NULL payments never drive the broad join.
    with candidates as materialized (
      -- A: the existing toast_payments_refund_date partial index bounds dated refunds.
      select pm.* from public.toast_payments pm
      where pm.refund_business_date between p_from and p_to
      union all
      -- B: the new evidence-only partial index excludes legacy NULL-only payments.
      select pm.* from public.toast_payments pm
      where pm.refund_business_date is null and pm.sales_refund_cents is distinct from 0
        and (pm.refund_amount_cents is not null or pm.refund_status in ('PARTIAL', 'FULL'))
      union all
      -- C: start with accounted checks (partial index), then probe payments by
      -- their snapshot_id PK prefix. Indexing NULL payments would include legacy
      -- history; accounted checks exclude it without changing any stored NULL.
      select pm.* from public.toast_order_checks c
      cross join lateral (
        select pm.* from public.toast_payments pm
        where pm.snapshot_id = c.snapshot_id and pm.check_guid = c.check_guid
          and pm.refund_business_date is null and pm.sales_refund_cents is null
          -- IS NOT TRUE retains a NULL status; plain NOT would lose unknown refunds.
          and (pm.refund_amount_cents is not null or pm.refund_status in ('PARTIAL', 'FULL')) is not true
        -- Keep the lookup parameterized by an accounted check: flattening this
        -- join could instead scan all legacy NULL payments before rejecting them.
        offset 0
      ) pm
      where c.accounting is not null
    )
    select pm.*, p.business_date as order_business_date
    from candidates pm
    join public.toast_order_latest_pointers p on p.snapshot_id = pm.snapshot_id and p.location_id = p_location_id
    join public.toast_orders o on o.id = p.snapshot_id
    join public.toast_order_checks c on c.snapshot_id = o.id and c.check_guid = pm.check_guid
    left join public.toast_dining_options d on d.location_id = p.location_id and d.guid = o.dining_option_guid
    left join public.sales_channel_map m on m.dining_option_label = d.name
    where (pm.refund_business_date is not null or p.business_date <= p_to)
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
