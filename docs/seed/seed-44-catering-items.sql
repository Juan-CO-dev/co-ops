-- Seed 44 | authored 2026-10-08 | CC applies sim, then prod after review.
-- Run as ONE transaction: BEGIN; SET LOCAL seed44.target = 'sim'; <this file>; COMMIT;
-- Change only the target to 'prod' for production. Roll back the transaction for a dry run.
-- Source: Juan's 2026-10-07/08 rulings and the 2026-10-08 read-only build snapshot.
-- The live active '<Sub> (build)' recipe is the authority for footer fillings.
-- Every such recipe must produce one active menu item and contain one Sub Roll.
-- A sub is a menu item in section 'Subs' or 'Build Your Own'; this excludes
-- other roll-based builds such as Garlic Bread. No qualifying sub is skipped.
-- Salads are limited to the seven named subs. All seven have greens; none needs
-- the no-greens Iceberg fallback. Arugula is converted from handful to oz.
-- Cheddar 0.4 oz/slice = Juan's own 3-sample weigh (2026-08-20, PFG Cheddar SKU); provolone 0.7/slice; fresh mozz 1 oz/slice.
-- Loaf and cookie prices are unknown: no vendor_price_history rows are written.
-- This does not set pickle/GF weights, Olivia rolls, or ezCater mappings.
-- New salads/footers/Cheesy Boi are NOT catering_available (public portal lists those); Juan opts them in.
--
-- CC dry-run checklist (first run): 2 new loaf SKUs; 2 footer menu items and
-- recipes per qualifying active '<Sub> (build)' source; 7 salad items/recipes;
-- 1 Cheesy Boi item/recipe; 3 cookie SKUs; 0-3 cookie recipes (only missing
-- producers); 1 GF price row at $6.50 per each; 2 footer maps superseded;
-- 3 drinks deactivated; all active confirmed drink maps set to ignore (the
-- notice reports changed map count; already-ignored rows count as zero).
-- Re-run: zero writes and zero new audit rows. Check every notice and readback.
do $seed44$
declare
  v_target text := current_setting('seed44.target', true);
  r record; s record; v_n integer; v_id uuid; v_vendor uuid; v_sku uuid;
  v_menu uuid; v_recipe uuid; v_source uuid; v_roll uuid; v_ice uuid; v_aru uuid;
  v_turkey uuid; v_prov uuid; v_mozz uuid; v_cheddar uuid; v_old record;
  v_footer_count integer := 0; v_salad_count integer := 0; v_cookie_count integer := 0;
  v_price_count integer := 0; v_map_count integer := 0; v_drink_count integer := 0;
  v_ignore_count integer := 0;
  v_greens integer; v_qty numeric; v_name text;
