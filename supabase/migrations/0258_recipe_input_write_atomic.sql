-- Migration 0258_recipe_input_write_atomic
-- AUTHORED 2026-10-15. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word, BEFORE the code merges; 0257 first).
-- APPLIED TO SIM 2026-10-15 (20261015100840 'recipe_input_write_atomic' = first version; 20261015101911 'recipe_input_write_atomic_v2' = the output-writer re-emits)
-- APPLIED TO PROD 2026-10-15 (schema_migrations version 20261015103138, name 'recipe_input_write_atomic') — the full amended file; prod create_recipe_full/add_recipe_output verified = 0215 bodies before apply
-- AMENDED 2026-10-15 (Astra r2 #1): the SIM received the FIRST version of this file (line writers only). It must be
--   RE-APPLIED there (every statement is CREATE OR REPLACE / REVOKE / GRANT, so a re-run is safe). Prod never saw
--   either version.
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
-- OUTPUT WRITERS (Astra r2 #1): a line write and an OUTPUT write can close a loop together too —
--   A produces X; B consumes X; B's "produce Y" passes its check; A changes a line to consume Y and
--   commits; B inserts its output → X→Y→X. So this migration ALSO re-emits create_recipe_full and
--   add_recipe_output from their latest definer (0215), byte-faithful with additions only: the SAME
--   graph lock FIRST (before 0215's recipe row lock and 0187's per-item lock — a fixed order, so no
--   deadlock), then an in-transaction refusal via recipe_output_would_cycle: a new output item O on
--   recipe R closes a loop iff O is reachable from R's own inputs (mirrored by outputItemWouldCycle,
--   lib/recipe-graph-shared.ts). Signatures, SECURITY DEFINER, search_path and grants are unchanged.
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

create or replace function public.recipe_output_would_cycle(
  p_recipe_id uuid,
  p_item_id uuid
) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  -- A NEW output item O on recipe R closes a loop iff O is reachable from R's own inputs:
  -- R's input items, then every input item of every recipe that OUTPUTS a reached item.
  with recursive reach(item_id) as (
    select ri.component_item_id
      from public.recipe_inputs ri
     where ri.recipe_id = p_recipe_id
       and ri.component_item_id is not null
    union
    select ri.component_item_id
      from reach r
      join public.recipe_outputs ro on ro.output_item_id = r.item_id
      join public.recipe_inputs ri on ri.recipe_id = ro.recipe_id
     where ri.component_item_id is not null
  )
  select exists (select 1 from reach where item_id = p_item_id);
$$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- create_recipe_full ← 0215 (byte-faithful; additions only: the graph lock first, the
-- in-transaction output cycle refusal before the return). Pinned as a line-subsequence of 0215.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
create or replace function create_recipe_full(
  p_header jsonb, p_inputs jsonb, p_outputs jsonb, p_created_by uuid
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_recipe_id uuid; r jsonb; v_item_id uuid; v_clash uuid;
begin
  -- 0258 (Astra r2 #1): the recipe-graph write lock FIRST, so this output write serialises with
  -- every recipe-line write and every other output write (lib/recipe-graph-shared.ts).
  perform pg_advisory_xact_lock(7258025800);
  -- ── 0187 BLOCK A: serialise on every ITEM this call is about to produce ────
  -- Taken BEFORE the recipes insert, so the whole write is inside the lock and a
  -- concurrent caller naming the same item waits for our COMMIT rather than reading
  -- around it. Ordered by item id to give a deterministic acquisition order — two
  -- calls naming the same pair of items in opposite orders would otherwise deadlock.
  for v_item_id in
    select distinct nullif(value->>'output_item_id','')::uuid
    from jsonb_array_elements(coalesce(p_outputs,'[]'::jsonb)) as t(value)
    where nullif(value->>'output_item_id','') is not null
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended('recipe_active_producer:' || v_item_id::text, 0));

    -- Now re-ask, inside the lock, the question lib/recipes.ts asked outside it.
    select ro.recipe_id into v_clash
    from recipe_outputs ro
    join recipes rc on rc.id = ro.recipe_id
    where ro.output_item_id = v_item_id and rc.active = true
    limit 1;

    if v_clash is not null then
      raise exception 'duplicate_active_producer'
        using errcode = 'P0001',
              detail  = format('item %s already has an active producing recipe (%s)', v_item_id, v_clash);
    end if;
  end loop;
  -- ── end 0187 BLOCK A ───────────────────────────────────────────────────────

  -- 0215 batch-vs-bottle (ruling H): batch_mode requires exactly ONE output, and it must be an
  -- ITEM output (a menu-item output has no bulk container). Refused here, in the only transaction
  -- that can see the header and its outputs together.
  if coalesce((p_header->>'batch_mode')::boolean, false) then
    if jsonb_array_length(coalesce(p_outputs,'[]'::jsonb)) <> 1
       or nullif(coalesce(p_outputs,'[]'::jsonb)->0->>'output_item_id','') is null then
      raise exception 'batch_mode_single_output'
        using errcode = 'P0001',
              detail  = 'a batch_mode recipe needs exactly one ITEM output';
    end if;
  end if;
  if (p_header->>'shelf_life_days') is not null and (p_header->>'shelf_life_days')::integer <= 0 then
    raise exception 'invalid_shelf_life_days' using errcode = 'P0001';
  end if;
  insert into recipes (name, name_es, recipe_type, batch_yield, directions, directions_es, active, created_by, batch_mode, shelf_life_days)
  values (
    p_header->>'name', nullif(p_header->>'name_es',''), p_header->>'recipe_type',
    (p_header->>'batch_yield')::numeric, nullif(p_header->>'directions',''),
    nullif(p_header->>'directions_es',''), true, p_created_by,
    coalesce((p_header->>'batch_mode')::boolean, false), coalesce((p_header->>'shelf_life_days')::integer, 5)
  ) returning id into v_recipe_id;

  for r in select value from jsonb_array_elements(coalesce(p_inputs,'[]'::jsonb)) as t(value) loop
    insert into recipe_inputs (recipe_id, component_sku_id, component_item_id, component_product_id, quantity, unit, each_container_label, portioned, display_order, created_by)
    values (
      v_recipe_id, nullif(r->>'component_sku_id','')::uuid, nullif(r->>'component_item_id','')::uuid,
      nullif(r->>'component_product_id','')::uuid,
      (r->>'quantity')::numeric, nullif(r->>'unit',''), nullif(r->>'each_container_label',''),
      coalesce((r->>'portioned')::boolean, false), coalesce((r->>'display_order')::int, 0), p_created_by
    );
  end loop;

  for r in select value from jsonb_array_elements(coalesce(p_outputs,'[]'::jsonb)) as t(value) loop
    insert into recipe_outputs (recipe_id, output_item_id, output_menu_item_id, yield, output_container_label, display_order, created_by)
    values (
      v_recipe_id, nullif(r->>'output_item_id','')::uuid, nullif(r->>'output_menu_item_id','')::uuid,
      (r->>'yield')::numeric, nullif(r->>'output_container_label',''),
      coalesce((r->>'display_order')::int, 0), p_created_by
    );
  end loop;

  -- 0258 (Astra r2 #1): inside the lock, with this call's inputs AND outputs written, refuse an
  -- ITEM output that the new recipe's own inputs already reach (recipe_output_would_cycle).
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_outputs,'[]'::jsonb)) as t(value)
    where nullif(value->>'output_item_id','') is not null
      and public.recipe_output_would_cycle(v_recipe_id, nullif(value->>'output_item_id','')::uuid)
  ) then
    raise exception 'would_create_cycle' using errcode = 'P0001';
  end if;

  return v_recipe_id;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- add_recipe_output ← 0215 (byte-faithful; additions only: the graph lock first, the
-- in-transaction output cycle refusal before the insert). Pinned as a line-subsequence of 0215.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
create or replace function add_recipe_output(
  p_recipe_id uuid,
  p_output_item_id uuid,
  p_output_menu_item_id uuid,
  p_yield numeric,
  p_output_container_label text,
  p_created_by uuid
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_id uuid; v_order integer; v_clash uuid; v_batch_mode boolean;
begin
  -- 0258 (Astra r2 #1): the recipe-graph write lock FIRST, so this output write serialises with
  -- every recipe-line write and every other output write (lib/recipe-graph-shared.ts).
  perform pg_advisory_xact_lock(7258025800);
  -- 0215 batch-vs-bottle (ruling H): serialise EVERY output mutation on the recipe row, and a
  -- batch_mode recipe never gets a second output. The row lock is the serialisation point; the
  -- 0187 per-item advisory lock below still guards the one-active-producer rule.
  select r.batch_mode into v_batch_mode from recipes r where r.id = p_recipe_id for update;
  if not found then
    raise exception 'recipe_not_found' using errcode = 'P0001';
  end if;
  if coalesce(v_batch_mode, false) and exists (select 1 from recipe_outputs ro where ro.recipe_id = p_recipe_id) then
    raise exception 'batch_mode_single_output'
      using errcode = 'P0001',
            detail  = 'a batch_mode recipe already has its one output';
  end if;
  -- Same scope as the app check: the single-producer rule is about ITEMS only, so a
  -- menu-item output takes no lock and gets no check.
  if p_output_item_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('recipe_active_producer:' || p_output_item_id::text, 0));

    select ro.recipe_id into v_clash
    from recipe_outputs ro
    join recipes rc on rc.id = ro.recipe_id
    where ro.output_item_id = p_output_item_id
      and rc.active = true
      and ro.recipe_id <> p_recipe_id   -- excludeRecipeId, exactly as the app passes it
    limit 1;

    if v_clash is not null then
      raise exception 'duplicate_active_producer'
        using errcode = 'P0001',
              detail  = format('item %s already has an active producing recipe (%s)', p_output_item_id, v_clash);
    end if;
  end if;

  -- 0258 (Astra r2 #1): inside the lock, refuse an ITEM output this recipe's inputs already reach.
  if p_output_item_id is not null and public.recipe_output_would_cycle(p_recipe_id, p_output_item_id) then
    raise exception 'would_create_cycle' using errcode = 'P0001';
  end if;

  select coalesce(max(display_order), 0) + 1 into v_order
  from recipe_outputs where recipe_id = p_recipe_id;

  insert into recipe_outputs (recipe_id, output_item_id, output_menu_item_id, yield, output_container_label, display_order, created_by)
  values (p_recipe_id, p_output_item_id, p_output_menu_item_id, p_yield, nullif(p_output_container_label,''), v_order, p_created_by)
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.recipe_input_would_cycle(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.recipe_input_would_cycle(uuid, uuid, uuid) to service_role;
revoke all on function public.add_recipe_input_atomic(uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.add_recipe_input_atomic(uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid) to service_role;
revoke all on function public.update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean) from public, anon, authenticated;
grant execute on function public.update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean) to service_role;
revoke all on function public.recipe_output_would_cycle(uuid, uuid) from public, anon, authenticated;
grant execute on function public.recipe_output_would_cycle(uuid, uuid) to service_role;
-- The two re-emits keep 0215's grants exactly (CREATE OR REPLACE keeps them too; restated as 0215 did).
revoke execute on function create_recipe_full(jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function create_recipe_full(jsonb, jsonb, jsonb, uuid) to service_role;
revoke execute on function add_recipe_output(uuid, uuid, uuid, numeric, text, uuid) from public, anon, authenticated;
grant execute on function add_recipe_output(uuid, uuid, uuid, numeric, text, uuid) to service_role;

do $$ begin
  if exists (select 1 from information_schema.routine_privileges
              where routine_schema = 'public'
                and routine_name in ('recipe_input_would_cycle', 'add_recipe_input_atomic', 'update_recipe_input_atomic',
                                     'recipe_output_would_cycle', 'create_recipe_full', 'add_recipe_output')
                and grantee in ('PUBLIC', 'anon', 'authenticated')) then
    raise exception '0258: unexpected recipe-input RPC execute grant';
  end if;
end $$;

commit;
