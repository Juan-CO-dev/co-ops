-- CC SIM ONLY, after 0225. All fixtures and publications roll back.
-- psql -v ON_ERROR_STOP=1 -f scripts/test-ezcater-pass2.sql
begin;
set local plpgsql.check_asserts=on;
do $$ begin
 if not exists(select 1 from public.users where email='maya@sim.co-ops') then raise exception 'SIM ONLY'; end if;
end $$;
set local role authenticated;
do $$ begin
 begin perform public.publish_ezcater_shadow(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'{}');
  raise exception 'staff RPC allowed'; exception when insufficient_privilege then null; end;
 begin perform 1 from public.ezcater_item_map;
  raise exception 'staff map read allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$
declare loc uuid; other_loc uuid; provider text := 'pass2-sim-'||gen_random_uuid(); caterer text := 'pass2-cat-'||gen_random_uuid();
 o public.ezcater_orders%rowtype; run uuid:=gen_random_uuid(); snap uuid:=gen_random_uuid(); ring text:='pass2-ring-'||gen_random_uuid();
 payload jsonb; bad jsonb; before_count bigint; other public.ezcater_orders%rowtype;
begin
 select id into loc from public.locations where active order by id limit 1;
 select id into other_loc from public.locations where active and id<>loc order by id limit 1;
 assert loc is not null and other_loc is not null,'requires two sim shops';
 update public.locations set ezcater_caterer_uuid=caterer where id=loc;
 perform public.apply_ezcater_order(provider,caterer,'{"orderNumber":"SIM-1234","eventTimestamp":"2026-10-08T16:00:00Z","items":[]}', 'pass2-digest','submitted');
 select * into o from public.ezcater_orders where provider_uuid=provider;
 assert o.snapshot_id is not null,'requires applied fixture';
 insert into public.toast_capture_runs(id,location_id,business_date,status,finished_at,orders) values(run,loc,'2026-10-08','completed',now(),1);
 insert into public.toast_orders(id,location_id,order_guid,business_date,content_hash,deleted,voided,excess_food,selection_units)
 values(snap,loc,ring,'2026-10-08',repeat('a',64),false,false,false,
 '[{"check_guid":"check","selection_guid":"selection","item_guid":"ring","name":"SIM-1234","quantity":1,"voided":false,"deleted":false},{"check_guid":"check","selection_guid":"second","item_guid":"ring","name":"SIM-5678","quantity":1,"voided":false,"deleted":false}]');
 insert into public.toast_order_latest_pointers(location_id,order_guid,snapshot_id,business_date,run_started_at,run_id)
 values(loc,ring,snap,'2026-10-08',now(),run);
 payload:=jsonb_build_object('links',jsonb_build_array(jsonb_build_object('toast_snapshot_id',snap,'order_guid',ring,
  'check_guid','check','selection_guid','selection','business_date','2026-10-08')),'maps','[]'::jsonb,'shadow','[]'::jsonb,
  'reviews',jsonb_build_array(jsonb_build_object('source','ezcater','code','unmapped_item','identity_key','test','candidates','[]'::jsonb)));
 perform public.publish_ezcater_shadow(o.id,o.snapshot_id,loc,payload);
 assert (select count(*)=1 from public.ezcater_toast_links where order_id=o.id and is_current),'link inserted';
 assert (select snapshot_id=o.snapshot_id and location_id=loc from public.ezcater_review_queue where order_id=o.id),'review fenced';
 perform public.publish_ezcater_shadow(o.id,o.snapshot_id,loc,payload);
 assert (select count(*)=1 from public.ezcater_toast_links where order_id=o.id and is_current),'retry one current link';
 assert (select count(*)=2 from public.ezcater_toast_links where order_id=o.id),'history retained';
 begin perform public.publish_ezcater_shadow(o.id,gen_random_uuid(),loc,payload); raise exception 'stale snapshot accepted';
 exception when raise_exception then if sqlerrm<>'ezcater_shadow_source_changed' then raise; end if; end;
 begin perform public.publish_ezcater_shadow(o.id,o.snapshot_id,other_loc,payload); raise exception 'wrong shop accepted';
 exception when raise_exception then if sqlerrm<>'ezcater_shadow_source_changed' then raise; end if; end;
 bad:=jsonb_set(payload,'{links,0,selection_guid}','"absent"');
 begin perform public.publish_ezcater_shadow(o.id,o.snapshot_id,loc,bad); raise exception 'missing selection accepted';
 exception when raise_exception then if sqlerrm<>'ezcater_shadow_toast_changed' then raise; end if; end;
 assert (select count(*)=1 from public.ezcater_toast_links where order_id=o.id and is_current),'failed publish atomic';
 -- Multiple provider orders may share one ring, but never one selection.
 perform public.apply_ezcater_order(provider||'-second',caterer,'{"orderNumber":"SIM-5678","eventTimestamp":"2026-10-08T16:00:00Z","items":[]}', 'pass2-second','submitted');
 select * into other from public.ezcater_orders where provider_uuid=provider||'-second';
 perform public.publish_ezcater_shadow(other.id,other.snapshot_id,loc,jsonb_set(payload,'{links,0,selection_guid}','"second"'));
 assert (select count(*)=2 from public.ezcater_toast_links where order_guid=ring and is_current),'two orders on one ring';
 begin perform public.publish_ezcater_shadow(other.id,other.snapshot_id,loc,payload); raise exception 'selection double linked';
 exception when unique_violation then null; end;
 perform public.publish_ezcater_shadow(o.id,o.snapshot_id,loc,'{"links":[],"maps":[],"shadow":[],"reviews":[]}');
 assert not exists(select 1 from public.ezcater_toast_links where order_id=o.id and is_current),'empty generation retires links';
 assert not exists(select 1 from public.ezcater_review_queue where order_id=o.id and resolved_at is null),'resolved queue';
end $$;
set local role service_role;
do $$ begin
 begin insert into public.ezcater_review_queue(order_id,snapshot_id,location_id,source,code,identity_key)
  values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'ezcater','test','test');
  raise exception 'direct service write allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
