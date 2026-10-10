-- SIM ONLY, migration owner, after 0242. psql -X -v ON_ERROR_STOP=1 -f scripts/test-pulse-sales.sql
-- Uses the established sim sentinel; synthetic fixtures roll back, including on connection close.
\set ON_ERROR_STOP on
\timing on
begin;
set local statement_timeout = '8s';
set local lock_timeout = '1s';

-- Compare precisely the fields Pulse consumes, not 0239 accounting/tips/ezCater metadata.
create function pg_temp.assert_pulse_sales(loc uuid, day date) returns void language plpgsql as $$
declare p jsonb; r jsonb; b jsonb; x jsonb; y jsonb;
begin
  p := public.pulse_sales_today(loc, day, day);
  r := public.sales_report_daily(loc, day, day);
  select coalesce(jsonb_agg(v - array['gross_cents','discounts_comps_cents','voids_cents',
    'service_charges_cents','accounting_missing'] order by v->>'sale_class'), '[]') into x
    from jsonb_array_elements(r->'classes') v;
  if p->'classes' is distinct from x then raise exception 'class parity: % vs %', p, r; end if;
  if p->'discounts' is distinct from r->'discounts' or p->'captured_days' is distinct from r->'captured_days'
    then raise exception 'discount/coverage parity: % vs %', p, r; end if;
  select jsonb_build_array(coalesce(sum((v->>'count')::bigint),0), coalesce(sum((v->>'refund_cents')::bigint),0))
    into x from jsonb_array_elements(p->'refunds') v;
  select jsonb_build_array(coalesce(sum((v->>'count')::bigint),0), coalesce(sum((v->>'refund_cents')::bigint),0))
    into y from jsonb_array_elements(r->'refunds') v;
  if x is distinct from y then raise exception 'refund parity: % vs %', p, r; end if;
  b := public.pulse_sales_baseline(loc, day-27, day);
  select coalesce(jsonb_agg(v order by v->>'key'), '[]') into x from jsonb_array_elements(b->'hours') v;
  select coalesce(jsonb_agg(v order by v->>'key'), '[]') into y
    from jsonb_array_elements(public.sales_report_breakdown(loc, day-27, day, 'hour_weekday')) v;
  if x is distinct from y then raise exception 'hour baseline parity'; end if;
  select coalesce(jsonb_agg(v order by v), '[]') into x from jsonb_array_elements(b->'captured_days') v;
  select coalesce(jsonb_agg(v order by v), '[]') into y
    from jsonb_array_elements(public.sales_report_daily(loc, day-27, day)->'captured_days') v;
  if x is distinct from y then raise exception 'baseline coverage parity'; end if;
end $$;

do $$
declare
  loc uuid; other_loc uuid; run uuid; payload jsonb; entry jsonb; p jsonb;
  day date := '2002-02-01'; old_day date := '2001-12-01'; kind text;
  prefix text := 'pulse-' || gen_random_uuid()::text;
  gift text := 'pulse-gift-' || gen_random_uuid()::text; fn regprocedure; role_name text;
