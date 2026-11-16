-- Migration 0308_sku_swap_shop_scope
-- AUTHORED 2026-11-15. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word, AFTER 0265).
-- Provenance: CO-OPS bug audit wave W08, bug B057 (found at 7494f738). The design rule it restores
--   (docs/superpowers/plans/2026-10-15-catalog-phase4a-shop-only-and-job-engines.md, rule 8): "A swap never moves
--   another shop: a new product's default primary is pinned to the old item; an existing product without a
--   default primary refuses (`product_needs_primary`) rather than guess."
--
-- WHAT (start_sku_swap and end_sku_swap are RE-EMITTED from 0265 verbatim — the only migration that defines
--   them — except the two blocks marked 0308):
--   1. start_sku_swap: a SHOP-scoped swap (p_location not null) of a product with no global default primary
--      created that default (= p_old) for EVERY product, including an existing one. loadProductIndex reads the
--      shop row first, then the global row, so every OTHER shop moved from its own rung (recent receipt / any
--      member) to "primary = p_old". Now the default is created only when the swap CREATED the product
--      (v_created); an existing product with no default refuses 'swap:product_needs_primary' (P0001). The
--      refusal sits where the insert was, AFTER the product_changed / recipes_changed evidence checks, and the
--      whole transaction rolls back (no membership, primary, recipe or journal row is written).
--   2. end_sku_swap: "Back to normal" deleted `default_created` only inside the grouping branch, which runs only
--      when the swap created or extended the grouping. A pre-0308 journal with default_created set and
--      grouping_created = false (an existing product) left the global default behind, so the other shop stayed
--      moved. A new block, BEFORE the grouping block, deletes that default at its EXACT id + revision; a default
--      a manager re-chose since (revision bumped by the 0265 trigger) is kept. Post-0308 journals carry
--      default_created only with grouping_created = true, so the new block only ever acts on pre-0308 journals.
--   Global swaps (p_location null), swaps of a product that already has a default, and swaps that create the
--   product behave exactly as in 0265.
--
-- EXISTING ROWS: nothing is rewritten by this migration. ENDED pre-0308 swaps that left a stray default behind
--   are NOT cleaned up here (removing them switches the other shop's order guide back: Juan's decision). LIVE
--   ones are cleaned up by the new end path when someone presses Back.
--
-- APP (same PR): lib/catalog/swap-vendor.ts previewSkuSwap refuses the same case at PREVIEW (409
--   product_needs_primary; en + es copy already exists), so the app is correct before this file is applied;
--   this file is the database's own guard plus the Back cleanup for pre-0308 journals.
--
-- DEPENDS ON: 0265 (sku_swaps, sku_swap_ends, product_primaries.revision, both functions) and through it 0262/0264.
--   Independent of 0305 (W05, PR #545: current_user_locations() / shop-binding RLS) — both functions are
--   service-role SECURITY DEFINER and read no RLS helper.
--
-- PRE-FLIGHT (MCP, read-only, before apply):
--   select to_regprocedure('public.start_sku_swap(uuid,uuid,uuid,uuid,jsonb,jsonb,boolean,text,jsonb)'),
--          to_regprocedure('public.end_sku_swap(uuid,uuid)');                                  -- both present
--   -- products a GM could no longer swap per shop until a default is chosen:
--   select p.id, p.name from public.products p
--    where p.active and not exists(select 1 from public.product_primaries pp where pp.product_id=p.id and pp.location_id is null)
--      and (select count(*) from public.vendor_items v where v.product_id=p.id and v.active) >= 1;
--   -- stray defaults already written by shop-scoped swaps of existing products (report; do not repair):
--   select s.id, s.product_id, s.location_id, (e.id is not null) as ended,
--     exists(select 1 from public.product_primaries pp where pp.id=(s.default_created->>'id')::uuid
--            and pp.revision=(s.default_created->>'revision')::bigint) as untouched
--   from public.sku_swaps s left join public.sku_swap_ends e on e.swap_id=s.id
--   where s.default_created is not null and not s.grouping_created;
--
-- VERIFY AFTER APPLY:
--   select position('swap:product_needs_primary' in pg_get_functiondef('public.start_sku_swap(uuid,uuid,uuid,uuid,jsonb,jsonb,boolean,text,jsonb)'::regprocedure)) > 0; -- t
--   select routine_name, grantee from information_schema.routine_privileges
--    where routine_schema='public' and routine_name in ('start_sku_swap','end_sku_swap') order by 1,2;  -- service_role (+ postgres) only
--
-- ROLLBACK: re-apply the two function bodies from 0265 (create or replace). No table, column or row changes.
-- PROOF: scripts/sql-harness-0308.mjs (PGlite: the REAL 0258 → 0265 + 0308, synthetic rows), pinned by
--   tests/sku-swap-shop-scope-migration.test.ts; tests/sku-swaps-pglite.test.ts runs every 0265 case on 0308.
begin;
-- The graph lock the 0264/0265 writers take, so no swap runs while the functions are replaced.
select pg_advisory_xact_lock(7258025800);

-- ── PRE-FLIGHT: 0265 applied (its journal columns and the primary revision it added) ─────────────────────────
do $$
begin
  if to_regprocedure('public.start_sku_swap(uuid,uuid,uuid,uuid,jsonb,jsonb,boolean,text,jsonb)') is null
     or to_regprocedure('public.end_sku_swap(uuid,uuid)') is null
     or to_regclass('public.sku_swaps') is null or to_regclass('public.sku_swap_ends') is null then
    raise exception '0308: 0265 (sku swaps) must be applied first';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='sku_swaps' and column_name='default_created')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='sku_swaps' and column_name='grouping_created')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='product_primaries' and column_name='revision') then
    raise exception '0308: the 0265 journal columns are missing: refusing';
  end if;
