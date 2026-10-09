-- DRY RUN ONLY by default. Requires migration 0236 and applied seed 46. This file ends in ROLLBACK.
-- Set seed47.target='sim' or 'prod' for the session before running. CC runs this
-- against prod-shaped data, reviews the result rows, then replaces
-- only the final ROLLBACK with COMMIT for the separately approved apply.
begin;
set local lock_timeout = '5s';
lock table public.ezcater_customization_map, public.ezcater_order_items,
  public.ezcater_item_map in share row exclusive mode;

do $$ declare t text:=current_setting('seed47.target',true); begin
 if t is null or t not in ('sim','prod') then raise exception 'seed47: SET seed47.target to sim or prod before running this file'; end if;
 if exists(select 1 from public.users where email='maya@sim.co-ops') is distinct from (t='sim') then
  raise exception 'seed47: target does not match sim marker'; end if;
end $$;

create temp table s47_observed on commit drop as
select distinct o.location_id, x->>'customizationId' customization_id,
  btrim(x->>'name') option_name, btrim(x->>'typeName') type_name,
  case when nullif(btrim(x->>'typeName'),'') is null then btrim(x->>'name')
       else btrim(x->>'typeName')||': '||btrim(x->>'name') end rendered_name,
  nullif(x->>'quantity','')::numeric option_qty, i.name parent_name,
  i.snapshot_id::text||':'||i.ordinal::text line_key, i.options line_options, i.menu_item_size_id
from public.ezcater_orders o join public.ezcater_order_items i
  on i.order_id=o.id and i.snapshot_id=o.snapshot_id and i.is_current
cross join lateral jsonb_array_elements(i.options) x
where nullif(btrim(x->>'customizationId'),'') is not null;

do $$ begin
  if exists(select 1 from s47_observed where rendered_name in (
    'Sub Bread: District Bakery''s Gluten-Free Roll','Add: Fresh Mozzarella',
    'Please Serve On: Bed of Shredded Lettuce','Sub Bread: Shredduce') and option_qty is null) then
    raise exception 'seed47: known effect has missing quantity'; end if;
  if exists(select 1 from s47_observed group by location_id,customization_id
    having count(distinct (option_name,type_name))>1) then
    raise exception 'seed47: provider customization identity changed meaning'; end if;
  if (select count(*) from s47_observed where rendered_name='Sub Bread: District Bakery''s Gluten-Free Roll')=0
   or (select count(*) from s47_observed where rendered_name='Add: Fresh Mozzarella')=0
   or (select count(*) from s47_observed where rendered_name in ('Please Serve On: Bed of Shredded Lettuce','Sub Bread: Shredduce'))=0
   or (select count(*) from s47_observed where type_name='Sub' and parent_name in ('Light Lunch','Full Lunch'))=0 then
   raise exception 'seed47: one or more known customization families were not observed'; end if;
end $$;

create temp table s47_effect_targets(location_id uuid, customization_id text, effects jsonb,
  primary key(location_id,customization_id)) on commit drop;