begin
  if not exists(select 1 from public.users where email='maya@sim.co-ops') then raise exception 'SIM ONLY'; end if;
  select id into strict loc from public.locations order by id limit 1;
  select id into strict other_loc from public.locations where id<>loc order by id limit 1;
  if exists(select 1 from public.toast_order_latest_pointers where location_id in (loc,other_loc)
    and business_date between old_day-28 and day+28)
    or exists(select 1 from public.toast_capture_runs where location_id in (loc,other_loc)
    and business_date between old_day-28 and day+28) then raise exception 'requires empty fixture dates'; end if;
  insert into public.toast_dining_options(location_id,guid,name) values(loc,gift,gift);
  insert into public.sales_channel_map(dining_option_label,channel,provider,reviewed_at)
    values(gift,'third_party','gift_card',now());

  -- Sale/void/deleted/excess/gift/unknown amounts, check and selection discounts, dated-null
  -- refund amounts, undated refunds, and a refund whose original sale is outside the window.
  foreach kind in array array['sale','void','deleted','excess','gift','unknown','old'] loop
    run := gen_random_uuid();
    entry := jsonb_build_object('content_hash',md5(prefix||kind)||md5(prefix||kind),
      'order',jsonb_build_object('order_guid',prefix||kind,'business_date',case when kind='old' then old_day else day end,
        'opened_at',day::text||'T16:00:00Z','modified_at',day::text||'T17:00:00Z',
        'deleted',kind='deleted','voided',kind='void','excess_food',kind='excess',
        'dining_option_guid',case when kind='gift' then gift else null end,
        'selection_units',jsonb_build_array(jsonb_build_object('check_guid','check','selection_guid','void-selection','voided',true))),
      'checks',jsonb_build_array(jsonb_build_object('check_guid','check','amount_cents',case when kind='unknown' then null else 1000 end,
        'tax_cents',100,'total_cents',1100,'voided',false,'deleted',false)),
      'discounts',jsonb_build_array(jsonb_build_object('check_guid','check','ordinal',1,'name','check discount','amount_cents',100),
        jsonb_build_object('check_guid','check','ordinal',2,'name','void selection discount','selection_guid','void-selection','amount_cents',999)),
      'service_charges','[]'::jsonb,
      'payments',jsonb_build_array(jsonb_build_object('check_guid','check','payment_guid','dated','refund_business_date',day,
        'refund_amount_cents',case when kind='unknown' then null else 150 end,'refund_tip_cents',0),
        jsonb_build_object('check_guid','check','payment_guid','undated','refund_status','FULL','refund_amount_cents',999)));
    payload := jsonb_build_array(entry);
    insert into public.toast_capture_runs(id,location_id,business_date) values(run,loc,case when kind='old' then old_day else day end);
    perform public.toast_capture_page(run,loc,case when kind='old' then old_day else day end,1,payload);
    perform public.toast_capture_finish(run,loc,case when kind='old' then old_day else day end,1);
  end loop;
  perform pg_temp.assert_pulse_sales(loc,day);
  perform pg_temp.assert_pulse_sales(loc,old_day);
  perform pg_temp.assert_pulse_sales(other_loc,day);
  perform pg_temp.assert_pulse_sales(loc,day+1);
  p := public.pulse_sales_today(loc,day,day);
  if p->'refunds'->0->>'count' is distinct from '3' or p->'refunds'->0->>'refund_cents' is distinct from '300'
    then raise exception 'dated/old/null refund inclusion failed: %', p; end if;
  if p->'discounts'->0->>'count' is distinct from '2' then raise exception 'void selection discount counted: %',p; end if;
  if (p->>'captured_at')::timestamptz is distinct from
    (select max(finished_at) from public.toast_capture_runs where location_id=loc and business_date=day and status='completed')
    then raise exception 'capture timestamp mismatch'; end if;

  -- Re-publish the old order without refunds: obsolete payment snapshots must disappear.
  run := gen_random_uuid();
  payload := jsonb_set(payload,'{0,content_hash}',to_jsonb(repeat('f',64)));
  payload := jsonb_set(payload,'{0,payments}','[]'::jsonb);
  payload := jsonb_set(payload,'{0,order,modified_at}',to_jsonb(day::text||'T18:00:00Z'));
  insert into public.toast_capture_runs(id,location_id,business_date) values(run,loc,old_day);
  perform public.toast_capture_page(run,loc,old_day,1,payload);
  perform public.toast_capture_finish(run,loc,old_day,1);
  perform pg_temp.assert_pulse_sales(loc,day);
  if public.pulse_sales_today(loc,day,day)->'refunds'->0->>'count' is distinct from '2'
    then raise exception 'obsolete snapshot refund counted'; end if;

  foreach fn in array array['public.pulse_sales_today(uuid,date,date)'::regprocedure,
    'public.pulse_sales_baseline(uuid,date,date)'::regprocedure] loop
    foreach role_name in array array['anon','authenticated'] loop
      if has_function_privilege(role_name,fn,'EXECUTE') then raise exception '% may execute %',role_name,fn; end if;
    end loop;
    if not has_function_privilege('service_role',fn,'EXECUTE') then raise exception 'missing service grant'; end if;
    if not exists(select 1 from pg_proc where oid=fn and prosecdef and provolatile='s'
      and 'search_path=pg_catalog, public'=any(proconfig)) then raise exception 'function security contract'; end if;
  end loop;
  begin
    perform public.pulse_sales_today(loc,day-1,day);
    raise exception 'accepted multi-day today';
  exception when raise_exception then if sqlerrm <> 'pulse_today_requires_one_day' then raise; end if; end;
  begin
    perform public.pulse_sales_baseline(loc,day-28,day);
    raise exception 'accepted 29-day baseline';
  exception when raise_exception then if sqlerrm <> 'pulse_baseline_window_too_wide' then raise; end if; end;

  -- Both RPC ROW OUTPUTS for exactly the same shop/day, alongside the report for CC.
  raise notice 'shop=% day=% pulse_sales_today=%',loc,day,public.pulse_sales_today(loc,day,day);
  raise notice 'shop=% day=% pulse_sales_baseline=%',loc,day,public.pulse_sales_baseline(loc,day,day);
  raise notice 'shop=% day=% sales_report_daily=%',loc,day,public.sales_report_daily(loc,day,day);
  raise notice 'PASS: Pulse consumed-field parity, 28-day baseline, empty shop/day, refund history/latest snapshot, grants and guards';
end $$;
rollback;
