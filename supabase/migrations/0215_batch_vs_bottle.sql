-- Migration 0215_batch_vs_bottle
-- AUTHORED 2026-10-07. NOT YET APPLIED — GATE (CC/JUAN). Sim first, prod on Juan's word.
-- APPLIED TO PROD 2026-10-07 (schema_migrations version 20261007173306, name '0215_batch_vs_bottle'). The line above is the authoring-time gate note, kept as history.
-- Provenance: Juan's floor notes (2026-10-06): "Prep is conflating 2 things, creating the recipe
--   batch and getting it ready for service… we make the minimum batch, bottle 2 for service and
--   leave the other 2 in a single container to bottle when needed. Right now the system recounts
--   every time we bottle and depletes from the inventory…" and "We also have to consider that
--   sometimes we will need to make a double batch."
-- Design: plan S r4 (05-BRIDGE/to-cc/2026-10-07-batch-vs-bottle-plan-S-r4.md) + the build GO's
--   five corrections. The bulk container is COUNTED at every prep session (last night's AM prep
--   BACK UP at opening — docs/SPEC_AMENDMENTS.md:56 defines BACK UP as the unbottled quantity —
--   or the opener's two-box recount; the mid-day Phase 1 two-box count at mid-day). No ledger.
--
-- WHAT:
--   1. recipes            + batch_mode boolean NOT NULL DEFAULT false
--                         + shelf_life_days integer NOT NULL DEFAULT 5 (Juan: "Everything is 5 days")
--   2. opening_closer_count_snapshots + line_count, back_up_count (last night's LINE / BACK UP)
--   3. productions        + batches_made, came_out_to, yield_at_time, made_by (Phase B's inputs)
--   4. prep_batch_sessions — ONE row per (instance_id, template_item_id) batch session:
--      produced_at + made_by set at the FIRST batch save and never changed; tossed_qty upserted
--      on every save (tossed_at / tossed_by move only when the qty moves). Deny-all RLS.
--   5. prep_batch_context(template_item_id) — the ONE eligibility oracle every RPC below reads.
--   6. Re-emitted RPCs (bodies copied MECHANICALLY from their latest definers; the build's
--      tests/batch-vs-bottle-migration.test.ts proves each source body is a line-subsequence of
--      the body below, modulo an enumerated list of modified lines):
--        submit_phase1_atomic           ← 0185 (APPLIED; both branches + its three chain-edit
--                                          blocks preserved) + the two-box recount
--        submit_mid_day_phase1_atomic   ← 0060 + the LINE/BACK UP pair + server-derived total
--        create_opening_instance_atomic ← 0063 + the two snapshot columns
--        save_phase2_item_atomic        ← 0056 + p_batch + the batch branch (12 core + saved_at/
--                                          saved_by intact; supersede-before-insert intact)
--        save_mid_day_phase2_item_atomic← 0199 + p_batch + the batch branch (order intact)
--        submit_phase2_atomic           ← 0197 + need_for_line coalesce (cti.active intact)
--        create_recipe_full             ← 0187 + batch_mode/shelf_life_days + one-ITEM-output rule
--        add_recipe_output              ← 0187 + the recipe-row lock + single-output refusal
--      New: set_recipe_batch_mode, remove_recipe_output, update_recipe_atomic, revoke_phase2_item_atomic.
--
-- ROLLOUT: batch_mode is false on every recipe after this applies, so NOTHING changes until a
--   GM flips a recipe (the data step is a separate reviewed PR). Every re-emitted RPC takes its
--   new parameter with DEFAULT NULL, so the deployed app keeps working before and after.
--
-- RLS posture (new table): RLS on, REVOKE ALL from anon/authenticated/public, NO policies — the
--   0203 / 0214 idiom; the only reader and writer are service-role (the RPCs below + lib reads).
--   Grants on every function: EXECUTE revoked from PUBLIC/anon/authenticated, granted to
--   service_role (AGENTS.md: "REVOKE FROM PUBLIC is NOT enough").
--
-- VERIFY AFTER APPLY:
--   select column_name from information_schema.columns
--    where table_name = 'recipes' and column_name in ('batch_mode','shelf_life_days');        -- 2 rows
--   select column_name from information_schema.columns
--    where table_name = 'opening_closer_count_snapshots' and column_name in ('line_count','back_up_count'); -- 2
--   select column_name from information_schema.columns
--    where table_name = 'productions' and column_name in ('batches_made','came_out_to','yield_at_time','made_by'); -- 4
--   select relrowsecurity from pg_class where oid = 'public.prep_batch_sessions'::regclass;     -- t
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name = 'prep_batch_sessions' and grantee in ('anon','authenticated','PUBLIC');  -- NO ROWS
--   select policyname from pg_policies where tablename = 'prep_batch_sessions';                  -- NO ROWS
--   select routine_name, grantee from information_schema.routine_privileges
--    where routine_name in ('prep_batch_context','set_recipe_batch_mode','remove_recipe_output','update_recipe_atomic',
--      'revoke_phase2_item_atomic','save_phase2_item_atomic','save_mid_day_phase2_item_atomic',
--      'submit_phase1_atomic','submit_mid_day_phase1_atomic','submit_phase2_atomic',
--      'create_opening_instance_atomic','create_recipe_full','add_recipe_output')
--      and grantee in ('anon','authenticated','PUBLIC');                                          -- NO ROWS
--   select count(*) from recipes where batch_mode;                                                -- 0 (until the data step)

begin;

-- ── Pre-flight (AGENTS.md: pre-flight every SQL emission against the live schema) ───────────
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'recipes' and column_name = 'batch_yield') then
    raise exception '0215 pre-flight: recipes.batch_yield missing (expected 0103)';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'opening_closer_count_snapshots' and column_name = 'closer_count') then
    raise exception '0215 pre-flight: opening_closer_count_snapshots.closer_count missing (expected 0051)';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'productions' and column_name = 'instance_id') then
    raise exception '0215 pre-flight: productions.instance_id missing (expected 0102)';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'recipes' and column_name = 'batch_mode') then
    raise exception '0215 pre-flight: recipes.batch_mode already exists — 0215 applied twice?';
  end if;
end $$;

-- ── 1. recipes ──────────────────────────────────────────────────────────────────────────────
alter table public.recipes
  add column batch_mode boolean not null default false,
  add column shelf_life_days integer not null default 5 check (shelf_life_days > 0);
comment on column public.recipes.batch_mode is
  'Batch-vs-bottle eligibility (0215). false = the item keeps its single prepped box. true = prep enters batches made + came out to + bottled, and depletion is batches x the recipe; requires exactly ONE item output (set_recipe_batch_mode / add_recipe_output / remove_recipe_output / create_recipe_full enforce it under the recipe row lock). Flipped by the admin recipe builder (GM+) or the reviewed data step; never by code.';
comment on column public.recipes.shelf_life_days is
  'Days a bulk backup of this recipe keeps (0215). Juan 2026-10-06: "Everything is 5 days… add the days it will hold" — editable on recipe create and edit at the recipe-edit permission. Drives the "backup past shelf life — toss?" row state.';

-- ── 2. opening_closer_count_snapshots — last night's LINE and BACK UP beside the total ──────
alter table public.opening_closer_count_snapshots
  add column line_count numeric null,
  add column back_up_count numeric null;
comment on column public.opening_closer_count_snapshots.line_count is
  'Last night''s LINE-ready count for this item (the AM prep shape''s primary column: on_hand / portioned / line), frozen with the closer total (0215). NULL = no AM prep row, no LINE box, or blank.';
comment on column public.opening_closer_count_snapshots.back_up_count is
  'Last night''s BACK UP count — the bulk container (docs/SPEC_AMENDMENTS.md:56) — frozen with the closer total (0215). NULL = no AM prep row, no BACK UP box, or blank.';

-- ── 3. productions — what Phase B needs per batch header ───────────────────────────────────
alter table public.productions
  add column batches_made integer null check (batches_made is null or batches_made >= 0),
  add column came_out_to numeric null check (came_out_to is null or came_out_to >= 0),
  add column yield_at_time numeric null check (yield_at_time is null or yield_at_time > 0),
  add column made_by uuid null references public.users(id);
comment on column public.productions.batches_made is
  'Whole batches made in this prep session (0215). NULL = a single-box row. For a batch row output_qty = batches_made x yield_at_time (par units, THEORETICAL — lib/weights.ts and predictOutput read output_qty against input_oz); the measured output is came_out_to.';
comment on column public.productions.came_out_to is
  'Measured output of the batch session in the item''s par unit (0215; Juan: "came out to" on every batch). Phase B''s yield statistic is came_out_to / batches_made vs yield_at_time.';
comment on column public.productions.yield_at_time is
  'recipe_outputs.yield as the ONE graph the fold loaded saw it at save time (0215, ruling 3) — the standard Phase B compares against.';
comment on column public.productions.made_by is
  'The MAKER (0215, ruling 5): the actor of the session''s FIRST batch save, carried through corrections, revoke and re-entry. created_by stays the editor of this header.';

