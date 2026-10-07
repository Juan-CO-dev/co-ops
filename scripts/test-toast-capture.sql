-- SIM ONLY, after 0221. Run in a throwaway/sim database as migration owner:
-- psql "$SIM_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/test-toast-capture.sql
-- No production connection. All fixtures are synthetic and rolled back.
begin;
do $$
declare
 loc uuid; other_loc uuid; run_a uuid:=gen_random_uuid(); run_b uuid:=gen_random_uuid();
 run_failed uuid:=gen_random_uuid(); run_stale uuid:=gen_random_uuid();
 day date:='2026-07-23'; payload jsonb; changed jsonb; total integer;
 order_id text:='capture-test-' || gen_random_uuid()::text;
begin
 select id into loc from public.locations order by id limit 1;
 select id into other_loc from public.locations where id<>loc order by id limit 1;
 assert loc is not null and other_loc is not null,'sim requires two location fixtures';
 payload:=jsonb_build_array(jsonb_build_object(
  'content_hash',repeat('a',64),
  'order',jsonb_build_object('order_guid',order_id,'business_date',day,'modified_at','2026-07-24T12:00:00Z','deleted',false,'voided',false,'excess_food',false),
  'checks',jsonb_build_array(jsonb_build_object('check_guid','check','amount_cents',1000,'tax_cents',100,'total_cents',1100,'voided',false)),
  'discounts','[]'::jsonb,'service_charges','[]'::jsonb,
  'payments',jsonb_build_array(jsonb_build_object('check_guid','check','payment_guid','payment','amount_cents',1100,'tip_cents',100,'paid_business_date',day,'refund_amount_cents',300,'refund_tip_cents',20,'refund_business_date','2026-07-25'))
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
 assert total=1,'same-page retry duplicated order';
 assert (select pages=1 and orders=1 from public.toast_capture_runs where id=run_a),'retry inflated manifest';
 assert not exists(select 1 from public.toast_orders_latest where order_guid=order_id),'running capture leaked';
 changed:=jsonb_set(payload,'{0,content_hash}',to_jsonb(repeat('b',64)));
 begin
  perform public.toast_capture_page(run_a,loc,day,1,changed);
  raise exception 'changed retry unexpectedly accepted';
 exception when raise_exception then
  if sqlerrm<>'toast_capture_page_changed' then raise; end if;
 end;
 perform public.toast_capture_finish(run_a,loc,day,1);
 perform public.toast_capture_finish(run_a,loc,day,1);
 assert exists(select 1 from public.toast_orders_latest where order_guid=order_id),'completed capture absent';
 assert exists(select 1 from public.toast_payments p join public.toast_orders o on o.id=p.snapshot_id where o.order_guid=order_id and p.refund_business_date='2026-07-25' and p.refund_tip_cents=20),'refund date or tip lost';
 insert into public.toast_capture_runs(id,location_id,business_date) values(run_b,loc,day);
 perform public.toast_capture_page(run_b,loc,day,1,payload);
 perform public.toast_capture_finish(run_b,loc,day,1);
 select count(*) into total from public.toast_orders where order_guid=order_id;
 assert total=1,'same-content new run duplicated snapshot';
 insert into public.toast_capture_runs(id,location_id,business_date) values(run_failed,loc,day);
 changed:=jsonb_set(changed,'{0,order,modified_at}','"2026-07-25T12:00:00Z"');
 perform public.toast_capture_page(run_failed,loc,day,1,changed);
 update public.toast_capture_runs set status='failed',finished_at=now(),error_code='synthetic_test' where id=run_failed;
 assert (select content_hash=repeat('a',64) from public.toast_orders_latest where order_guid=order_id),'failed newer snapshot leaked';
 insert into public.toast_capture_runs(id,location_id,business_date) values(run_stale,loc,day);
 changed:=jsonb_set(changed,'{0,content_hash}',to_jsonb(repeat('c',64)));
 changed:=jsonb_set(changed,'{0,order,modified_at}','"2026-07-23T12:00:00Z"');
 perform public.toast_capture_page(run_stale,loc,day,1,changed);
 perform public.toast_capture_finish(run_stale,loc,day,1);
 assert (select content_hash=repeat('a',64) from public.toast_orders_latest where order_guid=order_id),'later pull replaced newer source version';
 assert not has_function_privilege('authenticated','public.toast_capture_page(uuid,uuid,date,integer,jsonb)','execute'),'authenticated can capture';
 assert not has_table_privilege('authenticated','public.toast_orders','select'),'authenticated can read';
 assert not has_table_privilege('service_role','public.toast_orders','update'),'service can rewrite snapshots';
 assert not has_table_privilege('service_role','public.toast_orders','delete'),'service can delete snapshots';
 raise notice 'Toast capture SQL assertions passed; fixtures will roll back';
end $$;
rollback;
