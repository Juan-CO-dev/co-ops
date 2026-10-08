-- Migration 0232_reports_sales_reads
-- AUTHORED 2026-10-08 (Reports hub piece 4, Phase 2b: the Sales UI). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod.
-- r1 (2026-10-08, Astra review of PR #422): every internal read is bounded by the caller's shop + window
-- (ezCater links, labor names, catering values); refunds and discounts go through the same eligibility as
-- sales; unknown tax/discount/tip amounts are counted, never read as zero.
--
-- READ-ONLY. No table, no column, no index, no data change. Three internal helpers and seven STABLE
-- read RPCs over the Phase 2a capture (0221), the ezCater mirror (0223/0225), the ezCater <-> Toast
-- links (0229), Toast time entries (0224) and the catering pipeline (0195 valuation).
--
-- Juan's rulings (2026-10-08, binding):
--   * every discount BY NAME (grouped on the Toast discount name, never on a comp/discount partition);
--   * employee credit = the ORDER's server (toast_orders.server_guid), never the payment server;
--   * channels per the reviewed sales_channel_map; E-Gift Cards (reviewed provider 'gift_card') are NOT sales;
--   * ezCater orders are the revenue source of truth: a Toast check linked to an ezCater order through
--     ezcater_current_toast_links is classed 'ezcater_linked' and never counted as a Toast sale;
--   * no customer PII, no card data, no free-text comments: nothing here selects a contact, a card, a
--     note or a raw payload. Server names are the Toast FIRST name from 0224, nothing else.
--
-- WHAT THE MONEY IS (Astra P1-1). Toast's net-sales contract also removes deferred (gift-card sale /
-- house-account balance) selections and fundraising charges. The capture has no selection `deferred` /
-- `selectionType` and no fundraising fields, so this migration does NOT compute reconciled net sales:
-- `amount_cents` sums are CHECK TOTALS (pre-tax, pre-tip, after discounts, before refunds), labelled as
-- such on screen and in exports. Whole E-Gift Card checks are excluded by channel.
--
-- PERFORMANCE CONTRACT (lesson of #418/#419: the 8 s PostgREST statement timeout). Every RPC refuses a
-- window wider than 31 days and every internal read is bounded by that shop + window:
--   toast_order_latest_pointers_location_date (location_id, business_date)   -- every fact read
--   toast_order_checks / toast_check_discounts / toast_payments primary keys  -- snapshot joins
--   toast_payments_refund_date (refund_business_date) partial                  -- refunds by refund date
--   toast_capture_runs_location_date (location_id, business_date, status)     -- coverage
--   ezcater_orders_refresh (event_date)                                        -- ezCater by event date
--   toast_time_entries_location_date (location_id, business_date)             -- server first names (window +-1 day)
--   ezcater_toast_links: filtered by location + Toast business date inside the window
--   catering_pipeline: filtered by location + event date inside the window
-- No index is authored: CC runs the EXPLAIN ANALYZE set in the PR body; an index lands only where a
-- plan shows it is needed.
--
-- GRANTS. Nothing here is reachable by anon/authenticated (the staff JWT is a valid PostgREST bearer,
-- 0189). The RPCs are SECURITY DEFINER with a pinned search_path and are executable by service_role
-- only; the server loader authorizes the viewer (GM+ own shop, 8+ all shops) BEFORE any call. The
-- helpers are executable by nobody else: only the definer bodies (owner) call them. They are plain
-- LANGUAGE sql without SET so the planner can inline them; every reference is schema-qualified.
begin;

-- THE one classifier (sales checks AND refunds use it). Order matters: void, excess food, E-Gift Card,
-- linked to an ezCater order, else sale.
create function public.sales_report_class(p_voided boolean, p_excess_food boolean, p_reviewed boolean,
  p_provider text, p_ezcater_linked boolean)
returns text language sql immutable as $$
  select case when p_voided then 'void'
              when p_excess_food then 'excess_food'
              when p_reviewed and p_provider = 'gift_card' then 'gift_card'
              when p_ezcater_linked then 'ezcater_linked'
              else 'sale' end
$$;

-- A discount counts only on a live selection: check-level (no selection) or a selection of this check
-- that is neither voided nor deleted (Astra P2-4: capture keeps discounts of voided lines).
create function public.sales_report_discount_counts(p_units jsonb, p_check_guid text, p_selection_guid text)
returns boolean language sql immutable as $$
  select p_selection_guid is null or exists (
    select 1 from jsonb_array_elements(p_units) s
     where s->>'selection_guid' = p_selection_guid and s->>'check_guid' = p_check_guid
       and not coalesce((s->>'voided')::boolean, false) and not coalesce((s->>'deleted')::boolean, false))
$$;

-- ONE eligible-facts relation for every Sales read, bounded by the caller's shop + window: one row per
-- (latest order snapshot, check). Deleted orders/checks never happened and are absent; every other check
-- carries its class from sales_report_class. The ezCater link set is read for this shop + window only.
create function public.sales_report_facts(p_location_id uuid, p_from date, p_to date)
returns table(location_id uuid, business_date date, snapshot_id uuid, order_guid text, check_guid text,
  opened_at timestamptz, server_guid text, dining_option text, channel text, provider text, sale_class text,
  amount_cents bigint, tax_cents bigint, selection_units jsonb)
language sql stable as $$
  select p.location_id, p.business_date, o.id, p.order_guid, c.check_guid, o.opened_at, o.server_guid, d.name,
    case when m.reviewed_at is null or m.channel = 'Unknown' then 'unknown'
         when m.provider = 'gift_card' then 'gift_card'
         else m.channel end,
    case when m.reviewed_at is null or m.channel = 'Unknown' then null
         when m.channel = 'third_party' then coalesce(nullif(btrim(o.third_party_provider_name), ''), m.provider)
         else m.provider end,
    public.sales_report_class(o.voided or c.voided, o.excess_food, m.reviewed_at is not null, m.provider, lk.check_guid is not null),
    c.amount_cents, c.tax_cents, o.selection_units
  from public.toast_order_latest_pointers p
  join public.toast_orders o on o.id = p.snapshot_id
  join public.toast_order_checks c on c.snapshot_id = o.id
  left join public.toast_dining_options d on d.location_id = p.location_id and d.guid = o.dining_option_guid
  left join public.sales_channel_map m on m.dining_option_label = d.name
  left join (select distinct l.toast_snapshot_id, l.check_guid from public.ezcater_current_toast_links l
              where l.location_id = p_location_id and l.business_date between p_from and p_to) lk
    on lk.toast_snapshot_id = o.id and lk.check_guid = c.check_guid
  where p.location_id = p_location_id and p.business_date between p_from and p_to
    and not o.deleted and not c.deleted
$$;

-- The window guard every RPC runs first: a real shop, a real window, at most 31 days.
create function public.sales_report_assert_window(p_location_id uuid, p_from date, p_to date)
returns void language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if p_location_id is null or p_from is null or p_to is null then raise exception 'sales_report_invalid_window'; end if;
  if p_to < p_from or p_to - p_from > 30 then raise exception 'sales_report_window_too_wide'; end if;
end $$;

-- Per business day: checks + money by class (unknown amounts and taxes counted), tips and counted
-- discounts on sale checks, refunds by REFUND business date through the same classifier, completed
-- capture days (coverage) and ezCater orders by EVENT date.
create function public.sales_report_daily(p_location_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.sales_report_assert_window(p_location_id, p_from, p_to);
  with f as materialized (select * from public.sales_report_facts(p_location_id, p_from, p_to))
  select jsonb_build_object(
    'classes', coalesce((select jsonb_agg(x order by x->>'business_date', x->>'sale_class') from (
      select jsonb_build_object('business_date', business_date, 'sale_class', sale_class, 'checks', count(*),
        'amount_cents', coalesce(sum(amount_cents), 0), 'tax_cents', coalesce(sum(tax_cents), 0),
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
        'refund_cents', coalesce(sum(pm.refund_amount_cents), 0), 'refund_tip_cents', coalesce(sum(pm.refund_tip_cents), 0)) x
      from public.toast_payments pm
      join public.toast_order_latest_pointers p on p.snapshot_id = pm.snapshot_id and p.location_id = p_location_id
      join public.toast_orders o on o.id = p.snapshot_id
      join public.toast_order_checks c on c.snapshot_id = o.id and c.check_guid = pm.check_guid
      left join public.toast_dining_options d on d.location_id = p.location_id and d.guid = o.dining_option_guid
      left join public.sales_channel_map m on m.dining_option_label = d.name
      where pm.refund_business_date between p_from and p_to and pm.refund_amount_cents is not null
        and not o.deleted and not c.deleted
        and public.sales_report_class(o.voided or c.voided, o.excess_food, m.reviewed_at is not null, m.provider,
              exists (select 1 from public.ezcater_current_toast_links l where l.location_id = p_location_id
                       and l.business_date = p.business_date and l.toast_snapshot_id = o.id and l.check_guid = c.check_guid)) = 'sale'
      group by pm.refund_business_date) s), '[]'::jsonb),
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

-- One breakdown per call, aggregated in SQL. Keys are stable identities (item GUID, discount NAME,
-- server GUID, channel|provider, weekday|hour); labels ride along for display.
create function public.sales_report_breakdown(p_location_id uuid, p_from date, p_to date, p_dimension text)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.sales_report_assert_window(p_location_id, p_from, p_to);
  if p_dimension is null or p_dimension not in ('item', 'modifier', 'channel', 'hour_weekday', 'discount', 'server') then
    raise exception 'sales_report_invalid_dimension';
  end if;
  if p_dimension in ('item', 'modifier') then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v from (
      select jsonb_build_object('key', s->>'item_guid', 'label', max(s->>'name'),
        'units', sum((s->>'quantity')::numeric), 'checks', count(distinct (f.snapshot_id, f.check_guid))) x
      from public.sales_report_facts(p_location_id, p_from, p_to) f
      cross join lateral jsonb_array_elements(f.selection_units) s
      where f.sale_class = 'sale' and s->>'check_guid' = f.check_guid
        and not coalesce((s->>'voided')::boolean, false) and not coalesce((s->>'deleted')::boolean, false)
        and ((p_dimension = 'item') = (s->>'parent_selection_guid' is null))
      group by s->>'item_guid') q;
  elsif p_dimension = 'channel' then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v from (
      select jsonb_build_object('key', channel || '|' || coalesce(provider, ''), 'channel', channel, 'provider', provider,
        'sale_class', sale_class, 'checks', count(*), 'cents', coalesce(sum(amount_cents), 0),
        'amount_missing', count(*) filter (where amount_cents is null)) x
      from public.sales_report_facts(p_location_id, p_from, p_to)
      where sale_class in ('sale', 'gift_card', 'ezcater_linked')
      group by channel, provider, sale_class
      union all
      -- ezCater orders are their own source (by event date, subtotal as reported), never a Toast check.
      select jsonb_build_object('key', 'catering|ezCater', 'channel', 'catering', 'provider', 'ezCater',
        'sale_class', 'ezcater_source', 'checks', count(*), 'cents', coalesce(sum(e.subtotal_cents), 0),
        'amount_missing', count(*) filter (where e.subtotal_cents is null))
      from public.ezcater_orders e left join public.catering_pipeline cp on cp.id = e.lead_id
      where e.event_date between p_from and p_to and coalesce(cp.location_id, e.location_id) = p_location_id
        and e.snapshot_id is not null and coalesce(cp.stage, '') <> 'lost'
        and lower(coalesce(e.status, '')) !~ '(cancel|reject|fail)'
      having count(*) > 0) q;
  elsif p_dimension = 'hour_weekday' then
    -- Opened instant bucketed in America/New_York; the weekday is the BUSINESS date's (1 = Monday).
    -- Both fall-back 01:00 hours land in one cell; a missing opened time is hour -1 (unknown).
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v from (
      select jsonb_build_object('key', dow || '|' || hr, 'dow', dow, 'hour', hr, 'checks', count(*),
        'cents', coalesce(sum(amount_cents), 0), 'amount_missing', count(*) filter (where amount_cents is null)) x
      from (select extract(isodow from business_date)::int dow,
                   coalesce(extract(hour from opened_at at time zone 'America/New_York')::int, -1) hr, amount_cents
              from public.sales_report_facts(p_location_id, p_from, p_to) where sale_class = 'sale') b
      group by dow, hr) q;
  elsif p_dimension = 'discount' then
    -- BY NAME (Juan): one row per Toast discount name, never a comp/discount partition. Only discounts on
    -- live selections (or the check itself) count; an unknown amount is counted, never read as zero.
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v from (
      select jsonb_build_object('key', coalesce(nullif(btrim(dc.name), ''), ''), 'label', nullif(btrim(dc.name), ''),
        'count', count(*), 'checks', count(distinct (f.snapshot_id, f.check_guid)),
        'cents', coalesce(sum(dc.amount_cents), 0), 'amount_missing', count(*) filter (where dc.amount_cents is null)) x
      from public.sales_report_facts(p_location_id, p_from, p_to) f
      join public.toast_check_discounts dc on dc.snapshot_id = f.snapshot_id and dc.check_guid = f.check_guid
      where f.sale_class = 'sale' and public.sales_report_discount_counts(f.selection_units, f.check_guid, dc.selection_guid)
      group by coalesce(nullif(btrim(dc.name), ''), ''), nullif(btrim(dc.name), '')) q;
  else
    -- Credit = the ORDER's server (Juan). Name = latest Toast FIRST name from 0224 among the time entries
    -- of this window (+-1 day), never the shop's whole labor history.
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v from (
      with names as (
        select distinct on (t.employee_guid) t.employee_guid, t.employee_first_name
          from public.toast_time_entries t
         where t.location_id = p_location_id and t.business_date between p_from - 1 and p_to + 1
           and t.employee_first_name is not null and not t.deleted
         order by t.employee_guid, t.in_at desc)
      select jsonb_build_object('key', coalesce(f.server_guid, ''), 'label', max(n.employee_first_name),
        'checks', count(*), 'cents', coalesce(sum(f.amount_cents), 0),
        'amount_missing', count(*) filter (where f.amount_cents is null)) x
      from public.sales_report_facts(p_location_id, p_from, p_to) f
      left join names n on n.employee_guid = f.server_guid
      where f.sale_class = 'sale'
      group by coalesce(f.server_guid, '')) q;
  end if;
  return v;
end $$;

-- Sale checks, newest business date first, check GUID ascending; keyset after (date, check).
-- Filters are a closed allowlist; every one is a bound parameter, never SQL text.
create function public.sales_report_check_page(p_location_id uuid, p_from date, p_to date,
  p_after_date date, p_after_check text, p_limit integer,
  p_channel text, p_provider text, p_server text, p_discount text, p_dow integer, p_hour integer)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.sales_report_assert_window(p_location_id, p_from, p_to);
  if p_limit is null or p_limit < 1 or p_limit > 101 then raise exception 'sales_report_invalid_limit'; end if;
  if (p_after_date is null) <> (p_after_check is null) then raise exception 'sales_report_invalid_cursor'; end if;
  with page as (
    select f.* from public.sales_report_facts(p_location_id, p_from, p_to) f
    where f.sale_class = 'sale'
      and (p_after_date is null or f.business_date < p_after_date or (f.business_date = p_after_date and f.check_guid > p_after_check))
      and (p_channel is null or f.channel = p_channel)
      and (p_provider is null or coalesce(f.provider, '') = p_provider)
      and (p_server is null or coalesce(f.server_guid, '') = p_server)
      and (p_discount is null or exists (select 1 from public.toast_check_discounts dc where dc.snapshot_id = f.snapshot_id
            and dc.check_guid = f.check_guid and coalesce(nullif(btrim(dc.name), ''), '') = p_discount
            and public.sales_report_discount_counts(f.selection_units, f.check_guid, dc.selection_guid)))
      and (p_dow is null or extract(isodow from f.business_date)::int = p_dow)
      and (p_hour is null or coalesce(extract(hour from f.opened_at at time zone 'America/New_York')::int, -1) = p_hour)
    order by f.business_date desc, f.check_guid
    limit p_limit
  ), names as (
    -- Toast FIRST names (0224) for this page's servers, from this window's time entries only.
    select distinct on (t.employee_guid) t.employee_guid, t.employee_first_name
      from public.toast_time_entries t
     where t.location_id = p_location_id and t.business_date between p_from - 1 and p_to + 1
       and t.employee_first_name is not null and not t.deleted
       and t.employee_guid in (select server_guid from page where server_guid is not null)
     order by t.employee_guid, t.in_at desc
  )
  select coalesce(jsonb_agg(jsonb_build_object('business_date', f.business_date, 'check_guid', f.check_guid,
      'opened_at', f.opened_at, 'channel', f.channel, 'provider', f.provider, 'dining_option', f.dining_option,
      'server_guid', f.server_guid, 'server_name', n.employee_first_name,
      'amount_cents', f.amount_cents, 'tax_cents', f.tax_cents,
      'discount_cents', (select sum(dc.amount_cents) from public.toast_check_discounts dc
                          where dc.snapshot_id = f.snapshot_id and dc.check_guid = f.check_guid
                            and public.sales_report_discount_counts(f.selection_units, f.check_guid, dc.selection_guid)),
      'units', (select coalesce(sum((s->>'quantity')::numeric), 0) from jsonb_array_elements(f.selection_units) s
                 where s->>'check_guid' = f.check_guid and s->>'parent_selection_guid' is null
                   and not coalesce((s->>'voided')::boolean, false) and not coalesce((s->>'deleted')::boolean, false)))
    order by f.business_date desc, f.check_guid), '[]'::jsonb) into v
  from page f left join names n on n.employee_guid = f.server_guid;
  return v;
end $$;

-- One check's evidence, windowed by its business date first. No card data, contact or note exists
-- in these tables to select; payment TYPE only. Selections are the check's own capture units.
create function public.sales_report_check_detail(p_location_id uuid, p_business_date date, p_check_guid text)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.sales_report_assert_window(p_location_id, p_business_date, p_business_date);
  if p_check_guid is null or length(p_check_guid) > 64 then raise exception 'sales_report_invalid_check'; end if;
  select jsonb_build_object(
    'business_date', f.business_date, 'check_guid', f.check_guid, 'order_guid', f.order_guid,
    'opened_at', o.opened_at, 'closed_at', o.closed_at, 'paid_at', o.paid_at,
    'channel', f.channel, 'provider', f.provider, 'dining_option', f.dining_option, 'sale_class', f.sale_class,
    'server_guid', f.server_guid,
    'server_name', (select t.employee_first_name from public.toast_time_entries t
                     where t.location_id = p_location_id and t.business_date between p_business_date - 1 and p_business_date + 1
                       and t.employee_guid = f.server_guid and t.employee_first_name is not null and not t.deleted
                     order by t.in_at desc limit 1),
    'amount_cents', f.amount_cents, 'tax_cents', f.tax_cents, 'total_cents', c.total_cents,
    'ezcater_order_number', (select e.order_number from public.ezcater_current_toast_links l
                              join public.ezcater_orders e on e.id = l.order_id
                             where l.location_id = p_location_id and l.business_date = p_business_date
                               and l.toast_snapshot_id = f.snapshot_id and l.check_guid = f.check_guid limit 1),
    'discounts', coalesce((select jsonb_agg(jsonb_build_object('ordinal', dc.ordinal, 'name', nullif(btrim(dc.name), ''),
        'amount_cents', dc.amount_cents, 'selection_guid', dc.selection_guid,
        'counted', public.sales_report_discount_counts(f.selection_units, f.check_guid, dc.selection_guid)) order by dc.ordinal)
      from public.toast_check_discounts dc where dc.snapshot_id = f.snapshot_id and dc.check_guid = f.check_guid), '[]'::jsonb),
    'service_charges', coalesce((select jsonb_agg(jsonb_build_object('ordinal', sc.ordinal, 'name', nullif(btrim(sc.name), ''),
        'amount_cents', sc.amount_cents, 'gratuity', sc.gratuity) order by sc.ordinal)
      from public.toast_check_service_charges sc where sc.snapshot_id = f.snapshot_id and sc.check_guid = f.check_guid), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('type', pm.type, 'status', pm.payment_status,
        'amount_cents', pm.amount_cents, 'tip_cents', pm.tip_cents, 'paid_business_date', pm.paid_business_date,
        'refund_amount_cents', pm.refund_amount_cents, 'refund_business_date', pm.refund_business_date)
        order by pm.paid_business_date nulls last, pm.payment_guid)
      from public.toast_payments pm where pm.snapshot_id = f.snapshot_id and pm.check_guid = f.check_guid), '[]'::jsonb),
    'selections', coalesce((select jsonb_agg(jsonb_build_object('selection_guid', s->>'selection_guid',
        'parent_selection_guid', s->>'parent_selection_guid', 'item_guid', s->>'item_guid', 'name', s->>'name',
        'quantity', (s->>'quantity')::numeric, 'voided', coalesce((s->>'voided')::boolean, false)) order by ord)
      from jsonb_array_elements(f.selection_units) with ordinality as e(s, ord)
      where s->>'check_guid' = f.check_guid and not coalesce((s->>'deleted')::boolean, false)), '[]'::jsonb)
  ) into v
  from public.sales_report_facts(p_location_id, p_business_date, p_business_date) f
  join public.toast_orders o on o.id = f.snapshot_id
  join public.toast_order_checks c on c.snapshot_id = f.snapshot_id and c.check_guid = f.check_guid
  where f.check_guid = p_check_guid;
  return v;
end $$;

-- ezCater orders by event date (the catering slice), keyset (event_date desc, order id asc).
-- Logistics and money only: never the contact, never the notes.
create function public.sales_report_ezcater_page(p_location_id uuid, p_from date, p_to date,
  p_after_date date, p_after_id uuid, p_limit integer)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.sales_report_assert_window(p_location_id, p_from, p_to);
  if p_limit is null or p_limit < 1 or p_limit > 101 then raise exception 'sales_report_invalid_limit'; end if;
  if (p_after_date is null) <> (p_after_id is null) then raise exception 'sales_report_invalid_cursor'; end if;
  select coalesce(jsonb_agg(x order by (x->>'event_date') desc, x->>'order_id'), '[]'::jsonb) into v from (
    select jsonb_build_object('order_id', r.order_id, 'event_date', r.event_date, 'order_number', r.order_number,
      'headcount', r.headcount, 'subtotal_cents', e.subtotal_cents, 'status', r.status) x
    from public.ezcater_reconciliation_status r join public.ezcater_orders e on e.id = r.order_id
    where r.location_id = p_location_id and r.event_date between p_from and p_to
      and (p_after_date is null or r.event_date < p_after_date or (r.event_date = p_after_date and r.order_id > p_after_id))
    order by r.event_date desc, r.order_id
    limit p_limit) q;
  return v;
end $$;

-- ezCater totals + reconciliation statuses by event date, and the Toast "Ezcater" rings with no
-- ezCater link (0229 orphans) by Toast business date. Orphans stay counted as Toast sales (nothing
-- links them to an ezCater order); the catering slice names them so a double count is visible.
create function public.sales_report_ezcater_summary(p_location_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.sales_report_assert_window(p_location_id, p_from, p_to);
  select jsonb_build_object(
    'orders', (select count(*) from public.ezcater_reconciliation_status r
                where r.location_id = p_location_id and r.event_date between p_from and p_to),
    'subtotal_cents', (select coalesce(sum(e.subtotal_cents), 0) from public.ezcater_reconciliation_status r
                        join public.ezcater_orders e on e.id = r.order_id
                       where r.location_id = p_location_id and r.event_date between p_from and p_to),
    'amount_missing', (select count(*) from public.ezcater_reconciliation_status r
                        join public.ezcater_orders e on e.id = r.order_id
                       where r.location_id = p_location_id and r.event_date between p_from and p_to and e.subtotal_cents is null),
    'statuses', coalesce((select jsonb_object_agg(status, n) from (select r.status, count(*) n
                  from public.ezcater_reconciliation_status r
                 where r.location_id = p_location_id and r.event_date between p_from and p_to group by r.status) s), '{}'::jsonb),
    'orphan_checks', (select count(*) from public.ezcater_toast_orphans o
                       where o.location_id = p_location_id and o.business_date between p_from and p_to),
    'orphan_cents', (select coalesce(sum(o.amount_cents), 0) from public.ezcater_toast_orphans o
                      where o.location_id = p_location_id and o.business_date between p_from and p_to)
  ) into v;
  return v;
end $$;

-- Catering pipeline value by EVENT date for one shop + window (Astra P2-6: never the whole history).
-- The 0195 valuation (live accepted quote, else estimated revenue) with one change: a lead with
-- neither is COUNTED as unvalued instead of being valued at $0. Completed = earned; confirmed/out = to earn.
create function public.sales_report_catering_values(p_location_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.sales_report_assert_window(p_location_id, p_from, p_to);
  with leads as (
    select p.stage, coalesce(q.total_cents, p.estimated_revenue_cents)::bigint as value_cents
      from public.catering_pipeline p
      left join lateral (
        select qq.total_cents from public.catering_quotes qq
         where qq.pipeline_id = p.id and qq.superseded_at is null and qq.status = 'accepted'
         order by qq.version desc limit 1) q on true
     where p.location_id = p_location_id and p.event_date between p_from and p_to
       and p.stage in ('confirmed', 'out', 'completed'))
  select jsonb_build_object(
    'completed_events', count(*) filter (where stage = 'completed'),
    'completed_value_cents', coalesce(sum(value_cents) filter (where stage = 'completed'), 0),
    'completed_unvalued', count(*) filter (where stage = 'completed' and value_cents is null),
    'confirmed_events', count(*) filter (where stage in ('confirmed', 'out')),
    'confirmed_value_cents', coalesce(sum(value_cents) filter (where stage in ('confirmed', 'out')), 0),
    'confirmed_unvalued', count(*) filter (where stage in ('confirmed', 'out') and value_cents is null)
  ) into v from leads;
  return v;
end $$;

revoke all on function public.sales_report_class(boolean, boolean, boolean, text, boolean),
  public.sales_report_discount_counts(jsonb, text, text),
  public.sales_report_facts(uuid, date, date),
  public.sales_report_assert_window(uuid, date, date),
  public.sales_report_daily(uuid, date, date),
  public.sales_report_breakdown(uuid, date, date, text),
  public.sales_report_check_page(uuid, date, date, date, text, integer, text, text, text, text, integer, integer),
  public.sales_report_check_detail(uuid, date, text),
  public.sales_report_ezcater_page(uuid, date, date, date, uuid, integer),
  public.sales_report_ezcater_summary(uuid, date, date),
  public.sales_report_catering_values(uuid, date, date)
  from public, anon, authenticated, service_role;
grant execute on function public.sales_report_daily(uuid, date, date),
  public.sales_report_breakdown(uuid, date, date, text),
  public.sales_report_check_page(uuid, date, date, date, text, integer, text, text, text, text, integer, integer),
  public.sales_report_check_detail(uuid, date, text),
  public.sales_report_ezcater_page(uuid, date, date, date, uuid, integer),
  public.sales_report_ezcater_summary(uuid, date, date),
  public.sales_report_catering_values(uuid, date, date)
  to service_role;

do $$ begin
  if exists (select 1 from information_schema.routine_privileges where routine_schema = 'public'
      and routine_name like 'sales\_report\_%' and grantee in ('PUBLIC', 'anon', 'authenticated')) then
    raise exception '0232 unexpected RPC grant';
  end if;
  if exists (select 1 from information_schema.routine_privileges where routine_schema = 'public'
      and routine_name in ('sales_report_class', 'sales_report_discount_counts', 'sales_report_facts', 'sales_report_assert_window')
      and grantee = 'service_role') then
    raise exception '0232 unexpected helper grant';
  end if;
end $$;
commit;
