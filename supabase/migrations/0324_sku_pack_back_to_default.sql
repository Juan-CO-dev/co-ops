-- Migration 0324_sku_pack_back_to_default
-- AUTHORED 2026-11-15. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word).
-- Provenance: CO-OPS bug audit wave W18, bug B107 (found at 7494f738). Owner decision W18-1 (a): do the
--   migration in this wave (Juan, 2026-11-15, plain recommended pick).
--
-- THE BUG. A shop's "Back to default" retired the shop's own pack version straight through 0259's
--   retire_sku_pack_version: no preview and no par conversion. A shop par of "4 cases" silently changed from
--   4 x 192 oz to 4 x 96 oz the moment the shop started riding the default case again. Restore had the same
--   hole and is fixed in the app (it now goes through the existing preview + apply_sku_pack_change path).
--   Back to default cannot: apply_sku_pack_change always SAVES a version, and a saved copy of the default
--   would stop the shop riding future default changes. The apply must RETIRE the shop's version.
--
-- FIX ROUND 1 (same file, still unapplied): bug B106's Accept half. The walker validated a suggestion's pack
--   epoch, then wrote the par in separate requests: a pack change committing in between (it bumps the epoch and
--   converts the shop's pars in ONE transaction) still let an old-case number land. Function 3 below closes it.
--
-- WHAT (three new functions; nothing existing is re-emitted, no table, column or row changes):
--   1. sku_pack_apply_par_changes(p_sku, p_location, p_par_changes, p_actor) returns integer — INTERNAL.
--      Its body is 0261 apply_sku_pack_change's par-conversion loop COPIED VERBATIM (pinned as a
--      line-subsequence by tests/sku-pack-back-to-default-migration.test.ts): every conversion bound to the
--      value the person was shown (`expected`), the patch keys allowlisted to the converted slot, the
--      "give this shop its own par" (`inherited`) rules, a shop par only where this save changes THAT shop.
--      apply_sku_pack_change is deliberately NOT re-emitted to call it: the live writer stays byte-identical
--      and the copy is proven equal by the pin instead. SECURITY INVOKER, no grant to any PostgREST role or
--      to service_role: only the definer function below (running as the owner) calls it.
--   2. apply_sku_pack_back_to_default(p_sku, p_location, p_version, p_actor, p_par_changes, p_snapshot)
--      returns jsonb — THE save behind a previewed "Back to default". ONE transaction:
--        a. THE SKU ROW LOCK FIRST (the 0259/0261 lock: `vendor_items … active for update`);
--        b. the snapshot shape checked, p_location in it, the shop's overlay row locked, and 0261's
--           sku_pack_change_snapshot RE-TAKEN under the lock — any difference from the preview's refuses
--           `sku_pack_change:dependencies_changed`;
--        c. the version: p_location's own, for p_sku, live (`not_found` / `version_sku_mismatch` /
--           `not_live`), then 0259's retire_sku_pack_version INSIDE this transaction (a no-op re-lock of
--           the SKU; the 0259 trigger bumps the shop's pack epoch, so a stale auto par retires at read time);
--        d. the accepted conversions through sku_pack_apply_par_changes (shop pars of p_location only;
--           a global-par conversion is `par_lane_mismatch`, as on any shop save);
--        e. returns { version_id, pars_converted }.
--      Any refusal rolls back EVERYTHING, the retire included. SECURITY DEFINER, search_path pinned,
--      EXECUTE for service_role only (revoked from public, anon, authenticated; asserted below).
--   3. apply_par_suggestion_accept(p_sku, p_location, p_day_class, p_value, p_expected_epoch, p_patch, p_actor)
--      returns uuid (the overlay row) — THE par write behind the walker's one-tap Accept (audit W18/B106):
--        a. THE SKU ROW LOCK FIRST — the same `vendor_items … for update` every pack writer (0259 / 0261 /
--           function 2) takes before it touches a version, so a pack change and an accept serialize;
--        b. UNDER it, this shop's pack epoch (sku_pack_epochs, absent = 0) must equal the epoch the
--           suggestion was computed in, or `par_suggestion:pack_changed` (the app answers
--           409 suggestion_superseded). An accept that wins the lock commits first, and the pack change
--           then refuses `dependencies_changed` on its own snapshot (the par lane moved);
--        c. the patch is the app's parWriteColumns("accept") output, allowlisted to the slot's five columns
--           and bound to p_value (`par_suggestion:invalid_patch`), written onto the shop's overlay row
--           (inserted if none; a concurrent insert is `par_suggestion:par_changed`, never a bare 23505).
--      No pin, budget or ledger logic here: the app still claims the generation (par_suggestion_actions)
--      before calling it and audits after, exactly as before. SECURITY DEFINER, search_path pinned,
--      EXECUTE for service_role only (asserted below).
--
-- APP for 3 (same PR): lib/dynamic-pars.ts writeParFromSuggestion("accept") calls it with the epoch the walk
--   validated (lib/dynamic-pars-walker.ts). BEFORE this file is applied the accept falls back to the previous
--   two-request write (the race stays open until the apply); nothing else changes.
-- APP (same PR): lib/catalog/sku-item.ts computeBackToDefaultPreview / applyPackBackToDefault, the route
--   /api/admin/catalog/sku/[id]/pack/back-to-default (Tier E, unchanged tier) and the item page. BEFORE this
--   file is applied the route still works for a Back to default with NO accepted conversion (it falls back
--   to the legacy retire and records that in its audit row); a save WITH conversions answers 503
--   `back_to_default_unavailable` until the function exists. Nothing else depends on this file.
--
-- EXISTING ROWS: none are touched. No table, column, index or policy changes.
--
-- DEPENDS ON: 0259 (sku_pack_versions, retire_sku_pack_version, sku_pack_epochs) + 0261
--   (sku_pack_change_snapshot, apply_sku_pack_change whose loop is copied) + 0183 (the machine-lane columns).
--
-- PRE-FLIGHT (MCP, read-only, before apply):
--   select to_regprocedure('public.retire_sku_pack_version(uuid,uuid)'),
--          to_regprocedure('public.sku_pack_change_snapshot(uuid,uuid[])'),
--          to_regprocedure('public.apply_sku_pack_change(uuid,uuid,jsonb,uuid,uuid,text,uuid,boolean,jsonb,uuid,jsonb)'); -- all present
--
-- VERIFY AFTER APPLY:
--   select routine_name, grantee from information_schema.routine_privileges where routine_schema = 'public'
--     and routine_name in ('apply_sku_pack_back_to_default', 'sku_pack_apply_par_changes', 'apply_par_suggestion_accept') order by 1, 2;
--     -- apply_sku_pack_back_to_default + apply_par_suggestion_accept: service_role (+ owner); sku_pack_apply_par_changes: owner only
--
-- ROLLBACK: drop function public.apply_par_suggestion_accept(uuid, uuid, text, numeric, bigint, jsonb, uuid);
--           drop function public.apply_sku_pack_back_to_default(uuid, uuid, uuid, uuid, jsonb, jsonb);
--           drop function public.sku_pack_apply_par_changes(uuid, uuid, jsonb, uuid);
--   (dropping apply_par_suggestion_accept returns the accept to the two-request write.)
--   (the app then answers back_to_default_unavailable for conversions and keeps the zero-conversion retire).
-- PROOF: scripts/sql-harness-0324.mjs (PGlite: the REAL 0259 + 0260 + 0261 + 0324, synthetic rows), pinned
--   by tests/sku-pack-back-to-default-migration.test.ts. SIM PROOF (not run by the builder):
--   scripts/sim/sku-pack-back-to-default-0324-check.mjs (Management API, sim only).
begin;

