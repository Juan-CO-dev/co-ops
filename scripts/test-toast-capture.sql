-- SIM ONLY, after 0221 + revised 0222. Run in a throwaway/sim database as migration owner:
-- Submit this entire file as ONE Management API query (or psql with ON_ERROR_STOP).
-- No psql metacommands. Every check raises even when plpgsql.check_asserts is off.
-- Success rolls back explicitly; any exception aborts the transaction and rolls back.
-- No production connection. All fixtures are synthetic and rolled back.
begin;
do $$
declare
 loc uuid; other_loc uuid; fixture_item uuid; fixture_sku uuid; run_a uuid:=gen_random_uuid(); run_b uuid:=gen_random_uuid();
 run_failed uuid:=gen_random_uuid(); run_stale uuid:=gen_random_uuid();
 run_tie uuid:=gen_random_uuid(); run_null uuid:=gen_random_uuid();
 day date:='2026-07-23'; payload jsonb; changed jsonb; published jsonb; total integer;
 order_id text:='capture-test-' || gen_random_uuid()::text;
begin
 if not exists(select 1 from public.users where email='maya@sim.co-ops') then raise exception 'SIM ONLY'; end if;
 select id into loc from public.locations order by id limit 1;
 select id into other_loc from public.locations where id<>loc order by id limit 1;
 if (loc is not null and other_loc is not null) is not true then raise exception 'sim requires two location fixtures'; end if;
 select id into fixture_item from public.items order by id limit 1;
 select id into fixture_sku from public.vendor_items order by id limit 1;
 if (fixture_item is not null and fixture_sku is not null) is not true then raise exception 'sim requires item and sku fixtures'; end if;
 payload:=jsonb_build_array(jsonb_build_object(
  'content_hash',repeat('a',64),
  'order',jsonb_build_object('order_guid',order_id,'business_date',day,'modified_at','2026-07-24T12:00:00Z','deleted',false,'voided',false,'excess_food',false,'third_party_provider_name','DoorDash','selection_units',jsonb_build_array(jsonb_build_object('item_guid','synthetic-item','quantity',2))),
  'checks',jsonb_build_array(jsonb_build_object('check_guid','check','amount_cents',1000,'tax_cents',100,'total_cents',1100,'voided',false,'deleted',true)),
  'discounts','[]'::jsonb,'service_charges','[]'::jsonb,
  'payments',jsonb_build_array(jsonb_build_object('check_guid','check','payment_guid','payment','payment_status','CAPTURED','refund_status','PARTIAL','amount_cents',1100,'tip_cents',100,'paid_business_date',day,'refund_amount_cents',300,'refund_tip_cents',20,'refund_business_date','2026-07-25','void_business_date','2026-07-26'))
 ));
 insert into public.toast_capture_runs(id,location_id,business_date) values(run_a,loc,day);
 begin
  perform public.toast_capture_page(run_a,other_loc,day,1,payload);
  raise exception 'location spoof unexpectedly accepted';
 exception when raise_exception then
  if sqlerrm<>'toast_capture_run_not_running' then raise; end if;
 end;
 perform public.toast_capture_page(run_a,loc,day,1,payload);
 perform public.toast_capture_page(run_a,loc,day,1,payload);
 select count(*) into total from public.toast_orders where order_guid=order_id;
 if (total=1) is not true then raise exception 'same-page retry duplicated order'; end if;
 if ((select pages=1 and orders=1 from public.toast_capture_runs where id=run_a)) is not true then raise exception 'retry inflated manifest'; end if;
 if (not exists(select 1 from public.toast_orders_latest where order_guid=order_id)) is not true then raise exception 'running capture leaked'; end if;
 changed:=jsonb_set(payload,'{0,content_hash}',to_jsonb(repeat('b',64)));
 begin
  perform public.toast_capture_page(run_a,loc,day,1,changed);
  raise exception 'changed retry unexpectedly accepted';
 exception when raise_exception then
  if sqlerrm<>'toast_capture_page_changed' then raise; end if;
 end;
 perform public.toast_capture_finish(run_a,loc,day,1);
 perform public.toast_capture_finish(run_a,loc,day,1);
 if (exists(select 1 from public.toast_orders_latest where order_guid=order_id)) is not true then raise exception 'completed capture absent'; end if;
 if (not exists(select 1 from public.toast_orders_latest where order_guid=order_id and third_party_provider_name='DoorDash' and selection_units->0->>'item_guid'='synthetic-item')) then raise exception 'provider or quantity snapshot lost'; end if;
 if (exists(select 1 from public.toast_payments p join public.toast_orders o on o.id=p.snapshot_id where o.order_guid=order_id and p.refund_business_date='2026-07-25' and p.refund_tip_cents=20)) is not true then raise exception 'refund date or tip lost'; end if;
 if (exists(select 1 from public.toast_order_checks c join public.toast_orders o on o.id=c.snapshot_id where o.order_guid=order_id and c.deleted)) is not true then raise exception 'check deletion lost'; end if;
 if (exists(select 1 from public.toast_payments p join public.toast_orders o on o.id=p.snapshot_id where o.order_guid=order_id and p.payment_status='CAPTURED' and p.refund_status='PARTIAL' and p.void_business_date='2026-07-26')) is not true then raise exception 'payment statuses or void date lost'; end if;
 insert into public.toast_capture_runs(id,location_id,business_date) values(run_b,loc,day);
 perform public.toast_capture_page(run_b,loc,day,1,payload);
 perform public.toast_capture_finish(run_b,loc,day,1);
 select count(*) into total from public.toast_orders where order_guid=order_id;
 if (total=1) is not true then raise exception 'same-content new run duplicated snapshot'; end if;
 insert into public.toast_capture_runs(id,location_id,business_date) values(run_failed,loc,day);
 changed:=jsonb_set(changed,'{0,order,modified_at}','"2026-07-25T12:00:00Z"');
 perform public.toast_capture_page(run_failed,loc,day,1,changed);
 update public.toast_capture_runs set status='failed',finished_at=now(),error_code='synthetic_test' where id=run_failed;
 if ((select content_hash=repeat('a',64) from public.toast_orders_latest where order_guid=order_id)) is not true then raise exception 'failed newer snapshot leaked'; end if;
 insert into public.toast_capture_runs(id,location_id,business_date) values(run_stale,loc,day);
 changed:=jsonb_set(changed,'{0,content_hash}',to_jsonb(repeat('c',64)));
 changed:=jsonb_set(changed,'{0,order,modified_at}','"2026-07-23T12:00:00Z"');
 perform public.toast_capture_page(run_stale,loc,day,1,changed);
 perform public.toast_capture_finish(run_stale,loc,day,1);
 if ((select content_hash=repeat('a',64) from public.toast_orders_latest where order_guid=order_id)) is not true then raise exception 'later pull replaced newer source version'; end if;
 -- A later run with an equal source timestamp wins; NULL never beats a dated source.
 insert into public.toast_capture_runs(id,location_id,business_date,started_at) values(run_tie,loc,day,clock_timestamp()+interval '1 minute');
 changed:=jsonb_set(payload,'{0,content_hash}',to_jsonb(repeat('d',64)));
 perform public.toast_capture_page(run_tie,loc,day,1,changed);
 perform public.toast_capture_finish(run_tie,loc,day,1);
 if ((select content_hash=repeat('d',64) from public.toast_orders_latest where order_guid=order_id)) is not true then raise exception 'equal source timestamp did not use run start'; end if;
 insert into public.toast_capture_runs(id,location_id,business_date,started_at) values(run_null,loc,day,clock_timestamp()+interval '2 minutes');
 changed:=jsonb_set(changed,'{0,content_hash}',to_jsonb(repeat('e',64)));
 changed:=jsonb_set(changed,'{0,order,modified_at}','null'::jsonb);
 perform public.toast_capture_page(run_null,loc,day,1,changed);
 perform public.toast_capture_finish(run_null,loc,day,1);
 if ((select content_hash=repeat('d',64) from public.toast_orders_latest where order_guid=order_id)) is not true then raise exception 'null source timestamp replaced dated source'; end if;
 if ((select count(*)=1 from public.toast_order_latest_pointers where location_id=loc and order_guid=order_id)) is not true then raise exception 'latest pointer is not unique'; end if;
 -- Compare the new pointer with the former publication query for this synthetic order.
 if ((select p.snapshot_id = (select o.id from public.toast_orders o join public.toast_capture_run_orders ro on ro.snapshot_id=o.id join public.toast_capture_runs r on r.id=ro.run_id where o.order_guid=order_id and r.status='completed' order by o.modified_at desc nulls last,r.started_at desc,r.id desc limit 1) from public.toast_order_latest_pointers p where p.location_id=loc and p.order_guid=order_id)) is not true then raise exception 'latest pointer differs from historical ordering'; end if;
 if (not exists(select 1 from public.sales_channel_map where reviewed_at is null and (channel<>'Unknown' or provider is not null or fulfillment is not null))) is not true then raise exception 'unreviewed proposal exposed as effective channel'; end if;
 if (not has_table_privilege('service_role','public.toast_order_latest_pointers','update')) is not true then raise exception 'service can rewrite latest pointers'; end if;
 if (not has_function_privilege('authenticated','public.toast_capture_page(uuid,uuid,date,integer,jsonb)','execute')) is not true then raise exception 'authenticated can capture'; end if;
 if (not has_table_privilege('authenticated','public.toast_orders','select')) is not true then raise exception 'authenticated can read'; end if;
 if (not has_table_privilege('service_role','public.toast_orders','update')) is not true then raise exception 'service can rewrite snapshots'; end if;
 if (not has_table_privilege('service_role','public.toast_orders','delete')) is not true then raise exception 'service can delete snapshots'; end if;
 insert into public.toast_capture_reconciliations(location_id,business_date,run_id,status,old_units,new_units)
 values(loc,day,run_a,'match',0,0);
 if (not has_table_privilege('service_role','public.toast_capture_reconciliations','insert')
 or has_table_privilege('service_role','public.toast_capture_reconciliations','update')
 or has_table_privilege('service_role','public.toast_capture_reconciliations','delete')
 or has_table_privilege('authenticated','public.toast_capture_reconciliations','select')) then raise exception 'reconciliation grants wrong'; end if;
 begin
  insert into public.toast_capture_reconciliations(location_id,business_date,run_id,status)
  values(other_loc,day,run_b,'skipped');
  raise exception 'reconciliation location spoof accepted';
 exception when foreign_key_violation then null;
 end;
 begin
  insert into public.toast_capture_reconciliations(location_id,business_date,run_id,status,mismatched_items)
  values(loc,day,run_b,'skipped',(select jsonb_agg(n) from generate_series(1,51) n));
  raise exception 'reconciliation cap not enforced';
 exception when check_violation then null;
 end;
 if ((select count(*) from public.sales_channel_map where reviewed_at='2026-10-07T00:00:00Z')<>18) then raise exception 'reviewed labels missing'; end if;
 if (not exists(select 1 from public.sales_channel_map where dining_option_label='Delivery' and channel='third_party' and provider is null and fulfillment='delivery')) then raise exception 'Delivery ruling missing'; end if;
 published:=public.replace_toast_depletion_day(loc,day,run_null,
   jsonb_build_array(jsonb_build_object('sku_id',fixture_sku,'direct_oz',3.25,'flattened_oz',7.5)),
   jsonb_build_array(jsonb_build_object('item_id',fixture_item,'item_path',jsonb_build_array(fixture_item),'sku_id',fixture_sku,'sales_oz',7.5)),
   1,'sql-fixture',0,2,4.5,8.5,
   '{"unmapped_units":2,"excluded_units":3,"poisoned_recipes":[],"mapping_fingerprint":"synthetic","deletion_by_absence_count":1}'::jsonb,
   'degraded','unmapped_units');
 if published <> '{"aggregate_count":1,"attribution_count":1,"coverage_count":1}'::jsonb then raise exception 'replacement counts wrong'; end if;
 if not exists(select 1 from public.toast_depletion_day_coverage where location_id=loc and business_date=day
   and suspect_check_count=2 and suspect_qty=4.5 and counted_qty=8.5 and status='degraded' and reason='unmapped_units'
   and diagnostics->>'mapping_fingerprint'='synthetic' and diagnostics->>'deletion_by_absence_count'='1'
   and diagnostics->>'unmapped_units'='2' and diagnostics->>'excluded_units'='3'
   and diagnostics->'poisoned_recipes'='[]'::jsonb and diagnostics->>'attribution_mismatch_sku_count'='0')
 then raise exception 'pars signals or diagnostics lost'; end if;
 if (not exists(select 1 from public.toast_capture_daily_depletion where location_id=loc and business_date=day
   and sku_id=fixture_sku and direct_oz=3.25 and flattened_oz=7.5)) then raise exception 'nonzero depletion aggregate missing'; end if;
 if (not exists(select 1 from public.toast_depletion_item_attribution where location_id=loc and business_date=day
   and item_id=fixture_item and item_path=array[fixture_item] and sku_id=fixture_sku and sales_oz=7.5)) then raise exception 'nonzero depletion attribution missing'; end if;
 begin
  perform public.replace_toast_depletion_day(loc,day,run_null,
    jsonb_build_array(jsonb_build_object('sku_id',fixture_sku,'direct_oz',-1,'flattened_oz',0)),
    '[]'::jsonb,1,'sql-fixture-invalid',0,0,0,0);
  raise exception 'invalid depletion payload accepted';
 exception when check_violation then null;
 end;
 if (not exists(select 1 from public.toast_capture_daily_depletion where location_id=loc and business_date=day
   and sku_id=fixture_sku and direct_oz=3.25)) then raise exception 'invalid replacement did not roll back atomically'; end if;
 -- Missing attribution is a warning, not an atomic replacement failure.
 perform public.replace_toast_depletion_day(loc,day,run_null,
   jsonb_build_array(jsonb_build_object('sku_id',fixture_sku,'direct_oz',0,'flattened_oz',7.5)),
   '[]'::jsonb,1,'sql-fixture-warning',0,0,0,0);
 if not exists(select 1 from public.toast_depletion_day_coverage where location_id=loc and business_date=day
   and diagnostics->>'attribution_mismatch_sku_count'='1') then raise exception 'attribution mismatch not diagnosed'; end if;
 begin
  perform public.replace_toast_depletion_day(loc,day,run_null,'[]'::jsonb,'[]'::jsonb,1,'bad-status',0,0,0,0,'{}','degraded',null);
  raise exception 'degraded without reason accepted';
 exception when raise_exception then
  if sqlerrm<>'toast_depletion_invalid' then raise; end if;
 end;
 published:=public.replace_toast_depletion_day(loc,day,run_null,'[]'::jsonb,'[]'::jsonb,1,'sql-fixture-zero',0,0,0,0);
 if published <> '{"aggregate_count":0,"attribution_count":0,"coverage_count":1}'::jsonb then raise exception 'empty replacement counts wrong'; end if;
 if (not exists(select 1 from public.toast_depletion_day_coverage where location_id=loc and business_date=day
   and run_id=run_null and status='success' and reason is null and suspect_check_count=0 and suspect_qty=0 and counted_qty=0
   and diagnostics='{"attribution_mismatch_sku_count":0}'::jsonb and aggregate_count=0 and attribution_count=0)) then
   raise exception 'page/finish to atomic empty depletion coverage failed';
 end if;
 if exists(select 1 from public.toast_capture_daily_depletion where location_id=loc and business_date=day) then raise exception 'zero replacement left aggregates'; end if;
 if exists(select 1 from public.toast_depletion_item_attribution where location_id=loc and business_date=day) then raise exception 'zero replacement left attributions'; end if;
 if has_table_privilege('service_role','public.toast_capture_daily_depletion','INSERT,UPDATE,DELETE')
 or has_table_privilege('service_role','public.toast_depletion_item_attribution','INSERT,UPDATE,DELETE')
 or has_table_privilege('service_role','public.toast_depletion_day_coverage','INSERT,UPDATE,DELETE')
 or has_table_privilege('authenticated','public.toast_depletion_day_coverage','SELECT')
 or has_function_privilege('authenticated','public.replace_toast_depletion_day(uuid,date,uuid,jsonb,jsonb,integer,text,integer,integer,numeric,numeric,jsonb,text,text)','EXECUTE')
 or has_function_privilege('anon','public.replace_toast_depletion_day(uuid,date,uuid,jsonb,jsonb,integer,text,integer,integer,numeric,numeric,jsonb,text,text)','EXECUTE')
 then raise exception 'depletion RPC boundary grants wrong'; end if;
 raise notice 'Toast capture SQL assertions passed; fixtures will roll back';
end $$;
rollback;
