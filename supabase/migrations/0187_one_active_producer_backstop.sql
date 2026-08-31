-- Migration 0187_one_active_producer_backstop
-- AUTHORED 2026-08-30. NOT YET APPLIED — GATE (LEAD/JUAN).
--
-- 0187: the one-active-producer invariant gets a DB backstop — a per-item advisory
-- lock taken inside the writing transaction, in create_recipe_full and in a new
-- add_recipe_output twin, so the check and the insert can no longer be split.
--
-- ── PROVENANCE (wiring audit, recipes-production cluster; PR #298's flag) ──────────────
-- lib/recipes.ts:261 documents the gap in its own words and declines to paper over it:
--
--     "KNOWN GAP, DELIBERATELY NOT PAPERED OVER (wiring audit 2026-08-29): this check and
--      the insert that follows it are NOT atomic, and there is no DB backstop — `active`
--      lives on `recipes`, not on `recipe_outputs`, so the state cannot be expressed as a
--      partial unique index on the outputs table (0103 creates only plain indexes). Two
--      genuinely concurrent writes can therefore both pass and commit two active producers
--      for one item. Closing it needs either a trigger / denormalised active mirror or an
--      advisory lock inside `create_recipe_full` — a migration, and its own decision."
--
-- The invariant: at most ONE `recipes` row with `active = true` may carry a
-- `recipe_outputs` row pointing at a given `items.id` through `output_item_id`. When it is
-- violated, readiness, the items page and the consumption engine each pick a DIFFERENT
-- arbitrary winner — three surfaces silently disagreeing about which recipe makes a thing.
--
-- TWO CALL SITES, ONE SHAPE. `createRecipeFull` (lib/recipes.ts:331) runs
-- `activeProducerExists` in the app and then commits its outputs inside a LATER, separate
-- transaction (the RPC). `addRecipeOutput` (lib/recipes.ts:460) runs the same read and then
-- spends two more round trips before a bare PostgREST insert. Both windows are wide, and
-- both are invisible: the loser does not fail, it succeeds and quietly creates the split.
--
-- ── WHY AN ADVISORY LOCK, AND NOT THE OTHER TWO OPTIONS ────────────────────────────────
-- The flag named three candidates. Only one of them both CLOSES the race and stays small.
--
--   · A UNIQUE INDEX cannot be written at all. A partial index predicate may reference
--     only columns of its own table, and the word `active` lives on `recipes`. This is not
--     a preference; it is why the gap exists.
--
--   · A DENORMALISED `recipes.active` MIRROR on recipe_outputs would make that index
--     writable — and costs a new column, a backfill over every existing row, a trigger on
--     `recipes` to fan a single `active` flip out to all of its outputs, a second trigger
--     (or default) to populate the mirror on insert, and a new invariant of its own: the
--     mirror must never disagree with its source. That is a schema arc, and it introduces
--     a second place where "is this recipe active?" is answered.
--
--   · A PLAIN TRIGGER DOES NOT ACTUALLY CLOSE THE RACE, which is the reason it is refused
--     here rather than chosen for being cheap. A trigger body runs an ordinary SELECT under
--     READ COMMITTED, and an ordinary SELECT cannot see another transaction's UNCOMMITTED
--     insert. Two concurrent writers therefore BOTH pass the trigger and BOTH commit —
--     exactly today's failure, moved from the app into the database and made harder to see.
--     Deferring the constraint trigger to commit time does not help: at commit each
--     transaction still cannot see the other's uncommitted rows. A trigger would only
--     re-implement the sequential check the app already performs correctly.
--
--   · A TRANSACTION-SCOPED ADVISORY LOCK, keyed on the ITEM, is the one mechanism that
--     serialises the two writers against each other. `pg_advisory_xact_lock` blocks the
--     second writer until the first COMMITS OR ROLLS BACK; the second then re-runs the
--     check and sees the committed row. No column, no backfill, no data migration, no
--     change to any read path, and the check moves into the same transaction as the insert
--     — which is the whole content of "atomic" here. The lock is released automatically at
--     end of transaction, so there is no leak path and nothing to clean up.
--
-- KEY DERIVATION. `pg_advisory_xact_lock(bigint)` over `hashtextextended(<uuid text>, 0)`
-- namespaced by a literal prefix, so this lock space cannot collide with any other advisory
-- lock the system might later take on the same uuid. Hash collisions between two DIFFERENT
-- items are harmless: a collision costs one unnecessary serialisation, never a wrong answer.
--
-- ── WHAT THIS DOES NOT CHANGE ─────────────────────────────────────────────────────────
--   · The app-layer check in lib/recipes.ts STAYS. It is the fast path and the one that can
--     answer a named 409 without a round trip into an exception. This migration makes it a
--     nicety rather than the only guard.
--   · MENU-ITEM outputs are untouched. `activeProducerExists` is called only when
--     `output_item_id` is non-null, because the single-producer assumption is about ITEMS;
--     the lock and the check below take the same scope, deliberately, so this file does not
--     smuggle in a new invariant while closing an old one.
--   · `recipe_outputs` gains no column and no index. Its shape on disk is identical.
--   · Retirement, resolution, and every read path are untouched.
--
-- ── THE ERROR CONTRACT, AND THE TS HALF THAT SHIPS WITH IT ────────────────────────────
-- Both functions raise ERRCODE 'P0001' with MESSAGE 'duplicate_active_producer', matching
-- the app-layer RecipeError code exactly. lib/recipes.ts's createRecipeFull previously
-- turned ANY rpc error into `throw new Error(...)` → an opaque 500 — the same failure mode
-- 0186's header indicts in lib/prep.ts. The mapping to a named 409 SHIPS IN THIS PR even
-- though the migration does not: pre-apply the branch is simply never taken (the RPC cannot
-- raise what it does not contain), so it is correct on both sides of the gate.
--
-- ── PRE-APPLY POSTURE: NO PROBE IS NEEDED, AND NONE IS ADDED ──────────────────────────
-- `create_recipe_full` is a CREATE OR REPLACE of a function that already exists with an
-- IDENTICAL signature, so the TS call site is byte-unchanged and nothing degrades pre-apply.
-- `add_recipe_output` is NEW and NOTHING CALLS IT IN THIS PR — shipped code may not call an
-- unapplied RPC, and the repo has no function-existence probe idiom (every probe in
-- lib/*-probes.ts is a table+column select). Wiring `addRecipeOutput` to it is the named
-- follow-up, to be done in the PR that lands after this gate opens; until then that path
-- keeps its app-layer check and its existing window, unchanged and no worse than today.
--
-- ── VERIFIED BEFORE AUTHORING (source, 2026-08-30) ────────────────────────────────────
--   · `create_recipe_full`'s authoritative body is 0179_product_identity.sql:207-249 (0105
--     defines an earlier 2-target version; 0179 supersedes it by adding
--     component_product_id). The body below is that file's body, copied mechanically; the
--     only edits are the two marked 0187 blocks. NOTE FOR THE GATE-RUNNER: 0179's own
--     header still reads "NOT YET APPLIED", but AGENTS.md records 0179-0181 as shipped and
--     live and lib/recipes.ts passes `component_product_id` with no probe gate — so 0179
--     WAS applied and its header is stale. Confirm prod's prosrc against 0179's body (the
--     0185/0186 md5 method) before applying this one; no checksum is asserted here because
--     this session had no MCP access to take one.
--   · `recipe_outputs` (0103_recipe_entities.sql:51-68) has NO unique index and NO column
--     mirroring recipes.active — only plain btree indexes on recipe_id, output_item_id and
--     output_menu_item_id, the two FKs, the yield/oz_alloc_share CHECKs, and the
--     recipe_outputs_exactly_one_target XOR CHECK. Re-confirmed by reading the file.
--   · `recipe_outputs` RLS is deny-all to user roles (0103:94-98); these functions are
--     SECURITY DEFINER and service-role-granted, matching 0105/0179's posture exactly.
--
-- ── APPLY ORDER (for whoever gates this) ──────────────────────────────────────────────
-- No data half: the invariant may already be violated in prod, and this file deliberately
-- does NOT repair existing rows — a backstop that also mutates history would make its own
-- apply unreviewable. The PR body carries the pre-apply SELECT that counts current
-- violations and the post-apply verification of the grants. Apply via MCP; then this file
-- IS the record. NOTHING IN THIS PR APPLIES IT.

-- ─────────────────────────────────────────────────────────────────────────────
-- (1) create_recipe_full — 0179's body, plus the lock + in-transaction check.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function create_recipe_full(
  p_header jsonb, p_inputs jsonb, p_outputs jsonb, p_created_by uuid
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_recipe_id uuid; r jsonb; v_item_id uuid; v_clash uuid;
begin
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

  insert into recipes (name, name_es, recipe_type, batch_yield, directions, directions_es, active, created_by)
  values (
    p_header->>'name', nullif(p_header->>'name_es',''), p_header->>'recipe_type',
    (p_header->>'batch_yield')::numeric, nullif(p_header->>'directions',''),
    nullif(p_header->>'directions_es',''), true, p_created_by
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

  return v_recipe_id;
end $$;

-- CREATE OR REPLACE preserves grants, but re-assert them: AGENTS.md's
-- REVOKE-FROM-PUBLIC lesson is that Supabase's default ACLs grant EXECUTE to anon
-- EXPLICITLY, so revoking from public alone is not enough. Verify after apply via
-- information_schema.routine_privileges.
revoke execute on function create_recipe_full(jsonb, jsonb, jsonb, uuid) from public;
revoke execute on function create_recipe_full(jsonb, jsonb, jsonb, uuid) from anon;
revoke execute on function create_recipe_full(jsonb, jsonb, jsonb, uuid) from authenticated;
grant  execute on function create_recipe_full(jsonb, jsonb, jsonb, uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- (2) add_recipe_output — the second writer, given the same protection.
--
-- NOTHING CALLS THIS YET (see the pre-apply posture note above). It exists so that
-- `addRecipeOutput`'s check-then-insert can be collapsed into one transaction in the
-- follow-up PR, instead of leaving half the invariant guarded and half of it not.
--
-- It reproduces exactly what lib/recipes.ts:460-470 does after its validation — the
-- display_order max, the insert, the returned id — and nothing more. Validation
-- (exactly-one-target, yield > 0, the cycle check) STAYS in the app: `outputWouldCycle`
-- walks the recipe graph and is not a thing to re-express in plpgsql.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function add_recipe_output(
  p_recipe_id uuid,
  p_output_item_id uuid,
  p_output_menu_item_id uuid,
  p_yield numeric,
  p_output_container_label text,
  p_created_by uuid
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_id uuid; v_order integer; v_clash uuid;
begin
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

  select coalesce(max(display_order), 0) + 1 into v_order
  from recipe_outputs where recipe_id = p_recipe_id;

  insert into recipe_outputs (recipe_id, output_item_id, output_menu_item_id, yield, output_container_label, display_order, created_by)
  values (p_recipe_id, p_output_item_id, p_output_menu_item_id, p_yield, nullif(p_output_container_label,''), v_order, p_created_by)
  returning id into v_id;

  return v_id;
end $$;

comment on function add_recipe_output(uuid, uuid, uuid, numeric, text, uuid) is
  'Append one recipe_outputs row, serialised per output_item_id by a transaction-scoped '
  'advisory lock so the one-active-producer check and the insert cannot be split. Raises '
  'P0001 duplicate_active_producer. Validation (exactly-one-target, yield > 0, the cycle '
  'check) stays in lib/recipes.ts — this function guards the race, not the payload.';

revoke execute on function add_recipe_output(uuid, uuid, uuid, numeric, text, uuid) from public;
revoke execute on function add_recipe_output(uuid, uuid, uuid, numeric, text, uuid) from anon;
revoke execute on function add_recipe_output(uuid, uuid, uuid, numeric, text, uuid) from authenticated;
grant  execute on function add_recipe_output(uuid, uuid, uuid, numeric, text, uuid) to service_role;
