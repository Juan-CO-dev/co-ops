-- CC SIM ONLY, after 0227. Run as the sim migration owner; everything rolls back.
-- psql -v ON_ERROR_STOP=1 -f scripts/test-ezcater-review-direct.sql
begin;
set local plpgsql.check_asserts=on;
do $$ begin
 if not exists(select 1 from public.users where email='maya@sim.co-ops') then raise exception 'SIM ONLY'; end if;
end $$;

set local role authenticated;
do $$ begin
 begin perform public.decide_ezcater_mapping_direct(gen_random_uuid(),'item',gen_random_uuid(),gen_random_uuid());
  raise exception 'staff direct RPC allowed'; exception when insufficient_privilege then null; end;
 begin perform public.dismiss_ezcater_toast_review(gen_random_uuid(),'test',null,gen_random_uuid());
  raise exception 'staff dismiss RPC allowed'; exception when insufficient_privilege then null; end;
 begin perform 1 from public.ezcater_review_dismissals;
  raise exception 'staff dismissal read allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform public.decide_ezcater_mapping_direct(gen_random_uuid(),'item',gen_random_uuid(),gen_random_uuid());
  raise exception 'anon direct RPC allowed'; exception when insufficient_privilege then null; end;
 begin perform public.dismiss_ezcater_toast_review(gen_random_uuid(),'test',null,gen_random_uuid());
  raise exception 'anon dismiss RPC allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;

do $$
declare loc uuid; other_loc uuid; actor uuid; ordinary uuid; q uuid; sibling uuid; toast_q uuid;
 fixture_item uuid; fixture_menu uuid; fixture_package uuid; global_package uuid; other_package uuid;
 o public.ezcater_orders%rowtype; related public.ezcater_orders%rowtype;
 provider text:='direct-sim-'||gen_random_uuid(); caterer text:='direct-cat-'||gen_random_uuid();
 key text:='["direct-sim-size",[]]'; kind text; entity uuid; role_name text; reason_name text;
 payload jsonb; decision_count bigint; result jsonb;
