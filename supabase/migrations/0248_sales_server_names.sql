-- Migration 0248_sales_server_names
-- AUTHORED 2026-10-11, NOT YET APPLIED -- GATE CC: sim first, then prod.
-- APPLIED TO PROD 2026-10-11 (schema_migrations version 20261012034246, name '0248_sales_server_names'); sim applied first.
-- Read-only labels and bounded export page capacity. The three RPC bodies descend
-- from 0232; 0239/0247 daily accounting and the facts/classifier stay untouched.
-- Names: windowed Toast first name, then active shop link -> users.name FIRST token.
-- Per-GUID server identities remain unchanged; online requires explicit channel evidence.
-- Item labels use newest business date, ties max name. No money/count/filter changes.
begin;

create or replace function public.sales_report_breakdown(p_location_id uuid, p_from date, p_to date, p_dimension text)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.sales_report_assert_window(p_location_id, p_from, p_to);
  if p_dimension is null or p_dimension not in ('item', 'modifier', 'channel', 'hour_weekday', 'discount', 'server') then
    raise exception 'sales_report_invalid_dimension';
  end if;
  if p_dimension in ('item', 'modifier') then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v from (
      select jsonb_build_object('key', s->>'item_guid', 'label', (array_agg(s->>'name' order by f.business_date desc, s->>'name' desc nulls last))[1],
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
      select jsonb_build_object('key', coalesce(f.server_guid, ''), 'label', max(coalesce(n.employee_first_name, substring(u.name from '\S+'))),
        'server_online', max(coalesce(n.employee_first_name, substring(u.name from '\S+'))) is null and bool_and(f.channel in ('online', 'app', 'third_party', 'delivery')),
        'checks', count(*), 'cents', coalesce(sum(f.amount_cents), 0),
        'amount_missing', count(*) filter (where f.amount_cents is null)) x
      from public.sales_report_facts(p_location_id, p_from, p_to) f
      left join names n on n.employee_guid = f.server_guid
      left join public.toast_employee_links l on l.location_id = p_location_id and l.employee_guid = f.server_guid and l.active
      left join public.users u on u.id = l.user_id
      where f.sale_class = 'sale'
      group by coalesce(f.server_guid, '')) q;
  end if;
  return v;
end $$;

-- Sale checks, newest business date first, check GUID ascending; keyset after (date, check).
-- Filters are a closed allowlist; every one is a bound parameter, never SQL text.
create or replace function public.sales_report_check_page(p_location_id uuid, p_from date, p_to date,
  p_after_date date, p_after_check text, p_limit integer,
  p_channel text, p_provider text, p_server text, p_discount text, p_dow integer, p_hour integer)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb;
begin
  perform public.sales_report_assert_window(p_location_id, p_from, p_to);
  if p_limit is null or p_limit < 1 or p_limit > 1000 then raise exception 'sales_report_invalid_limit'; end if;
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
      'server_guid', f.server_guid, 'server_name', coalesce(n.employee_first_name, substring(u.name from '\S+')),
      'server_online', coalesce(n.employee_first_name, substring(u.name from '\S+')) is null and f.channel in ('online', 'app', 'third_party', 'delivery'),
      'amount_cents', f.amount_cents, 'tax_cents', f.tax_cents,
      'discount_cents', (select sum(dc.amount_cents) from public.toast_check_discounts dc
                          where dc.snapshot_id = f.snapshot_id and dc.check_guid = f.check_guid
                            and public.sales_report_discount_counts(f.selection_units, f.check_guid, dc.selection_guid)),
      'units', (select coalesce(sum((s->>'quantity')::numeric), 0) from jsonb_array_elements(f.selection_units) s
                 where s->>'check_guid' = f.check_guid and s->>'parent_selection_guid' is null
                   and not coalesce((s->>'voided')::boolean, false) and not coalesce((s->>'deleted')::boolean, false)))
    order by f.business_date desc, f.check_guid), '[]'::jsonb) into v
  from page f left join names n on n.employee_guid = f.server_guid
      left join public.toast_employee_links l on l.location_id = p_location_id and l.employee_guid = f.server_guid and l.active
      left join public.users u on u.id = l.user_id;
  return v;
end $$;

-- One check's evidence, windowed by its business date first. No card data, contact or note exists
-- in these tables to select; payment TYPE only. Selections are the check's own capture units.
create or replace function public.sales_report_check_detail(p_location_id uuid, p_business_date date, p_check_guid text)
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
    'server_name', coalesce((select t.employee_first_name from public.toast_time_entries t
                     where t.location_id = p_location_id and t.business_date between p_business_date - 1 and p_business_date + 1
                       and t.employee_guid = f.server_guid and t.employee_first_name is not null and not t.deleted
                     order by t.in_at desc limit 1), (select substring(u.name from '\S+') from public.toast_employee_links l join public.users u on u.id = l.user_id
                     where l.location_id = p_location_id and l.employee_guid = f.server_guid and l.active)),
    'server_online', coalesce((select t.employee_first_name from public.toast_time_entries t
                     where t.location_id = p_location_id and t.business_date between p_business_date - 1 and p_business_date + 1
                       and t.employee_guid = f.server_guid and t.employee_first_name is not null and not t.deleted
                     order by t.in_at desc limit 1), (select substring(u.name from '\S+') from public.toast_employee_links l join public.users u on u.id = l.user_id
                     where l.location_id = p_location_id and l.employee_guid = f.server_guid and l.active)) is null and f.channel in ('online', 'app', 'third_party', 'delivery'),
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

revoke all on function public.sales_report_breakdown(uuid, date, date, text),
  public.sales_report_check_page(uuid, date, date, date, text, integer, text, text, text, text, integer, integer),
  public.sales_report_check_detail(uuid, date, text) from public, anon, authenticated, service_role;
grant execute on function public.sales_report_breakdown(uuid, date, date, text),
  public.sales_report_check_page(uuid, date, date, date, text, integer, text, text, text, text, integer, integer),
  public.sales_report_check_detail(uuid, date, text) to service_role;
commit;
