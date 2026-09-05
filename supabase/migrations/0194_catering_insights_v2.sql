-- Migration 0194_catering_insights_v2
-- AUTHORED 2026-09-05. APPLY WITH 0193 (Juan's go on the catering-truth spec).
--
-- 0194: insights v2. The 0121 function counted every lead all-time, counted `lost` test rows
-- as pipeline, and read revenue from catering_orders (never written) + accepted quotes (none) —
-- it showed $0 against ≈$2,800 of confirmed Toast/ezCater catering. v2: four windows (Juan
-- 2026-09-05: this week · this month · last 30 · all time), MONEY BY EVENT DATE, LEAD FLOW BY
-- CREATED DATE (ET), one value per lead = its live accepted quote total else its
-- estimated_revenue_cents (the Toast/ezCater actual), a calendar of booked events −30…+90 days.
-- SECURITY DEFINER + REVOKE from anon, PUBLIC AND authenticated (0189 lesson: the staff JWT is
-- a valid PostgREST bearer; the lib enforces the level-5 floor).

create or replace function public.catering_insights_window(p_location_ids uuid[], p_from date, p_to date)
returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  with leads as (
    select p.id, p.stage, p.lead_source, p.headcount, p.event_date,
           (p.created_at at time zone 'America/New_York')::date as created_et,
           coalesce(q.total_cents, p.estimated_revenue_cents, 0)::bigint as value_cents
      from public.catering_pipeline p
      left join lateral (
        select total_cents from public.catering_quotes q
         where q.pipeline_id = p.id and q.superseded_at is null and q.status = 'accepted'
         order by q.version desc limit 1) q on true
     where (p_location_ids is null or p.location_id = any (p_location_ids))
  ),
  created   as (select * from leads where p_from is null or created_et between p_from and p_to),
  happening as (select * from leads where event_date is not null and (p_from is null or event_date between p_from and p_to)),
  booked    as (select * from happening where stage in ('confirmed','out','completed')),
  settled   as (select * from created where stage in ('confirmed','out','completed','lost'))
  select jsonb_build_object(
    'leads_new',   (select count(*)::int from created),
    'by_source',   coalesce((select jsonb_object_agg(coalesce(lead_source, 'unknown'), c)
                             from (select lead_source, count(*)::int c from created group by lead_source) s), '{}'::jsonb),
    'by_stage',    coalesce((select jsonb_object_agg(stage, c)
                             from (select stage, count(*)::int c from happening group by stage) s), '{}'::jsonb),
    'booked_events',      (select count(*)::int from booked),
    'booked_value_cents', (select coalesce(sum(value_cents), 0)::bigint from booked),
    'lost',               (select count(*)::int from created where stage = 'lost'),
    'win_rate_bps',       (select case when count(*) = 0 then null
                                       else round(10000.0 * count(*) filter (where stage <> 'lost') / count(*))::int end
                             from settled),
    'avg_headcount',      (select round(avg(headcount))::int from booked where headcount is not null),
    'pipeline_open_value_cents', (select coalesce(sum(value_cents), 0)::bigint from leads where stage in ('inquiry','quote_sent'))
  );
$$;

create or replace function public.catering_insights_v2(p_location_ids uuid[], p_today date)
returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object(
    'this_week',  public.catering_insights_window(p_location_ids, date_trunc('week', p_today::timestamp)::date, date_trunc('week', p_today::timestamp)::date + 6),
    'this_month', public.catering_insights_window(p_location_ids, date_trunc('month', p_today::timestamp)::date, (date_trunc('month', p_today::timestamp) + interval '1 month - 1 day')::date),
    'last_30',    public.catering_insights_window(p_location_ids, p_today - 29, p_today),
    'all_time',   public.catering_insights_window(p_location_ids, null, null),
    'calendar', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'event_date', e.event_date, 'time_window', e.time_window,
               'name', coalesce(e.event_name, e.company, e.contact_name), 'headcount', e.headcount,
               'source', e.lead_source, 'stage', e.stage, 'location_id', e.location_id, 'value_cents', e.value_cents)
             order by e.event_date, e.time_window)
        from (
          select p.*, coalesce((select total_cents from public.catering_quotes q
                                 where q.pipeline_id = p.id and q.superseded_at is null and q.status = 'accepted'
                                 order by q.version desc limit 1), p.estimated_revenue_cents, 0)::bigint as value_cents
            from public.catering_pipeline p
           where p.stage in ('confirmed','out','completed')
             and p.event_date between p_today - 30 and p_today + 90
             and (p_location_ids is null or p.location_id = any (p_location_ids))) e), '[]'::jsonb),
    'feedback', jsonb_build_object(
      'average_rating', (select round(avg(rating)::numeric, 2) from public.customer_feedback
                          where catering_order_id is not null and rating is not null
                            and (p_location_ids is null or location_id = any (p_location_ids))),
      'count', (select count(*)::int from public.customer_feedback
                 where catering_order_id is not null and (p_location_ids is null or location_id = any (p_location_ids))))
  );
$$;

revoke execute on function public.catering_insights_window(uuid[], date, date) from anon, public, authenticated;
revoke execute on function public.catering_insights_v2(uuid[], date)           from anon, public, authenticated;

drop function if exists public.catering_insights(uuid[]);
