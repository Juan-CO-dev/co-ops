-- SIM ONLY, privileged SQL session, after 0229. Every fixture/change rolls back.
-- Do not run on production. Assertions fail the transaction; ROLLBACK remains mandatory.
begin;
create temporary table ezrec_fixture(name text primary key,id uuid);
create function pg_temp.ezrec_order(p_name text,p_date date,p_subtotal bigint) returns uuid language plpgsql as $$
declare o uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); l uuid;
begin
 select id into l from public.locations order by id limit 1;
 if l is null then raise exception 'Harness needs one sim location'; end if;
 insert into public.ezcater_orders(id,provider_uuid,caterer_uuid,location_id,snapshot_id,snapshot_digest,order_number,event_date,status,subtotal_cents)
 values(o,'harness-'||o,'harness',l,s,'harness-'||s,p_name,p_date,'accepted',p_subtotal);
 insert into public.ezcater_order_snapshots(id,order_id) values(s,o);
 insert into ezrec_fixture values(p_name,o);
 return o;
end $$;
create function pg_temp.ezrec_toast(p_code text,p_date date,p_amount bigint,p_batch boolean default false) returns uuid language plpgsql as $$
declare s uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); l uuid; g text:=gen_random_uuid()::text; ch text:=gen_random_uuid()::text;
begin
 select id into l from public.locations order by id limit 1;
 insert into public.toast_capture_runs(id,location_id,business_date,status,finished_at) values(r,l,p_date,'completed',now());
 insert into public.toast_orders(id,location_id,order_guid,business_date,content_hash,deleted,voided,excess_food,dining_option_guid,selection_units)
 values(s,l,g,p_date,repeat('a',64),false,false,false,case when p_batch then 'ezrec-harness' else null end,
 jsonb_build_array(jsonb_build_object('check_guid',ch,'selection_guid',g,'name',p_code,'voided',false,'deleted',false)));
 insert into public.toast_order_checks(snapshot_id,check_guid,amount_cents,voided,deleted) values(s,ch,p_amount,false,false);
 insert into public.toast_order_latest_pointers(location_id,order_guid,snapshot_id,business_date,run_started_at,run_id)
 values(l,g,s,p_date,now(),r);
 return s;
