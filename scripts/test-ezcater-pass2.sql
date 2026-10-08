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
 begin perform public.decide_ezcater_mapping(gen_random_uuid(),null,'ignore',gen_random_uuid());
  raise exception 'staff decision RPC allowed'; exception when insufficient_privilege then null; end;
 begin perform 1 from public.ezcater_mapping_decisions;
  raise exception 'staff decision read allowed'; exception when insufficient_privilege then null; end;
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
 assert exists(select 1 from public.ezcater_review_queue where order_id=o.id and resolved_at is null),'publish must not silently resolve queue';
end $$;
-- Approval, ignore, history, publisher preservation and live authorization.
do $$
declare loc uuid; actor uuid; ordinary uuid; q uuid; sibling uuid; fixture_item uuid; target public.toast_menu_map%rowtype;
 o public.ezcater_orders%rowtype; related public.ezcater_orders%rowtype; payload jsonb; key text := '["sim-review-size",[]]';
begin
 select * into o from public.ezcater_orders where provider_uuid like 'pass2-sim-%' and snapshot_id is not null and lead_id is not null limit 1;
 assert o.id is not null,'requires order fixture from previous block';
 loc:=o.location_id;
 select id into fixture_item from public.items limit 1;
 assert fixture_item is not null,'requires one SIM item';
 insert into public.toast_menu_map(location_id,item_id,toast_item_guid,toast_item_name,match_status)
 values(loc,fixture_item,'sim-review-'||gen_random_uuid(),'SIM review fixture','confirmed') returning * into target;
 select id into actor from public.users where active and role in ('catering_mgr','moo','owner','cgs') limit 1;
 select id into ordinary from public.users where active and role not in ('catering_mgr','moo','owner','cgs') limit 1;
 assert actor is not null and ordinary is not null,'requires SIM approver and ordinary user';
 insert into public.ezcater_item_map(location_id,identity_key,menu_item_size_id,status)
 values(loc,key,'sim-review-size','review');
 insert into public.ezcater_review_queue(order_id,snapshot_id,location_id,source,code,identity_key)
 values(o.id,o.snapshot_id,loc,'ezcater','unmapped_item',key) returning id into q;
 select * into related from public.ezcater_orders where provider_uuid like 'pass2-sim-%' and id<>o.id and location_id=loc and snapshot_id is not null limit 1;
 assert related.id is not null,'requires sibling order fixture';
 insert into public.ezcater_review_queue(order_id,snapshot_id,location_id,source,code,identity_key)
 values(related.id,related.snapshot_id,loc,'ezcater','ambiguous_name',key) returning id into sibling;
 begin perform public.decide_ezcater_mapping(q,target.id,'approve',ordinary); raise exception 'ordinary actor approved';
 exception when raise_exception then if sqlerrm<>'ezcater_mapping_forbidden' then raise; end if; end;
 begin perform public.decide_ezcater_mapping(q,gen_random_uuid(),'approve',actor); raise exception 'unknown target approved';
 exception when raise_exception then if sqlerrm<>'ezcater_mapping_target_invalid' then raise; end if; end;
 update public.toast_menu_map set active=false where id=target.id;
 begin perform public.decide_ezcater_mapping(q,target.id,'approve',actor); raise exception 'inactive target approved';
 exception when raise_exception then if sqlerrm<>'ezcater_mapping_target_invalid' then raise; end if; end;
 update public.toast_menu_map set active=true where id=target.id;
 perform public.decide_ezcater_mapping(q,target.id,'approve',actor);
 assert (select status='confirmed' and evidence='reviewed' and toast_map_id=target.id from public.ezcater_item_map where location_id=loc and identity_key=key),'approval target';
 assert (select count(*)=1 from public.ezcater_mapping_decisions where review_id=q),'decision appended';
 assert (select resolved_at is not null from public.ezcater_review_queue where id=sibling),'approval resolves sibling identity review';
 assert exists(select 1 from public.audit_log where action='ezcater.item_map.approve' and destructive and metadata->>'review_id'=q::text),'destructive approval audit';
 payload:=jsonb_build_object('links','[]'::jsonb,'shadow','[]'::jsonb,
 'maps',jsonb_build_array(jsonb_build_object('identity_key',key,'menu_item_size_id','sim-review-size','status','review','candidates','[]'::jsonb)),
 'reviews',jsonb_build_array(jsonb_build_object('identity_key',key,'source','ezcater','code','unmapped_item','candidates','[]'::jsonb),
 jsonb_build_object('identity_key',key,'source','ezcater','code','new_stale_worker_candidate','candidates','[]'::jsonb)));
 perform public.publish_ezcater_shadow(o.id,o.snapshot_id,loc,payload);
 assert (select status='confirmed' from public.ezcater_item_map where location_id=loc and identity_key=key),'publisher preserves confirmation';
 assert (select resolved_at is not null from public.ezcater_review_queue where id=q),'publisher never reopens decision';
 assert not exists(select 1 from public.ezcater_review_queue where location_id=loc and identity_key=key and resolved_at is null),'publisher cannot insert new open review for confirmed identity';
 perform public.decide_ezcater_mapping(q,null,'ignore',actor);
 perform public.publish_ezcater_shadow(o.id,o.snapshot_id,loc,payload);
 assert (select status='ignored' from public.ezcater_item_map where location_id=loc and identity_key=key),'publisher preserves ignore';
 assert not exists(select 1 from public.ezcater_review_queue where location_id=loc and identity_key=key and resolved_at is null),'publisher cannot insert new open review for ignored identity';
 assert (select count(*)=2 from public.ezcater_mapping_decisions where review_id=q),'both decisions retained';
 assert exists(select 1 from public.audit_log where action='ezcater.item_map.ignore' and destructive and metadata->>'review_id'=q::text),'destructive ignore audit';
 update public.users set active=false where id=actor;
 begin perform public.decide_ezcater_mapping(q,target.id,'approve',actor); raise exception 'deactivated actor approved';
 exception when raise_exception then if sqlerrm<>'ezcater_mapping_forbidden' then raise; end if; end;
end $$;
set local role service_role;
do $$ begin
 begin update public.ezcater_mapping_decisions set decision='ignore';
  raise exception 'decision history mutable'; exception when insufficient_privilege then null; end;
 begin delete from public.ezcater_mapping_decisions;
  raise exception 'decision history deletable'; exception when insufficient_privilege then null; end;
 begin insert into public.ezcater_review_queue(order_id,snapshot_id,location_id,source,code,identity_key)
  values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'ezcater','test','test');
  raise exception 'direct service write allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
