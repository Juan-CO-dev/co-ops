-- Migration 0259_sku_shop_versions
-- AUTHORED 2026-10-15. NOT YET APPLIED — apply via MCP after review (sim → prod dry-run → prod, BEFORE the 2a code merges).
-- Plan: docs/superpowers/plans/2026-10-15-catalog-phase2a-shop-versions-data.md (Task 3).
-- Spec: docs/superpowers/specs/2026-10-15-catalog-redesign-design.md §3 (global defaults + shop versions).
--
-- WHAT. Shop versions of a SKU's PACK CHAIN and PRICE, beside the global default, in the house
-- idiom `location_id NULL = global` (product_primaries 0179, location_sku_settings 0174):
--
--   sku_pack_versions        the chain-as-a-set, now a row, EFFECTIVE-DATED (valid_from / valid_to;
--                            append-only: a save closes the old version and opens a new one).
--                            location_id NULL = global; a shop id = that shop's version, based_on
--                            the version it came from. Every existing level set is backfilled into
--                            a GLOBAL version carrying its real dates.
--   sku_pack_levels          + version_id, + location_id (denormalized), + scope_key (generated);
--                            a composite FK (version_id, sku_id, scope_key) proves IN THE DATABASE
--                            that a level's shop is its version's shop.
--   sku_price_lanes          a shop's own price lane; "back to default" retires it, rows stay.
--   vendor_price_history     + location_id (NULL = global), + price_lane_id; CHECK-paired, FK-proven.
--   sku_pack_epochs          per (sku, shop), a MONOTONIC count of every change of the pack that shop
--                            EFFECTIVELY receives (its own version made or retired; the global one
--                            replaced while it rides it), bumped by a trigger on sku_pack_versions.
--   location_sku_settings    + auto_{weekday,weekend}_pack_epoch: the epoch a machine par was computed
--                            in (D3) — any other epoch retires it at read time, and "back to default"
--                            is a NEW epoch, so it can never resurrect a stale value (G → S → G).
--   sku_pack_versions.flat_snapshot   a PRE-CHAIN BASELINE: when a SKU gets its first global chain, a
--                            trigger first records its legacy flat pack as a version valid up to that
--                            moment, so a past business date never resolves to the overwritten mirror.
--   sku_flat_mirror_apply    the GLOBAL flat mirror (vendor_items pack fields), derived from the chain
--                            INSIDE save_sku_pack_version's locked transaction — never synced after.
--
-- SUPERSEDES 0159 council lock L4 (per-shop pack variance lives on chain versions now).
--
-- THE RESOLUTION RULE IS NOT IN SQL. Readers resolve "this shop's version in force, else global"
-- in ONE pure place (lib/sku-versions-shared.ts) behind the existing loaders — live by `active`,
-- historically by valid_from / valid_to (a past business date resolves as of its last instant).
--
-- EVERY WRITER TAKES THE SKU ROW LOCK FIRST (`vendor_items … for update`), so pack writes, price
-- writes, lane changes and the first-value rule serialize per SKU:
--   save_sku_pack_version(…, p_first_only)   p_first_only (a GM's global write) refuses when a global
--                                            chain exists — decided UNDER the lock, same transaction.
--   retire_sku_pack_version                  a shop's "back to default"; never global.
--   save_sku_shop_price                      opens the shop's lane on its first price, appends.
--   save_sku_global_price(…, p_first_only)   p_first_only (an AGM/GM) refuses when a global price exists.
--   retire_sku_price_lane                    a shop's price "back to default".
--   record_receiving_prices                  the door (decision e): per SKU, lock → this shop's live lane,
--                                            else OPEN its first lane → append there. A shared SKU's global
--                                            price is never written by a delivery; a shop's own store-copy
--                                            SKU (vendor_items.location_id = the shop) keeps its global row.
-- plus the two live SQL chain writers, re-emitted (scripts/shop-versions/reemit-mods.ts lists every
-- change): apply_vendor_import (0211) and receiving_create_store_item (0216, now deriving the copy's
-- flat mirror from the chain it actually cloned).
--
-- BACKWARD COMPATIBLE WITH THE CODE RUNNING WHEN THIS IS APPLIED: version_id stays NULLABLE (0260
-- tightens it after the 2a deploy and heals the window), every new column is nullable, the replaced
-- label index is the old one plus the scope, and no existing policy or grant changes.
-- vendor_price_history keeps its read policy (level >= 6, 0058).
--
-- PRIVILEGE CEILING (the Phase 1 0257 pattern): both new tables revoke ALL from public, anon,
-- authenticated AND service_role (Supabase's default privileges hand it ALL), grant exactly SELECT,
-- INSERT, UPDATE to service_role, and the guard proves no DELETE/TRUNCATE/REFERENCES/TRIGGER and
-- no missing privilege.
--
-- VERIFY AFTER APPLY:
--   select relname, relrowsecurity from pg_class where oid in
--     ('public.sku_pack_versions'::regclass, 'public.sku_price_lanes'::regclass);               -- t, t
--   select table_name, grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name in ('sku_pack_versions','sku_price_lanes') order by 1,2,3;
--     -- service_role INSERT / SELECT / UPDATE only (plus the owner)
--   select routine_name, grantee from information_schema.routine_privileges
--    where routine_schema = 'public' and privilege_type = 'EXECUTE'
--      and routine_name in ('save_sku_pack_version','retire_sku_pack_version','save_sku_shop_price','save_sku_global_price',
--                           'retire_sku_price_lane','record_receiving_prices','apply_vendor_import','receiving_create_store_item')
--    order by 1, 2;                                                           -- service_role (+ owner) only
--   select count(*) from public.sku_pack_levels where version_id is null;   -- 0
--   select count(*) from (select sku_id from public.sku_pack_versions where active group by sku_id, scope_key having count(*) > 1) x;  -- 0
--   select count(*) from public.sku_pack_levels l join public.sku_pack_versions v on v.id = l.version_id where l.active <> v.active;  -- 0
--   select count(*) from public.location_sku_settings where auto_weekday_par is not null and auto_weekday_pack_epoch is null;  -- 0 (D3 stamp)
--   select count(*) from public.sku_pack_epochs;                         -- 0 right after apply (no change has happened yet)
--   select tgname from pg_trigger where tgrelid = 'public.sku_pack_versions'::regclass and not tgisinternal order by 1;
--     -- sku_pack_versions_epoch, sku_pack_versions_flat_baseline

begin;

-- ── (1) sku_pack_versions ─────────────────────────────────────────────────────
create table if not exists public.sku_pack_versions (
  id                  uuid        primary key default gen_random_uuid(),
  sku_id              uuid        not null references public.vendor_items(id),
  location_id         uuid        null references public.locations(id),
  scope_key           uuid        generated always as (coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  based_on_version_id uuid        null references public.sku_pack_versions(id),
  active              boolean     not null default true,
  valid_from          timestamptz not null default now(),
  valid_to            timestamptz null,
  note                text        null,
  flat_snapshot       jsonb       null,
  created_at          timestamptz not null default now(),
  created_by          uuid        null references public.users(id),
  retired_by          uuid        null references public.users(id),
  constraint sku_pack_versions_baseline_never_live check (flat_snapshot is null or not active),
  constraint sku_pack_versions_identity_uq unique (id, sku_id, scope_key)
);

comment on table public.sku_pack_versions is
  'A SKU''s pack chain as an effective-dated SET (0259). location_id NULL = the global default; a shop '
  'id = that shop''s own version, based_on the version it came from. In force over [valid_from, valid_to); '
  'one live (active, valid_to NULL) version per (sku, scope_key). Append-only: a save closes the old '
  'version and opens a new one; nothing is deleted. Resolution: lib/sku-versions-shared.ts.';

create index if not exists sku_pack_versions_history_ix on public.sku_pack_versions (sku_id, created_at desc);
create index if not exists sku_pack_versions_as_of_ix on public.sku_pack_versions (sku_id, scope_key, valid_from);

-- ── (2) sku_pack_levels: the version and the shop ─────────────────────────────
alter table public.sku_pack_levels
  add column if not exists version_id  uuid null,
  add column if not exists location_id uuid null references public.locations(id);
alter table public.sku_pack_levels
  add column if not exists scope_key uuid generated always as (coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored;

-- ── (3) backfill: every existing level set becomes a dated GLOBAL version ────
do $$
declare
  v_groups      int;
  v_levels      int;
  v_unversioned int;
  v_multi_live  int;
begin
  insert into public.sku_pack_versions (sku_id, location_id, active, valid_from, created_at, created_by)
  select g.sku_id, null, g.active, g.effective_from, g.effective_from, g.created_by
    from (select sku_id, effective_from, active, (array_agg(created_by order by id))[1] as created_by
            from public.sku_pack_levels
           where version_id is null
           group by sku_id, effective_from, active) g;
  get diagnostics v_groups = row_count;

  update public.sku_pack_levels l
     set version_id = v.id
    from public.sku_pack_versions v
   where l.version_id is null and v.location_id is null
     and v.sku_id = l.sku_id and v.valid_from = l.effective_from and v.active = l.active;
  get diagnostics v_levels = row_count;

  select count(*) into v_unversioned from public.sku_pack_levels where version_id is null;
  assert v_unversioned = 0, format('0259: %s pack levels left without a version', v_unversioned);

  select count(*) into v_multi_live
    from (select sku_id from public.sku_pack_versions where active and location_id is null group by sku_id having count(*) > 1) x;
  assert v_multi_live = 0, format('0259: %s SKUs would have two live global chains', v_multi_live);

  -- History: each global version is based on the one before it; an inactive one stopped being in
  -- force when the next began (an inactive set with no successor closes on its own start).
  update public.sku_pack_versions v
     set based_on_version_id = h.prev_id,
         valid_to = case when v.active then null else coalesce(h.next_from, v.valid_from) end
    from (select id, lag(id) over w as prev_id, lead(valid_from) over w as next_from
            from public.sku_pack_versions where location_id is null
          window w as (partition by sku_id order by valid_from, active, id)) h
   where h.id = v.id and v.based_on_version_id is null;

  raise notice '0259 backfill: % global versions, % levels linked', v_groups, v_levels;
end $$;

alter table public.sku_pack_versions drop constraint if exists sku_pack_versions_live_window;
alter table public.sku_pack_versions
  add constraint sku_pack_versions_live_window check ((valid_to is null) = active);

-- ── (4) the DB-proven link and the scoped indexes ────────────────────────────
alter table public.sku_pack_levels drop constraint if exists sku_pack_levels_version_fk;
alter table public.sku_pack_levels
  add constraint sku_pack_levels_version_fk
  foreign key (version_id, sku_id, scope_key) references public.sku_pack_versions (id, sku_id, scope_key);

drop index if exists public.sku_pack_levels_sku_label_active;
create unique index if not exists sku_pack_levels_scope_label_active
  on public.sku_pack_levels (sku_id, scope_key, label) where active;
create index if not exists sku_pack_levels_scope_active on public.sku_pack_levels (sku_id, location_id) where active;
create index if not exists sku_pack_levels_version_ix on public.sku_pack_levels (version_id);
create unique index if not exists sku_pack_versions_one_live
  on public.sku_pack_versions (sku_id, scope_key) where active;

comment on column public.sku_pack_levels.version_id is
  'The sku_pack_versions set this level belongs to (0259). NULLABLE until 0260 heals rows written by pre-2a code in the deploy window.';
comment on column public.sku_pack_levels.location_id is
  'Denormalized from the version (0259): NULL = global, a shop id = that shop''s version. Proven by sku_pack_levels_version_fk.';

-- ── (5) price lanes ──────────────────────────────────────────────────────────
create table if not exists public.sku_price_lanes (
  id                uuid        primary key default gen_random_uuid(),
  sku_id            uuid        not null references public.vendor_items(id),
  location_id       uuid        not null references public.locations(id),
  based_on_price_id uuid        null references public.vendor_price_history(id),
  active            boolean     not null default true,
  created_at        timestamptz not null default now(),
  created_by        uuid        null references public.users(id),
  retired_at        timestamptz null,
  retired_by        uuid        null references public.users(id),
  constraint sku_price_lanes_identity_uq unique (id, sku_id, location_id)
);
comment on table public.sku_price_lanes is
  'A shop''s OWN price for a SKU (0259). While live, that shop is priced from the newest row of the lane; '
  'otherwise from the newest global row. Retiring it is "back to default" — the rows stay. One live lane per (sku, shop).';
create unique index if not exists sku_price_lanes_one_live on public.sku_price_lanes (sku_id, location_id) where active;

alter table public.vendor_price_history
  add column if not exists location_id   uuid null references public.locations(id),
  add column if not exists price_lane_id uuid null;
alter table public.vendor_price_history drop constraint if exists vendor_price_history_lane_pair;
alter table public.vendor_price_history
  add constraint vendor_price_history_lane_pair check ((location_id is null) = (price_lane_id is null));
alter table public.vendor_price_history drop constraint if exists vendor_price_history_lane_fk;
alter table public.vendor_price_history
  add constraint vendor_price_history_lane_fk
  foreign key (price_lane_id, vendor_item_id, location_id) references public.sku_price_lanes (id, sku_id, location_id);
create index if not exists vendor_price_history_scope_ix on public.vendor_price_history (vendor_item_id, location_id, effective_date desc);

-- ── (6) auto-par pack EPOCHS (D3), the pre-chain baseline, the global flat mirror ──
-- An auto value is valid only in the pack EPOCH it was computed in. sku_pack_epochs counts, per
-- (sku, shop), every change of the pack that shop EFFECTIVELY receives — its own version made or
-- retired, or the global one replaced while the shop rides it — MONOTONICALLY, so "back to default"
-- is a new epoch and can never resurrect a value computed before the shop's own case existed
-- (G → S → G = epochs 0 → 1 → 2). No row = epoch 0.
create table if not exists public.sku_pack_epochs (
  sku_id      uuid        not null references public.vendor_items(id),
  location_id uuid        not null references public.locations(id),
  epoch       bigint      not null default 0 check (epoch >= 0),
  updated_at  timestamptz not null default now(),
  primary key (sku_id, location_id)
);
comment on table public.sku_pack_epochs is
  'Per (sku, shop), a monotonic count of changes to the pack that shop effectively receives (0259). '
  'Bumped only by the sku_pack_versions_epoch trigger. No row = epoch 0. A machine par stamped with any '
  'other epoch is retired at read time (D3, lib/location-sku-shared.ts).';

alter table public.location_sku_settings
  add column if not exists auto_weekday_pack_epoch bigint null,
  add column if not exists auto_weekend_pack_epoch bigint null;
comment on column public.location_sku_settings.auto_weekday_pack_epoch is
  'The pack epoch (0259, sku_pack_epochs) the weekday machine par was computed in. Any other current epoch retires it (D3).';
comment on column public.location_sku_settings.auto_weekend_pack_epoch is
  'The pack epoch (0259, sku_pack_epochs) the weekend machine par was computed in. Any other current epoch retires it (D3).';
-- Existing auto values (none in prod while auto-apply is SHADOW) were computed in epoch 0 (no epoch
-- row exists yet). Stamp them, so 0259 itself retires nothing.
update public.location_sku_settings
   set auto_weekday_pack_epoch = case when auto_weekday_par is not null then 0 end,
       auto_weekend_pack_epoch = case when auto_weekend_par is not null then 0 end
 where auto_weekday_par is not null or auto_weekend_par is not null;

create or replace function public.sku_pack_epoch_bump()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' and new.active then
    if new.location_id is not null then
      -- a shop's own version: that shop's pack changed.
      insert into public.sku_pack_epochs as e (sku_id, location_id, epoch, updated_at)
      values (new.sku_id, new.location_id, 1, clock_timestamp())
      on conflict (sku_id, location_id) do update set epoch = e.epoch + 1, updated_at = clock_timestamp();
    else
      -- the global pack changed: every active shop RIDING it (no own live version) is in a new epoch.
      insert into public.sku_pack_epochs as e (sku_id, location_id, epoch, updated_at)
      select new.sku_id, l.id, 1, clock_timestamp()
        from public.locations l
       where l.active
         and not exists (select 1 from public.sku_pack_versions v
                          where v.sku_id = new.sku_id and v.location_id = l.id and v.active)
      on conflict (sku_id, location_id) do update set epoch = e.epoch + 1, updated_at = clock_timestamp();
    end if;
  elsif tg_op = 'UPDATE' and old.active and not new.active and new.location_id is not null then
    -- a shop version retired ("back to default"): a NEW epoch, never the old one again.
    insert into public.sku_pack_epochs as e (sku_id, location_id, epoch, updated_at)
    values (new.sku_id, new.location_id, 1, clock_timestamp())
    on conflict (sku_id, location_id) do update set epoch = e.epoch + 1, updated_at = clock_timestamp();
  end if;
  return null;
end;
$$;

-- THE PRE-CHAIN BASELINE (Astra 2b r2#5, r3#1). A SKU's FIRST global version (from any writer: the
-- item page, the legacy editor, the vendor import) is about to overwrite its flat mirror; first
-- record the flat pack it had — even an all-null "unknown" one — as a version valid up to this
-- moment, so a past business date resolves to THAT pack (lib/sku-versions-shared.ts
-- packsFromVersions), never to today's overwritten fields.
create or replace function public.sku_pack_versions_flat_baseline()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_vi public.vendor_items%rowtype;
begin
  if new.location_id is not null or new.flat_snapshot is not null then return new; end if;
  if exists (select 1 from public.sku_pack_versions where sku_id = new.sku_id and location_id is null) then return new; end if;
  select * into v_vi from public.vendor_items where id = new.sku_id;
  -- An ALL-NULL flat pack is recorded too (Astra 2b r3#1): "unknown then" is history, and a past
  -- date must resolve to it — never to the mirror this first chain is about to write.
  if not found then
    return new;
  end if;
  insert into public.sku_pack_versions (sku_id, location_id, active, valid_from, valid_to, note, created_by, flat_snapshot)
  values (new.sku_id, null, false, '2000-01-01T00:00:00Z', new.valid_from, 'pre-chain flat pack (0259 baseline)', new.created_by,
          jsonb_build_object('pack_format', v_vi.pack_format, 'each_container_label', v_vi.each_container_label,
                             'units_per_pack', v_vi.units_per_pack, 'each_size', v_vi.each_size, 'each_measure', v_vi.each_measure));
  return new;
end;
$$;

-- Both triggers are created AFTER the backfill above, so the backfill bumps no epoch and snapshots nothing.
drop trigger if exists sku_pack_versions_flat_baseline on public.sku_pack_versions;
create trigger sku_pack_versions_flat_baseline
  before insert on public.sku_pack_versions
  for each row execute function public.sku_pack_versions_flat_baseline();
drop trigger if exists sku_pack_versions_epoch on public.sku_pack_versions;
create trigger sku_pack_versions_epoch
  after insert or update of active on public.sku_pack_versions
  for each row execute function public.sku_pack_epoch_bump();

-- THE GLOBAL FLAT MIRROR, derived from a version's chain INSIDE the writer's transaction (Astra 2a
-- r2#6): deriveFlatFieldsFromChain's rule in SQL — the unique root's label; the product of the
-- non-leaf quantities (1 for a one-level chain); the leaf's size and unit; and, for a malformed
-- chain, the same all-null mirror with pack_format 'Each (no case)' the TS sync wrote.
create or replace function public.sku_flat_mirror_apply(p_sku uuid, p_version uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_root  public.sku_pack_levels%rowtype;
  v_node  public.sku_pack_levels%rowtype;
  v_roots int;
  v_units numeric := 1;
  v_hops  int := 0;
  v_ok    boolean := true;
begin
  select count(*) into v_roots from public.sku_pack_levels l
   where l.version_id = p_version
     and not exists (select 1 from public.sku_pack_levels c where c.version_id = p_version and c.contains_level_id = l.id);
  if v_roots <> 1 then
    v_ok := false;
  else
    select l.* into v_root from public.sku_pack_levels l
     where l.version_id = p_version
       and not exists (select 1 from public.sku_pack_levels c where c.version_id = p_version and c.contains_level_id = l.id);
    v_node := v_root;
    while v_node.contains_level_id is not null loop
      v_hops := v_hops + 1;
      if v_hops > 16 or v_node.contains_qty <= 0 then v_ok := false; exit; end if;
      v_units := v_units * v_node.contains_qty;
      select l.* into v_node from public.sku_pack_levels l where l.id = v_node.contains_level_id and l.version_id = p_version;
      if not found then v_ok := false; exit; end if;
    end loop;
    if v_ok and (coalesce(btrim(v_node.contains_measure_unit), '') = '' or v_node.contains_qty <= 0) then v_ok := false; end if;
  end if;
  if v_ok then
    update public.vendor_items
       set pack_format = coalesce(nullif(btrim(v_root.label), ''), 'Each (no case)'),
           units_per_pack = case when v_units = trunc(v_units) then v_units::int else null end,
           each_size = v_node.contains_qty,
           each_measure = btrim(v_node.contains_measure_unit)
     where id = p_sku;
  else
    update public.vendor_items set pack_format = 'Each (no case)', units_per_pack = null, each_size = null, each_measure = null where id = p_sku;
  end if;
  return v_ok;
end;
$$;

-- ── (7) the six writers ──────────────────────────────────────────────────────
create or replace function public.save_sku_pack_version(
  p_sku           uuid,
  p_location      uuid,
  p_levels        jsonb,
  p_expected_live uuid,
  p_based_on      uuid,
  p_note          text,
  p_actor         uuid,
  p_first_only    boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_scope   uuid := coalesce(p_location, '00000000-0000-0000-0000-000000000000'::uuid);
  v_live    uuid;
  v_new     uuid := gen_random_uuid();
  v_now     timestamptz := clock_timestamp();
  v_count   int;
  v_ids     uuid[];
  v_i       int;
  v_level   jsonb;
  v_ptr     int;
  v_unit    text;
  v_written int;
  v_mirror  boolean := null;
begin
  if p_levels is null or jsonb_typeof(p_levels) <> 'array' or jsonb_array_length(p_levels) = 0 then
    raise exception 'sku_pack_version:invalid_levels' using errcode = 'P0001';
  end if;
  v_count := jsonb_array_length(p_levels);
  for v_i in 0 .. v_count - 1 loop
    v_level := p_levels -> v_i;
    if coalesce(jsonb_typeof(v_level), '') <> 'object'
       or coalesce(btrim(v_level ->> 'label'), '') = ''
       or coalesce(jsonb_typeof(v_level -> 'containsQty'), '') <> 'number'
       or (v_level ->> 'containsQty')::numeric <= 0 then
      raise exception 'sku_pack_version:invalid_levels' using errcode = 'P0001';
    end if;
    v_unit := nullif(btrim(coalesce(v_level ->> 'containsMeasureUnit', '')), '');
    if (v_level ->> 'containsIndex') is not null then
      if coalesce(jsonb_typeof(v_level -> 'containsIndex'), '') <> 'number' or v_unit is not null then
        raise exception 'sku_pack_version:invalid_levels' using errcode = 'P0001';
      end if;
      v_ptr := (v_level ->> 'containsIndex')::int;
      if v_ptr < 0 or v_ptr >= v_count or v_ptr = v_i then
        raise exception 'sku_pack_version:invalid_levels' using errcode = 'P0001';
      end if;
    elsif v_unit is null then
      raise exception 'sku_pack_version:invalid_levels' using errcode = 'P0001';
    elsif not exists (select 1 from public.measure_units where label = v_unit and active) then
      raise exception 'sku_pack_version:unknown_measure' using errcode = 'P0001';
    end if;
  end loop;

  -- THE SKU LOCK: every pack/price writer of this SKU serializes here (lock order: SKU, then version).
  perform 1 from public.vendor_items where id = p_sku for update;
  if not found then
    raise exception 'sku_pack_version:sku_not_found' using errcode = 'P0001';
  end if;
  if p_location is not null and not exists (select 1 from public.locations where id = p_location and active) then
    raise exception 'sku_pack_version:location_not_found' using errcode = 'P0001';
  end if;
  -- FIRST VALUE ONLY (D5), decided under the lock: a GM may set the FIRST global chain, never change one.
  if p_first_only and p_location is null and (
       exists (select 1 from public.sku_pack_versions where sku_id = p_sku and location_id is null and active)
       or exists (select 1 from public.sku_pack_levels where sku_id = p_sku and location_id is null and active)) then
    raise exception 'sku_pack_version:global_requires_moo' using errcode = 'P0001';
  end if;

  select id into v_live from public.sku_pack_versions where sku_id = p_sku and scope_key = v_scope and active for update;
  if v_live is distinct from p_expected_live then
    raise exception 'sku_pack_version:version_changed' using errcode = 'P0001';
  end if;
  if p_based_on is not null and not exists (select 1 from public.sku_pack_versions where id = p_based_on and sku_id = p_sku) then
    raise exception 'sku_pack_version:invalid_based_on' using errcode = 'P0001';
  end if;

  if v_live is not null then
    update public.sku_pack_versions set active = false, valid_to = v_now, retired_by = p_actor where id = v_live;
    update public.sku_pack_levels set active = false where version_id = v_live and active;
  end if;
  -- Rows written by pre-2a code in the deploy window (no version yet) are superseded too.
  update public.sku_pack_levels set active = false where sku_id = p_sku and scope_key = v_scope and active and version_id is null;

  insert into public.sku_pack_versions (id, sku_id, location_id, based_on_version_id, active, valid_from, note, created_at, created_by)
  values (v_new, p_sku, p_location, coalesce(p_based_on, v_live), true, v_now, nullif(btrim(coalesce(p_note, '')), ''), v_now, p_actor);

  v_ids := array(select gen_random_uuid() from generate_series(1, v_count));
  insert into public.sku_pack_levels
    (id, sku_id, version_id, location_id, label, contains_qty, contains_level_id, contains_measure_unit, display_ordinal, effective_from, active, created_by)
  select v_ids[t.ord::int], p_sku, v_new, p_location,
         btrim(t.value ->> 'label'), (t.value ->> 'containsQty')::numeric,
         case when (t.value ->> 'containsIndex') is null then null else v_ids[(t.value ->> 'containsIndex')::int + 1] end,
         case when (t.value ->> 'containsIndex') is null then btrim(t.value ->> 'containsMeasureUnit') else null end,
         (t.ord - 1)::int, v_now, true, p_actor
    from jsonb_array_elements(p_levels) with ordinality as t(value, ord);
  get diagnostics v_written = row_count;
  if v_written <> v_count then
    raise exception 'sku_pack_version:readback_failed' using errcode = 'P0001';
  end if;
  -- THE GLOBAL FLAT MIRROR, in THIS transaction under THIS lock (Astra 2a r2#6 / 2b r2#6): two saves
  -- can never commit chains A then B but mirrors B then A. A shop version has no mirror.
  if p_location is null then
    v_mirror := public.sku_flat_mirror_apply(p_sku, v_new);
  end if;
  return jsonb_build_object('version_id', v_new, 'retired_version_id', v_live, 'valid_from', v_now, 'level_count', v_count,
                            'mirror_synced', v_mirror);
end;
$$;

create or replace function public.retire_sku_pack_version(p_version uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_sku uuid;
  v_row public.sku_pack_versions%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select sku_id into v_sku from public.sku_pack_versions where id = p_version;
  if not found then
    raise exception 'sku_pack_version:not_found' using errcode = 'P0001';
  end if;
  perform 1 from public.vendor_items where id = v_sku for update;
  select * into v_row from public.sku_pack_versions where id = p_version for update;
  if v_row.location_id is null then
    raise exception 'sku_pack_version:global_cannot_retire' using errcode = 'P0001';
  end if;
  if not v_row.active then
    raise exception 'sku_pack_version:not_live' using errcode = 'P0001';
  end if;
  update public.sku_pack_versions set active = false, valid_to = v_now, retired_by = p_actor where id = p_version;
  update public.sku_pack_levels set active = false where version_id = p_version and active;
  return jsonb_build_object('version_id', p_version, 'sku_id', v_sku, 'location_id', v_row.location_id, 'valid_to', v_now);
end;
$$;

create or replace function public.save_sku_shop_price(
  p_sku uuid, p_location uuid, p_unit_price numeric, p_effective_date date, p_actor uuid, p_source text, p_source_note text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_lane    uuid;
  v_created boolean := false;
  v_head    uuid;
  v_price   uuid;
  v_now     timestamptz := clock_timestamp();
begin
  if p_location is null then raise exception 'sku_price:location_required' using errcode = 'P0001'; end if;
  if p_unit_price is null or p_unit_price <= 0 or p_unit_price::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'sku_price:invalid_price' using errcode = 'P0001';
  end if;
  if p_effective_date is null then raise exception 'sku_price:invalid_date' using errcode = 'P0001'; end if;
  perform 1 from public.vendor_items where id = p_sku and active for update;
  if not found then raise exception 'sku_price:sku_not_found' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.locations where id = p_location and active) then
    raise exception 'sku_price:location_not_found' using errcode = 'P0001';
  end if;
  select id into v_lane from public.sku_price_lanes where sku_id = p_sku and location_id = p_location and active for update;
  if v_lane is null then
    select id into v_head from public.vendor_price_history
     where vendor_item_id = p_sku and location_id is null
     order by effective_date desc, recorded_at desc, id desc limit 1;
    insert into public.sku_price_lanes (sku_id, location_id, based_on_price_id, active, created_at, created_by)
    values (p_sku, p_location, v_head, true, v_now, p_actor) returning id into v_lane;
    v_created := true;
  end if;
  insert into public.vendor_price_history
    (vendor_item_id, unit_price, effective_date, recorded_at, recorded_by, source, source_note, location_id, price_lane_id)
  values (p_sku, p_unit_price, p_effective_date, v_now, p_actor,
          nullif(btrim(coalesce(p_source, '')), ''), nullif(btrim(coalesce(p_source_note, '')), ''), p_location, v_lane)
  returning id into v_price;
  return jsonb_build_object('price_id', v_price, 'lane_id', v_lane, 'lane_created', v_created, 'recorded_at', v_now);
end;
$$;

create or replace function public.save_sku_global_price(
  p_sku uuid, p_unit_price numeric, p_effective_date date, p_actor uuid, p_first_only boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_price uuid;
  v_now   timestamptz := clock_timestamp();
begin
  if p_unit_price is null or p_unit_price <= 0 or p_unit_price::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'sku_price:invalid_price' using errcode = 'P0001';
  end if;
  if p_effective_date is null then raise exception 'sku_price:invalid_date' using errcode = 'P0001'; end if;
  -- THE SKU LOCK, then the first-value rule (D5): two first-price requests cannot both see "none".
  perform 1 from public.vendor_items where id = p_sku and active for update;
  if not found then raise exception 'sku_price:sku_not_found' using errcode = 'P0001'; end if;
  if p_first_only and exists (select 1 from public.vendor_price_history where vendor_item_id = p_sku and location_id is null) then
    raise exception 'sku_price:global_requires_moo' using errcode = 'P0001';
  end if;
  insert into public.vendor_price_history (vendor_item_id, unit_price, effective_date, recorded_at, recorded_by)
  values (p_sku, p_unit_price, p_effective_date, v_now, p_actor)
  returning id into v_price;
  return jsonb_build_object('price_id', v_price, 'recorded_at', v_now);
end;
$$;

create or replace function public.retire_sku_price_lane(p_sku uuid, p_location uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_lane uuid;
begin
  perform 1 from public.vendor_items where id = p_sku for update;
  if not found then raise exception 'sku_price:sku_not_found' using errcode = 'P0001'; end if;
  update public.sku_price_lanes set active = false, retired_at = clock_timestamp(), retired_by = p_actor
   where sku_id = p_sku and location_id = p_location and active
  returning id into v_lane;
  if v_lane is null then raise exception 'sku_price:no_shop_price' using errcode = 'P0001'; end if;
  return jsonb_build_object('lane_id', v_lane, 'sku_id', p_sku, 'location_id', p_location);
end;
$$;

create or replace function public.record_receiving_prices(p_location uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row     jsonb;
  v_sku     uuid;
  v_lane    uuid;
  v_owner   uuid;
  v_head    uuid;
  v_opened  int := 0;
  v_shop    int := 0;
  v_global  int := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'sku_price:invalid_payload' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.locations where id = p_location) then
    raise exception 'sku_price:location_not_found' using errcode = 'P0001';
  end if;
  -- THE SKU LOCKS FIRST, in id order (no deadlock between two deliveries), so a lane cannot be
  -- opened or retired between "is there a live lane?" and the append below.
  for v_sku in select distinct (r ->> 'vendor_item_id')::uuid from jsonb_array_elements(p_rows) r order by 1 loop
    perform 1 from public.vendor_items where id = v_sku for update;
  end loop;
  for v_row in select r from jsonb_array_elements(p_rows) r loop
    v_sku := (v_row ->> 'vendor_item_id')::uuid;
    if (v_row ->> 'unit_price')::numeric is null or (v_row ->> 'unit_price')::numeric <= 0 then
      raise exception 'sku_price:invalid_price' using errcode = 'P0001';
    end if;
    select id into v_lane from public.sku_price_lanes where sku_id = v_sku and location_id = p_location and active;
    if v_lane is null then
      -- DECISION (e): an invoice is THIS shop's evidence. Its first one (or the first after "back to
      -- default") OPENS the shop's own lane, under the SKU lock taken above — it never moves the
      -- global price every other shop inherits. A shop's OWN store-copy SKU has no other shop: its
      -- price stays the SKU's global row, exactly as before.
      select location_id into v_owner from public.vendor_items where id = v_sku;
      if v_owner is distinct from p_location then
        select id into v_head from public.vendor_price_history
         where vendor_item_id = v_sku and location_id is null
         order by effective_date desc, recorded_at desc, id desc limit 1;
        insert into public.sku_price_lanes (sku_id, location_id, based_on_price_id, active, created_at, created_by)
        values (v_sku, p_location, v_head, true, clock_timestamp(), nullif(v_row ->> 'recorded_by', '')::uuid)
        returning id into v_lane;
        v_opened := v_opened + 1;
      end if;
    end if;
    insert into public.vendor_price_history
      (vendor_item_id, unit_price, effective_date, recorded_by, source, location_id, price_lane_id)
    values (v_sku, (v_row ->> 'unit_price')::numeric, (v_row ->> 'effective_date')::date,
            nullif(v_row ->> 'recorded_by', '')::uuid, nullif(v_row ->> 'source', ''),
            case when v_lane is null then null else p_location end, v_lane);
    if v_lane is null then v_global := v_global + 1; else v_shop := v_shop + 1; end if;
  end loop;
  return jsonb_build_object('shop_rows', v_shop, 'global_rows', v_global, 'lanes_opened', v_opened);
end;
$$;

-- ── (8) the two live SQL chain writers, re-emitted (generated; see the header) ──
-- >>> REEMIT apply_vendor_import (generated by scripts/shop-versions/emit-0259-reemits.ts — do not hand-edit)
create or replace function public.apply_vendor_import(p_batch_id uuid, p_plan_digest text, p_actor uuid, p_ops jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_batch public.vendor_import_batches%rowtype;
  v_sku public.vendor_items%rowtype;
  v_observation public.vendor_import_observations%rowtype;
  v_claim uuid; v_price_id uuid; v_sku_id uuid; v_actor_role text;
  v_op jsonb; v_before jsonb; v_price jsonb; v_chain jsonb; v_node jsonb; v_root jsonb; v_measures jsonb;
  v_result jsonb; v_outcomes jsonb := '[]'; v_ids jsonb; v_id_map jsonb;
  v_key text; v_kind text; v_next uuid; v_old_root uuid;
  v_seen uuid[]; v_units numeric; v_leaf_size numeric; v_leaf_measure text;
  v_ratio numeric; v_written int; v_count int; v_now timestamptz;
  v_old_version uuid; v_new_version uuid;
begin
  if p_plan_digest is null or p_plan_digest !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_ops) is distinct from 'array' or jsonb_array_length(p_ops) = 0 then
    raise exception 'invalid_payload';
  end if;
  -- A unique claim arbitrates concurrent retries before any catalog mutation.
  insert into public.vendor_import_applies(batch_id, plan_digest, applied_by, result)
    values(p_batch_id, p_plan_digest, p_actor, '{}')
    on conflict (batch_id, plan_digest) do nothing returning id into v_claim;
  if v_claim is null then
    select result into v_result from public.vendor_import_applies
      where batch_id = p_batch_id and plan_digest = p_plan_digest;
    return v_result;
  end if;
  select * into v_batch from public.vendor_import_batches where id = p_batch_id for update;
  if not found then raise exception 'batch_not_found'; end if;
  if v_batch.status <> 'staged' then raise exception 'batch_already_applied'; end if;
  perform 1 from public.vendors where id = v_batch.vendor_id and active for update;
  if not found then raise exception 'vendor_not_found'; end if;
  select role into v_actor_role from public.users where id = p_actor and active;
  if not found then raise exception 'forbidden'; end if;
  if exists (select 1 from jsonb_array_elements(p_ops) o
    group by o->>'sku_id', o->>'action' having count(*) > 1) then
    raise exception 'conflicting_operations';
  end if;
  if exists(select 1 from jsonb_array_elements(p_ops) o where o->>'action' = 'sku.item_number_set'
    group by o#>>'{after,item_number}' having count(*) > 1) then raise exception 'conflicting_operations'; end if;
  for v_sku_id in select distinct (o->>'sku_id')::uuid from jsonb_array_elements(p_ops) o order by 1 loop
    perform 1 from public.vendor_items where id = v_sku_id and vendor_id = v_batch.vendor_id and active for update;
    if not found then raise exception 'foreign_sku'; end if;
  end loop;
  -- Check ALL snapshots before the first write; pack and price may share a SKU.
  for v_op in select o from jsonb_array_elements(p_ops) o order by o->>'sku_id', o->>'action' loop
    v_sku_id := (v_op->>'sku_id')::uuid;
    v_kind := case v_op->>'action' when 'sku.price_supersede' then 'price'
      when 'sku.item_number_set' then 'item_number' when 'sku.pack_level_supersede' then 'pack' end;
    if v_kind is null then raise exception 'unsupported_op'; end if;
    v_key := (v_op->>'source_row') || ':' || v_kind;
    v_before := v_op->'before';
    if v_before is distinct from v_batch.report#>array['before_state',v_key] then raise exception 'plan_changed'; end if;
    select * into v_observation from public.vendor_import_observations
      where batch_id = p_batch_id and source_row = (v_op->>'source_row')::int and kind = v_kind and sku_id = v_sku_id;
    if not found then raise exception 'plan_changed'; end if;
    -- Older evidence must not undo a newer accepted pack when no price was supplied.
    if v_kind in ('price','pack') and exists(
      select 1 from public.vendor_import_observations prior
      join public.vendor_import_batches b on b.id = prior.batch_id
      where b.vendor_id = v_batch.vendor_id and b.status = 'applied' and prior.decision = 'accept'
        and prior.sku_id = v_sku_id and prior.kind in ('price','pack')
        and (case when prior.payload ? 'receipt_doc' then prior.payload->>'last_purchase_date'
          else prior.payload->>'exported_at' end)::date >
          (case when v_observation.payload ? 'receipt_doc' then v_observation.payload->>'last_purchase_date'
          else v_observation.payload->>'exported_at' end)::date
    ) then raise exception 'stale_before_state:%',v_sku_id; end if;
    if v_kind = 'price' and exists(select 1 from jsonb_array_elements(p_ops) x
      where x->>'sku_id' = v_op->>'sku_id' and x->>'action' = 'sku.pack_level_supersede') then
      if v_before->'price_with_pack' is null or v_op->'after' is distinct from v_before->'price_with_pack' then raise exception 'plan_changed'; end if;
    elsif v_op->'after' is distinct from v_observation.proposed then raise exception 'plan_changed'; end if;
    select * into v_sku from public.vendor_items where id = v_sku_id;
    -- An originally unique identity can acquire a conflicting sibling after stage.
    if v_sku.item_number is not null and exists(select 1 from public.vendor_items
      where vendor_id = v_batch.vendor_id and item_number = v_sku.item_number and id <> v_sku_id) then
      raise exception 'stale_before_state:%',v_sku_id;
    end if;
    if v_observation.match_rule = 'name_exact' and exists(select 1 from public.vendor_items
      where vendor_id = v_batch.vendor_id and id <> v_sku_id
        and btrim(regexp_replace(lower(name),'[^[:alnum:]]+',' ','g')) =
          btrim(regexp_replace(lower(v_observation.payload->>'description'),'[^[:alnum:]]+',' ','g'))) then
      raise exception 'stale_before_state:%',v_sku_id;
    end if;
    perform 1 from public.sku_pack_levels where sku_id = v_sku_id and active and location_id is null order by id for update;
    select coalesce(jsonb_agg(to_jsonb(l) order by l.id), '[]') into v_chain from
      (select id,label,contains_qty,contains_level_id,contains_measure_unit,display_ordinal
       from public.sku_pack_levels where sku_id = v_sku_id and active and location_id is null) l;
    select coalesce(jsonb_agg(to_jsonb(m) order by m.label), '[]') into v_measures from
      (select label,dimension,to_base_factor from public.measure_units where active and label in
        (select x->>'contains_measure_unit' from jsonb_array_elements(v_chain) x)) m;
    if v_chain is distinct from v_before->'pack_levels'
      or v_measures is distinct from v_before->'measures'
      or v_sku.name is distinct from v_before->>'name'
      or to_jsonb(v_sku.price_basis) is distinct from nullif(v_before->'price_basis','null'::jsonb)
      or to_jsonb(v_sku.item_number) is distinct from nullif(v_before->'item_number','null'::jsonb) then
      raise exception 'stale_before_state:%', v_sku_id;
    end if;
    if v_kind in ('price','pack') then
      select jsonb_build_object('id',id,'unit_price',unit_price,'effective_date',effective_date)
        into v_price from public.vendor_price_history where vendor_item_id = v_sku_id and location_id is null
        order by effective_date desc, recorded_at desc, id desc limit 1;
    end if;
    if v_kind = 'pack' and nullif(v_before->'latest_price','null'::jsonb) is distinct from v_price then
      raise exception 'stale_before_state:%',v_sku_id;
    end if;
    if v_kind = 'price' then
      if (v_price->>'id') is distinct from (v_before->>'id')
        or (v_price->>'unit_price')::numeric is distinct from (v_before->>'unit_price')::numeric
        or (v_price->>'effective_date') is distinct from (v_before->>'effective_date') then
        raise exception 'stale_before_state:%', v_sku_id;
      end if;
      if (v_op#>>'{after,unit_price}')::numeric <= 0
        or v_op#>>'{after,unit_price}' is null
        or v_op#>>'{after,unit_price}' in ('NaN','Infinity','-Infinity')
        or v_op#>>'{after,effective_date}' is null
        or (v_op#>>'{after,effective_date}')::date < (v_price->>'effective_date')::date then
        raise exception 'invalid_price';
      end if;
    elsif v_kind = 'item_number' then
      if v_sku.item_number is not null or nullif(btrim(v_op#>>'{after,item_number}'),'') is null
        or exists(select 1 from public.vendor_items where vendor_id = v_batch.vendor_id
          and item_number = v_op#>>'{after,item_number}' and id <> v_sku_id) then
        raise exception 'stale_before_state:%', v_sku_id;
      end if;
    end if;
  end loop;

  for v_op in select o from jsonb_array_elements(p_ops) o order by o->>'sku_id', o->>'action' loop
    v_sku_id := (v_op->>'sku_id')::uuid; v_before := v_op->'before';
    v_now := clock_timestamp(); v_ids := '[]';
    if v_op->>'action' = 'sku.price_supersede' then
      insert into public.vendor_price_history(vendor_item_id,unit_price,effective_date,recorded_at,recorded_by,source,source_note)
      values(v_sku_id,(v_op#>>'{after,unit_price}')::numeric,(v_op#>>'{after,effective_date}')::date,
        v_now,p_actor,'vendor_import',p_batch_id::text || ':row:' || (v_op->>'source_row')) returning id into v_price_id;
      perform 1 from public.vendor_price_history where id = v_price_id
        and unit_price = (v_op#>>'{after,unit_price}')::numeric
        and effective_date = (v_op#>>'{after,effective_date}')::date;
      if not found then raise exception 'apply_readback_failed'; end if;
      v_ids := jsonb_build_array(v_price_id);
    elsif v_op->>'action' = 'sku.item_number_set' then
      update public.vendor_items set item_number = v_op#>>'{after,item_number}' where id = v_sku_id and item_number is null;
      get diagnostics v_written = row_count;
      if v_written <> 1 then raise exception 'stale_before_state:%',v_sku_id; end if;
    else
      v_chain := v_before->'pack_levels'; v_count := jsonb_array_length(v_chain);
      v_old_root := (v_before->>'level_id')::uuid;
      if v_count = 0 or (select count(*) from jsonb_array_elements(v_chain) x where not exists
        (select 1 from jsonb_array_elements(v_chain) y where y->>'contains_level_id' = x->>'id')) <> 1 then
        raise exception 'invalid_chain';
      end if;
      select x into v_root from jsonb_array_elements(v_chain) x where not exists
        (select 1 from jsonb_array_elements(v_chain) y where y->>'contains_level_id' = x->>'id');
      if (v_root->>'id')::uuid is distinct from v_old_root
        or (v_before->>'quantity')::numeric <= 0 or (v_op#>>'{after,root,quantity}')::numeric <= 0
        or v_op#>>'{after,root,unit}' is distinct from v_before->>'unit' then raise exception 'invalid_chain'; end if;
      v_ratio := (v_op#>>'{after,root,quantity}')::numeric / (v_before->>'quantity')::numeric;
      if v_ratio is null or v_ratio::text in ('NaN','Infinity','-Infinity') then raise exception 'invalid_chain'; end if;
      -- Preserve all descendants; only the root's immediate quantity changes.
      select jsonb_agg(case when (x->>'id')::uuid = v_old_root then
        x || jsonb_build_object('contains_qty',(x->>'contains_qty')::numeric * v_ratio) else x end order by x->>'id')
        into v_chain from jsonb_array_elements(v_chain) x;
      select x into v_node from jsonb_array_elements(v_chain) x where (x->>'id')::uuid = v_old_root;
      v_units := 1; v_seen := '{}'; v_id_map := '{}';
      loop
        if v_node is null or (v_node->>'id')::uuid = any(v_seen)
          or (v_node->>'contains_qty')::numeric <= 0
          or exists(select 1 from public.measure_units where active and label = v_node->>'label') then raise exception 'invalid_chain'; end if;
        v_seen := array_append(v_seen,(v_node->>'id')::uuid);
        v_id_map := v_id_map || jsonb_build_object(v_node->>'id',gen_random_uuid());
        v_next := (v_node->>'contains_level_id')::uuid;
        if v_next is null then
          v_leaf_size := (v_node->>'contains_qty')::numeric; v_leaf_measure := v_node->>'contains_measure_unit';
          if cardinality(v_seen) <> v_count or not exists(select 1 from public.measure_units where active and label = v_leaf_measure)
            then raise exception 'invalid_chain'; end if;
          select * into v_sku from public.vendor_items where id = v_sku_id;
          if coalesce(v_sku.sku_class,'raw') = 'raw' and exists(select 1 from public.measure_units
            where label = v_leaf_measure and dimension <> 'weight') and coalesce(v_sku.avg_oz_per_each,0) <= 0 then
            raise exception 'invalid_chain';
          end if;
          exit;
        end if;
        v_units := v_units * (v_node->>'contains_qty')::numeric;
        select x into v_node from jsonb_array_elements(v_chain) x where (x->>'id')::uuid = v_next;
      end loop;
      if v_units <> trunc(v_units) or v_units > 2147483647 then raise exception 'invalid_chain'; end if;
      update public.sku_pack_versions set active = false, valid_to = v_now, retired_by = p_actor
        where sku_id = v_sku_id and location_id is null and active returning id into v_old_version;
      v_new_version := gen_random_uuid();
      insert into public.sku_pack_versions(id,sku_id,location_id,based_on_version_id,active,valid_from,created_at,created_by)
        values (v_new_version,v_sku_id,null,v_old_version,true,v_now,v_now,p_actor);
      update public.sku_pack_levels set active = false where sku_id = v_sku_id and active and location_id is null;
      get diagnostics v_written = row_count;
      if v_written <> v_count then raise exception 'stale_before_state:%',v_sku_id; end if;
      insert into public.sku_pack_levels(id,sku_id,version_id,label,contains_qty,contains_level_id,contains_measure_unit,display_ordinal,effective_from,active,created_by)
      select (v_id_map->>(x->>'id'))::uuid,v_sku_id,v_new_version,x->>'label',(x->>'contains_qty')::numeric,
        (v_id_map->>(x->>'contains_level_id'))::uuid,x->>'contains_measure_unit',(x->>'display_ordinal')::int,v_now,true,p_actor
        from jsonb_array_elements(v_chain) x;
      get diagnostics v_written = row_count;
      if v_written <> v_count then raise exception 'apply_readback_failed'; end if;
      update public.vendor_items set pack_format = btrim(v_root->>'label'), units_per_pack = v_units::int,
        each_size = v_leaf_size, each_measure = v_leaf_measure where id = v_sku_id;
      get diagnostics v_written = row_count;
      if v_written <> 1 then raise exception 'stale_before_state:%',v_sku_id; end if;
      perform 1 from public.vendor_items where id = v_sku_id and pack_format = btrim(v_root->>'label')
        and units_per_pack = v_units and each_size = v_leaf_size and each_measure = v_leaf_measure;
      if not found then raise exception 'apply_readback_failed'; end if;
      select jsonb_agg(value order by key) into v_ids from jsonb_each(v_id_map);
    end if;
    v_result := jsonb_build_object('action',v_op->>'action','sku_id',v_sku_id,'source_row',v_op->'source_row','new_ids',v_ids);
    v_outcomes := v_outcomes || jsonb_build_array(v_result);
  end loop;
  update public.vendor_import_observations set decision = 'skip' where batch_id = p_batch_id;
  for v_op in select o from jsonb_array_elements(p_ops) o loop
    update public.vendor_import_observations set decision = 'accept' where batch_id = p_batch_id
      and source_row = (v_op->>'source_row')::int and kind = case v_op->>'action'
        when 'sku.price_supersede' then 'price' when 'sku.item_number_set' then 'item_number' else 'pack' end;
    get diagnostics v_written = row_count;
    if v_written <> 1 then raise exception 'plan_changed'; end if;
  end loop;
  update public.vendor_import_batches set status = 'applied' where id = p_batch_id and status = 'staged';
  get diagnostics v_written = row_count;
  if v_written <> 1 then raise exception 'batch_already_applied'; end if;
  v_result := jsonb_build_object('batch_id',p_batch_id,'plan_digest',p_plan_digest,'ops',v_outcomes,'non_atomic','[]'::jsonb);
  update public.vendor_import_applies set result = v_result where id = v_claim;
  get diagnostics v_written = row_count;
  if v_written <> 1 then raise exception 'apply_not_found'; end if;
  -- Transport-only flag: exactly the claim winner invokes the fail-open audit
  -- helper. Never persist/expose it as part of the application result.
  return v_result || jsonb_build_object('_audit',true);
end $$;
-- <<< REEMIT apply_vendor_import
-- >>> REEMIT receiving_create_store_item (generated by scripts/shop-versions/emit-0259-reemits.ts — do not hand-edit)
create or replace function public.receiving_create_store_item(p_store uuid, p_location uuid, p_actor uuid,
  p_reference uuid, p_name text, p_unit text, p_content_oz numeric, p_request uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_ref public.vendor_items%rowtype; v_id uuid; v_product uuid; v_map jsonb; v_group jsonb;
  v_scope uuid; v_version uuid; v_node public.sku_pack_levels%rowtype; v_units numeric; v_root_label text; v_hops int;
begin
  if not exists (select 1 from public.locations where id = p_location and active) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  -- Per-store serialization also protects same-reference lookup+insert from races.
  perform 1 from public.vendors where id = p_store and source_kind = 'store' and active for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p_reference is null then
    if p_request is null or p_name is null or length(btrim(p_name)) not between 1 and 160
      or p_unit is null or length(btrim(p_unit)) not between 1 and 40
      or (p_content_oz is not null and (p_content_oz <= 0 or p_content_oz::text in ('NaN','Infinity','-Infinity'))) then
      raise exception 'invalid_pending_item' using errcode = '22023';
    end if;
    -- Stable UI request identity retries a lost response without merging unrelated
    -- products merely because their labels match. Reusing a key for changed input
    -- refuses rather than silently returning a SKU with different pack semantics.
    select * into v_ref from public.vendor_items where receiving_request_id = p_request;
    if found then
      if v_ref.vendor_id <> p_store or v_ref.location_id is distinct from p_location
        or v_ref.name <> btrim(p_name) or v_ref.unit <> btrim(p_unit)
        or v_ref.avg_oz_per_each is distinct from p_content_oz or not v_ref.active then
        raise exception 'request_conflict';
      end if;
      return jsonb_build_object('id', v_ref.id, 'created', false, 'product_id', v_ref.product_id);
    end if;
    -- Free-text count labels are pack labels, never invented measure registry units.
    -- Each entered count is one unit; oz stays unknown unless the operator knows it.
    insert into public.vendor_items(vendor_id, location_id, name, unit, pack_format,
      units_per_pack, each_size, each_measure, each_container_label, avg_oz_per_each,
      inventory_only, pending_review, active, created_by, updated_by, receiving_request_id)
    values (p_store, p_location, btrim(p_name), btrim(p_unit), btrim(p_unit), 1, 1,
      'count', btrim(p_unit), p_content_oz, true, true, true, p_actor, p_actor, p_request)
    returning id into v_id;
    return jsonb_build_object('id', v_id, 'created', true, 'product_id', null);
  end if;
  select * into v_ref from public.vendor_items where id = p_reference and active
    and (location_id is null or location_id = p_location) for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_ref.vendor_id = p_store then
    return jsonb_build_object('id', v_ref.id, 'created', false, 'product_id', v_ref.product_id);
  end if;
  if v_ref.pending_review then raise exception 'pending_reference'; end if;
  v_group := public.receiving_store_product(p_reference, p_actor, p_location);
  v_product := (v_group->>'product_id')::uuid;
  select id into v_id from public.vendor_items where vendor_id = p_store and active
    and not pending_review and store_reference_sku_id = p_reference
    and location_id = p_location
    order by location_id nulls last, id limit 1;
  if found then return v_group || jsonb_build_object('id', v_id, 'created', false); end if;
  insert into public.vendor_items(vendor_id, location_id, name, unit, unit_size, category,
    pack_format, units_per_pack, each_size, each_measure, each_container_label,
    avg_oz_per_each, weight_class, weight_source_note, weight_established_at,
    weight_established_by, sku_class, store_reference_sku_id, product_id, inventory_only,
    active, created_by, updated_by)
  values (p_store, p_location, v_ref.name, v_ref.unit, v_ref.unit_size, v_ref.category,
    v_ref.pack_format, v_ref.units_per_pack, v_ref.each_size, v_ref.each_measure,
    v_ref.each_container_label, v_ref.avg_oz_per_each, v_ref.weight_class,
    v_ref.weight_source_note, v_ref.weight_established_at, v_ref.weight_established_by,
    v_ref.sku_class, p_reference, v_product, true, true, p_actor, p_actor)
  returning id into v_id;
  -- Clone the pointer graph as a single statement; never point into another SKU's
  -- chain. Lock active source levels so a simultaneous pack rewrite cannot mix sets.
  -- 0259: clone the chain THIS SHOP receives — its own version when it has one, else the global.
  v_scope := case when exists (select 1 from public.sku_pack_levels
      where sku_id = p_reference and active and location_id = p_location) then p_location else null end;
  perform 1 from public.sku_pack_levels where sku_id = p_reference and active
    and location_id is not distinct from v_scope order by id for update;
  select jsonb_object_agg(id::text, gen_random_uuid()::text) into v_map
    from public.sku_pack_levels where sku_id = p_reference and active
      and location_id is not distinct from v_scope;
  if v_map is not null then
    v_version := gen_random_uuid();
    insert into public.sku_pack_versions(id, sku_id, location_id, based_on_version_id, active, valid_from, created_by)
      values (v_version, v_id, null, null, true, now(), p_actor);
  end if;
  insert into public.sku_pack_levels(id, sku_id, version_id, label, contains_qty, contains_level_id,
    contains_measure_unit, display_ordinal, effective_from, active, created_by)
  select (v_map->>id::text)::uuid, v_id, v_version, label, contains_qty,
    (v_map->>contains_level_id::text)::uuid, contains_measure_unit, display_ordinal,
    now(), true, p_actor from public.sku_pack_levels where sku_id = p_reference and active
      and location_id is not distinct from v_scope;
  -- 0259: a SHOP version was cloned → the copy's flat mirror must describe THAT chain, derived
  -- here (root label; product of the non-leaf quantities; the leaf's size and unit).
  if v_scope is not null and v_map is not null then
    select l.* into v_node from public.sku_pack_levels l
     where l.sku_id = v_id and l.active
       and not exists (select 1 from public.sku_pack_levels c
                        where c.sku_id = v_id and c.active and c.contains_level_id = l.id);
    v_root_label := v_node.label; v_units := 1; v_hops := 0;
    while v_node.contains_level_id is not null and v_hops < 16 loop
      v_units := v_units * v_node.contains_qty; v_hops := v_hops + 1;
      select l.* into v_node from public.sku_pack_levels l where l.id = v_node.contains_level_id;
    end loop;
    update public.vendor_items set pack_format = v_root_label,
      units_per_pack = case when v_units = trunc(v_units) then v_units::int else null end,
      each_size = v_node.contains_qty, each_measure = v_node.contains_measure_unit
     where id = v_id;
  end if;
  return v_group || jsonb_build_object('id', v_id, 'created', true);
end;
$$;
-- <<< REEMIT receiving_create_store_item

-- ── (9) posture: deny-all tables with a service_role ceiling; service-role writers ──
alter table public.sku_pack_versions enable row level security;
revoke all on public.sku_pack_versions from public, anon, authenticated, service_role;
grant select, insert, update on public.sku_pack_versions to service_role;

alter table public.sku_price_lanes enable row level security;
revoke all on public.sku_price_lanes from public, anon, authenticated, service_role;
grant select, insert, update on public.sku_price_lanes to service_role;

alter table public.sku_pack_epochs enable row level security;
revoke all on public.sku_pack_epochs from public, anon, authenticated, service_role;
grant select, insert, update on public.sku_pack_epochs to service_role;

-- The three helpers run only inside the definer writers and the triggers: nobody calls them directly.
revoke all on function public.sku_pack_epoch_bump() from public, anon, authenticated, service_role;
revoke all on function public.sku_pack_versions_flat_baseline() from public, anon, authenticated, service_role;
revoke all on function public.sku_flat_mirror_apply(uuid, uuid) from public, anon, authenticated, service_role;

revoke all on function public.save_sku_pack_version(uuid, uuid, jsonb, uuid, uuid, text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.retire_sku_pack_version(uuid, uuid) from public, anon, authenticated;
revoke all on function public.save_sku_shop_price(uuid, uuid, numeric, date, uuid, text, text) from public, anon, authenticated;
revoke all on function public.save_sku_global_price(uuid, numeric, date, uuid, boolean) from public, anon, authenticated;
revoke all on function public.retire_sku_price_lane(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.record_receiving_prices(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.apply_vendor_import(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.receiving_create_store_item(uuid, uuid, uuid, uuid, text, text, numeric, uuid) from public, anon, authenticated;
grant execute on function public.save_sku_pack_version(uuid, uuid, jsonb, uuid, uuid, text, uuid, boolean) to service_role;
grant execute on function public.retire_sku_pack_version(uuid, uuid) to service_role;
grant execute on function public.save_sku_shop_price(uuid, uuid, numeric, date, uuid, text, text) to service_role;
grant execute on function public.save_sku_global_price(uuid, numeric, date, uuid, boolean) to service_role;
grant execute on function public.retire_sku_price_lane(uuid, uuid, uuid) to service_role;
grant execute on function public.record_receiving_prices(uuid, jsonb) to service_role;
grant execute on function public.apply_vendor_import(uuid, text, uuid, jsonb) to service_role;
grant execute on function public.receiving_create_store_item(uuid, uuid, uuid, uuid, text, text, numeric, uuid) to service_role;

do $$ begin
  if exists (select 1 from information_schema.routine_privileges
              where routine_schema = 'public'
                and routine_name in ('save_sku_pack_version', 'retire_sku_pack_version', 'save_sku_shop_price', 'save_sku_global_price',
                                     'retire_sku_price_lane', 'record_receiving_prices', 'apply_vendor_import', 'receiving_create_store_item')
                and grantee in ('PUBLIC', 'anon', 'authenticated') and privilege_type = 'EXECUTE') then
    raise exception '0259: unexpected execute grant';
  end if;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'sku_pack_versions' and grantee in ('PUBLIC', 'anon', 'authenticated')) then
    raise exception '0259: unexpected table grant on sku_pack_versions';
  end if;
  if has_table_privilege('service_role', 'public.sku_pack_versions', 'DELETE')
     or has_table_privilege('service_role', 'public.sku_pack_versions', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.sku_pack_versions', 'REFERENCES')
     or has_table_privilege('service_role', 'public.sku_pack_versions', 'TRIGGER') then
    raise exception '0259: service_role above its ceiling';
  end if;
  if not (has_table_privilege('service_role', 'public.sku_pack_versions', 'SELECT')
          and has_table_privilege('service_role', 'public.sku_pack_versions', 'INSERT')
          and has_table_privilege('service_role', 'public.sku_pack_versions', 'UPDATE')) then
    raise exception '0259: service_role is missing a privilege the writers need';
  end if;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'sku_price_lanes' and grantee in ('PUBLIC', 'anon', 'authenticated')) then
    raise exception '0259: unexpected table grant on sku_price_lanes';
  end if;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'sku_pack_epochs' and grantee in ('PUBLIC', 'anon', 'authenticated')) then
    raise exception '0259: unexpected table grant on sku_pack_epochs';
  end if;
  if has_table_privilege('service_role', 'public.sku_pack_epochs', 'DELETE')
     or has_table_privilege('service_role', 'public.sku_pack_epochs', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.sku_pack_epochs', 'REFERENCES')
     or has_table_privilege('service_role', 'public.sku_pack_epochs', 'TRIGGER') then
    raise exception '0259: service_role above its ceiling';
  end if;
  if not (has_table_privilege('service_role', 'public.sku_pack_epochs', 'SELECT')
          and has_table_privilege('service_role', 'public.sku_pack_epochs', 'INSERT')
          and has_table_privilege('service_role', 'public.sku_pack_epochs', 'UPDATE')) then
    raise exception '0259: service_role is missing a privilege the writers need';
  end if;
  if has_table_privilege('service_role', 'public.sku_price_lanes', 'DELETE')
     or has_table_privilege('service_role', 'public.sku_price_lanes', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.sku_price_lanes', 'REFERENCES')
     or has_table_privilege('service_role', 'public.sku_price_lanes', 'TRIGGER') then
    raise exception '0259: service_role above its ceiling';
  end if;
  if not (has_table_privilege('service_role', 'public.sku_price_lanes', 'SELECT')
          and has_table_privilege('service_role', 'public.sku_price_lanes', 'INSERT')
          and has_table_privilege('service_role', 'public.sku_price_lanes', 'UPDATE')) then
    raise exception '0259: service_role is missing a privilege the writers need';
  end if;
end $$;

commit;