end $$;
do $$ declare l uuid; n bigint; r jsonb; snap uuid; other_shop uuid; begin
 select id into l from public.locations order by id limit 1;
 assert not exists(select 1 from public.ezcater_orders where event_date between '2099-01-01' and '2099-12-31'), 'reserved harness dates occupied';
 insert into public.toast_dining_options(location_id,guid,name) values(l,'ezrec-harness','Ezcater');
 perform pg_temp.ezrec_order('AB1CDE','2099-01-10',10000); perform pg_temp.ezrec_toast('ab1-cde','2099-01-09',10000);
 perform pg_temp.ezrec_order('AB2CDE','2099-01-10',10000); perform pg_temp.ezrec_toast('ab2-cde','2099-01-11',10000);
 perform pg_temp.ezrec_order('AB3CDE','2099-01-10',10000); perform pg_temp.ezrec_toast('ab3-cde','2099-01-12',10000);
 perform pg_temp.ezrec_order('AB4CDE','2099-01-10',10000); perform pg_temp.ezrec_toast('ab4-cde','2099-01-17',10000);
 perform pg_temp.ezrec_order('AB5CDE','2099-01-10',10000); perform pg_temp.ezrec_toast('ab5-cde','2099-01-18',10000);
 perform pg_temp.ezrec_order('AB6CDE','2099-01-10',10000); perform pg_temp.ezrec_toast('ab6-cde','2099-01-08',10000);
 perform pg_temp.ezrec_order('BATCH1','2099-02-01',5000); perform pg_temp.ezrec_order('BATCH2','2099-02-01',5000);
 perform pg_temp.ezrec_toast('batch','2099-02-01',11500,true); -- exactly 15%: no mismatch
 perform pg_temp.ezrec_order('FALLB1','2099-03-01',100000); perform pg_temp.ezrec_toast('batch','2099-03-02',115001,true);
 perform pg_temp.ezrec_order('CASH01','2099-04-01',100000); perform pg_temp.ezrec_toast('batch','2099-04-01',105001,true);
 perform pg_temp.ezrec_order('BLOCK1','2099-05-01',10000); perform pg_temp.ezrec_order('BLOCK2','2099-05-02',10000);
 perform pg_temp.ezrec_toast('BLOCK2','2099-05-02',10000); perform pg_temp.ezrec_toast('batch','2099-05-02',10000,true);
 perform pg_temp.ezrec_toast('orphan','2099-06-01',10000,true);
 perform pg_temp.ezrec_order('EXACT1','2099-07-01',100000); perform pg_temp.ezrec_toast('batch','2099-07-01',105000,true);
 perform pg_temp.ezrec_order('NEGAT1','2099-07-03',100000); perform pg_temp.ezrec_toast('batch','2099-07-03',84999,true);
 perform pg_temp.ezrec_order('ONCE01','2099-08-01',10000); perform pg_temp.ezrec_toast('batch','2099-08-01',10000,true);
 perform pg_temp.ezrec_toast('batch','2099-08-02',10000,true);
 -- Two real sim shops required for tenant-isolation fixture. No production writes.
 select id into other_shop from public.locations where id<>l order by id limit 1;
 if other_shop is null then raise exception 'Harness needs two sim locations for wrong-shop assertion'; end if;
 perform pg_temp.ezrec_order('SHOP01','2099-09-01',10000);
 update public.ezcater_orders set location_id=other_shop where id=(select id from ezrec_fixture where name='SHOP01');
 perform pg_temp.ezrec_toast('SHOP01','2099-09-01',10000);
 insert into public.ezcater_review_queue(order_id,snapshot_id,location_id,source,code,identity_key)
 select o.id,o.snapshot_id,o.location_id,'toast','unmatched_code','harness' from public.ezcater_orders o join ezrec_fixture f on f.id=o.id;
 perform public.reconcile_ezcater_toast('2099-01-01','2099-12-31');
 assert (select rule='normalized_code' from public.ezcater_reconciliation_status where order_number='AB1CDE'), '-1 code';
 assert (select rule='normalized_code' from public.ezcater_reconciliation_status where order_number='AB2CDE'), '+1 code';
 assert (select rule='late_code' from public.ezcater_reconciliation_status where order_number='AB3CDE'), '+2 late';
 assert (select rule='late_code' from public.ezcater_reconciliation_status where order_number='AB4CDE'), '+7 late';
 assert (select status='not_rung_in_toast' from public.ezcater_reconciliation_status where order_number='AB5CDE'), '+8 excluded';
 assert (select status='not_rung_in_toast' from public.ezcater_reconciliation_status where order_number='AB6CDE'), '-2 excluded';
 assert (select count(*)=2 from public.ezcater_reconciliation_status where order_number in ('BATCH1','BATCH2') and status='matched' and rule='daily_batch'), 'batch share + strict 15%';
 assert (select status='amount_mismatch' and rule='daily_batch' from public.ezcater_reconciliation_status where order_number='FALLB1'), 'D-1 fallback + >15% and >$50';
 assert (select status='matched' from public.ezcater_reconciliation_status where order_number='CASH01'), '>$50 but under 15% is NOT a mismatch (both thresholds required)';
 assert (select status='not_rung_in_toast' from public.ezcater_reconciliation_status where order_number='BLOCK1'), 'D existence blocks fallback even if D code linked';
 assert exists(select 1 from public.ezcater_toast_orphans where location_id=l and business_date='2099-06-01'), 'orphan retained';
 assert (select status='matched' from public.ezcater_reconciliation_status where order_number='EXACT1'), 'exact $50 below 15% is not mismatch';
 assert (select status='amount_mismatch' from public.ezcater_reconciliation_status where order_number='NEGAT1'), 'negative >$50 and >15% mismatch';
 assert (select count(*)=1 from public.ezcater_current_toast_links where order_id=(select id from ezrec_fixture where name='ONCE01')), 'same day before fallback';
 assert exists(select 1 from public.ezcater_toast_orphans where location_id=l and business_date='2099-08-02'), 'unused next-day batch orphan';
 assert (select status='not_rung_in_toast' from public.ezcater_reconciliation_status where order_number='SHOP01'), 'wrong shop code refused';
 assert not exists(select 1 from public.ezcater_review_queue q join ezrec_fixture f on f.id=q.order_id where q.resolved_at is null), 'reviews auto resolved';
 assert (select count(*) from public.ezcater_review_resolutions rr join public.ezcater_review_queue q on q.id=rr.review_id join ezrec_fixture f on f.id=q.order_id)=(select count(*) from ezrec_fixture), 'append resolution evidence';
 select count(*) into n from public.ezcater_toast_links;
 r:=public.reconcile_ezcater_toast('2099-01-01','2099-12-31');
 assert r='{"added":0,"retired":0,"resolved":0}'::jsonb, 'idempotent writer counts';
 assert (select count(*) from public.ezcater_toast_links)=n, 'no duplicate history';
 update public.ezcater_orders set status='cancelled' where id=(select id from ezrec_fixture where name='BATCH1');
 assert not exists(select 1 from public.ezcater_current_toast_links where order_id=(select id from ezrec_fixture where name='BATCH1')), 'cancel fence immediate';
 assert not has_function_privilege('authenticated','public.reconcile_ezcater_toast(date,date)','EXECUTE'), 'staff cannot reconcile';
 assert not has_table_privilege('service_role','public.ezcater_review_resolutions','UPDATE,DELETE'), 'resolution append only';
 raise notice 'ezCater reconcile harness assertions passed';
