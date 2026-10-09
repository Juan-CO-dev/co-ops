-- SIM ONLY, migration owner, after 0239 (and its existing 0237 dependency).
-- Execute this entire file with ON_ERROR_STOP. No production connection.
-- Synthetic fixtures and cursor initialization roll back. No existing snapshots are rewritten.
-- Timing below checks an actual 31-day read; CC must also run it on representative sim volume.
begin;
set local statement_timeout='8s';
set local lock_timeout='1s';
do $$
declare
 loc uuid; other_loc uuid; old_run uuid:=gen_random_uuid(); new_run uuid:=gen_random_uuid();
 other_run uuid:=gen_random_uuid(); exclusions_run uuid:=gen_random_uuid(); old_snapshot uuid;
 unknown_run uuid:=gen_random_uuid(); ez_order uuid:=gen_random_uuid(); ez_snapshot uuid:=gen_random_uuid();
 undated_run uuid:=gen_random_uuid(); repaired_run uuid:=gen_random_uuid(); undated_payload jsonb:='[]'::jsonb;
 day date:='2001-01-01'; refund_day date:='2001-02-01';
 order_id text:='true-net-'||gen_random_uuid()::text; payload jsonb; changed jsonb; reordered jsonb;
 corrected jsonb; excluded jsonb; entry jsonb; report jsonb; sale jsonb; refund jsonb;
 started timestamptz; elapsed interval; fn regprocedure; role_name text; table_name text;
 kind text; gift_guid text:=gen_random_uuid()::text; gift_label text:='true-net-gift-'||gen_random_uuid()::text;
