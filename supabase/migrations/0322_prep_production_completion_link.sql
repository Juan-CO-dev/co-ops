-- Migration 0322_prep_production_completion_link
-- AUTHORED 2026-11-15. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word, AFTER 0215).
-- Provenance: CO-OPS bug audit wave W16, bugs B090 + B091 (+ the B094 legacy-row step), found at 7494f738.
--   Plan: audit/plans/W16.md; owner decisions: the recommended picks (decisions-resolved 2026-11-15).
--
-- WHAT:
--   1. productions.completion_id uuid NULL → checklist_completions(id): the Phase 2 completion a prep production
--      header was folded from. NULL = a manual production, or a prep header written before 0322.
--   2. record_prep_production_atomic: the ONE writer of prep production headers (both folds in
--      lib/prep-consumption.ts). In one transaction it locks the completion row (FOR NO KEY UPDATE, the house
--      parent-lock mode), refuses to write anything when that completion is no longer the live head
--      ('stale_completion' — B090: a slow fold of an older save can no longer supersede the newer save's
--      production), then supersedes the live header for (instance, template item), inserts the new header with
--      completion_id, and inserts its lines. Header and lines are atomic (no header-without-lines window).
--      B091: a SINGLE-BOX re-save keeps the first save's time — produced_at = the superseded live header's
--      produced_at, else this completion's completed_at (never the fold's clock). A BATCH row takes the
--      session's produced_at from p_batch (0215 ruling E, unchanged).
--      Lock order: completion → productions. The save / revoke RPCs (0215) lock the completion and never
--      touch productions, so there is no cycle; a save that supersedes C waits for a fold holding C, and a fold
--      that arrives after the save sees C superseded and skips.
--   3. B094 (owner pick, decisions 2026-11-15 "plain recommended picks"): the two legacy BUSINESS-WIDE
--      dining-option exclusions ('Ezcater', 'App Catering Delivery', authored 2026-07-25) are deactivated.
--      They have never matched anything (the ingest passed dining_option = null); the W16 app change makes
--      dining-option rules match, and these two would then undo the reconciled ezCater counting and B093.
--      Deactivate (active = false), never delete; one audit row per row touched.
--
-- EXISTING ROWS: productions untouched (completion_id NULL, no backfill). Past re-save double depletion (B091) is
--   not repaired: past headers keep their later produced_at. Exclusions: only the two rows above (by
--   location_id NULL + kind + the matcher's case-insensitive trimmed value), and only while active.
--
-- APP (same PR, W16): lib/prep-consumption.ts calls this function; when it is not installed yet (PGRST202 /
--   42883) the folds fall back to the pre-0322 direct writes, now with the same liveness check and produced_at
--   rule done in TypeScript (not atomic: the B090 window narrows but is not closed until this file is applied).
--   Apply this file BEFORE the W16 deploy reads dining options (lib/catering/toast-sales.ts), so the two legacy
--   rows are inactive before they could start matching.
--
-- DEPENDS ON: 0102 (productions header/lines), 0107 (unique live (instance, template item) index), 0215 (batch
--   columns), 0147 (toast_ingest_exclusions), 0196 (one live completion head per phase kind).
--
-- PRE-FLIGHT (MCP, read-only, before apply):
--   select column_name from information_schema.columns where table_schema='public' and table_name='productions'
--    and column_name in ('completion_id','batches_made','made_by');                         -- batches_made, made_by (+ completion_id on re-apply)
--   select instance_id, template_item_id, count(*) from public.productions
--    where superseded_at is null and revoked_at is null and instance_id is not null
--    group by 1,2 having count(*) > 1;                                                       -- 0 rows (0107 enforces)
--   select id, location_id, kind, value, active from public.toast_ingest_exclusions where active order by created_at;
--     -- every active rule; exactly these two business-wide ones are switched off by step 3
--
-- VERIFY AFTER APPLY:
--   select to_regprocedure('public.record_prep_production_atomic(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,jsonb,jsonb)'); -- not null
--   select routine_name, grantee from information_schema.routine_privileges
--    where routine_schema='public' and routine_name='record_prep_production_atomic' order by 2;  -- service_role (+ postgres) only
--   select count(*) from public.toast_ingest_exclusions where location_id is null and kind='dining_option'
--    and lower(btrim(value)) in ('ezcater','app catering delivery') and active;              -- 0
--   Sim proof (two devices saving one row): scripts/sim/prep-production-0322-lock-check-management.mjs (CC, sim only; never run by the builder).
--
-- ROLLBACK: drop function public.record_prep_production_atomic(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,jsonb,jsonb);
--   (the app falls back to the direct writes). The column may stay (nullable, unread). The two exclusions can be
--   re-activated by id from the audit rows (metadata.exclusion_id).
-- PROOF: scripts/sql-harness-0322.mjs (PGlite, synthetic rows), pinned by tests/prep-production-fold-migration.test.ts.
begin;

-- ── PRE-FLIGHT: what this file builds on ─────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.productions') is null or to_regclass('public.production_inputs') is null
     or to_regclass('public.checklist_completions') is null or to_regclass('public.checklist_instances') is null
     or to_regclass('public.toast_ingest_exclusions') is null or to_regclass('public.audit_log') is null then
    raise exception '0322: productions / production_inputs / checklist tables / toast_ingest_exclusions / audit_log missing';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'productions'
        and column_name in ('instance_id','template_item_id','superseded_at','revoked_at','produced_at',
                            'batches_made','came_out_to','yield_at_time','made_by')) <> 9 then
    raise exception '0322: productions is missing a 0102 / 0215 column (expected 0215 applied first)';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'checklist_completions'
        and column_name in ('instance_id','template_item_id','completed_at','superseded_at','revoked_at','prep_data')) <> 6 then
    raise exception '0322: checklist_completions is missing an expected column';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'productions_prep_live_idx'
                   and indexdef ilike 'create unique index%') then
    raise exception '0322: the 0107 unique live index productions_prep_live_idx is missing';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'productions'
               and column_name = 'completion_id' and data_type <> 'uuid') then
    raise exception '0322: productions.completion_id exists with an unexpected type: refusing';
  end if;
