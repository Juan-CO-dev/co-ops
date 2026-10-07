-- Migration 0218_yield_retrain_notes
-- AUTHORED 2026-10-07. NOT YET APPLIED — GATE (CC/JUAN). Sim first, prod on Juan's word.
-- APPLIED TO PROD 2026-10-07 (schema_migrations version 20261007211913, name '0218_yield_retrain_notes'; sim first, version 20261007211809). The line above is the authoring-time gate note, kept as history.
-- Provenance: batch vs bottle PHASE B (GO-coops-bvb-phaseB-2026-10-07 + the plan S r4 §5 addendum).
--   Juan, 2026-10-07: "Average of 10 batches and a nudge when it's off 15%… also we need to track
--   it being under and over… since under they are doing something wrong and same if it's over."
--   Recipe-level drift → a GM nudge with two buttons: Update recipe yield, or Retrain ("records a
--   retrain note naming the outlier makers; snoozes the nudge for the next 10 batches"). Never
--   auto-change a recipe. Employee-level drift → "Retrain <name> on <recipe>" for SL+.
--
-- Phase B is a computed READ over Phase A's capture (0215: productions.batches_made, came_out_to,
-- yield_at_time, made_by). This migration adds only what the two human ACTIONS need:
--
--   1. recipe_yield_retrain_notes — ONE row per Retrain tap. Append-only: the note IS the
--      accountability record ("who said this was a training problem, about whom, when"), and the
--      snooze is DERIVED at read time from it (lib/yield-stats-shared.ts snoozeState: the latest
--      note in scope stays quiet until `snooze_batches` more in-scope batches were produced after
--      `created_at`). No sweeper, no mutable counter.
--      ASSIGNMENT (Juan, 2026-10-07: "Retrain should be a GM option, and maybe he can assign a kh+
--      to help retrain whoever is not making the recipe right etc"): every note carries
--      `assigned_to` (the KH+ the GM picked, or the GM himself when he picked nobody) and a
--      `status` open → done with `done_at` / `done_by` / `done_note`. A KH+ assignee other than
--      the GM gets an OPEN note: it holds the nudge and shows on their "My shift" until marked done.
--      A SELF-retrain (no assignee, or the GM) is INSERTED already done (done_by = the GM,
--      done_at = now; CC r2): no task, and the nudge returns after the 10-batch snooze.
--      APPEND-ONLY CHOICE: a GUARDED ONE-TIME UPDATE, not an event row. service_role holds NO
--      UPDATE on the table at all; the only mutation is complete_yield_retrain (SECURITY
--      DEFINER), which flips status 'open' → 'done' exactly once, stamps the done_* columns, and
--      can touch nothing else (a second call raises retrain_already_done). The CHECK below makes
--      a half-done row unrepresentable. Why not a second "done" event table: the note and its
--      completion are one fact with one owner, every reader wants them together, and a separate
--      table would need its own "only one done per note" unique guard to say what this does.
--   2. update_recipe_output_yield(recipe, output item, yield, actor) — the SERIALISED writer for a
--      card's yield. Before this, no app path edited recipe_outputs.yield at all (outputs were
--      added and removed whole, 0187/0215). It takes the recipe row lock FIRST — the same
--      serialisation point as update_recipe_atomic / add_recipe_output / remove_recipe_output
--      (0215), so a yield edit can never interleave with a batch_mode toggle or an output change —
--      then the output row, writes one UPDATE and stamps the recipe's updated_at/updated_by.
--      Refuses (P0001, named): recipe_not_found · recipe_inactive · not_batch_recipe ·
--      edge_not_found · ambiguous_output · invalid_yield. The audit row (recipe_output.update,
--      destructive) is the lib's, written only after this succeeds (lib/recipes.ts).
--
-- RLS posture (new table): RLS on, REVOKE ALL from public/anon/authenticated, NO policies — the
--   0203 / 0214 / 0215 idiom; the only reader and writer is service-role. service_role holds
--   SELECT + INSERT only (no UPDATE/DELETE/TRUNCATE: append-only by grant, the 0217
--   station_events posture). LOCATION SCOPING is app-layer, inside the lib writer
--   (lib/yield-stats.ts recordYieldRetrain → lockLocationContext before any I/O);
--   tests/location-bind-differential.test.ts lists this table and that file.
-- Function grants: EXECUTE revoked from PUBLIC/anon/authenticated, granted to service_role
--   (AGENTS.md: "REVOKE FROM PUBLIC is NOT enough"); a DO block refuses to commit otherwise.
--
-- VERIFY AFTER APPLY:
--   select relrowsecurity from pg_class where oid = 'public.recipe_yield_retrain_notes'::regclass;      -- t
--   select policyname from pg_policies where tablename = 'recipe_yield_retrain_notes';                  -- NO ROWS
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name = 'recipe_yield_retrain_notes' and grantee in ('anon','authenticated','PUBLIC');  -- NO ROWS
--   select privilege_type from information_schema.role_table_grants
--    where table_name = 'recipe_yield_retrain_notes' and grantee = 'service_role' order by 1;           -- INSERT, SELECT
--   select grantee from information_schema.routine_privileges
--    where routine_name in ('update_recipe_output_yield','complete_yield_retrain')
--      and grantee in ('anon','authenticated','PUBLIC');                                              -- NO ROWS