begin
 if not exists(select 1 from public.users where email='maya@sim.co-ops') then raise exception 'SIM ONLY'; end if;
 select id into strict loc from public.locations order by id limit 1;
 select id into other_loc from public.locations where id<>loc order by id limit 1;
 if other_loc is null then raise exception 'sim requires two location fixtures'; end if;
 if exists(select 1 from public.toast_order_latest_pointers where location_id in (loc,other_loc)
   and business_date between day and refund_day+30) then raise exception 'requires empty fixture date window'; end if;
 -- Existing modified cursors are accepted; begin never advances a watermark.
 perform public.toast_modified_begin(loc);
 payload:=jsonb_build_array(jsonb_build_object('content_hash',repeat('a',64),
  'order',jsonb_build_object('order_guid',order_id,'business_date',day,'modified_at','2001-01-02T12:00:00Z',
    'deleted',false,'voided',false,'excess_food',false,'selection_units','[]'::jsonb),
  'checks',jsonb_build_array(jsonb_build_object('check_guid','check','amount_cents',1000,'tax_cents',100,
    'total_cents',1100,'voided',false,'deleted',false)),
  'discounts','[]'::jsonb,'service_charges','[]'::jsonb,
  'payments',jsonb_build_array(jsonb_build_object('check_guid','check','payment_guid','payment',
    'payment_status','CAPTURED','amount_cents',1100,'tip_cents',100,'refund_amount_cents',330,
    'refund_tip_cents',20,'refund_business_date',refund_day,'paid_business_date',day),
    jsonb_build_object('check_guid','check','payment_guid','payment-2','payment_status','CAPTURED','amount_cents',0))));
 insert into public.toast_capture_runs(id,location_id,business_date) values(old_run,loc,day);
 begin
  perform public.toast_capture_page(old_run,other_loc,day,1,payload);
  raise exception 'cross-location capture accepted';
 exception when raise_exception then if sqlerrm<>'toast_capture_run_not_running' then raise; end if; end;
 perform public.toast_capture_page(old_run,loc,day,1,payload);
 perform public.toast_capture_page(old_run,loc,day,1,payload);
 if (select pages=1 and orders=1 from public.toast_capture_runs where id=old_run) is not true then
  raise exception 'capture retry changed membership'; end if;
 if exists(select 1 from public.toast_order_latest_pointers where location_id=loc and order_guid=order_id) then
  raise exception 'running capture published'; end if;
 perform public.toast_capture_finish(old_run,loc,day,1);
 select snapshot_id into strict old_snapshot from public.toast_order_latest_pointers where location_id=loc and order_guid=order_id;
 report:=public.sales_report_daily(loc,day,day);
 select x into sale from jsonb_array_elements(report->'classes') x where x->>'sale_class'='sale';
 if sale->>'accounting_missing' is distinct from '1' or sale->>'gross_cents' is not null then
  raise exception 'historical accounting did not stay unknown'; end if;
 report:=public.sales_report_daily(loc,refund_day,refund_day);
 if report->'refunds'->0->>'sales_refund_missing' is distinct from '1'
   or report->'refunds'->0->>'sales_refund_cents' is not null then raise exception 'historical refund did not stay unknown'; end if;

 -- LIVE 0237 rowtype contract: missing new nullable column equals explicit NULL.
 changed:=jsonb_set(payload,'{0,content_hash}',to_jsonb(repeat('b',64)));
 changed:=jsonb_set(changed,'{0,payments,0,sales_refund_cents}','null'::jsonb);
 changed:=jsonb_set(changed,'{0,payments,1,sales_refund_cents}','null'::jsonb);
 if public.toast_modified_save(loc,changed)<>0 then raise exception 'missing versus explicit null duplicated capture'; end if;
 -- NULL -> amount enriches the payment rowtype, even when old payment fields did not change.
 changed:=jsonb_set(changed,'{0,payments,0,sales_refund_cents}','300');
 changed:=jsonb_set(changed,'{0,payments,1,sales_refund_cents}','0');
 changed:=jsonb_set(changed,'{0,checks,0,accounting}',
   '{"version":1,"gross_cents":1200,"discounts_comps_cents":200,"voids_cents":100,"service_charges_cents":100,"pre_refund_cents":900}'::jsonb);
 if public.toast_modified_save(loc,changed)<>1 then raise exception 'null-to-amount enrichment not captured'; end if;
 if public.toast_modified_save(loc,changed)<>0 then raise exception 'enrichment retry duplicated capture'; end if;
 reordered:=jsonb_set(changed,'{0,payments}',jsonb_build_array(changed->0->'payments'->1,changed->0->'payments'->0));
 reordered:=jsonb_set(reordered,'{0,content_hash}',to_jsonb(repeat('c',64)));
 if public.toast_modified_save(loc,reordered)<>0 then raise exception 'payment reorder duplicated capture'; end if;
 if (select count(*) from public.toast_orders where location_id=loc and order_guid=order_id)<>2 then
  raise exception 'dedup created extra snapshots'; end if;
 if not exists(select 1 from public.toast_order_checks where snapshot_id=old_snapshot and accounting is null)
  or not exists(select 1 from public.toast_payments where snapshot_id=old_snapshot and payment_guid='payment' and sales_refund_cents is null)
 then raise exception 'historical snapshot rewritten'; end if;
 -- Check-only correction remains invisible to the PAYMENT-only modified lane.
 corrected:=jsonb_set(changed,'{0,content_hash}',to_jsonb(repeat('d',64)));
 corrected:=jsonb_set(corrected,'{0,checks,0,accounting,gross_cents}','1300');
 corrected:=jsonb_set(corrected,'{0,checks,0,accounting,voids_cents}','200');
 if public.toast_modified_save(loc,corrected)<>0 then raise exception 'check-only correction changed modified lane'; end if;
 report:=public.sales_report_daily(loc,day,day);
 if report->'classes'->0->>'gross_cents' is distinct from '1200' then raise exception 'check-only correction leaked'; end if;
 insert into public.toast_capture_runs(id,location_id,business_date,started_at)
 values(new_run,loc,day,clock_timestamp()+interval '1 second');
 perform public.toast_capture_page(new_run,loc,day,1,corrected);
 perform public.toast_capture_finish(new_run,loc,day,1);
 report:=public.sales_report_daily(loc,day,day);
 select x into sale from jsonb_array_elements(report->'classes') x where x->>'sale_class'='sale';
 if sale->>'checks' is distinct from '1' or sale->>'gross_cents' is distinct from '1300'
  or sale->>'discounts_comps_cents' is distinct from '200' or sale->>'voids_cents' is distinct from '200'
  or sale->>'service_charges_cents' is distinct from '100' or sale->>'accounting_missing' is distinct from '0'
 then raise exception 'full-day recapture did not publish exact accounting'; end if;
 if jsonb_array_length(report->'refunds')<>0 then raise exception 'refund dated to original sale'; end if;
 report:=public.sales_report_daily(loc,refund_day,refund_day);
 refund:=report->'refunds'->0;
 if refund->>'sales_refund_cents' is distinct from '300' or refund->>'refund_cents' is distinct from '330'
  or refund->>'refund_tip_cents' is distinct from '20' or refund->>'sales_refund_missing' is distinct from '0'
  or jsonb_array_length(report->'classes')<>0 then raise exception 'refund date or tax/tip separation incorrect'; end if;

 -- The other shop's identical GUID must not contribute to this shop's money.
 insert into public.toast_capture_runs(id,location_id,business_date) values(other_run,other_loc,day);
 perform public.toast_capture_page(other_run,other_loc,day,1,payload);
 perform public.toast_capture_finish(other_run,other_loc,day,1);
 report:=public.sales_report_daily(other_loc,day,day);
 if report->'classes'->0->>'accounting_missing' is distinct from '1' then raise exception 'shop isolation failed'; end if;

 -- Refund and sale exclusions use the same existing classifier; deleted rows are absent entirely.
 insert into public.sales_channel_map(dining_option_label,channel,provider,reviewed_at)
 values(gift_label,'online','gift_card',clock_timestamp());
 insert into public.toast_dining_options(location_id,guid,name) values(loc,gift_guid,gift_label);
 excluded:='[]'::jsonb;
 foreach kind in array array['void','excess_food','gift_card','deleted_order','deleted_check','void_check','ezcater_linked'] loop
  entry:=jsonb_set(corrected->0,'{order,order_guid}',to_jsonb(order_id||'-'||kind));
  if kind='void' then entry:=jsonb_set(entry,'{order,voided}','true'); end if;
  if kind='excess_food' then entry:=jsonb_set(entry,'{order,excess_food}','true'); end if;
  if kind='gift_card' then entry:=jsonb_set(entry,'{order,dining_option_guid}',to_jsonb(gift_guid)); end if;
  if kind='deleted_order' then entry:=jsonb_set(entry,'{order,deleted}','true'); end if;
  if kind='deleted_check' then entry:=jsonb_set(entry,'{checks,0,deleted}','true'); end if;
  if kind='void_check' then entry:=jsonb_set(entry,'{checks,0,voided}','true'); end if;
  excluded:=excluded||jsonb_build_array(entry);
 end loop;
 insert into public.toast_capture_runs(id,location_id,business_date) values(exclusions_run,loc,day);
 perform public.toast_capture_page(exclusions_run,loc,day,1,excluded);
 perform public.toast_capture_finish(exclusions_run,loc,day,1);
 insert into public.ezcater_orders(id,provider_uuid,caterer_uuid,location_id,snapshot_id,snapshot_digest,event_date,subtotal_cents)
 values(ez_order,order_id||'-ez','synthetic-caterer',loc,ez_snapshot,'synthetic-digest',day,900);
 insert into public.ezcater_order_snapshots(id,order_id) values(ez_snapshot,ez_order);
 insert into public.ezcater_toast_links(order_id,snapshot_id,location_id,toast_snapshot_id,order_guid,check_guid,selection_guid,business_date,evidence)
 select ez_order,ez_snapshot,loc,p.snapshot_id,p.order_guid,'check','synthetic-selection',day,'daily_batch'
 from public.toast_order_latest_pointers p where p.location_id=loc and p.order_guid=order_id||'-ezcater_linked';
 if not exists(select 1 from public.ezcater_current_toast_links l where l.order_id=ez_order) then raise exception 'ezCater fixture not linked'; end if;
 report:=public.sales_report_daily(loc,day,day);
 select x into sale from jsonb_array_elements(report->'classes') x where x->>'sale_class'='sale';
 if sale->>'checks' is distinct from '1' or sale->>'gross_cents' is distinct from '1300'
  or (select sum((x->>'checks')::integer) from jsonb_array_elements(report->'classes') x)<>6
 then raise exception 'sale exclusions failed'; end if;
 report:=public.sales_report_daily(loc,refund_day,refund_day);
 if report->'refunds'->0->>'sales_refund_cents' is distinct from '300' then raise exception 'refund exclusions failed'; end if;
 if public.sales_report_class(false,false,false,null,true)<>'ezcater_linked' then raise exception 'ezCater classifier changed'; end if;

 -- A dated refund with an absent amount must poison exactness, never disappear as zero.
 entry:=jsonb_set(corrected,'{0,order,order_guid}',to_jsonb(order_id||'-unknown-refund'));
 entry:=jsonb_set(entry,'{0,order,business_date}',to_jsonb(day+1));
 entry:=jsonb_set(entry,'{0,payments,0,refund_business_date}',to_jsonb(refund_day+1));
 entry:=jsonb_set(entry,'{0,payments,0,refund_amount_cents}','null'::jsonb);
 entry:=jsonb_set(entry,'{0,payments,0,sales_refund_cents}','null'::jsonb);
 insert into public.toast_capture_runs(id,location_id,business_date) values(unknown_run,loc,day+1);
 perform public.toast_capture_page(unknown_run,loc,day+1,1,entry);
 perform public.toast_capture_finish(unknown_run,loc,day+1,1);
 report:=public.sales_report_daily(loc,refund_day+1,refund_day+1);
 if report->'refunds'->0->>'sales_refund_missing' is distinct from '1'
  or report->'refunds'->0->>'sales_refund_cents' is not null then raise exception 'dated missing refund silently dropped'; end if;

 -- BC-008/034: missing refund dates never disappear, even for a sale before the report window.
 -- Three unknowns plus three negative controls: ordinary old/new payments and proven zero sales.
 foreach kind in array array['amount','empty','legacy_status','legacy_none','new_none','zero_sales'] loop
  entry:=jsonb_set(corrected->0,'{order,order_guid}',to_jsonb(order_id||'-undated-'||kind));
  entry:=jsonb_set(entry,'{order,business_date}',to_jsonb(day+2));
  entry:=jsonb_set(entry,'{payments,0,refund_business_date}','null'::jsonb);
  entry:=jsonb_set(entry,'{payments,0,refund_amount_cents}','null'::jsonb);
  entry:=jsonb_set(entry,'{payments,0,refund_tip_cents}','null'::jsonb);
  entry:=jsonb_set(entry,'{payments,0,sales_refund_cents}','null'::jsonb);
  if kind='amount' then entry:=jsonb_set(entry,'{payments,0,refund_amount_cents}','500'); end if;
  if kind in ('legacy_status','legacy_none') then
   entry:=jsonb_set(entry,'{checks,0,accounting}','null'::jsonb);
   entry:=jsonb_set(entry,'{payments,1,sales_refund_cents}','null'::jsonb);
  end if;
  if kind='legacy_status' then entry:=jsonb_set(entry,'{payments,0,refund_status}','"FULL"'::jsonb); end if;
  if kind in ('new_none','zero_sales') then entry:=jsonb_set(entry,'{payments,0,sales_refund_cents}','0'); end if;
  if kind='zero_sales' then entry:=jsonb_set(entry,'{payments,0,refund_amount_cents}','500'); end if;
  undated_payload:=undated_payload||jsonb_build_array(entry);
 end loop;
 insert into public.toast_capture_runs(id,location_id,business_date) values(undated_run,loc,day+2);
 perform public.toast_capture_page(undated_run,loc,day+2,1,undated_payload);
 perform public.toast_capture_finish(undated_run,loc,day+2,1);
 report:=public.sales_report_daily(loc,day+1,day+3);
 if jsonb_array_length(report->'refunds')<>2
   or exists(select 1 from jsonb_array_elements(report->'refunds') x
      where (x->>'business_date')::date<day+2 or x->>'sales_refund_missing' is distinct from '3'
        or x->>'sales_refund_cents' is not null or x->>'count' is distinct from '0'
        or x->>'refund_cents' is distinct from '0' or x->>'refund_tip_cents' is distinct from '0')
 then raise exception 'undated refund did not poison possible days without inventing money'; end if;
 report:=public.sales_report_daily(loc,refund_day+2,refund_day+3);
 if jsonb_array_length(report->'refunds')<>2
   or exists(select 1 from jsonb_array_elements(report->'refunds') x
      where x->>'sales_refund_missing' is distinct from '3' or x->>'sales_refund_cents' is not null)
 then raise exception 'undated older-sale refund silently dropped'; end if;
 report:=public.sales_report_daily(other_loc,refund_day+2,refund_day+3);
 if jsonb_array_length(report->'refunds')<>0 then raise exception 'undated refund crossed shops'; end if;
 -- A newer capture with valid dates removes uncertainty; stale snapshots cannot poison forever.
 for i in 0..2 loop
  undated_payload:=jsonb_set(undated_payload,array[i::text,'content_hash'],to_jsonb(repeat('e',64)));
  undated_payload:=jsonb_set(undated_payload,array[i::text,'payments','0','refund_business_date'],to_jsonb(refund_day+2));
  undated_payload:=jsonb_set(undated_payload,array[i::text,'payments','0','refund_amount_cents'],'500');
  undated_payload:=jsonb_set(undated_payload,array[i::text,'payments','0','sales_refund_cents'],'500');
 end loop;
 insert into public.toast_capture_runs(id,location_id,business_date,started_at)
 values(repaired_run,loc,day+2,clock_timestamp()+interval '1 second');
 perform public.toast_capture_page(repaired_run,loc,day+2,1,undated_payload);
 perform public.toast_capture_finish(repaired_run,loc,day+2,1);
 report:=public.sales_report_daily(loc,refund_day+3,refund_day+3);
 if jsonb_array_length(report->'refunds')<>0 then raise exception 'stale undated snapshot poisoned exactness'; end if;
 report:=public.sales_report_daily(loc,refund_day+2,refund_day+2);
 if report->'refunds'->0->>'sales_refund_cents' is distinct from '1500'
   or report->'refunds'->0->>'sales_refund_missing' is distinct from '0'
 then raise exception 'repaired refund date did not restore exact allocation'; end if;

 foreach fn in array array['public.toast_capture_page(uuid,uuid,date,integer,jsonb)'::regprocedure,
   'public.sales_report_daily(uuid,date,date)'::regprocedure] loop
  if has_function_privilege('anon',fn,'EXECUTE') or has_function_privilege('authenticated',fn,'EXECUTE')
    or not has_function_privilege('service_role',fn,'EXECUTE')
    or exists(select 1 from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=fn and a.grantee=0)
  then raise exception 'unsafe RPC grants'; end if;
 end loop;
 foreach table_name in array array['public.toast_order_checks','public.toast_payments'] loop
  foreach role_name in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(role_name,table_name,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    or has_any_column_privilege(role_name,table_name,'INSERT,UPDATE,REFERENCES')
    or (role_name<>'service_role' and has_any_column_privilege(role_name,table_name,'SELECT'))
   then raise exception 'unsafe snapshot grants'; end if;
  end loop;
  if not (select relrowsecurity from pg_class where oid=table_name::regclass) then raise exception 'snapshot RLS disabled'; end if;
 end loop;
 begin
  perform public.sales_report_daily(loc,day,day+31);
  raise exception '32-day window accepted';
 exception when raise_exception then if sqlerrm<>'sales_report_window_too_wide' then raise; end if; end;
 started:=clock_timestamp();
 perform public.sales_report_daily(loc,refund_day,refund_day+30);
 elapsed:=clock_timestamp()-started;
 if elapsed>=interval '8 seconds' then raise exception '31-day read exceeded 8-second gate: %',elapsed; end if;
 raise notice 'PASS: immutable old/new snapshots, live 0237 nullable rowtype dedup, full-day correction, shop isolation, refund dates, exclusions, grants; 31-day elapsed=%',elapsed;
end $$;
rollback;
