-- Migration 0262_recipe_shop_versions
-- AUTHORED 2026-10-15. NOT YET APPLIED — apply via MCP after review (sim → prod dry-run → prod, BEFORE the 3a code merges; 0259–0261 first).
-- APPLIED TO SIM 2026-10-15 (schema_migrations version 20261015170452, name 'recipe_shop_versions')
-- APPLIED TO PROD 2026-10-15 (schema_migrations version 20261015171117, name 'recipe_shop_versions')
-- Plan: docs/superpowers/plans/2026-10-15-catalog-phase3a-recipe-menu-versions-data.md (Task 3).
-- Spec: docs/superpowers/specs/2026-10-15-catalog-redesign-design.md §3 (global defaults + shop versions), §6 (notices).
--
-- WHAT. Shop versions of a RECIPE's LINES beside the global default, EFFECTIVE-DATED, in the house idiom
-- `location_id NULL = global`:
--   recipe_versions           one row per version. location_id NULL = the global default; a shop id = that
--                             shop's own version. based_on / adopted_from / promoted_from say where it came
--                             from. In force over [valid_from, valid_to); one live row per (recipe, scope).
--                             Append-only: a save closes the old version and opens a new one.
--   recipe_version_lines      the full line set of a version — immutable once committed.
--   recipe_notice_dismissals  a GM's "keep mine" / "got it" on a read-time notice (computed in lib, 3b).
--
-- THE GLOBAL DEFAULT'S LIVE LINES STAY IN recipe_inputs. Every existing reader, Phase 1's line RPCs and the
-- 0258 graph lock keep their meaning. The global history is a JOURNAL of recipe_inputs:
-- recipe_global_journal(recipe) opens a new live global version holding a copy of the recipe's lines. It
-- runs from DEFERRED constraint triggers at COMMIT of every transaction that inserts, updates or deletes a
-- recipe line or creates a recipe — so no writer, seed or script can skip it — and explicitly from
-- save_recipe_version. A transaction journals a recipe once: a head it opened itself is brought up to date
-- in place (its lines are not history yet), never versioned twice. An unchanged set opens nothing.
--
-- BACKFILL: every recipe gets ONE global version valid from 2000-01-01 (the "since forever" baseline, the
-- 0259 idiom) holding a copy of its recipe_inputs. The past resolves exactly as today until a line changes,
-- and a recipe created later starts at 2000-01-01 too: EDITS are dated, existence is not.
--
-- THE CUTOVER IS CLOSED (Astra 3a r1#4). Before the backfill copies a single line, this transaction takes the
-- graph lock AND `SHARE ROW EXCLUSIVE` on recipes + recipe_inputs: every legacy writer (INSERT / UPDATE /
-- DELETE take ROW EXCLUSIVE, which conflicts) waits until COMMIT, by which time the journal triggers exist.
-- So no line write can land between the copy and the triggers, and none goes un-journaled. Belt and braces:
-- after the triggers are created, (5b) re-proves, recipe by recipe, that every baseline equals recipe_inputs
-- (READ COMMITTED: that statement sees anything that committed earlier) and aborts the migration if not.
--
-- THE RESOLUTION RULE IS NOT IN SQL. lib/recipe-versions-shared.ts + lib/prep-consumption.ts
-- loadRecipeLineOverlay: a scope's version in force, else the global one in force — and recipe_inputs itself
-- wherever the answer is the live global head.
--
-- THE CYCLE LAW, PER SHOP (0258, extended). A shop's graph is the global lines with its own live versions
-- substituted (recipe_scope_item_edges). Every writer refuses would_create_cycle in EVERY graph it changes,
-- under the 0258 graph lock 7258025800 (lock order: graph lock → recipe row):
--   save_recipe_version, shop     → that shop's graph;
--   save_recipe_version, global   → the global graph AND every active shop riding that recipe's global lines;
--   retire_recipe_version         → that shop's graph with the global lines back;
--   add/update_recipe_input_atomic (re-emitted) → + every active shop riding the global lines;
--   create_recipe_full / add_recipe_output (re-emitted) → + every active shop (outputs are global).
--
-- THE WRITERS (SECURITY DEFINER, search_path pinned, EXECUTE for service_role only):
--   save_recipe_version(p_recipe, p_location, p_lines, p_expected, p_based_on, p_note, p_actor,
--                       p_restored_from, p_adopted_from, p_promoted_from, p_snapshot)
--       one writer for a line set: a shop's version, or the global default (written into recipe_inputs with
--       the least churn, then journaled as this actor's version). Restore / adopt / promote COPY the source
--       version's lines IN SQL — the caller's payload is ignored for them — and EVERY line set, copied or
--       sent, passes the same rules as an add / update (lib/recipes.ts assertInputLineIsValid), including the
--       product rule: an ACTIVE product measured in an ACTIVE measure-registry unit (Astra 3a r1#5).
--       Optimistic: p_expected must be this scope's live version (the shop's, or the global head); a shop
--       forking the default must have seen the CURRENT default (p_based_on).
--       PROMOTE (lead decision 5) writes the new default AND retires the source shop's version in the SAME
--       transaction (its valid_to = the new default's valid_from; history kept): the source shop rides the
--       default from then on, eating exactly what it ate before.
--   retire_recipe_version(p_version, p_location, p_actor, p_snapshot)   a shop's "back to default" (never the
--       global one).
--   recipe_change_snapshot(p_recipe, p_location, p_lines)   THE DEPENDENCY SNAPSHOT (the 0261 pattern), SCOPED to
--       the change's dependency CLOSURE (recipe_change_closure; lead decision (a)): the recipes it reaches and
--       everything they consume, their items, menu items, SKUs, products and product MEMBERS, vendors, measures,
--       and — for the global view and each affected shop — the versions, primaries, activation overlays, receipts,
--       pack versions / levels and prices those resolve through. Never a whole table: an unrelated edit leaves it
--       unchanged. The preview takes it; both writers take the CLOSURE LOCKS (recipe_change_lock, NOWAIT, after the
--       graph lock) and then re-take it, refusing 'recipe_version:dependencies_changed' on any difference and
--       'recipe_version:dependencies_busy' when a dependency is being written right now. Lock order: (7a).
--   remove_recipe_input_atomic(p_input_id, p_actor)          the legacy line delete under the graph lock, so
--       its commit-time journal never inverts the lock order (lib/recipes.ts removeRecipeEdge).
-- A RESTORE copies only a GLOBAL version or THIS scope's own history ('recipe_version:restore_source_out_of_scope';
-- another shop's version is ADOPT's job, a shop's version into the default is PROMOTE's).
-- Named refusals: P0001 'recipe_version:<code>' (lib/admin/recipe-versions.ts maps them); the re-emits keep
-- 0258's unprefixed codes.
--
-- PRIVILEGE CEILING (the 0257 pattern): recipe_versions SELECT/INSERT/UPDATE; recipe_version_lines and
-- recipe_notice_dismissals SELECT/INSERT; nothing else for service_role; nothing for anon/authenticated; RLS
-- on with the deny-all policy set. Asserted both ways below.
--
-- PRE-FLIGHT (MCP, read-only):
--   select count(*) from public.recipes;                   -- = the global versions the backfill writes
--   select count(*) from public.recipe_inputs;             -- = the baseline lines it writes
--   select to_regclass('public.recipe_versions');          -- NULL
--   select version, name from supabase_migrations.schema_migrations order by version desc limit 5;  -- 0261 applied
-- VERIFY AFTER APPLY:
--   select count(*) from public.recipe_versions where location_id is null and active;           -- = recipes
--   select count(*) from public.recipe_versions where valid_from <> '2000-01-01T00:00:00Z';     -- 0
--   select count(*) from public.recipe_version_lines;                                           -- = recipe_inputs
--   select relname, relrowsecurity from pg_class where oid in ('public.recipe_versions'::regclass,
--     'public.recipe_version_lines'::regclass, 'public.recipe_notice_dismissals'::regclass);   -- t, t, t
--   select table_name, grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name in ('recipe_versions','recipe_version_lines','recipe_notice_dismissals')
--    order by 1, 2, 3;      -- service_role: versions INSERT/SELECT/UPDATE, lines + dismissals INSERT/SELECT (+ owner)
--   select tgname from pg_trigger where tgrelid in ('public.recipe_inputs'::regclass, 'public.recipes'::regclass)
--      and not tgisinternal and tgname like '%journal%' order by 1;                              -- recipe_inputs_journal, recipes_journal
--   select routine_name, grantee from information_schema.routine_privileges
--    where routine_schema = 'public' and privilege_type = 'EXECUTE'
--      and routine_name in ('save_recipe_version','retire_recipe_version','remove_recipe_input_atomic','recipe_change_snapshot',
--                           'add_recipe_input_atomic','update_recipe_input_atomic','create_recipe_full','add_recipe_output')
--    order by 1, 2;                                                                            -- service_role (+ owner) only
--   select count(*) from public.recipe_versions v where v.location_id is null and v.active
--      and not public.recipe_journal_lines_equal(v.recipe_id, v.id);                            -- 0 (run as the owner)

begin;

-- ── (0) the cutover lock: no legacy line write between the backfill copy and the journal triggers ──
select pg_advisory_xact_lock(7258025800);
lock table public.recipes, public.recipe_inputs in share row exclusive mode;