end $$;

-- ── 1. productions.completion_id (idempotent) ────────────────────────────────────────────────────────────────
alter table public.productions
  add column if not exists completion_id uuid null references public.checklist_completions(id);
comment on column public.productions.completion_id is
  'The Phase 2 checklist completion this prep header was folded from (0322, W16/B090). NULL = manual production or a prep header written before 0322. Written only by record_prep_production_atomic.';

-- ── 2. record_prep_production_atomic ─────────────────────────────────────────────────────────────────────────
create or replace function public.record_prep_production_atomic(
  p_completion_id uuid, p_location_id uuid, p_instance_id uuid, p_template_item_id uuid,
  p_output_item_id uuid, p_output_qty numeric, p_source text, p_actor_id uuid,
  p_lines jsonb, p_batch jsonb default null
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  c public.checklist_completions%rowtype;
  v_now timestamptz := clock_timestamp();
  v_prior_produced_at timestamptz;
  v_produced_at timestamptz;
  v_id uuid;
  v_lines integer;
begin
  if p_completion_id is null or p_location_id is null or p_instance_id is null or p_template_item_id is null
     or p_output_item_id is null or p_source is null or p_source not in ('opening_p2','mid_day_p2')
     or p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'record_prep_production_atomic: invalid_input' using errcode = 'P0001';
  end if;
  -- Every line is {sku_id uuid, input_oz number, qty_entered number|null, unit_entered string|null, derived_oz number|null}.
  if exists (select 1 from jsonb_array_elements(p_lines) e
              where jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'sku_id') is distinct from 'string'
                 or jsonb_typeof(e->'input_oz') is distinct from 'number'
                 or coalesce(jsonb_typeof(e->'qty_entered'), 'null') not in ('number','null')
                 or coalesce(jsonb_typeof(e->'unit_entered'), 'null') not in ('string','null')
                 or coalesce(jsonb_typeof(e->'derived_oz'), 'null') not in ('number','null')) then
    raise exception 'record_prep_production_atomic: invalid_input (lines)' using errcode = 'P0001';
  end if;
  if p_batch is not null and (jsonb_typeof(p_batch) <> 'object' or jsonb_typeof(p_batch->'produced_at') is distinct from 'string'
     or jsonb_typeof(p_batch->'made_by') is distinct from 'string') then
    raise exception 'record_prep_production_atomic: invalid_input (batch)' using errcode = 'P0001';
  end if;

  -- The completion this fold is for, locked: a save superseding it (or a revoke) waits for this transaction.
  select * into c from public.checklist_completions where id = p_completion_id for no key update;
  if not found or c.instance_id is distinct from p_instance_id or c.template_item_id is distinct from p_template_item_id
     or not coalesce(c.prep_data ? 'phase2', false) then
    raise exception 'record_prep_production_atomic: completion_mismatch' using errcode = 'P0001';
  end if;
  perform 1 from public.checklist_instances where id = p_instance_id and location_id = p_location_id;
  if not found then
    raise exception 'record_prep_production_atomic: location_mismatch' using errcode = 'P0001';
  end if;
  if c.superseded_at is not null or c.revoked_at is not null then
    -- B090: a newer save (or a revoke) already owns this row's production. Write nothing.
    return jsonb_build_object('status', 'stale_completion', 'production_id', null);
  end if;

  update public.productions set superseded_at = v_now
   where instance_id = p_instance_id and template_item_id = p_template_item_id
     and superseded_at is null and revoked_at is null
  returning produced_at into v_prior_produced_at;   -- at most one row (0107 unique live index)

  select count(*) into v_lines from jsonb_array_elements(p_lines) e where (e->>'input_oz')::numeric > 0;
  if v_lines = 0 then
    return jsonb_build_object('status', 'cleared', 'production_id', null);
  end if;
  if p_output_qty is null or p_output_qty <= 0 then
    raise exception 'record_prep_production_atomic: invalid_input (output_qty)' using errcode = 'P0001';
  end if;

  -- B091: a single-box re-save keeps the first save's time; a batch row carries its session's time.
  v_produced_at := case when p_batch is not null then (p_batch->>'produced_at')::timestamptz
                        else coalesce(v_prior_produced_at, c.completed_at) end;

  insert into public.productions (location_id, output_item_id, output_qty, source, instance_id, template_item_id,
    created_by, produced_at, completion_id, batches_made, came_out_to, yield_at_time, made_by)
  values (p_location_id, p_output_item_id, p_output_qty, p_source, p_instance_id, p_template_item_id,
    p_actor_id, v_produced_at, p_completion_id,
    (p_batch->>'batches_made')::integer, (p_batch->>'came_out_to')::numeric,
    (p_batch->>'yield_at_time')::numeric, (p_batch->>'made_by')::uuid)
  returning id into v_id;

  insert into public.production_inputs (production_id, input_sku_id, input_oz, qty_entered, unit_entered, derived_oz)
  select v_id, x.sku_id, x.input_oz, x.qty_entered, x.unit_entered, x.derived_oz
    from jsonb_to_recordset(p_lines) as x(sku_id uuid, input_oz numeric, qty_entered numeric, unit_entered text, derived_oz numeric)
   where x.input_oz > 0;

  return jsonb_build_object('status', 'recorded', 'production_id', v_id, 'produced_at', v_produced_at);
