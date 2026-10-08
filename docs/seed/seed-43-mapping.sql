-- APPLIED 2026-10-07: sim (idempotency re-run inserted nothing) then PROD (seed43.target='prod'); audit actor_context 'seed_43'. Reviewed cross-family (Sol r1 REWORK -> r2 -> all removals staged per Sol r2).
-- =============================================================================
-- Seed 43 — depletion MAPPING SPRINT. Authored 2026-10-07 against prod read-only
-- (main d3034be). AUTHORED, NOT APPLIED. CC applies sim first, then prod after review.
--
-- Management API: send   BEGIN; SET LOCAL seed43.target = 'sim'; <this file>; COMMIT;
-- as ONE query. Production requires the explicit value 'prod'. The guard asserts the
-- value against the real DB (sim carries the maya@sim.co-ops persona, prod does not).
--
-- Idempotent: every insert is NOT-EXISTS guarded; a rerun inserts nothing and supersedes
-- nothing. No deletions. The only UPDATEs: (a) `active = false` on the toast_menu_map
-- rows this seed replaces (the manualMap supersede pattern, lib/admin/toast-map.ts) and
-- (b) the two TODO weight parameters below, only when Juan fills them.
-- Audit: one audit_log row per created / superseded / updated row,
--   metadata.actor_context = 'seed_43', metadata.target = sim|prod (seed-42 shape).
--
-- Groups (README.md has the per-group rationale, counts and the Juan-to-confirm list):
--   G1  District Bakery vendor + GF roll SKU              (Juan answer 4)
--   G2  TODO weights: whole pickle, GF roll               (Juan answers 1, 4)
--   G3  new menu_items (sides, specials, add-ons, modifier builds)
--   G4  consumer recipes for every new item + the mapped-but-no-recipe dead ends
--   G5  portion fixes: Pepperoncini / Dijon / Cholula Mayo (supersede + re-insert)
--   G6  crosswalk rows: every unmapped Toast guid (ledger + menu cache) whose name
--       matches a reviewed rule below, per location. Open-item guids (many names on
--       one guid) are NEVER mapped here — see README "open-item alias" spec.
-- =============================================================================
do $seed43$
declare
  -- ══ PARAMETERS — Juan fills these. NULL = leave unset (never a guess). ══════════
  -- TODO(Juan): weigh ONE whole Boar's Head pickle, in oz.
  --   NULL leaves the "Whole pickles" SKU unweighed, so Deli Pickle, Quart of Pickle
  --   Spears (12pcs) (= 3 whole pickles, recipe already says so) and the "Whole Pickle"
  --   lunch pick stay POISONED — visible in the depletion audit, not invented.
  p_whole_pickle_oz numeric := null;
  -- TODO(Juan): weigh ONE District Bakery gluten-free roll, in oz.
  --   NULL leaves the new GF SKU unweighed: GF modifier applications land in the
  --   portion-needed advisory and the GF add-on menu item stays poisoned until set.
  p_gf_roll_oz numeric := null;
  -- ════════════════════════════════════════════════════════════════════════════════
  v_target text := current_setting('seed43.target', true);
  v_vendor uuid;
  v_gf_sku uuid;
  v_id uuid;
  v_mi uuid;
  v_recipe uuid;
  v_target_id uuid;
  v_sup uuid[];
  v_rec record;
  v_c record;
  v_m record;
  v_n integer;
  v_before numeric;
  v_inputs jsonb;
  v_new_portion numeric;
  v_new_unit text;
  v_skipped_sales_only integer := 0;
  v_skipped_parent integer := 0;
  v_skipped_no_package integer := 0;
  v_inserted integer := 0;