-- ── (1) recipe_versions ───────────────────────────────────────────────────────
create table if not exists public.recipe_versions (
  id                       uuid        primary key default gen_random_uuid(),
  recipe_id                uuid        not null references public.recipes(id),
  location_id              uuid        null references public.locations(id),
  scope_key                uuid        generated always as (coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  based_on_version_id      uuid        null references public.recipe_versions(id),
  adopted_from_version_id  uuid        null references public.recipe_versions(id),
  promoted_from_version_id uuid        null references public.recipe_versions(id),
  -- PROVENANCE'S END, RECORDED (Astra r7): set by the writer when this row ends an adoption link — on a restore's new
  -- row, the REPLACED version that carried the pointer; on a Back-to-default retirement, the retired row itself.
  -- History reads THIS, never an inference from based_on_version_id (a restore's based_on is the RESTORED version).
  adoption_ended_from_version_id uuid null references public.recipe_versions(id),
  active                   boolean     not null default true,
  valid_from               timestamptz not null default clock_timestamp(),
  valid_to                 timestamptz null,
  note                     text        null,
  created_at               timestamptz not null default clock_timestamp(),
  created_by               uuid        null references public.users(id),
  retired_by               uuid        null references public.users(id),
  created_xact             xid8        not null default pg_current_xact_id(),
  constraint recipe_versions_live_window check ((valid_to is null) = active),
  constraint recipe_versions_adopt_is_shop check (adopted_from_version_id is null or location_id is not null),
  constraint recipe_versions_promote_is_global check (promoted_from_version_id is null or location_id is null),
  constraint recipe_versions_adoption_end_is_shop check (adoption_ended_from_version_id is null or location_id is not null),
  constraint recipe_versions_identity_uq unique (id, recipe_id, scope_key)
);
comment on table public.recipe_versions is
  'A recipe''s LINE SET as an effective-dated version (0262). location_id NULL = the global default (its live '
  'version is the journal of recipe_inputs); a shop id = that shop''s own version. In force over [valid_from, '
  'valid_to); one live per (recipe, scope_key). Append-only. Resolution: lib/recipe-versions-shared.ts.';
comment on column public.recipe_versions.created_xact is
  'The transaction that opened this version (0262): recipe_global_journal journals a recipe once per transaction.';

create unique index if not exists recipe_versions_one_live on public.recipe_versions (recipe_id, scope_key) where active;
create index if not exists recipe_versions_as_of_ix on public.recipe_versions (recipe_id, scope_key, valid_from);
create index if not exists recipe_versions_shop_live_ix on public.recipe_versions (location_id) where active;
create index if not exists recipe_versions_adopted_ix on public.recipe_versions (adopted_from_version_id) where adopted_from_version_id is not null;

-- ── (2) recipe_version_lines ──────────────────────────────────────────────────
create table if not exists public.recipe_version_lines (
  id                   uuid        primary key default gen_random_uuid(),
  version_id           uuid        not null,
  recipe_id            uuid        not null,
  location_id          uuid        null references public.locations(id),
  scope_key            uuid        generated always as (coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  component_sku_id     uuid        null references public.vendor_items(id),
  component_item_id    uuid        null references public.items(id),
  component_product_id uuid        null references public.products(id),
  quantity             numeric     not null check (quantity > 0),
  unit                 text        null,
  each_container_label text        null,
  portioned            boolean     not null default false,
  display_order        integer     not null default 0,
  source_line_id       uuid        null,
  created_at           timestamptz not null default clock_timestamp(),
  constraint recipe_version_lines_exactly_one_component check (
    ((component_sku_id     is not null)::int
   + (component_item_id    is not null)::int
   + (component_product_id is not null)::int) = 1
  ),
  constraint recipe_version_lines_version_fk
    foreign key (version_id, recipe_id, scope_key) references public.recipe_versions (id, recipe_id, scope_key)
);
comment on table public.recipe_version_lines is
  'The lines of one recipe version (0262), immutable once committed. source_line_id = the line it was copied or '
  'edited from (a recipe_inputs id or another version''s line) — lineage only, deliberately no FK.';
create index if not exists recipe_version_lines_version_ix on public.recipe_version_lines (version_id, display_order);
create index if not exists recipe_version_lines_item_ix on public.recipe_version_lines (component_item_id) where component_item_id is not null;

-- ── (3) recipe_notice_dismissals ──────────────────────────────────────────────
create table if not exists public.recipe_notice_dismissals (
  id              uuid        primary key default gen_random_uuid(),
  location_id     uuid        not null references public.locations(id),
  recipe_id       uuid        not null references public.recipes(id),
  kind            text        not null check (kind in ('source_changed', 'source_retired', 'new_default')),
  seen_version_id uuid        not null references public.recipe_versions(id),
  created_at      timestamptz not null default now(),
  created_by      uuid        null references public.users(id)
);
comment on table public.recipe_notice_dismissals is
  'A GM''s answer to a read-time notice (0262; the notices are computed in lib, never swept): this shop has '
  'seen THIS version of the source while it was live (source_changed) or once it was retired (source_retired — '
  'the source went back to the default or was promoted), or THIS new default (new_default). A later change — a '
  'new version, or the same version''s retirement — raises it again.';
create unique index if not exists recipe_notice_dismissals_once
  on public.recipe_notice_dismissals (location_id, recipe_id, kind, seen_version_id);

-- ── (4) backfill: every recipe gets ONE global baseline version holding its lines ──
do $$
declare
  v_recipes  int;
  v_inputs   int;
  v_lines    int;
  v_bad      int;
begin
  insert into public.recipe_versions (recipe_id, location_id, active, valid_from, note)
  select r.id, null, true, '2000-01-01T00:00:00Z'::timestamptz, '0262 baseline'
    from public.recipes r
   where not exists (select 1 from public.recipe_versions v where v.recipe_id = r.id and v.location_id is null);

  insert into public.recipe_version_lines (version_id, recipe_id, location_id, component_sku_id, component_item_id,
    component_product_id, quantity, unit, each_container_label, portioned, display_order, source_line_id, created_at)
  select v.id, ri.recipe_id, null, ri.component_sku_id, ri.component_item_id, ri.component_product_id,
         ri.quantity, ri.unit, ri.each_container_label, ri.portioned, ri.display_order, ri.id, ri.created_at
    from public.recipe_inputs ri
    join public.recipe_versions v on v.recipe_id = ri.recipe_id and v.location_id is null and v.active;
  get diagnostics v_lines = row_count;

  select count(*) into v_recipes from public.recipes;
  select count(*) into v_inputs from public.recipe_inputs;
  select count(*) into v_bad from public.recipes r
   where (select count(*) from public.recipe_versions v where v.recipe_id = r.id and v.location_id is null and v.active) <> 1;
  assert v_bad = 0, format('0262: %s recipes without exactly one live global version', v_bad);
  assert v_lines = v_inputs, format('0262: baseline lines do not match recipe_inputs (%s vs %s)', v_lines, v_inputs);
  raise notice '0262 backfill: % recipes, % baseline lines', v_recipes, v_lines;
end $$;

-- ── (5) the journal ───────────────────────────────────────────────────────────
-- Do recipe_inputs and a version hold the same lines? (multiset equality, NULL-safe via EXCEPT ALL)
create or replace function public.recipe_journal_lines_equal(p_recipe uuid, p_version uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select not exists (
    (select component_sku_id, component_item_id, component_product_id, quantity, unit, each_container_label, portioned, display_order
       from public.recipe_inputs where recipe_id = p_recipe
     except all
     select component_sku_id, component_item_id, component_product_id, quantity, unit, each_container_label, portioned, display_order
       from public.recipe_version_lines where version_id = p_version)
    union all
    (select component_sku_id, component_item_id, component_product_id, quantity, unit, each_container_label, portioned, display_order
       from public.recipe_version_lines where version_id = p_version
     except all
     select component_sku_id, component_item_id, component_product_id, quantity, unit, each_container_label, portioned, display_order
       from public.recipe_inputs where recipe_id = p_recipe)
  );
$$;

-- Journal recipe_inputs as the recipe's live GLOBAL version. Returns the head (null if the recipe is gone).
create or replace function public.recipe_global_journal(p_recipe uuid, p_actor uuid, p_promoted_from uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_head  public.recipe_versions%rowtype;
  v_has   boolean;
  v_actor uuid := coalesce(p_actor, nullif(current_setting('app.recipe_journal_actor', true), '')::uuid);
  v_now   timestamptz;
  v_new   uuid;
begin
  -- The 0258 lock order: the graph lock, then the recipe row.
  perform pg_advisory_xact_lock(7258025800);
  perform 1 from public.recipes where id = p_recipe for no key update;
  if not found then
    return null;
  end if;
  select * into v_head from public.recipe_versions
   where recipe_id = p_recipe and location_id is null and active for update;
  v_has := found;
  if v_has and v_head.created_xact = pg_current_xact_id() then
    -- THIS transaction opened the head: its lines are not history yet (nothing outside this transaction can
    -- have read them), so they are brought up to date in place — a recipe is journaled once per transaction.
    if not public.recipe_journal_lines_equal(p_recipe, v_head.id) then
      delete from public.recipe_version_lines where version_id = v_head.id;
      insert into public.recipe_version_lines (version_id, recipe_id, location_id, component_sku_id, component_item_id,
        component_product_id, quantity, unit, each_container_label, portioned, display_order, source_line_id)
      select v_head.id, ri.recipe_id, null, ri.component_sku_id, ri.component_item_id, ri.component_product_id,
             ri.quantity, ri.unit, ri.each_container_label, ri.portioned, ri.display_order, ri.id
        from public.recipe_inputs ri where ri.recipe_id = p_recipe;
    end if;
    return v_head.id;
  end if;
  if v_has and p_promoted_from is null and public.recipe_journal_lines_equal(p_recipe, v_head.id) then
    return v_head.id; -- nothing changed: no empty version
  end if;
  v_now := greatest(clock_timestamp(), coalesce(v_head.valid_from, '-infinity'::timestamptz));
  if v_has then
    update public.recipe_versions set active = false, valid_to = v_now, retired_by = v_actor where id = v_head.id and active;
  end if;
  insert into public.recipe_versions (recipe_id, location_id, based_on_version_id, promoted_from_version_id, active,
                                      valid_from, note, created_at, created_by)
  values (p_recipe, null, v_head.id, p_promoted_from, true,
          case when exists (select 1 from public.recipe_versions where recipe_id = p_recipe and location_id is null)
               then v_now else '2000-01-01T00:00:00Z'::timestamptz end,
          nullif(btrim(coalesce(p_note, '')), ''), v_now, v_actor)
  returning id into v_new;
  insert into public.recipe_version_lines (version_id, recipe_id, location_id, component_sku_id, component_item_id,
    component_product_id, quantity, unit, each_container_label, portioned, display_order, source_line_id)
  select v_new, ri.recipe_id, null, ri.component_sku_id, ri.component_item_id, ri.component_product_id,
         ri.quantity, ri.unit, ri.each_container_label, ri.portioned, ri.display_order, ri.id
    from public.recipe_inputs ri where ri.recipe_id = p_recipe;
  return v_new;
end;
$$;

create or replace function public.recipe_inputs_journal_trg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op <> 'DELETE' then
    perform public.recipe_global_journal(new.recipe_id, null, null, null);
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.recipe_id is distinct from new.recipe_id) then
    perform public.recipe_global_journal(old.recipe_id, null, null, null);
  end if;
  return null;
end;
$$;

create or replace function public.recipes_journal_trg()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.recipe_global_journal(new.id, null, null, null);
  return null;
end;
$$;

-- Created AFTER the backfill, so the backfill journals nothing — and still under (0)'s table lock, so no
-- legacy write landed in between. DEFERRED to COMMIT: the journal sees the transaction's final lines,
-- whatever order its statements ran in.
drop trigger if exists recipe_inputs_journal on public.recipe_inputs;
create constraint trigger recipe_inputs_journal
  after insert or update or delete on public.recipe_inputs
  deferrable initially deferred
  for each row execute function public.recipe_inputs_journal_trg();
drop trigger if exists recipes_journal on public.recipes;
create constraint trigger recipes_journal
  after insert on public.recipes
  deferrable initially deferred
  for each row execute function public.recipes_journal_trg();

-- recipe_inputs / recipes are never TRUNCATEd (review P3d): a truncate skips row triggers, so it would empty the global
-- lines with no journal entry (and TRUNCATE recipes CASCADE would wipe the version history itself). Refused.
create or replace function public.recipe_journal_refuse_truncate()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  raise exception 'recipe_version:truncate_refused' using errcode = 'P0001',
        detail = format('%s is journaled (0262): remove lines through the writers, never TRUNCATE', tg_table_name);
end;
$$;
drop trigger if exists recipe_inputs_no_truncate on public.recipe_inputs;
create trigger recipe_inputs_no_truncate before truncate on public.recipe_inputs
  for each statement execute function public.recipe_journal_refuse_truncate();
drop trigger if exists recipes_no_truncate on public.recipes;
create trigger recipes_no_truncate before truncate on public.recipes
  for each statement execute function public.recipe_journal_refuse_truncate();

-- ── (5b) the cutover proof: every baseline still equals recipe_inputs, recipe by recipe ──
do $$
declare
  v_bad int;
begin
  select count(*) into v_bad
    from public.recipe_versions v
   where v.location_id is null and v.active
     and not public.recipe_journal_lines_equal(v.recipe_id, v.id);
  assert v_bad = 0, format('0262: %s baseline versions differ from recipe_inputs — a line write landed during the cutover', v_bad);
end $$;

-- ── (6) the cycle law, per scope ──────────────────────────────────────────────
-- The item edges scope p_scope's graph resolves: the global lines of every recipe it has no live version of,
-- plus the lines of its live versions. p_scope NULL = the global graph (recipe_inputs alone).
create or replace function public.recipe_scope_item_edges(p_scope uuid)
returns table (edge_recipe_id uuid, edge_item_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select ri.recipe_id, ri.component_item_id
    from public.recipe_inputs ri
   where ri.component_item_id is not null
     and (p_scope is null or not exists (
           select 1 from public.recipe_versions v
            where v.recipe_id = ri.recipe_id and v.location_id = p_scope and v.active))
  union all
  select l.recipe_id, l.component_item_id
    from public.recipe_version_lines l
    join public.recipe_versions v on v.id = l.version_id
   where p_scope is not null and v.location_id = p_scope and v.active and l.component_item_id is not null;
$$;

-- Would recipe p_recipe holding item lines p_line_items close a loop in scope p_scope's graph? Its own old
-- edges are replaced by p_line_items; the walk starts at p_start_items and follows every producer's lines; a
-- cycle iff it reaches an item p_recipe outputs. (lib/recipe-versions-shared.ts recipeLinesWouldCycle.)
create or replace function public.recipe_lines_would_cycle(p_scope uuid, p_recipe uuid, p_line_items uuid[], p_start_items uuid[])
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with recursive edges(recipe_id, item_id) as (
    select e.edge_recipe_id, e.edge_item_id from public.recipe_scope_item_edges(p_scope) e where e.edge_recipe_id <> p_recipe
    union all
    select p_recipe, x.item_id from unnest(coalesce(p_line_items, '{}'::uuid[])) as x(item_id)
  ),
  targets(item_id) as (
    select ro.output_item_id from public.recipe_outputs ro where ro.recipe_id = p_recipe and ro.output_item_id is not null
  ),
  reach(item_id) as (
    select x.item_id from unnest(coalesce(p_start_items, '{}'::uuid[])) as x(item_id)
    union
    select e.item_id
      from reach r
      join public.recipe_outputs ro on ro.output_item_id = r.item_id
      join edges e on e.recipe_id = ro.recipe_id
  )
  select exists (select 1 from reach join targets using (item_id));
$$;

-- The 0258 single-line check, for every ACTIVE shop that rides p_recipe's GLOBAL lines.
create or replace function public.recipe_shops_input_would_cycle(p_recipe uuid, p_item uuid, p_exclude_input uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
      from public.locations l
     where l.active
       and not exists (select 1 from public.recipe_versions v
                        where v.recipe_id = p_recipe and v.location_id = l.id and v.active)
       and public.recipe_lines_would_cycle(
             l.id, p_recipe,
             array(select ri.component_item_id from public.recipe_inputs ri
                    where ri.recipe_id = p_recipe and ri.component_item_id is not null
                      and (p_exclude_input is null or ri.id <> p_exclude_input)) || p_item,
             array[p_item]));
$$;

-- The 0258 output check, in every ACTIVE shop's graph: a new output p_item on p_recipe closes a loop there iff
-- p_item is reachable from p_recipe's lines AS THAT SHOP RESOLVES THEM.
create or replace function public.recipe_shops_output_would_cycle(p_recipe uuid, p_item uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_loc uuid;
begin
  for v_loc in select id from public.locations where active order by id loop
    if exists (
      with recursive edges(recipe_id, item_id) as (
        select e.edge_recipe_id, e.edge_item_id from public.recipe_scope_item_edges(v_loc) e
      ),
      reach(item_id) as (
        select e.item_id from edges e where e.recipe_id = p_recipe
        union
        select e.item_id
          from reach r
          join public.recipe_outputs ro on ro.output_item_id = r.item_id
          join edges e on e.recipe_id = ro.recipe_id
      )
      select 1 from reach where item_id = p_item
    ) then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

-- ── (7a) the dependency closure, its snapshot and its locks (taken by the preview, re-taken by every writer) ──
-- SCOPED, NEVER WHOLE-TABLE (lead decision (a), Astra 3a r2#1/#2): a snapshot covers exactly what the change's
-- numbers are computed from — so an unrelated recipe or SKU edit never stales a preview, and a related one always does.

-- The lines scope p_scope resolves (NULL = the global graph): recipe_inputs for every recipe it has no live
-- version of, plus the lines of its live versions. (recipe_scope_item_edges, for every component kind.)
create or replace function public.recipe_scope_lines(p_scope uuid)
returns table (line_recipe_id uuid, line_sku_id uuid, line_item_id uuid, line_product_id uuid, line_unit text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select ri.recipe_id, ri.component_sku_id, ri.component_item_id, ri.component_product_id, ri.unit
    from public.recipe_inputs ri
   where p_scope is null or not exists (
           select 1 from public.recipe_versions v where v.recipe_id = ri.recipe_id and v.location_id = p_scope and v.active)
  union all
  select l.recipe_id, l.component_sku_id, l.component_item_id, l.component_product_id, l.unit
    from public.recipe_version_lines l
    join public.recipe_versions v on v.id = l.version_id
   where p_scope is not null and v.location_id = p_scope and v.active;
$$;

-- THE DEPENDENCY CLOSURE of a change to p_recipe at p_location (NULL = the global default, which reaches the
-- default and every active shop), with p_lines = the line set being written (the edit's result, or the source a
-- restore / adopt / promote copies). Over the global scope and every affected shop:
--   UP    the recipe and every recipe that (transitively) uses an item it makes — the sandwiches whose cost the
--         preview shows;
--   DOWN  every recipe any of those (transitively) consumes — everything those costs are computed from;
-- then every item, menu item, SKU, product, product MEMBER (any SKU of a pinned product — product resolution
-- picks among them), vendor (eligibility: active, source kind), measure (line units and the SKUs' pack-level
-- units) and shop they touch. Rows: (member_kind, member_id).
create or replace function public.recipe_change_closure(p_recipe uuid, p_location uuid, p_lines jsonb)
returns table (member_kind text, member_id text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with recursive
  -- ONLY THE SCOPES WHOSE RESOLVED RESULT THIS CHANGE CAN MOVE (Astra 3b r3#2) — exactly the preview's reached set:
  --   a shop target         → that shop alone (its graph already carries the default lines it rides);
  --   the global default    → the global view + every active shop RIDING this recipe's default (a shop with
  --                           its own live version is untouched, so its ingredients are never dependencies);
  --   NIL (00000000-…)      → the global view alone (a menu promote shows only the default's cost).
  scopes(scope_id) as (
    select null::uuid where p_location is null or p_location = '00000000-0000-0000-0000-000000000000'::uuid
    union all
    select s.id from public.locations s
     where s.active
       and (case when p_location is null
                 then not exists (select 1 from public.recipe_versions v
                                   where v.recipe_id = p_recipe and v.location_id = s.id and v.active)
                 else s.id = p_location end)
  ),
  lines(recipe_id, sku_id, item_id, product_id, unit) as (
    select l.line_recipe_id, l.line_sku_id, l.line_item_id, l.line_product_id, l.line_unit
      from scopes sc cross join lateral public.recipe_scope_lines(sc.scope_id) l
    union all
    select p_recipe, nullif(x ->> 'component_sku_id', '')::uuid, nullif(x ->> 'component_item_id', '')::uuid,
           nullif(x ->> 'component_product_id', '')::uuid, nullif(btrim(coalesce(x ->> 'unit', '')), '')
      from jsonb_array_elements(case when jsonb_typeof(p_lines) = 'array' then p_lines else '[]'::jsonb end) x
  ),
  up(recipe_id) as (
    select p_recipe
    union
    select l.recipe_id
      from up
      join public.recipe_outputs ro on ro.recipe_id = up.recipe_id and ro.output_item_id is not null
      join lines l on l.item_id = ro.output_item_id
  ),
  down(recipe_id) as (
    select u.recipe_id from up u
    union
    select ro.recipe_id
      from down
      join lines l on l.recipe_id = down.recipe_id and l.item_id is not null
      join public.recipe_outputs ro on ro.output_item_id = l.item_id
  ),
  closure_lines as (select l.* from lines l join down d on d.recipe_id = l.recipe_id),
  products as (select distinct cl.product_id from closure_lines cl where cl.product_id is not null),
  skus(id) as (
    select cl.sku_id from closure_lines cl where cl.sku_id is not null
    union
    select vi.id from public.vendor_items vi join products p on vi.product_id = p.product_id
  )
  select 'recipe', d.recipe_id::text from down d
  union select 'item', cl.item_id::text from closure_lines cl where cl.item_id is not null
  union select 'item', ro.output_item_id::text from public.recipe_outputs ro join down d on d.recipe_id = ro.recipe_id where ro.output_item_id is not null
  union select 'menu_item', ro.output_menu_item_id::text from public.recipe_outputs ro join down d on d.recipe_id = ro.recipe_id where ro.output_menu_item_id is not null
  union select 'product', p.product_id::text from products p
  union select 'sku', s.id::text from skus s
  union select 'vendor', vi.vendor_id::text from public.vendor_items vi join skus s on s.id = vi.id where vi.vendor_id is not null
  union select 'measure', cl.unit from closure_lines cl where cl.unit is not null
  union select 'measure', pl.contains_measure_unit from public.sku_pack_levels pl join skus s on s.id = pl.sku_id where pl.contains_measure_unit is not null
  -- FLAT-PACK measurement (Astra 3a r3#2): a chainless SKU's content is units_per_pack × each_size in each_measure
  -- (lib/recipe-math.ts skuContentOz) — those columns are in the SKU row's digest; the registry row they read is here.
  union select 'measure', vi.each_measure from public.vendor_items vi join skus s on s.id = vi.id where vi.each_measure is not null
  union select 'shop', sc.scope_id::text from scopes sc where sc.scope_id is not null;
$$;

-- THE DEPENDENCY SNAPSHOT: the closure itself plus a digest of every row in it (and, per affected shop, every
-- row a resolver reads for it). Product resolution's inputs are all here: the product rows (active, unit_oz), the
-- members (active, vendor, pack), the primaries (global + affected shops), the shops' activation overlay, the
-- members' vendors (active, source kind) and the RECEIPT history at the affected shops (the store-run streak).
-- A global graph also resolves the most-recently-received member across the whole organization.
create or replace function public.recipe_change_snapshot(p_recipe uuid, p_location uuid, p_lines jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_recipes  uuid[];
  v_items    uuid[];
  v_menu     uuid[];
  v_products uuid[];
  v_skus     uuid[];
  v_vendors  uuid[];
  v_measures text[];
  v_shops    uuid[];
begin
  select coalesce(array_agg(member_id::uuid order by member_id) filter (where member_kind = 'recipe'), '{}'),
         coalesce(array_agg(member_id::uuid order by member_id) filter (where member_kind = 'item'), '{}'),
         coalesce(array_agg(member_id::uuid order by member_id) filter (where member_kind = 'menu_item'), '{}'),
         coalesce(array_agg(member_id::uuid order by member_id) filter (where member_kind = 'product'), '{}'),
         coalesce(array_agg(member_id::uuid order by member_id) filter (where member_kind = 'sku'), '{}'),
         coalesce(array_agg(member_id::uuid order by member_id) filter (where member_kind = 'vendor'), '{}'),
         coalesce(array_agg(member_id order by member_id) filter (where member_kind = 'measure'), '{}'),
         coalesce(array_agg(member_id::uuid order by member_id) filter (where member_kind = 'shop'), '{}')
    into v_recipes, v_items, v_menu, v_products, v_skus, v_vendors, v_measures, v_shops
    from public.recipe_change_closure(p_recipe, p_location, p_lines);
  return jsonb_build_object(
    'active_shops', coalesce((select jsonb_agg(l.id order by l.id) from public.locations l where l.active), '[]'::jsonb),
    'closure', jsonb_build_object('recipes', to_jsonb(v_recipes), 'items', to_jsonb(v_items), 'menu_items', to_jsonb(v_menu),
                                  'products', to_jsonb(v_products), 'skus', to_jsonb(v_skus), 'vendors', to_jsonb(v_vendors),
                                  'measures', to_jsonb(v_measures), 'shops', to_jsonb(v_shops)),
    'rows', jsonb_build_object(
      'recipes', (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.recipes t where t.id = any(v_recipes)),
      'recipe_versions', (select md5(coalesce(string_agg(jsonb_build_array(t.id, t.recipe_id, t.location_id, t.active, t.valid_from, t.valid_to)::text, '|' order by t.id), ''))
                            from public.recipe_versions t
                           where t.recipe_id = any(v_recipes) and (t.location_id is null or t.location_id = any(v_shops))),
      'recipe_inputs', (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.recipe_inputs t where t.recipe_id = any(v_recipes)),
      'recipe_outputs', (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.recipe_outputs t where t.recipe_id = any(v_recipes)),
      'items', (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.items t where t.id = any(v_items)),
      'menu_items', (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.menu_items t where t.id = any(v_menu)),
      'vendor_items', (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.vendor_items t where t.id = any(v_skus)),
      'products', (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.products t where t.id = any(v_products)),
      'product_primaries', (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.product_primaries t
                             where t.product_id = any(v_products) and (t.location_id is null or t.location_id = any(v_shops))),
      'shop_activation', (select md5(coalesce(string_agg(jsonb_build_array(t.location_id, t.sku_id, t.active_override)::text, '|' order by t.location_id, t.sku_id), ''))
                            from public.location_sku_settings t where t.sku_id = any(v_skus) and t.location_id = any(v_shops)),
      'vendors', (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.vendors t where t.id = any(v_vendors)),
      'receipts', (select md5(coalesce(string_agg(jsonb_build_array(di.id, di.vendor_item_id, di.delivery_id, di.created_at, d.location_id, v.source_kind)::text, '|' order by di.id), ''))
                     from public.vendor_delivery_items di
                     join public.vendor_deliveries d on d.id = di.delivery_id
                     left join public.vendors v on v.id = d.vendor_id
                    -- Only PRODUCT MEMBERS (review P3a): receipts feed product resolution's "most recently received"
                    -- rung and nothing else here, so a plain SKU's delivery never stales a preview.
                    where di.vendor_item_id in (select vi.id from public.vendor_items vi where vi.product_id = any(v_products))
                      and (p_location is null or p_location = '00000000-0000-0000-0000-000000000000'::uuid
                           or d.location_id = any(v_shops))),
      'measure_units', (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.label), '')) from public.measure_units t where t.label = any(v_measures)),
      'sku_pack_versions', (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.sku_pack_versions t
                             where t.sku_id = any(v_skus) and (t.location_id is null or t.location_id = any(v_shops))),
      'sku_pack_levels', (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.sku_pack_levels t
                           where t.sku_id = any(v_skus) and (t.location_id is null or t.location_id = any(v_shops))),
      'sku_price_lanes', (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.sku_price_lanes t
                           where t.sku_id = any(v_skus) and t.location_id = any(v_shops)),
      'vendor_price_history', (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.vendor_price_history t
                                where t.vendor_item_id = any(v_skus) and (t.location_id is null or t.location_id = any(v_shops)))));
end;
$$;

-- THE CLOSURE LOCKS (Astra 3a r2#3, 3b r2#1). Taken by every writer AFTER the graph lock and its own target-row lock,
-- BEFORE it re-takes the snapshot, held to COMMIT — so nothing the snapshot covers can change between the check and
-- the commit. Each lock is chosen to block that dependency's writers, insertions included:
--   locations, measure_units      FOR SHARE NOWAIT on the ROWS (every active shop; the closure's measures) — no shop
--                                  or measure the snapshot reads is changed or (de)activated. ROW locks, never a table
--                                  SHARE lock (review P3b: a table SHARE lock conflicts with autovacuum / ANALYZE's
--                                  SHARE UPDATE EXCLUSIVE and would refuse dependencies_busy for no reason). A brand-new
--                                  shop row is not blocked; it changes 'active_shops', so a save that raced one is
--                                  refused dependencies_changed by the next re-check (never written against a stale list);
--   recipes, items, recipe_outputs FOR SHARE — blocks header / yield / item updates and legacy output deletes
--                                  (line and output INSERTS already need the graph lock we hold);
--   products                      FOR UPDATE — also blocks every INSERT/UPDATE whose foreign key names the product
--                                  (a new member SKU, a re-pointed SKU, a new primary row take FOR KEY SHARE);
--   product_primaries, location_sku_settings (affected shops)  FOR SHARE — blocks their updates;
--   vendors                       FOR SHARE — blocks deactivation / source-kind changes;
--   vendor_items                  FOR UPDATE — blocks every 0259 pack / price / lane writer (they lock the SKU row
--                                  FOR UPDATE first) AND every row inserted against the SKU: receipts
--                                  (vendor_delivery_items), price history, pack versions/levels, activation overlays;
--   menu_items                    FOR SHARE.
-- EVERY ONE IS NOWAIT: a writer of these never waits on a lock held by a non-graph writer, so it can never close a
-- deadlock cycle (they may wait on it for milliseconds; it never waits on them). A dependency being written right
-- now refuses 'recipe_version:dependencies_busy' (try again) instead of waiting.
-- LOCK ORDER for every Phase 3 writer: graph advisory lock 7258025800 → the target row (recipe / menu item; these
-- two may wait) → locations → measure_units → recipes → items → products → product_primaries → vendors →
-- vendor_items → location_sku_settings → menu_items → recipe_outputs (each by key; all NOWAIT).
create or replace function public.recipe_change_lock(p_recipe uuid, p_location uuid, p_lines jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_recipes  uuid[];
  v_items    uuid[];
  v_menu     uuid[];
  v_products uuid[];
  v_skus     uuid[];
  v_vendors  uuid[];
  v_measures text[];
  v_shops    uuid[];
begin
  -- The graph lock FIRST (re-entrant: every writer already holds it, so this returns at once; the order above
  -- therefore holds even for a direct caller such as the sim scenario).
  perform pg_advisory_xact_lock(7258025800);
  select coalesce(array_agg(member_id::uuid) filter (where member_kind = 'recipe'), '{}'),
         coalesce(array_agg(member_id::uuid) filter (where member_kind = 'item'), '{}'),
         coalesce(array_agg(member_id::uuid) filter (where member_kind = 'menu_item'), '{}'),
         coalesce(array_agg(member_id::uuid) filter (where member_kind = 'product'), '{}'),
         coalesce(array_agg(member_id::uuid) filter (where member_kind = 'sku'), '{}'),
         coalesce(array_agg(member_id::uuid) filter (where member_kind = 'vendor'), '{}'),
         coalesce(array_agg(member_id) filter (where member_kind = 'measure'), '{}'),
         coalesce(array_agg(member_id::uuid) filter (where member_kind = 'shop'), '{}')
    into v_recipes, v_items, v_menu, v_products, v_skus, v_vendors, v_measures, v_shops
    from public.recipe_change_closure(p_recipe, p_location, p_lines);
  perform 1 from public.locations where active order by id for share nowait;
  perform 1 from public.measure_units where label = any(v_measures) order by label for share nowait;
  perform 1 from public.recipes where id = any(v_recipes) order by id for share nowait;
  perform 1 from public.items where id = any(v_items) order by id for share nowait;
  perform 1 from public.products where id = any(v_products) order by id for update nowait;
  perform 1 from public.product_primaries where product_id = any(v_products) and (location_id is null or location_id = any(v_shops))
    order by id for share nowait;
  perform 1 from public.vendors where id = any(v_vendors) order by id for share nowait;
  perform 1 from public.vendor_items where id = any(v_skus) order by id for update nowait;
  perform 1 from public.location_sku_settings where sku_id = any(v_skus) and location_id = any(v_shops)
    order by location_id, sku_id for share nowait;
  perform 1 from public.menu_items where id = any(v_menu) order by id for share nowait;
  perform 1 from public.recipe_outputs where recipe_id = any(v_recipes) order by id for share nowait;
exception
  when lock_not_available then
    raise exception 'recipe_version:dependencies_busy' using errcode = 'P0001';
end;
$$;

-- ── (7) the writers ───────────────────────────────────────────────────────────
create or replace function public.save_recipe_version(
  p_recipe        uuid,
  p_location      uuid,
  p_lines         jsonb,
  p_expected      uuid,
  p_based_on      uuid,
  p_note          text,
  p_actor         uuid,
  p_restored_from uuid,
  p_adopted_from  uuid,
  p_promoted_from uuid,
  p_snapshot      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_changed jsonb;
  v_copy    boolean;
  v_new_adopted uuid;
  v_ended   uuid;
  v_seen    int;
  v_have    int;
  v_active  boolean;
  v_global  uuid;
  v_live    uuid;
  v_source  public.recipe_versions%rowtype;
  v_lines   jsonb;
  v_count   int;
  v_i       int;
  v_line    jsonb;
  v_items   uuid[];
  v_new     uuid := gen_random_uuid();
  v_now     timestamptz;
  v_written int;
begin
  if num_nonnulls(p_restored_from, p_adopted_from, p_promoted_from) > 1
     or (p_adopted_from is not null and p_location is null)
     or (p_promoted_from is not null and p_location is not null) then
    raise exception 'recipe_version:invalid_payload' using errcode = 'P0001';
  end if;

  -- THE GRAPH LOCK, then the recipe row (0258's order: every recipe writer serializes here).
  perform pg_advisory_xact_lock(7258025800);
  select r.active into v_active from public.recipes r where r.id = p_recipe for no key update;
  if not found then
    raise exception 'recipe_version:recipe_not_found' using errcode = 'P0001';
  end if;
  if not v_active then
    raise exception 'recipe_version:recipe_inactive' using errcode = 'P0001';
  end if;
  if p_location is not null and not exists (select 1 from public.locations where id = p_location and active) then
    raise exception 'recipe_version:location_not_found' using errcode = 'P0001';
  end if;
  -- THE LINE SET: restore / adopt / promote COPY the source version here; otherwise the payload.
  if coalesce(p_restored_from, p_adopted_from, p_promoted_from) is not null then
    select * into v_source from public.recipe_versions
     where id = coalesce(p_restored_from, p_adopted_from, p_promoted_from) and recipe_id = p_recipe;
    if not found
       or (p_adopted_from is not null and (v_source.location_id is null or v_source.location_id = p_location or not v_source.active))
       or (p_promoted_from is not null and (v_source.location_id is null or not v_source.active)) then
      raise exception 'recipe_version:invalid_source' using errcode = 'P0001';
    end if;
    -- RESTORE stays inside its own history (the database is the backstop, as 2a's pack restore): a source that is
    -- neither GLOBAL nor THIS scope's own version is refused by name. Taking another shop's version is ADOPT's job
    -- (adopted_from, the link and its notices); the global default restores only from global history.
    if p_restored_from is not null and v_source.location_id is not null and v_source.location_id is distinct from p_location then
      raise exception 'recipe_version:restore_source_out_of_scope' using errcode = 'P0001';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
             'keep_id', null, 'component_sku_id', l.component_sku_id, 'component_item_id', l.component_item_id,
             'component_product_id', l.component_product_id, 'quantity', l.quantity, 'unit', l.unit,
             'each_container_label', l.each_container_label, 'portioned', l.portioned) order by l.display_order, l.id), '[]'::jsonb)
      into v_lines from public.recipe_version_lines l where l.version_id = v_source.id;
  else
    v_lines := p_lines;
  end if;

  if v_lines is null or jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 or jsonb_array_length(v_lines) > 200 then
    raise exception 'recipe_version:invalid_lines' using errcode = 'P0001';
  end if;
  v_count := jsonb_array_length(v_lines);
  for v_i in 0 .. v_count - 1 loop
    v_line := v_lines -> v_i;
    if coalesce(jsonb_typeof(v_line), '') <> 'object'
       or coalesce(jsonb_typeof(v_line -> 'quantity'), '') <> 'number'
       or (v_line ->> 'quantity')::numeric <= 0
       or ((nullif(v_line ->> 'component_sku_id', '') is not null)::int
         + (nullif(v_line ->> 'component_item_id', '') is not null)::int
         + (nullif(v_line ->> 'component_product_id', '') is not null)::int) <> 1
       or (nullif(v_line ->> 'component_sku_id', '') is null and nullif(btrim(coalesce(v_line ->> 'each_container_label', '')), '') is not null)
       or (nullif(v_line ->> 'component_item_id', '') is not null and coalesce((v_line ->> 'portioned')::boolean, false))
       or (nullif(v_line ->> 'component_product_id', '') is not null and nullif(btrim(coalesce(v_line ->> 'unit', '')), '') is null) then
      raise exception 'recipe_version:invalid_lines' using errcode = 'P0001';
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(v_lines) x where nullif(x ->> 'keep_id', '') is not null)
     <> (select count(distinct x ->> 'keep_id') from jsonb_array_elements(v_lines) x where nullif(x ->> 'keep_id', '') is not null) then
    raise exception 'recipe_version:invalid_lines' using errcode = 'P0001';
  end if;

  -- THE CLOSURE LOCKS, then THE DEPENDENCY SNAPSHOT re-taken under them (7a; Astra 3a r2#1–#3): everything the
  -- preview's numbers were computed from is exactly as it was, and nothing in it can change until COMMIT.
  perform public.recipe_change_lock(p_recipe, p_location, v_lines);
  if p_snapshot is null or public.recipe_change_snapshot(p_recipe, p_location, v_lines) is distinct from p_snapshot then
    raise exception 'recipe_version:dependencies_changed' using errcode = 'P0001';
  end if;

  -- THE PRODUCT RULE (lib/recipes.ts assertProductLineIsValid; lead decision (b)): a save may not ADD or CREATE a
  -- product line that is not an ACTIVE product measured in an ACTIVE measure-registry unit.
  --   · A COPIED set (restore / adopt / promote) carries nothing: every broken line in it is an addition (Astra r3#3).
  --   · An edit may keep a broken line the set this scope resolves now ALREADY holds — counted by IDENTITY AND
  --     MULTIPLICITY (same product, quantity, unit): the k-th identical broken line stays only if the current set
  --     holds at least k of them, so one existing broken line never licenses two.
  -- The refusal names the line: 'recipe_version:product_line_invalid:<position>' (1-based, in the set written).
  v_copy := coalesce(p_restored_from, p_adopted_from, p_promoted_from) is not null;
  for v_i in 0 .. v_count - 1 loop
    v_line := v_lines -> v_i;
    if nullif(v_line ->> 'component_product_id', '') is not null
       and (not exists (select 1 from public.products p
                         where p.id = (v_line ->> 'component_product_id')::uuid and coalesce(p.active, true))
         or not exists (select 1 from public.measure_units m
                         where m.label = btrim(v_line ->> 'unit') and m.active)) then
      if v_copy then
        raise exception 'recipe_version:product_line_invalid:%', v_i + 1 using errcode = 'P0001';
      end if;
      select count(*) into v_seen
        from jsonb_array_elements(v_lines) with ordinality as x(value, ord)
       where x.ord <= v_i + 1
         and nullif(x.value ->> 'component_product_id', '') = v_line ->> 'component_product_id'
         and (x.value ->> 'quantity')::numeric = (v_line ->> 'quantity')::numeric
         and nullif(btrim(coalesce(x.value ->> 'unit', '')), '') is not distinct from nullif(btrim(coalesce(v_line ->> 'unit', '')), '');
      select count(*) into v_have
        from (select ri.component_product_id, ri.quantity, ri.unit
                from public.recipe_inputs ri
               where ri.recipe_id = p_recipe
                 and not exists (select 1 from public.recipe_versions sv
                                  where sv.recipe_id = p_recipe and sv.location_id = p_location and sv.active)
              union all
              select l.component_product_id, l.quantity, l.unit
                from public.recipe_version_lines l
                join public.recipe_versions sv on sv.id = l.version_id
               where sv.recipe_id = p_recipe and sv.location_id = p_location and sv.active) cur
       where cur.component_product_id = (v_line ->> 'component_product_id')::uuid
         and cur.quantity = (v_line ->> 'quantity')::numeric
         and cur.unit is not distinct from nullif(btrim(coalesce(v_line ->> 'unit', '')), '');
      if v_seen > v_have then
        raise exception 'recipe_version:product_line_invalid:%', v_i + 1 using errcode = 'P0001';
      end if;
    end if;
  end loop;

  -- OPTIMISTIC: the version the caller saw — this shop's live version, or the global head.
  select id into v_global from public.recipe_versions where recipe_id = p_recipe and location_id is null and active for update;
  if p_location is null then
    v_live := v_global;
  else
    select id into v_live from public.recipe_versions where recipe_id = p_recipe and location_id = p_location and active for update;
  end if;
  if v_live is distinct from p_expected then
    raise exception 'recipe_version:version_changed' using errcode = 'P0001';
  end if;
  -- A shop FORKING the default (restore or edit) must have forked the CURRENT default.
  if p_location is not null and v_live is null and p_adopted_from is null and p_based_on is distinct from v_global then
    raise exception 'recipe_version:version_changed' using errcode = 'P0001';
  end if;

  -- THE CYCLE LAW in every graph this save changes.
  v_items := array(select nullif(x ->> 'component_item_id', '')::uuid from jsonb_array_elements(v_lines) x
                    where nullif(x ->> 'component_item_id', '') is not null);
  if public.recipe_lines_would_cycle(p_location, p_recipe, v_items, v_items) then
    raise exception 'recipe_version:would_create_cycle' using errcode = 'P0001';
  end if;
  if p_location is null and exists (
       select 1 from public.locations l
        where l.active
          and not exists (select 1 from public.recipe_versions v where v.recipe_id = p_recipe and v.location_id = l.id and v.active)
          and public.recipe_lines_would_cycle(l.id, p_recipe, v_items, v_items)) then
    raise exception 'recipe_version:would_create_cycle' using errcode = 'P0001';
  end if;

  v_now := clock_timestamp();
  if p_location is not null then
    -- A SHOP: close its live version (if any) and open the new one with the full set.
    -- PROVENANCE FOLLOWS THE CONTENT (lead decisions, Astra 3a r5#1 / r6): an adopt sets it; an EDIT of an adopted
    -- version keeps it (the shop still hears when that source changes — "you've changed your copy since adopting it");
    -- a RESTORE takes the restored version's pointer — kept for a version of the adopted lineage, ENDED for one from
    -- before the adoption or from global history (no pointer), like Back to default.
    v_new_adopted := case when p_adopted_from is not null then p_adopted_from
                          when p_restored_from is not null then (select rv.adopted_from_version_id from public.recipe_versions rv where rv.id = p_restored_from)
                          else (select rv.adopted_from_version_id from public.recipe_versions rv where rv.id = v_live) end;
    -- ITS END IS RECORDED, in this transaction, from the row being replaced (Astra r7): History reads the column.
    v_ended := case when v_live is not null and v_new_adopted is null
                     and (select rv.adopted_from_version_id from public.recipe_versions rv where rv.id = v_live) is not null
                    then v_live end;
    if v_live is not null then
      update public.recipe_versions set active = false, valid_to = greatest(v_now, valid_from), retired_by = p_actor where id = v_live and active;
    end if;
    insert into public.recipe_versions (id, recipe_id, location_id, based_on_version_id, adopted_from_version_id,
                                        adoption_ended_from_version_id, active, valid_from, note, created_at, created_by)
    values (v_new, p_recipe, p_location, coalesce(p_restored_from, p_adopted_from, v_live, p_based_on), v_new_adopted,
            v_ended, true, v_now, nullif(btrim(coalesce(p_note, '')), ''), v_now, p_actor);
    insert into public.recipe_version_lines (version_id, recipe_id, location_id, component_sku_id, component_item_id,
      component_product_id, quantity, unit, each_container_label, portioned, display_order, source_line_id)
    select v_new, p_recipe, p_location,
           nullif(t.value ->> 'component_sku_id', '')::uuid, nullif(t.value ->> 'component_item_id', '')::uuid,
           nullif(t.value ->> 'component_product_id', '')::uuid, (t.value ->> 'quantity')::numeric,
           nullif(btrim(coalesce(t.value ->> 'unit', '')), ''), nullif(btrim(coalesce(t.value ->> 'each_container_label', '')), ''),
           coalesce((t.value ->> 'portioned')::boolean, false), (t.ord - 1)::int, nullif(t.value ->> 'keep_id', '')::uuid
      from jsonb_array_elements(v_lines) with ordinality as t(value, ord);
    get diagnostics v_written = row_count;
    if v_written <> v_count then
      raise exception 'recipe_version:readback_failed' using errcode = 'P0001';
    end if;
    return jsonb_build_object('version_id', v_new, 'retired_version_id', v_live, 'scope', 'shop',
                              'valid_from', v_now, 'line_count', v_count, 'changed_shops', jsonb_build_array(p_location));
  end if;

  -- THE GLOBAL DEFAULT: the set goes into recipe_inputs with the least churn (kept lines updated in place,
  -- the rest inserted / deleted), then it is journaled as THIS actor's version in this transaction.
  perform set_config('app.recipe_journal_actor', coalesce(p_actor::text, ''), true);
  delete from public.recipe_inputs ri
   where ri.recipe_id = p_recipe
     and not exists (select 1 from jsonb_array_elements(v_lines) x where nullif(x ->> 'keep_id', '')::uuid = ri.id);
  update public.recipe_inputs ri
     set component_sku_id     = nullif(t.value ->> 'component_sku_id', '')::uuid,
         component_item_id    = nullif(t.value ->> 'component_item_id', '')::uuid,
         component_product_id = nullif(t.value ->> 'component_product_id', '')::uuid,
         quantity             = (t.value ->> 'quantity')::numeric,
         unit                 = nullif(btrim(coalesce(t.value ->> 'unit', '')), ''),
         each_container_label = nullif(btrim(coalesce(t.value ->> 'each_container_label', '')), ''),
         portioned            = coalesce((t.value ->> 'portioned')::boolean, false),
         display_order        = (t.ord - 1)::int
    from jsonb_array_elements(v_lines) with ordinality as t(value, ord)
   where ri.recipe_id = p_recipe
     and ri.id = nullif(t.value ->> 'keep_id', '')::uuid
     and (ri.component_sku_id is distinct from nullif(t.value ->> 'component_sku_id', '')::uuid
       or ri.component_item_id is distinct from nullif(t.value ->> 'component_item_id', '')::uuid
       or ri.component_product_id is distinct from nullif(t.value ->> 'component_product_id', '')::uuid
       or ri.quantity is distinct from (t.value ->> 'quantity')::numeric
       or ri.unit is distinct from nullif(btrim(coalesce(t.value ->> 'unit', '')), '')
       or ri.each_container_label is distinct from nullif(btrim(coalesce(t.value ->> 'each_container_label', '')), '')
       or ri.portioned is distinct from coalesce((t.value ->> 'portioned')::boolean, false)
       or ri.display_order is distinct from (t.ord - 1)::int);
  insert into public.recipe_inputs (recipe_id, component_sku_id, component_item_id, component_product_id, quantity, unit,
                                    each_container_label, portioned, display_order, created_by)
  select p_recipe,
         nullif(t.value ->> 'component_sku_id', '')::uuid, nullif(t.value ->> 'component_item_id', '')::uuid,
         nullif(t.value ->> 'component_product_id', '')::uuid, (t.value ->> 'quantity')::numeric,
         nullif(btrim(coalesce(t.value ->> 'unit', '')), ''), nullif(btrim(coalesce(t.value ->> 'each_container_label', '')), ''),
         coalesce((t.value ->> 'portioned')::boolean, false), (t.ord - 1)::int, p_actor
    from jsonb_array_elements(v_lines) with ordinality as t(value, ord)
   where not exists (select 1 from public.recipe_inputs ri
                      where ri.recipe_id = p_recipe and ri.id = nullif(t.value ->> 'keep_id', '')::uuid);
  v_new := public.recipe_global_journal(p_recipe, p_actor, p_promoted_from,
             coalesce(nullif(btrim(coalesce(p_note, '')), ''), case when p_restored_from is not null then 'restored' end));
  -- The shops whose food changes: every active shop riding the default NOW — taken before a promote returns
  -- its source shop to the default (that shop's food does not change: the new default IS its lines).
  v_changed := coalesce((select jsonb_agg(l.id order by l.id) from public.locations l
                          where l.active and not exists (select 1 from public.recipe_versions v
                                                          where v.recipe_id = p_recipe and v.location_id = l.id and v.active)),
                        '[]'::jsonb);
  -- PROMOTE RETURNS THE SOURCE SHOP TO THE DEFAULT (lead decision 5), in this same transaction: its version is
  -- retired (kept in history), closing at the instant the new default opens, so no instant has two answers
  -- and none has none. Its lines equal the new default's, so its graph — and the cycle law there — is unchanged.
  if p_promoted_from is not null then
    -- If the promoted version carried an ADOPTION pointer, its closing ends that link — recorded on the retired row
    -- (review P2-3, the retire_recipe_version rule; never over an earlier record), so History shows the link ending.
    update public.recipe_versions
       set active = false,
           valid_to = greatest((select valid_from from public.recipe_versions where id = v_new), valid_from),
           retired_by = p_actor,
           adoption_ended_from_version_id = coalesce(adoption_ended_from_version_id,
                                                     case when adopted_from_version_id is not null then id end)
     where id = p_promoted_from and active;
    get diagnostics v_written = row_count;
    if v_written <> 1 then
      raise exception 'recipe_version:invalid_source' using errcode = 'P0001';
    end if;
  end if;
  return jsonb_build_object(
    'version_id', v_new, 'retired_version_id', v_global, 'scope', 'global',
    'valid_from', (select valid_from from public.recipe_versions where id = v_new), 'line_count', v_count,
    'changed_shops', v_changed,
    'returned_shop', case when p_promoted_from is not null then v_source.location_id end,
    'returned_version_id', p_promoted_from);
end;
$$;

create or replace function public.retire_recipe_version(p_version uuid, p_location uuid, p_actor uuid, p_snapshot jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_recipe  uuid;
  v_row     public.recipe_versions%rowtype;
  v_items   uuid[];
  v_now     timestamptz;
  v_default jsonb;
begin
  select recipe_id into v_recipe from public.recipe_versions where id = p_version;
  if not found then
    raise exception 'recipe_version:not_found' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(7258025800);
  perform 1 from public.recipes where id = v_recipe for no key update;
  -- The closure locks, then the snapshot under them (7a). Back to default puts the DEFAULT's lines into this shop's
  -- graph: they are the line set of this change (the preview passes the same lines), so their dependencies are in it.
  v_default := coalesce((select jsonb_agg(jsonb_build_object('component_sku_id', ri.component_sku_id, 'component_item_id', ri.component_item_id,
                                                             'component_product_id', ri.component_product_id, 'unit', ri.unit) order by ri.id)
                           from public.recipe_inputs ri where ri.recipe_id = v_recipe), '[]'::jsonb);
  perform public.recipe_change_lock(v_recipe, p_location, v_default);
  if p_snapshot is null or public.recipe_change_snapshot(v_recipe, p_location, v_default) is distinct from p_snapshot then
    raise exception 'recipe_version:dependencies_changed' using errcode = 'P0001';
  end if;
  select * into v_row from public.recipe_versions where id = p_version for update;
  if v_row.location_id is null then
    raise exception 'recipe_version:global_cannot_retire' using errcode = 'P0001';
  end if;
  if v_row.location_id is distinct from p_location then
    raise exception 'recipe_version:not_found' using errcode = 'P0001';
  end if;
  if not v_row.active then
    raise exception 'recipe_version:not_live' using errcode = 'P0001';
  end if;
  -- Back to default puts the GLOBAL lines into this shop's graph: refuse if that closes a loop there.
  v_items := array(select ri.component_item_id from public.recipe_inputs ri
                    where ri.recipe_id = v_recipe and ri.component_item_id is not null);
  if public.recipe_lines_would_cycle(p_location, v_recipe, v_items, v_items) then
    raise exception 'recipe_version:would_create_cycle' using errcode = 'P0001';
  end if;
  v_now := greatest(clock_timestamp(), v_row.valid_from);
  -- Back to default ends an adoption link, recorded on the retired row itself (Astra r7) — ONLY when THIS operation
  -- ends one, and never over an earlier record: a row that already says "link ended" (a restore from before the
  -- adoption) keeps it (Astra r8). History is append-only; nothing here nulls a history column. Only a LIVE row closes.
  update public.recipe_versions
     set active = false, valid_to = v_now, retired_by = p_actor,
         adoption_ended_from_version_id = coalesce(adoption_ended_from_version_id,
                                                   case when v_row.adopted_from_version_id is not null then p_version end)
   where id = p_version and active;
  return jsonb_build_object('version_id', p_version, 'recipe_id', v_recipe, 'location_id', p_location, 'valid_to', v_now);
end;
$$;

create or replace function public.remove_recipe_input_atomic(p_input_id uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_before jsonb;
begin
  -- The recipe-graph write lock FIRST (lib/recipe-graph-shared.ts RECIPE_GRAPH_LOCK_KEY): this delete's
  -- commit-time journal takes it too, so the order never inverts against another graph writer.
  perform pg_advisory_xact_lock(7258025800);
  perform set_config('app.recipe_journal_actor', coalesce(p_actor::text, ''), true);
  delete from public.recipe_inputs ri where ri.id = p_input_id returning to_jsonb(ri) into v_before;
  if v_before is null then
    raise exception 'edge_not_found' using errcode = 'P0001';
  end if;
  return v_before;
end;
$$;

-- ── (8) the four 0258 graph writers, re-emitted (generated; see the header) ───
-- >>> REEMIT add_recipe_input_atomic (generated by scripts/recipe-versions/emit-0262-reemits.ts — do not hand-edit)
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
  -- 0262: who wrote these lines, for the global recipe journal (recipe_global_journal reads it at commit).
  perform set_config('app.recipe_journal_actor', coalesce(p_created_by::text, ''), true);

  if not exists (select 1 from public.recipes where id = p_recipe_id) then
    raise exception 'recipe_not_found' using errcode = 'P0001';
  end if;

  if p_component_item_id is not null
     and public.recipe_input_would_cycle(p_recipe_id, p_component_item_id, null) then
    raise exception 'would_create_cycle' using errcode = 'P0001';
  end if;
  -- 0262: the same refusal in every ACTIVE SHOP that resolves this recipe through the global lines.
  if p_component_item_id is not null
     and public.recipe_shops_input_would_cycle(p_recipe_id, p_component_item_id, null) then
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
-- <<< REEMIT add_recipe_input_atomic
-- >>> REEMIT update_recipe_input_atomic (generated by scripts/recipe-versions/emit-0262-reemits.ts — do not hand-edit)
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
  -- 0262: the same refusal in every ACTIVE SHOP that resolves this recipe through the global lines.
  if p_component_item_id is not null
     and public.recipe_shops_input_would_cycle(p_recipe_id, p_component_item_id, p_input_id) then
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
-- <<< REEMIT update_recipe_input_atomic
-- >>> REEMIT update_recipe_input_atomic_actor (generated by scripts/recipe-versions/emit-0262-reemits.ts — do not hand-edit)
create or replace function public.update_recipe_input_atomic( -- 0262 overload: + p_actor (journal authorship)
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
  p_expected_portioned boolean,
  p_actor uuid
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
  -- 0262: who wrote these lines, for the global recipe journal (recipe_global_journal reads it at commit).
  perform set_config('app.recipe_journal_actor', coalesce(p_actor::text, ''), true);

  if p_component_item_id is not null
     and public.recipe_input_would_cycle(p_recipe_id, p_component_item_id, p_input_id) then
    raise exception 'would_create_cycle' using errcode = 'P0001';
  end if;
  -- 0262: the same refusal in every ACTIVE SHOP that resolves this recipe through the global lines.
  if p_component_item_id is not null
     and public.recipe_shops_input_would_cycle(p_recipe_id, p_component_item_id, p_input_id) then
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
-- <<< REEMIT update_recipe_input_atomic_actor
-- >>> REEMIT create_recipe_full (generated by scripts/recipe-versions/emit-0262-reemits.ts — do not hand-edit)
create or replace function create_recipe_full(
  p_header jsonb, p_inputs jsonb, p_outputs jsonb, p_created_by uuid
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_recipe_id uuid; r jsonb; v_item_id uuid; v_clash uuid;
begin
  -- 0258 (Astra r2 #1): the recipe-graph write lock FIRST, so this output write serialises with
  -- every recipe-line write and every other output write (lib/recipe-graph-shared.ts).
  perform pg_advisory_xact_lock(7258025800);
  -- 0262: who wrote these lines, for the global recipe journal (recipe_global_journal reads it at commit).
  perform set_config('app.recipe_journal_actor', coalesce(p_created_by::text, ''), true);
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

  -- 0262: the same refusal in every ACTIVE SHOP's graph (outputs are global; shop recipe lines differ).
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_outputs,'[]'::jsonb)) as t(value)
    where nullif(value->>'output_item_id','') is not null
      and public.recipe_shops_output_would_cycle(v_recipe_id, nullif(value->>'output_item_id','')::uuid)
  ) then
    raise exception 'would_create_cycle' using errcode = 'P0001';
  end if;

  return v_recipe_id;
end $$;
-- <<< REEMIT create_recipe_full
-- >>> REEMIT add_recipe_output (generated by scripts/recipe-versions/emit-0262-reemits.ts — do not hand-edit)
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
  -- 0262: and in every ACTIVE SHOP's graph (outputs are global; shop recipe lines differ).
  if p_output_item_id is not null and public.recipe_shops_output_would_cycle(p_recipe_id, p_output_item_id) then
    raise exception 'would_create_cycle' using errcode = 'P0001';
  end if;

  select coalesce(max(display_order), 0) + 1 into v_order
  from recipe_outputs where recipe_id = p_recipe_id;

  insert into recipe_outputs (recipe_id, output_item_id, output_menu_item_id, yield, output_container_label, display_order, created_by)
  values (p_recipe_id, p_output_item_id, p_output_menu_item_id, p_yield, nullif(p_output_container_label,''), v_order, p_created_by)
  returning id into v_id;

  return v_id;
end $$;
-- <<< REEMIT add_recipe_output

-- ── (9) posture: deny-all tables with a service_role ceiling; service-role writers ──
alter table public.recipe_versions enable row level security;
create policy recipe_versions_no_user_select on public.recipe_versions for select using (false);
create policy recipe_versions_no_user_insert on public.recipe_versions for insert with check (false);
create policy recipe_versions_no_user_update on public.recipe_versions for update using (false);
create policy recipe_versions_no_user_delete on public.recipe_versions for delete using (false);
revoke all on public.recipe_versions from public, anon, authenticated, service_role;
grant select, insert, update on public.recipe_versions to service_role;

alter table public.recipe_version_lines enable row level security;
create policy recipe_version_lines_no_user_select on public.recipe_version_lines for select using (false);
create policy recipe_version_lines_no_user_insert on public.recipe_version_lines for insert with check (false);
create policy recipe_version_lines_no_user_update on public.recipe_version_lines for update using (false);
create policy recipe_version_lines_no_user_delete on public.recipe_version_lines for delete using (false);
revoke all on public.recipe_version_lines from public, anon, authenticated, service_role;
grant select, insert on public.recipe_version_lines to service_role;

alter table public.recipe_notice_dismissals enable row level security;
create policy recipe_notice_dismissals_no_user_select on public.recipe_notice_dismissals for select using (false);
create policy recipe_notice_dismissals_no_user_insert on public.recipe_notice_dismissals for insert with check (false);
create policy recipe_notice_dismissals_no_user_update on public.recipe_notice_dismissals for update using (false);
create policy recipe_notice_dismissals_no_user_delete on public.recipe_notice_dismissals for delete using (false);
revoke all on public.recipe_notice_dismissals from public, anon, authenticated, service_role;
grant select, insert on public.recipe_notice_dismissals to service_role;

-- The helpers run only inside the definer writers and the triggers: nobody calls them directly.
revoke all on function public.recipe_journal_lines_equal(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.recipe_global_journal(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.recipe_inputs_journal_trg() from public, anon, authenticated, service_role;
revoke all on function public.recipes_journal_trg() from public, anon, authenticated, service_role;
revoke all on function public.recipe_journal_refuse_truncate() from public, anon, authenticated, service_role;
revoke all on function public.recipe_scope_item_edges(uuid) from public, anon, authenticated, service_role;
revoke all on function public.recipe_lines_would_cycle(uuid, uuid, uuid[], uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.recipe_shops_input_would_cycle(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.recipe_shops_output_would_cycle(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.recipe_scope_lines(uuid) from public, anon, authenticated, service_role;
revoke all on function public.recipe_change_closure(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.recipe_change_lock(uuid, uuid, jsonb) from public, anon, authenticated, service_role;

revoke all on function public.save_recipe_version(uuid, uuid, jsonb, uuid, uuid, text, uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.retire_recipe_version(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.remove_recipe_input_atomic(uuid, uuid) from public, anon, authenticated;
revoke all on function public.recipe_change_snapshot(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_recipe_version(uuid, uuid, jsonb, uuid, uuid, text, uuid, uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.retire_recipe_version(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.remove_recipe_input_atomic(uuid, uuid) to service_role;
grant execute on function public.recipe_change_snapshot(uuid, uuid, jsonb) to service_role;
-- The four re-emits keep 0258's grants exactly (CREATE OR REPLACE keeps them; restated as 0258 did).
revoke all on function public.add_recipe_input_atomic(uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.add_recipe_input_atomic(uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid) to service_role;
revoke all on function public.update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean) from public, anon, authenticated;
grant execute on function public.update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean) to service_role;
-- The authorship overload (+ p_actor): the SAME ceiling — service_role only. The 16-argument writer above is dropped by
-- the first Phase 4 migration (only code deployed before 3a calls it).
revoke all on function public.update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.update_recipe_input_atomic(uuid, uuid, uuid, uuid, uuid, numeric, text, text, boolean, uuid, uuid, uuid, numeric, text, text, boolean, uuid) to service_role;
revoke execute on function create_recipe_full(jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function create_recipe_full(jsonb, jsonb, jsonb, uuid) to service_role;
revoke execute on function add_recipe_output(uuid, uuid, uuid, numeric, text, uuid) from public, anon, authenticated;
grant execute on function add_recipe_output(uuid, uuid, uuid, numeric, text, uuid) to service_role;

do $$
declare
  t text;
  v_need text[];
  p text;
begin
  if exists (select 1 from information_schema.routine_privileges
              where routine_schema = 'public'
                and routine_name in ('save_recipe_version', 'retire_recipe_version', 'remove_recipe_input_atomic',
                                     'add_recipe_input_atomic', 'update_recipe_input_atomic', 'create_recipe_full', 'add_recipe_output',
                                     'recipe_journal_lines_equal', 'recipe_global_journal', 'recipe_inputs_journal_trg', 'recipes_journal_trg',
                                     'recipe_journal_refuse_truncate',
                                     'recipe_scope_item_edges', 'recipe_lines_would_cycle', 'recipe_shops_input_would_cycle',
                                     'recipe_shops_output_would_cycle', 'recipe_change_snapshot', 'recipe_scope_lines',
                                     'recipe_change_closure', 'recipe_change_lock')
                and grantee in ('PUBLIC', 'anon', 'authenticated') and privilege_type = 'EXECUTE') then
    raise exception '0262: unexpected execute grant';
  end if;
  if exists (select 1 from information_schema.routine_privileges
              where routine_schema = 'public'
                and routine_name in ('recipe_journal_lines_equal', 'recipe_global_journal', 'recipe_inputs_journal_trg', 'recipes_journal_trg',
                                     'recipe_scope_item_edges', 'recipe_lines_would_cycle', 'recipe_shops_input_would_cycle',
                                     'recipe_shops_output_would_cycle', 'recipe_scope_lines', 'recipe_change_closure',
                                     'recipe_change_lock', 'recipe_journal_refuse_truncate')
                and grantee = 'service_role' and privilege_type = 'EXECUTE') then
    raise exception '0262: unexpected execute grant';
  end if;
  foreach t in array array['recipe_versions', 'recipe_version_lines', 'recipe_notice_dismissals'] loop
    if exists (select 1 from information_schema.role_table_grants
                where table_schema = 'public' and table_name = t and grantee in ('PUBLIC', 'anon', 'authenticated')) then
      raise exception '0262: unexpected table grant on %', t;
    end if;
    if has_table_privilege('service_role', 'public.' || t, 'DELETE')
       or has_table_privilege('service_role', 'public.' || t, 'TRUNCATE')
       or has_table_privilege('service_role', 'public.' || t, 'REFERENCES')
       or has_table_privilege('service_role', 'public.' || t, 'TRIGGER')
       or (t <> 'recipe_versions' and has_table_privilege('service_role', 'public.' || t, 'UPDATE')) then
      raise exception '0262: service_role above its ceiling';
    end if;
    v_need := case when t = 'recipe_versions' then array['SELECT', 'INSERT', 'UPDATE'] else array['SELECT', 'INSERT'] end;
    foreach p in array v_need loop
      if not has_table_privilege('service_role', 'public.' || t, p) then
        raise exception '0262: service_role is missing a privilege the writers need';
      end if;
    end loop;
  end loop;
end $$;

-- The same ceiling, spelled per table (the audit trail a reviewer reads, and the literal the pin checks).
do $$ begin
  if has_table_privilege('service_role', 'public.recipe_versions', 'DELETE')
     or has_table_privilege('service_role', 'public.recipe_version_lines', 'DELETE')
     or has_table_privilege('service_role', 'public.recipe_version_lines', 'UPDATE')
     or has_table_privilege('service_role', 'public.recipe_notice_dismissals', 'DELETE')
     or has_table_privilege('service_role', 'public.recipe_notice_dismissals', 'UPDATE') then
    raise exception '0262: service_role above its ceiling';
  end if;
end $$;

commit;
