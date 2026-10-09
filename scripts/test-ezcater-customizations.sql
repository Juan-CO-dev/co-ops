-- 0236 transactional sim harness. Expected result: notices only, then ROLLBACK.
begin;
set local plpgsql.check_asserts=on;
do $$ begin if not exists(select 1 from public.users where email='maya@sim.co-ops') then raise exception 'SIM ONLY'; end if; end $$;
do $$
declare loc uuid; actor uuid; ordinary uuid; item_a uuid; item_b uuid; ord uuid:=gen_random_uuid();
 snap uuid:=gen_random_uuid(); q uuid; cid text:='sim-custom-'||gen_random_uuid()::text; result jsonb; n integer;
 sku uuid; menu uuid; pkg uuid; pkg_line uuid; cid2 text:='sim-pick-'||gen_random_uuid()::text;
 v_effects jsonb;
 pkg2 uuid; pkg_line2 uuid; ord2 uuid:=gen_random_uuid(); snap2 uuid:=gen_random_uuid();
begin
 select id into loc from public.locations where active order by created_at,id limit 1;
 select id into actor from public.users where active and role in ('catering_mgr','moo','owner','cgs') order by created_at,id limit 1;
 select id into ordinary from public.users where active and role not in ('catering_mgr','moo','owner','cgs') order by created_at,id limit 1;
 select id into item_a from public.items where active order by created_at,id limit 1;
 select id into item_b from public.items where active and id<>item_a order by created_at,id limit 1;
 select id into sku from public.vendor_items where active order by created_at,id limit 1;
 if loc is null or actor is null or ordinary is null or item_a is null or item_b is null then
  raise exception '0236 harness requires active location, reviewer, ordinary user and two items'; end if;

 v_effects:=jsonb_build_array(
  jsonb_build_object('targetKind','item','targetId',item_a,'disposition','deplete','portionQty',1,'portionUnit','each','parentOnly',false),
  jsonb_build_object('targetKind','item','targetId',item_b,'disposition','remove','portionQty',null,'portionUnit',null,'parentOnly',true));
 insert into public.ezcater_orders(id,provider_uuid,caterer_uuid,location_id,snapshot_id,snapshot_digest)
  values(ord,'sim-provider-'||ord,'sim-caterer',loc,snap,'sim-digest');
 insert into public.ezcater_order_snapshots(id,order_id) values(snap,ord);
 insert into public.ezcater_order_items(order_id,snapshot_id,ordinal,name,quantity,menu_item_size_id,options)
  values(ord,snap,1,'Harness item',1,'sim-size',jsonb_build_array(jsonb_build_object(
   'customizationId',cid,'name','Harness option','quantity',1,'typeName','Harness')));
 insert into public.ezcater_review_queue(order_id,snapshot_id,location_id,source,code,identity_key)
  values(ord,snap,loc,'ezcater','customization_unmapped',cid) returning id into q;

 begin perform public.decide_ezcater_customization(q,'approve',v_effects,null,ordinary); raise exception 'ordinary actor approved';
 exception when raise_exception then if sqlerrm<>'ezcater_mapping_forbidden' then raise; end if; end;
 begin perform public.decide_ezcater_customization(q,'approve','{}'::jsonb,null,actor); raise exception 'object effects approved';
 exception when raise_exception then if sqlerrm<>'ezcater_customization_invalid_decision' then raise; end if; end;
 begin perform public.decide_ezcater_customization(q,'approve',jsonb_build_array(
  jsonb_build_object('targetKind','item','targetId',item_a,'disposition','deplete','portionQty',1,'portionUnit','bogus','parentOnly',false)),null,actor);
  raise exception 'bad unit approved'; exception when raise_exception then if sqlerrm<>'ezcater_customization_effect_invalid' then raise; end if; end;
 begin perform public.decide_ezcater_customization(q,'approve',jsonb_build_array(
  jsonb_build_object('targetKind',null,'targetId',item_a,'disposition','deplete','portionQty',null,'portionUnit',null,'parentOnly',false)),null,actor);
  raise exception 'null kind approved'; exception when raise_exception then if sqlerrm<>'ezcater_customization_effect_invalid' then raise; end if; end;
 begin perform public.decide_ezcater_customization(q,'approve',jsonb_build_array(
  jsonb_build_object('targetKind','sku','targetId',sku,'disposition','deplete','portionQty',1,'portionUnit','whole_sub','parentOnly',false)),null,actor);
  raise exception 'invalid sku unit approved'; exception when raise_exception then if sqlerrm<>'ezcater_customization_effect_invalid' then raise; end if; end;
 begin perform public.decide_ezcater_customization(q,'approve','[]'::jsonb,gen_random_uuid(),actor); raise exception 'invalid pick approved';
 exception when raise_exception then if sqlerrm<>'ezcater_customization_pick_invalid' then raise; end if; end;

 result:=public.decide_ezcater_customization(q,'approve',v_effects,null,actor);
 assert result->>'status'='confirmed','multi-effect decision failed';
 assert (select m.effects=v_effects from public.ezcater_customization_map m where location_id=loc and customization_id=cid),'effects not stored';
 assert (select resolved_at is not null from public.ezcater_review_queue where id=q),'review not resolved';
 insert into public.ezcater_review_queue(order_id,snapshot_id,location_id,source,code,identity_key)
  values(ord,snap,loc,'ezcater','customization_unmapped',cid) on conflict do nothing returning id into q;
 assert q is null,'guard did not suppress decided customization';

 insert into public.menu_items(name) values('SIM 0236 pick') returning id into menu;
 insert into public.catering_packages(location_id,slug,label_en,pricing_mode,price_cents)
  values(loc,'sim-0236-'||ord,'SIM 0236 package','fixed',0) returning id into pkg;
 insert into public.catering_package_items(package_id,description,quantity,slot_type)
  values(pkg,'SIM choice',1,'choice') returning id into pkg_line;
 insert into public.catering_package_slot_options(package_item_id,menu_item_id) values(pkg_line,menu);
 update public.ezcater_order_items set options=jsonb_build_array(
  jsonb_build_object('customizationId',cid2,'name','SIM pick','quantity',1,'typeName','Sub')) where snapshot_id=snap;
 insert into public.ezcater_item_map(location_id,identity_key,menu_item_size_id,package_id,status,evidence)
  values(loc,jsonb_build_array('sim-size',jsonb_build_array(jsonb_build_array(cid2,1)))::text,
   'sim-size',pkg,'confirmed','reviewed_direct');
 insert into public.ezcater_review_queue(order_id,snapshot_id,location_id,source,code,identity_key)
  values(ord,snap,loc,'ezcater','customization_unmapped',cid2) returning id into q;
 -- BC-022/031: one eligible package cannot authorize the same option on a
 -- second package with no eligible choice, within this order OR another order.
 insert into public.catering_packages(location_id,slug,label_en,pricing_mode,price_cents)
  values(loc,'sim-0236-second-'||ord,'SIM second package','fixed',0) returning id into pkg2;
 insert into public.catering_package_items(package_id,description,quantity,slot_type)
  values(pkg2,'SIM second choice',1,'choice') returning id into pkg_line2;
 insert into public.ezcater_order_items(order_id,snapshot_id,ordinal,name,quantity,menu_item_size_id,options)
  values(ord,snap,2,'Second package',1,'sim-size-2',jsonb_build_array(
   jsonb_build_object('customizationId',cid2,'name','SIM pick','quantity',1,'typeName','Sub')));
 insert into public.ezcater_item_map(location_id,identity_key,menu_item_size_id,package_id,status,evidence)
  values(loc,jsonb_build_array('sim-size-2',jsonb_build_array(jsonb_build_array(cid2,1)))::text,
   'sim-size-2',pkg2,'confirmed','reviewed_direct');
 begin perform public.decide_ezcater_customization(q,'approve','[]'::jsonb,menu,actor);
  raise exception 'shared pick stranded another line';
 exception when raise_exception then if sqlerrm<>'ezcater_customization_pick_invalid' then raise; end if; end;
 assert not exists(select 1 from public.ezcater_customization_map where location_id=loc and customization_id=cid2),
  'refused pick wrote a mapping';
 assert (select resolved_at is null from public.ezcater_review_queue where id=q),'refused pick resolved review';
 insert into public.ezcater_orders(id,provider_uuid,caterer_uuid,location_id,snapshot_id,snapshot_digest)
  values(ord2,'sim-provider-'||ord2,'sim-caterer',loc,snap2,'sim-digest-2');
 insert into public.ezcater_order_snapshots(id,order_id) values(snap2,ord2);
 update public.ezcater_order_items set order_id=ord2,snapshot_id=snap2 where order_id=ord and ordinal=2;
 begin perform public.decide_ezcater_customization(q,'approve','[]'::jsonb,menu,actor);
  raise exception 'shared pick stranded another order';
 exception when raise_exception then if sqlerrm<>'ezcater_customization_pick_invalid' then raise; end if; end;
 -- All affected packages now bind: approval must succeed.
 insert into public.catering_package_slot_options(package_item_id,menu_item_id) values(pkg_line2,menu);
 result:=public.decide_ezcater_customization(q,'approve','[]'::jsonb,menu,actor);
 assert result->>'status'='confirmed','package pick decision failed';

 cid:='sim-stale-'||gen_random_uuid()::text;
 insert into public.ezcater_review_queue(order_id,snapshot_id,location_id,source,code,identity_key)
  values(ord,snap,loc,'ezcater','customization_unmapped',cid) returning id into q;
 begin perform public.decide_ezcater_customization(q,'ignore','[]'::jsonb,null,actor); raise exception 'stale source approved';
 exception when raise_exception then if sqlerrm<>'ezcater_mapping_source_changed' then raise; end if; end;

 if has_table_privilege('anon','public.ezcater_customization_map','SELECT,INSERT,UPDATE,DELETE')
  or has_table_privilege('authenticated','public.ezcater_customization_map','SELECT,INSERT,UPDATE,DELETE')
  or has_table_privilege('service_role','public.ezcater_customization_map','INSERT,UPDATE,DELETE')
  or not has_table_privilege('service_role','public.ezcater_customization_map','SELECT') then
  raise exception '0236 map ACL failure'; end if;
 if has_function_privilege('anon','public.decide_ezcater_customization(uuid,text,jsonb,uuid,uuid)','EXECUTE')
  or has_function_privilege('authenticated','public.decide_ezcater_customization(uuid,text,jsonb,uuid,uuid)','EXECUTE')
  or not has_function_privilege('service_role','public.decide_ezcater_customization(uuid,text,jsonb,uuid,uuid)','EXECUTE') then
  raise exception '0236 RPC ACL failure'; end if;
 raise notice '0236 ezCater customization harness PASS';
end $$;
rollback;