-- ── PRE-FLIGHT: 0259 + 0261 (+ 0183) applied ─────────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.retire_sku_pack_version(uuid,uuid)') is null
     or to_regprocedure('public.sku_pack_change_snapshot(uuid,uuid[])') is null
     or to_regprocedure('public.apply_sku_pack_change(uuid,uuid,jsonb,uuid,uuid,text,uuid,boolean,jsonb,uuid,jsonb)') is null then
    raise exception '0324: 0259 + 0261 (pack versions, the pack-change snapshot and apply) must be applied first';
  end if;
  if to_regclass('public.sku_pack_epochs') is null then
    raise exception '0324: 0259 sku_pack_epochs is missing: refusing';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'location_sku_settings' and column_name = 'pinned_weekday_at')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'location_sku_settings' and column_name = 'auto_weekday_applied_at') then
    raise exception '0324: the 0183 machine-lane columns are missing on location_sku_settings: refusing';
  end if;
end $$;

-- ── 1. the par-conversion loop, verbatim from 0261 apply_sku_pack_change ──────────────────────────────────
create or replace function public.sku_pack_apply_par_changes(
  p_sku         uuid,
  p_location    uuid,
  p_par_changes jsonb,
  p_actor       uuid
)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_change   jsonb;
  v_slot     text;
  v_from     text;
  v_loc      uuid;
  v_expected numeric;
  v_to       numeric;
  v_patch    jsonb;
  v_current  numeric;
  v_row      public.location_sku_settings%rowtype;
  v_new      public.location_sku_settings%rowtype;
  v_n        integer;
  v_applied  integer := 0;
  v_has_row  boolean;
