# 0215 batch vs bottle — sim acceptance (SQL-level, for CC's sim run)

Run after `supabase/migrations/0215_batch_vs_bottle.sql` is applied to the SIM. Every block is a
pass/fail assertion — a `raise exception` is a failure. Nothing here touches prod. Replace the
`:item`, `:recipe`, `:instance`, `:tpl_item`, `:actor` placeholders with sim ids (an active
production recipe with ONE item output and a yield; an opening instance at `phase1_complete`
whose Phase 1 row for `:tpl_item` carries `opener_recount_back_up`; a user id).

## A. Concurrency — enable batch_mode vs add a second output can never make a 2-output batch recipe

Astra P1 #3. Both writers lock the recipe row (`set_recipe_batch_mode` / `update_recipe_atomic`
and `add_recipe_output`), so the two interleavings below both end in a legal state.

Session 1:
```sql
begin;
select set_recipe_batch_mode(:recipe, true, :actor);   -- holds the recipe row lock until commit
-- (do not commit yet)
```
Session 2 (blocks on the row lock until session 1 commits):
```sql
select add_recipe_output(:recipe, :item2, null, 4, null, :actor);
```
Session 1: `commit;` → session 2 must FAIL with `P0001 batch_mode_single_output`.

Reverse order — session 2 first (holds the lock after inserting output two), then session 1's
`set_recipe_batch_mode(:recipe, true, …)` blocks and, after session 2 commits, FAILS with
`batch_mode_single_output`.

Assertion (holds after either interleaving):
```sql
do $$
begin
  if exists (
    select 1 from recipes r
    where r.batch_mode
      and (select count(*) from recipe_outputs ro where ro.recipe_id = r.id) <> 1
  ) then raise exception 'ACCEPTANCE A FAILED: a batch_mode recipe has <> 1 outputs'; end if;
end $$;
```

## B. Backstop — a batch_mode recipe that is NOT eligible cannot save single-box (Astra P1 #4)

```sql
-- make the recipe ineligible without the lock path (sim only): a second output row
insert into recipe_outputs (recipe_id, output_item_id, yield, display_order, created_by)
values (:recipe, :item2, 4, 9, :actor);
-- a single-box save (p_batch omitted) must be REFUSED
do $$ begin
  perform save_phase2_item_atomic(:instance, :actor, :tpl_item, 6, null, null, null, null, null);
  raise exception 'ACCEPTANCE B FAILED: single-box save accepted on an ineligible batch_mode recipe';
exception when others then
  if sqlerrm not like '%batch_recipe_unresolved%' then raise; end if;
end $$;
delete from recipe_outputs where recipe_id = :recipe and output_item_id = :item2;
```

## C. Session sequence — toss 8 → batch_mode off → single-box correction → revoke (GO correction 1)

```sql
-- 1. batch save with a toss of 8 (bottled 2 from the new batch; backup 8 counted in Phase 1)
select save_phase2_item_atomic(:instance, :actor, :tpl_item, 2, null, null, null, null,
  '{"batches":1,"came_out_to":4,"tossed":8,"over_batch_reason":null}'::jsonb);
do $$ begin
  if (select tossed_qty from prep_batch_sessions where instance_id = :instance and template_item_id = :tpl_item) <> 8
  then raise exception 'ACCEPTANCE C1 FAILED: toss not recorded'; end if;
end $$;
-- 2. batch_mode off (one output, allowed)
select set_recipe_batch_mode(:recipe, false, :actor);
-- 3. single-box correction (p_batch omitted — now the correct shape)
select save_phase2_item_atomic(:instance, :actor, :tpl_item, 2, null, null, null, null, null);
-- 4. revoke the live Phase 2 row by SESSION KEY → toss retracted
select revoke_phase2_item_atomic(:instance,
  (select id from checklist_completions where instance_id = :instance and template_item_id = :tpl_item
     and prep_data ? 'phase2' and revoked_at is null and superseded_at is null),
  :actor, 're_enter_count', null);
do $$ begin
  if (select tossed_qty from prep_batch_sessions where instance_id = :instance and template_item_id = :tpl_item) <> 0
  then raise exception 'ACCEPTANCE C4 FAILED: toss not retracted by session key'; end if;
end $$;
```

## D. Toss attribution — unchanged saves keep tossed_at/tossed_by; the RPC returns previous/current (GO correction 3, Astra P2 #6)

```sql
select set_recipe_batch_mode(:recipe, true, :actor);
select save_phase2_item_atomic(:instance, :actor, :tpl_item, 2, null, null, null, null,
  '{"batches":1,"came_out_to":4,"tossed":8,"over_batch_reason":null}'::jsonb) -> 'tossPrevious';   -- 0
select pg_sleep(1);
-- same toss again, different actor → tossed_at / tossed_by unchanged, tossPrevious = tossCurrent = 8
with before as (select tossed_at, tossed_by from prep_batch_sessions where instance_id = :instance and template_item_id = :tpl_item)
select (save_phase2_item_atomic(:instance, :actor2, :tpl_item, 2, null, null, null, null,
  '{"batches":1,"came_out_to":4,"tossed":8,"over_batch_reason":null}'::jsonb)) as r,
  (select tossed_at from before) = (select tossed_at from prep_batch_sessions where instance_id = :instance and template_item_id = :tpl_item) as at_unchanged,
  (select tossed_by from before) = (select tossed_by from prep_batch_sessions where instance_id = :instance and template_item_id = :tpl_item) as by_unchanged;
-- expect: r->>'tossPrevious' = '8', r->>'tossCurrent' = '8', at_unchanged = by_unchanged = true
-- clearing the toss through a correction → tossPrevious 8, tossCurrent 0 (the lib audits backup.tossed)
select (save_phase2_item_atomic(:instance, :actor, :tpl_item, 2, null, null, null, null,
  '{"batches":1,"came_out_to":4,"tossed":0,"over_batch_reason":null}'::jsonb)) ->> 'tossCurrent';  -- 0
```

## E. produced_at / made_by are stamped once (ruling E / 5)

```sql
select (save_phase2_item_atomic(:instance, :actor2, :tpl_item, 3, null, null, null, null,
  '{"batches":1,"came_out_to":4,"tossed":0,"over_batch_reason":null}'::jsonb)) ->> 'madeBy';
-- expect :actor (the FIRST saver), not :actor2; producedAt = the first save's time
```
