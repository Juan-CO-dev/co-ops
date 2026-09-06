-- Migration 0195_catering_insights_money_split
-- AUTHORED 2026-09-05. NOT YET APPLIED — GATE (JUAN). Lineage at 0194.
--
-- 0195: money confirmed vs money completed (Juan 2026-09-05, after smoking #330: "we need money
-- confirmed and money completed, etc."). `catering_insights_window` gains four keys — the booked
-- money split by whether the event has actually been delivered yet:
--   confirmed_value_cents / confirmed_events : stage IN ('confirmed','out') — money still to earn
--   completed_value_cents / completed_events : stage = 'completed'          — money earned
-- `booked_value_cents` / `booked_events` are UNCHANGED and remain the sum of the two (booked =
-- confirmed ∪ out ∪ completed), so the existing "all booked" number keeps its meaning. Value per
-- lead is unchanged too: the live accepted quote total else `estimated_revenue_cents`.
--
-- This is a CREATE OR REPLACE of 0194's body, verbatim except for the two new CTEs and the four
-- keys. `catering_insights_v2` is untouched — it calls this function, so it inherits the split.
--
-- The revoke is RE-STATED for the replaced function (0189 lesson: the staff JWT is a valid
-- PostgREST bearer and Supabase's default ACLs grant EXECUTE to anon AND authenticated, so a
-- function left executable is callable past the lib's level-5 floor with a cookie and curl).

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
  -- The money split (0195). `upcoming` keeps `out` on the not-yet-earned side: the food has left
  -- the building but the event is not closed until it is `completed` (the nightly rollover does
  -- that once its date has passed), so counting it as earned would book revenue a day early.
  upcoming  as (select * from happening where stage in ('confirmed','out')),
  delivered as (select * from happening where stage = 'completed'),
  settled   as (select * from created where stage in ('confirmed','out','completed','lost'))
  select jsonb_build_object(
    'leads_new',   (select count(*)::int from created),
    'by_source',   coalesce((select jsonb_object_agg(coalesce(lead_source, 'other'), c)
                             from (select lead_source, count(*)::int c from created group by lead_source) s), '{}'::jsonb),
    'by_stage',    coalesce((select jsonb_object_agg(stage, c)
                             from (select stage, count(*)::int c from happening group by stage) s), '{}'::jsonb),
    'booked_events',      (select count(*)::int from booked),
    'booked_value_cents', (select coalesce(sum(value_cents), 0)::bigint from booked),
    'confirmed_events',      (select count(*)::int from upcoming),
    'confirmed_value_cents', (select coalesce(sum(value_cents), 0)::bigint from upcoming),
    'completed_events',      (select count(*)::int from delivered),
    'completed_value_cents', (select coalesce(sum(value_cents), 0)::bigint from delivered),
    'lost',               (select count(*)::int from created where stage = 'lost'),
    'win_rate_bps',       (select case when count(*) = 0 then null
                                       else round(10000.0 * count(*) filter (where stage <> 'lost') / count(*))::int end
                             from settled),
    'avg_headcount',      (select round(avg(headcount))::int from booked),
    'pipeline_open_value_cents', (select coalesce(sum(value_cents), 0)::bigint from leads where stage in ('inquiry','quote_sent'))
  );
$$;

revoke execute on function public.catering_insights_window(uuid[], date, date) from anon, public, authenticated;