-- ── 4. prep_batch_sessions — one row per batch session, keyed on the Phase 2 row ────────────
create table public.prep_batch_sessions (
  instance_id        uuid        not null references public.checklist_instances(id),
  template_item_id   uuid        not null references public.checklist_template_items(id),
  location_id        uuid        not null references public.locations(id),
  item_id            uuid        not null references public.items(id),
  business_date      date        not null,
  source             text        not null check (source in ('opening_p2', 'mid_day_p2')),
  -- First batch save of this session; never updated (not in the upsert's SET list).
  produced_at        timestamptz not null,
  made_by            uuid        not null references public.users(id),
  -- This session's toss of the counted bulk backup. 0 = none / retracted by revoke.
  tossed_qty         numeric     not null default 0 check (tossed_qty >= 0),
  tossed_par_unit    text        null,
  tossed_at          timestamptz null,
  tossed_by          uuid        null references public.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (instance_id, template_item_id)
);
comment on table public.prep_batch_sessions is
  '0215 batch-vs-bottle: the identity of one batch prep SESSION = (instance_id, template_item_id) of the Phase 2 row (mid-day: the Phase 2 row, not 0199''s Phase 1 predecessor). Survives revoke and re-entry. produced_at / made_by are set at the first batch save and never changed; tossed_qty is the session''s toss (upserted; revoke_phase2_item_atomic retracts it to 0). Written ONLY by the RPCs; deny-all RLS (0203/0214 posture).';
create index prep_batch_sessions_location_item_date_ix
  on public.prep_batch_sessions (location_id, item_id, business_date);
create index prep_batch_sessions_waste_ix
  on public.prep_batch_sessions (location_id, tossed_at desc) where tossed_qty > 0;
alter table public.prep_batch_sessions enable row level security;
revoke all on public.prep_batch_sessions from anon, authenticated;
revoke all on public.prep_batch_sessions from public;

-- ── 5. prep_batch_context — the ONE eligibility oracle ─────────────────────────────────────
-- item → its single ACTIVE production recipe (first-wins order as lib/prep-consumption.ts
-- loadRecipeGraph: created_at NULLS FIRST, id) → batch_mode, output count, the item's own yield.
-- is_batch = batch_mode AND exactly one output AND it is this item AND yield > 0.
create or replace function public.prep_batch_context(p_template_item_id uuid)
returns table (item_id uuid, recipe_id uuid, batch_mode boolean, output_count integer, yield numeric, is_batch boolean)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  with ti as (
    select cti.item_id from checklist_template_items cti where cti.id = p_template_item_id
  ),
  producer as (
    select r.id as recipe_id, r.batch_mode
    from ti
    join recipe_outputs ro on ro.output_item_id = ti.item_id
    join recipes r on r.id = ro.recipe_id
    where r.active = true and r.recipe_type = 'production'
    order by r.created_at asc nulls first, r.id asc
    limit 1
  ),
  outs as (
    select count(*)::integer as output_count,
           max(case when ro.output_item_id = (select item_id from ti) then ro.yield end) as item_yield
    from producer p join recipe_outputs ro on ro.recipe_id = p.recipe_id
  )
  select ti.item_id,
         p.recipe_id,
         coalesce(p.batch_mode, false) as batch_mode,
         coalesce(o.output_count, 0) as output_count,
         o.item_yield as yield,
         (coalesce(p.batch_mode, false) and coalesce(o.output_count, 0) = 1 and coalesce(o.item_yield, 0) > 0) as is_batch
  from ti
  left join producer p on true
  left join outs o on true;
$function$;
revoke execute on function public.prep_batch_context(uuid) from public, anon, authenticated;
grant execute on function public.prep_batch_context(uuid) to service_role;

-- ── set_recipe_batch_mode — the toggle, serialised on the recipe row ───────────────────────
create or replace function public.set_recipe_batch_mode(p_recipe_id uuid, p_on boolean, p_actor uuid)
returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_active boolean; v_item_outputs integer; v_outputs integer;
begin
  select r.active into v_active from recipes r where r.id = p_recipe_id for update;
  if not found then
    raise exception 'recipe_not_found' using errcode = 'P0001';
  end if;
  if p_on then
    select count(*), count(*) filter (where ro.output_item_id is not null and ro.yield > 0)
    into v_outputs, v_item_outputs
    from recipe_outputs ro where ro.recipe_id = p_recipe_id;
    if v_outputs <> 1 or v_item_outputs <> 1 then
      raise exception 'batch_mode_single_output'
        using errcode = 'P0001',
              detail  = format('recipe %s has %s output(s); batch_mode needs exactly one ITEM output with yield > 0', p_recipe_id, v_outputs);
    end if;
  end if;
  update recipes set batch_mode = p_on, updated_at = now(), updated_by = p_actor where id = p_recipe_id;
end $$;
comment on function public.set_recipe_batch_mode(uuid, boolean, uuid) is
  '0215: flip recipes.batch_mode under the recipe row lock; on requires exactly one ITEM output with yield > 0 (P0001 batch_mode_single_output). The audit row is the lib''s (recipe.update).';
revoke execute on function public.set_recipe_batch_mode(uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.set_recipe_batch_mode(uuid, boolean, uuid) to service_role;

-- ── remove_recipe_output — the remove path, serialised on the recipe row ───────────────────
create or replace function public.remove_recipe_output(p_output_id uuid, p_actor uuid)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_recipe_id uuid; v_batch_mode boolean; v_remaining integer; v_before jsonb;
begin
  select ro.recipe_id into v_recipe_id from recipe_outputs ro where ro.id = p_output_id;
  if not found then
    raise exception 'edge_not_found' using errcode = 'P0001';
  end if;
  select r.batch_mode into v_batch_mode from recipes r where r.id = v_recipe_id for update;
  select count(*) into v_remaining from recipe_outputs ro where ro.recipe_id = v_recipe_id and ro.id <> p_output_id;
  if coalesce(v_batch_mode, false) and v_remaining = 0 then
    raise exception 'batch_mode_single_output'
      using errcode = 'P0001',
            detail  = 'cannot remove the sole output of a batch_mode recipe; turn batch mode off first';
  end if;
  select to_jsonb(ro) into v_before from recipe_outputs ro where ro.id = p_output_id;
  delete from recipe_outputs where id = p_output_id;
  return v_before;
end $$;
comment on function public.remove_recipe_output(uuid, uuid) is
  '0215: delete one recipe_outputs row under its recipe''s row lock; refuses the sole output of a batch_mode recipe (P0001 batch_mode_single_output). Returns the deleted row for the lib''s audit (recipe_output.remove).';
revoke execute on function public.remove_recipe_output(uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_recipe_output(uuid, uuid) to service_role;

-- ── update_recipe_atomic — header patch + batch_mode toggle in ONE serialised transaction ────
-- Astra P2 #8 (BC-007/033): the lib used to write the header columns and THEN call
-- set_recipe_batch_mode; a refused toggle left the header changed and unaudited. Here the recipe
-- row is locked first, every validation runs, and one UPDATE writes everything — or nothing.
-- p_patch keys (all optional): name, name_es, batch_yield, directions, directions_es,
-- shelf_life_days. p_batch_mode NULL = leave the flag alone.
create or replace function public.update_recipe_atomic(p_recipe_id uuid, p_patch jsonb, p_batch_mode boolean, p_actor uuid)
returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_active boolean; v_item_outputs integer; v_outputs integer; v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
begin
  select r.active into v_active from recipes r where r.id = p_recipe_id for update;
  if not found then
    raise exception 'recipe_not_found' using errcode = 'P0001';
  end if;
  if v_patch ? 'name' and nullif(btrim(v_patch->>'name'), '') is null then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;
  if v_patch ? 'batch_yield' and coalesce((v_patch->>'batch_yield')::numeric, 0) <= 0 then
    raise exception 'invalid_batch_yield' using errcode = 'P0001';
  end if;
  if v_patch ? 'shelf_life_days' and (v_patch->>'shelf_life_days' is null or (v_patch->>'shelf_life_days')::integer <= 0) then
    raise exception 'invalid_shelf_life_days' using errcode = 'P0001';
  end if;
  if p_batch_mode is true then
    select count(*), count(*) filter (where ro.output_item_id is not null and ro.yield > 0)
    into v_outputs, v_item_outputs
    from recipe_outputs ro where ro.recipe_id = p_recipe_id;
    if v_outputs <> 1 or v_item_outputs <> 1 then
      raise exception 'batch_mode_single_output'
        using errcode = 'P0001',
              detail  = format('recipe %s has %s output(s); batch_mode needs exactly one ITEM output with yield > 0', p_recipe_id, v_outputs);
    end if;
  end if;
  update recipes set
    name            = case when v_patch ? 'name' then btrim(v_patch->>'name') else name end,
    name_es         = case when v_patch ? 'name_es' then nullif(btrim(v_patch->>'name_es'), '') else name_es end,
    batch_yield     = case when v_patch ? 'batch_yield' then (v_patch->>'batch_yield')::numeric else batch_yield end,
    directions      = case when v_patch ? 'directions' then nullif(btrim(v_patch->>'directions'), '') else directions end,
    directions_es   = case when v_patch ? 'directions_es' then nullif(btrim(v_patch->>'directions_es'), '') else directions_es end,
    shelf_life_days = case when v_patch ? 'shelf_life_days' then (v_patch->>'shelf_life_days')::integer else shelf_life_days end,
    batch_mode      = case when p_batch_mode is null then batch_mode else p_batch_mode end,
    updated_at      = now(),
    updated_by      = p_actor
  where id = p_recipe_id;
end $$;
comment on function public.update_recipe_atomic(uuid, jsonb, boolean, uuid) is
  '0215 (Astra P2 #8): recipe header patch + batch_mode toggle under the recipe row lock, one UPDATE; a refused toggle (P0001 batch_mode_single_output) persists nothing. The audit row is the lib''s (recipe.update), written only on success.';
revoke execute on function public.update_recipe_atomic(uuid, jsonb, boolean, uuid) from public, anon, authenticated;
grant execute on function public.update_recipe_atomic(uuid, jsonb, boolean, uuid) to service_role;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 6a. submit_phase1_atomic ← 0185 (both branches + three chain-edit blocks) + two-box recount
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.submit_phase1_atomic(
  p_opening_instance_id uuid,
  p_actor_id uuid,
  p_entries jsonb,
  p_section_verifications jsonb DEFAULT NULL,
  p_opener_no_prior_data_reason text DEFAULT NULL,
  p_is_update boolean DEFAULT false,
  p_original_submission_id uuid DEFAULT NULL,
  p_changed_fields jsonb DEFAULT NULL,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  -- Pre-load context
  v_location_id uuid;
  v_opening_date date;
  v_location_code text;
  v_actor_name text;
  v_submitted_at timestamptz := now();

  -- Per-entry locals
  v_entry jsonb;
  v_phase text;
  v_template_item_id uuid;
  v_item_label text;
  v_section_key text;
  v_section_verified boolean;
  v_count_value numeric;
  v_photo_id uuid;
  v_notes text;
  v_spot_check_status text;          -- input from entry payload
  v_resolved_spot_check_status text; -- server-derived (flagged_recount | matched_via_section_verify)
  v_opener_recount numeric;
  v_closer_count numeric;
  v_par_value numeric;
  v_ground_truth numeric;
  v_prep_need numeric;
  v_count_provenance text;           -- C.54: 'closer_captured' | 'reconstructed_morning' | NULL
  v_prep_data_phase1 jsonb;

  -- Section lookup map + verified section keys
  v_section_by_item_id jsonb;
  v_verified_sections text[] := ARRAY[]::text[];
  v_section_ver jsonb;

  -- Completion + submission state
  v_completion_id uuid;
  v_completion_ids uuid[] := ARRAY[]::uuid[];
  v_submission_id uuid;
  v_opening_instance_row jsonb;

  -- C.54 NULL-source per-instance state (Pattern A)
  v_has_null_source boolean := false;
  v_null_source_count int := 0;
  v_null_source_notif_id uuid;

  -- Counters returned to the JS layer for opening.phase1_submit audit metadata
  v_stations_verified int := 0;
  v_items_recounted int := 0;
  v_provenance_markers_set int := 0;

  -- Notification dispatch
  v_notif_title text;

  -- C.46 chain-edit state
  v_chain_head_row checklist_submissions%ROWTYPE;
  v_original_completion_id uuid;
  v_original_count_provenance text;  -- §9 preservation read
  v_max_edit_count int;
  v_new_edit_count int;
  -- 0185: the live completion head this chain edit supersedes (NULL when the
  -- item has no live head — a revoked or already-superseded original).
  v_superseded_completion_id uuid;
  -- 0215 batch-vs-bottle: the two-box recount (LINE + BACK UP) on batch_mode items.
  v_recount_line numeric;
  v_recount_back_up numeric;
  v_entry_is_batch boolean;
BEGIN
  -- ──── Pre-load instance + location ────
  --
  -- The locations FK on checklist_instances guarantees the JOIN never
  -- drops a row when the instance exists — so a NULL v_location_id here
  -- unambiguously means "instance not found."
  --
  -- Note: 0053:182-193 used a single 3-way JOIN (instance + locations +
  -- users) with a single disjunctive "instance OR actor not found" raise.
  -- That collapses two distinct failure modes (bad instance vs bad actor)
  -- into one error message, misattributing the failure. Per Triad A code-
  -- gate review 2026-05-26, the instance lookup and actor lookup are
  -- separated below so each failure raises with its own precise message.
  -- Both still raise as foreign_key_violation so the JS-side translation
  -- behavior is preserved.
  SELECT ci.location_id, ci.date, l.code
  INTO v_location_id, v_opening_date, v_location_code
  FROM checklist_instances ci
  JOIN locations l ON l.id = ci.location_id
  WHERE ci.id = p_opening_instance_id;

  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'submit_phase1_atomic: opening instance % not found',
      p_opening_instance_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- ──── Pre-load actor display name ────
  --
  -- Separated from the instance lookup above (Triad A fix-1 ruling) so
  -- a missing actor raises distinctly from a missing instance. Both
  -- raises still use foreign_key_violation; the JS layer's mapOpeningError
  -- translation behavior is unchanged.
  SELECT name INTO v_actor_name FROM users WHERE id = p_actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'submit_phase1_atomic: actor % not found',
      p_actor_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- ──── Pre-load section assignments for Phase 1 items in p_entries ────
  --
  -- Builds a JSONB lookup { template_item_id::text -> section_key } from
  -- checklist_template_items.prep_meta->>'section'. Single query for the
  -- whole batch (manageable for current scale of ~10-15 spot-check items).
  -- Mirrors 0053:199-206.
  SELECT jsonb_object_agg(cti.id::text, cti.prep_meta->>'section')
  INTO v_section_by_item_id
  FROM checklist_template_items cti
  WHERE cti.id IN (
    SELECT (entry->>'templateItemId')::uuid
    FROM jsonb_array_elements(p_entries) entry
    WHERE COALESCE(entry->>'phase', 'phase1') = 'phase1'
  );

  -- ──── Pre-extract verified section keys → text[] ────
  --
  -- Empty array when no sections verified (legitimate state when all
  -- items are individually recounted). Mirrors 0053:212-220.
  IF p_section_verifications IS NOT NULL AND p_section_verifications <> 'null'::jsonb THEN
    SELECT array_agg(sv->>'sectionKey')
    INTO v_verified_sections
    FROM jsonb_array_elements(p_section_verifications) sv
    WHERE (sv->>'verified')::boolean = TRUE;
  END IF;
  IF v_verified_sections IS NULL THEN
    v_verified_sections := ARRAY[]::text[];
  END IF;

  IF NOT p_is_update THEN
    -- ════════════════════════════════════════════════════════════════════
    -- ORIGINAL-SUBMISSION PATH
    -- ════════════════════════════════════════════════════════════════════

    -- ──── Loop entries: per-item validation, server compute, INSERT ────
    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
    LOOP
      v_phase := COALESCE(v_entry->>'phase', 'phase1');
      IF v_phase <> 'phase1' THEN
        RAISE EXCEPTION 'submit_phase1_atomic: unexpected phase "%" in entry % (expected phase1)',
          v_phase, v_entry->>'templateItemId'
          USING ERRCODE = 'check_violation';
      END IF;

      v_template_item_id := (v_entry->>'templateItemId')::uuid;

      SELECT label INTO v_item_label
      FROM checklist_template_items
      WHERE id = v_template_item_id;

      -- Extract top-level fields (countValue/photoId/notes apply to ALL
      -- Phase 1 items — fridge temps, cleanliness notes, etc.)
      v_count_value := NULLIF(v_entry->>'countValue', '')::numeric;
      v_photo_id := NULLIF(v_entry->>'photoId', '')::uuid;
      v_notes := NULLIF(v_entry->>'notes', '');

      -- Discriminator: spotCheckStatus IS NULL on non-spot-check Phase 1
      -- items (cleanliness, station-ready ticks). Spot-check items always
      -- carry a non-null spotCheckStatus per OpeningEntryPhase1's contract
      -- (lib/types.ts:797 — "NULL on non-spot-check items").
      v_spot_check_status := NULLIF(v_entry->>'spotCheckStatus', '');
      v_opener_recount := CASE
        WHEN v_entry->>'openerRecount' IS NULL THEN NULL
        ELSE NULLIF(v_entry->>'openerRecount', '')::numeric
      END;
      -- 0215 batch-vs-bottle (ruling F): a batch_mode item's recount is TWO boxes — LINE
      -- (ready) and BACK UP (the bulk container). The server derives the total, so Phase 1's
      -- ground_truth / prep_need keep their count-total semantics. A total-only recount on a
      -- batch item is REFUSED (never coalesced to the closer LINE); a non-batch item ignores
      -- the two boxes entirely. Identical in the original and the chain-edit branch.
      v_recount_line := CASE
        WHEN v_entry->'openerRecountLine' IS NULL OR v_entry->'openerRecountLine' = 'null'::jsonb THEN NULL
        ELSE NULLIF(v_entry->>'openerRecountLine', '')::numeric
      END;
      v_recount_back_up := CASE
        WHEN v_entry->'openerRecountBackUp' IS NULL OR v_entry->'openerRecountBackUp' = 'null'::jsonb THEN NULL
        ELSE NULLIF(v_entry->>'openerRecountBackUp', '')::numeric
      END;
      SELECT c.is_batch INTO v_entry_is_batch FROM public.prep_batch_context(v_template_item_id) c;
      IF COALESCE(v_entry_is_batch, false) THEN
        IF (v_recount_line IS NULL) <> (v_recount_back_up IS NULL) THEN
          RAISE EXCEPTION 'submit_phase1_atomic: recount_split_incomplete for item % (%) — a batch item recount needs BOTH line and bulk backup',
            v_template_item_id, v_item_label
            USING ERRCODE = 'P0001';
        END IF;
        IF v_recount_line IS NOT NULL THEN
          IF v_recount_line < 0 OR v_recount_back_up < 0 THEN
            RAISE EXCEPTION 'submit_phase1_atomic: recount_split_negative for item % (%)',
              v_template_item_id, v_item_label
              USING ERRCODE = 'P0001';
          END IF;
          v_opener_recount := v_recount_line + v_recount_back_up;
        ELSIF v_opener_recount IS NOT NULL THEN
          RAISE EXCEPTION 'submit_phase1_atomic: recount_split_required for item % (%) — a batch item recount must be entered as line + bulk backup',
            v_template_item_id, v_item_label
            USING ERRCODE = 'P0001';
        END IF;
      ELSE
        v_recount_line := NULL;
        v_recount_back_up := NULL;
      END IF;

      IF v_spot_check_status IS NOT NULL THEN
        -- ════ SPOT-CHECK ITEM ════
        v_section_key := v_section_by_item_id->>(v_template_item_id::text);
        v_section_verified := v_section_key IS NOT NULL
          AND v_section_key = ANY(v_verified_sections);

        -- Read closer-count snapshot (materialized at instance create per
        -- migration 0052). closer_count IS NULLABLE — that nullability IS
        -- the C.54 NULL-source signal.
        SELECT closer_count, par_value
        INTO v_closer_count, v_par_value
        FROM opening_closer_count_snapshots
        WHERE opening_instance_id = p_opening_instance_id
          AND template_item_id = v_template_item_id;

        -- ──── Responsibility 1: verification gate (resolution rule) ────
        --
        -- Resolution rule per brief:
        --   non-NULL closer_count → section-verify OR recount (either valid)
        --   NULL closer_count     → recount ONLY (section-verify NOT a valid
        --                            path; you cannot verify-as-correct a
        --                            count that doesn't exist)
        --
        -- The NULL-closer-section-verified-without-recount case is the
        -- typed-error site that maps to OpeningNullSourceRequiresRecountError
        -- via mapOpeningError (Aggie's A2 lane; lib/opening.ts:208 + 79).
        IF v_closer_count IS NULL
           AND v_opener_recount IS NULL
           AND v_section_verified THEN
          RAISE EXCEPTION 'submit_phase1_atomic: null_source_requires_recount for item % (%) — closer_count IS NULL and item was section-verified; a per-item recount is required (section-verify is not a valid resolution for NULL-source items)',
            v_template_item_id, v_item_label
            USING ERRCODE = 'P0001';
        END IF;

        -- General unresolved gate covers both NULL-closer-no-recount-no-verify
        -- AND non-NULL-closer-no-recount-no-verify cases. The discriminating
        -- raise above fires first when applicable; this is the catch-all.
        IF v_opener_recount IS NULL AND NOT v_section_verified THEN
          RAISE EXCEPTION 'submit_phase1_atomic: ground_truth_unresolved for item % (%) — section not verified AND opener_recount IS NULL',
            v_template_item_id, v_item_label
            USING ERRCODE = 'P0001';
        END IF;

        -- ──── Responsibility 4: server compute (ground_truth + prep_need) ────
        --
        -- ground_truth = openerRecount IF NOT NULL ELSE closer_count (which
        -- is NOT NULL here because the gate above eliminated the
        -- NULL/NULL case). Server is authoritative — client's groundTruthCount
        -- is a UX hint only.
        v_ground_truth := COALESCE(v_opener_recount, v_closer_count);
        IF v_ground_truth IS NULL THEN
          RAISE EXCEPTION 'submit_phase1_atomic: ground_truth_unresolved for item % (%) — closer_count NULL AND opener_recount NULL despite gate-pass (defensive)',
            v_template_item_id, v_item_label
            USING ERRCODE = 'P0001';
        END IF;

        -- prep_need = MAX(0, par - ground_truth). NULL when par is NULL
        -- (par-null items have no prep_need semantic).
        v_prep_need := CASE
          WHEN v_par_value IS NOT NULL
            THEN GREATEST(0, v_par_value - v_ground_truth)
          ELSE NULL
        END;

        -- ──── Responsibility 5: C.54 NULL-source detection (per-item) ────
        --
        -- count_provenance = 'reconstructed_morning' when the source closer
        -- count was absent and the morning recount is the new source of
        -- truth; else 'closer_captured'. Pattern A: set v_has_null_source on
        -- ANY reconstructed_morning entry; dispatch ONE notification post-loop.
        IF v_opener_recount IS NOT NULL AND v_closer_count IS NULL THEN
          v_count_provenance := 'reconstructed_morning';
          v_has_null_source := true;
          v_null_source_count := v_null_source_count + 1;
        ELSE
          v_count_provenance := 'closer_captured';
        END IF;
        v_provenance_markers_set := v_provenance_markers_set + 1;

        -- Spot-check status discriminator (OpeningSpotCheckStatus enum):
        --   'flagged_recount'              → opener provided a recount
        --   'matched_via_section_verify'   → opener tapped section verify only
        v_resolved_spot_check_status := CASE
          WHEN v_opener_recount IS NOT NULL THEN 'flagged_recount'
          ELSE 'matched_via_section_verify'
        END;

        IF v_opener_recount IS NOT NULL THEN
          v_items_recounted := v_items_recounted + 1;
        END IF;

        -- Build prep_data->phase1 — invariant shape for Phase 2's downstream
        -- read. All 8 fields persist regardless of section-verify vs recount
        -- path (consistent with C.50 §8.4 invariant pattern for Phase 2).
        --
        -- ⚠ PHASE 2 CONTRACT DEPENDENCY (Triad A code-gate item 3, 2026-05-26):
        -- The Phase 2 RPC (submit_phase2_atomic, downstream commit) will
        -- READ this JSONB to source the persisted ground_truth_count + prep_need
        -- when computing delta_vs_prep_need. The exact key names below are
        -- the binding contract for Phase 2's reader:
        --   • prep_data->'phase1'->>'phase'              (always 1)
        --   • prep_data->'phase1'->>'closer_count'       (numeric or null)
        --   • prep_data->'phase1'->>'opener_recount'     (numeric or null)
        --   • prep_data->'phase1'->>'section_verified'   (boolean)
        --   • prep_data->'phase1'->>'ground_truth_count' (numeric, NOT NULL on spot-check items)
        --   • prep_data->'phase1'->>'prep_need'          (numeric or null when par_value is null)
        --   • prep_data->'phase1'->>'par_value'          (numeric or null)
        --   • prep_data->'phase1'->>'spot_check_status'  ('flagged_recount' | 'matched_via_section_verify')
        -- When Phase 2's RPC ships, the reader MUST be checked against these
        -- exact keys; any rename here is a Phase 2 break and requires the
        -- coupled-commit discipline (AGENTS.md "wire-shape coupling at
        -- architectural level, not conversational level").
        v_prep_data_phase1 := jsonb_build_object(
          'phase', 1,
          'closer_count', v_closer_count,
          'opener_recount', v_opener_recount,
          'section_verified', v_section_verified,
          'ground_truth_count', v_ground_truth,
          'prep_need', v_prep_need,
          'par_value', v_par_value,
          'spot_check_status', v_resolved_spot_check_status
        );
        -- 0215 batch-vs-bottle: the split rides BESIDE the 8-key contract (never replaces a key).
        IF COALESCE(v_entry_is_batch, false) THEN
          v_prep_data_phase1 := v_prep_data_phase1 || jsonb_build_object(
            'opener_recount_line', v_recount_line,
            'opener_recount_back_up', v_recount_back_up
          );
        END IF;

      ELSE
        -- ════ NON-SPOT-CHECK ITEM (cleanliness, station-ready, fridge temp) ════
        --
        -- No snapshot read, no ground-truth derivation, no provenance
        -- marker (count_provenance stays NULL — the C.54 marker only applies
        -- to items whose count was either closer-captured or morning-
        -- reconstructed; a cleanliness tick has no count semantic at all).
        v_count_provenance := NULL;
        v_prep_data_phase1 := NULL;
      END IF;

      -- INSERT the completion. count_provenance is set per the discriminator
      -- above; prep_data carries the Phase 1 metadata blob (or NULL for
      -- non-spot-check items where there's nothing to record beyond
      -- count_value/photo_id/notes).
      INSERT INTO checklist_completions (
        instance_id, template_item_id, completed_by, completed_at,
        count_value, photo_id, notes, prep_data, count_provenance
      )
      VALUES (
        p_opening_instance_id,
        v_template_item_id,
        p_actor_id,
        v_submitted_at,
        v_count_value,
        v_photo_id,
        v_notes,
        CASE
          WHEN v_prep_data_phase1 IS NOT NULL
            THEN jsonb_build_object('phase1', v_prep_data_phase1)
          ELSE NULL
        END,
        v_count_provenance
      )
      RETURNING id INTO v_completion_id;

      v_completion_ids := array_append(v_completion_ids, v_completion_id);
    END LOOP;

    -- ──── Responsibility 6: C.54 attestation gate (per-instance) ────
    --
    -- When ANY entry above set v_has_null_source, the opener MUST have
    -- supplied the no-prior-data attestation. Raises P0001 'provenance_
    -- required' which the JS layer maps to OpeningProvenanceRequiredError
    -- (lib/opening.ts:182).
    --
    -- The CHECK constraint on opener_no_prior_data_reason (migration 0054)
    -- enforces the enum values at write time, but we surface a friendlier
    -- error here so bad values raise as P0001 instead of as a 23514 check
    -- violation with a noisy constraint name.
    IF v_has_null_source THEN
      IF p_opener_no_prior_data_reason IS NULL THEN
        RAISE EXCEPTION 'submit_phase1_atomic: provenance_required for instance % — at least one item resolved via reconstructed_morning provenance; opener_no_prior_data_reason is required',
          p_opening_instance_id
          USING ERRCODE = 'P0001';
      END IF;
      IF p_opener_no_prior_data_reason NOT IN ('planned_closure', 'missed_or_unknown') THEN
        RAISE EXCEPTION 'submit_phase1_atomic: provenance_required for instance % — invalid p_opener_no_prior_data_reason "%": expected one of (planned_closure, missed_or_unknown)',
          p_opening_instance_id, p_opener_no_prior_data_reason
          USING ERRCODE = 'P0001';
      END IF;

      UPDATE checklist_instances
      SET opener_no_prior_data_reason = p_opener_no_prior_data_reason
      WHERE id = p_opening_instance_id;
    END IF;

    -- ──── Responsibility 7: C.54 notification dispatch (per-instance, single) ────
    --
    -- Pattern A: v_has_null_source was set in the entries loop above; we
    -- dispatch ONE notification here (NOT N-per-item). Recipients mirror
    -- 0053:462-482 verbatim per the brief — the IN-list is correct because
    -- current_user_role_level() reads the caller's role, useless for
    -- resolving target users' roles.
    --
    -- Notification type 'opening_no_prior_data_alert' is a new value in the
    -- lib/notifications.ts NOTIFICATION_TYPES vocabulary; Aggie's lib lane
    -- adds the const value (DB-side column is open text per the
    -- "type vocabulary at lib layer not DB layer" lock).
    --
    -- i18n keys 'notifications.opening_no_prior_data.title' + '.body' are
    -- placeholders; Aggie's S2 swarm lane populates EN + ES translations
    -- (gated as merge requirement before route handler goes live).
    IF v_has_null_source THEN
      v_notif_title := 'No prior closing data — opening at ' || v_location_code;

      INSERT INTO notifications (
        type, category, priority, title, body, data,
        related_table, related_id, location_id, created_by
      )
      VALUES (
        'opening_no_prior_data_alert',
        NULL,
        'urgent',
        v_notif_title,
        NULL,
        jsonb_build_object(
          'action', 'opening.submitted_with_no_prior_closing_data',
          'titleKey', 'notifications.opening_no_prior_data.title',
          'titleParams', jsonb_build_object(
            'locationCode', v_location_code,
            'openingDate', v_opening_date::text
          ),
          'bodyKey', 'notifications.opening_no_prior_data.body',
          'bodyParams', jsonb_build_object(
            'openerName', v_actor_name,
            'locationCode', v_location_code,
            'openingDate', v_opening_date::text,
            'nullSourceCount', v_null_source_count,
            'attestationReason', p_opener_no_prior_data_reason
          ),
          'instanceId', p_opening_instance_id::text,
          'openingDate', v_opening_date::text,
          'nullSourceCount', v_null_source_count,
          'attestationReason', p_opener_no_prior_data_reason
        ),
        'checklist_instances',
        p_opening_instance_id,
        v_location_id,
        p_actor_id
      )
      RETURNING id INTO v_null_source_notif_id;

      -- ──── Recipients: MoO + Owner + KH+ at location, DISTINCT ────
      --
      -- Mechanism: literal IN-list of KH+ role codes, paired with a
      -- location-membership EXISTS for location-scoped roles, OR'd with
      -- unconditional inclusion of moo + owner (per CO's role registry,
      -- moo + owner sit above location scope).
      --
      -- Verbatim diff against 0053:467-481 — this is the same mechanism
      -- (role-name IN-list, NOT a level comparison). Diffed literally by
      -- Triad A code-gate review 2026-05-26; semantics + names match.
      --
      -- The IN-list values map to KH+ (level ≥ 3) per lib/roles.ts:37-48:
      --   cgs(8), owner(7), moo(6.5), gm(6), agm(5), catering_mgr(5),
      --   shift_lead(4), key_holder(3), trainer(3), employee(3).
      -- The DB CHECK constraint on users.role lists eleven values; the
      -- omitted role is 'trainee' (level 2 per lib/roles.ts:48), correctly
      -- excluded as the only sub-KH+ role.
      --
      -- ⚠ COUPLING HAZARD (AGENTS.md sibling lesson, "Role-level gate
      -- audits must include UI-side gates"): adding a future role at
      -- level >= 3 to lib/roles.ts + the users.role CHECK constraint
      -- requires updating THIS IN-list AND 0053:467-481 AND any other
      -- recipient-resolution site driven by names. A grep-sweep for
      -- u.role IN (... is the discipline. Forward improvement: define a
      -- SQL-side role_level_of(role text) RETURNS int helper so recipient
      -- resolution can drive from levels instead of enumerated names —
      -- tracked as out-of-scope for B2 / this migration; raise as its
      -- own architectural change.
      --
      -- The "current_user_role_level() reads the actor, useless for
      -- target resolution" clause in the B2 brief is why the IN-list
      -- mechanism is correct here vs the helper: the helper resolves
      -- the caller's role from JWT claims, not arbitrary target rows.
      INSERT INTO notification_recipients (
        notification_id, user_id, delivery_method, delivery_status
      )
      SELECT v_null_source_notif_id, recipients.user_id, 'in_app', 'pending'
      FROM (
        SELECT DISTINCT u.id AS user_id
        FROM users u
        WHERE u.active = TRUE
          AND (
            (u.role IN (
              'cgs', 'owner', 'moo', 'gm', 'agm', 'catering_mgr',
              'shift_lead', 'key_holder', 'trainer', 'employee'
            )
             AND EXISTS (
               SELECT 1 FROM user_locations ul
               WHERE ul.user_id = u.id AND ul.location_id = v_location_id
             ))
            OR u.role = 'moo'
            OR u.role = 'owner'
          )
      ) recipients;
    END IF;

    -- ──── Responsibility 2: section verifications INSERT ────
    --
    -- Append-only — no UNIQUE constraint on (instance, sectionKey); multi-
    -- toggle in client state collapses to final value at submit. One row
    -- per verified=true entry. Mirrors 0053:499-515.
    IF p_section_verifications IS NOT NULL AND p_section_verifications <> 'null'::jsonb THEN
      FOR v_section_ver IN SELECT * FROM jsonb_array_elements(p_section_verifications)
      LOOP
        IF (v_section_ver->>'verified')::boolean = TRUE THEN
          INSERT INTO opening_section_verifications (
            opening_instance_id, section_key, verified_at, verified_by
          )
          VALUES (
            p_opening_instance_id,
            v_section_ver->>'sectionKey',
            v_submitted_at,
            p_actor_id
          );
          v_stations_verified := v_stations_verified + 1;
        END IF;
      END LOOP;
    END IF;

    -- ──── Submission row ────
    --
    -- is_final_confirmation = FALSE per Triad A: Phase 1 is not the final
    -- confirmation (Phase 3 is, with the closing auto-complete + the
    -- 'confirmed' status transition).
    INSERT INTO checklist_submissions (
      instance_id, submitted_by, submitted_at, completion_ids, is_final_confirmation
    )
    VALUES (
      p_opening_instance_id, p_actor_id, v_submitted_at, v_completion_ids, FALSE
    )
    RETURNING id INTO v_submission_id;

    -- ──── Responsibility 9: status transition (race-safe) ────
    --
    -- Single UPDATE with status='open' filter. NOT FOUND means another
    -- submitter beat us OR the instance is already past Phase 1. Translates
    -- to P0001 'phase1_not_eligible' which the JS layer maps to
    -- OpeningPhase1NotEligibleError (lib/opening.ts:279).
    --
    -- confirmed_at / confirmed_by / finalized_at_actor_type stay NULL —
    -- Phase 3 sets them at the 'confirmed' transition.
    UPDATE checklist_instances
    SET status = 'phase1_complete'
    WHERE id = p_opening_instance_id
      AND status = 'open';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'submit_phase1_atomic: phase1_not_eligible — instance % is not in status=open (concurrent submit OR status already past Phase 1)',
        p_opening_instance_id
        USING ERRCODE = 'P0001';
    END IF;

    -- NO opening→closing auto-complete (per Triad A ruling, C.54 §2.A). Phase 3
    -- owns that responsibility when the instance transitions to 'confirmed'.

  ELSE
    -- ════════════════════════════════════════════════════════════════════
    -- C.46 CHAIN-EDIT PATH — §9 NAMED VERIFICATION GATE
    -- ════════════════════════════════════════════════════════════════════
    --
    -- The C.46 chain-edit path is the historically highest-risk region in
    -- this function: the C.54 §9 production bug (Juan's NULL-SENTINEL smoke
    -- at EM 2026-05-25, instance d49d1504-...) lived in 0053's auto-complete
    -- branch carrying a "preserved from 0050" comment that was true at the
    -- literal level but architecturally wrong after C.50 changed the
    -- operational assumption ("absence of prior data" became a valid state).
    --
    -- This block IS the brief's named verification gate. The three
    -- preservation properties are demonstrated by the actual SQL structure
    -- below, NOT asserted in comments.
    --
    -- (a) Original completion's count_provenance is PRESERVED on chain edit
    --     — never rewritten from current snapshot/recount state.
    --     → Verified at the INSERT below: the new completion's
    --       count_provenance is set to v_original_count_provenance, which is
    --       READ FROM the original completion row (SELECT below). The
    --       chain-edit branch NEVER recomputes provenance from current
    --       (closer_count, opener_recount) state.
    --
    -- (b) The missing-closing notification (opening_no_prior_data_alert) is
    --     NOT re-emitted on chain edit.
    --     → Verified by structural absence: this branch contains NO
    --       INSERT INTO notifications statement. The original-path dispatch
    --       block above is gated under IF NOT p_is_update (the outer
    --       IF/ELSE here), so chain edits cannot reach it.
    --
    -- (c) The missing-closing notification is NOT retracted on chain edit.
    --     → Verified by structural absence: NO UPDATE notifications, NO
    --       UPDATE notification_recipients, NO DELETE FROM notifications, NO
    --       DELETE FROM notification_recipients statement exists ANYWHERE
    --       in this function. The original notification stands across all
    --       chain edits.
    --
    -- (d) Verification is against Phase 1's specific provenance model — NOT
    --     inherited assumption from 0053's structure.
    --     → Phase 1 stores count_provenance in the dedicated column added by
    --       migration 0054 (checklist_completions.count_provenance). The
    --       preservation read below pulls from THAT exact column, not from
    --       prep_data.phase1 metadata or from any 0053 location. Phase 1's
    --       per-instance attestation (checklist_instances.opener_no_prior
    --       _data_reason) is likewise untouched on chain edit — there is no
    --       UPDATE to that column in this branch.

    IF p_original_submission_id IS NULL THEN
      RAISE EXCEPTION 'submit_phase1_atomic: p_original_submission_id required when p_is_update = true'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- Lock chain head + concurrent chain rows (mirrors 0053 chain pattern).
    SELECT * INTO v_chain_head_row
    FROM checklist_submissions
    WHERE id = p_original_submission_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'submit_phase1_atomic: chain head submission % not found', p_original_submission_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF v_chain_head_row.original_submission_id IS NOT NULL THEN
      RAISE EXCEPTION 'submit_phase1_atomic: % is an update row, not a chain head', p_original_submission_id
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_chain_head_row.instance_id <> p_opening_instance_id THEN
      RAISE EXCEPTION 'submit_phase1_atomic: chain head % is for instance %, not %',
        p_original_submission_id, v_chain_head_row.instance_id, p_opening_instance_id
        USING ERRCODE = 'check_violation';
    END IF;

    PERFORM 1
    FROM checklist_submissions
    WHERE original_submission_id = p_original_submission_id
    FOR UPDATE;

    SELECT COALESCE(MAX(edit_count), 0) INTO v_max_edit_count
    FROM checklist_submissions
    WHERE id = p_original_submission_id
       OR original_submission_id = p_original_submission_id;

    IF v_max_edit_count >= 3 THEN
      RAISE EXCEPTION 'submit_phase1_atomic: edit cap reached for chain % (current_max=%)',
        p_original_submission_id, v_max_edit_count
        USING ERRCODE = 'P0001';
    END IF;

    v_new_edit_count := v_max_edit_count + 1;

    -- ──── Chain-edit entries loop ────
    --
    -- For each entry: lookup original completion in chain head, READ original
    -- count_provenance (§9 preservation point a), re-apply per-item compute
    -- against CURRENT snapshot/recount state (so the new completion's
    -- prep_data is current/valid), but INSERT the new row with the
    -- ORIGINAL provenance value.
    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
    LOOP
      v_phase := COALESCE(v_entry->>'phase', 'phase1');
      IF v_phase <> 'phase1' THEN
        RAISE EXCEPTION 'submit_phase1_atomic (update): unexpected phase "%" in entry % (expected phase1)',
          v_phase, v_entry->>'templateItemId'
          USING ERRCODE = 'check_violation';
      END IF;

      v_template_item_id := (v_entry->>'templateItemId')::uuid;

      -- ──── §9 PRESERVATION READ ────
      --
      -- Look up the original completion in the chain head AND read its
      -- count_provenance in a single query. This is the preservation source
      -- for §9 point (a). The value flows directly into the new INSERT
      -- below; the chain-edit branch never derives a new provenance value.
      SELECT id, count_provenance
      INTO v_original_completion_id, v_original_count_provenance
      FROM checklist_completions cc
      WHERE cc.id = ANY(v_chain_head_row.completion_ids)
        AND cc.template_item_id = v_template_item_id
      LIMIT 1;

      IF v_original_completion_id IS NULL THEN
        RAISE EXCEPTION 'submit_phase1_atomic (update): template_item_id % in update entries not found in chain head submission %',
          v_template_item_id, p_original_submission_id
          USING ERRCODE = 'check_violation';
      END IF;

      SELECT label INTO v_item_label
      FROM checklist_template_items
      WHERE id = v_template_item_id;

      v_count_value := NULLIF(v_entry->>'countValue', '')::numeric;
      v_photo_id := NULLIF(v_entry->>'photoId', '')::uuid;
      v_notes := NULLIF(v_entry->>'notes', '');
      v_spot_check_status := NULLIF(v_entry->>'spotCheckStatus', '');
      v_opener_recount := CASE
        WHEN v_entry->>'openerRecount' IS NULL THEN NULL
        ELSE NULLIF(v_entry->>'openerRecount', '')::numeric
      END;
      -- 0215 batch-vs-bottle (ruling F): a batch_mode item's recount is TWO boxes — LINE
      -- (ready) and BACK UP (the bulk container). The server derives the total, so Phase 1's
      -- ground_truth / prep_need keep their count-total semantics. A total-only recount on a
      -- batch item is REFUSED (never coalesced to the closer LINE); a non-batch item ignores
      -- the two boxes entirely. Identical in the original and the chain-edit branch.
      v_recount_line := CASE
        WHEN v_entry->'openerRecountLine' IS NULL OR v_entry->'openerRecountLine' = 'null'::jsonb THEN NULL
        ELSE NULLIF(v_entry->>'openerRecountLine', '')::numeric
      END;
      v_recount_back_up := CASE
        WHEN v_entry->'openerRecountBackUp' IS NULL OR v_entry->'openerRecountBackUp' = 'null'::jsonb THEN NULL
        ELSE NULLIF(v_entry->>'openerRecountBackUp', '')::numeric
      END;
      SELECT c.is_batch INTO v_entry_is_batch FROM public.prep_batch_context(v_template_item_id) c;
      IF COALESCE(v_entry_is_batch, false) THEN
        IF (v_recount_line IS NULL) <> (v_recount_back_up IS NULL) THEN
          RAISE EXCEPTION 'submit_phase1_atomic: recount_split_incomplete for item % (%) — a batch item recount needs BOTH line and bulk backup',
            v_template_item_id, v_item_label
            USING ERRCODE = 'P0001';
        END IF;
        IF v_recount_line IS NOT NULL THEN
          IF v_recount_line < 0 OR v_recount_back_up < 0 THEN
            RAISE EXCEPTION 'submit_phase1_atomic: recount_split_negative for item % (%)',
              v_template_item_id, v_item_label
              USING ERRCODE = 'P0001';
          END IF;
          v_opener_recount := v_recount_line + v_recount_back_up;
        ELSIF v_opener_recount IS NOT NULL THEN
          RAISE EXCEPTION 'submit_phase1_atomic: recount_split_required for item % (%) — a batch item recount must be entered as line + bulk backup',
            v_template_item_id, v_item_label
            USING ERRCODE = 'P0001';
        END IF;
      ELSE
        v_recount_line := NULL;
        v_recount_back_up := NULL;
      END IF;

      IF v_spot_check_status IS NOT NULL THEN
        -- Spot-check item (chain edit): re-apply gates + compute against
        -- CURRENT state for prep_data freshness. Provenance stays preserved
        -- per the §9 read above.
        v_section_key := v_section_by_item_id->>(v_template_item_id::text);
        v_section_verified := v_section_key IS NOT NULL
          AND v_section_key = ANY(v_verified_sections);

        SELECT closer_count, par_value
        INTO v_closer_count, v_par_value
        FROM opening_closer_count_snapshots
        WHERE opening_instance_id = p_opening_instance_id
          AND template_item_id = v_template_item_id;

        -- Resolution gates (same as original path)
        IF v_closer_count IS NULL
           AND v_opener_recount IS NULL
           AND v_section_verified THEN
          RAISE EXCEPTION 'submit_phase1_atomic (update): null_source_requires_recount for item % (%)',
            v_template_item_id, v_item_label
            USING ERRCODE = 'P0001';
        END IF;
        IF v_opener_recount IS NULL AND NOT v_section_verified THEN
          RAISE EXCEPTION 'submit_phase1_atomic (update): ground_truth_unresolved for item % (%) — section not verified AND opener_recount IS NULL',
            v_template_item_id, v_item_label
            USING ERRCODE = 'P0001';
        END IF;

        v_ground_truth := COALESCE(v_opener_recount, v_closer_count);
        IF v_ground_truth IS NULL THEN
          RAISE EXCEPTION 'submit_phase1_atomic (update): ground_truth_unresolved for item % (%) — closer_count NULL AND opener_recount NULL despite gate-pass (defensive)',
            v_template_item_id, v_item_label
            USING ERRCODE = 'P0001';
        END IF;

        v_prep_need := CASE
          WHEN v_par_value IS NOT NULL
            THEN GREATEST(0, v_par_value - v_ground_truth)
          ELSE NULL
        END;
        v_resolved_spot_check_status := CASE
          WHEN v_opener_recount IS NOT NULL THEN 'flagged_recount'
          ELSE 'matched_via_section_verify'
        END;

        IF v_opener_recount IS NOT NULL THEN
          v_items_recounted := v_items_recounted + 1;
        END IF;

        v_prep_data_phase1 := jsonb_build_object(
          'phase', 1,
          'closer_count', v_closer_count,
          'opener_recount', v_opener_recount,
          'section_verified', v_section_verified,
          'ground_truth_count', v_ground_truth,
          'prep_need', v_prep_need,
          'par_value', v_par_value,
          'spot_check_status', v_resolved_spot_check_status
        );
        -- 0215 batch-vs-bottle: the split rides BESIDE the 8-key contract (never replaces a key).
        IF COALESCE(v_entry_is_batch, false) THEN
          v_prep_data_phase1 := v_prep_data_phase1 || jsonb_build_object(
            'opener_recount_line', v_recount_line,
            'opener_recount_back_up', v_recount_back_up
          );
        END IF;
      ELSE
        v_prep_data_phase1 := NULL;
      END IF;

      -- ──── 0185: SUPERSEDE-THEN-INSERT (migration 0176's one-live-head index) ────
      --
      -- 0176 put a partial unique index on checklist_completions
      -- (instance_id, template_item_id) WHERE superseded_at IS NULL AND
      -- revoked_at IS NULL, and reworked lib/checklists.ts completeItem to flip
      -- first. This branch was written before that index existed and still
      -- bare-INSERTS a second row for a key whose original is LIVE — so the
      -- moment a caller sets p_is_update = true it raises a raw 23505 that
      -- mapOpeningError does not recognise, i.e. an opaque 500 on every chain
      -- edit. The flip below is the same shape save_phase2_item_atomic (0056)
      -- and lib/cash.ts already use: clear the live head's null superseded_at
      -- BEFORE the insert, then back-point it once the new id exists.
      --
      -- It supersedes THE LIVE HEAD, not v_original_completion_id. Those are the
      -- same row on the first edit and diverge on the second: the §9 provenance
      -- read above deliberately keys on the CHAIN HEAD's completion_ids (so
      -- provenance is preserved from the original submission moment, edit after
      -- edit), while the row that actually holds the index slot is whichever
      -- edit is currently live. Superseding the chain head on edit 2 would be a
      -- no-op and the 23505 would come straight back.
      --
      -- At most one row can match — that is precisely what 0176's index
      -- guarantees — so a single-row RETURNING INTO is safe here. No live head
      -- (a revoked original) leaves it NULL and the insert stands alone.
      --
      -- §9 IS UNTOUCHED BY THIS: count_provenance still flows from
      -- v_original_count_provenance (point a), and an UPDATE of superseded_at on
      -- checklist_completions is not a notifications write (points b, c).
      v_superseded_completion_id := NULL;

      UPDATE checklist_completions
      SET superseded_at = v_submitted_at
      WHERE instance_id = p_opening_instance_id
        AND template_item_id = v_template_item_id
        AND superseded_at IS NULL
        AND revoked_at IS NULL
      RETURNING id INTO v_superseded_completion_id;

      -- ──── §9 PRESERVATION POINT (a): provenance from ORIGINAL, not current ────
      --
      -- count_provenance is set to v_original_count_provenance — the value
      -- READ from the original completion above. Even if the current
      -- (closer_count, opener_recount) state would suggest a different
      -- provenance for an original-path completion, on chain edit the
      -- provenance stays as it was at the original submission moment.
      INSERT INTO checklist_completions (
        instance_id, template_item_id, completed_by, completed_at,
        count_value, photo_id, notes, prep_data, count_provenance,
        original_completion_id, edit_count
      )
      VALUES (
        p_opening_instance_id,
        v_template_item_id,
        p_actor_id,
        v_submitted_at,
        v_count_value,
        v_photo_id,
        v_notes,
        CASE
          WHEN v_prep_data_phase1 IS NOT NULL
            THEN jsonb_build_object('phase1', v_prep_data_phase1)
          ELSE NULL
        END,
        v_original_count_provenance,  -- ← §9 PRESERVATION POINT (a)
        v_original_completion_id,
        v_new_edit_count
      )
      RETURNING id INTO v_completion_id;

      v_completion_ids := array_append(v_completion_ids, v_completion_id);

      -- 0185: close the chain link. superseded_by can only be written once the
      -- successor's id exists, which is why the flip above is two statements
      -- rather than one — the same order lib/cash.ts and completeItem take.
      IF v_superseded_completion_id IS NOT NULL THEN
        UPDATE checklist_completions
        SET superseded_by = v_completion_id
        WHERE id = v_superseded_completion_id;
      END IF;

      -- ──── §9 PRESERVATION POINTS (b), (c): structural absence ────
      --
      -- No INSERT/UPDATE/DELETE against notifications or notification_
      -- recipients fires on this path. The original instance's notification
      -- (if any) is canonical and untouched.
    END LOOP;

    -- New submission row for the chain edit
    INSERT INTO checklist_submissions (
      instance_id, submitted_by, submitted_at, completion_ids,
      is_final_confirmation, original_submission_id, edit_count
    )
    VALUES (
      p_opening_instance_id, p_actor_id, v_submitted_at, v_completion_ids,
      FALSE, p_original_submission_id, v_new_edit_count
    )
    RETURNING id INTO v_submission_id;

    -- C.46 update-path audit row — RPC-side per Triad A correction 1.
    -- Mirrors 0053:860-879. ip_address + user_agent live INSIDE metadata per
    -- AGENTS.md "RPC-side audit_log INSERTs must mirror the actual column
    -- shape" lesson (migration 0044 fix). audit_log columns are id,
    -- occurred_at, actor_id, actor_role, action, resource_table, resource_id,
    -- before_state, after_state, metadata, destructive — no top-level
    -- ip_address/user_agent.
    INSERT INTO audit_log (
      actor_id, action, resource_table, resource_id, metadata, destructive
    )
    VALUES (
      p_actor_id,
      'report.update',
      'checklist_submissions',
      v_submission_id,
      jsonb_build_object(
        'report_type', 'opening_report',
        'phase', 'phase1',
        'report_instance_id', p_opening_instance_id,
        'original_submission_id', p_original_submission_id,
        'original_completed_by', v_chain_head_row.submitted_by,
        'original_completed_at', to_jsonb(v_chain_head_row.submitted_at),
        'updated_by', p_actor_id,
        'updated_at', to_jsonb(v_submitted_at),
        'edit_count', v_new_edit_count,
        'changed_fields', COALESCE(p_changed_fields, '[]'::jsonb),
        'ip_address', p_ip_address,
        'user_agent', p_user_agent,
        -- Forensic visibility for C.54 §9 audit queries: count of items in
        -- this chain edit whose preserved provenance is 'reconstructed_
        -- morning' (i.e., chain edits crossing a NULL-source item without
        -- retracting the original notification — exactly the case §9 above
        -- is designed to handle correctly).
        'items_with_preserved_reconstructed_morning_provenance', (
          SELECT count(*)
          FROM checklist_completions cc
          WHERE cc.id = ANY(v_completion_ids)
            AND cc.count_provenance = 'reconstructed_morning'
        )
      ),
      true
    );

    -- NO status update on chain edit (instance stays in current phase status).
    -- NO section verifications re-INSERT (original submission's verify state stands).
    -- NO attestation re-write to checklist_instances.opener_no_prior_data_reason.
  END IF;

  -- ──── Build result jsonb ────
  --
  -- Result shape mirrors the OpeningPhaseSubmitResult contract (lib/opening.ts:
  -- 1485) plus the audit counters per responsibility 10. Camel-case keys
  -- match 0053's return convention and the JS-side SubmitRpcResult marshaler.
  SELECT to_jsonb(ci) INTO v_opening_instance_row
  FROM checklist_instances ci
  WHERE ci.id = p_opening_instance_id;

  RETURN jsonb_build_object(
    'instance', v_opening_instance_row,
    'submissionId', v_submission_id,
    'completionIds', to_jsonb(v_completion_ids),
    -- Phase 1 owns no opening→closing auto-complete (Phase 3 does); always NULL.
    'autoCompleteId', NULL,
    'editCount', CASE WHEN p_is_update THEN v_new_edit_count ELSE 0 END,
    'originalSubmissionId', CASE WHEN p_is_update THEN p_original_submission_id ELSE NULL END,
    -- Phase 1 has no under-par notification (that's a Phase 2 concept); always [].
    'underParNotificationIds', to_jsonb(ARRAY[]::uuid[]),
    -- New: C.54 NULL-source notification ids (zero or one per submit by Pattern A).
    'nullSourceNotificationIds', CASE
      WHEN v_null_source_notif_id IS NOT NULL
        THEN to_jsonb(ARRAY[v_null_source_notif_id])
      ELSE to_jsonb(ARRAY[]::uuid[])
    END,
    -- Responsibility 10 audit counters for JS-side opening.phase1_submit audit metadata.
    'stationsVerified', v_stations_verified,
    'itemsRecounted', v_items_recounted,
    'nullSourceCount', v_null_source_count,
    'provenanceMarkersSet', v_provenance_markers_set,
    'attestationCapture', CASE
      WHEN v_has_null_source THEN p_opener_no_prior_data_reason
      ELSE NULL
    END
  );
END;
$function$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 6b. submit_mid_day_phase1_atomic ← 0060 + LINE/BACK UP pair + derived total
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.submit_mid_day_phase1_atomic(
  p_instance_id uuid,
  p_actor_id uuid,
  p_entries jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_entry jsonb;
  v_completion_id uuid;
  v_completion_ids uuid[] := ARRAY[]::uuid[];
  v_submission_id uuid;
  v_submitted_at timestamptz := now();
  v_instance_row jsonb;
  -- 0215 batch-vs-bottle (ruling F): LINE (onHand) + BACK UP pair on batch_mode items; total derived here.
  v_entry_is_batch boolean;
  v_on_hand numeric;
  v_back_up numeric;
BEGIN
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
  LOOP
    -- 0215 batch-vs-bottle (ruling F): a batch_mode item's mid-day count is TWO boxes, LINE
    -- (onHand) + bulk BACK UP; both paired and non-negative, and the COUNT total is derived
    -- here (Phase 1 semantics — Phase 2's inputs.total stays the production delta, 0199).
    -- Non-batch items are stored exactly as 0060 stores them.
    SELECT c.is_batch INTO v_entry_is_batch
    FROM public.prep_batch_context((v_entry->>'templateItemId')::uuid) c;
    IF COALESCE(v_entry_is_batch, false) THEN
      v_on_hand := CASE
        WHEN v_entry->'inputs'->'onHand' IS NULL OR v_entry->'inputs'->'onHand' = 'null'::jsonb THEN NULL
        ELSE NULLIF(v_entry->'inputs'->>'onHand', '')::numeric
      END;
      v_back_up := CASE
        WHEN v_entry->'inputs'->'backUp' IS NULL OR v_entry->'inputs'->'backUp' = 'null'::jsonb THEN NULL
        ELSE NULLIF(v_entry->'inputs'->>'backUp', '')::numeric
      END;
      IF v_on_hand IS NULL OR v_back_up IS NULL THEN
        RAISE EXCEPTION 'submit_mid_day_phase1_atomic: mid_day_backup_required for item % — a batch item counts LINE (on hand) AND the bulk BACK UP',
          v_entry->>'templateItemId'
          USING ERRCODE = 'P0001';
      END IF;
      IF v_on_hand < 0 OR v_back_up < 0 THEN
        RAISE EXCEPTION 'submit_mid_day_phase1_atomic: mid_day_count_negative for item %',
          v_entry->>'templateItemId'
          USING ERRCODE = 'P0001';
      END IF;
      v_entry := jsonb_set(v_entry, '{inputs}', (v_entry->'inputs') || jsonb_build_object('total', v_on_hand + v_back_up));
    END IF;
    INSERT INTO checklist_completions (
      instance_id, template_item_id, completed_by, completed_at, prep_data
    )
    VALUES (
      p_instance_id,
      (v_entry->>'templateItemId')::uuid,
      p_actor_id,
      v_submitted_at,
      jsonb_build_object('inputs', v_entry->'inputs', 'snapshot', v_entry->'snapshot')
    )
    RETURNING id INTO v_completion_id;
    v_completion_ids := array_append(v_completion_ids, v_completion_id);
  END LOOP;

  INSERT INTO checklist_submissions (
    instance_id, submitted_by, submitted_at, completion_ids, is_final_confirmation
  )
  VALUES (p_instance_id, p_actor_id, v_submitted_at, v_completion_ids, false)
  RETURNING id INTO v_submission_id;

  UPDATE checklist_instances
  SET status = 'phase1_complete'
  WHERE id = p_instance_id AND status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'submit_mid_day_phase1_atomic: instance % is not open or does not exist', p_instance_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT to_jsonb(ci) INTO v_instance_row FROM checklist_instances ci WHERE ci.id = p_instance_id;

  RETURN jsonb_build_object(
    'instance', v_instance_row,
    'submissionId', v_submission_id,
    'completionIds', to_jsonb(v_completion_ids)
  );
END;
$function$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 6c. create_opening_instance_atomic ← 0063 + line_count / back_up_count
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_opening_instance_atomic(
  p_template_id uuid,
  p_location_id uuid,
  p_date date,
  p_actor_user_id uuid,
  p_snapshots jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_instance_id uuid;
  v_existing_id uuid;
  v_trigger_ts timestamptz := NOW();
  v_snapshot jsonb;
  v_snapshot_count int := 0;
  v_with_count int := 0;
  v_closer_count_text text;
BEGIN
  INSERT INTO checklist_instances (
    template_id, location_id, date, shift_start_at, status,
    triggered_by_user_id, triggered_at
  )
  VALUES (
    p_template_id, p_location_id, p_date, v_trigger_ts, 'open',
    p_actor_user_id, v_trigger_ts
  )
  ON CONFLICT (template_id, location_id, date) WHERE NOT allows_multiple_per_day
    DO NOTHING
  RETURNING id INTO v_instance_id;

  IF v_instance_id IS NULL THEN
    SELECT id INTO v_existing_id
    FROM checklist_instances
    WHERE template_id = p_template_id
      AND location_id = p_location_id
      AND date = p_date;

    IF v_existing_id IS NULL THEN
      RAISE EXCEPTION 'create_opening_instance_atomic: race re-read failed (instance constraint conflict but no row found)';
    END IF;

    RETURN jsonb_build_object('instance_id', v_existing_id, 'was_created', false);
  END IF;

  IF p_snapshots IS NOT NULL AND jsonb_array_length(p_snapshots) > 0 THEN
    FOR v_snapshot IN SELECT * FROM jsonb_array_elements(p_snapshots)
    LOOP
      v_closer_count_text := v_snapshot->>'closer_count';
      INSERT INTO opening_closer_count_snapshots (
        opening_instance_id, template_item_id, closing_instance_id,
        closer_count, par_value, par_unit, snapshot_by
      )
      VALUES (
        v_instance_id,
        (v_snapshot->>'template_item_id')::uuid,
        NULLIF(v_snapshot->>'closing_instance_id', '')::uuid,
        NULLIF(v_closer_count_text, '')::numeric,
        NULLIF(v_snapshot->>'par_value', '')::numeric,
        v_snapshot->>'par_unit',
        p_actor_user_id
      );
      -- 0215 batch-vs-bottle: carry last night's LINE and BACK UP beside the closer total
      -- (plan S §2.4). NULL when the AM prep row had no such box (non-numeric shape, blank).
      UPDATE opening_closer_count_snapshots
      SET line_count = NULLIF(v_snapshot->>'line_count', '')::numeric,
          back_up_count = NULLIF(v_snapshot->>'back_up_count', '')::numeric
      WHERE opening_instance_id = v_instance_id
        AND template_item_id = (v_snapshot->>'template_item_id')::uuid;
      v_snapshot_count := v_snapshot_count + 1;
      IF v_closer_count_text IS NOT NULL AND v_closer_count_text != '' THEN
        v_with_count := v_with_count + 1;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'instance_id', v_instance_id,
    'was_created', true,
    'snapshot_count', v_snapshot_count,
    'with_closer_count', v_with_count,
    'without_closer_count', v_snapshot_count - v_with_count
  );
END;
$function$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 6d. save_phase2_item_atomic ← 0056 + p_batch (signature changes: drop the old one first)
-- ═════════════════════════════════════════════════════════════════════════════════════════════
drop function if exists public.save_phase2_item_atomic(uuid, uuid, uuid, numeric, jsonb, jsonb, text, text);
CREATE OR REPLACE FUNCTION public.save_phase2_item_atomic(
  p_opening_instance_id uuid,
  p_actor_id uuid,
  p_template_item_id uuid,
  p_opener_prepped numeric,
  p_over_par jsonb DEFAULT NULL,
  p_under_par jsonb DEFAULT NULL,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_batch jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_status text;
  v_item_label text;
  -- read from this item's prep_data->phase1 (0055:388-397 contract)
  v_phase1 jsonb;
  v_closer_count numeric;
  v_spot_check_status text;
  v_opener_recount numeric;
  v_ground_truth_count numeric;
  v_prep_need numeric;
  v_phase1_provenance text;   -- [D2] mirror onto the phase2 completion
  -- computed
  v_delta numeric;
  v_over_under_status text;
  v_over_under_reason_category text;
  v_over_under_reason_text text;
  v_directed_by uuid;
  v_prep_data_phase2 jsonb;
  v_completion_id uuid;
  v_saved_at timestamptz := now();
  v_completion_row jsonb;
  -- 0215 batch-vs-bottle locals (plan S r4; build corrections 1-5)
  v_location_id uuid;
  v_business_date date;
  v_template_id uuid;
  v_item_id uuid;
  v_batch_recipe_id uuid;
  v_output_count integer;
  v_recipe_yield numeric;
  v_is_batch boolean := false;
  v_batch_mode boolean := false;   -- Astra P1 #4: read separately; batch_mode AND NOT is_batch is REFUSED
  v_prev_toss numeric;             -- Astra P2 #6: the session's toss before this save (audit delta)
  v_b_batches integer;
  v_b_came_out numeric;
  v_b_tossed numeric;
  v_b_reason jsonb;
  v_b_reason_code text;
  v_b_reason_note text;
  v_line numeric;
  v_par_value_b numeric;
  v_backup_before numeric;
  v_need_for_line numeric;
  v_min_batches integer;
  v_available numeric;
  v_backup_after numeric;
  v_phase1_prep_need numeric;
  v_par_unit_b text;
  v_session_produced_at timestamptz;
  v_session_made_by uuid;
  v_batch_record jsonb := NULL;

BEGIN
  -- ──── Eligibility: Phase 2 active only at phase1_complete (Question C) ────
  SELECT status INTO v_status FROM checklist_instances WHERE id = p_opening_instance_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'save_phase2_item_atomic: opening instance % not found', p_opening_instance_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_status <> 'phase1_complete' THEN
    RAISE EXCEPTION 'save_phase2_item_atomic: phase2_not_eligible — instance % status is "%" (expected phase1_complete)',
      p_opening_instance_id, v_status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT label INTO v_item_label FROM checklist_template_items WHERE id = p_template_item_id;

  -- ──── Read this item's resolved Phase 1 ground truth (Model Y source) ────
  -- The phase1 completion was written by submit_phase1_atomic (0055). Live row only.
  SELECT cc.prep_data->'phase1', cc.count_provenance
  INTO v_phase1, v_phase1_provenance
  FROM checklist_completions cc
  WHERE cc.instance_id = p_opening_instance_id
    AND cc.template_item_id = p_template_item_id
    AND cc.prep_data ? 'phase1'
    AND cc.superseded_at IS NULL
    AND cc.revoked_at IS NULL
  ORDER BY cc.completed_at DESC
  LIMIT 1;

  IF v_phase1 IS NULL THEN
    RAISE EXCEPTION 'save_phase2_item_atomic: phase1_not_resolved for item % (%) — no live prep_data->phase1 completion; Phase 1 must resolve ground truth before Phase 2 prep',
      p_template_item_id, v_item_label
      USING ERRCODE = 'P0001';
  END IF;

  v_closer_count       := NULLIF(v_phase1->>'closer_count', '')::numeric;
  v_spot_check_status  := v_phase1->>'spot_check_status';
  v_opener_recount     := NULLIF(v_phase1->>'opener_recount', '')::numeric;
  v_ground_truth_count := NULLIF(v_phase1->>'ground_truth_count', '')::numeric;
  v_prep_need          := NULLIF(v_phase1->>'prep_need', '')::numeric;
  -- ──── 0215 batch-vs-bottle (plan S r4; GO corrections 1-5) ────
  -- Eligibility is derived HERE from the item and its recipe (ruling 2): a batch_mode item
  -- cannot opt out by omitting the batch object, and a non-batch item cannot opt in.
  SELECT ci.location_id, ci.date, ci.template_id
  INTO v_location_id, v_business_date, v_template_id
  FROM checklist_instances ci WHERE ci.id = p_opening_instance_id;
  SELECT c.item_id, c.recipe_id, c.output_count, c.yield, c.is_batch, c.batch_mode
  INTO v_item_id, v_batch_recipe_id, v_output_count, v_recipe_yield, v_is_batch, v_batch_mode
  FROM public.prep_batch_context(p_template_item_id) c;
  v_is_batch := COALESCE(v_is_batch, false);
  v_batch_mode := COALESCE(v_batch_mode, false);
  -- Astra P1 #4 (BC-004/042): a batch_mode recipe that is NOT eligible (two outputs, no yield)
  -- must never fall through to the single-box path by omitting p_batch. Refused BEFORE payload
  -- dispatch, whatever the payload says.
  IF v_batch_mode AND NOT v_is_batch THEN
    RAISE EXCEPTION 'save_phase2_item_atomic: batch_recipe_unresolved for item % — batch_mode needs exactly one item output with yield > 0 (recipe %, outputs %)',
      p_template_item_id, v_batch_recipe_id, v_output_count USING ERRCODE = 'P0001';
  END IF;
  IF v_is_batch AND (p_batch IS NULL OR p_batch = 'null'::jsonb) THEN
    RAISE EXCEPTION 'save_phase2_item_atomic: batch_payload_required for item % — batch_mode item saved without the batch object',
      p_template_item_id USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_is_batch AND p_batch IS NOT NULL AND p_batch <> 'null'::jsonb THEN
    RAISE EXCEPTION 'save_phase2_item_atomic: batch_payload_not_allowed for item % — not a batch_mode item',
      p_template_item_id USING ERRCODE = 'P0001';
  END IF;
  IF v_is_batch THEN
    -- Correction 4: the session is bound to the AUTHORIZED instance — location_id and
    -- business_date come from it, and the template item must belong to its template.
    PERFORM 1 FROM checklist_template_items cti
    WHERE cti.id = p_template_item_id AND cti.template_id = v_template_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'save_phase2_item_atomic: template_item_not_in_instance for item %', p_template_item_id USING ERRCODE = 'P0001';
    END IF;
    IF v_output_count IS DISTINCT FROM 1 OR v_recipe_yield IS NULL OR v_recipe_yield <= 0 THEN
      RAISE EXCEPTION 'save_phase2_item_atomic: batch_recipe_unresolved for item % — batch_mode needs exactly one item output with yield > 0',
        p_template_item_id USING ERRCODE = 'P0001';
    END IF;
    IF p_opener_prepped IS NULL THEN
      RAISE EXCEPTION 'save_phase2_item_atomic: opener_prepped_missing for item %', p_template_item_id USING ERRCODE = 'P0001';
    END IF;
    IF p_opener_prepped < 0 THEN
      RAISE EXCEPTION 'save_phase2_item_atomic: invalid_bottled for item %', p_template_item_id USING ERRCODE = 'P0001';
    END IF;
    -- NULL refusals (ruling G, the 0056:184 idiom): a missing or JSON-null batches / came_out_to /
    -- Other-note is an explicit failure, never a silent default.
    IF p_batch->'batches' IS NULL OR p_batch->'batches' = 'null'::jsonb
       OR NULLIF(btrim(p_batch->>'batches'), '') IS NULL THEN
      RAISE EXCEPTION 'save_phase2_item_atomic: batches_missing for item %', p_template_item_id USING ERRCODE = 'P0001';
    END IF;
    IF p_batch->>'batches' !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'save_phase2_item_atomic: invalid_batch_count for item % — batches must be a whole number >= 0', p_template_item_id USING ERRCODE = 'P0001';
    END IF;
    v_b_batches := (p_batch->>'batches')::integer;
    IF v_b_batches > 0 THEN
      IF p_batch->'came_out_to' IS NULL OR p_batch->'came_out_to' = 'null'::jsonb
         OR NULLIF(btrim(p_batch->>'came_out_to'), '') IS NULL THEN
        RAISE EXCEPTION 'save_phase2_item_atomic: came_out_to_missing for item % — required when batches > 0', p_template_item_id USING ERRCODE = 'P0001';
      END IF;
      IF p_batch->>'came_out_to' !~ '^[0-9]+(\.[0-9]+)?$' THEN
        RAISE EXCEPTION 'save_phase2_item_atomic: invalid_came_out_to for item %', p_template_item_id USING ERRCODE = 'P0001';
      END IF;
      v_b_came_out := (p_batch->>'came_out_to')::numeric;
    ELSE
      v_b_came_out := 0;
      IF p_batch->'came_out_to' IS NOT NULL AND p_batch->'came_out_to' <> 'null'::jsonb
         AND NULLIF(btrim(p_batch->>'came_out_to'), '') IS NOT NULL
         AND (p_batch->>'came_out_to' !~ '^[0-9]+(\.[0-9]+)?$' OR (p_batch->>'came_out_to')::numeric <> 0) THEN
        RAISE EXCEPTION 'save_phase2_item_atomic: invalid_came_out_to for item % — no batch made, nothing can have come out', p_template_item_id USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF p_batch->'tossed' IS NULL OR p_batch->'tossed' = 'null'::jsonb
       OR NULLIF(btrim(p_batch->>'tossed'), '') IS NULL THEN
      v_b_tossed := 0;
    ELSE
      IF p_batch->>'tossed' !~ '^[0-9]+(\.[0-9]+)?$' THEN
        RAISE EXCEPTION 'save_phase2_item_atomic: invalid_tossed for item %', p_template_item_id USING ERRCODE = 'P0001';
      END IF;
      v_b_tossed := (p_batch->>'tossed')::numeric;
    END IF;
    -- This session's counts (ruling A): the opener's two-box recount when present, else last
    -- night's closing count from the frozen snapshot. Never a total; never another row.
    SELECT s.line_count, s.back_up_count, s.par_unit
    INTO v_line, v_backup_before, v_par_unit_b
    FROM opening_closer_count_snapshots s
    WHERE s.opening_instance_id = p_opening_instance_id AND s.template_item_id = p_template_item_id;
    v_line := COALESCE(NULLIF(v_phase1->>'opener_recount_line', '')::numeric, v_line);
    v_backup_before := COALESCE(NULLIF(v_phase1->>'opener_recount_back_up', '')::numeric, v_backup_before);
    v_par_value_b := NULLIF(v_phase1->>'par_value', '')::numeric;
    IF v_line IS NULL OR v_backup_before IS NULL THEN
      RAISE EXCEPTION 'save_phase2_item_atomic: backup_unknown for item % — this session has no LINE / bulk BACK UP count', p_template_item_id USING ERRCODE = 'P0001';
    END IF;
    v_need_for_line := CASE WHEN v_par_value_b IS NOT NULL THEN GREATEST(0, v_par_value_b - v_line) ELSE NULL END;
    IF v_b_tossed > v_backup_before THEN
      RAISE EXCEPTION 'save_phase2_item_atomic: tossed_exceeds_backup for item % — tossed % exceeds the counted backup %',
        p_template_item_id, v_b_tossed, v_backup_before USING ERRCODE = 'P0001';
    END IF;
    -- Ruling B: backup_after = before - tossed + came_out_to - bottled; bottled <= before - tossed + came_out_to.
    v_available := v_backup_before - v_b_tossed + v_b_came_out;
    IF p_opener_prepped > v_available THEN
      RAISE EXCEPTION 'save_phase2_item_atomic: bottled_exceeds_available for item % — bottled % exceeds available % (backup % - tossed % + came out %)',
        p_template_item_id, p_opener_prepped, v_available, v_backup_before, v_b_tossed, v_b_came_out USING ERRCODE = 'P0001';
    END IF;
    v_backup_after := v_available - p_opener_prepped;
    v_min_batches := CASE
      WHEN v_need_for_line IS NULL THEN NULL
      WHEN (v_backup_before - v_b_tossed) >= v_need_for_line THEN 0
      ELSE CEIL((v_need_for_line - (v_backup_before - v_b_tossed)) / v_recipe_yield)::integer
    END;
    -- Over-batch reason (Juan, addendum 2): ALWAYS required when batches exceed the minimum;
    -- one tap from a closed list; only 'other' needs a note. JSON-null-safe throughout.
    v_b_reason := p_batch->'over_batch_reason';
    v_b_reason_code := NULL;
    v_b_reason_note := NULL;
    IF v_b_reason IS NOT NULL AND v_b_reason <> 'null'::jsonb THEN
      v_b_reason_code := NULLIF(btrim(COALESCE(v_b_reason->>'code', '')), '');
      v_b_reason_note := NULLIF(btrim(COALESCE(v_b_reason->>'note', '')), '');
      IF v_b_reason_code IS NULL
         OR v_b_reason_code NOT IN ('catering_order', 'busy_day_expected', 'prepping_ahead', 'other') THEN
        RAISE EXCEPTION 'save_phase2_item_atomic: invalid_over_batch_reason for item %', p_template_item_id USING ERRCODE = 'P0001';
      END IF;
      IF v_b_reason_code = 'other' AND (v_b_reason->'note' IS NULL OR v_b_reason->'note' = 'null'::jsonb OR v_b_reason_note IS NULL) THEN
        RAISE EXCEPTION 'save_phase2_item_atomic: over_batch_note_required for item %', p_template_item_id USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF v_min_batches IS NOT NULL AND v_b_batches > v_min_batches AND v_b_reason_code IS NULL THEN
      RAISE EXCEPTION 'save_phase2_item_atomic: over_batch_reason_missing for item % — % batch(es) made, % needed',
        p_template_item_id, v_b_batches, v_min_batches USING ERRCODE = 'P0001';
    END IF;
    -- Session row (ruling 1; corrections 1, 3, 4): keyed by (instance_id, template_item_id).
    -- produced_at + made_by are set at the FIRST batch save and NEVER updated (not in the SET
    -- list). tossed_at / tossed_by move ONLY when the tossed qty itself changes (ELSE keeps them).
    -- Astra P2 #6: the toss BEFORE this save, under the row lock, so the caller can audit
    -- backup.tossed on every real change (set, moved, cleared) and nothing on an unchanged save.
    SELECT s.tossed_qty INTO v_prev_toss
    FROM prep_batch_sessions s
    WHERE s.instance_id = p_opening_instance_id AND s.template_item_id = p_template_item_id
    FOR UPDATE;
    INSERT INTO prep_batch_sessions (
      instance_id, template_item_id, location_id, item_id, business_date, source,
      produced_at, made_by, tossed_qty, tossed_par_unit, tossed_at, tossed_by, updated_at
    )
    VALUES (
      p_opening_instance_id, p_template_item_id, v_location_id, v_item_id, v_business_date, 'opening_p2',
      v_saved_at, p_actor_id, v_b_tossed, v_par_unit_b,
      CASE WHEN v_b_tossed > 0 THEN v_saved_at ELSE NULL END,
      CASE WHEN v_b_tossed > 0 THEN p_actor_id ELSE NULL END,
      v_saved_at
    )
    ON CONFLICT (instance_id, template_item_id) DO UPDATE SET
      tossed_qty = EXCLUDED.tossed_qty,
      tossed_par_unit = EXCLUDED.tossed_par_unit,
      tossed_at = CASE WHEN prep_batch_sessions.tossed_qty IS DISTINCT FROM EXCLUDED.tossed_qty
                       THEN v_saved_at ELSE prep_batch_sessions.tossed_at END,
      tossed_by = CASE WHEN prep_batch_sessions.tossed_qty IS DISTINCT FROM EXCLUDED.tossed_qty
                       THEN p_actor_id ELSE prep_batch_sessions.tossed_by END,
      updated_at = v_saved_at
    RETURNING prep_batch_sessions.produced_at, prep_batch_sessions.made_by
    INTO v_session_produced_at, v_session_made_by;
    v_batch_record := jsonb_build_object(
      'batches', v_b_batches,
      'came_out_to', v_b_came_out,
      'bottled', p_opener_prepped,
      'tossed', v_b_tossed,
      'backup_before', v_backup_before,
      'backup_after', v_backup_after,
      'line_count', v_line,
      'need_for_line', v_need_for_line,
      'min_batches', v_min_batches,
      'yield_at_time', v_recipe_yield,
      'recipe_id', v_batch_recipe_id,
      'item_id', v_item_id,
      'over_batch_reason', CASE WHEN v_b_reason_code IS NULL THEN NULL
                                ELSE jsonb_build_object('code', v_b_reason_code, 'note', v_b_reason_note) END,
      'produced_at', v_session_produced_at,
      'made_by', v_session_made_by,
      'session', jsonb_build_object('instance_id', p_opening_instance_id, 'template_item_id', p_template_item_id),
      'business_date', v_business_date,
      'location_id', v_location_id
    );
  END IF;

  -- Phase 2's delta / status / under-par alert measure BOTTLED against the LINE need for a
  -- batch row (plan S §2.4); the Phase 1 total-based need is kept on the batch object.
  IF v_is_batch THEN
    v_phase1_prep_need := v_prep_need;
    v_prep_need := v_need_for_line;
    v_batch_record := v_batch_record || jsonb_build_object('phase1_prep_need', v_phase1_prep_need);
  END IF;


  -- ──── opener_prepped required (universal — even on par-null items) ────
  IF p_opener_prepped IS NULL THEN
    RAISE EXCEPTION 'save_phase2_item_atomic: opener_prepped_missing for item % (%)',
      p_template_item_id, v_item_label
      USING ERRCODE = 'P0001';
  END IF;

  -- ──── Compute delta + status via the SHARED helper (single source) ────
  SELECT delta, over_under_status INTO v_delta, v_over_under_status
  FROM public.opening_phase2_compute_delta(p_opener_prepped, v_prep_need);

  -- ──── Reason gates (0053:354-369) — only when prep_need computable ────
  IF v_prep_need IS NOT NULL AND v_delta IS DISTINCT FROM 0 THEN
    IF NOT v_is_batch AND v_delta > 0 AND (p_over_par IS NULL OR p_over_par = 'null'::jsonb) THEN
      RAISE EXCEPTION 'save_phase2_item_atomic: over_par_reason_missing for item % (%) — delta=% > 0 requires overPar capture',
        p_template_item_id, v_item_label, v_delta
        USING ERRCODE = 'P0001';
    END IF;
    IF v_delta < 0 AND (p_under_par IS NULL OR p_under_par = 'null'::jsonb) THEN
      RAISE EXCEPTION 'save_phase2_item_atomic: under_par_reason_missing for item % (%) — delta=% < 0 requires underPar capture',
        p_template_item_id, v_item_label, v_delta
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- ──── Extract reason fields (0053:371-384) ────
  IF p_over_par IS NOT NULL AND p_over_par <> 'null'::jsonb THEN
    v_over_under_reason_category := p_over_par->>'reasonCategory';
    v_over_under_reason_text     := p_over_par->>'freeText';
    v_directed_by                := NULLIF(p_over_par->>'directedBy', '')::uuid;
  ELSIF p_under_par IS NOT NULL AND p_under_par <> 'null'::jsonb THEN
    v_over_under_reason_category := p_under_par->>'reasonCategory';
    v_over_under_reason_text     := p_under_par->>'freeText';
    v_directed_by                := NULL;  -- under-prep carries no directed_by
    -- under-prep freeText REQUIRED (build doc §7 / C.50 §4 — always non-empty)
    IF COALESCE(btrim(v_over_under_reason_text), '') = '' THEN
      RAISE EXCEPTION 'save_phase2_item_atomic: under_par_freetext_required for item % (%)',
        p_template_item_id, v_item_label
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    v_over_under_reason_category := NULL;
    v_over_under_reason_text     := NULL;
    v_directed_by                := NULL;
  END IF;

  -- ──── Build §8.4 prep_data->phase2 — 14 fields (12 core + 2 provenance) ────
  -- 12-core shape lifted from 0053:388-401; saved_at/saved_by are the C.52
  -- per-item provenance (spec C.53 §3, 1980-1994). Inverse-drift guard: the
  -- canonical full set is 14 — never strip saved_at/saved_by to "match 0053".
  v_prep_data_phase2 := jsonb_build_object(
    'phase', 2,
    'closer_count', v_closer_count,                      -- from prep_data->phase1
    'spot_check_status', v_spot_check_status,            -- from prep_data->phase1
    'opener_recount', v_opener_recount,                  -- from prep_data->phase1
    'ground_truth_count', v_ground_truth_count,          -- from prep_data->phase1
    'prep_need', v_prep_need,                            -- from prep_data->phase1
    'opener_prepped', p_opener_prepped,                  -- WRITTEN NOW
    'delta_vs_prep_need', v_delta,                       -- shared helper
    'over_under_status', v_over_under_status,            -- shared helper
    'over_under_reason_category', v_over_under_reason_category,
    'over_under_reason_text', v_over_under_reason_text,
    'directed_by', v_directed_by,
    'saved_at', v_saved_at,                              -- C.52 per-item provenance
    'saved_by', p_actor_id                               -- C.52 per-item provenance
  );
  -- 0215 batch-vs-bottle: the batch object rides BESIDE the 14 §8.4 fields (never replaces one).
  IF v_is_batch THEN
    v_prep_data_phase2 := v_prep_data_phase2 || jsonb_build_object('batch', v_batch_record);
  END IF;

  -- ──── Append-only write [D1]: supersede any prior live phase2 row, INSERT new ────
  UPDATE checklist_completions
  SET superseded_at = v_saved_at
  WHERE instance_id = p_opening_instance_id
    AND template_item_id = p_template_item_id
    AND prep_data ? 'phase2'
    AND superseded_at IS NULL
    AND revoked_at IS NULL;

  INSERT INTO checklist_completions (
    instance_id, template_item_id, completed_by, completed_at,
    count_value, photo_id, notes, prep_data, count_provenance
  )
  VALUES (
    p_opening_instance_id, p_template_item_id, p_actor_id, v_saved_at,
    NULL, NULL, NULL,
    jsonb_build_object('phase2', v_prep_data_phase2),
    v_phase1_provenance   -- [D2] mirror phase1 provenance (NOT hardcoded closer_captured)
  )
  RETURNING id INTO v_completion_id;

  SELECT to_jsonb(cc) INTO v_completion_row
  FROM checklist_completions cc WHERE cc.id = v_completion_id;

  -- 0215 (Astra P2 #6/#7): a BATCH row returns the session facts the caller audits/folds on —
  -- never re-derived client-side, never invented. Inserted BEFORE the 0056 RETURN so a
  -- single-box save returns exactly what it always did.
  IF v_is_batch THEN
    RETURN jsonb_build_object(
      'completion', v_completion_row,
      'templateItemId', p_template_item_id,
      'completionId', v_completion_id,
      'deltaVsPrepNeed', v_delta,
      'overUnderStatus', v_over_under_status,
      'tossPrevious', COALESCE(v_prev_toss, 0),
      'tossCurrent', v_b_tossed,
      'producedAt', to_jsonb(v_session_produced_at),
      'madeBy', to_jsonb(v_session_made_by)
    );
  END IF;

  RETURN jsonb_build_object(
    'completion', v_completion_row,
    'templateItemId', p_template_item_id,
    'completionId', v_completion_id,
    'deltaVsPrepNeed', v_delta,
    'overUnderStatus', v_over_under_status
  );
END;
$function$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 6e. save_mid_day_phase2_item_atomic ← 0199 + p_batch (signature changes: drop the old one first)
-- ═════════════════════════════════════════════════════════════════════════════════════════════
drop function if exists public.save_mid_day_phase2_item_atomic(uuid, uuid, uuid, numeric, jsonb, jsonb);
CREATE OR REPLACE FUNCTION public.save_mid_day_phase2_item_atomic(
  p_instance_id uuid,
  p_template_item_id uuid,
  p_actor_id uuid,
  p_prepped numeric,
  p_snapshot jsonb,
  p_over_under jsonb DEFAULT NULL,
  p_batch jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_prior_id uuid;
  v_prior_inputs jsonb;
  v_new_id uuid;
  v_saved_at timestamptz := now();
  -- 0215 batch-vs-bottle locals (plan S r4; build corrections 1-5)
  v_location_id uuid;
  v_business_date date;
  v_template_id uuid;
  v_item_id uuid;
  v_batch_recipe_id uuid;
  v_output_count integer;
  v_recipe_yield numeric;
  v_is_batch boolean := false;
  v_batch_mode boolean := false;   -- Astra P1 #4: read separately; batch_mode AND NOT is_batch is REFUSED
  v_prev_toss numeric;             -- Astra P2 #6: the session's toss before this save (audit delta)
  v_b_batches integer;
  v_b_came_out numeric;
  v_b_tossed numeric;
  v_b_reason jsonb;
  v_b_reason_code text;
  v_b_reason_note text;
  v_line numeric;
  v_par_value_b numeric;
  v_backup_before numeric;
  v_need_for_line numeric;
  v_min_batches integer;
  v_available numeric;
  v_backup_after numeric;
  v_phase1_prep_need numeric;
  v_par_unit_b text;
  v_session_produced_at timestamptz;
  v_session_made_by uuid;
  v_batch_record jsonb := NULL;

BEGIN
  PERFORM 1 FROM checklist_instances
  WHERE id = p_instance_id AND status = 'phase1_complete';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'save_mid_day_phase2_item_atomic: instance % not in phase1_complete', p_instance_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT id, prep_data->'inputs'
  INTO v_prior_id, v_prior_inputs
  FROM checklist_completions
  WHERE instance_id = p_instance_id
    AND template_item_id = p_template_item_id
    AND superseded_at IS NULL
    AND revoked_at IS NULL
  ORDER BY completed_at DESC
  LIMIT 1;
  -- ──── 0215 batch-vs-bottle (plan S r4; GO corrections 1-5) ────
  -- Eligibility is derived HERE from the item and its recipe (ruling 2): a batch_mode item
  -- cannot opt out by omitting the batch object, and a non-batch item cannot opt in.
  SELECT ci.location_id, ci.date, ci.template_id
  INTO v_location_id, v_business_date, v_template_id
  FROM checklist_instances ci WHERE ci.id = p_instance_id;
  SELECT c.item_id, c.recipe_id, c.output_count, c.yield, c.is_batch, c.batch_mode
  INTO v_item_id, v_batch_recipe_id, v_output_count, v_recipe_yield, v_is_batch, v_batch_mode
  FROM public.prep_batch_context(p_template_item_id) c;
  v_is_batch := COALESCE(v_is_batch, false);
  v_batch_mode := COALESCE(v_batch_mode, false);
  -- Astra P1 #4 (BC-004/042): a batch_mode recipe that is NOT eligible (two outputs, no yield)
  -- must never fall through to the single-box path by omitting p_batch. Refused BEFORE payload
  -- dispatch, whatever the payload says.
  IF v_batch_mode AND NOT v_is_batch THEN
    RAISE EXCEPTION 'save_mid_day_phase2_item_atomic: batch_recipe_unresolved for item % — batch_mode needs exactly one item output with yield > 0 (recipe %, outputs %)',
      p_template_item_id, v_batch_recipe_id, v_output_count USING ERRCODE = 'P0001';
  END IF;
  IF v_is_batch AND (p_batch IS NULL OR p_batch = 'null'::jsonb) THEN
    RAISE EXCEPTION 'save_mid_day_phase2_item_atomic: batch_payload_required for item % — batch_mode item saved without the batch object',
      p_template_item_id USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_is_batch AND p_batch IS NOT NULL AND p_batch <> 'null'::jsonb THEN
    RAISE EXCEPTION 'save_mid_day_phase2_item_atomic: batch_payload_not_allowed for item % — not a batch_mode item',
      p_template_item_id USING ERRCODE = 'P0001';
  END IF;
  IF v_is_batch THEN
    -- Correction 4: the session is bound to the AUTHORIZED instance — location_id and
    -- business_date come from it, and the template item must belong to its template.
    PERFORM 1 FROM checklist_template_items cti
    WHERE cti.id = p_template_item_id AND cti.template_id = v_template_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'save_mid_day_phase2_item_atomic: template_item_not_in_instance for item %', p_template_item_id USING ERRCODE = 'P0001';
    END IF;
    IF v_output_count IS DISTINCT FROM 1 OR v_recipe_yield IS NULL OR v_recipe_yield <= 0 THEN
      RAISE EXCEPTION 'save_mid_day_phase2_item_atomic: batch_recipe_unresolved for item % — batch_mode needs exactly one item output with yield > 0',
        p_template_item_id USING ERRCODE = 'P0001';
    END IF;
    IF p_prepped IS NULL THEN
      RAISE EXCEPTION 'save_mid_day_phase2_item_atomic: prepped_missing for item %', p_template_item_id USING ERRCODE = 'P0001';
    END IF;
    IF p_prepped < 0 THEN
      RAISE EXCEPTION 'save_mid_day_phase2_item_atomic: invalid_bottled for item %', p_template_item_id USING ERRCODE = 'P0001';
    END IF;
    -- NULL refusals (ruling G, the 0056:184 idiom): a missing or JSON-null batches / came_out_to /
    -- Other-note is an explicit failure, never a silent default.
    IF p_batch->'batches' IS NULL OR p_batch->'batches' = 'null'::jsonb
       OR NULLIF(btrim(p_batch->>'batches'), '') IS NULL THEN
      RAISE EXCEPTION 'save_mid_day_phase2_item_atomic: batches_missing for item %', p_template_item_id USING ERRCODE = 'P0001';
    END IF;
    IF p_batch->>'batches' !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'save_mid_day_phase2_item_atomic: invalid_batch_count for item % — batches must be a whole number >= 0', p_template_item_id USING ERRCODE = 'P0001';
    END IF;
    v_b_batches := (p_batch->>'batches')::integer;
    IF v_b_batches > 0 THEN
      IF p_batch->'came_out_to' IS NULL OR p_batch->'came_out_to' = 'null'::jsonb
         OR NULLIF(btrim(p_batch->>'came_out_to'), '') IS NULL THEN
        RAISE EXCEPTION 'save_mid_day_phase2_item_atomic: came_out_to_missing for item % — required when batches > 0', p_template_item_id USING ERRCODE = 'P0001';
      END IF;
      IF p_batch->>'came_out_to' !~ '^[0-9]+(\.[0-9]+)?$' THEN
        RAISE EXCEPTION 'save_mid_day_phase2_item_atomic: invalid_came_out_to for item %', p_template_item_id USING ERRCODE = 'P0001';
      END IF;
      v_b_came_out := (p_batch->>'came_out_to')::numeric;
    ELSE
      v_b_came_out := 0;
      IF p_batch->'came_out_to' IS NOT NULL AND p_batch->'came_out_to' <> 'null'::jsonb
         AND NULLIF(btrim(p_batch->>'came_out_to'), '') IS NOT NULL
         AND (p_batch->>'came_out_to' !~ '^[0-9]+(\.[0-9]+)?$' OR (p_batch->>'came_out_to')::numeric <> 0) THEN
        RAISE EXCEPTION 'save_mid_day_phase2_item_atomic: invalid_came_out_to for item % — no batch made, nothing can have come out', p_template_item_id USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF p_batch->'tossed' IS NULL OR p_batch->'tossed' = 'null'::jsonb
       OR NULLIF(btrim(p_batch->>'tossed'), '') IS NULL THEN
      v_b_tossed := 0;
    ELSE
      IF p_batch->>'tossed' !~ '^[0-9]+(\.[0-9]+)?$' THEN
        RAISE EXCEPTION 'save_mid_day_phase2_item_atomic: invalid_tossed for item %', p_template_item_id USING ERRCODE = 'P0001';
      END IF;
      v_b_tossed := (p_batch->>'tossed')::numeric;
    END IF;
    -- This session's counts (ruling A): the mid-day Phase 1 pair, carried on the live row's
    -- inputs (0199 copies inputs forward on every re-save, so onHand / backUp survive).
    v_line := NULLIF(v_prior_inputs->>'onHand', '')::numeric;
    v_backup_before := NULLIF(v_prior_inputs->>'backUp', '')::numeric;
    SELECT NULLIF(cc.prep_data->'snapshot'->>'parValue', '')::numeric, cc.prep_data->'snapshot'->>'parUnit'
    INTO v_par_value_b, v_par_unit_b
    FROM checklist_completions cc WHERE cc.id = v_prior_id;
    IF v_line IS NULL OR v_backup_before IS NULL THEN
      RAISE EXCEPTION 'save_mid_day_phase2_item_atomic: backup_unknown for item % — this session has no LINE / bulk BACK UP count', p_template_item_id USING ERRCODE = 'P0001';
    END IF;
    v_need_for_line := CASE WHEN v_par_value_b IS NOT NULL THEN GREATEST(0, v_par_value_b - v_line) ELSE NULL END;
    IF v_b_tossed > v_backup_before THEN
      RAISE EXCEPTION 'save_mid_day_phase2_item_atomic: tossed_exceeds_backup for item % — tossed % exceeds the counted backup %',
        p_template_item_id, v_b_tossed, v_backup_before USING ERRCODE = 'P0001';
    END IF;
    -- Ruling B: backup_after = before - tossed + came_out_to - bottled; bottled <= before - tossed + came_out_to.
    v_available := v_backup_before - v_b_tossed + v_b_came_out;
    IF p_prepped > v_available THEN
      RAISE EXCEPTION 'save_mid_day_phase2_item_atomic: bottled_exceeds_available for item % — bottled % exceeds available % (backup % - tossed % + came out %)',
        p_template_item_id, p_prepped, v_available, v_backup_before, v_b_tossed, v_b_came_out USING ERRCODE = 'P0001';
    END IF;
    v_backup_after := v_available - p_prepped;
    v_min_batches := CASE
      WHEN v_need_for_line IS NULL THEN NULL
      WHEN (v_backup_before - v_b_tossed) >= v_need_for_line THEN 0
      ELSE CEIL((v_need_for_line - (v_backup_before - v_b_tossed)) / v_recipe_yield)::integer
    END;
    -- Over-batch reason (Juan, addendum 2): ALWAYS required when batches exceed the minimum;
    -- one tap from a closed list; only 'other' needs a note. JSON-null-safe throughout.
    v_b_reason := p_batch->'over_batch_reason';
    v_b_reason_code := NULL;
    v_b_reason_note := NULL;
    IF v_b_reason IS NOT NULL AND v_b_reason <> 'null'::jsonb THEN
      v_b_reason_code := NULLIF(btrim(COALESCE(v_b_reason->>'code', '')), '');
      v_b_reason_note := NULLIF(btrim(COALESCE(v_b_reason->>'note', '')), '');
      IF v_b_reason_code IS NULL
         OR v_b_reason_code NOT IN ('catering_order', 'busy_day_expected', 'prepping_ahead', 'other') THEN
        RAISE EXCEPTION 'save_mid_day_phase2_item_atomic: invalid_over_batch_reason for item %', p_template_item_id USING ERRCODE = 'P0001';
      END IF;
      IF v_b_reason_code = 'other' AND (v_b_reason->'note' IS NULL OR v_b_reason->'note' = 'null'::jsonb OR v_b_reason_note IS NULL) THEN
        RAISE EXCEPTION 'save_mid_day_phase2_item_atomic: over_batch_note_required for item %', p_template_item_id USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF v_min_batches IS NOT NULL AND v_b_batches > v_min_batches AND v_b_reason_code IS NULL THEN
      RAISE EXCEPTION 'save_mid_day_phase2_item_atomic: over_batch_reason_missing for item % — % batch(es) made, % needed',
        p_template_item_id, v_b_batches, v_min_batches USING ERRCODE = 'P0001';
    END IF;
    -- Session row (ruling 1; corrections 1, 3, 4): keyed by (instance_id, template_item_id).
    -- produced_at + made_by are set at the FIRST batch save and NEVER updated (not in the SET
    -- list). tossed_at / tossed_by move ONLY when the tossed qty itself changes (ELSE keeps them).
    -- Astra P2 #6: the toss BEFORE this save, under the row lock, so the caller can audit
    -- backup.tossed on every real change (set, moved, cleared) and nothing on an unchanged save.
    SELECT s.tossed_qty INTO v_prev_toss
    FROM prep_batch_sessions s
    WHERE s.instance_id = p_instance_id AND s.template_item_id = p_template_item_id
    FOR UPDATE;
    INSERT INTO prep_batch_sessions (
      instance_id, template_item_id, location_id, item_id, business_date, source,
      produced_at, made_by, tossed_qty, tossed_par_unit, tossed_at, tossed_by, updated_at
    )
    VALUES (
      p_instance_id, p_template_item_id, v_location_id, v_item_id, v_business_date, 'mid_day_p2',
      v_saved_at, p_actor_id, v_b_tossed, v_par_unit_b,
      CASE WHEN v_b_tossed > 0 THEN v_saved_at ELSE NULL END,
      CASE WHEN v_b_tossed > 0 THEN p_actor_id ELSE NULL END,
      v_saved_at
    )
    ON CONFLICT (instance_id, template_item_id) DO UPDATE SET
      tossed_qty = EXCLUDED.tossed_qty,
      tossed_par_unit = EXCLUDED.tossed_par_unit,
      tossed_at = CASE WHEN prep_batch_sessions.tossed_qty IS DISTINCT FROM EXCLUDED.tossed_qty
                       THEN v_saved_at ELSE prep_batch_sessions.tossed_at END,
      tossed_by = CASE WHEN prep_batch_sessions.tossed_qty IS DISTINCT FROM EXCLUDED.tossed_qty
                       THEN p_actor_id ELSE prep_batch_sessions.tossed_by END,
      updated_at = v_saved_at
    RETURNING prep_batch_sessions.produced_at, prep_batch_sessions.made_by
    INTO v_session_produced_at, v_session_made_by;
    v_batch_record := jsonb_build_object(
      'batches', v_b_batches,
      'came_out_to', v_b_came_out,
      'bottled', p_prepped,
      'tossed', v_b_tossed,
      'backup_before', v_backup_before,
      'backup_after', v_backup_after,
      'line_count', v_line,
      'need_for_line', v_need_for_line,
      'min_batches', v_min_batches,
      'yield_at_time', v_recipe_yield,
      'recipe_id', v_batch_recipe_id,
      'item_id', v_item_id,
      'over_batch_reason', CASE WHEN v_b_reason_code IS NULL THEN NULL
                                ELSE jsonb_build_object('code', v_b_reason_code, 'note', v_b_reason_note) END,
      'produced_at', v_session_produced_at,
      'made_by', v_session_made_by,
      'session', jsonb_build_object('instance_id', p_instance_id, 'template_item_id', p_template_item_id),
      'business_date', v_business_date,
      'location_id', v_location_id
    );
  END IF;


  -- 0199 (LRA-215): SUPERSEDE FIRST, INSERT SECOND. Under the 0196 live-head index
  -- (instance, item, coalesce(prep_data ? 'phase2', false)) WHERE live, mid-day rows share
  -- the key `false`, so inserting the replacement while the prior row is still live is a
  -- 23505 on every second save of the same item. Mirror of opening's 0056 order.
  IF v_prior_id IS NOT NULL THEN
    UPDATE checklist_completions
    SET superseded_at = v_saved_at
    WHERE id = v_prior_id
      AND superseded_at IS NULL
      AND revoked_at IS NULL;
  END IF;

  INSERT INTO checklist_completions (
    instance_id, template_item_id, completed_by, completed_at, prep_data
  )
  VALUES (
    p_instance_id,
    p_template_item_id,
    p_actor_id,
    v_saved_at,
    jsonb_build_object(
      'inputs', (COALESCE(v_prior_inputs, '{}'::jsonb) - 'freeText') || jsonb_build_object('total', p_prepped),
      'snapshot', p_snapshot,
      'overUnder', p_over_under
    )
  )
  RETURNING id INTO v_new_id;
  -- 0215 batch-vs-bottle: the batch object rides as a SIBLING key (beside inputs / snapshot /
  -- overUnder). Written as a second statement so the 0199 insert above stays byte-identical
  -- for every non-batch row, which carries no such key.
  IF v_batch_record IS NOT NULL THEN
    UPDATE checklist_completions
    SET prep_data = prep_data || jsonb_build_object('batch', v_batch_record)
    WHERE id = v_new_id;
  END IF;

  -- Keep the 0064 provenance link now that the replacement's id exists.
  IF v_prior_id IS NOT NULL THEN
    UPDATE checklist_completions
    SET superseded_by = v_new_id
    WHERE id = v_prior_id;
  END IF;

  -- 0215 (Astra P2 #6/#7): a BATCH row returns the session facts with the id — the lib audits
  -- the toss delta and folds with the PERSISTED maker/time, never a read-back it could get
  -- wrong. Inserted BEFORE the 0199 RETURN so a single-box save returns exactly what it did.
  IF v_is_batch THEN
    RETURN jsonb_build_object(
      'completionId', v_new_id,
      'savedAt', to_jsonb(v_saved_at),
      'tossPrevious', COALESCE(v_prev_toss, 0),
      'tossCurrent', v_b_tossed,
      'producedAt', to_jsonb(v_session_produced_at),
      'madeBy', to_jsonb(v_session_made_by)
    );
  END IF;

  RETURN jsonb_build_object('completionId', v_new_id, 'savedAt', to_jsonb(v_saved_at));
END;
$function$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 6f. submit_phase2_atomic ← 0197 + need_for_line coalesce
-- ═════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.submit_phase2_atomic(p_opening_instance_id uuid, p_actor_id uuid, p_is_update boolean DEFAULT false, p_original_submission_id uuid DEFAULT NULL::uuid, p_ip_address text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_location_id uuid;
  v_location_code text;
  v_opening_date date;
  v_actor_name text;
  v_template_id uuid;
  v_submitted_at timestamptz := now();

  v_universe_item_id uuid;
  v_missing_count int := 0;

  v_completion_id uuid;
  v_completion_ids uuid[] := ARRAY[]::uuid[];
  v_submission_id uuid;
  v_opening_instance_row jsonb;

  -- per-item recompute locals
  v_phase2 jsonb;
  v_phase1 jsonb;          -- [D4] frozen Phase 1 contract — authoritative source
  v_item_label text;
  v_opener_prepped numeric;
  v_prep_need numeric;
  v_closer_count numeric;
  v_ground_truth_count numeric;
  v_over_under_reason_category text;
  v_over_under_reason_text text;
  v_delta numeric;
  v_over_under_status text;

  -- counters
  v_at_par_count int := 0;
  v_over_prep_count int := 0;
  v_under_prep_count int := 0;

  -- notifications
  v_notif_title text;
  v_notif_id uuid;
  v_notif_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  -- [D3] chain-edit deferred pending Juan ruling.
  IF p_is_update THEN
    RAISE EXCEPTION 'submit_phase2_atomic: phase2_chain_edit_not_implemented — re-finalize (C.46) deferred pending scope ruling'
      USING ERRCODE = 'P0001';
  END IF;

  -- ──── Pre-load instance + location ────
  SELECT ci.location_id, ci.date, ci.template_id, l.code
  INTO v_location_id, v_opening_date, v_template_id, v_location_code
  FROM checklist_instances ci
  JOIN locations l ON l.id = ci.location_id
  WHERE ci.id = p_opening_instance_id;
  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'submit_phase2_atomic: opening instance % not found', p_opening_instance_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT name INTO v_actor_name FROM users WHERE id = p_actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'submit_phase2_atomic: actor % not found', p_actor_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- ──── Completeness over the Model Y universe ────
  -- Universe = every ACTIVE openingPhase2 template item on this instance's template.
  -- 0197 (LRA-202): `cti.active` mirrors the screen and the per-item save; a deactivated
  -- item is template history, not an obligation, or finalize can never succeed.
  -- Each MUST have a live phase2 completion (written by save_phase2_item_atomic).
  SELECT count(*) INTO v_missing_count
  FROM checklist_template_items cti
  WHERE cti.template_id = v_template_id
    AND cti.active = TRUE
    AND cti.prep_meta->>'openingPhase2' = 'true'
    AND NOT EXISTS (
      SELECT 1 FROM checklist_completions cc
      WHERE cc.instance_id = p_opening_instance_id
        AND cc.template_item_id = cti.id
        AND cc.prep_data ? 'phase2'
        AND cc.superseded_at IS NULL
        AND cc.revoked_at IS NULL
    );
  IF v_missing_count > 0 THEN
    RAISE EXCEPTION 'submit_phase2_atomic: phase2_incomplete — % Phase 2 universe item(s) have no live completion', v_missing_count
      USING ERRCODE = 'P0001';
  END IF;

  -- ──── Per-item read-back, authoritative recompute, notification dispatch ────
  FOR v_universe_item_id, v_completion_id, v_phase2, v_item_label IN
    SELECT cti.id, cc.id, cc.prep_data->'phase2', cti.label
    FROM checklist_template_items cti
    JOIN checklist_completions cc
      ON cc.template_item_id = cti.id
     AND cc.instance_id = p_opening_instance_id
     AND cc.prep_data ? 'phase2'
     AND cc.superseded_at IS NULL
     AND cc.revoked_at IS NULL
    WHERE cti.template_id = v_template_id
      AND cti.active = TRUE
      AND cti.prep_meta->>'openingPhase2' = 'true'
  LOOP
    -- opener_prepped + reasons come from the phase2 row (only place they exist).
    v_opener_prepped             := NULLIF(v_phase2->>'opener_prepped', '')::numeric;
    v_over_under_reason_category := v_phase2->>'over_under_reason_category';
    v_over_under_reason_text     := v_phase2->>'over_under_reason_text';

    -- [D4] AUTHORITATIVE re-source: prep_need + ground_truth_count + closer_count
    -- are re-read from this item's FROZEN prep_data->phase1 contract — NOT trusted
    -- from the phase2 row (where they were mirrored at save time as UX convenience).
    -- Finalize is the authoritative compute; save-time values are advisory. They
    -- agree by design (same frozen contract, same helper), but finalize never
    -- trusts the written-onto-phase2 copy.
    SELECT cc1.prep_data->'phase1' INTO v_phase1
    FROM checklist_completions cc1
    WHERE cc1.instance_id = p_opening_instance_id
      AND cc1.template_item_id = v_universe_item_id
      AND cc1.prep_data ? 'phase1'
      AND cc1.superseded_at IS NULL
      AND cc1.revoked_at IS NULL
    ORDER BY cc1.completed_at DESC
    LIMIT 1;

    IF v_phase1 IS NULL THEN
      RAISE EXCEPTION 'submit_phase2_atomic: phase1_not_resolved for item % (%) — no live prep_data->phase1 at finalize',
        v_universe_item_id, v_item_label
        USING ERRCODE = 'P0001';
    END IF;

    -- 0215 batch-vs-bottle: a batch row's delta is measured against its LINE need (plan S §2.4).
    v_prep_need          := COALESCE(NULLIF(v_phase2->'batch'->>'need_for_line', '')::numeric, NULLIF(v_phase1->>'prep_need', '')::numeric);
    v_ground_truth_count := NULLIF(v_phase1->>'ground_truth_count', '')::numeric;
    v_closer_count       := NULLIF(v_phase1->>'closer_count', '')::numeric;

    -- Authoritative recompute via the SAME shared helper (guards against drift)
    SELECT delta, over_under_status INTO v_delta, v_over_under_status
    FROM public.opening_phase2_compute_delta(v_opener_prepped, v_prep_need);

    IF v_over_under_status = 'at_par' THEN
      v_at_par_count := v_at_par_count + 1;
    ELSIF v_over_under_status = 'over_prep' THEN
      v_over_prep_count := v_over_prep_count + 1;
    ELSE
      v_under_prep_count := v_under_prep_count + 1;
    END IF;

    v_completion_ids := array_append(v_completion_ids, v_completion_id);

    -- ──── Under-prep notification dispatch (0053:414-485 pattern) ────
    IF v_delta IS NOT NULL AND v_delta < 0 THEN
      v_notif_title := 'Under-par: ' || v_item_label || ' at ' || v_location_code;

      INSERT INTO notifications (
        type, category, priority, title, body, data,
        related_table, related_id, location_id, created_by
      )
      VALUES (
        'under_par_alert', NULL, 'urgent', v_notif_title, NULL,
        jsonb_build_object(
          'titleKey', 'notifications.under_par_alert.title',
          'titleParams', jsonb_build_object('itemName', v_item_label, 'locationCode', v_location_code),
          'bodyKey', 'notifications.under_par_alert.body',
          'bodyParams', jsonb_build_object(
            'openerName', v_actor_name, 'itemName', v_item_label,
            'prepped', v_opener_prepped, 'closer', v_closer_count,
            'reasonCategory', v_over_under_reason_category,
            'freeText', COALESCE(v_over_under_reason_text, '')
          ),
          'itemName', v_item_label,
          'templateItemId', v_universe_item_id::text,
          'completionId', v_completion_id::text,
          'instanceId', p_opening_instance_id::text,
          'openingDate', v_opening_date::text,
          'closerCount', v_closer_count,
          'groundTruthCount', v_ground_truth_count,
          'prepNeed', v_prep_need,
          'openerPrepped', v_opener_prepped,
          'deltaVsPrepNeed', v_delta,
          'overUnderStatus', v_over_under_status,
          'reasonCategory', v_over_under_reason_category,
          'freeText', v_over_under_reason_text
        ),
        'checklist_completions', v_completion_id, v_location_id, p_actor_id
      )
      RETURNING id INTO v_notif_id;

      -- Recipients: KH+ at this location + MoO + Owner DISTINCT (0053:460-482 / 0055:564-575)
      INSERT INTO notification_recipients (notification_id, user_id, delivery_method, delivery_status)
      SELECT v_notif_id, recipients.user_id, 'in_app', 'pending'
      FROM (
        SELECT DISTINCT u.id AS user_id
        FROM users u
        WHERE u.active = TRUE
          AND (
            (u.role IN (
              'cgs', 'owner', 'moo', 'gm', 'agm', 'catering_mgr',
              'shift_lead', 'key_holder', 'trainer', 'employee'
            )
             AND EXISTS (
               SELECT 1 FROM user_locations ul
               WHERE ul.user_id = u.id AND ul.location_id = v_location_id
             ))
            OR u.role = 'moo'
            OR u.role = 'owner'
          )
      ) recipients;

      v_notif_ids := array_append(v_notif_ids, v_notif_id);
    END IF;
  END LOOP;

  -- ──── Submission row (is_final_confirmation FALSE — Phase 3 is final) ────
  INSERT INTO checklist_submissions (
    instance_id, submitted_by, submitted_at, completion_ids, is_final_confirmation
  )
  VALUES (
    p_opening_instance_id, p_actor_id, v_submitted_at, v_completion_ids, FALSE
  )
  RETURNING id INTO v_submission_id;

  -- ──── Status transition (race-safe): phase1_complete → phase2_complete ────
  -- 0066: also stamp finalize provenance (confirmed_at/confirmed_by) so the
  -- dashboard Opening tile + any consumer can show "Finalized at {time} by
  -- {name}", consistent with am-prep + mid-day. Phase 3 (if ever wired) may
  -- re-stamp on final confirmation; phase2_complete is the current terminal.
  UPDATE checklist_instances
  SET status = 'phase2_complete',
      confirmed_at = v_submitted_at,
      confirmed_by = p_actor_id
  WHERE id = p_opening_instance_id
    AND status = 'phase1_complete';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'submit_phase2_atomic: phase2_not_eligible — instance % is not in status=phase1_complete (concurrent submit OR status already past Phase 2)',
      p_opening_instance_id
      USING ERRCODE = 'P0001';
  END IF;

  -- NO opening→closing auto-complete (C.54 §2.A — Phase 3 owns it).

  -- ──── Build result jsonb (mirrors Phase1RpcResult + C.50 counters) ────
  SELECT to_jsonb(ci) INTO v_opening_instance_row
  FROM checklist_instances ci WHERE ci.id = p_opening_instance_id;

  RETURN jsonb_build_object(
    'instance', v_opening_instance_row,
    'submissionId', v_submission_id,
    'completionIds', to_jsonb(v_completion_ids),
    'autoCompleteId', NULL,                 -- Phase 2 has no auto-complete target
    'editCount', 0,
    'originalSubmissionId', NULL,
    'underParNotificationIds', to_jsonb(v_notif_ids),
    'atParCount', v_at_par_count,
    'overPrepCount', v_over_prep_count,
    'underPrepCount', v_under_prep_count
  );
END;
$function$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 6g. create_recipe_full ← 0187 + batch_mode / shelf_life_days + one-ITEM-output rule
-- ═════════════════════════════════════════════════════════════════════════════════════════════
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

  return v_recipe_id;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 6h. add_recipe_output ← 0187 + recipe row lock + single-output refusal
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

  select coalesce(max(display_order), 0) + 1 into v_order
  from recipe_outputs where recipe_id = p_recipe_id;

  insert into recipe_outputs (recipe_id, output_item_id, output_menu_item_id, yield, output_container_label, display_order, created_by)
  values (p_recipe_id, p_output_item_id, p_output_menu_item_id, p_yield, nullif(p_output_container_label,''), v_order, p_created_by)
  returning id into v_id;

  return v_id;
end $$;

-- ── revoke_phase2_item_atomic — the Phase 2 revoke + toss retraction, ONE transaction ────────
-- Correction 1: looks up prep_batch_sessions by the SESSION KEY (instance_id, template_item_id)
-- and retracts any positive toss, whatever the revoked completion's JSON looks like (covers:
-- toss 8 → batch_mode off → single-box correction → revoke). The completion UPDATE is the exact
-- statement lib/opening.ts revokePhase2Completion ran (same columns, same predicates, same
-- 0057 reason vocabulary via the CHECK); rowcount 0 raises revoke_conflict. produced_at / made_by
-- on the session are untouched: the session identity survives revoke and re-entry.
create or replace function public.revoke_phase2_item_atomic(
  p_instance_id uuid,
  p_completion_id uuid,
  p_actor_id uuid,
  p_revocation_reason text,
  p_revocation_note text
)
returns jsonb
language plpgsql security definer set search_path to 'pg_catalog', 'public' as $function$
declare
  v_now timestamptz := now();
  v_row jsonb;
  v_template_item_id uuid;
  v_toss_retracted numeric := 0;
begin
  update checklist_completions cc
  set revoked_at = v_now,
      revoked_by = p_actor_id,
      revocation_reason = p_revocation_reason,
      revocation_note = p_revocation_note
  where cc.id = p_completion_id
    and cc.instance_id = p_instance_id
    and cc.revoked_at is null
    and cc.superseded_at is null
  returning to_jsonb(cc), cc.template_item_id into v_row, v_template_item_id;
  if v_row is null then
    raise exception 'revoke_phase2_item_atomic: revoke_conflict — completion % is not live on instance %',
      p_completion_id, p_instance_id using errcode = 'P0001';
  end if;
  -- The session key, not the JSON shape (correction 1). Lock the row, read the toss, zero it.
  select s.tossed_qty into v_toss_retracted
  from prep_batch_sessions s
  where s.instance_id = p_instance_id and s.template_item_id = v_template_item_id
  for update;
  if coalesce(v_toss_retracted, 0) > 0 then
    update prep_batch_sessions s
    set tossed_qty = 0,
        tossed_at = v_now,
        tossed_by = p_actor_id,
        updated_at = v_now
    where s.instance_id = p_instance_id and s.template_item_id = v_template_item_id;
  else
    v_toss_retracted := 0;
  end if;
  return jsonb_build_object('completion', v_row, 'tossRetracted', v_toss_retracted);
end
$function$;
revoke execute on function public.revoke_phase2_item_atomic(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.revoke_phase2_item_atomic(uuid, uuid, uuid, text, text) to service_role;

-- ── Grants on the re-emitted RPCs (CREATE OR REPLACE keeps ACLs; re-asserted so the file stands alone) ──
revoke execute on function public.submit_phase1_atomic(uuid, uuid, jsonb, jsonb, text, boolean, uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.submit_phase1_atomic(uuid, uuid, jsonb, jsonb, text, boolean, uuid, jsonb, text, text) to service_role;
revoke execute on function public.submit_mid_day_phase1_atomic(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.submit_mid_day_phase1_atomic(uuid, uuid, jsonb) to service_role;
revoke execute on function public.create_opening_instance_atomic(uuid, uuid, date, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.create_opening_instance_atomic(uuid, uuid, date, uuid, jsonb) to service_role;
revoke execute on function public.save_phase2_item_atomic(uuid, uuid, uuid, numeric, jsonb, jsonb, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_phase2_item_atomic(uuid, uuid, uuid, numeric, jsonb, jsonb, text, text, jsonb) to service_role;
revoke execute on function public.save_mid_day_phase2_item_atomic(uuid, uuid, uuid, numeric, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_mid_day_phase2_item_atomic(uuid, uuid, uuid, numeric, jsonb, jsonb, jsonb) to service_role;
revoke execute on function public.submit_phase2_atomic(uuid, uuid, boolean, uuid, text, text) from public, anon, authenticated;
grant execute on function public.submit_phase2_atomic(uuid, uuid, boolean, uuid, text, text) to service_role;
revoke execute on function create_recipe_full(jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function create_recipe_full(jsonb, jsonb, jsonb, uuid) to service_role;
revoke execute on function add_recipe_output(uuid, uuid, uuid, numeric, text, uuid) from public, anon, authenticated;
grant execute on function add_recipe_output(uuid, uuid, uuid, numeric, text, uuid) to service_role;

commit;
