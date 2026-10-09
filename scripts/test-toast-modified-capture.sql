-- SIM ONLY, migration owner, after 0237. No production connection.
-- Execute entire file as one transaction (psql ON_ERROR_STOP or sim SQL tool).
-- Fixtures and cursor changes roll back. Run representative EXPLAIN/latency separately.
begin;
set local statement_timeout='5s';
set local lock_timeout='1s';
do $$
declare loc uuid; c jsonb; retry jsonb; next_c jsonb; payload jsonb; newer jsonb;
 original uuid:=gen_random_uuid(); unrelated uuid; claim uuid:=gen_random_uuid(); stale uuid:=gen_random_uuid(); reordered jsonb;
 order_id text:='modified-test-'||gen_random_uuid()::text; day date:='2001-01-01'; n integer;
begin
 if not exists(select 1 from public.users where email='maya@sim.co-ops') then raise exception 'SIM ONLY'; end if;
 select id into strict loc from public.locations order by id limit 1;
 -- Refuse an already-initialized shop so bootstrap assertions cannot silently skip.
 if exists(select 1 from public.toast_modified_cursors where location_id=loc) then
  raise exception 'requires pristine modified cursor on sim shop';
 end if;
 c:=public.toast_modified_begin(loc);
 retry:=public.toast_modified_begin(loc);
 if c is distinct from retry then raise exception 'retry changed fixed window'; end if;
 if abs(extract(epoch from ((c->>'coverage_start')::timestamptz-(clock_timestamp()-interval '24 hours'))))>5
  or (c->>'pending_end')::timestamptz-(c->>'pending_start')::timestamptz<>interval '1 hour'
  or c->>'watermark' is not null then raise exception 'bootstrap window incorrect'; end if;
 if public.toast_modified_complete(loc,(c->>'pending_start')::timestamptz,(c->>'pending_end')::timestamptz+interval '1 second') then
  raise exception 'wrong end advanced cursor'; end if;
 if not public.toast_modified_complete(loc,(c->>'pending_start')::timestamptz,(c->>'pending_end')::timestamptz) then
  raise exception 'CAS did not complete'; end if;
 if public.toast_modified_complete(loc,(c->>'pending_start')::timestamptz,(c->>'pending_end')::timestamptz) then
  raise exception 'stale CAS advanced'; end if;
 next_c:=public.toast_modified_begin(loc);
 if (next_c->>'pending_start')::timestamptz<>(c->>'pending_end')::timestamptz-interval '1 minute' then
  raise exception 'overlap incorrect'; end if;
 payload:=jsonb_build_array(jsonb_build_object('content_hash',repeat('a',64),
  'order',jsonb_build_object('order_guid',order_id,'business_date',day,'modified_at','2001-01-01T12:00:00Z',
    'deleted',false,'voided',false,'excess_food',false,'selection_units','[]'::jsonb),
  'checks',jsonb_build_array(jsonb_build_object('check_guid','check','amount_cents',1000,'tax_cents',100,'total_cents',1100,'voided',false,'deleted',false)),
  'discounts','[]'::jsonb,'service_charges','[]'::jsonb,
  'payments',jsonb_build_array(jsonb_build_object('check_guid','check','payment_guid','payment','payment_status','CAPTURED',
    'amount_cents',1100,'refund_amount_cents',0,'paid_business_date',day))));
 payload:=jsonb_set(payload,'{0,payments}',(payload->0->'payments')||jsonb_build_array(jsonb_build_object(
  'check_guid','check','payment_guid','payment-2','payment_status','CAPTURED','amount_cents',0)));
 insert into public.toast_capture_runs(id,location_id,business_date) values(original,loc,day);
 perform public.toast_capture_page(original,loc,day,1,payload);
 perform public.toast_capture_finish(original,loc,day,1);
 -- Other order on same day remains pointed at the original full-day snapshot.
 newer:=jsonb_set(payload,'{0,order,order_guid}',to_jsonb(order_id||'-other'));
 if public.toast_modified_save(loc,newer)<>1 then raise exception 'missing order not inserted'; end if;
 select snapshot_id into unrelated from public.toast_order_latest_pointers where location_id=loc and order_guid=order_id||'-other';
 newer:=jsonb_set(payload,'{0,content_hash}',to_jsonb(repeat('b',64)));
 newer:=jsonb_set(newer,'{0,order,modified_at}',to_jsonb(clock_timestamp()));
 newer:=jsonb_set(newer,'{0,payments,0,refund_amount_cents}','300');
 newer:=jsonb_set(newer,'{0,payments,0,refund_business_date}',to_jsonb(current_date));
 if public.toast_modified_save(loc,newer)<>1 then raise exception 'late refund not captured'; end if;
 if public.toast_modified_save(loc,newer)<>0 then raise exception 'retry duplicated capture'; end if;
 reordered:=jsonb_set(newer,'{0,payments}',jsonb_build_array(newer->0->'payments'->1,newer->0->'payments'->0));
 reordered:=jsonb_set(reordered,'{0,content_hash}',to_jsonb(repeat('c',64)));
 if public.toast_modified_save(loc,reordered)<>0 then raise exception 'payment reordering duplicated capture'; end if;
 if public.toast_modified_save(loc,payload)<>0 then raise exception 'older payment state accepted'; end if;
 -- A concurrent full-day capture with older source data cannot revert the refund pointer.
 insert into public.toast_capture_runs(id,location_id,business_date) values(stale,loc,day);
 perform public.toast_capture_page(stale,loc,day,1,payload);
 perform public.toast_capture_finish(stale,loc,day,1);
 if not exists(select 1 from public.toast_order_latest_pointers p join public.toast_payments pm on pm.snapshot_id=p.snapshot_id
  where p.location_id=loc and p.order_guid=order_id and p.business_date=day
   and pm.refund_business_date=current_date and pm.refund_amount_cents=300) then raise exception 'refund latest pointer absent'; end if;
 if (select snapshot_id from public.toast_order_latest_pointers where location_id=loc and order_guid=order_id||'-other')
   is distinct from unrelated then raise exception 'unrelated order altered'; end if;
 select count(*) into n from public.toast_capture_runs where location_id=loc and business_date=day and status='completed';
 if n<>2 then raise exception 'discovery inflated full-day coverage'; end if;
 -- Remove only the synthetic full-day debounce effect by aging its completion in this rollback harness.
 update public.toast_capture_runs set finished_at=clock_timestamp()-interval '10 minutes' where id in (original,stale);
 if not public.toast_capture_claim(claim,loc,day) then raise exception 'discovery blocked daily capture'; end if;
 begin
  perform public.toast_modified_save(loc,(select jsonb_agg(newer->0) from generate_series(1,21)));
  raise exception 'oversize accepted';
 exception when raise_exception then if sqlerrm<>'toast_modified_invalid_batch' then raise; end if; end;
 begin
  perform public.toast_modified_save(loc,newer||newer);
  raise exception 'duplicate accepted';
 exception when raise_exception then if sqlerrm<>'toast_modified_duplicate_order' then raise; end if; end;
 if (select watermark from public.toast_modified_cursors where location_id=loc) is distinct from (c->>'pending_end')::timestamptz then
  raise exception 'saving or failure advanced cursor'; end if;
 if has_table_privilege('service_role','public.toast_modified_cursors','UPDATE,DELETE')
  or has_function_privilege('authenticated','public.toast_modified_save(uuid,jsonb)','EXECUTE') then raise exception 'unsafe grants'; end if;
 -- Near current time: cap by safety lag, and return no pending window if already caught up.
 update public.toast_modified_cursors set watermark=clock_timestamp()-interval '3 minutes',pending_start=null,pending_end=null where location_id=loc;
 c:=public.toast_modified_begin(loc);
 if abs(extract(epoch from ((c->>'pending_end')::timestamptz-(clock_timestamp()-interval '2 minutes'))))>1 then
  raise exception 'safety lag incorrect'; end if;
 raise notice 'PASS: bootstrap, retry, CAS, overlap, lag, old refund, idempotence, stale source, isolation, limits, grants';
end $$;
rollback;