end $$;

-- ── 1. start_sku_swap (0265 + the 0308 default rule) ─────────────────────────────────────────────────────────
create or replace function public.start_sku_swap(p_old uuid,p_new uuid,p_location uuid,p_actor uuid,p_product_snapshot jsonb,
 p_recipes jsonb,p_temporary boolean,p_note text,p_product jsonb default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog,public as $$
declare
 v_old public.vendor_items%rowtype; v_new public.vendor_items%rowtype; v_product uuid; v_created boolean:=false;
 v_before jsonb; v_after jsonb; v_default jsonb; v_recipe jsonb; v_saved jsonb; v_results jsonb:='[]';
 v_constraint text; v_journal jsonb:='[]'; v_live jsonb; v_expected jsonb; v_id uuid:=gen_random_uuid();
begin
 if p_product_snapshot is null or jsonb_typeof(p_product_snapshot)<>'object' or p_recipes is null or jsonb_typeof(p_recipes)<>'array'
 or (p_temporary and p_location is null) or p_old is null or p_new is null or p_old=p_new or p_actor is null or p_temporary is null then raise exception 'swap:invalid_payload' using errcode='P0001'; end if;
 perform pg_advisory_xact_lock(7258025800);
 if exists(select 1 from public.sku_swaps s where s.temporary and s.location_id is not distinct from p_location
  and (s.old_sku_id in(p_old,p_new) or s.new_sku_id in(p_old,p_new))
  and not exists(select 1 from public.sku_swap_ends e where e.swap_id=s.id)) then raise exception 'swap:already_swapped' using errcode='P0001'; end if;
 perform 1 from public.measure_units order by label for share nowait;
 -- Product writers do not take the graph lock. NOWAIT prevents lock inversion.
 perform 1 from public.products where id in(select product_id from public.vendor_items where id in(p_old,p_new)) order by id for update nowait;
 perform 1 from public.product_primaries where product_id in(select product_id from public.vendor_items where id in(p_old,p_new)) order by id for update nowait;
 perform 1 from public.vendor_items where id in(p_old,p_new) or product_id in(select product_id from public.vendor_items where id in(p_old,p_new)) order by id for update nowait;
 perform 1 from public.locations where id=p_location for share nowait;
 perform 1 from public.vendors where id in(select vendor_id from public.vendor_items where id in(p_old,p_new) or product_id in(select product_id from public.vendor_items where id in(p_old,p_new))) order by id for share nowait;
 perform 1 from public.location_sku_settings where (sku_id in(p_old,p_new) or sku_id in(select id from public.vendor_items where product_id in(select product_id from public.vendor_items where id in(p_old,p_new)))) and location_id=p_location order by id for update nowait;
 if public.sku_swap_product_snapshot(p_old,p_new,p_location) is distinct from p_product_snapshot then raise exception 'swap:product_changed' using errcode='P0001'; end if;
 select * into v_old from public.vendor_items where id=p_old;
 select * into v_new from public.vendor_items where id=p_new;
 if v_old.id is null or v_new.id is null or not v_old.active or not v_new.active
 or (v_old.location_id is not null and v_old.location_id is distinct from p_location)
 or (v_new.location_id is not null and v_new.location_id is distinct from p_location)
 or (p_location is not null and not exists(select 1 from public.locations where id=p_location and active))
 or exists(select 1 from public.vendors where id=v_new.vendor_id and not active)
 or exists(select 1 from public.location_sku_settings where sku_id=p_new and location_id=p_location and active_override=false)
 then raise exception 'swap:replacement_ineligible' using errcode='P0001'; end if;
 if v_old.product_id is not null and v_new.product_id is not null and v_old.product_id<>v_new.product_id then raise exception 'swap:in_other_product' using errcode='P0001'; end if;
 for v_recipe in select value from jsonb_array_elements(p_recipes) loop
  perform public.recipe_change_lock((v_recipe->>'recipe_id')::uuid,(v_recipe->>'write_scope')::uuid,(v_recipe->'lines') || coalesce(v_recipe->'replacement_lines','[]'::jsonb));
 end loop;
 v_live:=public.sku_swap_recipe_snapshot(p_old,p_new,p_location);
 select coalesce(jsonb_agg(value-'replacement_lines' order by value->>'recipe_id'),'[]'::jsonb) into v_expected from jsonb_array_elements(p_recipes);
 if v_live is distinct from v_expected then raise exception 'swap:recipes_changed' using errcode='P0001'; end if;
 v_product:=coalesce(v_old.product_id,v_new.product_id);
 if v_product is null then
  insert into public.products(name,name_es,created_by,updated_by) values(coalesce(nullif(p_product->>'name',''),v_old.name),p_product->>'name_es',p_actor,p_actor) returning id into v_product;
  v_created:=true;
 elsif not exists(select 1 from public.products where id=v_product and active) then raise exception 'swap:replacement_ineligible' using errcode='P0001'; end if;
 v_before:=coalesce((select to_jsonb(p) from public.product_primaries p where product_id=v_product and location_id is not distinct from p_location),'null'::jsonb);
 update public.vendor_items set product_id=v_product where id in(p_old,p_new) and product_id is null;
 if p_location is not null and not exists(select 1 from public.product_primaries where product_id=v_product and location_id is null) then
  -- 0308 (W08/B057): a swap never moves another shop. Only a product THIS swap created gets a default
  -- (pinned to the old item, so every other shop keeps resolving to what it had); an existing product
  -- without a default refuses rather than guess.
  if not v_created then raise exception 'swap:product_needs_primary' using errcode='P0001'; end if;
  insert into public.product_primaries(product_id,primary_sku_id,updated_by) values(v_product,p_old,p_actor) returning to_jsonb(product_primaries) into v_default;
 end if;
 insert into public.product_primaries(product_id,location_id,primary_sku_id,note,updated_by)
 values(v_product,p_location,p_new,p_note,p_actor) on conflict(product_id,location_id) do update set primary_sku_id=excluded.primary_sku_id,note=excluded.note,updated_by=excluded.updated_by,updated_at=clock_timestamp()
 returning to_jsonb(product_primaries) into v_after;
 for v_recipe in select value from jsonb_array_elements(p_recipes) loop
  if jsonb_typeof(v_recipe->'replacement_lines') is distinct from 'array' then raise exception 'swap:invalid_payload' using errcode='P0001'; end if;
  if v_recipe->'lines'=v_recipe->'replacement_lines' then
   v_journal:=v_journal||jsonb_build_array(v_recipe||jsonb_build_object('unchanged',true,'after_version_id',v_recipe->>'own_version_id'));
   continue;
  end if;
  v_saved:=public.save_recipe_version((v_recipe->>'recipe_id')::uuid,(v_recipe->>'write_scope')::uuid,v_recipe->'replacement_lines',
   (v_recipe->>'own_version_id')::uuid,case when v_recipe->>'own_version_id' is null then (v_recipe->>'version_id')::uuid else null end,
   p_note,p_actor,null,null,null,public.recipe_change_snapshot((v_recipe->>'recipe_id')::uuid,(v_recipe->>'write_scope')::uuid,v_recipe->'replacement_lines'));
  v_results:=v_results||jsonb_build_array(jsonb_build_object('recipe_id',v_recipe->>'recipe_id','version_id',v_saved->>'version_id'));
  v_journal:=v_journal||jsonb_build_array(v_recipe||jsonb_build_object('after_version_id',v_saved->>'version_id'));
 end loop;
 insert into public.sku_swaps(id,old_sku_id,new_sku_id,location_id,product_id,temporary,product_snapshot_before,product_snapshot_after,primary_before,primary_after,recipes,grouping_created,default_created,note,created_by)
 values(v_id,p_old,p_new,p_location,v_product,p_temporary,p_product_snapshot,public.sku_swap_product_snapshot(p_old,p_new,p_location),v_before,v_after,v_journal,v_created,v_default,p_note,p_actor);
 return jsonb_build_object('swap_id',v_id,'product_id',v_product,'recipes',v_results);
exception when lock_not_available then raise exception 'swap:dependencies_busy' using errcode='P0001';
 when unique_violation then
  get stacked diagnostics v_constraint = constraint_name;
  if v_constraint = 'products_name_lower_uq' then raise exception 'swap:product_name_taken' using errcode='P0001'; end if;
  raise;
 when invalid_text_representation or numeric_value_out_of_range then raise exception 'swap:invalid_payload' using errcode='P0001';
end $$;

-- ── 2. end_sku_swap (0265 + the 0308 pre-0308 default cleanup) ──────────────────────────────────────────────
create or replace function public.end_sku_swap(p_swap uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 s public.sku_swaps%rowtype; r jsonb; v_current uuid; v_default uuid; v_result jsonb;
 v_recipes jsonb:='[]'; v_primary text:='changed_since'; v_grouping text:='unchanged'; v_p jsonb;
 v_before jsonb; v_line jsonb; v_sku uuid;
begin
 if p_swap is null or p_actor is null then raise exception 'swap:invalid_payload' using errcode='P0001'; end if;
 perform pg_advisory_xact_lock(7258025800);
 select * into s from public.sku_swaps where id=p_swap for update;
 if not found then raise exception 'swap:not_found' using errcode='P0001'; end if;
 if exists(select 1 from public.sku_swap_ends where swap_id=p_swap) then raise exception 'swap:not_live' using errcode='P0001'; end if;
 if not s.temporary then raise exception 'swap:not_temporary' using errcode='P0001'; end if;
 perform 1 from public.products where id=s.product_id for update nowait;
 perform 1 from public.product_primaries where product_id=s.product_id order by id for update nowait;
 perform 1 from public.vendor_items where product_id=s.product_id or id in(s.old_sku_id,s.new_sku_id) order by id for update nowait;
 for r in select value from jsonb_array_elements(s.recipes) loop
  perform public.recipe_change_lock((r->>'recipe_id')::uuid,(r->>'write_scope')::uuid,r->'lines');
 end loop;
 for r in select value from jsonb_array_elements(s.recipes) loop
  if coalesce((r->>'unchanged')::boolean,false) then continue; end if;
  select id into v_current from public.recipe_versions where recipe_id=(r->>'recipe_id')::uuid and location_id is not distinct from (r->>'write_scope')::uuid and active;
  if v_current is distinct from (r->>'after_version_id')::uuid then
   v_recipes:=v_recipes||jsonb_build_array(jsonb_build_object('recipe_id',r->>'recipe_id','outcome','changed_since'));
   continue;
  end if;
  select id into v_default from public.recipe_versions where recipe_id=(r->>'recipe_id')::uuid and location_id is null and active;
  if r->>'write_scope' is not null and r->>'own_version_id' is null and v_default=(r->>'version_id')::uuid then
   perform public.retire_recipe_version(v_current,(r->>'write_scope')::uuid,p_actor,
     public.recipe_change_snapshot((r->>'recipe_id')::uuid,(r->>'write_scope')::uuid,r->'lines'));
  else
   -- A changed default cannot replace the exact inherited content saved at start.
   perform public.save_recipe_version((r->>'recipe_id')::uuid,(r->>'write_scope')::uuid,null,v_current,null,'Back to normal',p_actor,
    (r->>'version_id')::uuid,null,null,public.recipe_change_snapshot((r->>'recipe_id')::uuid,(r->>'write_scope')::uuid,r->'lines'));
  end if;
  v_recipes:=v_recipes||jsonb_build_array(jsonb_build_object('recipe_id',r->>'recipe_id','outcome','restored'));
 end loop;
 select to_jsonb(p) into v_p from public.product_primaries p where product_id=s.product_id and location_id is not distinct from s.location_id;
 if v_p->>'id'=s.primary_after->>'id' and v_p->>'revision'=s.primary_after->>'revision' then
  if s.primary_before='null'::jsonb then
   -- The exceptional deletion is restricted to the row this swap introduced, at its exact revision.
   delete from public.product_primaries where id=(s.primary_after->>'id')::uuid and revision=(s.primary_after->>'revision')::bigint;
  else
   update public.product_primaries set primary_sku_id=(s.primary_before->>'primary_sku_id')::uuid,
    note=s.primary_before->>'note',updated_by=(s.primary_before->>'updated_by')::uuid,updated_at=clock_timestamp()
    where id=(s.primary_after->>'id')::uuid and revision=(s.primary_after->>'revision')::bigint;
  end if;
  v_primary:='restored';
 end if;
 -- 0308 (W08/B057): a pre-0308 journal may hold a default made for an EXISTING product (not grouping_created);
 -- it moved every other shop. Remove it only at its exact id + revision (untouched since the swap made it).
 if s.default_created is not null and not s.grouping_created then
  delete from public.product_primaries
   where id=(s.default_created->>'id')::uuid and revision=(s.default_created->>'revision')::bigint;
 end if;
 -- Any new reference, member, primary rechoice or recipe edit keeps the grouping.
 if s.grouping_created or s.product_snapshot_before->'old_sku'->>'product_id' is null or s.product_snapshot_before->'new_sku'->>'product_id' is null then
  v_grouping:='changed_since';
  if v_primary='restored'
   and (select to_jsonb(p) from public.products p where id=s.product_id) = s.product_snapshot_after->'product'
   and (select to_jsonb(v) from public.vendor_items v where id=s.old_sku_id) = s.product_snapshot_after->'old_sku'
   and (select to_jsonb(v) from public.vendor_items v where id=s.new_sku_id) = s.product_snapshot_after->'new_sku'
   and not exists(select 1 from jsonb_array_elements(v_recipes) x where x->>'outcome'='changed_since')
   and not exists(select 1 from public.product_primaries p where product_id=s.product_id and
      not coalesce(( (s.default_created is not null and p.id=(s.default_created->>'id')::uuid and p.revision=(s.default_created->>'revision')::bigint)
        or (to_jsonb(p)=s.product_snapshot_before->'default_primary')
        or (to_jsonb(p)-'revision'-'updated_at'=case when jsonb_typeof(s.primary_before)='object' then s.primary_before-'revision'-'updated_at' else null end) ),false))
   and (not s.grouping_created or (
     not exists(select 1 from public.vendor_items where product_id=s.product_id and id not in(s.old_sku_id,s.new_sku_id))
     and not exists(select 1 from public.recipe_inputs where component_product_id=s.product_id)
     and not exists(select 1 from public.recipe_version_lines l join public.recipe_versions v on v.id=l.version_id where v.active and l.component_product_id=s.product_id))) then
    if s.default_created is not null then
     delete from public.product_primaries where id=(s.default_created->>'id')::uuid and revision=(s.default_created->>'revision')::bigint;
    end if;
    for v_before in select value from jsonb_array_elements(jsonb_build_array(s.product_snapshot_before->'old_sku',s.product_snapshot_before->'new_sku')) loop
     if v_before->>'product_id' is null then
      update public.vendor_items set product_id=null where id=(v_before->>'id')::uuid and product_id=s.product_id;
     end if;
    end loop;
    if s.grouping_created then update public.products set active=false,updated_by=p_actor,updated_at=clock_timestamp() where id=s.product_id; end if;
    v_grouping:='restored';
  end if;
 end if;
 v_result:=jsonb_build_object('swap_id',p_swap,'recipes',v_recipes,'primary',v_primary,'grouping',v_grouping);
 insert into public.sku_swap_ends(swap_id,outcome,created_by) values(p_swap,v_result,p_actor);
 return v_result;
exception when lock_not_available then raise exception 'swap:dependencies_busy' using errcode='P0001';
end $$;

-- ── 3. The 0265 ACL, re-asserted (create or replace keeps it; the block proves it) ───────────────────────────
revoke all on function public.start_sku_swap(uuid,uuid,uuid,uuid,jsonb,jsonb,boolean,text,jsonb),public.end_sku_swap(uuid,uuid) from public,anon,authenticated;
grant execute on function public.start_sku_swap(uuid,uuid,uuid,uuid,jsonb,jsonb,boolean,text,jsonb),public.end_sku_swap(uuid,uuid) to service_role;
do $$
declare f regprocedure;
begin
  foreach f in array array['public.start_sku_swap(uuid,uuid,uuid,uuid,jsonb,jsonb,boolean,text,jsonb)'::regprocedure,
                           'public.end_sku_swap(uuid,uuid)'::regprocedure] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '0308: swap RPC grant escaped on %', f;
    end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '0308: service_role lost EXECUTE on %', f;
    end if;
    if exists(select 1 from pg_proc p, lateral aclexplode(p.proacl) a where p.oid = f and a.grantee = 0) then
      raise exception '0308: PUBLIC holds EXECUTE on %', f;
    end if;
    if not (select prosecdef from pg_proc where oid = f)
       or not coalesce((select proconfig from pg_proc where oid = f) @> array['search_path=pg_catalog, public'], false) then
      raise exception '0308: % must be SECURITY DEFINER with a pinned search_path', f;
    end if;
  end loop;
  if position('swap:product_needs_primary' in (select prosrc from pg_proc where oid = 'public.start_sku_swap(uuid,uuid,uuid,uuid,jsonb,jsonb,boolean,text,jsonb)'::regprocedure)) = 0 then
    raise exception '0308: start_sku_swap is missing the product_needs_primary guard';
  end if;
  if position('s.default_created is not null and not s.grouping_created' in (select prosrc from pg_proc where oid = 'public.end_sku_swap(uuid,uuid)'::regprocedure)) = 0 then
    raise exception '0308: end_sku_swap is missing the pre-0308 default cleanup';
  end if;
end $$;
commit;