begin
  -- THE PARS, each bound to the value the person was shown. ANY mismatch refuses EVERYTHING (the
  -- caller's version write included): a conversion computed from a number that has since moved is a guess.
  if p_par_changes is not null and jsonb_typeof(p_par_changes) <> 'array' then
    raise exception 'sku_pack_change:invalid_payload' using errcode = 'P0001';
  end if;
  for v_change in select value from jsonb_array_elements(coalesce(p_par_changes, '[]'::jsonb)) loop
    v_slot := v_change->>'slot';
    if v_slot is null or v_slot not in ('weekday', 'weekend') then
      raise exception 'sku_pack_change:invalid_payload' using errcode = 'P0001';
    end if;
    v_loc := (v_change->>'location_id')::uuid;
    v_expected := (v_change->>'expected')::numeric;
    v_to := (v_change->>'to')::numeric;
    if v_expected is null or v_to is null or v_to < 0 then
      raise exception 'sku_pack_change:invalid_payload' using errcode = 'P0001';
    end if;

    if v_loc is null then
      -- The GLOBAL par: only a global save converts it.
      if p_location is not null or coalesce((v_change->>'inherited')::boolean, false) then
        raise exception 'sku_pack_change:par_lane_mismatch' using errcode = 'P0001';
      end if;
      execute format('select %I from public.vendor_items where id = $1', v_slot || '_par') into v_current using p_sku;
      if v_current is distinct from v_expected then
        raise exception 'sku_pack_change:par_changed' using errcode = 'P0001';
      end if;
      execute format('update public.vendor_items set %I = $1 where id = $2', v_slot || '_par') using v_to, p_sku;
      get diagnostics v_n = row_count;
      if v_n <> 1 then
        raise exception 'sku_pack_change:par_changed' using errcode = 'P0001';
      end if;
    else
      -- A SHOP's own par: only where this save changes THAT shop's effective pack.
      if p_location is not null and v_loc <> p_location then
        raise exception 'sku_pack_change:par_lane_mismatch' using errcode = 'P0001';
      end if;
      if p_location is null and exists (select 1 from public.sku_pack_versions
                                          where sku_id = p_sku and location_id = v_loc and active) then
        raise exception 'sku_pack_change:par_lane_mismatch' using errcode = 'P0001';
      end if;
      v_patch := v_change->'patch';
      if v_patch is null or jsonb_typeof(v_patch) <> 'object'
         or (v_patch->>(v_slot || '_par'))::numeric is distinct from v_to
         or exists (select 1 from jsonb_object_keys(v_patch) as k(key)
                     where k.key not in (v_slot || '_par', 'auto_' || v_slot || '_par', 'auto_' || v_slot || '_baseline_par',
                                         'auto_' || v_slot || '_applied_at', 'pinned_' || v_slot || '_at')) then
        raise exception 'sku_pack_change:invalid_patch' using errcode = 'P0001';
      end if;
      select * into v_row from public.location_sku_settings where location_id = v_loc and sku_id = p_sku for update;
      v_has_row := found;
      if coalesce((v_change->>'inherited')::boolean, false) then
        -- "GIVE THIS SHOP ITS OWN PAR" (2b r2#3; lead decision on the auto lane): only a shop-only save,
        -- only while the shop still answers with the value it was shown — the inherited GLOBAL par, or
        -- its own AUTO par — and only into a human slot that is still EMPTY.
        v_from := coalesce(v_change->>'from', 'global');
        if v_from not in ('global', 'auto') then
          raise exception 'sku_pack_change:invalid_payload' using errcode = 'P0001';
        end if;
        if p_location is null or v_loc <> p_location then
          raise exception 'sku_pack_change:par_lane_mismatch' using errcode = 'P0001';
        end if;
        if v_from = 'global' then
          execute format('select %I from public.vendor_items where id = $1', v_slot || '_par') into v_current using p_sku;
        else
          v_current := case when v_has_row then (to_jsonb(v_row)->>('auto_' || v_slot || '_par'))::numeric end;
        end if;
        if v_current is distinct from v_expected then
          raise exception 'sku_pack_change:par_changed' using errcode = 'P0001';
        end if;
        if v_has_row and (to_jsonb(v_row)->>(v_slot || '_par')) is not null then
          raise exception 'sku_pack_change:par_changed' using errcode = 'P0001';
        end if;
        if not v_has_row then
          -- A concurrent writer may create the shop's row between the locked read above and this
          -- insert (no row existed to lock): that is "the par moved", refused by name, never a bare 23505.
          begin
            insert into public.location_sku_settings (location_id, sku_id, updated_by) values (v_loc, p_sku, p_actor) returning * into v_row;
          exception when unique_violation then
            raise exception 'sku_pack_change:par_changed' using errcode = 'P0001';
          end;
        end if;
      else
        if not v_has_row then
          raise exception 'sku_pack_change:par_changed' using errcode = 'P0001';
        end if;
        v_current := (to_jsonb(v_row)->>(v_slot || '_par'))::numeric;
        if v_current is distinct from v_expected then
          raise exception 'sku_pack_change:par_changed' using errcode = 'P0001';
        end if;
      end if;
      v_new := jsonb_populate_record(v_row, v_patch);
      update public.location_sku_settings
         set weekday_par = v_new.weekday_par, weekend_par = v_new.weekend_par,
             auto_weekday_par = v_new.auto_weekday_par, auto_weekend_par = v_new.auto_weekend_par,
             auto_weekday_baseline_par = v_new.auto_weekday_baseline_par, auto_weekend_baseline_par = v_new.auto_weekend_baseline_par,
             auto_weekday_applied_at = v_new.auto_weekday_applied_at, auto_weekend_applied_at = v_new.auto_weekend_applied_at,
             pinned_weekday_at = v_new.pinned_weekday_at, pinned_weekend_at = v_new.pinned_weekend_at,
             updated_by = p_actor, updated_at = now()
       where id = v_row.id;
      get diagnostics v_n = row_count;
      if v_n <> 1 then
        raise exception 'sku_pack_change:par_changed' using errcode = 'P0001';
      end if;
    end if;
    v_applied := v_applied + 1;
  end loop;
  return v_applied;
end;
$$;

-- ── 2. the atomic Back to default ─────────────────────────────────────────────────────────────────────────
create or replace function public.apply_sku_pack_back_to_default(
  p_sku         uuid,
  p_location    uuid,
  p_version     uuid,
  p_actor       uuid,
  p_par_changes jsonb,
  p_snapshot    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_shops   uuid[];
  v_ver     record;
  v_applied integer;
begin
  -- THE SKU LOCK FIRST — the very lock every 0259 / 0261 writer takes (an ACTIVE SKU only).
  perform 1 from public.vendor_items where id = p_sku and active for update;
  if not found then
    raise exception 'sku_pack_change:sku_not_found' using errcode = 'P0001';
  end if;
  if p_location is null then
    raise exception 'sku_pack_change:location_required' using errcode = 'P0001';
  end if;

  -- THE DEPENDENCY SNAPSHOT, re-taken UNDER the lock (0261's rule): the shop's own version, its pack
  -- epoch, its par lanes and the global pars must be what the preview was computed on.
  if p_snapshot is null or jsonb_typeof(p_snapshot -> 'shops') is distinct from 'array' then
    raise exception 'sku_pack_change:invalid_payload' using errcode = 'P0001';
  end if;
  v_shops := array(select (x ->> 'shop_id')::uuid from jsonb_array_elements(p_snapshot -> 'shops') x);
  if not (p_location = any (v_shops)) then
    raise exception 'sku_pack_change:invalid_payload' using errcode = 'P0001';
  end if;
  perform 1 from public.location_sku_settings where sku_id = p_sku and location_id = any (v_shops) order by id for update;
  if public.sku_pack_change_snapshot(p_sku, v_shops) is distinct from p_snapshot then
    raise exception 'sku_pack_change:dependencies_changed' using errcode = 'P0001';
  end if;

  -- THE VERSION: this shop's own, of this SKU, still live. Then 0259's retire, inside this transaction.
  select id, sku_id, location_id, active into v_ver from public.sku_pack_versions where id = p_version for update;
  if not found or v_ver.location_id is distinct from p_location then
    raise exception 'sku_pack_change:not_found' using errcode = 'P0001';
  end if;
  if v_ver.sku_id <> p_sku then
    raise exception 'sku_pack_change:version_sku_mismatch' using errcode = 'P0001';
  end if;
  if not v_ver.active then
    raise exception 'sku_pack_change:not_live' using errcode = 'P0001';
  end if;
  perform public.retire_sku_pack_version(p_version, p_actor);

  -- THE PARS, through the 0261 loop (verbatim copy): shop pars of p_location only, each against its value.
  v_applied := public.sku_pack_apply_par_changes(p_sku, p_location, p_par_changes, p_actor);

  return jsonb_build_object('version_id', p_version, 'pars_converted', v_applied);
end;
$$;

-- ── 3. the walker's Accept, bound to the pack epoch it was computed in (W18/B106) ─────────────────────────
create or replace function public.apply_par_suggestion_accept(
  p_sku            uuid,
  p_location       uuid,
  p_day_class      text,
  p_value          numeric,
  p_expected_epoch bigint,
  p_patch          jsonb,
  p_actor          uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_epoch bigint;
  v_row   public.location_sku_settings%rowtype;
  v_new   public.location_sku_settings%rowtype;
  v_n     integer;
begin
  if p_sku is null or p_location is null or p_expected_epoch is null or p_value is null or p_value < 0
     or p_day_class is null or p_day_class not in ('weekday', 'weekend') then
    raise exception 'par_suggestion:invalid_payload' using errcode = 'P0001';
  end if;

  -- THE SKU LOCK FIRST — the lock every pack writer takes before it changes a version (and so the epoch).
  perform 1 from public.vendor_items where id = p_sku for update;
  if not found then
    raise exception 'par_suggestion:not_found' using errcode = 'P0001';
  end if;

  -- UNDER the lock: the pack this shop receives is still the one the suggestion counted in.
  select epoch into v_epoch from public.sku_pack_epochs where sku_id = p_sku and location_id = p_location;
  if coalesce(v_epoch, 0) <> p_expected_epoch then
    raise exception 'par_suggestion:pack_changed' using errcode = 'P0001';
  end if;

  -- THE PATCH: the slot's own columns only (0261's allowlist), its par exactly the accepted value.
  if p_patch is null or jsonb_typeof(p_patch) <> 'object'
     or (p_patch->>(p_day_class || '_par'))::numeric is distinct from p_value
     or exists (select 1 from jsonb_object_keys(p_patch) as k(key)
                 where k.key not in (p_day_class || '_par', 'auto_' || p_day_class || '_par', 'auto_' || p_day_class || '_baseline_par',
                                     'auto_' || p_day_class || '_applied_at', 'pinned_' || p_day_class || '_at')) then
    raise exception 'par_suggestion:invalid_patch' using errcode = 'P0001';
  end if;

  select * into v_row from public.location_sku_settings where location_id = p_location and sku_id = p_sku for update;
  if not found then
    begin
      insert into public.location_sku_settings (location_id, sku_id, updated_by) values (p_location, p_sku, p_actor) returning * into v_row;
    exception when unique_violation then
      raise exception 'par_suggestion:par_changed' using errcode = 'P0001';
    end;
  end if;
  v_new := jsonb_populate_record(v_row, p_patch);
  update public.location_sku_settings
     set weekday_par = v_new.weekday_par, weekend_par = v_new.weekend_par,
         auto_weekday_par = v_new.auto_weekday_par, auto_weekend_par = v_new.auto_weekend_par,
         auto_weekday_baseline_par = v_new.auto_weekday_baseline_par, auto_weekend_baseline_par = v_new.auto_weekend_baseline_par,
         auto_weekday_applied_at = v_new.auto_weekday_applied_at, auto_weekend_applied_at = v_new.auto_weekend_applied_at,
         pinned_weekday_at = v_new.pinned_weekday_at, pinned_weekend_at = v_new.pinned_weekend_at,
         updated_by = p_actor, updated_at = now()
   where id = v_row.id;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'par_suggestion:par_changed' using errcode = 'P0001';
  end if;
  return v_row.id;
end;
$$;

-- ── 4. ACL: the applies for service_role only; the internal loop for nobody but the owner ─────────────────
revoke all on function public.sku_pack_apply_par_changes(uuid, uuid, jsonb, uuid) from public, anon, authenticated, service_role;
revoke all on function public.apply_sku_pack_back_to_default(uuid, uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_sku_pack_back_to_default(uuid, uuid, uuid, uuid, jsonb, jsonb) to service_role;
revoke all on function public.apply_par_suggestion_accept(uuid, uuid, text, numeric, bigint, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.apply_par_suggestion_accept(uuid, uuid, text, numeric, bigint, jsonb, uuid) to service_role;
do $$
declare
  f_apply  regprocedure := 'public.apply_sku_pack_back_to_default(uuid,uuid,uuid,uuid,jsonb,jsonb)'::regprocedure;
  f_loop   regprocedure := 'public.sku_pack_apply_par_changes(uuid,uuid,jsonb,uuid)'::regprocedure;
  f_accept regprocedure := 'public.apply_par_suggestion_accept(uuid,uuid,text,numeric,bigint,jsonb,uuid)'::regprocedure;
begin
  if has_function_privilege('anon', f_accept, 'EXECUTE') or has_function_privilege('authenticated', f_accept, 'EXECUTE') then
    raise exception '0324: unexpected execute grant on %', f_accept;
  end if;
  if not has_function_privilege('service_role', f_accept, 'EXECUTE') then
    raise exception '0324: service_role lost EXECUTE on %', f_accept;
  end if;
  if not (select prosecdef from pg_proc where oid = f_accept)
     or not coalesce((select proconfig from pg_proc where oid = f_accept) @> array['search_path=pg_catalog, public'], false) then
    raise exception '0324: % must be SECURITY DEFINER with a pinned search_path', f_accept;
  end if;
  if has_function_privilege('anon', f_apply, 'EXECUTE') or has_function_privilege('authenticated', f_apply, 'EXECUTE') then
    raise exception '0324: unexpected execute grant on %', f_apply;
  end if;
  if not has_function_privilege('service_role', f_apply, 'EXECUTE') then
    raise exception '0324: service_role lost EXECUTE on %', f_apply;
  end if;
  if has_function_privilege('anon', f_loop, 'EXECUTE') or has_function_privilege('authenticated', f_loop, 'EXECUTE')
     or has_function_privilege('service_role', f_loop, 'EXECUTE') then
    raise exception '0324: unexpected execute grant on %', f_loop;
  end if;
  if exists (select 1 from pg_proc p, lateral aclexplode(p.proacl) a where p.oid in (f_apply, f_loop, f_accept) and a.grantee = 0) then
    raise exception '0324: PUBLIC holds EXECUTE on a 0324 function';
  end if;
  if not (select prosecdef from pg_proc where oid = f_apply)
     or not coalesce((select proconfig from pg_proc where oid = f_apply) @> array['search_path=pg_catalog, public'], false) then
    raise exception '0324: % must be SECURITY DEFINER with a pinned search_path', f_apply;
  end if;
  if (select prosecdef from pg_proc where oid = f_loop)
     or not coalesce((select proconfig from pg_proc where oid = f_loop) @> array['search_path=pg_catalog, public'], false) then
    raise exception '0324: % must be SECURITY INVOKER with a pinned search_path', f_loop;
  end if;
end $$;
commit;
