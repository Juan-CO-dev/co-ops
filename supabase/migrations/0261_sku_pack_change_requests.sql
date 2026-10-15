-- Migration 0261_sku_pack_change_requests
-- AUTHORED 2026-10-15. NOT YET APPLIED — apply via MCP after review.
-- Plan: docs/superpowers/plans/2026-10-15-catalog-phase2b-item-page-jobs.md (Task 5).
-- Spec: docs/superpowers/specs/2026-10-15-catalog-redesign-design.md §2 ("This case looks different",
-- which files a pack change for the GM to approve), §4 ("What this changes"), §5 job 1.
-- Requires 0259 + 0260 (sku_pack_versions, sku_pack_epochs, save_sku_pack_version).
--
-- WHAT.
--   (1) sku_pack_change_requests — one row per "This case looks different" report from the receiving
--       door: the SKU, the shop, optionally the delivery it arrived on, an optional note, an optional
--       quick proposal (how many inside, about how much each weighs — the door does not edit chains),
--       an optional photo, and the outcome. One OPEN report per (SKU, shop): a second crew member
--       reporting the same case joins the first instead of stacking duplicate chores on the GM.
--       WORKING RECORD, NOT A LEDGER: open → applied | dismissed exactly once (guarded). No delete path.
--   (2) sku_pack_change_snapshot — the DEPENDENCY SNAPSHOT: the global live version and pars; per
--       reached shop its own live version, pack epoch (0259) and overlay lanes; the active shops.
--       STABLE, read-only, service_role only; the preview takes it, the apply re-takes it.
--   (3) apply_sku_pack_change — THE save behind "It arrives differently now" (lead decision D4). ONE
--       transaction:
--         a. THE SKU ROW LOCK FIRST — the very lock every 0259 writer takes (`vendor_items … active
--            for update`), so pack writes, price writes, lane changes and this apply serialize per SKU;
--         b. the reached shops' overlay rows locked, the dependency snapshot RE-TAKEN under the lock and
--            refused on any difference from the one the preview was computed on (a shop that gained
--            its own case, a par lane that moved, a new active shop — "something changed");
--         c. the door report: open, for THIS SKU, for a shop this save reaches;
--         d. 0259's save_sku_pack_version, called INSIDE this transaction (it re-takes the same lock —
--            a no-op — validates, closes + opens the version, derives the global flat mirror);
--         e. each par conversion re-checked against the value the person was SHOWN, then written;
--         f. the report marked applied with the version that answered it.
--       Any refusal anywhere rolls back EVERYTHING, the version included. The par patch for a shop is
--       computed in TypeScript by parWriteColumns({ kind: "admin" }) — THE one decider of what a human
--       par write does to the machine lane and the pin; this function refuses a key outside the slot
--       being converted. A conversion that CREATES the shop's own slot (`inherited`) comes from the
--       value the shop used to answer with — the inherited GLOBAL par, or the shop's AUTO par (whose
--       pack epoch this save bumps, D3) — and lands only while the shop's own slot is still EMPTY.
--
-- RLS: deny-all (RLS on, every PostgREST role revoked, no policies — the 0203/0214 posture) AND the
-- service-role privilege CEILING (the 0257/0259 pattern): revoke all from every role INCLUDING
-- service_role (Supabase's default privileges grant it DELETE and TRUNCATE), grant exactly SELECT,
-- INSERT, UPDATE, then assert both the forbidden and the required set. The only reader/writer is
-- lib/pack-change-requests.ts + lib/catalog/sku-item.ts (service role), which bind the actor to the
-- shop before any I/O; tests/location-bind-differential.test.ts lists the table, the RPC and the files.
-- Executable proof on synthetic rows: scripts/sql-harness-0261.mjs (PGlite: 0259 + 0260 + 0261).
--
-- VERIFY AFTER APPLY:
--   select relrowsecurity from pg_class where oid = 'public.sku_pack_change_requests'::regclass;  -- t
--   select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public'
--     and table_name = 'sku_pack_change_requests' order by 1, 2;   -- service_role INSERT / SELECT / UPDATE only (plus the owner)
--   select grantee from information_schema.routine_privileges where routine_schema = 'public'
--     and routine_name in ('apply_sku_pack_change', 'sku_pack_change_snapshot') and privilege_type = 'EXECUTE' order by 1;  -- service_role (+ owner)

begin;

-- ── (1) the door's report ───────────────────────────────────────────────────
create table if not exists public.sku_pack_change_requests (
  id                  uuid        primary key default gen_random_uuid(),
  sku_id              uuid        not null references public.vendor_items(id),
  location_id         uuid        not null references public.locations(id),
  delivery_id         uuid        null references public.vendor_deliveries(id),
  note                text        null check (note is null or length(note) <= 500),
  proposal            jsonb       null check (proposal is null or jsonb_typeof(proposal) = 'object'),
  photo_id            uuid        null references public.photos(id),
  status              text        not null default 'open'
                        check (status in ('open', 'applied', 'dismissed')),
  filed_by            uuid        not null references public.users(id),
  filed_at            timestamptz not null default now(),
  resolved_by         uuid        null references public.users(id),
  resolved_at         timestamptz null,
  resolved_version_id uuid        null references public.sku_pack_versions(id),
  constraint sku_pack_change_requests_resolution_pair check ((status = 'open') = (resolved_at is null)),
  constraint sku_pack_change_requests_applied_version check ((status = 'applied') = (resolved_version_id is not null))
);

comment on table public.sku_pack_change_requests is
  '"This case looks different" reports from the receiving door (0261). open → applied (a pack version '
  'saved by apply_sku_pack_change, resolved_version_id) | dismissed (nothing changed). One open report '
  'per (sku, shop). Deny-all; service_role SELECT/INSERT/UPDATE only.';

create unique index if not exists sku_pack_change_requests_one_open
  on public.sku_pack_change_requests (sku_id, location_id) where status = 'open';
create index if not exists sku_pack_change_requests_shop_open_ix
  on public.sku_pack_change_requests (location_id, filed_at desc, id desc) where status = 'open';

alter table public.sku_pack_change_requests enable row level security;
revoke all on public.sku_pack_change_requests from public, anon, authenticated, service_role;
grant select, insert, update on public.sku_pack_change_requests to service_role;

-- ── (2) the dependency snapshot (taken by the preview, re-taken by the apply under the lock) ──
create or replace function public.sku_pack_change_snapshot(p_sku uuid, p_shops uuid[])
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'global', (select jsonb_build_object(
                 'version_id', (select v.id from public.sku_pack_versions v where v.sku_id = p_sku and v.location_id is null and v.active),
                 'weekday_par', vi.weekday_par, 'weekend_par', vi.weekend_par)
                 from public.vendor_items vi where vi.id = p_sku),
    'shops', coalesce((
      select jsonb_agg(jsonb_build_object(
               'shop_id', sh.id,
               'own_version_id', (select v.id from public.sku_pack_versions v where v.sku_id = p_sku and v.location_id = sh.id and v.active),
               'pack_epoch', coalesce((select e.epoch from public.sku_pack_epochs e where e.sku_id = p_sku and e.location_id = sh.id), 0),
               'overlay', (select jsonb_build_object(
                             'weekday_par', o.weekday_par, 'weekend_par', o.weekend_par,
                             'auto_weekday_par', o.auto_weekday_par, 'auto_weekend_par', o.auto_weekend_par,
                             'auto_weekday_baseline_par', o.auto_weekday_baseline_par, 'auto_weekend_baseline_par', o.auto_weekend_baseline_par,
                             'auto_weekday_pack_epoch', o.auto_weekday_pack_epoch, 'auto_weekend_pack_epoch', o.auto_weekend_pack_epoch)
                             from public.location_sku_settings o where o.location_id = sh.id and o.sku_id = p_sku))
             order by sh.id)
        from unnest(p_shops) as sh(id)), '[]'::jsonb),
    'active_shops', coalesce((select jsonb_agg(l.id order by l.id) from public.locations l where l.active), '[]'::jsonb));
