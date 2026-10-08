-- AUTHORED ONLY; CC applies sim then prod, AFTER migration 0226.
-- Separate operational data step, not a migration. No Three Footer changes.
-- Run as ONE transaction: BEGIN; SET LOCAL seed46.target = 'sim'; <file>; COMMIT;
-- For prod CC must explicitly change target to 'prod'. Repeated runs are no-ops.
-- Stable names/GUIDs + seed43 audit provenance are the manifest: seed43 itself
-- discovered GUIDs from the ledger/cache and did not contain a literal GUID list.
-- This script refuses count/target drift rather than choosing an arbitrary row.
do $seed46$
declare
  v_target text := current_setting('seed46.target', true);
  r record; v_id uuid; v_map uuid; v_pkg uuid; v_n integer;
begin
  if v_target is null or v_target not in ('sim','prod') then
    raise exception 'set seed46.target explicitly to sim or prod';
  end if;
  if exists (select 1 from public.users where email = 'maya@sim.co-ops') is distinct from (v_target = 'sim') then
    raise exception 'seed46 target % does not match database sim marker', v_target;
  end if;
  lock table public.toast_menu_map, public.toast_map_effects, public.toast_open_item_aliases,
    public.catering_packages, public.catering_package_items in share row exclusive mode;

  create temp table s46_before_maps on commit drop as select id, to_jsonb(m) as row from public.toast_menu_map m;
  create temp table s46_before_effects on commit drop as select id, to_jsonb(e) as row from public.toast_map_effects e;
  create temp table s46_before_aliases on commit drop as select id, to_jsonb(a) as row from public.toast_open_item_aliases a;
  create temp table s46_before_lines on commit drop as select id, to_jsonb(l) as row from public.catering_package_items l;

  create temp table s46_targets (kind text, name text, id uuid, primary key(kind,name)) on commit drop;
  for r in select * from (values
    ('item','Dukes'), ('item','Aioli'), ('item','Horsey Mayo'),
    ('item','HP Mayo'), ('item','HC Aioli'), ('item','Mustard Aioli'),
    ('item','Hot Peppers'), ('item','Sweet Peppers'),
    ('item','Provolone'), ('item','Fresh Mozzarella'), ('item','Cheddar'), ('item','Shredded Mozzarella'),
    ('sku','Sub Roll'), ('sku','Gluten Free Roll (District Bakery)')
  ) x(kind,name) loop
    if r.kind = 'item' then
      select count(*), (array_agg(id))[1] into v_n,v_id from public.items where active and name = r.name;
    else
      select count(*), (array_agg(id))[1] into v_n,v_id from public.vendor_items where active and name = r.name;
    end if;
    if v_n <> 1 then raise exception 'seed46: expected one active % %, found %',r.kind,r.name,v_n; end if;
    insert into s46_targets values(r.kind,r.name,v_id);
  end loop;

  create temp table s46_staged on commit drop as
  select m.id, a.metadata->>'rule_group' as grp, a.metadata->>'rule_name' as name
    from public.toast_menu_map m join public.audit_log a on a.resource_id = m.id
   where a.action = 'toast_map.manual_map' and a.metadata->>'actor_context' = 'seed_43'
     and m.active and m.match_status = 'confirmed' and m.is_modifier
     and (a.metadata->>'rule_group' in ('mod_gf_staged','mod_pick_staged')
       or (a.metadata->>'rule_group' = 'mod_remove_staged' and a.metadata->>'rule_name' in ('no mayo','no peppers')));
  for r in select * from (values ('mod_gf_staged',11),('mod_pick_staged',7),('mod_remove_staged',6)) x(grp,n) loop
    select count(*) into v_n from s46_staged where grp = r.grp;
    if v_n <> r.n then raise exception 'seed46: expected % % rows, found %',r.n,r.grp,v_n; end if;
  end loop;
  if (select count(*) from s46_staged where name = 'no mayo') <> 4
     or (select count(*) from s46_staged where name = 'no peppers') <> 2 then
    raise exception 'seed46: No Mayo/No Peppers split drifted from 4/2';
  end if;
  if exists(select 1 from s46_staged s join public.toast_menu_map m on m.id=s.id
    where (s.grp = 'mod_gf_staged' and (m.sku_id is distinct from
      (select id from s46_targets where name='Gluten Free Roll (District Bakery)') or m.disposition not in ('ignore','deplete')))
      or (s.grp='mod_pick_staged' and (m.menu_item_id is null or m.disposition not in ('ignore','deplete')))
      or (s.name='no mayo' and (m.item_id is distinct from (select id from s46_targets where name='Dukes') or m.disposition not in ('ignore','remove')))
      or (s.name='no peppers' and (m.item_id is distinct from (select id from s46_targets where name='Hot Peppers') or m.disposition not in ('ignore','remove')))) then
    raise exception 'seed46: staged target/disposition drift';
  end if;

  update public.toast_menu_map m set disposition='deplete', portion_qty=1, portion_unit='each', parent_only=false
    from s46_staged s where s.id=m.id and s.grp='mod_gf_staged'
    and (m.disposition,m.portion_qty,m.portion_unit,m.parent_only) is distinct from ('deplete'::text,1::numeric,'each'::text,false);
  update public.toast_menu_map m set disposition='deplete', portion_qty=null, portion_unit=null
    from s46_staged s where s.id=m.id and s.grp='mod_pick_staged'
    and (m.disposition <> 'deplete' or m.portion_qty is not null or m.portion_unit is not null);
  update public.toast_menu_map m set disposition='remove', parent_only=true
    from s46_staged s where s.id=m.id and s.grp='mod_remove_staged'
    and (m.disposition <> 'remove' or not m.parent_only);

  -- No Cheese was deliberately absent in seed43. Reconstruct the same observed
  -- universe; a GUID with another name or base role is a conflict, not a match.
  create temp table s46_observed on commit drop as
    select distinct location_id, toast_item_guid as guid, lower(regexp_replace(btrim(item_name),'\s+',' ','g')) as name,
           parent_selection_guid is not null as is_mod
      from public.toast_sales_events where not voided
    union
    select l.id, o.value->>'guid', lower(regexp_replace(btrim(o.value->>'name'),'\s+',' ','g')), true
      from public.toast_menu_cache c join public.locations l on l.toast_restaurant_guid=c.restaurant_guid,
           jsonb_each(case when jsonb_typeof(c.payload->'modifierOptionReferences')='object'
                      then c.payload->'modifierOptionReferences' else '{}'::jsonb end) o
    union
    select l.id, j->>'guid', lower(regexp_replace(btrim(j->>'name'),'\s+',' ','g')), false
      from public.toast_menu_cache c join public.locations l on l.toast_restaurant_guid=c.restaurant_guid,
           jsonb_path_query(c.payload,'lax $.menus.**.menuItems[*]') j;
  create temp table s46_cheese on commit drop as
    select distinct location_id,guid from s46_observed where name='no cheese' and is_mod;
  select count(*) into v_n from s46_cheese;
  if v_n <> 18 then raise exception 'seed46: expected 18 No Cheese location/GUIDs, found %',v_n; end if;
  if exists(select 1 from s46_cheese c join s46_observed o using(location_id,guid)
    where o.name <> 'no cheese' or not o.is_mod) then raise exception 'seed46: ambiguous No Cheese GUID'; end if;
  for r in select * from s46_cheese order by location_id,guid loop
    select id into v_id from s46_targets where name='Provolone';
    select id into v_map from public.toast_menu_map where location_id=r.location_id and toast_item_guid=r.guid and active and match_status='confirmed';
    if v_map is null then
      update public.toast_menu_map set active=false where location_id=r.location_id and toast_item_guid=r.guid and active;
      insert into public.toast_menu_map(location_id,toast_item_guid,toast_item_name,item_id,match_status,confirmed_at,is_modifier,disposition,parent_only)
        values(r.location_id,r.guid,'No Cheese',v_id,'confirmed',now(),true,'remove',true) returning id into v_map;
    elsif not exists(select 1 from public.toast_menu_map where id=v_map and item_id=v_id and is_modifier and disposition='remove' and parent_only) then
      raise exception 'seed46: existing No Cheese mapping conflicts for %',r.guid;
    end if;
  end loop;

  -- Expected extra effects. Ordinal zero remains the primary row, so no primary
  -- target can appear again here. The explicit GF 1-each documents the swap;
  -- parent_only still forbids a portion fallback when the parent lacks Sub Roll.
  create temp table s46_effects(map_id uuid, ordinal integer, item_id uuid, sku_id uuid,
    primary key(map_id,ordinal)) on commit drop;
  insert into s46_effects select s.id,1,null,t.id from s46_staged s cross join s46_targets t
    where s.grp='mod_gf_staged' and t.name='Sub Roll';
  insert into s46_effects select s.id,x.ord,t.id,null from s46_staged s
    cross join (values(1,'Aioli'),(2,'Horsey Mayo'),(3,'HP Mayo'),(4,'HC Aioli'),(5,'Mustard Aioli')) x(ord,name)
    join s46_targets t on t.name=x.name where s.name='no mayo';
  insert into s46_effects select s.id,1,t.id,null from s46_staged s cross join s46_targets t
    where s.name='no peppers' and t.name='Sweet Peppers';
  -- Product-resolved banana peppers may resolve to either active vendor member.
  -- Include every active member; only the parent's actual direct SKU contributes.
  select count(*) into v_n from public.vendor_items vi join public.products p on p.id=vi.product_id
    where vi.active and p.active and p.name='Banana Peppers';
  if v_n < 1 then raise exception 'seed46: no active Banana Peppers product SKU'; end if;
  insert into s46_effects select s.id, 1 + row_number() over(partition by s.id order by vi.id)::integer,null,vi.id
    from s46_staged s cross join public.vendor_items vi join public.products p on p.id=vi.product_id
    where s.name='no peppers' and vi.active and p.active and p.name='Banana Peppers';
  insert into s46_effects select m.id,x.ord,t.id,null from s46_cheese c
    join public.toast_menu_map m on m.location_id=c.location_id and m.toast_item_guid=c.guid and m.active and m.match_status='confirmed'
    cross join (values(1,'Fresh Mozzarella'),(2,'Cheddar'),(3,'Shredded Mozzarella')) x(ord,name)
    join s46_targets t on t.name=x.name;
  if exists(select 1 from public.toast_map_effects e join (select distinct map_id from s46_effects) a using(map_id)
    left join s46_effects x on x.map_id=e.map_id and x.ordinal=e.ordinal
    where e.active and (x.map_id is null or e.item_id is distinct from x.item_id or e.sku_id is distinct from x.sku_id
      or e.menu_item_id is not null or e.disposition<>'remove' or not e.parent_only
      or e.portion_qty is distinct from (case when exists(select 1 from s46_staged s where s.id=x.map_id and s.grp='mod_gf_staged') then 1::numeric end)
      or e.portion_unit is distinct from (case when exists(select 1 from s46_staged s where s.id=x.map_id and s.grp='mod_gf_staged') then 'each'::text end))) then raise exception 'seed46: existing effects conflict'; end if;
  insert into public.toast_map_effects(map_id,ordinal,item_id,sku_id,disposition,parent_only,portion_qty,portion_unit)
    select x.map_id,x.ordinal,x.item_id,x.sku_id,'remove',true,
      case when exists(select 1 from s46_staged s where s.id=x.map_id and s.grp='mod_gf_staged') then 1 end,
      case when exists(select 1 from s46_staged s where s.id=x.map_id and s.grp='mod_gf_staged') then 'each' end
      from s46_effects x
     where not exists(select 1 from public.toast_map_effects e where e.map_id=x.map_id and e.ordinal=x.ordinal and e.active);
  if (select count(*) from public.toast_map_effects e join s46_effects x using(map_id,ordinal) where e.active)
     <> (select count(*) from s46_effects) then raise exception 'seed46: effect readback failed'; end if;

  -- Light Lunch has one choice slot (quantity remains pickN=1) and depletion=0.5.
  -- Derive base GUIDs from exact observed names, never invent a location GUID.
  create temp table s46_lunch on commit drop as select distinct location_id,guid from s46_observed where name='light lunch' and not is_mod;
  select count(*) into v_n from s46_lunch;
  -- Prod 2026-10-08: Light Lunch is sold at MEP (Capitol Hill) only, one GUID (44 sales); EM's menu has none.
  if v_n <> 1 then raise exception 'seed46: expected one Light Lunch base GUID (MEP only), found %',v_n; end if;
  for r in select * from s46_lunch loop
    if exists(select 1 from s46_observed where location_id=r.location_id and guid=r.guid and name<>'light lunch') then
      raise exception 'seed46: ambiguous Light Lunch GUID %',r.guid;
    end if;
    select count(*),(array_agg(id))[1] into v_n,v_pkg from public.catering_packages
      where active and slug='light-lunch' and location_id=r.location_id;
    if v_n=0 then
      select count(*),(array_agg(id))[1] into v_n,v_pkg from public.catering_packages where active and slug='light-lunch' and location_id is null;
    end if;
    if v_n<>1 then raise exception 'seed46: expected one Light Lunch package for %, found %',r.location_id,v_n; end if;
    select count(*),(array_agg(id))[1] into v_n,v_id from public.catering_package_items where package_id=v_pkg and active and slot_type='choice' and quantity=1;
    if v_n<>1 or (select count(*) from public.catering_package_items where package_id=v_pkg and active and slot_type='choice')<>1 then
      raise exception 'seed46: Light Lunch must have exactly one choice slot with pickN=1';
    end if;
    update public.catering_package_items set depletion_qty=0.5 where id=v_id and depletion_qty is distinct from 0.5;
    select id into v_map from public.toast_menu_map where location_id=r.location_id and toast_item_guid=r.guid and active and match_status='confirmed';
    if v_map is not null and not exists(select 1 from public.toast_menu_map where id=v_map and package_id=v_pkg and not is_modifier and disposition='deplete') then
      -- Existing menu-item mapping is superseded, preserving its provenance.
      update public.toast_menu_map set active=false where id=v_map;
      v_map:=null;
    end if;
    if v_map is null then
      update public.toast_menu_map set active=false where location_id=r.location_id and toast_item_guid=r.guid and active;
      insert into public.toast_menu_map(location_id,toast_item_guid,toast_item_name,package_id,match_status,confirmed_at,disposition)
        values(r.location_id,r.guid,'Light Lunch',v_pkg,'confirmed',now(),'deplete');
    end if;
  end loop;

  -- Already normalized canonical keys. Plurals/misspellings collapse BEFORE
  -- lookup (chioz -> chips -> chip, crewm -> cream). '&' is stripped, not 'and'.
  create temp table s46_aliases(normalized_text text primary key, target text) on commit drop;
  insert into s46_aliases values
    ('chip','Utz Original Chips'), ('bag of chip','Utz Original Chips'),
    ('big chip','Utz Original Chips'), ('bigchip','Utz Original Chips'),
    ('big bag','Utz Original Chips'), ('big utz','Utz Original Chips'),
    ('large chip','Utz Original Chips'), ('chips xl','Utz Original Chips'),
    ('ripple','Put Chips In It (add-on)'), ('mini chip','Mini Chips- Utz Original'),
    ('utz salt pepper chip','Salt & Pepper Chips'),
    ('gf','Gluten Free Roll (District Bakery)'), ('gluten free','Gluten Free Roll (District Bakery)'),
    ('sub district bread gluten free roll','Gluten Free Roll (District Bakery)'),
    ('chx cutlet','The chicken cutlet'), ('chicken cutlet','The chicken cutlet'), ('chix','The chicken cutlet'),
    ('cream soda','Dr. Brown''s Cream Soda');
  -- Deferred: bread -> Extra Sub Roll add-on; hp mayo -> HP Mayo add-on;
  -- kid s / kids -> Kid's. A prep item's identity is NOT the missing add-on build.
  for r in select * from s46_aliases loop
    select count(*),(array_agg(id))[1] into v_n,v_id from public.menu_items where active and name=r.target;
    if v_n<>1 then raise exception 'seed46: expected one alias target %, found %',r.target,v_n; end if;
    if exists(select 1 from public.toast_open_item_aliases where active and location_id is null and normalized_text=r.normalized_text
      and (menu_item_id is distinct from v_id or item_id is not null or qty_multiplier<>1)) then
      raise exception 'seed46: alias conflict for %',r.normalized_text;
    end if;
    insert into public.toast_open_item_aliases(normalized_text,menu_item_id)
      select r.normalized_text,v_id where not exists(select 1 from public.toast_open_item_aliases
        where active and location_id is null and normalized_text=r.normalized_text);
  end loop;
  if (select count(*) from public.toast_open_item_aliases a join s46_aliases x using(normalized_text) where a.active and a.location_id is null)<>18 then
    raise exception 'seed46: alias readback count is not 18';
  end if;

  for r in select * from (values
    ('2c3c26f1-87ef-4d86-b760-67c96ddd2ca2','EM'),
    ('398bbb87-223f-414c-a2b1-960edaf3fa6b','MEP')) x(guid,code) loop
    select count(*),(array_agg(id))[1] into v_n,v_id from public.locations where code=r.code;
    if v_n<>1 then raise exception 'seed46: expected one location code %, found %',r.code,v_n; end if;
    if not exists(select 1 from s46_observed where location_id=v_id and guid=r.guid and not is_mod) then
      raise exception 'seed46: open-item GUID % missing at %',r.guid,r.code;
    end if;
    select id into v_map from public.toast_menu_map where location_id=v_id and toast_item_guid=r.guid and active and match_status='confirmed';
    if v_map is not null and not exists(select 1 from public.toast_menu_map where id=v_map and not is_modifier and disposition='open_item') then
      raise exception 'seed46: shared GUID % has conflicting confirmed mapping',r.guid;
    end if;
    if v_map is null then
      update public.toast_menu_map set active=false where location_id=v_id and toast_item_guid=r.guid and active;
      insert into public.toast_menu_map(location_id,toast_item_guid,toast_item_name,match_status,confirmed_at,disposition)
        values(v_id,r.guid,'Open Item','confirmed',now(),'open_item');
    end if;
  end loop;

  -- Audit only actual changes using existing closed vocabulary. Repeat run emits
  -- nothing. Effects/aliases are crosswalk config under toast_map.manual_map.
  insert into public.audit_log(actor_id,actor_role,action,resource_table,resource_id,destructive,before_state,after_state,metadata)
  select null,null,case when not m.active then 'toast_map.unmap' else 'toast_map.manual_map' end,'toast_menu_map',m.id,false,b.row,to_jsonb(m),
    jsonb_build_object('actor_context','seed_46','target',v_target,'reason','depletion specs A-D')
    from public.toast_menu_map m left join s46_before_maps b using(id) where b.row is distinct from to_jsonb(m);
  insert into public.audit_log(actor_id,actor_role,action,resource_table,resource_id,destructive,before_state,after_state,metadata)
  select null,null,'toast_map.manual_map','toast_map_effects',e.id,false,b.row,to_jsonb(e),
    jsonb_build_object('actor_context','seed_46','target',v_target,'reason','parent-only extra effect')
    from public.toast_map_effects e left join s46_before_effects b using(id) where b.row is distinct from to_jsonb(e);
  insert into public.audit_log(actor_id,actor_role,action,resource_table,resource_id,destructive,before_state,after_state,metadata)
  select null,null,'toast_map.manual_map','toast_open_item_aliases',a.id,false,b.row,to_jsonb(a),
    jsonb_build_object('actor_context','seed_46','target',v_target,'reason','open-item alias')
    from public.toast_open_item_aliases a left join s46_before_aliases b using(id) where b.row is distinct from to_jsonb(a);
  insert into public.audit_log(actor_id,actor_role,action,resource_table,resource_id,destructive,before_state,after_state,metadata)
  select null,null,'catering.kb.packages.line_item_update','catering_package_items',l.id,false,b.row,to_jsonb(l),
    jsonb_build_object('actor_context','seed_46','target',v_target,'reason','Light Lunch depletion only; customer pickN unchanged')
    from public.catering_package_items l join s46_before_lines b using(id) where b.row is distinct from to_jsonb(l);

  raise notice 'seed46: 11 GF swaps, 6 mixed removals, 18 No Cheese, 7 lunch picks, 1 Light Lunch base (MEP), 18 aliases, 2 open-item GUIDs verified';
end $seed46$;
