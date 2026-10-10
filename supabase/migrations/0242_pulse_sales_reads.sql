-- Migration 0242_pulse_sales_reads
-- APPLIED TO PROD 2026-10-10 (20261010144237; sim 20261010144153 harness + parity pass; cold prod: today 0.4-0.6 s, baseline 1.3-4.6 s).
-- Approved: docs/pulse-sales-timeout-plan.md (CC cross-family plan review).
-- Read-only, service-role only; no new indexes/tables, index growth = 0 bytes.
-- Apply before app rollout. Reports > Sales and its 0239 accounting semantics are unchanged.
--
-- EXPECTED COLD COST (structural estimate, NOT a measured latency guarantee):
-- Today: one day of latest check facts + counted discounts, dated refund candidates in
-- the requested window (all shops, then filtered to this shop), and completed capture runs.
-- Baseline: one <=28-day fact pass via the existing hour_weekday reader + capture coverage.
-- App cold source: 7 RPCs (today, baseline, five one-day breakdowns); shared cache hit: 0.
-- Target: today finishes inside the 7s section / 8s DB limit; baseline has a 3s app budget.
-- No all-history undated-refund arm or accounting JSON is read. 0239's history scan is a
-- suspected cold hotspot, not proven by EXPLAIN. Pulse has no use for undated uncertainty.
-- Dated refunds on OLD sales remain included; never bound their original sale date.
--
-- EXPECTED INDEX PATHS (planner may choose sequential scans for small tables; verify on sim):
-- Today classes/discounts and baseline hour_weekday: toast_order_latest_pointers_location_date
-- (shop/date), toast_orders_pkey, toast_order_checks_pkey; discounts: toast_check_discounts_pkey.
-- Dated refunds: toast_payments_refund_date (partial, refund window), toast_orders_pkey,
-- toast_order_latest_pointers_pkey (shop/order GUID plus latest snapshot equality), checks PK.
-- Both coverage queries + today's max finished_at: toast_capture_runs_location_date;
-- max sorts/scans matching runs only (finished_at is not indexed).
-- Classifier: toast_dining_options_pkey, sales_channel_map_pkey; ezCater link view is scoped
-- by shop + order business date (its underlying indexes are described in the timing runbook).
-- Five unchanged breakdown queries use the same fact indexes; item expands bounded selection
-- JSON, discount uses its PK, server uses toast_time_entries_location_date (+/-1 day),
-- channel's ezCater arm uses ezcater_orders_refresh and catering_pipeline_pkey.
-- Repeated five fact reads remain a cold cost; no production-sized guarantee without timings.
begin;
create function public.pulse_sales_today(p_location_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.sales_report_assert_window(p_location_id, p_from, p_to);
  if p_from <> p_to then raise exception 'pulse_today_requires_one_day'; end if;
  with f as materialized (select * from public.sales_report_facts(p_location_id, p_from, p_to))
  select jsonb_build_object(
    'classes', coalesce((select jsonb_agg(x order by x->>'business_date', x->>'sale_class') from (
      select jsonb_build_object('business_date', business_date, 'sale_class', sale_class, 'checks', count(*),
        'amount_cents', coalesce(sum(amount_cents), 0), 'tax_cents', coalesce(sum(tax_cents), 0),
        'amount_missing', count(*) filter (where amount_cents is null),
        'tax_missing', count(*) filter (where tax_cents is null)) x
      from f group by business_date, sale_class) s), '[]'::jsonb),
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
        'refund_cents', coalesce(sum(pm.refund_amount_cents), 0), 'refund_tip_cents', coalesce(sum(pm.refund_tip_cents), 0)) x
      from public.toast_payments pm
      join public.toast_orders o on o.id = pm.snapshot_id and o.location_id = p_location_id
      join public.toast_order_latest_pointers p on p.location_id = o.location_id and p.order_guid = o.order_guid
        and p.snapshot_id = o.id
      join public.toast_order_checks c on c.snapshot_id = o.id and c.check_guid = pm.check_guid
      left join public.toast_dining_options d on d.location_id = p.location_id and d.guid = o.dining_option_guid
      left join public.sales_channel_map m on m.dining_option_label = d.name
      where pm.refund_business_date between p_from and p_to
        and not o.deleted and not c.deleted
        and public.sales_report_class(o.voided or c.voided, o.excess_food, m.reviewed_at is not null, m.provider,
              exists (select 1 from public.ezcater_current_toast_links l where l.location_id = p_location_id
                       and l.business_date = p.business_date and l.toast_snapshot_id = o.id and l.check_guid = c.check_guid)) = 'sale'
      group by pm.refund_business_date) s), '[]'::jsonb),
    'captured_days', coalesce((select jsonb_agg(distinct r.business_date) from public.toast_capture_runs r
      where r.location_id = p_location_id and r.business_date between p_from and p_to and r.status = 'completed'), '[]'::jsonb),
    'captured_at', (select max(r.finished_at) from public.toast_capture_runs r
      where r.location_id = p_location_id and r.business_date between p_from and p_to and r.status = 'completed')
  ) into v;
  return v;
end $$;

create function public.pulse_sales_baseline(p_location_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  perform public.sales_report_assert_window(p_location_id, p_from, p_to);
  if p_to - p_from > 27 then raise exception 'pulse_baseline_window_too_wide'; end if;
  return jsonb_build_object(
    'hours', public.sales_report_breakdown(p_location_id, p_from, p_to, 'hour_weekday'),
    'captured_days', coalesce((select jsonb_agg(distinct r.business_date) from public.toast_capture_runs r
      where r.location_id = p_location_id and r.business_date between p_from and p_to
        and r.status = 'completed'), '[]'::jsonb));
end $$;

revoke all on function public.pulse_sales_today(uuid,date,date),
  public.pulse_sales_baseline(uuid,date,date) from public, anon, authenticated, service_role;
grant execute on function public.pulse_sales_today(uuid,date,date),
  public.pulse_sales_baseline(uuid,date,date) to service_role;
commit;