begin;

-- ── Pre-flight (AGENTS.md: pre-flight every SQL emission against the live schema) ───────────
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'productions' and column_name = 'came_out_to') then
    raise exception '0218 pre-flight: productions.came_out_to missing (expected 0215)';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'recipes' and column_name = 'batch_mode') then
    raise exception '0218 pre-flight: recipes.batch_mode missing (expected 0215)';
  end if;
  if to_regclass('public.recipe_yield_retrain_notes') is not null then
    raise exception '0218 pre-flight: recipe_yield_retrain_notes already exists — 0218 applied twice?';
  end if;
end $$;

-- ── 1. recipe_yield_retrain_notes ───────────────────────────────────────────────────────────
create table public.recipe_yield_retrain_notes (
  id                uuid        primary key default gen_random_uuid(),
  location_id       uuid        not null references public.locations(id),
  recipe_id         uuid        not null references public.recipes(id),
  -- The batch recipe's single output item — the key productions headers carry (output_item_id).
  item_id           uuid        not null references public.items(id),
  scope             text        not null check (scope in ('recipe', 'maker')),
  -- scope = 'maker': the one maker this note is about; scope = 'recipe': null.
  maker_id          uuid        null references public.users(id),
  -- The makers the drift math named as outliers when the note was written (recipe scope), or
  -- the one maker (maker scope). Evidence, not a foreign key: the array is what the GM saw.
  outlier_user_ids  uuid[]      not null default '{}',
  note              text        null check (note is null or char_length(note) <= 500),
  -- The verdict at the time, so the record stands on its own after the window moves on.
  signed_drift      numeric     not null,
  batches_in_window integer     not null check (batches_in_window > 0),
  -- The nudge (or the maker's item) stays quiet until this many in-scope batches were produced
  -- after created_at. Juan: "snoozes the nudge for the next 10 batches".
  snooze_batches    integer     not null default 10 check (snooze_batches > 0),
  created_by        uuid        not null references public.users(id),
  created_at        timestamptz not null default now(),
  -- Who does the retraining: a KH+ at the shop the GM picked (level ≤ the GM's), or the GM.
  assigned_to       uuid        not null references public.users(id),
  status            text        not null default 'open' check (status in ('open', 'done')),
  done_at           timestamptz null,
  done_by           uuid        null references public.users(id),
  done_note         text        null check (done_note is null or char_length(done_note) <= 500),
  constraint recipe_yield_retrain_notes_scope_maker
    check ((scope = 'maker') = (maker_id is not null)),
  constraint recipe_yield_retrain_notes_done_shape
    check (case when status = 'done' then done_at is not null and done_by is not null
                else done_at is null and done_by is null and done_note is null end)
);
comment on table public.recipe_yield_retrain_notes is
  '0218 batch vs bottle Phase B: one row per Retrain tap on a yield-drift nudge (recipe scope) or a maker''s retrain item (maker scope). Append-only (service_role holds SELECT + INSERT only). The snooze is derived at read time: the latest note in scope stays quiet until snooze_batches more in-scope batch headers were produced after created_at. Deny-all RLS; written only by lib/yield-stats.ts recordYieldRetrain behind lockLocationContext.';
create index recipe_yield_retrain_notes_location_item_ix
  on public.recipe_yield_retrain_notes (location_id, item_id, created_at desc);

alter table public.recipe_yield_retrain_notes enable row level security;
revoke all on public.recipe_yield_retrain_notes from public, anon, authenticated;
grant select, insert on public.recipe_yield_retrain_notes to service_role;
revoke update, delete, truncate on public.recipe_yield_retrain_notes from service_role;
-- The assignee's "My shift" read: open retrains by (assignee, shop).
create index recipe_yield_retrain_notes_open_assignee_ix
  on public.recipe_yield_retrain_notes (assigned_to, location_id) where status = 'open';

-- ── 1b. complete_yield_retrain — the ONE guarded mutation of a note (open → done, once) ─────
-- Authorization (assignee or GM, bound to the shop) is the lib's (lib/yield-stats.ts
-- completeYieldRetrain), checked before this runs; this enforces the TRANSITION and the shop:
-- the row must exist at p_location_id and still be open, under its row lock.
create or replace function public.complete_yield_retrain(p_note_id uuid, p_location_id uuid, p_actor uuid, p_done_note text)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_status text;
  v_done_at timestamptz := now();
  v_note text := nullif(btrim(coalesce(p_done_note, '')), '');
begin
  select n.status into v_status from recipe_yield_retrain_notes n
   where n.id = p_note_id and n.location_id = p_location_id
   for update;
  if not found then
    raise exception 'retrain_not_found' using errcode = 'P0001';
  end if;
  if v_status <> 'open' then
    raise exception 'retrain_already_done' using errcode = 'P0001';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'invalid_note' using errcode = 'P0001';
  end if;
  update recipe_yield_retrain_notes
     set status = 'done', done_at = v_done_at, done_by = p_actor, done_note = v_note
   where id = p_note_id and status = 'open';
  return jsonb_build_object('id', p_note_id, 'done_at', v_done_at);
end $$;
comment on function public.complete_yield_retrain(uuid, uuid, uuid, text) is
  '0218: the only mutation of a recipe_yield_retrain_notes row — status open → done exactly once (row lock; retrain_already_done on a second call), stamping done_at/done_by/done_note. service_role holds no UPDATE on the table. Called only by lib/yield-stats.ts completeYieldRetrain after its assignee-or-GM + location checks.';
revoke all on function public.complete_yield_retrain(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.complete_yield_retrain(uuid, uuid, uuid, text) to service_role;

-- ── 2. update_recipe_output_yield — the serialised card-yield writer ────────────────────────
create or replace function public.update_recipe_output_yield(p_recipe_id uuid, p_output_item_id uuid, p_yield numeric, p_actor uuid)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_active boolean;
  v_batch_mode boolean;
  v_outputs integer;
  v_output_id uuid;
  v_before numeric;
begin
  -- The recipe row lock first: the one serialisation point every recipe/output writer shares (0215).
  select r.active, r.batch_mode into v_active, v_batch_mode from recipes r where r.id = p_recipe_id for update;
  if not found then
    raise exception 'recipe_not_found' using errcode = 'P0001';
  end if;
  if v_active is not true then
    raise exception 'recipe_inactive' using errcode = 'P0001';
  end if;
  if v_batch_mode is not true then
    raise exception 'not_batch_recipe' using errcode = 'P0001';
  end if;
  if p_yield is null or p_yield <= 0 or p_yield > 100000 then
    raise exception 'invalid_yield' using errcode = 'P0001';
  end if;
  select count(*) into v_outputs from recipe_outputs ro
   where ro.recipe_id = p_recipe_id and ro.output_item_id = p_output_item_id;
  if v_outputs = 0 then
    raise exception 'edge_not_found' using errcode = 'P0001';
  end if;
  if v_outputs > 1 then
    raise exception 'ambiguous_output' using errcode = 'P0001';
  end if;
  select ro.id, ro.yield into v_output_id, v_before from recipe_outputs ro
   where ro.recipe_id = p_recipe_id and ro.output_item_id = p_output_item_id
   for update;
  update recipe_outputs set yield = p_yield where id = v_output_id;
  update recipes set updated_at = now(), updated_by = p_actor where id = p_recipe_id;
  return jsonb_build_object('output_id', v_output_id, 'before', v_before, 'after', p_yield);
end $$;
comment on function public.update_recipe_output_yield(uuid, uuid, numeric, uuid) is
  '0218 (batch vs bottle Phase B): the serialised writer for a batch recipe card''s yield — recipe row lock, then the output row, one UPDATE; named P0001 refusals. Called only by lib/recipes.ts updateRecipeOutputYield (GM 7 + Tier-B step-up at the route), which writes the recipe_output.update audit row after success. Never called by code on its own: the yield nudge only ever offers it to a human.';
revoke all on function public.update_recipe_output_yield(uuid, uuid, numeric, uuid) from public, anon, authenticated;
grant execute on function public.update_recipe_output_yield(uuid, uuid, numeric, uuid) to service_role;

-- ── Grant self-check (the 0132/0189 law — verify, never assume) ─────────────────────────────
do $$ begin
  if exists (select 1 from information_schema.routine_privileges
              where routine_schema = 'public' and routine_name in ('update_recipe_output_yield', 'complete_yield_retrain')
                and grantee in ('PUBLIC', 'anon', 'authenticated') and privilege_type = 'EXECUTE') then
    raise exception '0218: unexpected update_recipe_output_yield execute grant';
  end if;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'recipe_yield_retrain_notes'
                and grantee in ('PUBLIC', 'anon', 'authenticated')) then
    raise exception '0218: unexpected recipe_yield_retrain_notes table grant';
  end if;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'recipe_yield_retrain_notes'
                and grantee = 'service_role' and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')) then
    raise exception '0218: recipe_yield_retrain_notes must be append-only for service_role';
  end if;
end $$;

commit;