begin
 select id into loc from public.locations where active order by id limit 1;
 select id into other_loc from public.locations where active and id<>loc order by id limit 1;
 select id into actor from public.users where active and role in ('catering_mgr','moo','owner','cgs') limit 1;
 select id into ordinary from public.users where active and role not in ('catering_mgr','moo','owner','cgs') limit 1;
 assert loc is not null and other_loc is not null and actor is not null and ordinary is not null,'requires two sim shops and approver/ordinary users';
 update public.locations set ezcater_caterer_uuid=caterer where id=loc;
 perform public.apply_ezcater_order(provider,caterer,'{"orderNumber":"DIRECT-SIM","eventTimestamp":"2026-10-08T16:00:00Z","items":[]}',provider,'submitted');
 perform public.apply_ezcater_order(provider||'-sibling',caterer,'{"orderNumber":"DIRECT-SIBLING","eventTimestamp":"2026-10-08T16:00:00Z","items":[]}',provider||'-sibling','submitted');
 select * into o from public.ezcater_orders where provider_uuid=provider;
 select * into related from public.ezcater_orders where provider_uuid=provider||'-sibling';
 insert into public.items(name) values('SIM direct item') returning id into fixture_item;
 insert into public.menu_items(name) values('SIM direct menu item') returning id into fixture_menu;
 insert into public.catering_packages(location_id,slug,label_en,pricing_mode,price_cents)
 values(loc,provider,'SIM direct package','fixed',0) returning id into fixture_package;
 insert into public.catering_packages(slug,label_en,pricing_mode,price_cents)
 values(provider,'SIM global package','fixed',0) returning id into global_package;
 insert into public.catering_packages(location_id,slug,label_en,pricing_mode,price_cents)
 values(other_loc,provider,'SIM other package','fixed',0) returning id into other_package;
 insert into public.ezcater_item_map(location_id,identity_key,menu_item_size_id,status)
 values(loc,key,'direct-sim-size','review');
 insert into public.ezcater_review_queue(order_id,snapshot_id,location_id,source,code,identity_key)
 values(o.id,o.snapshot_id,loc,'ezcater','unmapped_item',key) returning id into q;
 insert into public.ezcater_review_queue(order_id,snapshot_id,location_id,source,code,identity_key)
 values(related.id,related.snapshot_id,loc,'ezcater','ambiguous_name',key) returning id into sibling;
 insert into public.ezcater_item_map(location_id,identity_key,menu_item_size_id,status)
 values(other_loc,key,'direct-sim-size','review');

 begin perform public.decide_ezcater_mapping_direct(q,'item',fixture_item,ordinary); raise exception 'ordinary direct approved';
 exception when raise_exception then if sqlerrm<>'ezcater_mapping_forbidden' then raise; end if; end;
 begin perform public.decide_ezcater_mapping_direct(q,'sku',fixture_item,actor); raise exception 'invalid kind approved';
 exception when raise_exception then if sqlerrm<>'ezcater_mapping_invalid_decision' then raise; end if; end;
 begin perform public.decide_ezcater_mapping_direct(q,'item',gen_random_uuid(),actor); raise exception 'missing target approved';
 exception when raise_exception then if sqlerrm<>'ezcater_mapping_target_invalid' then raise; end if; end;
 begin perform public.decide_ezcater_mapping_direct(q,'package',other_package,actor); raise exception 'other shop package approved';
 exception when raise_exception then if sqlerrm<>'ezcater_mapping_target_invalid' then raise; end if; end;
 foreach kind in array array['item','menu_item','package'] loop
  entity:=case kind when 'item' then fixture_item when 'menu_item' then fixture_menu else fixture_package end;
  if kind='item' then update public.items set active=false where id=entity;
  elsif kind='menu_item' then update public.menu_items set active=false where id=entity;
  else update public.catering_packages set active=false where id=entity; end if;
  begin perform public.decide_ezcater_mapping_direct(q,kind,entity,actor); raise exception 'inactive entity approved';
  exception when raise_exception then if sqlerrm<>'ezcater_mapping_target_invalid' then raise; end if; end;
  if kind='item' then update public.items set active=true where id=entity;
  elsif kind='menu_item' then update public.menu_items set active=true where id=entity;
  else update public.catering_packages set active=true where id=entity; end if;
  result:=public.decide_ezcater_mapping_direct(q,kind,entity,actor);
  assert result->>'status'='confirmed','direct result';
  assert (select status='confirmed' and evidence='reviewed_direct' and toast_map_id is null and toast_item_guid is null
   and num_nonnulls(item_id,menu_item_id,package_id)=1 and coalesce(item_id,menu_item_id,package_id)=entity
   from public.ezcater_item_map where location_id=loc and identity_key=key),'direct entity persisted';
  assert exists(select 1 from public.audit_log where resource_id=(result->>'decision_id')::uuid
   and action='ezcater.item_map.approve' and destructive and metadata->>'entity_kind'=kind),'direct approval audited';
 end loop;
 perform public.decide_ezcater_mapping_direct(q,'package',global_package,actor);
 assert (select count(*)=4 from public.ezcater_mapping_decisions where review_id=q and decision='approve_direct'),'corrections append history';
 assert (select previous_mapping->>'package_id'=fixture_package::text from public.ezcater_mapping_decisions
  where id=(select id from public.ezcater_mapping_decisions where review_id=q order by created_at desc limit 1)),'history retains prior target';
 assert (select resolved_at is not null from public.ezcater_review_queue where id=sibling),'sibling resolved';
 assert (select status='review' from public.ezcater_item_map where location_id=other_loc and identity_key=key),'other shop unchanged';
 -- Existing CHECK rules cannot be weakened by SQL NULL semantics.
 begin update public.ezcater_item_map set evidence=null where location_id=loc and identity_key=key;
  raise exception 'confirmed null evidence allowed'; exception when check_violation then null; end;
 begin update public.ezcater_item_map set evidence='reviewed',toast_item_guid='guid' where location_id=loc and identity_key=key;
  raise exception 'reviewed without Toast map allowed'; exception when check_violation then null; end;
 begin update public.ezcater_item_map set item_id=fixture_item where location_id=loc and identity_key=key;
  raise exception 'multiple direct entities allowed'; exception when check_violation then null; end;
 begin update public.ezcater_item_map set evidence='pos_guid' where location_id=loc and identity_key=key;
  raise exception 'pos_guid without GUID allowed'; exception when check_violation then null; end;

 payload:=jsonb_build_object('links','[]'::jsonb,'shadow','[]'::jsonb,
  'maps',jsonb_build_array(jsonb_build_object('identity_key',key,'menu_item_size_id','direct-sim-size','status','review','candidates','[]'::jsonb)),
  'reviews',jsonb_build_array(jsonb_build_object('identity_key',key,'source','ezcater','code','stale_worker','candidates','[]'::jsonb)));
 perform public.publish_ezcater_shadow(o.id,o.snapshot_id,loc,payload);
 assert (select evidence='reviewed_direct' and package_id=global_package from public.ezcater_item_map where location_id=loc and identity_key=key),'publisher preserves direct target';
 assert not exists(select 1 from public.ezcater_review_queue where location_id=loc and identity_key=key and source='ezcater' and resolved_at is null),'publisher never reopens direct decision';
 -- Original ignore RPC remains valid after a direct approval.
 perform public.decide_ezcater_mapping(q,null,'ignore',actor);
 assert (select status='ignored' from public.ezcater_item_map where location_id=loc and identity_key=key),'legacy ignore retained';

 insert into public.ezcater_review_queue(order_id,snapshot_id,location_id,source,code,identity_key)
 values(o.id,o.snapshot_id,loc,'toast','unmatched_code','direct-toast') returning id into toast_q;
 begin perform public.dismiss_ezcater_toast_review(toast_q,'test',null,ordinary); raise exception 'ordinary dismissed';
 exception when raise_exception then if sqlerrm<>'ezcater_mapping_forbidden' then raise; end if; end;
 begin perform public.dismiss_ezcater_toast_review(q,'test',null,actor); raise exception 'ezcater source dismissed';
 exception when raise_exception then if sqlerrm<>'ezcater_mapping_review_not_found' then raise; end if; end;
 begin perform public.dismiss_ezcater_toast_review(toast_q,'invalid',null,actor); raise exception 'invalid reason accepted';
 exception when raise_exception then if sqlerrm<>'ezcater_mapping_invalid_decision' then raise; end if; end;
 begin perform public.dismiss_ezcater_toast_review(toast_q,'other','  ',actor); raise exception 'empty other accepted';
 exception when raise_exception then if sqlerrm<>'ezcater_mapping_invalid_decision' then raise; end if; end;
 begin perform public.dismiss_ezcater_toast_review(toast_q,'other',repeat('x',501),actor); raise exception 'long note accepted';
 exception when raise_exception then if sqlerrm<>'ezcater_mapping_invalid_decision' then raise; end if; end;
 result:=public.dismiss_ezcater_toast_review(toast_q,'other',' SIM explanation ',actor);
 assert (select resolved_at is not null from public.ezcater_review_queue where id=toast_q),'Toast row resolved';
 assert exists(select 1 from public.ezcater_review_dismissals where review_id=toast_q and note='SIM explanation'),'trimmed note persisted';
 assert exists(select 1 from public.audit_log where action='ezcater.review.dismiss' and destructive
  and resource_id=(result->>'decision_id')::uuid and metadata->>'review_id'=toast_q::text),'dismissal audited';
 begin perform public.dismiss_ezcater_toast_review(toast_q,'test',null,actor); raise exception 'resolved row dismissed twice';
 exception when raise_exception then if sqlerrm<>'ezcater_mapping_source_changed' then raise; end if; end;
 assert (select count(*)=1 from public.ezcater_review_dismissals where review_id=toast_q),'single immutable decision';
 payload:=jsonb_build_object('links','[]'::jsonb,'shadow','[]'::jsonb,'maps','[]'::jsonb,
  'reviews',jsonb_build_array(jsonb_build_object('identity_key','direct-toast','source','toast','code','unmatched_code','candidates','[]'::jsonb)));
 perform public.publish_ezcater_shadow(o.id,o.snapshot_id,loc,payload);
 assert (select resolved_at is not null from public.ezcater_review_queue where id=toast_q),'publisher preserves dismissal';
 -- Exercise every authorized role and every predefined reason.
 foreach role_name in array array['catering_mgr','moo','owner','cgs'] loop
  update public.users set role=role_name where id=actor;
  perform public.decide_ezcater_mapping_direct(q,'item',fixture_item,actor);
  foreach reason_name in array array['not_ezcater','duplicate','test','other'] loop
   insert into public.ezcater_review_queue(order_id,snapshot_id,location_id,source,code,identity_key)
   values(o.id,o.snapshot_id,loc,'toast','unmatched_code',role_name||reason_name) returning id into toast_q;
   perform public.dismiss_ezcater_toast_review(toast_q,reason_name,case when reason_name='other' then 'SIM reason' end,actor);
   assert exists(select 1 from public.ezcater_review_dismissals where review_id=toast_q and reason=reason_name),'authorized reason recorded';
  end loop;
 end loop;
 update public.users set active=false where id=actor;
 begin perform public.decide_ezcater_mapping_direct(q,'item',fixture_item,actor); raise exception 'inactive actor approved';
 exception when raise_exception then if sqlerrm<>'ezcater_mapping_forbidden' then raise; end if; end;
 begin perform public.dismiss_ezcater_toast_review(toast_q,'test',null,actor); raise exception 'inactive actor dismissed';
 exception when raise_exception then if sqlerrm<>'ezcater_mapping_forbidden' then raise; end if; end;
end $$;

set local role service_role;
do $$ begin
 perform 1 from public.ezcater_review_dismissals limit 1;
 begin insert into public.ezcater_review_dismissals(review_id,reason,actor_id) values(gen_random_uuid(),'test',gen_random_uuid());
  raise exception 'service direct history insertion allowed'; exception when insufficient_privilege then null; end;
 begin update public.ezcater_review_dismissals set reason='test';
  raise exception 'dismissal mutable'; exception when insufficient_privilege then null; end;
 begin delete from public.ezcater_review_dismissals;
  raise exception 'dismissal deletable'; exception when insufficient_privilege then null; end;
 begin update public.ezcater_mapping_decisions set decision='ignore';
  raise exception 'mapping decision mutable'; exception when insufficient_privilege then null; end;
 begin delete from public.ezcater_mapping_decisions;
  raise exception 'mapping decision deletable'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