do $$ declare r record; v_gf uuid; v_roll uuid; v_mozz uuid; v_ice uuid; n integer; v_qty numeric; v_unit text; begin
 for r in select distinct location_id,customization_id,rendered_name from s47_observed where rendered_name in (
   'Sub Bread: District Bakery''s Gluten-Free Roll','Add: Fresh Mozzarella',
   'Please Serve On: Bed of Shredded Lettuce','Sub Bread: Shredduce') loop
  select count(*),(array_agg(id))[1] into n,v_roll from public.vendor_items where active and name='Sub Roll';
  if n<>1 then raise exception 'seed47: expected one active Sub Roll SKU for %, found %',r.location_id,n; end if;
  if r.rendered_name='Sub Bread: District Bakery''s Gluten-Free Roll' then
   select count(*),(array_agg(id))[1] into n,v_gf from public.vendor_items
    where active and name='Gluten Free Roll (District Bakery)';
   if n<>1 then raise exception 'seed47: expected one active GF roll SKU for %, found %',r.location_id,n; end if;
   insert into s47_effect_targets values(r.location_id,r.customization_id,jsonb_build_array(
    jsonb_build_object('targetKind','sku','targetId',v_gf,'disposition','deplete','portionQty',1,'portionUnit','each','parentOnly',false),
    jsonb_build_object('targetKind','sku','targetId',v_roll,'disposition','remove','portionQty',1,'portionUnit','each','parentOnly',true)));
  elsif r.rendered_name='Add: Fresh Mozzarella' then
   select count(*),(array_agg(id))[1] into n,v_mozz from public.items where active and name='Fresh Mozzarella';
   if n<>1 then raise exception 'seed47: expected one active Fresh Mozzarella item, found %',n; end if;
   select count(distinct (portion_qty,portion_unit)),min(portion_qty),min(portion_unit) into n,v_qty,v_unit
    from public.toast_menu_map where location_id=r.location_id and active and match_status='confirmed'
     and is_modifier and disposition='deplete' and item_id=v_mozz and portion_qty is not null and portion_unit is not null;
   if n<>1 then raise exception 'seed47: expected one reviewed Fresh Mozzarella portion for %, found %',r.location_id,n; end if;
   insert into s47_effect_targets values(r.location_id,r.customization_id,jsonb_build_array(
    jsonb_build_object('targetKind','item','targetId',v_mozz,'disposition','deplete','portionQty',v_qty,'portionUnit',v_unit,'parentOnly',false)));
  else
   select count(*),(array_agg(id))[1] into n,v_ice from public.items where active and name='Iceberg';
   if n<>1 then raise exception 'seed47: expected one active Iceberg item, found %',n; end if;
   select count(distinct (portion_qty,portion_unit)),min(portion_qty),min(portion_unit) into n,v_qty,v_unit
    from public.toast_menu_map where location_id=r.location_id and active and match_status='confirmed'
     and is_modifier and disposition='deplete' and item_id=v_ice and portion_qty is not null and portion_unit is not null;
   if n<>1 then raise exception 'seed47: expected one reviewed Iceberg portion for %, found %',r.location_id,n; end if;
   insert into s47_effect_targets values(r.location_id,r.customization_id,jsonb_build_array(
    jsonb_build_object('targetKind','sku','targetId',v_roll,'disposition','remove','portionQty',1,'portionUnit','each','parentOnly',true),
    jsonb_build_object('targetKind','item','targetId',v_ice,'disposition','deplete','portionQty',v_qty,'portionUnit',v_unit,'parentOnly',false)));
  end if;
 end loop;
end $$;

create temp table s47_picks(location_id uuid, customization_id text, menu_item_id uuid,
 primary key(location_id,customization_id)) on commit drop;
