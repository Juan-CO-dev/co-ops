-- Migration 0258_recipe_input_write_atomic
-- AUTHORED 2026-10-15. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word, BEFORE the code merges; 0257 first).
-- Provenance: catalog redesign Phase 1 (docs/superpowers/plans/2026-10-15-catalog-phase1-quick-fixes.md),
--   Astra full-branch review #3: lib/recipes.ts checked a recipe line's item cycle with a READ
--   and then wrote with a separate INSERT/UPDATE. Two concurrent writes (two managers, two
--   recipes) could each pass the check and together close a loop across recipes — a graph the
--   flatten then has to survive. The check and the write now happen in ONE transaction behind
--   ONE graph-wide lock.
--
-- WHAT:
--   1. add_recipe_input_atomic(...)  → uuid
--      Takes the transaction advisory lock on key 7258025800 (the recipe-graph write lock; the TS constant is
--      RECIPE_GRAPH_LOCK_KEY in lib/recipe-graph-shared.ts and a test pins they agree), checks the
--      recipe exists, refuses an item line that would close a cycle, computes display_order under
--      the lock (max + 1 — the same lock also ends the old read-then-insert race on the order),
--      INSERTs the line and returns its id.
--   2. update_recipe_input_atomic(...) → the written row
--      Same lock, same cycle check (skipping the line being edited — its old value is about to be
--      replaced), then the compare-and-set UPDATE: the row must still be on this recipe AND equal
--      the FULL expected snapshot the client saw (every column, NULL-safe). 0 rows → the row still
--      on the recipe is `line_changed`, otherwise `edge_not_found`. RETURNS the written row, which
--      is the audit's "after" (lib/recipes.ts updateRecipeInput).
--   Named refusals (P0001, mapped by lib/recipes.ts rpcRecipeError): recipe_not_found ·
--   would_create_cycle · line_changed · edge_not_found.
--
-- THE CYCLE RULE (recursive CTE; mirrored by itemLineWouldCycle, lib/recipe-graph-shared.ts):
--   targets = every item recipe R outputs; reach = the new item, then every input item of every
--   recipe that OUTPUTS a reached item (all producers — the conservative reading of the TS
--   guard's one-producer map); a cycle iff reach meets targets (the new item itself counts).
--   A plain UNION (never the ALL form) makes the walk terminate on an existing loop.
--
-- Shape rules (one target, a finite quantity > 0, labels only on SKU lines, no portioned item
-- line, the product measure-registry rule) stay in the TS validator (assertInputLineIsValid),
-- which runs BEFORE the call; the table's own CHECKs stand behind both.
--
-- KNOWN LIMIT (recorded, not hidden): createRecipeFull / add_recipe_output (0187/0215) still
-- serialise on the recipe row lock and the per-item lock, not on this graph lock; a NEW output
-- racing a line write is the remaining window. Re-emitting those definers is a separate change.
--
-- Function grants: EXECUTE revoked from PUBLIC/anon/authenticated, granted to service_role
--   (AGENTS.md: "REVOKE FROM PUBLIC is NOT enough"); a DO block refuses to commit otherwise.
--
-- PRE-FLIGHT (MCP, before apply):
--   select to_regprocedure('public.add_recipe_input_atomic(uuid,uuid,uuid,uuid,numeric,text,text,boolean,uuid)');  -- NULL
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'recipe_inputs';   -- component_product_id present (0179)
--
-- VERIFY AFTER APPLY:
--   select grantee from information_schema.routine_privileges
--    where routine_name in ('add_recipe_input_atomic', 'update_recipe_input_atomic') order by 1;
--     -- service_role (plus the owner) only

begin;

create or replace function public.recipe_input_would_cycle(
  p_recipe_id uuid,
  p_item_id uuid,
  p_exclude_input_id uuid
) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  with recursive targets as (
    select ro.output_item_id as item_id
      from public.recipe_outputs ro
     where ro.recipe_id = p_recipe_id
       and ro.output_item_id is not null
  ),
  reach(item_id) as (
    select p_item_id
    union
    select ri.component_item_id
      from reach r
      join public.recipe_outputs ro on ro.output_item_id = r.item_id
      join public.recipe_inputs ri on ri.recipe_id = ro.recipe_id
     where ri.component_item_id is not null
       and (p_exclude_input_id is null or ri.id <> p_exclude_input_id)
  )
  select exists (select 1 from reach join targets using (item_id));
$$;

create or replace function public.add_recipe_input_atomic(
  p_recipe_id uuid,
  p_component_sku_id uuid,
  p_component_item_id uuid,
  p_component_product_id uuid,
  p_quantity numeric,
  p_unit text,
  p_each_container_label text,
  p_portioned boolean,
  p_created_by uuid
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_id uuid;
  v_order integer;
begin
  -- The recipe-graph write lock (lib/recipe-graph-shared.ts RECIPE_GRAPH_LOCK_KEY).
  perform pg_advisory_xact_lock(7258025800);

  if not exists (select 1 from public.recipes where id = p_recipe_id) then
    raise exception 'recipe_not_found' using errcode = 'P0001';
  end if;

  if p_component_item_id is not null
     and public.recipe_input_would_cycle(p_recipe_id, p_component_item_id, null) then
    raise exception 'would_create_cycle' using errcode = 'P0001';
  end if;

  select coalesce(max(display_order), 0) + 1 into v_order
    from public.recipe_inputs where recipe_id = p_recipe_id;

  insert into public.recipe_inputs (
    recipe_id, component_sku_id, component_item_id, component_product_id,
    quantity, unit, each_container_label, portioned, display_order, created_by
  ) values (
    p_recipe_id, p_component_sku_id, p_component_item_id, p_component_product_id,
    p_quantity, p_unit, p_each_container_label, coalesce(p_portioned, false), v_order, p_created_by
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.update_recipe_input_atomic(
  p_input_id uuid,
  p_recipe_id uuid,
  p_component_sku_id uuid,
  p_component_item_id uuid,
  p_component_product_id uuid,
  p_quantity numeric,
  p_unit text,
  p_each_container_label text,
  p_portioned boolean,
  p_expected_component_sku_id uuid,
  p_expected_component_item_id uuid,
  p_expected_component_product_id uuid,
  p_expected_quantity numeric,
  p_expected_unit text,
  p_expected_each_container_label text,
  p_expected_portioned boolean
) returns table (
  component_sku_id uuid,
  component_item_id uuid,
  component_product_id uuid,
  quantity numeric,
  unit text,
  each_container_label text,
  portioned boolean
)
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  -- The recipe-graph write lock (lib/recipe-graph-shared.ts RECIPE_GRAPH_LOCK_KEY).
  perform pg_advisory_xact_lock(7258025800);

  if p_component_item_id is not null
     and public.recipe_input_would_cycle(p_recipe_id, p_component_item_id, p_input_id) then
    raise exception 'would_create_cycle' using errcode = 'P0001';
  end if;

  return query
  update public.recipe_inputs ri
     set component_sku_id = p_component_sku_id,
         component_item_id = p_component_item_id,
         component_product_id = p_component_product_id,
         quantity = p_quantity,
         unit = p_unit,
         each_container_label = p_each_container_label,
         portioned = p_portioned
   where ri.id = p_input_id
     and ri.recipe_id = p_recipe_id
     and ri.component_sku_id is not distinct from p_expected_component_sku_id
     and ri.component_item_id is not distinct from p_expected_component_item_id
     and ri.component_product_id is not distinct from p_expected_component_product_id
     and ri.quantity = p_expected_quantity
     and ri.unit is not distinct from p_expected_unit
     and ri.each_container_label is not distinct from p_expected_each_container_label
     and ri.portioned is not distinct from p_expected_portioned
  returning ri.component_sku_id, ri.component_item_id, ri.component_product_id,
            ri.quantity, ri.unit, ri.each_container_label, ri.portioned;

  if not found then
    if exists (select 1 from public.recipe_inputs x where x.id = p_input_id and x.recipe_id = p_recipe_id) then
      raise exception 'line_changed' using errcode = 'P0001';
    end if;
    raise exception 'edge_not_found' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.recipe_input_would_cycle(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.recipe_input_would_cycle(uuid, uuid, uuid) to service_role;
revoke all on function public.add_recipe_input_atomic(uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.add_recipe_input_atomic(uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid) to service_role;
revoke all on function public.update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean) from public, anon, authenticated;
grant execute on function public.update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean) to service_role;

do $$ begin
  if exists (select 1 from information_schema.routine_privileges
              where routine_schema = 'public'
                and routine_name in ('recipe_input_would_cycle', 'add_recipe_input_atomic', 'update_recipe_input_atomic')
                and grantee in ('PUBLIC', 'anon', 'authenticated')) then
    raise exception '0258: unexpected recipe-input RPC execute grant';
  end if;
end $$;

commit;