$$;

-- ── (3) the atomic apply ────────────────────────────────────────────────────
create or replace function public.apply_sku_pack_change(
  p_sku           uuid,
  p_location      uuid,
  p_levels        jsonb,
  p_expected_live uuid,
  p_based_on      uuid,
  p_note          text,
  p_actor         uuid,
  p_first_only    boolean,
  p_par_changes   jsonb,
  p_request       uuid,
  p_snapshot      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_req      record;
  v_saved    jsonb;
  v_version  uuid;
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
  v_shops    uuid[];
  v_has_row  boolean;
begin
  -- THE SKU LOCK FIRST — the very lock every 0259 writer takes (an ACTIVE SKU only).
  -- save_sku_pack_version re-takes it below in this same transaction (a no-op re-lock), so nothing
  -- in between interleaves with another writer of this SKU.
  perform 1 from public.vendor_items where id = p_sku and active for update;
  if not found then
    raise exception 'sku_pack_change:sku_not_found' using errcode = 'P0001';
  end if;

  -- THE DEPENDENCY SNAPSHOT, re-taken UNDER the lock (Astra 2b r2#2). Every other pack writer takes
  -- the SKU lock first, so no version, lane epoch or global par of this SKU can move from here to the
  -- commit; the reached shops' overlay rows are locked too. Anything that moved since the preview
  -- (a shop's own case, a par lane, a new shop) refuses the whole save: "something changed".
  if p_snapshot is null or jsonb_typeof(p_snapshot -> 'shops') is distinct from 'array' then
    raise exception 'sku_pack_change:invalid_payload' using errcode = 'P0001';
  end if;
  v_shops := array(select (x ->> 'shop_id')::uuid from jsonb_array_elements(p_snapshot -> 'shops') x);
  -- The reach the snapshot covers must be the save's: the shop itself, or every active shop.
  if p_location is not null and not (p_location = any (v_shops)) then
    raise exception 'sku_pack_change:invalid_payload' using errcode = 'P0001';
  end if;
  if p_location is null and exists (select 1 from public.locations l where l.active and not (l.id = any (v_shops))) then
    raise exception 'sku_pack_change:dependencies_changed' using errcode = 'P0001';
  end if;
  perform 1 from public.location_sku_settings where sku_id = p_sku and location_id = any (v_shops) order by id for update;
  if public.sku_pack_change_snapshot(p_sku, v_shops) is distinct from p_snapshot then
    raise exception 'sku_pack_change:dependencies_changed' using errcode = 'P0001';
  end if;

  -- The door report this save answers: OPEN, for THIS SKU, for a shop this save reaches.
  if p_request is not null then
    select id, sku_id, location_id, status into v_req
      from public.sku_pack_change_requests where id = p_request for update;
    if not found then
      raise exception 'sku_pack_change:request_mismatch' using errcode = 'P0001';
    end if;
    if v_req.status <> 'open' then
      raise exception 'sku_pack_change:request_not_open' using errcode = 'P0001';
    end if;
    if v_req.sku_id <> p_sku then
      raise exception 'sku_pack_change:request_mismatch' using errcode = 'P0001';
    end if;
    if p_location is not null and v_req.location_id <> p_location then
      raise exception 'sku_pack_change:request_mismatch' using errcode = 'P0001';
    end if;
    if p_location is null and exists (select 1 from public.sku_pack_versions
                                        where sku_id = p_sku and location_id = v_req.location_id and active) then
      -- A global save does not reach a shop with its own case, so it cannot answer that shop's report.
      raise exception 'sku_pack_change:request_mismatch' using errcode = 'P0001';
    end if;
  end if;

  -- THE VERSION — 0259's writer, inside this transaction: expected_live, first-only below MoO,
  -- the chain-shape validation, close + open, the global flat mirror.
  v_saved := public.save_sku_pack_version(p_sku, p_location, p_levels, p_expected_live, p_based_on, p_note, p_actor, p_first_only);
  v_version := (v_saved->>'version_id')::uuid;

  -- THE PARS, each bound to the value the person was shown. ANY mismatch refuses EVERYTHING (the
  -- version above included): a conversion computed from a number that has since moved is a guess.
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
          insert into public.location_sku_settings (location_id, sku_id, updated_by) values (v_loc, p_sku, p_actor) returning * into v_row;
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

  -- THE REPORT, closed by the version that answered it.
  if p_request is not null then
    update public.sku_pack_change_requests
       set status = 'applied', resolved_by = p_actor, resolved_at = now(), resolved_version_id = v_version
     where id = p_request and status = 'open';
    get diagnostics v_n = row_count;
    if v_n <> 1 then
      raise exception 'sku_pack_change:request_not_open' using errcode = 'P0001';
    end if;
  end if;

  return v_saved || jsonb_build_object('pars_converted', v_applied, 'request_applied', p_request is not null);
end;
$$;

revoke all on function public.apply_sku_pack_change(uuid, uuid, jsonb, uuid, uuid, text, uuid, boolean, jsonb, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_sku_pack_change(uuid, uuid, jsonb, uuid, uuid, text, uuid, boolean, jsonb, uuid, jsonb) to service_role;
revoke all on function public.sku_pack_change_snapshot(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.sku_pack_change_snapshot(uuid, uuid[]) to service_role;

-- ── (4) the guards ──────────────────────────────────────────────────────────
do $$ begin
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'sku_pack_change_requests'
                and grantee in ('PUBLIC', 'anon', 'authenticated')) then
    raise exception '0261: unexpected table grant';
  end if;
  if has_table_privilege('service_role', 'public.sku_pack_change_requests', 'DELETE')
     or has_table_privilege('service_role', 'public.sku_pack_change_requests', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.sku_pack_change_requests', 'REFERENCES')
     or has_table_privilege('service_role', 'public.sku_pack_change_requests', 'TRIGGER') then
    raise exception '0261: service_role above its ceiling';
  end if;
  if not (has_table_privilege('service_role', 'public.sku_pack_change_requests', 'SELECT')
          and has_table_privilege('service_role', 'public.sku_pack_change_requests', 'INSERT')
          and has_table_privilege('service_role', 'public.sku_pack_change_requests', 'UPDATE')) then
    raise exception '0261: service_role is missing a privilege the lib needs';
  end if;
  if has_function_privilege('anon', 'public.apply_sku_pack_change(uuid, uuid, jsonb, uuid, uuid, text, uuid, boolean, jsonb, uuid, jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.apply_sku_pack_change(uuid, uuid, jsonb, uuid, uuid, text, uuid, boolean, jsonb, uuid, jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.sku_pack_change_snapshot(uuid, uuid[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.sku_pack_change_snapshot(uuid, uuid[])', 'EXECUTE') then
    raise exception '0261: unexpected execute grant';
  end if;
  if exists (select 1 from information_schema.routine_privileges
              where routine_schema = 'public' and routine_name in ('apply_sku_pack_change', 'sku_pack_change_snapshot')
                and grantee in ('PUBLIC', 'anon', 'authenticated') and privilege_type = 'EXECUTE') then
    raise exception '0261: unexpected execute grant';
  end if;
  if not (has_function_privilege('service_role', 'public.apply_sku_pack_change(uuid, uuid, jsonb, uuid, uuid, text, uuid, boolean, jsonb, uuid, jsonb)', 'EXECUTE')
          and has_function_privilege('service_role', 'public.sku_pack_change_snapshot(uuid, uuid[])', 'EXECUTE')) then
    raise exception '0261: service_role is missing EXECUTE on the apply or the snapshot';
  end if;
end $$;

commit;