end $$;

revoke all on function public.record_prep_production_atomic(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.record_prep_production_atomic(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,jsonb,jsonb) to service_role;

-- ── 3. B094: the two legacy business-wide dining-option exclusions (idempotent; deactivate, never delete) ────
do $$
declare r record; n integer := 0;
begin
  for r in
    update public.toast_ingest_exclusions set active = false
     where location_id is null and kind = 'dining_option' and active
       and lower(btrim(value)) in ('ezcater', 'app catering delivery')
    returning id, value
  loop
    n := n + 1;
    insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
    values (null, null, 'toast_sales.exclusion_remove', 'toast_ingest_exclusions', r.id, false,
      jsonb_build_object('actor_context', 'migration_apply', 'migration', '0322_prep_production_completion_link',
        'bug', 'B094', 'exclusion_id', r.id, 'value', r.value,
        'cause', 'legacy business-wide dining-option rule; replaced by sales_channel_map, deactivated before dining-option rules start matching (owner pick, 2026-11-15)'));
  end loop;
  if n > 2 then
    raise exception '0322: expected at most the 2 legacy dining-option rows, matched %', n;
  end if;
  raise notice '0322: deactivated % legacy dining-option exclusion(s)', n;
end $$;

-- ── 4. Posture proof ─────────────────────────────────────────────────────────────────────────────────────────
do $$
declare f regprocedure := 'public.record_prep_production_atomic(uuid,uuid,uuid,uuid,uuid,numeric,text,uuid,jsonb,jsonb)'::regprocedure;
begin
  if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
    raise exception '0322: record_prep_production_atomic grant escaped';
  end if;
  if not has_function_privilege('service_role', f, 'EXECUTE') then
    raise exception '0322: service_role lacks EXECUTE on record_prep_production_atomic';
  end if;
  if exists (select 1 from pg_proc p, lateral aclexplode(p.proacl) a where p.oid = f and a.grantee = 0) then
    raise exception '0322: PUBLIC holds EXECUTE on record_prep_production_atomic';
  end if;
  if not (select prosecdef from pg_proc where oid = f)
     or not coalesce((select proconfig from pg_proc where oid = f) @> array['search_path=pg_catalog, public'], false) then
    raise exception '0322: record_prep_production_atomic must be SECURITY DEFINER with a pinned search_path';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'record_prep_production_atomic') <> 1 then
    raise exception '0322: expected exactly one record_prep_production_atomic signature';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'productions'
                   and column_name = 'completion_id' and data_type = 'uuid' and is_nullable = 'YES') then
    raise exception '0322: productions.completion_id missing after apply';
  end if;
end $$;
commit;