begin
  -- ── Target guard (seed-42 shape) ──────────────────────────────────────────────
  if v_target is null or v_target not in ('sim', 'prod') then
    raise exception 'set seed43.target explicitly to sim or prod';
  end if;
  if exists (select 1 from public.users where email = 'maya@sim.co-ops') is distinct from (v_target = 'sim') then
    raise exception 'seed43 target % does not match database sim persona marker', v_target;
  end if;
  if p_whole_pickle_oz is not null and not (p_whole_pickle_oz > 0 and p_whole_pickle_oz < 32) then
    raise exception 'p_whole_pickle_oz % out of range', p_whole_pickle_oz;
  end if;
  if p_gf_roll_oz is not null and not (p_gf_roll_oz > 0 and p_gf_roll_oz < 32) then
    raise exception 'p_gf_roll_oz % out of range', p_gf_roll_oz;
  end if;
  -- One writer at a time on the crosswalk (admin manualMap/confirm race).
  lock table public.toast_menu_map in share row exclusive mode;

  -- ── Every referenced pre-existing row must exist and be active ────────────────
  for v_rec in select * from (values
    ('item','84ccaf84-ed35-4031-bb88-e19536042bd5'::uuid,'Fresh Mozzarella'),
    ('item','ec9a2e5a-3e44-4acb-82ec-757ad5ee83b2','Tomato'),
    ('item','51d6f933-fa06-450e-838c-c84636af639f','Basil'),
    ('item','3b68e653-41c5-488e-a02d-73379c7bb628','Vin'),
    ('item','7206485d-5b37-4f44-bfe6-5211480d6ce0','Iceberg'),
    ('item','06c1a1b4-a51e-49a8-917a-2ebf6e844205','Caesar Dressing'),
    ('item','9ab0cf35-8517-457c-92ac-5b4a9192de0f','Compound Butter'),
    ('item','1dd7cc14-e8ee-48ec-b023-860449ba2ec6','Bacon'),
    ('item','f22d8360-43b8-4ae0-b763-1607b33acc71','Turkey'),
    ('item','1f27d888-a7c4-460b-8951-6b0be8454c6b','Egg Salad'),
    ('item','403d2e13-d22a-4d05-9196-74aeba2f98d7','Tuna Salad'),
    ('item','08fa8979-c9dc-41f9-904f-9680289d0437','Chix Salad'),
    ('item','b70c0e71-37fc-460d-aeeb-892eb1ecf23f','Marinara'),
    ('item','1f21235e-94d7-426b-8033-91c2d4b3b5e9','Onion Dip'),
    ('item','cc5ee143-5b2c-44ec-a881-f75f053fcc10','Antipasto Pasta'),
    ('item','f5b6346c-cb2d-402d-b056-50c25fe0be5a','Cucumber'),
    ('item','7c98cec9-88de-44a1-aa29-11c47f30c894','Radish'),
    ('item','7a146518-cbfb-43b7-b42e-1e8afcd001af','Onion'),
    ('item','0a126698-4f3b-40e2-8086-8322205b2313','Provolone'),
    ('item','97a0630a-801b-4e01-a8a6-4e3a3353fa4e','Cheddar'),
    ('item','4254142a-3185-472d-b54a-8d3011b8815d','Genoa'),
    ('item','6a44a662-f1c2-4aa0-ac1e-77fba1d38e0f','Ham'),
    ('item','2239bae2-43d7-49f2-bd3a-3561887337db','Capicola'),
    ('item','f7731046-5b83-4a51-8754-dc792d5780ae','Pepperoni'),
    ('item','a4f0e7ea-f1d4-4a82-b917-4973322f11d2','Roast Beef'),
    ('item','76e16396-40ed-43b7-936c-9770b60509e3','Cannoli Cream'),
    ('item','409df181-b2d2-479a-ba7a-c4789c989358','HP Mayo'),
    ('item','f661f4f1-426a-4920-8163-44f72f393542','Salsa Verde'),
    ('item','ef6d5243-e353-4ca0-bbaa-a9115e9482ac','Dukes'),
    ('item','a060cfa7-dbb6-4669-bbef-e170492aaa1f','Aioli'),
    ('item','d98614a2-0ba8-4d01-9e65-4fc056645fc3','HC Aioli'),
    ('item','9195bf47-4a74-466b-97f7-27718fbb79bb','Hot Peppers'),
    ('sku','508ae1c1-6648-4e87-8941-3b3a35e085b9','Oregano'),
    ('sku','9478c3e2-868e-444f-95f4-009a7b3b507b','Sub Roll'),
    ('sku','0428489d-a980-4389-aace-3abd7c4d0a86','Parmesan (Grated)'),
    ('sku','699f17e1-2bc7-4216-a906-4b9e0ecd9094','Black peppercorn'),
    ('sku','4390b5b3-c59e-4d8f-804e-35570e1aef84','Utz Ripples'),
    ('sku','38000000-0000-5000-a000-000000000002','Utz Mini Chips (1 oz)'),
    ('sku','3005af1a-6f7d-4b9e-96e9-18323b279a6f','Utz Original'),
    ('sku','01e246aa-cd09-4949-8edc-1475b8f2710f','Utz BBQ'),
    ('sku','03b88130-165f-46a6-98a9-9341842bed9d','Utz Salt & Vinegar'),
    ('sku','21a905e8-ad70-45b8-ba97-f2509dbaed2b','Utz Salt & Pepper'),
    ('sku','ec934453-3d5a-4826-9ca9-6b8b86c6c7b9','Utz Sour Cream & Onion'),
    ('sku','9a4de7a1-fc04-4eab-a09a-97c564fc8698','Coke'),
    ('sku','23f9a85e-afca-4146-8b7e-cd2a0bec2f48','Diet Coke'),
    ('sku','7d0481f5-df88-49f2-addb-ff96c7cc1024','Prosciutto'),
    ('sku','fa14310e-aaa0-4376-be09-09a39f49ddab','Arugula'),
    ('sku','16a0089c-a714-422c-a3fc-6921436c88b0','Ever Roast Chicken'),
    ('sku','a58b7f10-5006-4a3a-98b2-0bda57424ac4','Fusilli Pasta'),
    ('sku','b99206db-21b4-4349-b69a-aac7bd2a69df','Olive Oil'),
    ('sku','5996f84f-5feb-4f0e-8241-9aab3b3cc6fe','Basil'),
    ('sku','d4b03398-d04f-4551-8c3b-517aac7b910b','Garlic'),
    ('sku','2f71d6db-919f-48d6-8da4-62e95335023f','Cannoli Shell'),
    ('sku','8b1a5799-8ace-47c2-ab54-73d940288989','Fruity Pebbles'),
    ('sku','a72ea2c4-1063-4d4c-8bcc-7a47bad3e10b','Whole pickles'),
    ('sku','55c0a2c4-cef8-4afe-863c-de7f45d526a2','Pepperoncini'),
    ('sku','dbff905e-1086-43f5-bc07-f05bcadd0eb6','Mustard (Dijon)'),
    ('product','62b825d6-b992-48e1-9fec-2e635ed5c026','Banana Peppers')
  ) as r(kind, id, label) loop
    if v_rec.kind = 'item' and not exists (select 1 from public.items where id = v_rec.id and active and name = v_rec.label) then
      raise exception 'seed43: active item % (%) missing', v_rec.label, v_rec.id;
    elsif v_rec.kind = 'sku' and not exists (select 1 from public.vendor_items where id = v_rec.id and active and name = v_rec.label) then
      raise exception 'seed43: active SKU % (%) missing', v_rec.label, v_rec.id;
    elsif v_rec.kind = 'product' and not exists (select 1 from public.products where id = v_rec.id and active and name = v_rec.label) then
      raise exception 'seed43: active product % (%) missing', v_rec.label, v_rec.id;
    end if;
  end loop;

  -- ══ G1 — District Bakery vendor + GF roll SKU (price NULL; TODO Juan) ═══════════
  select id into v_vendor from public.vendors
   where lower(btrim(name)) = 'district bakery' and source_kind = 'vendor' order by active desc, created_at limit 1;
  if v_vendor is null then
    insert into public.vendors (name, category, notes, active, source_kind, transmission_tier, created_by)
    values ('District Bakery', 'Bakery',
      'Gluten-free bread/rolls (expensive). Created by seed 43 on Juan''s word 2026-10-07. TODO(Juan): contact, ordering days, account.',
      true, 'vendor', 'manual', null)
    returning id into v_vendor;
    insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
    values (null, null, 'vendor.create', 'vendors', v_vendor, true,
      jsonb_build_object('actor_context','seed_43','target',v_target,'name','District Bakery','reason','GF bread vendor (Juan 2026-10-07)'));
  end if;
  select id into v_gf_sku from public.vendor_items
   where vendor_id = v_vendor and name = 'Gluten Free Roll (District Bakery)' order by active desc, created_at limit 1;
  if v_gf_sku is null then
    insert into public.vendor_items (vendor_id, name, sku_class, pack_format, units_per_pack, each_size, each_measure,
        avg_oz_per_each, weight_class, weight_source_note, weight_established_at, notes, active, created_by)
    values (v_vendor, 'Gluten Free Roll (District Bakery)', 'raw', 'Each', 1, 1, 'count',
        p_gf_roll_oz,
        case when p_gf_roll_oz is not null then 'OPERATIONAL' end,
        case when p_gf_roll_oz is not null then 'Juan weighed one District Bakery GF roll (seed 43)' end,
        case when p_gf_roll_oz is not null then now() end,
        'Seed 43 (Juan 2026-10-07): the GF roll for every GF swap/add. TODO(Juan): price (expensive) and weight (p_gf_roll_oz). The older "Gluten Free Bread" SKU under vendor "Sarah" is left untouched pending Juan.',
        true, null)
    returning id into v_gf_sku;
    insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
    values (null, null, 'vendor_item.create', 'vendor_items', v_gf_sku, true,
      jsonb_build_object('actor_context','seed_43','target',v_target,'name','Gluten Free Roll (District Bakery)',
        'vendor_id',v_vendor,'avg_oz_per_each',p_gf_roll_oz,'price','TODO(Juan) — no price row written'));
  end if;

  -- ══ G2 — TODO weights (only when Juan filled the parameter) ═════════════════════
  if p_whole_pickle_oz is not null then
    select avg_oz_per_each into v_before from public.vendor_items where id = 'a72ea2c4-1063-4d4c-8bcc-7a47bad3e10b';
    if v_before is null then
      update public.vendor_items
         set avg_oz_per_each = p_whole_pickle_oz, weight_class = 'OPERATIONAL',
             weight_source_note = 'Juan weighed one whole pickle (seed 43). A quart of spears = 3 whole pickles.',
             weight_established_at = now(), updated_at = now()
       where id = 'a72ea2c4-1063-4d4c-8bcc-7a47bad3e10b' and avg_oz_per_each is null;
      get diagnostics v_n = row_count;
      if v_n <> 1 then raise exception 'seed43: whole pickle weight update hit % rows', v_n; end if;
      insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, before_state, after_state, metadata)
      values (null, null, 'vendor_item.update', 'vendor_items', 'a72ea2c4-1063-4d4c-8bcc-7a47bad3e10b', true,
        jsonb_build_object('avg_oz_per_each', null), jsonb_build_object('avg_oz_per_each', p_whole_pickle_oz),
        jsonb_build_object('actor_context','seed_43','target',v_target,'field','avg_oz_per_each','reason','Juan weighed one whole pickle'));
    end if;
  else
    raise notice 'seed43: p_whole_pickle_oz is NULL — Whole pickles stays unweighed (TODO Juan)';
  end if;
  if p_gf_roll_oz is not null then
    select avg_oz_per_each into v_before from public.vendor_items where id = v_gf_sku;
    if v_before is null then
      update public.vendor_items
         set avg_oz_per_each = p_gf_roll_oz, weight_class = 'OPERATIONAL',
             weight_source_note = 'Juan weighed one District Bakery GF roll (seed 43)',
             weight_established_at = now(), updated_at = now()
       where id = v_gf_sku and avg_oz_per_each is null;
      insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, before_state, after_state, metadata)
      values (null, null, 'vendor_item.update', 'vendor_items', v_gf_sku, true,
        jsonb_build_object('avg_oz_per_each', null), jsonb_build_object('avg_oz_per_each', p_gf_roll_oz),
        jsonb_build_object('actor_context','seed_43','target',v_target,'field','avg_oz_per_each','reason','Juan weighed one GF roll'));
    end if;
  else
    raise notice 'seed43: p_gf_roll_oz is NULL — GF roll stays unweighed (TODO Juan)';
  end if;

  -- ══ G3 — new menu_items ═════════════════════════════════════════════════════════
  -- catering_available/catering_only stay FALSE on purpose: surfacing an item on the
  -- customer catering portal is a product decision, not a depletion one (README).
  for v_rec in select * from (values
    ('Caprese',                                 'Subs',            13.49),
    ('Chicken Bacon Caesar Sub',                'Subs',            18.99),
    ('Chicken Bacon Pesto Pasta',               'Sides',            7.00),
    ('Egg Salad- 1/2 pint',                     'Sides',            4.25),
    ('Tuna Salad 1/2 Pint',                     'Sides',            4.25),
    ('Whole Grain Chicken Salad',               'Sides',            7.50),
    ('Side Marinara Sauce',                     'Sides',            3.50),
    ('Large Anti Pasta Salad (32oz)',           'Catering Sides',  16.00),
    ('Large French Onion Dip (32oz)',           'Catering Sides',  20.00),
    ('Large French Onion Dip (16oz)',           'Catering Sides',  null),
    ('Large Tuna Salad (32oz)',                 'Catering Sides',  18.00),
    ('Large Egg Salad (32oz)',                  'Catering Sides',  16.00),
    ('Fruity Pebble Cannoli (single)',          'Sweets',           2.00),
    ('Gluten Free Roll (District Bakery)',      'Add-ons',          6.50),
    ('Add Turkey (add-on)',                     'Add-ons',          null),
    ('Add Ham (add-on)',                        'Add-ons',          null),
    ('Add Salami (add-on)',                     'Add-ons',          null),
    ('Add Pepperoni (add-on)',                  'Add-ons',          null),
    ('Add Roast Beef (add-on)',                 'Add-ons',          null),
    ('Add Prosciutto (add-on)',                 'Add-ons',          null),
    ('Add Bacon (add-on)',                      'Add-ons',          null),
    ('Add Fresh Mozz (add-on)',                 'Add-ons',          null),
    ('Put Chips In It (add-on)',                'Add-ons',          0.75),
    ('Cheesy Boi filling (modifier build)',     'Modifier builds',  null),
    ('Double Meat - Teamster (modifier build)', 'Modifier builds',  null)
  ) as m(name, section, price) loop
    if exists (select 1 from public.menu_items where lower(btrim(name)) = lower(btrim(v_rec.name)) and active) then continue; end if;
    insert into public.menu_items (name, section, menu_price, active, catering_available, catering_only, catering_portionable, seasonal, created_by)
    values (v_rec.name, v_rec.section, v_rec.price, true, false, false, false, false, null)
    returning id into v_id;
    insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
    values (null, null, 'menu_item.create', 'menu_items', v_id, true,
      jsonb_build_object('actor_context','seed_43','target',v_target,'name',v_rec.name,'section',v_rec.section,'menu_price',v_rec.price));
  end loop;

  -- ══ G4 — consumer recipes (batch_yield 1, one menu_item output, yield 1) ═══════
  -- kind: item | sku | product | gf (= the District Bakery GF SKU from G1).
  -- Units follow the live graph rules: item lines in oz (weight-honest) or each
  -- (count = par units); SKU lines in oz / fl oz / each / handful.
  create temp table s43_recipe_lines (
    recipe_name text, menu_item_name text, approximate boolean, ord integer,
    kind text, comp uuid, qty numeric, unit text
  ) on commit drop;
  insert into s43_recipe_lines values
    -- Caprese (Toast: "Fresh Mozzarella, Tomato, Basil"; MEP's "Tomato & Mozz Sandwich" maps here too)
    ('Caprese (build — approximate)','Caprese',true,0,'item','84ccaf84-ed35-4031-bb88-e19536042bd5',3,'oz'),
    ('Caprese (build — approximate)','Caprese',true,1,'item','ec9a2e5a-3e44-4acb-82ec-757ad5ee83b2',1.875,'oz'),
    ('Caprese (build — approximate)','Caprese',true,2,'item','51d6f933-fa06-450e-838c-c84636af639f',0.068,'oz'),
    ('Caprese (build — approximate)','Caprese',true,3,'item','3b68e653-41c5-488e-a02d-73379c7bb628',0.25,'oz'),
    ('Caprese (build — approximate)','Caprese',true,4,'sku','508ae1c1-6648-4e87-8941-3b3a35e085b9',0.1,'oz'),
    ('Caprese (build — approximate)','Caprese',true,5,'sku','9478c3e2-868e-444f-95f4-009a7b3b507b',1,'each'),
    -- Chicken Bacon Caesar Sub (Toast: chicken breast, bacon, iceberg, caesar, garlic crouton roll) — Turkey Caesar build with chicken + bacon
    ('Chicken Bacon Caesar Sub (build — approximate)','Chicken Bacon Caesar Sub',true,0,'sku','16a0089c-a714-422c-a3fc-6921436c88b0',4,'oz'),
    ('Chicken Bacon Caesar Sub (build — approximate)','Chicken Bacon Caesar Sub',true,1,'item','1dd7cc14-e8ee-48ec-b023-860449ba2ec6',2,'each'),
    ('Chicken Bacon Caesar Sub (build — approximate)','Chicken Bacon Caesar Sub',true,2,'item','7206485d-5b37-4f44-bfe6-5211480d6ce0',3.4,'oz'),
    ('Chicken Bacon Caesar Sub (build — approximate)','Chicken Bacon Caesar Sub',true,3,'item','06c1a1b4-a51e-49a8-917a-2ebf6e844205',2,'oz'),
    ('Chicken Bacon Caesar Sub (build — approximate)','Chicken Bacon Caesar Sub',true,4,'item','9ab0cf35-8517-457c-92ac-5b4a9192de0f',0.5,'oz'),
    ('Chicken Bacon Caesar Sub (build — approximate)','Chicken Bacon Caesar Sub',true,5,'sku','0428489d-a980-4389-aace-3abd7c4d0a86',0.2,'oz'),
    ('Chicken Bacon Caesar Sub (build — approximate)','Chicken Bacon Caesar Sub',true,6,'sku','699f17e1-2bc7-4216-a906-4b9e0ecd9094',0.02,'oz'),
    ('Chicken Bacon Caesar Sub (build — approximate)','Chicken Bacon Caesar Sub',true,7,'sku','9478c3e2-868e-444f-95f4-009a7b3b507b',1,'each'),
    -- Chicken Bacon Pesto Pasta ($7 side, no Toast description; pesto ratios from ALL-RECIPES "Turkey Pesto")
    ('Chicken Bacon Pesto Pasta (build — approximate)','Chicken Bacon Pesto Pasta',true,0,'sku','a58b7f10-5006-4a3a-98b2-0bda57424ac4',2.5,'oz'),
    ('Chicken Bacon Pesto Pasta (build — approximate)','Chicken Bacon Pesto Pasta',true,1,'sku','16a0089c-a714-422c-a3fc-6921436c88b0',2,'oz'),
    ('Chicken Bacon Pesto Pasta (build — approximate)','Chicken Bacon Pesto Pasta',true,2,'item','1dd7cc14-e8ee-48ec-b023-860449ba2ec6',1,'each'),
    ('Chicken Bacon Pesto Pasta (build — approximate)','Chicken Bacon Pesto Pasta',true,3,'sku','5996f84f-5feb-4f0e-8241-9aab3b3cc6fe',0.2,'oz'),
    ('Chicken Bacon Pesto Pasta (build — approximate)','Chicken Bacon Pesto Pasta',true,4,'sku','fa14310e-aaa0-4376-be09-09a39f49ddab',0.2,'oz'),
    ('Chicken Bacon Pesto Pasta (build — approximate)','Chicken Bacon Pesto Pasta',true,5,'sku','d4b03398-d04f-4551-8c3b-517aac7b910b',0.08,'oz'),
    ('Chicken Bacon Pesto Pasta (build — approximate)','Chicken Bacon Pesto Pasta',true,6,'sku','0428489d-a980-4389-aace-3abd7c4d0a86',0.1,'oz'),
    ('Chicken Bacon Pesto Pasta (build — approximate)','Chicken Bacon Pesto Pasta',true,7,'sku','b99206db-21b4-4349-b69a-aac7bd2a69df',0.4,'oz'),
    -- Sides: Juan "all sides are 6oz… the larger catering sides are 32oz" (Side Marinara = 4 oz, Juan r2)
    ('Egg Salad- 1/2 pint (build)','Egg Salad- 1/2 pint',false,0,'item','1f27d888-a7c4-460b-8951-6b0be8454c6b',6,'oz'),
    ('Tuna Salad 1/2 Pint (build)','Tuna Salad 1/2 Pint',false,0,'item','403d2e13-d22a-4d05-9196-74aeba2f98d7',6,'oz'),
    ('Whole Grain Chicken Salad (build)','Whole Grain Chicken Salad',false,0,'item','08fa8979-c9dc-41f9-904f-9680289d0437',6,'oz'),
    ('Side Marinara Sauce (build)','Side Marinara Sauce',false,0,'item','b70c0e71-37fc-460d-aeeb-892eb1ecf23f',4,'oz'),  -- Juan r2: 4 oz (Toast is right; exception to the 6 oz rule)
    -- Antipasto Pasta's par unit is one 8 oz side (sell_portion; the live side mapping) → 32 oz = 4 par units
    ('Large Anti Pasta Salad (32oz) (build)','Large Anti Pasta Salad (32oz)',false,0,'item','cc5ee143-5b2c-44ec-a881-f75f053fcc10',4,'each'),
    ('Large French Onion Dip (32oz) (build)','Large French Onion Dip (32oz)',false,0,'item','1f21235e-94d7-426b-8033-91c2d4b3b5e9',32,'oz'),
    -- Juan r2: Toast has ONE large button (mapped to 32 oz); the 16 oz item is created for later, unmapped.
    ('Large French Onion Dip (16oz) (build)','Large French Onion Dip (16oz)',false,0,'item','1f21235e-94d7-426b-8033-91c2d4b3b5e9',16,'oz'),
    ('Large Tuna Salad (32oz) (build)','Large Tuna Salad (32oz)',false,0,'item','403d2e13-d22a-4d05-9196-74aeba2f98d7',32,'oz'),
    ('Large Egg Salad (32oz) (build)','Large Egg Salad (32oz)',false,0,'item','1f27d888-a7c4-460b-8951-6b0be8454c6b',32,'oz'),
    -- Cannoli (house build: shell + Cannoli Cream + Fruity Pebbles); "Cannolis" ($4) = 2 × single ($2)
    ('Fruity Pebble Cannoli (single) (build — approximate)','Fruity Pebble Cannoli (single)',true,0,'sku','2f71d6db-919f-48d6-8da4-62e95335023f',1,'each'),
    ('Fruity Pebble Cannoli (single) (build — approximate)','Fruity Pebble Cannoli (single)',true,1,'item','76e16396-40ed-43b7-936c-9770b60509e3',1,'oz'),
    ('Fruity Pebble Cannoli (single) (build — approximate)','Fruity Pebble Cannoli (single)',true,2,'sku','8b1a5799-8ace-47c2-ab54-73d940288989',0.1,'oz'),
    ('Fruity Pebble Cannolis (build — approximate)','Fruity Pebble Cannolis',true,0,'sku','2f71d6db-919f-48d6-8da4-62e95335023f',2,'each'),
    ('Fruity Pebble Cannolis (build — approximate)','Fruity Pebble Cannolis',true,1,'item','76e16396-40ed-43b7-936c-9770b60509e3',2,'oz'),
    ('Fruity Pebble Cannolis (build — approximate)','Fruity Pebble Cannolis',true,2,'sku','8b1a5799-8ace-47c2-ab54-73d940288989',0.2,'oz'),
    -- GF roll rung as its own line (poisoned until p_gf_roll_oz is set — honest, visible)
    ('Gluten Free Roll (District Bakery) (build)','Gluten Free Roll (District Bakery)',false,0,'gf',null,1,'each'),
    -- Add-ons rung as base lines; portions = the app's own derivePortion over the signature builds
    ('Add Turkey (add-on) (build)','Add Turkey (add-on)',false,0,'item','f22d8360-43b8-4ae0-b763-1607b33acc71',4,'oz'),
    ('Add Ham (add-on) (build)','Add Ham (add-on)',false,0,'item','6a44a662-f1c2-4aa0-ac1e-77fba1d38e0f',3.6,'oz'),
    ('Add Salami (add-on) (build)','Add Salami (add-on)',false,0,'item','4254142a-3185-472d-b54a-8d3011b8815d',1.6,'oz'),
    ('Add Pepperoni (add-on) (build)','Add Pepperoni (add-on)',false,0,'item','f7731046-5b83-4a51-8754-dc792d5780ae',1,'oz'),
    ('Add Roast Beef (add-on) (build)','Add Roast Beef (add-on)',false,0,'item','a4f0e7ea-f1d4-4a82-b917-4973322f11d2',5,'oz'),
    ('Add Prosciutto (add-on) (build)','Add Prosciutto (add-on)',false,0,'sku','7d0481f5-df88-49f2-addb-ff96c7cc1024',2,'each'),
    ('Add Bacon (add-on) (build)','Add Bacon (add-on)',false,0,'item','1dd7cc14-e8ee-48ec-b023-860449ba2ec6',2.5,'each'),
    ('Add Fresh Mozz (add-on) (build)','Add Fresh Mozz (add-on)',false,0,'item','84ccaf84-ed35-4031-bb88-e19536042bd5',3,'oz'),
    ('Put Chips In It (add-on) (build)','Put Chips In It (add-on)',false,0,'sku','4390b5b3-c59e-4d8f-804e-35570e1aef84',1,'handful'),
    -- Modifier builds (one modifier that touches several items)
    ('Cheesy Boi filling (modifier build — approximate)','Cheesy Boi filling (modifier build)',true,0,'item','84ccaf84-ed35-4031-bb88-e19536042bd5',2,'oz'),
    ('Cheesy Boi filling (modifier build — approximate)','Cheesy Boi filling (modifier build)',true,1,'item','0a126698-4f3b-40e2-8086-8322205b2313',1.4,'oz'),
    ('Cheesy Boi filling (modifier build — approximate)','Cheesy Boi filling (modifier build)',true,2,'item','97a0630a-801b-4e01-a8a6-4e3a3353fa4e',0.8,'oz'),
    ('Double Meat - Teamster (modifier build)','Double Meat - Teamster (modifier build)',false,0,'item','6a44a662-f1c2-4aa0-ac1e-77fba1d38e0f',3.6,'oz'),
    ('Double Meat - Teamster (modifier build)','Double Meat - Teamster (modifier build)',false,1,'item','2239bae2-43d7-49f2-bd3a-3561887337db',1.2,'oz'),
    ('Double Meat - Teamster (modifier build)','Double Meat - Teamster (modifier build)',false,2,'item','4254142a-3185-472d-b54a-8d3011b8815d',1.6,'oz'),
    -- Dead ends: mapped menu items that had no recipe
    ('Garlic Bread (build — approximate)','Garlic Bread',true,0,'sku','9478c3e2-868e-444f-95f4-009a7b3b507b',1,'each'),
    ('Garlic Bread (build — approximate)','Garlic Bread',true,1,'item','9ab0cf35-8517-457c-92ac-5b4a9192de0f',1,'oz'),
    ('Garlic Bread (build — approximate)','Garlic Bread',true,2,'sku','0428489d-a980-4389-aace-3abd7c4d0a86',0.2,'oz'),
    -- Bacon Caesar Pasta Salad (Toast: bacon, pasta, caesar dressing, garlic crouton, parm). Base unit = 8 oz; "Medium (16oz)" adds +1 unit.
    ('Bacon Caesar Pasta Salad (build — approximate, 8 oz unit)','Bacon Caesar Pasta Salad',true,0,'sku','a58b7f10-5006-4a3a-98b2-0bda57424ac4',2.5,'oz'),
    ('Bacon Caesar Pasta Salad (build — approximate, 8 oz unit)','Bacon Caesar Pasta Salad',true,1,'item','1dd7cc14-e8ee-48ec-b023-860449ba2ec6',2,'each'),
    ('Bacon Caesar Pasta Salad (build — approximate, 8 oz unit)','Bacon Caesar Pasta Salad',true,2,'item','06c1a1b4-a51e-49a8-917a-2ebf6e844205',1.5,'oz'),
    ('Bacon Caesar Pasta Salad (build — approximate, 8 oz unit)','Bacon Caesar Pasta Salad',true,3,'sku','0428489d-a980-4389-aace-3abd7c4d0a86',0.25,'oz'),
    ('Bacon Caesar Pasta Salad (build — approximate, 8 oz unit)','Bacon Caesar Pasta Salad',true,4,'sku','9478c3e2-868e-444f-95f4-009a7b3b507b',0.25,'each'),
    ('Bacon Caesar Pasta Salad (build — approximate, 8 oz unit)','Bacon Caesar Pasta Salad',true,5,'item','9ab0cf35-8517-457c-92ac-5b4a9192de0f',0.25,'oz'),
    -- House Greek Salad (Toast: 64 oz; iceberg, arugula, cucumber, banana peppers, red onion, radish, parm, vinaigrette on the side)
    ('House Greek Salad (build — approximate, 64 oz)','House Greek Salad',true,0,'item','7206485d-5b37-4f44-bfe6-5211480d6ce0',24,'oz'),
    ('House Greek Salad (build — approximate, 64 oz)','House Greek Salad',true,1,'sku','fa14310e-aaa0-4376-be09-09a39f49ddab',8,'oz'),
    ('House Greek Salad (build — approximate, 64 oz)','House Greek Salad',true,2,'item','f5b6346c-cb2d-402d-b056-50c25fe0be5a',10,'oz'),
    ('House Greek Salad (build — approximate, 64 oz)','House Greek Salad',true,3,'product','62b825d6-b992-48e1-9fec-2e635ed5c026',4,'oz'),
    ('House Greek Salad (build — approximate, 64 oz)','House Greek Salad',true,4,'item','7a146518-cbfb-43b7-b42e-1e8afcd001af',2,'oz'),
    ('House Greek Salad (build — approximate, 64 oz)','House Greek Salad',true,5,'item','7c98cec9-88de-44a1-aa29-11c47f30c894',4,'oz'),
    ('House Greek Salad (build — approximate, 64 oz)','House Greek Salad',true,6,'sku','0428489d-a980-4389-aace-3abd7c4d0a86',2,'oz'),
    ('House Greek Salad (build — approximate, 64 oz)','House Greek Salad',true,7,'item','3b68e653-41c5-488e-a02d-73379c7bb628',4,'oz'),
    -- Caesar Salad (catering "Caesar Sal(ad)", $12; no source)
    ('Caesar Salad (build — approximate)','Caesar Salad',true,0,'item','7206485d-5b37-4f44-bfe6-5211480d6ce0',32,'oz'),
    ('Caesar Salad (build — approximate)','Caesar Salad',true,1,'item','06c1a1b4-a51e-49a8-917a-2ebf6e844205',4,'oz'),
    ('Caesar Salad (build — approximate)','Caesar Salad',true,2,'sku','0428489d-a980-4389-aace-3abd7c4d0a86',1,'oz'),
    ('Caesar Salad (build — approximate)','Caesar Salad',true,3,'sku','9478c3e2-868e-444f-95f4-009a7b3b507b',0.5,'each'),
    ('Caesar Salad (build — approximate)','Caesar Salad',true,4,'item','9ab0cf35-8517-457c-92ac-5b4a9192de0f',0.5,'oz'),
    -- Retail 1:1 links (Juan answer 2)
    ('Mini Chips- Utz Original (build)','Mini Chips- Utz Original',false,0,'sku','38000000-0000-5000-a000-000000000002',1,'oz'),
    ('Case of Mini Chips (24) (build)','Case of Mini Chips (24)',false,0,'sku','38000000-0000-5000-a000-000000000002',24,'oz'),
    ('Case of Assorted Chips (24) (build — approximate even mix)','Case of Assorted Chips (24)',true,0,'sku','3005af1a-6f7d-4b9e-96e9-18323b279a6f',13.2,'oz'),
    ('Case of Assorted Chips (24) (build — approximate even mix)','Case of Assorted Chips (24)',true,1,'sku','01e246aa-cd09-4949-8edc-1475b8f2710f',13.2,'oz'),
    ('Case of Assorted Chips (24) (build — approximate even mix)','Case of Assorted Chips (24)',true,2,'sku','03b88130-165f-46a6-98a9-9341842bed9d',13.2,'oz'),
    ('Case of Assorted Chips (24) (build — approximate even mix)','Case of Assorted Chips (24)',true,3,'sku','21a905e8-ad70-45b8-ba97-f2509dbaed2b',13.2,'oz'),
    ('Case of Assorted Chips (24) (build — approximate even mix)','Case of Assorted Chips (24)',true,4,'sku','ec934453-3d5a-4826-9ca9-6b8b86c6c7b9',13.2,'oz'),
    ('24 Mixed Sodas (build — approximate)','24 Mixed Sodas',true,0,'sku','9a4de7a1-fc04-4eab-a09a-97c564fc8698',144,'fl oz'),
    ('24 Mixed Sodas (build — approximate)','24 Mixed Sodas',true,1,'sku','23f9a85e-afca-4146-8b7e-cd2a0bec2f48',144,'fl oz');

  for v_rec in select recipe_name, menu_item_name, bool_or(approximate) approximate
               from s43_recipe_lines group by recipe_name, menu_item_name order by menu_item_name loop
    select id into v_mi from public.menu_items where name = v_rec.menu_item_name and active order by created_at limit 1;
    if v_mi is null then raise exception 'seed43: menu item % missing for recipe %', v_rec.menu_item_name, v_rec.recipe_name; end if;
    -- Skip if ANY active recipe already outputs this menu item (never a dual producer) or the name exists.
    if exists (select 1 from public.recipe_outputs ro join public.recipes r on r.id = ro.recipe_id
               where ro.output_menu_item_id = v_mi and r.active)
       or exists (select 1 from public.recipes where name = v_rec.recipe_name and active) then
      continue;
    end if;
    insert into public.recipes (name, recipe_type, batch_yield, active, notes, created_by)
    values (v_rec.recipe_name, 'consumer', 1, true,
      case when v_rec.approximate
        then 'Seed 43 (2026-10-07): APPROXIMATE build — no written source; see seed43 README. Juan to confirm.'
        else 'Seed 43 (2026-10-07): built from Juan''s 2026-10-07 answers / existing builds.' end,
      null)
    returning id into v_recipe;
    insert into public.recipe_outputs (recipe_id, output_menu_item_id, yield, display_order)
    values (v_recipe, v_mi, 1, 0);
    insert into public.recipe_inputs (recipe_id, component_sku_id, component_item_id, component_product_id, quantity, unit, display_order)
    select v_recipe,
           case l.kind when 'sku' then l.comp when 'gf' then v_gf_sku end,
           case when l.kind = 'item' then l.comp end,
           case when l.kind = 'product' then l.comp end,
           l.qty, l.unit, l.ord
      from s43_recipe_lines l
     where l.recipe_name = v_rec.recipe_name
     order by l.ord;
    select jsonb_agg(jsonb_build_object('kind',l.kind,'id',coalesce(l.comp, v_gf_sku),'qty',l.qty,'unit',l.unit) order by l.ord)
      into v_inputs from s43_recipe_lines l where l.recipe_name = v_rec.recipe_name;
    insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
    values (null, null, 'recipe.create', 'recipes', v_recipe, true,
      jsonb_build_object('actor_context','seed_43','target',v_target,'name',v_rec.recipe_name,
        'recipe_type','consumer','output_menu_item_id',v_mi,'output_menu_item',v_rec.menu_item_name,
        'approximate',v_rec.approximate,'inputs',v_inputs));
  end loop;

  -- ══ G5 — portion fixes (Juan answer 1): supersede + re-insert, manualMap pattern ═
  for v_m in
    select m.* from public.toast_menu_map m
     where m.active and m.match_status = 'confirmed' and m.is_modifier
       and ( (lower(btrim(m.toast_item_name)) = 'pepperoncini'  and m.sku_id  = '55c0a2c4-cef8-4afe-863c-de7f45d526a2' and m.portion_unit is distinct from 'oz')
          or (lower(btrim(m.toast_item_name)) = 'dijon mustard' and m.sku_id  = 'dbff905e-1086-43f5-bc07-f05bcadd0eb6' and m.portion_unit is distinct from 'oz')
          or (lower(btrim(m.toast_item_name)) = 'cholula mayo'  and m.item_id = '409df181-b2d2-479a-ba7a-c4789c989358' and m.portion_qty is null) )
     order by m.location_id, m.toast_item_name, m.toast_item_guid
  loop
    -- Pepperoncini "gets picked just like" hot peppers → the Hot Peppers modifier portion (0.25 oz).
    -- Dijon "weighs about the same as the other sauces" → the sibling sauce modifier portion (1 oz:
    --   Dukes / Mustard Aioli / HC Aioli / Extra Mayo are all 1 oz on live rows).
    -- Cholula Mayo = HP Mayo (already the target) → the same 1 oz sauce portion.
    v_new_portion := case when v_m.sku_id = '55c0a2c4-cef8-4afe-863c-de7f45d526a2' then 0.25 else 1 end;
    v_new_unit := 'oz';
    update public.toast_menu_map set active = false where id = v_m.id and active;
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'seed43: concurrent change on map row %', v_m.id; end if;
    insert into public.toast_menu_map (location_id, menu_item_id, item_id, package_id, sku_id, toast_item_guid, toast_item_name,
        toast_price_cents, match_status, match_score, confirmed_by, confirmed_at, active, created_by,
        is_modifier, disposition, portion_qty, portion_unit)
    values (v_m.location_id, v_m.menu_item_id, v_m.item_id, v_m.package_id, v_m.sku_id, v_m.toast_item_guid, v_m.toast_item_name,
        v_m.toast_price_cents, 'confirmed', v_m.match_score, null, now(), true, null,
        true, v_m.disposition, v_new_portion, v_new_unit)
    returning id into v_id;
    insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, before_state, after_state, metadata)
    values (null, null, 'toast_map.manual_map', 'toast_menu_map', v_id, false,
      jsonb_build_object('map_id',v_m.id,'portion_qty',v_m.portion_qty,'portion_unit',v_m.portion_unit),
      jsonb_build_object('map_id',v_id,'portion_qty',v_new_portion,'portion_unit',v_new_unit),
      jsonb_build_object('actor_context','seed_43','target',v_target,'rule_group','G5_portion_fix',
        'location_id',v_m.location_id,'toast_item_guid',v_m.toast_item_guid,'toast_item_name',v_m.toast_item_name,
        'entity_kind',case when v_m.sku_id is not null then 'sku' else 'item' end,
        'entity_id',coalesce(v_m.sku_id, v_m.item_id),'is_modifier',true,'disposition',v_m.disposition,
        'superseded',1,'superseded_ids',jsonb_build_array(v_m.id)));
    -- One audit row per DEACTIVATED row too (review P3).
    insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, before_state, after_state, metadata)
    values (null, null, 'toast_map.unmap', 'toast_menu_map', v_m.id, false,
      jsonb_build_object('active',true), jsonb_build_object('active',false),
      jsonb_build_object('actor_context','seed_43','target',v_target,'rule_group','G5_portion_fix',
        'reason','superseded','superseded_by',v_id,'location_id',v_m.location_id,
        'toast_item_guid',v_m.toast_item_guid,'toast_item_name',v_m.toast_item_name));
  end loop;

  -- ══ G6 — crosswalk rows from reviewed name rules ════════════════════════════════
  -- role: base | mod.  kind: menu_item (target = exact menu_items.name) | item | sku
  --   (target = uuid; 'GF' = the District Bakery GF SKU) | package (target = label,
  --   resolved per location) | assortment_full.
  -- sales_only: the guid must have been SEEN in the ledger in this role (menu-cache-only
  --   guids are refused) — set on every menu_item-target modifier so a cached option in
  --   some other modifier group can never start depleting whole units.
  -- parent_keys: every observed parent of the guid must be in this list.
  create temp table s43_rules (
    grp text, name_key text, role text, kind text, target text, disposition text,
    portion_qty numeric, portion_unit text, sales_only boolean, parent_keys text[]
  ) on commit drop;
  insert into s43_rules values
    -- ── base lines → menu items (sides, specials, renamed duplicates) ──
    ('base_side','egg salad- 1/2 pint','base','menu_item','Egg Salad- 1/2 pint','deplete',null,null,false,null),
    ('base_side','tuna salad 1/2 pint','base','menu_item','Tuna Salad 1/2 Pint','deplete',null,null,false,null),
    ('base_side','whole grain chicken salad','base','menu_item','Whole Grain Chicken Salad','deplete',null,null,false,null),
    ('base_side','side of meatballs','base','menu_item','Side of Meatballs','deplete',null,null,false,null),
    ('base_side','side marinara sauce','base','menu_item','Side Marinara Sauce','deplete',null,null,false,null),
    ('base_side','large anti pasta salad (32oz)','base','menu_item','Large Anti Pasta Salad (32oz)','deplete',null,null,false,null),
    ('base_side','large pasta salad (32oz)','base','menu_item','Large Anti Pasta Salad (32oz)','deplete',null,null,false,null),
    ('base_side','large french onion dip (32oz)','base','menu_item','Large French Onion Dip (32oz)','deplete',null,null,false,null),
    ('base_side','large tuna salad (32oz)','base','menu_item','Large Tuna Salad (32oz)','deplete',null,null,false,null),
    ('base_side','large egg salad (32oz)','base','menu_item','Large Egg Salad (32oz)','deplete',null,null,false,null),
    ('base_side','caesar sal','base','menu_item','Caesar Salad','deplete',null,null,false,null),
    ('base_side','caesar salad','base','menu_item','Caesar Salad','deplete',null,null,false,null),
    ('base_special','caprese','base','menu_item','Caprese','deplete',null,null,false,null),
    ('base_special','tomato & mozz sandwich','base','menu_item','Caprese','deplete',null,null,false,null),
    ('base_special','chicken bacon caesar sub','base','menu_item','Chicken Bacon Caesar Sub','deplete',null,null,false,null),
    ('base_special','chicken bacon pesto pasta','base','menu_item','Chicken Bacon Pesto Pasta','deplete',null,null,false,null),
    ('base_alias','blt','base','menu_item','Regular BLT','deplete',null,null,false,null),
    ('base_alias','turkey sandwich','base','menu_item','Turkey Sub','deplete',null,null,false,null),
    ('base_alias','marisa tomei','base','menu_item','Marisa Tomei Eats Free','deplete',null,null,false,null),
    ('base_alias','frex','base','menu_item','The Frex','deplete',null,null,false,null),
    ('base_alias','saratoga sparkling','base','menu_item','Saratoga','deplete',null,null,false,null),
    ('base_alias','mini chips','base','menu_item','Mini Chips- Utz Original','deplete',null,null,false,null),
    ('base_alias','$12 meal uber crunchy boi','base','menu_item','Crunchy Boi','deplete',null,null,false,null),
    ('base_alias','$12 meal uber the teamster','base','menu_item','The Teamster','deplete',null,null,false,null),
    ('base_alias','$12 meal uber teamster','base','menu_item','The Teamster','deplete',null,null,false,null),
    ('base_retail','fruity pebble cannoli (single)','base','menu_item','Fruity Pebble Cannoli (single)','deplete',null,null,false,null),
    ('base_gf','sub district bakery gluten free bread','base','menu_item','Gluten Free Roll (District Bakery)','deplete',null,null,false,null),
    ('base_gf','sub gluten free bread','base','menu_item','Gluten Free Roll (District Bakery)','deplete',null,null,false,null),
    ('base_addon','add turkey','base','menu_item','Add Turkey (add-on)','deplete',null,null,false,null),
    ('base_addon','add ham','base','menu_item','Add Ham (add-on)','deplete',null,null,false,null),
    ('base_addon','add salami','base','menu_item','Add Salami (add-on)','deplete',null,null,false,null),
    ('base_addon','add pepperoni','base','menu_item','Add Pepperoni (add-on)','deplete',null,null,false,null),
    ('base_addon','add roast beef','base','menu_item','Add Roast Beef (add-on)','deplete',null,null,false,null),
    ('base_addon','add proscuitto','base','menu_item','Add Prosciutto (add-on)','deplete',null,null,false,null),
    ('base_addon','add prosciutto','base','menu_item','Add Prosciutto (add-on)','deplete',null,null,false,null),
    ('base_addon','add bacon','base','menu_item','Add Bacon (add-on)','deplete',null,null,false,null),
    ('base_addon','fresh mozz','base','menu_item','Add Fresh Mozz (add-on)','deplete',null,null,false,null),
    ('base_addon','add fresh mozz','base','menu_item','Add Fresh Mozz (add-on)','deplete',null,null,false,null),
    ('base_addon','put chips in it','base','menu_item','Put Chips In It (add-on)','deplete',null,null,false,null),
    -- ── base lines → catering packages (per-location rows already exist) ──
    -- Light Lunch (Juan r2: HALF a sub) is NOT mapped: the package slot quantity (1) is also the
    --   customer portal's pickN, so it cannot be set to 0.5 here; README spec B adds depletion_qty.
    ('base_package','full lunch','base','package','Full Lunch','deplete',null,null,false,null),
    -- Three Footer base is NOT mapped: its content arrives as the "3 foot <sub>" pick (4.5 subs, below);
    --   mapping the base to the package too would double-count.
    -- ── modifier ADDS (item / SKU targets; portions = live derivePortion or Juan) ──
    ('mod_add','put chips in it','mod','sku','4390b5b3-c59e-4d8f-804e-35570e1aef84','deplete',1,'each',false,null),
    ('mod_add','potato chips','mod','sku','4390b5b3-c59e-4d8f-804e-35570e1aef84','deplete',1,'each',false,null),
    ('mod_add','add fresh mozz','mod','item','84ccaf84-ed35-4031-bb88-e19536042bd5','deplete',3,'oz',false,null),
    ('mod_add','fresh mozz','mod','item','84ccaf84-ed35-4031-bb88-e19536042bd5','deplete',3,'oz',false,null),
    ('mod_add','add bacon','mod','item','1dd7cc14-e8ee-48ec-b023-860449ba2ec6','deplete',2.5,'each',false,null),
    ('mod_add','more salami','mod','item','4254142a-3185-472d-b54a-8d3011b8815d','deplete',1.6,'oz',false,null),
    ('mod_add','double roast beef','mod','item','a4f0e7ea-f1d4-4a82-b917-4973322f11d2','deplete',5,'oz',false,null),
    ('mod_add','add prosciutto','mod','sku','7d0481f5-df88-49f2-addb-ff96c7cc1024','deplete',2,'each',false,null),
    ('mod_add','italian salsa verde','mod','item','f661f4f1-426a-4920-8163-44f72f393542','deplete',0.5,'oz',false,null),
    ('mod_add','honey chili aioli','mod','item','d98614a2-0ba8-4d01-9e65-4fc056645fc3','deplete',1,'oz',false,null),
    ('mod_add','add mayo','mod','item','ef6d5243-e353-4ca0-bbaa-a9115e9482ac','deplete',1,'oz',false,null),
    ('mod_add','extra mayo','mod','item','ef6d5243-e353-4ca0-bbaa-a9115e9482ac','deplete',1,'oz',false,null),
    ('mod_add','add duke''s mayo','mod','item','ef6d5243-e353-4ca0-bbaa-a9115e9482ac','deplete',1,'oz',false,null),
    ('mod_add','dukes mayo','mod','item','ef6d5243-e353-4ca0-bbaa-a9115e9482ac','deplete',1,'oz',false,null),
    ('mod_add','duke''s mayo','mod','item','ef6d5243-e353-4ca0-bbaa-a9115e9482ac','deplete',1,'oz',false,null),
    ('mod_add','garlic mayo','mod','item','a060cfa7-dbb6-4669-bbef-e170492aaa1f','deplete',1.5,'oz',false,null),
    ('mod_add','oil n vin','mod','item','3b68e653-41c5-488e-a02d-73379c7bb628','deplete',0.25,'oz',false,null),
    ('mod_add','radishes','mod','item','7c98cec9-88de-44a1-aa29-11c47f30c894','deplete',4,'each',false,null),
    ('mod_add','shredded lettuce','mod','item','7206485d-5b37-4f44-bfe6-5211480d6ce0','deplete',3.4,'oz',false,null),
    -- GF swaps: STAGED (ignore, target recorded) until README spec A ships the swap (GF in + Sub Roll out).
    --   The GF roll sold as its own line (base_gf above) still depletes.
    ('mod_gf_staged','district bakery''s gluten free roll','mod','sku','GF','ignore',1,'each',false,null),
    ('mod_gf_staged','on gluten free bread','mod','sku','GF','ignore',1,'each',false,null),
    ('mod_gf_staged','serve on gluten free bread','mod','sku','GF','ignore',1,'each',false,null),
    ('mod_gf_staged','sub gluten free bread','mod','sku','GF','ignore',1,'each',false,null),
    -- ── modifier REMOVALS: ALL STAGED (ignore + target recorded) until README spec A ships parent-only removal (Sol r2 + CC ruling: a removal on a parent without the ingredient can cancel another sale's demand). ──
    -- "No Cheese" is deliberately NOT mapped (CC ruling): the cheese differs by parent; waits for spec A parent-only.
    ('mod_remove_staged','no bacon','mod','item','1dd7cc14-e8ee-48ec-b023-860449ba2ec6','ignore',2.5,'each',false,null),
    ('mod_remove_staged','no shredduce','mod','item','7206485d-5b37-4f44-bfe6-5211480d6ce0','ignore',3.4,'oz',false,null),
    ('mod_remove_staged','no mayo','mod','item','ef6d5243-e353-4ca0-bbaa-a9115e9482ac','ignore',1,'oz',false,null),  -- spread varies by parent (Aioli/Dukes/Horsey)
    ('mod_remove_staged','no oil and vin','mod','item','3b68e653-41c5-488e-a02d-73379c7bb628','ignore',0.25,'oz',false,null),
    ('mod_remove_staged','no peppers','mod','item','9195bf47-4a74-466b-97f7-27718fbb79bb','ignore',0.25,'oz',false,null),  -- peppers vary by parent (hot/sweet/banana)
    ('mod_remove_staged','no arugula','mod','sku','fa14310e-aaa0-4376-be09-09a39f49ddab','ignore',0.5,'each',false,null),
    ('mod_remove_staged','no bread- serve it on a bed of greens','mod','sku','9478c3e2-868e-444f-95f4-009a7b3b507b','ignore',1,'each',false,null),
    ('mod_remove_staged','serve on greens (gf)','mod','sku','9478c3e2-868e-444f-95f4-009a7b3b507b','ignore',1,'each',false,null),
    -- ── BOI fillings (parent It's a BOI = Crunchy Boi minus the turkey) ──
    ('mod_boi','roast beef boi','mod','item','a4f0e7ea-f1d4-4a82-b917-4973322f11d2','deplete',5,'oz',false,null),
    ('mod_boi','salami boi','mod','item','4254142a-3185-472d-b54a-8d3011b8815d','deplete',2,'oz',false,null),
    ('mod_boi','tuna salad boi','mod','item','403d2e13-d22a-4d05-9196-74aeba2f98d7','deplete',6,'oz',false,null),
    ('mod_boi','ham boi','mod','item','6a44a662-f1c2-4aa0-ac1e-77fba1d38e0f','deplete',3.6,'oz',false,null),
    ('mod_boi','chicken salad boi','mod','item','08fa8979-c9dc-41f9-904f-9680289d0437','deplete',6,'oz',false,null),
    ('mod_boi','egg boi (old bay egg salad)','mod','item','1f27d888-a7c4-460b-8951-6b0be8454c6b','deplete',6,'oz',false,null),
    ('mod_boi','pepperoni boi','mod','item','f7731046-5b83-4a51-8754-dc792d5780ae','deplete',1,'oz',false,null),
    ('mod_boi','cheesy boi (mozz, provolone & cheddar) *vegetarian','mod','menu_item','Cheesy Boi filling (modifier build)','deplete',1,'whole_sub',true,null),
    ('mod_build','double meat','mod','menu_item','Double Meat - Teamster (modifier build)','deplete',1,'whole_sub',true,array['the teamster']),
    -- ── sizes ──
    ('mod_size','medium (16oz)','mod','menu_item','Bacon Caesar Pasta Salad','deplete',1,'whole_sub',true,array['bacon caesar pasta salad']),
    -- ── bundle extras that are NOT the sub (no clash with the package's sub slot) ──
    ('mod_bundle','regular utz','mod','menu_item','Utz Original Chips','deplete',1,'whole_sub',true,array['full lunch','bag of chips']),
    ('mod_bundle','bbq','mod','menu_item','Utz BBQ Chips','deplete',1,'whole_sub',true,array['full lunch','bag of chips']),
    ('mod_bundle','salt & pepper','mod','menu_item','Salt & Pepper Chips','deplete',1,'whole_sub',true,array['full lunch','bag of chips']),
    ('mod_bundle','salt & vinegar','mod','menu_item','Utz Salt & Vinegar Chips','deplete',1,'whole_sub',true,array['full lunch','bag of chips']),
    ('mod_bundle','whole pickle','mod','menu_item','Deli Pickle','deplete',1,'whole_sub',true,array['full lunch']),
    ('mod_bundle','crunchy boi','mod','menu_item','Crunchy Boi','deplete',1,'whole_sub',true,array['sandwich']),
    ('mod_bundle','most popular','mod','assortment_full',null,'assortment_full',null,null,true,array['light lunch','full lunch']),
    -- Three Footer (Juan r2: "can serve like 20"): APPROXIMATE by length, 36 in / 8 in regular sub = 4.5 subs.
    ('mod_footer','3 foot crunchy boi','mod','menu_item','Crunchy Boi','deplete',4.5,'whole_sub',true,array['three footer']),
    ('mod_footer','3 foot teamster','mod','menu_item','The Teamster','deplete',4.5,'whole_sub',true,array['three footer']),
    -- ── named-sub picks under PACKAGES: STAGED as 'ignore' with the target recorded.
    --    Depleting them today would double-count the package's choice-slot spread;
    --    README spec B makes picks replace the spread, then a follow-up flips these to 'deplete'.
    ('mod_pick_staged','crunchy boi (turkey sub)','mod','menu_item','Crunchy Boi','ignore',null,null,true,array['light lunch','full lunch']),
    ('mod_pick_staged','teamster (italian)','mod','menu_item','The Teamster','ignore',null,null,true,array['light lunch','full lunch']),
    ('mod_pick_staged','sicky wicky club','mod','menu_item','Sicky Wicky Club','ignore',null,null,true,array['light lunch','full lunch']),
    ('mod_pick_staged','never been cheddar (roast beef)','mod','menu_item','Never Been Cheddar','ignore',null,null,true,array['light lunch','full lunch']),
    ('mod_pick_staged','hot pants (spicy italian)','mod','menu_item','Hot Pants','ignore',null,null,true,array['light lunch','full lunch']),
    ('mod_pick_staged','marisa tomei eats free (salami & mozz)','mod','menu_item','Marisa Tomei Eats Free','ignore',null,null,true,array['light lunch','full lunch']),
    ('mod_pick_staged','farmers market after dark (vegan)','mod','menu_item','Farmers Market After Dark','ignore',null,null,true,array['light lunch','full lunch']);

  if exists (select 1 from s43_rules group by name_key, role having count(*) > 1) then
    raise exception 'seed43: duplicate (name_key, role) in s43_rules';
  end if;

  -- Observed guid universe: the sales ledger (every role a guid was rung in, with its
  -- parents) + the cached Toast menu (base items + modifier options) per location.
  create temp table s43_obs on commit drop as
  with sales as (
    select e.location_id, e.toast_item_guid as guid,
           case when e.parent_selection_guid is null then 'base' else 'mod' end as role,
           lower(regexp_replace(btrim(e.item_name), '\s+', ' ', 'g')) as name_key,
           e.item_name, e.quantity::numeric as q,
           lower(regexp_replace(btrim(p.item_name), '\s+', ' ', 'g')) as parent_key
      from public.toast_sales_events e
      left join public.toast_sales_events p
        on p.location_id = e.location_id and p.business_date = e.business_date
       and p.check_guid = e.check_guid and p.selection_guid = e.parent_selection_guid
     where not e.voided
  ), cache as (
    select l.id as location_id, j->>'guid' as guid, 'base'::text as role,
           lower(regexp_replace(btrim(j->>'name'), '\s+', ' ', 'g')) as name_key, j->>'name' as item_name
      from public.toast_menu_cache c
      join public.locations l on l.toast_restaurant_guid = c.restaurant_guid,
           jsonb_path_query(c.payload, 'lax $.menus.**.menuItems[*]') j
    union all
    select l.id, o.value->>'guid', 'mod', lower(regexp_replace(btrim(o.value->>'name'), '\s+', ' ', 'g')), o.value->>'name'
      from public.toast_menu_cache c
      join public.locations l on l.toast_restaurant_guid = c.restaurant_guid,
           jsonb_each(case when jsonb_typeof(c.payload->'modifierOptionReferences') = 'object'
                           then c.payload->'modifierOptionReferences' else '{}'::jsonb end) o
  )
  select location_id, guid, role, name_key, min(item_name) as display_name,
         coalesce(sum(q), 0) as sales_qty, bool_or(from_sales) as in_sales,
         array_agg(distinct parent_key) filter (where parent_key is not null) as parents
    from (select location_id, guid, role, name_key, item_name, q, true as from_sales, parent_key from sales
          union all
          select location_id, guid, role, name_key, item_name, 0, false, null from cache
           where guid is not null and name_key is not null) u
   group by location_id, guid, role, name_key;

  create temp table s43_guid on commit drop as
  select location_id, guid,
         count(distinct name_key) as n_names,
         case when coalesce(sum(sales_qty) filter (where role = 'mod'), 0) > coalesce(sum(sales_qty) filter (where role = 'base'), 0) then 'mod'
              when coalesce(sum(sales_qty) filter (where role = 'base'), 0) > 0 then 'base'
              when bool_or(role = 'mod') then 'mod'
              else 'base' end as pick_role
    from s43_obs group by location_id, guid;

  for v_c in
    select g.location_id, g.guid, o.display_name, o.in_sales, o.parents, r.*
      from s43_guid g
      join s43_obs o on o.location_id = g.location_id and o.guid = g.guid and o.role = g.pick_role
      join s43_rules r on r.name_key = o.name_key and r.role = o.role
     where g.n_names = 1                       -- open-item guids carry many names: never mapped here
       and not exists (select 1 from public.toast_menu_map m
                        where m.location_id = g.location_id and m.toast_item_guid = g.guid
                          and m.active and m.match_status = 'confirmed')
     order by r.grp, r.name_key, g.location_id, g.guid
  loop
    if v_c.sales_only and not v_c.in_sales then v_skipped_sales_only := v_skipped_sales_only + 1; continue; end if;
    if v_c.parent_keys is not null and v_c.parents is not null and not (v_c.parents <@ v_c.parent_keys) then
      v_skipped_parent := v_skipped_parent + 1; continue;
    end if;
    v_target_id := null;
    if v_c.kind = 'menu_item' then
      select id into v_target_id from public.menu_items where name = v_c.target and active order by created_at limit 1;
      if v_target_id is null then raise exception 'seed43: rule target menu item % missing', v_c.target; end if;
    elsif v_c.kind = 'item' then
      v_target_id := v_c.target::uuid;
    elsif v_c.kind = 'sku' then
      v_target_id := case when v_c.target = 'GF' then v_gf_sku else v_c.target::uuid end;
    elsif v_c.kind = 'package' then
      select id into v_target_id from public.catering_packages
       where label_en = v_c.target and active and (location_id = v_c.location_id or location_id is null)
       order by (location_id is null), created_at limit 1;
      if v_target_id is null then
        v_skipped_no_package := v_skipped_no_package + 1;
        raise notice 'seed43: no active package % for location % — guid % left unmapped', v_c.target, v_c.location_id, v_c.guid;
        continue;
      end if;
    end if;
    -- Insert first: every rival here is NON-confirmed (confirmed guids were excluded above), so the
    -- confirmed-only unique index cannot collide; rivals are then superseded below, one audit row each.
    insert into public.toast_menu_map (location_id, menu_item_id, item_id, package_id, sku_id, toast_item_guid, toast_item_name,
        toast_price_cents, match_status, match_score, confirmed_by, confirmed_at, active, created_by,
        is_modifier, disposition, portion_qty, portion_unit)
    values (v_c.location_id,
        case when v_c.kind = 'menu_item' then v_target_id end,
        case when v_c.kind = 'item' then v_target_id end,
        case when v_c.kind = 'package' then v_target_id end,
        case when v_c.kind = 'sku' then v_target_id end,
        v_c.guid, v_c.display_name, null, 'confirmed', null, null, now(), true, null,
        v_c.role = 'mod', v_c.disposition, v_c.portion_qty, v_c.portion_unit)
    returning id into v_id;
    v_inserted := v_inserted + 1;
    with u as (
      update public.toast_menu_map set active = false
       where location_id = v_c.location_id and toast_item_guid = v_c.guid and active and id <> v_id
      returning id
    ) select coalesce(array_agg(id), '{}') into v_sup from u;
    if coalesce(array_length(v_sup, 1), 0) > 0 then
      insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, before_state, after_state, metadata)
      select null, null, 'toast_map.unmap', 'toast_menu_map', x.id, false,
             jsonb_build_object('active',true), jsonb_build_object('active',false),
             jsonb_build_object('actor_context','seed_43','target',v_target,'rule_group',v_c.grp,
               'reason','superseded','superseded_by',v_id,'location_id',v_c.location_id,'toast_item_guid',v_c.guid)
        from unnest(v_sup) as x(id);
    end if;
    insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
    values (null, null, 'toast_map.manual_map', 'toast_menu_map', v_id, false,
      jsonb_build_object('actor_context','seed_43','target',v_target,'rule_group',v_c.grp,'rule_name',v_c.name_key,
        'location_id',v_c.location_id,'toast_item_guid',v_c.guid,'toast_item_name',v_c.display_name,
        'entity_kind',v_c.kind,'entity_id',v_target_id,'entity_name',v_c.target,
        'is_modifier',v_c.role = 'mod','disposition',v_c.disposition,
        'portion_qty',v_c.portion_qty,'portion_unit',v_c.portion_unit,
        'seen_in_sales',v_c.in_sales,'superseded',coalesce(array_length(v_sup, 1), 0),'superseded_ids',to_jsonb(v_sup)));
  end loop;

  raise notice 'seed43 G6: % map rows inserted; skipped sales_only=% parent=% no_package=%',
    v_inserted, v_skipped_sales_only, v_skipped_parent, v_skipped_no_package;
end $seed43$;

-- =============================================================================
-- VERIFICATION (read-only). Run inside the same transaction, before COMMIT.
-- =============================================================================

-- V1. Parameters / weights still TODO for Juan.
select vi.name, vi.avg_oz_per_each, vi.weight_class,
       case when vi.avg_oz_per_each is null then 'TODO(Juan): weigh one' else 'set' end as status
  from public.vendor_items vi
 where vi.id = 'a72ea2c4-1063-4d4c-8bcc-7a47bad3e10b' or vi.name = 'Gluten Free Roll (District Bakery)';

-- V2. Everything seed 43 created or superseded, by action.
select action, metadata->>'rule_group' as rule_group, count(*) as n
  from public.audit_log where metadata->>'actor_context' = 'seed_43'
 group by 1, 2 order by 1, 2;

-- V3. New recipes: name, output, line count, approximate flag.
select r.name, mi.name as output, count(ri.id) as lines, (r.name like '%approximate%') as approximate
  from public.recipes r
  join public.recipe_outputs ro on ro.recipe_id = r.id
  join public.menu_items mi on mi.id = ro.output_menu_item_id
  left join public.recipe_inputs ri on ri.recipe_id = r.id
 where r.id in (select resource_id from public.audit_log where metadata->>'actor_context' = 'seed_43' and action = 'recipe.create')
 group by r.name, mi.name order by mi.name;

-- V4. Crosswalk rows written by seed 43, per location / lane / disposition.
select l.code, m.is_modifier, m.disposition,
       case when m.menu_item_id is not null then 'menu_item' when m.item_id is not null then 'item'
            when m.sku_id is not null then 'sku' when m.package_id is not null then 'package' else 'assortment' end as kind,
       count(*) as rows
  from public.toast_menu_map m join public.locations l on l.id = m.location_id
 where m.active and m.id in (select resource_id from public.audit_log
                              where metadata->>'actor_context' = 'seed_43' and action = 'toast_map.manual_map')
 group by 1, 2, 3, 4 order by 1, 2, 3, 4;

-- V5. STAGED rows (disposition 'ignore', target recorded) — flipped to their live disposition by
--     the follow-ups: package picks after spec B; GF swaps + No Mayo / No Peppers after spec A.
select l.code, a.metadata->>'rule_group' as rule_group, m.toast_item_name, m.toast_item_guid,
       coalesce(mi.name, i.name, vi.name) as target, m.portion_qty, m.portion_unit
  from public.toast_menu_map m join public.locations l on l.id = m.location_id
  join public.audit_log a on a.resource_id = m.id and a.action = 'toast_map.manual_map'
                         and a.metadata->>'actor_context' = 'seed_43'
  left join public.menu_items mi on mi.id = m.menu_item_id
  left join public.items i on i.id = m.item_id
  left join public.vendor_items vi on vi.id = m.sku_id
 where m.active and m.match_status = 'confirmed' and m.disposition = 'ignore'
 order by 2, 1, 3;

-- V6. What is STILL unmapped (ledger since 2026-09-07), top 40 per location — expect open
--     items, ezCater codes, dual-role guids (README spec C) and the no-SKU retail list.
select * from (
  select l.code, (e.parent_selection_guid is not null) as is_mod, e.item_name, sum(e.quantity) as qty,
         row_number() over (partition by l.code order by sum(e.quantity) desc) as rn
    from public.toast_sales_events e join public.locations l on l.id = e.location_id
   where not e.voided and e.business_date >= date '2026-09-07'
     and not exists (select 1 from public.toast_menu_map m
                      where m.location_id = e.location_id and m.toast_item_guid = e.toast_item_guid
                        and m.active and m.match_status = 'confirmed'
                        and m.is_modifier = (e.parent_selection_guid is not null))
   group by 1, 2, 3
) x where rn <= 40 order by code, qty desc;