do $$ declare r record; v_pkg uuid; v_menu uuid; n integer; begin
 for r in select distinct * from s47_observed
   where parent_name in ('Light Lunch','Full Lunch') and type_name='Sub' loop
  select count(*),(array_agg(m.package_id))[1] into n,v_pkg
   from public.ezcater_item_map m join public.catering_packages p on p.id=m.package_id and p.active
    and (p.location_id is null or p.location_id=r.location_id)
   where m.location_id=r.location_id and m.status='confirmed'
    and m.package_id is not null and jsonb_typeof(m.identity_key::jsonb)='array'
    and jsonb_array_length(m.identity_key::jsonb)=2 and m.identity_key::jsonb->>0=r.menu_item_size_id
    and jsonb_typeof(m.identity_key::jsonb->1)='array'
    and jsonb_array_length(m.identity_key::jsonb->1)=jsonb_array_length(r.line_options)
    and not exists(select 1 from (
      select pair,sum(delta) total from (
       select jsonb_build_array(z->>'customizationId',case when jsonb_typeof(z->'quantity')='number'
         then z->'quantity' else 'null'::jsonb end) pair,1 delta from jsonb_array_elements(r.line_options) z
       union all select z,-1 from jsonb_array_elements(m.identity_key::jsonb->1) z
      ) pairs group by pair having sum(delta)<>0
    ) mismatch);
  if n<>1 then raise exception 'seed47: expected one package binding for % / %, found %',r.location_id,r.parent_name,n; end if;
  select count(*),(array_agg(mi.id))[1] into n,v_menu from public.catering_package_items pi
   join public.catering_package_slot_options so on so.package_item_id=pi.id and so.active
   join public.menu_items mi on mi.id=so.menu_item_id and mi.active
   where pi.package_id=v_pkg and pi.active and pi.slot_type='choice'
    and mi.name=r.option_name;
  if n<>1 then raise exception 'seed47: expected one active package choice for %, found %',r.rendered_name,n; end if;
  if r.parent_name='Light Lunch' then
   if (select count(*) from public.catering_package_items where package_id=v_pkg and active
     and slot_type='choice' and depletion_qty=.5)<>1 then
    raise exception 'seed47: Light Lunch choice slot is not uniquely configured at depletion_qty 0.5'; end if;
  end if;
  if exists(select 1 from s47_picks where location_id=r.location_id and customization_id=r.customization_id
    and menu_item_id<>v_menu) then raise exception 'seed47: customization identity maps to differing package picks'; end if;
  insert into s47_picks values(r.location_id,r.customization_id,v_menu) on conflict do nothing;
 end loop;
end $$;

do $$ begin
 if exists(select 1 from s47_effect_targets e join s47_picks p using(location_id,customization_id)) then
  raise exception 'seed47: customization identity is both effect and package pick'; end if;
 if exists(select 1 from public.ezcater_customization_map m join (
   select location_id,customization_id,effects,null::uuid pick from s47_effect_targets
   union all select location_id,customization_id,'[]'::jsonb,menu_item_id from s47_picks) x using(location_id,customization_id)
   where m.status<>'confirmed' or m.effects<>x.effects or m.pick_menu_item_id is distinct from x.pick) then
  raise exception 'seed47: existing customization mapping conflicts'; end if;
end $$;

with staged as (
 select location_id,customization_id,effects,null::uuid pick from s47_effect_targets
 union all select location_id,customization_id,'[]'::jsonb,menu_item_id from s47_picks
), ins as (
 insert into public.ezcater_customization_map(location_id,customization_id,status,effects,pick_menu_item_id)
 select location_id,customization_id,'confirmed',effects,pick from staged
 on conflict(location_id,customization_id) do nothing returning *
)
insert into public.audit_log(actor_id,actor_role,action,resource_table,resource_id,metadata,destructive)
select null,null,'ezcater.customization_map.approve','ezcater_customization_map',id,
 jsonb_build_object('actor_context','seed_47','location_id',location_id,'customization_id',customization_id,
  'effects',effects,'pick_menu_item_id',pick_menu_item_id),true from ins;

-- Seeded identities are reviewed too; preserve the rows and stamp resolution.
update public.ezcater_review_queue q set resolved_at=clock_timestamp()
where q.source='ezcater' and q.code='customization_unmapped' and q.resolved_at is null
 and exists(select 1 from public.ezcater_customization_map m
  where m.location_id=q.location_id and m.customization_id=q.identity_key
   and (m.location_id,m.customization_id) in (
    select location_id,customization_id from s47_effect_targets
    union all select location_id,customization_id from s47_picks));

select location_id,customization_id,status,effects,pick_menu_item_id
from public.ezcater_customization_map where (location_id,customization_id) in (
 select location_id,customization_id from s47_effect_targets union all select location_id,customization_id from s47_picks)
order by location_id,customization_id;

-- Safety default: CC's required prod-shaped discovery run cannot persist.
rollback;