end $$;

-- Addendum: the catering list reads this status view, so links/cancellation must
-- remove the pending row without a dismissal or any separate list write.
do $$ declare o uuid; begin
 perform pg_temp.ezrec_order('CLEAR1','2099-10-01',10000);
 perform pg_temp.ezrec_order('CLEAR2','2099-10-03',10000);
 perform pg_temp.ezrec_order('CLEAR3','2099-10-06',10000);
 perform pg_temp.ezrec_order('CLEAR4','2099-10-09',10000);
 select id into o from ezrec_fixture where name='CLEAR1';
 update public.ezcater_orders set handoff_time='2099-10-01T11:30:00-04:00',
 event_timestamp='2099-10-01T12:00:00-04:00',headcount=24,total_cents=11234 where id=o;
 assert (select count(*)=4 from public.ezcater_reconciliation_status
 where order_number in ('CLEAR1','CLEAR2','CLEAR3','CLEAR4') and status='not_rung_in_toast'), 'pending before rings';
 assert (select handoff_time='2099-10-01T11:30:00-04:00'
 and event_timestamp='2099-10-01T12:00:00-04:00'::timestamptz
 and headcount=24 and total_cents=11234 and lead_id is null
 from public.ezcater_reconciliation_status where order_id=o), 'pending logistics projection';
 assert not exists(select 1 from information_schema.columns
 where table_schema='public' and table_name='ezcater_reconciliation_status'
 and column_name not in ('order_id','location_id','event_date','order_number','status','rule','amount_diff_cents',
 'lead_id','handoff_time','event_timestamp','headcount','total_cents')), 'status projection has no contact fields';
 perform pg_temp.ezrec_toast('clear-1','2099-10-01',10000);
 perform pg_temp.ezrec_toast('clear-2','2099-10-05',10000);
 perform pg_temp.ezrec_toast('batch','2099-10-06',10000,true);
 perform public.reconcile_ezcater_toast('2099-10-01','2099-10-09');
 assert not exists(select 1 from public.ezcater_reconciliation_status
 where order_number in ('CLEAR1','CLEAR2','CLEAR3') and status='not_rung_in_toast'), 'all linking rules clear pending';
 assert (select rule='normalized_code' from public.ezcater_reconciliation_status where order_number='CLEAR1'), 'pending normalized link';
 assert (select rule='late_code' from public.ezcater_reconciliation_status where order_number='CLEAR2'), 'pending late link';
 assert (select rule='daily_batch' from public.ezcater_reconciliation_status where order_number='CLEAR3'), 'pending batch link';
 assert (select status='not_rung_in_toast' from public.ezcater_reconciliation_status where order_number='CLEAR4'), 'unrelated order remains pending';
 update public.ezcater_orders set status='cancelled' where id=(select id from ezrec_fixture where name='CLEAR4');
 assert not exists(select 1 from public.ezcater_reconciliation_status where order_number='CLEAR4'), 'cancellation clears pending immediately';
 raise notice 'ezCater pending logistics harness assertions passed';
end $$;
rollback;