begin
  if v_target is null or v_target not in ('sim','prod') then
    raise exception 'seed44: set seed44.target explicitly to sim or prod';
  end if;
  if exists(select 1 from public.users where email='maya@sim.co-ops') is distinct from (v_target='sim') then
    raise exception 'seed44: target % does not match sim persona', v_target;
  end if;
  lock table public.vendors, public.vendor_items, public.vendor_price_history,
    public.items, public.menu_items, public.recipes, public.recipe_inputs,
    public.recipe_outputs, public.toast_menu_map, public.audit_log
    in share row exclusive mode;

  create temp table s44_before(kind text, id uuid, row jsonb, primary key(kind,id)) on commit drop;
  insert into s44_before select 'sku',id,to_jsonb(x) from public.vendor_items x;
  insert into s44_before select 'price',id,to_jsonb(x) from public.vendor_price_history x;
  insert into s44_before select 'menu',id,to_jsonb(x) from public.menu_items x;
  insert into s44_before select 'recipe',id,to_jsonb(x) from public.recipes x;
  insert into s44_before select 'input',id,to_jsonb(x) from public.recipe_inputs x;
  insert into s44_before select 'output',id,to_jsonb(x) from public.recipe_outputs x;
  insert into s44_before select 'map',id,to_jsonb(x) from public.toast_menu_map x;

  create temp table s44_ids(kind text, name text, id uuid, primary key(kind,name)) on commit drop;
  for r in select * from (values
    ('sku','Sub Roll'),('sku','Arugula'),('sku','Gluten Free Roll (District Bakery)'),
    ('item','Iceberg'),('item','Turkey'),('item','Provolone'),
    ('item','Fresh Mozzarella'),('item','Cheddar'),
    ('vendor','Cardinal Bakery'),('vendor','Whisked'),('vendor','Berger')
  ) x(kind,name) loop
    if r.kind='sku' then
      select count(*),(array_agg(id))[1] into v_n,v_id from public.vendor_items where active and name=r.name;
    elsif r.kind='item' then
      select count(*),(array_agg(id))[1] into v_n,v_id from public.items where active and name=r.name;
    else
      select count(*),(array_agg(id))[1] into v_n,v_id from public.vendors where active and name=r.name;
    end if;
    if v_n<>1 then raise exception 'seed44: expected one active % %, found %',r.kind,r.name,v_n; end if;
    insert into s44_ids values(r.kind,r.name,v_id);
  end loop;
  select id into v_roll from s44_ids where kind='sku' and name='Sub Roll';
  select id into v_aru from s44_ids where kind='sku' and name='Arugula';
  select id into v_ice from s44_ids where kind='item' and name='Iceberg';
  select id into v_turkey from s44_ids where kind='item' and name='Turkey';
  select id into v_prov from s44_ids where kind='item' and name='Provolone';
  select id into v_mozz from s44_ids where kind='item' and name='Fresh Mozzarella';
  select id into v_cheddar from s44_ids where kind='item' and name='Cheddar';

  -- Exact active build/output pairing; refuse dual producers and malformed bread.
  create temp table s44_bases(sub_name text primary key, menu_id uuid, recipe_id uuid,
    section text) on commit drop;
  insert into s44_bases
  select m.name,m.id,rc.id,m.section from public.menu_items m
    join public.recipe_outputs o on o.output_menu_item_id=m.id
    join public.recipes rc on rc.id=o.recipe_id
    where m.active and m.section in ('Subs','Build Your Own')
      and rc.active and rc.name=m.name||' (build)' and rc.recipe_type='consumer'
      and exists(select 1 from public.recipe_inputs i where i.recipe_id=rc.id and i.component_sku_id=
        (select id from s44_ids where kind='sku' and name='Sub Roll'));
  if not exists(select 1 from s44_bases) then raise exception 'seed44: no active sub builds'; end if;
  if exists(select 1 from s44_bases b where
    (select count(*) from public.recipe_outputs o join public.recipes rc on rc.id=o.recipe_id
      where o.output_menu_item_id=b.menu_id and rc.active)<>1
    or (select count(*) from public.recipe_outputs where recipe_id=b.recipe_id)<>1
    or (select count(*) from public.recipe_inputs where recipe_id=b.recipe_id and component_sku_id=v_roll and quantity=1 and unit='each')<>1
    or (select count(*) from public.recipe_inputs where recipe_id=b.recipe_id and component_sku_id=v_roll)<>1
  ) then raise exception 'seed44: build output or one-Sub-Roll invariant failed'; end if;
  if (select count(*) from s44_bases where sub_name in
    ('Crunchy Boi','Farmers Market After Dark','It''s a BOI','Marisa Tomei Eats Free',
     'Sicky Wicky Club','The Frex','The Teamster'))<>7 then
    raise exception 'seed44: missing/ambiguous salad source build';
  end if;

  for r in select * from (values
    ('3-Foot Loaf','Cardinal Bakery'),('6-Foot Loaf','Cardinal Bakery'),
    ('Whisked Chocolate Chip Cookie','Whisked'),('Berger Cookies 2 pk','Berger'),
    ('Berger Cookies Large','Berger')) x(name,vendor_name) loop
    select id into v_vendor from s44_ids where kind='vendor' and name=r.vendor_name;
    select count(*),(array_agg(id))[1] into v_n,v_sku from public.vendor_items where active and name=r.name;
    if v_n>1 then raise exception 'seed44: duplicate active SKU %',r.name; end if;
    if v_n=1 and (select vendor_id from public.vendor_items where id=v_sku)<>v_vendor then
      raise exception 'seed44: SKU % has wrong vendor',r.name;
    end if;
    if v_n=0 then
      insert into public.vendor_items(vendor_id,name,sku_class,pack_format,units_per_pack,each_size,each_measure,active,created_by)
        values(v_vendor,r.name,'raw','Each',1,1,'count',true,null) returning id into v_sku;
    end if;
    insert into s44_ids values('sku',r.name,v_sku);
  end loop;

  -- Price is an append-only history row. Current $6.50 is per purchased each.
  select id into v_sku from s44_ids where kind='sku' and name='Gluten Free Roll (District Bakery)';
  if (select price_basis from public.vendor_items where id=v_sku) is distinct from 'per_each' then
    update public.vendor_items set price_basis='per_each',updated_at=now() where id=v_sku;
  end if;
  select count(*),(array_agg(unit_price order by effective_date desc,recorded_at desc,id desc))[1]
    into v_n,v_qty from public.vendor_price_history where vendor_item_id=v_sku;
  if v_n=0 or v_qty<>6.50 then
    insert into public.vendor_price_history(vendor_item_id,unit_price,effective_date,recorded_at,recorded_by,source,source_note)
      values(v_sku,6.50,current_date,now(),null,'juan-ruling-2026-10-08',
        'Juan: District Bakery GF roll costs $6.50 each; seed 44');
    v_price_count:=1;
  end if;

  -- A salad keeps all non-bread, non-greens lines; its greens bed is exactly 6 oz.
  for r in select * from s44_bases where sub_name in
    ('Crunchy Boi','Farmers Market After Dark','It''s a BOI','Marisa Tomei Eats Free',
     'Sicky Wicky Club','The Frex','The Teamster') order by sub_name loop
    v_name:=r.sub_name||' Salad';
    select count(*),(array_agg(id))[1] into v_n,v_menu from public.menu_items where active and name=v_name;
    if v_n>1 then raise exception 'seed44: duplicate salad %',v_name; end if;
    if v_n=0 then
      -- catering_available stays FALSE: the public catering portal lists every catering-available
      -- menu item. These exist for ezCater mapping + depletion; Juan turns portal listing on per item.
      insert into public.menu_items(name,section,active,catering_available,catering_only,catering_portionable,seasonal,created_by)
        values(v_name,r.section,true,false,false,false,false,null) returning id into v_menu;
    end if;
    select count(*),(array_agg(o.recipe_id))[1] into v_n,v_recipe
      from public.recipe_outputs o join public.recipes z on z.id=o.recipe_id
      where o.output_menu_item_id=v_menu and z.active;
    if v_n>1 then raise exception 'seed44: multiple salad producers %',v_name; end if;
    if v_n=0 then
      if exists(select 1 from public.recipes where active and name=v_name||' (build)') then
        raise exception 'seed44: salad recipe name occupied %',v_name;
      end if;
      insert into public.recipes(name,recipe_type,batch_yield,active,notes,created_by)
        values(v_name||' (build)','consumer',1,true,'Seed 44: source sub minus bread; 6 oz greens bed',null)
        returning id into v_recipe;
      insert into public.recipe_outputs(recipe_id,output_menu_item_id,yield,display_order)
        values(v_recipe,v_menu,1,0);
      insert into public.recipe_inputs(recipe_id,component_sku_id,component_item_id,component_product_id,quantity,unit,
        each_container_label,portioned,display_order)
        select v_recipe,i.component_sku_id,i.component_item_id,i.component_product_id,
          i.quantity,i.unit,i.each_container_label,i.portioned,i.display_order
        from public.recipe_inputs i where i.recipe_id=r.recipe_id
          and i.component_sku_id is distinct from v_roll and i.component_sku_id is distinct from v_aru
          and i.component_item_id is distinct from v_ice;
      select (case when exists(select 1 from public.recipe_inputs where recipe_id=r.recipe_id and component_item_id=v_ice) then 1 else 0 end)
        +(case when exists(select 1 from public.recipe_inputs where recipe_id=r.recipe_id and component_sku_id=v_aru) then 1 else 0 end)
        into v_greens;
      if v_greens=0 then raise exception 'seed44: % unexpectedly has no greens; review fallback',r.sub_name; end if;
      if exists(select 1 from public.recipe_inputs where recipe_id=r.recipe_id and component_item_id=v_ice) then
        insert into public.recipe_inputs(recipe_id,component_item_id,quantity,unit,display_order)
          values(v_recipe,v_ice,6/v_greens,'oz',1000);
      end if;
      if exists(select 1 from public.recipe_inputs where recipe_id=r.recipe_id and component_sku_id=v_aru) then
        insert into public.recipe_inputs(recipe_id,component_sku_id,quantity,unit,display_order)
          values(v_recipe,v_aru,6/v_greens,'oz',1001);
      end if;
      v_salad_count:=v_salad_count+1;
    elsif not exists(select 1 from public.recipes where id=v_recipe and name=v_name||' (build)' and recipe_type='consumer') then
      raise exception 'seed44: existing salad producer conflicts %',v_name;
    end if;
  end loop;

  -- Cheesy Boi follows Crunchy Boi exactly, excluding Turkey and replacing cheese.
  select recipe_id,section into v_source,v_name from s44_bases where sub_name='Crunchy Boi';
  select count(*),(array_agg(id))[1] into v_n,v_menu from public.menu_items where active and name='Cheesy Boi';
  if v_n>1 then raise exception 'seed44: duplicate Cheesy Boi'; end if;
  if v_n=0 then
    insert into public.menu_items(name,section,active,catering_available,catering_only,catering_portionable,seasonal,created_by)
      values('Cheesy Boi',v_name,true,false,false,false,false,null) returning id into v_menu;
  end if;
  select count(*),(array_agg(o.recipe_id))[1] into v_n,v_recipe
    from public.recipe_outputs o join public.recipes z on z.id=o.recipe_id where o.output_menu_item_id=v_menu and z.active;
  if v_n>1 then raise exception 'seed44: multiple Cheesy Boi producers'; end if;
  if v_n=0 then
    if exists(select 1 from public.recipes where active and name='Cheesy Boi (build)') then
      raise exception 'seed44: Cheesy Boi recipe name occupied'; end if;
    insert into public.recipes(name,recipe_type,batch_yield,active,notes,created_by)
      values('Cheesy Boi (build)','consumer',1,true,
        'Seed 44: 2 provolone slices (1.4 oz), 3 fresh mozzarella (3 oz), 3 cheddar (1.2 oz)',null)
      returning id into v_recipe;
    insert into public.recipe_outputs(recipe_id,output_menu_item_id,yield,display_order) values(v_recipe,v_menu,1,0);
    insert into public.recipe_inputs(recipe_id,component_sku_id,component_item_id,component_product_id,quantity,unit,
      each_container_label,portioned,display_order)
      select v_recipe,i.component_sku_id,i.component_item_id,i.component_product_id,i.quantity,i.unit,
        i.each_container_label,i.portioned,i.display_order from public.recipe_inputs i
      where i.recipe_id=v_source and i.component_item_id is distinct from v_turkey
        and i.component_item_id is distinct from v_prov;
    insert into public.recipe_inputs(recipe_id,component_item_id,quantity,unit,display_order)
      values(v_recipe,v_prov,1.4,'oz',1000),(v_recipe,v_mozz,3,'oz',1001),(v_recipe,v_cheddar,1.2,'oz',1002);
  elsif not exists(select 1 from public.recipes where id=v_recipe and name='Cheesy Boi (build)' and recipe_type='consumer') then
    raise exception 'seed44: existing Cheesy Boi producer conflicts';
  end if;
  select count(*),(array_agg(o.recipe_id))[1] into v_n,v_recipe from public.menu_items m
    join public.recipe_outputs o on o.output_menu_item_id=m.id join public.recipes z on z.id=o.recipe_id
    where m.active and m.name='Cheesy Boi filling (modifier build)' and z.active;
  if v_n<>1 then raise exception 'seed44: expected one Cheesy Boi modifier recipe, found %',v_n; end if;
  if (select count(*) from public.recipe_inputs where recipe_id=v_recipe)<>3 then
    raise exception 'seed44: Cheesy Boi modifier inputs drifted';
  end if;
  for r in select * from (values(v_prov,1.4::numeric,1.4::numeric),
      (v_mozz,2::numeric,3::numeric),(v_cheddar,0.8::numeric,1.2::numeric)) x(item_id,old_qty,qty) loop
    select count(*),(array_agg(id))[1],(array_agg(quantity))[1] into v_n,v_id,v_qty from public.recipe_inputs
      where recipe_id=v_recipe and component_item_id=r.item_id and unit='oz';
    if v_n<>1 then raise exception 'seed44: Cheesy Boi modifier component missing/duplicate %',r.item_id; end if;
    if v_qty not in (r.old_qty,r.qty) then raise exception 'seed44: Cheesy Boi modifier quantity drift for %: %',r.item_id,v_qty; end if;
    update public.recipe_inputs set quantity=r.qty where id=v_id and quantity is distinct from r.qty;
  end loop;

  -- Cheesy Boi is also an active sub with a Sub Roll, including on the first run.
  select count(*),(array_agg(o.recipe_id))[1] into v_n,v_recipe
    from public.recipe_outputs o join public.recipes z on z.id=o.recipe_id
    where o.output_menu_item_id=v_menu and z.active;
  if v_n<>1 then raise exception 'seed44: Cheesy Boi build readback failed'; end if;
  insert into s44_bases(sub_name,menu_id,recipe_id,section)
    select m.name,m.id,v_recipe,m.section from public.menu_items m where m.id=v_menu
      and not exists(select 1 from s44_bases where sub_name='Cheesy Boi');

  -- One physical loaf plus 10.8x/21.6x every non-bread input, preserving units.
  for r in select * from s44_bases order by sub_name loop
    for s in select * from (values('3-Footer',10.8::numeric,135::numeric,'3-Foot Loaf'),
                                  ('6-Footer',21.6::numeric,260::numeric,'6-Foot Loaf'))
      x(suffix,multiplier,price,loaf) loop
      v_name:=r.sub_name||' '||s.suffix;
      select count(*),(array_agg(id))[1] into v_n,v_menu from public.menu_items where active and name=v_name;
      if v_n>1 then raise exception 'seed44: duplicate menu item %',v_name; end if;
      if v_n=0 then
        insert into public.menu_items(name,section,menu_price,active,catering_available,catering_only,catering_portionable,seasonal,created_by)
          -- Off the portal: catering_only implies catering_available (CHECK), so both stay false
          -- until Juan opts a footer in from the admin menu (it is catering-only in practice).
          values(v_name,r.section,s.price,true,false,false,false,false,null) returning id into v_menu;
      elsif not exists(select 1 from public.menu_items where id=v_menu and menu_price=s.price
          and section is not distinct from r.section) then
        raise exception 'seed44: existing footer % conflicts',v_name;
      end if;
      select count(*),(array_agg(o.recipe_id))[1] into v_n,v_recipe
        from public.recipe_outputs o join public.recipes z on z.id=o.recipe_id
        where o.output_menu_item_id=v_menu and z.active;
      if v_n>1 then raise exception 'seed44: multiple producers for %',v_name; end if;
      if v_n=0 then
        if exists(select 1 from public.recipes where active and name=v_name||' (build)') then
          raise exception 'seed44: recipe name occupied: %',v_name;
        end if;
        insert into public.recipes(name,recipe_type,batch_yield,active,notes,created_by)
          values(v_name||' (build)','consumer',1,true,'Seed 44: one bakery loaf, source filling x '||s.multiplier,null)
          returning id into v_recipe;
        insert into public.recipe_outputs(recipe_id,output_menu_item_id,yield,display_order)
          values(v_recipe,v_menu,1,0);
        select id into v_sku from s44_ids where kind='sku' and name=s.loaf;
        insert into public.recipe_inputs(recipe_id,component_sku_id,quantity,unit,display_order)
          values(v_recipe,v_sku,1,'each',0);
        insert into public.recipe_inputs(recipe_id,component_sku_id,component_item_id,component_product_id,quantity,unit,
          each_container_label,portioned,display_order)
          select v_recipe,i.component_sku_id,i.component_item_id,i.component_product_id,
            i.quantity*s.multiplier,i.unit,i.each_container_label,i.portioned,i.display_order+1
          from public.recipe_inputs i where i.recipe_id=r.recipe_id and i.component_sku_id is distinct from v_roll;
        v_footer_count:=v_footer_count+1;
      elsif not exists(select 1 from public.recipes where id=v_recipe and name=v_name||' (build)' and recipe_type='consumer') then
        raise exception 'seed44: existing producer for % conflicts',v_name;
      end if;
    end loop;
  end loop;

  -- Cookie menu names are literal, including Berger's differing spaces.
  for r in select * from (values
    ('Whisked Chocolate Chip Cookie','Whisked Chocolate Chip Cookie'),
    ('Berger Cookies - 2 pk','Berger Cookies 2 pk'),
    ('Berger Cookies- Large','Berger Cookies Large')) x(menu_name,sku_name) loop
    select count(*),(array_agg(id))[1] into v_n,v_menu from public.menu_items where active and name=r.menu_name;
    if v_n<>1 then raise exception 'seed44: expected one active cookie menu item %, found %',r.menu_name,v_n; end if;
    select count(*) into v_n from public.recipe_outputs o join public.recipes z on z.id=o.recipe_id
      where o.output_menu_item_id=v_menu and z.active;
    if v_n>1 then raise exception 'seed44: cookie has multiple producers %',r.menu_name; end if;
    if v_n=0 then
      if exists(select 1 from public.recipes where active and name=r.menu_name||' (build)') then
        raise exception 'seed44: cookie recipe name occupied %',r.menu_name;
      end if;
      insert into public.recipes(name,recipe_type,batch_yield,active,notes,created_by)
        values(r.menu_name||' (build)','consumer',1,true,'Seed 44: one purchased SKU per sold unit',null)
        returning id into v_recipe;
      insert into public.recipe_outputs(recipe_id,output_menu_item_id,yield,display_order) values(v_recipe,v_menu,1,0);
      select id into v_sku from s44_ids where kind='sku' and name=r.sku_name;
      insert into public.recipe_inputs(recipe_id,component_sku_id,quantity,unit,display_order)
        values(v_recipe,v_sku,1,'each',0);
      v_cookie_count:=v_cookie_count+1;
    end if;
  end loop;

  -- Preserve old Toast rows as inactive history; active unique indexes then
  -- permit replacement with the same location/GUID and new menu target.
  for r in select * from (values('3 foot Crunchy Boi','Crunchy Boi 3-Footer','EM'),
                                ('3 foot Teamster','The Teamster 3-Footer','MEP')) x(map_name,target_name,loc_code) loop
    select count(*),(array_agg(id))[1] into v_n,v_menu from public.menu_items where active and name=r.target_name;
    if v_n<>1 then raise exception 'seed44: missing footer target %',r.target_name; end if;
    select count(*),(array_agg(m.id))[1] into v_n,v_id from public.toast_menu_map m
      join public.locations l on l.id=m.location_id
      where m.active and m.match_status='confirmed' and m.is_modifier and l.code=r.loc_code
        and lower(btrim(m.toast_item_name))=lower(r.map_name);
    if v_n<>1 then raise exception 'seed44: expected one active footer map % at %, found %',r.map_name,r.loc_code,v_n; end if;
    select * into v_old from public.toast_menu_map where id=v_id;
    if v_old.menu_item_id=v_menu and v_old.portion_qty=1 and v_old.portion_unit='whole_sub' then continue; end if;
    if not exists(select 1 from public.audit_log a where a.resource_id=v_old.id
      and a.resource_table='toast_menu_map' and a.metadata->>'actor_context'='seed_43'
      and a.action='toast_map.manual_map') then
      raise exception 'seed44: footer map % lacks seed 43 provenance',r.map_name;
    end if;
    if v_old.portion_qty is distinct from 4.5 or v_old.portion_unit is distinct from 'whole_sub'
      or v_old.disposition is distinct from 'deplete'
      or (select count(*) from s44_bases where menu_id=v_old.menu_item_id and sub_name=
        case when r.loc_code='EM' then 'Crunchy Boi' else 'The Teamster' end)<>1 then
      raise exception 'seed44: old footer mapping drift %',r.map_name;
    end if;
    if exists(select 1 from public.toast_menu_map where active and match_status='confirmed'
      and location_id=v_old.location_id and menu_item_id=v_menu) then
      raise exception 'seed44: footer target already confirmed at %',r.loc_code;
    end if;
    update public.toast_menu_map set active=false where id=v_old.id;
    insert into public.toast_menu_map(location_id,menu_item_id,toast_item_guid,toast_item_name,toast_price_cents,
      match_status,match_score,confirmed_at,active,is_modifier,disposition,portion_qty,portion_unit,parent_only)
      values(v_old.location_id,v_menu,v_old.toast_item_guid,v_old.toast_item_name,v_old.toast_price_cents,
        'confirmed',v_old.match_score,now(),true,true,'deplete',1,'whole_sub',v_old.parent_only);
    v_map_count:=v_map_count+1;
  end loop;

  for r in select * from (values('Topo Chico Lime'),('Red Bull'),('Red Bull - Sugar Free')) x(name) loop
    select count(*),(array_agg(id))[1] into v_n,v_menu from public.menu_items where name=r.name;
    if v_n<>1 then raise exception 'seed44: expected one drink %, found %',r.name,v_n; end if;
    update public.menu_items set active=false,updated_at=now() where id=v_menu and active;
    if found then v_drink_count:=v_drink_count+1; end if;
    update public.toast_menu_map set disposition='ignore' where active and match_status='confirmed'
      and menu_item_id=v_menu and disposition is distinct from 'ignore';
    get diagnostics v_n = row_count;
    v_ignore_count:=v_ignore_count+v_n;
  end loop;

  -- Row-level audit of every actual write. Existing audit vocabulary is closed.
  insert into public.audit_log(actor_id,actor_role,action,resource_table,resource_id,destructive,before_state,after_state,metadata)
  select null,null,case when b.id is null then 'vendor_item.create' else 'vendor_item.update' end,
    'vendor_items',x.id,true,b.row,to_jsonb(x),jsonb_build_object('actor_context','seed_44','target',v_target,'reason','Juan catering/retail item ruling')
    from public.vendor_items x left join s44_before b on b.kind='sku' and b.id=x.id
    where b.row is distinct from to_jsonb(x);
  insert into public.audit_log(actor_id,actor_role,action,resource_table,resource_id,destructive,before_state,after_state,metadata)
  select null,null,'vendor_item.price_recorded','vendor_items',x.vendor_item_id,false,null,to_jsonb(x),
    jsonb_build_object('actor_context','seed_44','target',v_target,'reason','Juan: GF roll costs $6.50 each')
    from public.vendor_price_history x left join s44_before b on b.kind='price' and b.id=x.id where b.id is null;
  insert into public.audit_log(actor_id,actor_role,action,resource_table,resource_id,destructive,before_state,after_state,metadata)
  select null,null,case when b.id is null then 'menu_item.create' else 'catering.kb.menu.set_flags' end,
    'menu_items',x.id,(b.id is null),b.row,to_jsonb(x),jsonb_build_object('actor_context','seed_44','target',v_target,'reason','Juan menu/catering item ruling')
    from public.menu_items x left join s44_before b on b.kind='menu' and b.id=x.id where b.row is distinct from to_jsonb(x);
  insert into public.audit_log(actor_id,actor_role,action,resource_table,resource_id,destructive,before_state,after_state,metadata)
  select null,null,case when b.id is null then 'recipe.create' else 'recipe.update' end,
    'recipes',x.id,true,b.row,to_jsonb(x),jsonb_build_object('actor_context','seed_44','target',v_target,'reason','Juan approved build')
    from public.recipes x left join s44_before b on b.kind='recipe' and b.id=x.id where b.row is distinct from to_jsonb(x);
  insert into public.audit_log(actor_id,actor_role,action,resource_table,resource_id,destructive,before_state,after_state,metadata)
  select null,null,'recipe.update','recipe_inputs',x.id,true,b.row,to_jsonb(x),
    jsonb_build_object('actor_context','seed_44','target',v_target,'reason','recipe component for Juan approved build')
    from public.recipe_inputs x left join s44_before b on b.kind='input' and b.id=x.id where b.row is distinct from to_jsonb(x);
  insert into public.audit_log(actor_id,actor_role,action,resource_table,resource_id,destructive,before_state,after_state,metadata)
  select null,null,'recipe.update','recipe_outputs',x.id,true,b.row,to_jsonb(x),
    jsonb_build_object('actor_context','seed_44','target',v_target,'reason','recipe output for Juan approved build')
    from public.recipe_outputs x left join s44_before b on b.kind='output' and b.id=x.id where b.row is distinct from to_jsonb(x);
  insert into public.audit_log(actor_id,actor_role,action,resource_table,resource_id,destructive,before_state,after_state,metadata)
  select null,null,case when not x.active then 'toast_map.unmap' else 'toast_map.manual_map' end,
    'toast_menu_map',x.id,false,b.row,to_jsonb(x),
    jsonb_build_object('actor_context','seed_44','target',v_target,'reason',
      case when not x.active then 'footer map superseded' when x.disposition='ignore' then 'discontinued drink ignored' else 'footer maps to its own recipe' end)
    from public.toast_menu_map x left join s44_before b on b.kind='map' and b.id=x.id where b.row is distinct from to_jsonb(x);

  raise notice 'seed44: source subs %, new footer recipes %, new salad recipes %, new cookie recipes %, GF prices %, footer maps superseded %, drinks deactivated %, drink maps ignored %',
    (select count(*) from s44_bases),v_footer_count,v_salad_count,v_cookie_count,v_price_count,v_map_count,v_drink_count,v_ignore_count;
end $seed44$;
