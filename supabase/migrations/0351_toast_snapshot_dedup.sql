-- Migration 0351_toast_snapshot_dedup
-- AUTHORED 2026-11-19 (Toast duplicate cleanup PR 2, CO Claude). NOT YET APPLIED -- GATE CC/JUAN: sim first (with the sim two-session proof), then prod on Juan's word, in the quiet window (04:00-08:45 UTC). Apply AFTER 0347.
-- NUMBER: 0347 is the highest on main; 0348-0350 are claimed by open PRs (#606 / #607 / #608), so this file takes 0351.
-- It does not depend on them and they do not depend on it (any order).
-- Plan: CHIEF 03-PROJECTS/co-ops/2026-11-15-juan-product-notes/toast-churn-cleanup-plan-r4.md (r3 + r2 section 4 before it).
-- PR 1 of this work (#578 canonical content hash, #584) stopped NEW duplicates. This file is the tooling that removes
-- the OLD ones. Juan approved deleting exact duplicates (2026-11-16).
--
-- THIS FILE DELETES NOTHING. It installs:
--   toast_snapshot_registry            one row per Toast snapshot EVER created: id (= the original toast_orders.id),
--                                      shop, order guid, business date, the original content_hash, modified_at. Never
--                                      deleted. A snapshot whose payload was removed keeps its row, stamped with when,
--                                      which surviving snapshot holds the same content, and which manifest did it.
--   toast_orders_register              AFTER INSERT trigger on toast_orders: every new snapshot gets its registry row
--                                      in the writer's own transaction. The 0239 page writer is NOT re-emitted.
--   the membership FK swap             toast_capture_run_orders (snapshot_id, location_id, business_date) now references
--                                      the REGISTRY, not toast_orders. No membership row is touched, ever: both app
--                                      readers refuse a day whose membership count differs from runs.orders
--                                      (lib/toast/captured-day.ts, captured-window.ts).
--   toast_snapshot_content(id)         a snapshot's stored content as one jsonb: PR 1's equivalence, text for text
--                                      (scripts/toast-hash-acceptance.sql, CC ruling 2026-11-17).
--   the manifest                       toast_snapshot_dedup_manifests / _days / _items / _batches / _retained / _runs,
--                                      written only by the functions below.
--   toast_snapshot_dedup_begin / _build_range / _finish / _apply / _verify / _abandon
--                                      build a manifest of exact duplicates, delete it batch by batch, check the result.
--
-- WHAT A DUPLICATE IS. Two snapshots of one (shop, order guid, business date) whose stored content is EQUAL after
-- ignoring only storage identity (toast_orders.id, content_hash, every child's snapshot_id), array order
-- (selection_units and each child table's rows, as multisets: duplicates kept) and the synthetic ordinals of discounts
-- and service charges. Every other stored column is content, and a column added later is content automatically
-- (to_jsonb of the row). The canonical hash is NOT used to decide this. Two snapshots that share modified_at but
-- differ in content (the 2025-10 .. 2026-09 enrichment pairs; a payment AUTHORIZED -> CAPTURED) are not duplicates
-- and are never listed.
--
-- WHAT IS NEVER DELETED (class R, "retained").
--   * every latest-pointer target and every ezcater_toast_links.toast_snapshot_id (current or retired): both keep
--     their FOREIGN KEYS to toast_orders, so the database refuses such a delete whatever the manifest says;
--   * every snapshot id found in ANY uuid column of a public base table whose name contains "snapshot"
--     (toast_snapshot_reference_ids, discovered from the catalog at call time, so a column a later migration adds is
--     covered without re-emitting this file; today: catering_toast_links / catering_toast_conflicts.toast_snapshot_id,
--     fact_order_snapshot / fact_order_check / fact_refund.snapshot_id; the ezCater tables' own snapshot_id columns hold
--     ezCater ids and never match). The payload's own children and the memberships are the only exclusions;
--   * every snapshot id written anywhere in a jsonb column of audit_log or of a toast_ / ezcater_ / catering_toast_ /
--     fact_ table (toast_snapshot_evidence_ids, also discovered from the catalog; the payload's own jsonb excluded);
--   * the SURVIVOR of each class: the registry row of a deleted snapshot holds a FOREIGN KEY to its survivor in
--     toast_orders, so a survivor can never be deleted later; a later manifest never lists one (class R), and the
--     apply refuses candidate_now_survivor.
-- A REFERENCE NOT YET COMMITTED (plan r5, Astra r4 P1). Some writers persist a snapshot id with no FK
-- (decide_catering_toast 0347, fact_replace_order_day 0337). Each takes the id from the LATEST POINTER inside its own
-- transaction, so it can only name a snapshot that was a pointer target at some instant of that transaction. The apply
-- proves there is no such instant for any candidate: (1) candidate_order_recently_captured -- no run holding a
-- membership for a candidate's order started, finished or is running at or after the manifest's begun_at, and pointers
-- move only when such a run finishes, so the order has had ONE pointer target since begun_at and it is not the
-- candidate; (2) open_transaction_older_than_manifest / prepared_transaction_open -- every other transaction alive
-- at the apply began after begun_at. So build and apply belong to ONE quiet window; a capture of an old order in
-- between makes that batch refuse, and the manifest is abandoned and rebuilt.
-- KNOWN LIMIT: a snapshot id stored in a text column, or in a jsonb column of a table outside those name prefixes,
-- is not seen. None exists on main at e9e29073.
--
-- THE DELETE (toast_snapshot_dedup_apply) IS NOT AN APP PATH. Every function here is SECURITY DEFINER owned by the
-- migration role with EXECUTE revoked from public, anon, authenticated AND service_role. CC runs them as postgres from
-- the prepared script. Nothing in lib/ or app/ calls them (pinned by tests/toast-snapshot-dedup-migration.test.ts).
-- AGENTS.md purge law (0193): kept -- no app code path; a manifest whose digest and exact per-table counts the caller
-- must repeat, so a drifted database refuses by name; children before parents; an audit row with destructive = true and
-- actor_context = "migration_apply". Different on purpose -- the manifest is ROWS built from the live data under review
-- (205k ids that drift daily cannot be literals in a file; the literals are the digest and totals stamped into the
-- call), and the delete is one transaction PER BATCH with one audit row per transaction, because a single transaction
-- would hold the capture path's write lock for the whole delete. A batch size >= the item count makes it ONE
-- transaction and ONE audit row; CC chooses from the measured timing.
--
-- LOCKS OF THIS FILE (the apply script injects `set local lock_timeout`).
--   1. toast_orders SHARE ROW EXCLUSIVE, first. Every snapshot writer's first payload write is the toast_orders insert
--      in toast_capture_page (the modified sweep calls the same function), so from here no snapshot, child row or
--      membership can be written; a page transaction already past that insert is waited for. Reads go on.
--   2. the registry copy, the trigger (same lock), the functions and the ceilings.
--   3. the new membership FK: SHARE ROW EXCLUSIVE on toast_capture_run_orders (its writers are already held at 1).
--   4. LAST: dropping the 0221 membership FK takes ACCESS EXCLUSIVE on toast_capture_run_orders and toast_orders (the
--      RI triggers on both sides), held from there to COMMIT (only assertions follow). It is a lock upgrade: a
--      multi-statement transaction that read one of the two tables and is waiting for the other could form a cycle.
--      That cannot corrupt anything -- Postgres aborts one side after deadlock_timeout, or lock_timeout fires, and
--      this whole file rolls back -- and in the quiet window no capture, reconcile or fact job runs.
-- LOCKS OF THE APPLY: ONE table lock, toast_orders SHARE ROW EXCLUSIVE, taken first (plan r3 section 2, answering
-- Astra r2 P2 #3). No lock on runs, pointers, links or cursors, and no row lock on them (pinned). The cleanup holds
-- nothing a writer needs before its toast_orders insert, so there is no cycle; toast_modified_save (1 s lock_timeout)
-- fails and retries on its next sweep, as documented.
--
-- FACT LAYER (0337 gate G1): a fact day's fingerprint is its pointer set, its latest completed run (id, orders) and
-- the builder version. The apply refuses a pointer target by name, never touches a run or a membership, and the
-- pointer FK is the backstop, so no fingerprint input can change. tests/fact-layer-writer-census.test.ts lists the
-- five DELETE statements below as the only deletes of a source relation.
--
-- CEILINGS. The seven new tables: deny-all RLS (four _no_user_ policies each), no grant to public / anon /
-- authenticated, service_role SELECT only (DELETE, TRUNCATE, INSERT, UPDATE, REFERENCES, TRIGGER asserted absent).
begin;

-- 0. Pre-flight: refuse by name on anything unexpected.
do $$
declare v text;
begin
  foreach v in array array['toast_orders','toast_order_checks','toast_check_discounts','toast_check_service_charges',
      'toast_payments','toast_capture_runs','toast_capture_pages','toast_capture_run_orders','toast_order_latest_pointers',
      'ezcater_toast_links','audit_log'] loop
    if to_regclass('public.' || v) is null then raise exception '0351: missing table % (0221 / 0225)', v; end if;
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'toast_order_checks' and column_name = 'accounting')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'toast_payments' and column_name = 'sales_refund_cents') then
    raise exception '0351: missing 0239 accounting columns'; end if;
  if to_regclass('public.toast_snapshot_registry') is not null or to_regclass('public.toast_snapshot_dedup_manifests') is not null then
    raise exception '0351: already applied'; end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'audit_log'
        and column_name in ('actor_id','actor_role','action','resource_table','resource_id','metadata','destructive')) <> 7 then
    raise exception '0351: audit_log columns differ'; end if;
  if exists (select 1 from pg_trigger where tgrelid = 'public.toast_orders'::regclass and not tgisinternal) then
    raise exception '0351: unexpected trigger on toast_orders'; end if;
  if exists (select 1 from pg_class where oid in ('public.toast_orders'::regclass, 'public.toast_order_checks'::regclass,
        'public.toast_check_discounts'::regclass, 'public.toast_check_service_charges'::regclass, 'public.toast_payments'::regclass)
        and relforcerowsecurity) then
    raise exception '0351: forced row security on a payload table'; end if;
  -- The foreign keys that reference the payload are exactly the known ones (a new child table would hold content this
  -- file's equivalence does not read).
  select string_agg(conrelid::regclass::text, ',' order by conrelid::regclass::text collate "C") into v
    from pg_constraint where contype = 'f' and confrelid = 'public.toast_orders'::regclass;
  if v is distinct from 'ezcater_toast_links,toast_capture_run_orders,toast_order_checks,toast_order_latest_pointers' then
    raise exception '0351: snapshot_fk_census_changed (toast_orders: %)', v; end if;
  select string_agg(conrelid::regclass::text, ',' order by conrelid::regclass::text collate "C") into v
    from pg_constraint where contype = 'f' and confrelid = 'public.toast_order_checks'::regclass;
  if v is distinct from 'toast_check_discounts,toast_check_service_charges,toast_payments' then
    raise exception '0351: snapshot_fk_census_changed (toast_order_checks: %)', v; end if;
end $$;

-- 1. The one lock every snapshot writer must pass (see LOCKS above).
lock table public.toast_orders in share row exclusive mode;

-- 2. The manifest tables.
create table public.toast_snapshot_dedup_manifests (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique check (version > 0),
  cutoff_date date not null,
  status text not null default 'building' check (status in ('building','built','applying','applied','abandoned')),
  begun_at timestamptz not null default clock_timestamp(),
  built_at timestamptz,
  ended_at timestamptz,
  batch_size integer check (batch_size > 0),
  batches integer check (batches >= 0),
  applied_batches integer not null default 0 check (applied_batches >= 0),
  items bigint check (items >= 0),
  digest text check (digest ~ '^[0-9a-f]{64}$'),
  totals jsonb,
  registry_rows_at_begin bigint not null,
  memberships_at_begin bigint not null,
  -- Completed runs whose membership count already differed from runs.orders when the manifest began (0 on a healthy
  -- database). Verify compares against it, so a pre-existing mismatch is reported but is not blamed on the cleanup.
  completed_runs_wrong_at_begin bigint not null default 0,
  check ((status in ('building','abandoned')) or (digest is not null and batches is not null and items is not null and totals is not null))
);
-- One manifest in flight at a time: structural, not by convention.
create unique index toast_snapshot_dedup_manifests_one_active on public.toast_snapshot_dedup_manifests ((true))
  where status in ('building','built','applying');

create table public.toast_snapshot_registry (
  id uuid primary key,
  location_id uuid not null,
  order_guid text not null,
  business_date date not null,
  content_hash text not null,
  modified_at timestamptz,
  registered_at timestamptz not null default clock_timestamp(),
  payload_deleted_at timestamptz,
  survivor_id uuid,
  content_md5 text,
  manifest_id uuid references public.toast_snapshot_dedup_manifests(id),
  unique (id, location_id, business_date),
  check ((payload_deleted_at is null) = (survivor_id is null)),
  check ((payload_deleted_at is null) = (content_md5 is null)),
  check ((payload_deleted_at is null) = (manifest_id is null)),
  check (survivor_id is distinct from id),
  -- A survivor can never be deleted later: the database refuses it.
  foreign key (survivor_id, location_id, business_date) references public.toast_orders (id, location_id, business_date)
);
create index toast_snapshot_registry_survivor on public.toast_snapshot_registry (survivor_id) where survivor_id is not null;
create index toast_snapshot_registry_manifest on public.toast_snapshot_registry (manifest_id) where manifest_id is not null;
create index toast_snapshot_registry_location_date on public.toast_snapshot_registry (location_id, business_date);

create table public.toast_snapshot_dedup_days (
  manifest_id uuid not null references public.toast_snapshot_dedup_manifests(id),
  business_date date not null,
  snapshots bigint not null check (snapshots >= 0),
  items bigint not null check (items >= 0),
  primary key (manifest_id, business_date)
);
create table public.toast_snapshot_dedup_retained (
  manifest_id uuid not null references public.toast_snapshot_dedup_manifests(id),
  snapshot_id uuid not null,
  reason text not null,
  primary key (manifest_id, snapshot_id, reason)
);
-- The per-run membership baseline taken at begin (verify: no run ever has fewer; a run finished then has exactly this).
create table public.toast_snapshot_dedup_runs (
  manifest_id uuid not null references public.toast_snapshot_dedup_manifests(id),
  run_id uuid not null,
  memberships bigint not null check (memberships >= 0),
  finished boolean not null,
  primary key (manifest_id, run_id)
);
create table public.toast_snapshot_dedup_items (
  manifest_id uuid not null references public.toast_snapshot_dedup_manifests(id),
  snapshot_id uuid not null references public.toast_snapshot_registry(id),
  survivor_id uuid not null references public.toast_snapshot_registry(id),
  content_md5 text not null check (content_md5 ~ '^[0-9a-f]{32}$'),
  location_id uuid not null,
  business_date date not null,
  checks integer not null check (checks >= 0),
  discounts integer not null check (discounts >= 0),
  service_charges integer not null check (service_charges >= 0),
  payments integer not null check (payments >= 0),
  batch integer check (batch > 0),
  applied_at timestamptz,
  primary key (manifest_id, snapshot_id),
  check (survivor_id <> snapshot_id)
);
create index toast_snapshot_dedup_items_batch on public.toast_snapshot_dedup_items (manifest_id, batch);
create table public.toast_snapshot_dedup_batches (
  manifest_id uuid not null references public.toast_snapshot_dedup_manifests(id),
  batch integer not null check (batch > 0),
  snapshots integer not null check (snapshots > 0),
  checks bigint not null, discounts bigint not null, service_charges bigint not null, payments bigint not null,
  applied_at timestamptz,
  audit_id uuid,
  primary key (manifest_id, batch),
  check ((applied_at is null) = (audit_id is null))
);

-- 3. The registry: copy every snapshot, then register every new one in its writer's transaction.
insert into public.toast_snapshot_registry (id, location_id, order_guid, business_date, content_hash, modified_at)
select o.id, o.location_id, o.order_guid, o.business_date, o.content_hash, o.modified_at from public.toast_orders o;

create function public.toast_snapshot_register() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  insert into public.toast_snapshot_registry (id, location_id, order_guid, business_date, content_hash, modified_at)
  values (new.id, new.location_id, new.order_guid, new.business_date, new.content_hash, new.modified_at);
  return null;
end $$;
create trigger toast_orders_register after insert on public.toast_orders
  for each row execute function public.toast_snapshot_register();

-- 4. Stored content. The jsonb_build_object below is the "content" CTE of scripts/toast-hash-acceptance.sql, line for
-- line (pinned): one definition of "equal stored content" for the acceptance checks and for the cleanup.
create function public.toast_snapshot_content(p_id uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, public set timezone = 'UTC' as $$
  select jsonb_build_object(
    'order', to_jsonb(o) - 'id' - 'content_hash' - 'selection_units',
    'selection_units', (select coalesce(jsonb_agg(u order by u::text), '[]'::jsonb) from jsonb_array_elements(o.selection_units) u),
    'checks', (select coalesce(jsonb_agg(x order by x::text), '[]'::jsonb)
               from (select to_jsonb(c) - 'snapshot_id' as x from public.toast_order_checks c where c.snapshot_id = o.id) c),
    'discounts', (select coalesce(jsonb_agg(x order by x::text), '[]'::jsonb)
                  from (select to_jsonb(d) - 'snapshot_id' - 'ordinal' as x from public.toast_check_discounts d where d.snapshot_id = o.id) d),
    'service_charges', (select coalesce(jsonb_agg(x order by x::text), '[]'::jsonb)
                        from (select to_jsonb(s) - 'snapshot_id' - 'ordinal' as x from public.toast_check_service_charges s where s.snapshot_id = o.id) s),
    'payments', (select coalesce(jsonb_agg(x order by x::text), '[]'::jsonb)
                 from (select to_jsonb(p) - 'snapshot_id' as x from public.toast_payments p where p.snapshot_id = o.id) p)
  ) as content
  from public.toast_orders o
  where o.id = p_id
$$;
create function public.toast_snapshot_content_md5(p_id uuid) returns text
language sql stable security definer set search_path = pg_catalog, public set timezone = 'UTC' as $$
  select md5(public.toast_snapshot_content(p_id)::text)
$$;

-- 5. The two "who names a snapshot" reads. Both discover their columns from the catalog at call time.
-- Refuses when the payload's own foreign keys are not the known set.
create function public.toast_snapshot_dedup_census() returns void
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v text;
begin
  select string_agg(conrelid::regclass::text, ',' order by conrelid::regclass::text collate "C") into v
    from pg_constraint where contype = 'f' and confrelid = 'public.toast_orders'::regclass;
  if v is distinct from 'ezcater_toast_links,toast_order_checks,toast_order_latest_pointers,toast_snapshot_registry' then
    raise exception 'snapshot_fk_census_changed'; end if;
  select string_agg(conrelid::regclass::text, ',' order by conrelid::regclass::text collate "C") into v
    from pg_constraint where contype = 'f' and confrelid = 'public.toast_order_checks'::regclass;
  if v is distinct from 'toast_check_discounts,toast_check_service_charges,toast_payments' then
    raise exception 'snapshot_fk_census_changed'; end if;
end $$;

create function public.toast_snapshot_reference_ids() returns table (snapshot_id uuid, reason text)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_sql text;
begin
  select string_agg(format('select %I as snapshot_id, %L::text as reason from public.%I where %I is not null',
           c.column_name, c.table_name || '.' || c.column_name, c.table_name, c.column_name), ' union ' order by c.table_name, c.column_name)
    into v_sql
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
   where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.data_type = 'uuid'
     and c.column_name like '%snapshot%'
     -- The payload's own children, the memberships (kept whole on the registry) and this file's own tables.
     and c.table_name not in ('toast_order_checks','toast_check_discounts','toast_check_service_charges','toast_payments',
                              'toast_capture_run_orders','toast_snapshot_registry','toast_snapshot_dedup_items',
                              'toast_snapshot_dedup_retained');
  if v_sql is null or v_sql not like '%toast_order_latest_pointers%' or v_sql not like '%ezcater_toast_links%' then
    raise exception 'snapshot_reference_census_empty'; end if;
  -- A survivor of an earlier manifest is protected by the registry's FK; it is a reference like any other.
  return query execute v_sql || ' union select survivor_id, ''toast_snapshot_registry.survivor_id''::text'
    || ' from public.toast_snapshot_registry where survivor_id is not null';
end $$;

-- Snapshot ids written inside jsonb. p_since narrows audit_log only (append-only by law, rows are never updated);
-- every other column is read whole.
create function public.toast_snapshot_evidence_ids(p_since timestamptz) returns table (snapshot_id uuid, reason text)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_sql text;
begin
  select string_agg(format(
           'select (regexp_matches(%I::text, %L, ''gi''))[1]::uuid as snapshot_id, %L::text as reason from public.%I%s',
           c.column_name, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', c.table_name || '.' || c.column_name, c.table_name,
           case when c.table_name = 'audit_log' and p_since is not null
                then format(' where occurred_at is null or occurred_at >= %L::timestamptz', p_since) else '' end),
         ' union all ' order by c.table_name, c.column_name)
    into v_sql
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
   where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.data_type = 'jsonb'
     and (c.table_name = 'audit_log' or c.table_name ~ '^(toast|ezcater|catering_toast|fact)_')
     -- The payload's own jsonb, and this file's own tables.
     and c.table_name not in ('toast_orders','toast_order_checks') and c.table_name !~ '^toast_snapshot_';
  if v_sql is null or v_sql not like '%audit_log%' then raise exception 'snapshot_evidence_census_empty'; end if;
  return query execute 'select distinct e.snapshot_id, e.reason from (' || v_sql
    || ') e where exists (select 1 from public.toast_snapshot_registry g where g.id = e.snapshot_id)';
end $$;

-- 6. The manifest writers.
create function public.toast_snapshot_dedup_begin(p_version integer, p_cutoff date) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public set timezone = 'UTC' as $$
declare v_id uuid; v_evidence bigint;
begin
  if p_version is null or p_version < 1 or p_cutoff is null then raise exception 'invalid_request'; end if;
  -- At least four closed business days in every US time zone: days still being recaptured are left alone.
  if p_cutoff > (now() at time zone 'UTC')::date - 5 then raise exception 'cutoff_too_recent'; end if;
  perform public.toast_snapshot_dedup_census();
  if exists (select 1 from public.toast_snapshot_dedup_manifests where version = p_version) then raise exception 'manifest_version_exists'; end if;
  if exists (select 1 from public.toast_snapshot_dedup_manifests where status in ('building','built','applying')) then
    raise exception 'manifest_in_progress'; end if;
  insert into public.toast_snapshot_dedup_manifests (version, cutoff_date, registry_rows_at_begin, memberships_at_begin)
  values (p_version, p_cutoff, (select count(*) from public.toast_snapshot_registry), (select count(*) from public.toast_capture_run_orders))
  returning id into v_id;
  insert into public.toast_snapshot_dedup_runs (manifest_id, run_id, memberships, finished)
  select v_id, r.id, coalesce(c.n, 0), r.status <> 'running'
    from public.toast_capture_runs r
    left join (select ro.run_id, count(*) as n from public.toast_capture_run_orders ro group by ro.run_id) c on c.run_id = r.id;
  update public.toast_snapshot_dedup_manifests m
     set completed_runs_wrong_at_begin = (select count(*) from public.toast_snapshot_dedup_runs x join public.toast_capture_runs r on r.id = x.run_id
                                           where x.manifest_id = v_id and r.status = 'completed' and r.orders <> x.memberships)
   where m.id = v_id;
  insert into public.toast_snapshot_dedup_retained (manifest_id, snapshot_id, reason)
  select v_id, e.snapshot_id, e.reason from public.toast_snapshot_evidence_ids(null) e;
  get diagnostics v_evidence = row_count;
  return jsonb_build_object('manifest_id', v_id, 'version', p_version, 'cutoff_date', p_cutoff, 'evidence_rows', v_evidence);
end $$;

-- One call per range of business dates [p_from, p_to): a class lives inside one business date, so chunking is exact.
create function public.toast_snapshot_dedup_build_range(p_version integer, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public set timezone = 'UTC' as $$
declare m public.toast_snapshot_dedup_manifests%rowtype; v_items bigint; v_snapshots bigint;
begin
  select * into m from public.toast_snapshot_dedup_manifests where version = p_version for update;
  if not found then raise exception 'manifest_not_found'; end if;
  if m.status <> 'building' then raise exception 'manifest_not_building'; end if;
  if p_from is null or p_to is null or p_from >= p_to then raise exception 'invalid_range'; end if;
  if p_to - 1 > m.cutoff_date then raise exception 'range_past_cutoff'; end if;
  if exists (select 1 from public.toast_snapshot_dedup_days d where d.manifest_id = m.id and d.business_date >= p_from and d.business_date < p_to) then
    raise exception 'range_already_built'; end if;

  with d as materialized (
    select o.id, o.location_id, o.order_guid, o.business_date, public.toast_snapshot_content_md5(o.id) as md5
      from public.toast_orders o where o.business_date >= p_from and o.business_date < p_to
  ), multi as materialized (
    select x.* from (select d.*, count(*) over (partition by d.location_id, d.order_guid, d.business_date, d.md5) as n from d) x where x.n > 1
  ), refs as materialized (
    select r.snapshot_id, bool_or(r.reason = 'toast_order_latest_pointers.snapshot_id') as is_pointer
      from (select f.snapshot_id, f.reason from public.toast_snapshot_reference_ids() f
            union all
            select t.snapshot_id, t.reason from public.toast_snapshot_dedup_retained t where t.manifest_id = m.id) r
     where r.snapshot_id in (select id from multi)
     group by r.snapshot_id
  ), first_seen as materialized (
    select ro.snapshot_id, min(r.started_at) as first_seen
      from public.toast_capture_run_orders ro join public.toast_capture_runs r on r.id = ro.run_id
     where ro.snapshot_id in (select id from multi)
     group by ro.snapshot_id
  ), ranked as (
    -- The survivor: a retained member (the pointer target first), else the earliest first-seen member; ties by id.
    select k.id, k.location_id, k.business_date, k.md5, (r.snapshot_id is not null) as retained,
           first_value(k.id) over (partition by k.location_id, k.order_guid, k.business_date, k.md5
             order by coalesce(r.is_pointer, false) desc, (r.snapshot_id is not null) desc, f.first_seen asc nulls last, k.id asc) as survivor
      from multi k left join refs r on r.snapshot_id = k.id left join first_seen f on f.snapshot_id = k.id
  )
  insert into public.toast_snapshot_dedup_items (manifest_id, snapshot_id, survivor_id, content_md5, location_id, business_date,
                                                 checks, discounts, service_charges, payments)
  select m.id, k.id, k.survivor, k.md5, k.location_id, k.business_date,
         (select count(*) from public.toast_order_checks c where c.snapshot_id = k.id),
         (select count(*) from public.toast_check_discounts c where c.snapshot_id = k.id),
         (select count(*) from public.toast_check_service_charges c where c.snapshot_id = k.id),
         (select count(*) from public.toast_payments c where c.snapshot_id = k.id)
    from ranked k where not k.retained and k.id <> k.survivor;
  get diagnostics v_items = row_count;

  insert into public.toast_snapshot_dedup_days (manifest_id, business_date, snapshots, items)
  select m.id, g::date,
         (select count(*) from public.toast_orders o where o.business_date = g::date),
         (select count(*) from public.toast_snapshot_dedup_items i where i.manifest_id = m.id and i.business_date = g::date)
    from generate_series(p_from::timestamp, (p_to - 1)::timestamp, interval '1 day') g;
  select coalesce(sum(d.snapshots), 0) into v_snapshots from public.toast_snapshot_dedup_days d
   where d.manifest_id = m.id and d.business_date >= p_from and d.business_date < p_to;
  return jsonb_build_object('version', p_version, 'from', p_from, 'to', p_to, 'snapshots', v_snapshots, 'items', v_items);
end $$;

create function public.toast_snapshot_dedup_finish(p_version integer, p_batch_size integer) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public set timezone = 'UTC' as $$
declare m public.toast_snapshot_dedup_manifests%rowtype; v_items bigint; v_batches integer; v_digest text; v_totals jsonb;
begin
  select * into m from public.toast_snapshot_dedup_manifests where version = p_version for update;
  if not found then raise exception 'manifest_not_found'; end if;
  if m.status <> 'building' then raise exception 'manifest_not_building'; end if;
  if p_batch_size is null or p_batch_size < 1 then raise exception 'invalid_batch_size'; end if;
  -- Every business date up to the cutoff that has a snapshot was built.
  if exists (select 1 from public.toast_orders o where o.business_date <= m.cutoff_date
               and not exists (select 1 from public.toast_snapshot_dedup_days d where d.manifest_id = m.id and d.business_date = o.business_date)) then
    raise exception 'build_incomplete'; end if;

  update public.toast_snapshot_dedup_items i set batch = n.batch
    from (select x.snapshot_id, ((row_number() over (order by x.business_date, x.location_id, x.snapshot_id) - 1) / p_batch_size + 1)::integer as batch
            from public.toast_snapshot_dedup_items x where x.manifest_id = m.id) n
   where i.manifest_id = m.id and i.snapshot_id = n.snapshot_id;
  insert into public.toast_snapshot_dedup_batches (manifest_id, batch, snapshots, checks, discounts, service_charges, payments)
  select m.id, i.batch, count(*), sum(i.checks), sum(i.discounts), sum(i.service_charges), sum(i.payments)
    from public.toast_snapshot_dedup_items i where i.manifest_id = m.id group by i.batch;

  select count(*), coalesce(max(i.batch), 0),
         encode(sha256(convert_to(coalesce(string_agg(i.snapshot_id::text || '|' || i.survivor_id::text || '|' || i.content_md5, E'\n' order by i.snapshot_id), ''), 'UTF8')), 'hex'),
         jsonb_build_object('snapshots', count(*), 'checks', coalesce(sum(i.checks), 0), 'discounts', coalesce(sum(i.discounts), 0),
                            'service_charges', coalesce(sum(i.service_charges), 0), 'payments', coalesce(sum(i.payments), 0))
    into v_items, v_batches, v_digest, v_totals
    from public.toast_snapshot_dedup_items i where i.manifest_id = m.id;
  v_totals := v_totals || jsonb_build_object('by_month', coalesce((
    select jsonb_object_agg(x.month, x.snapshots order by x.month)
      from (select to_char(i.business_date, 'YYYY-MM') as month, count(*) as snapshots
              from public.toast_snapshot_dedup_items i where i.manifest_id = m.id group by 1) x), '{}'::jsonb));

  update public.toast_snapshot_dedup_manifests
     set status = case when v_items = 0 then 'applied' else 'built' end, built_at = clock_timestamp(),
         ended_at = case when v_items = 0 then clock_timestamp() end,
         batch_size = p_batch_size, batches = v_batches, items = v_items, digest = v_digest, totals = v_totals
   where id = m.id;
  return jsonb_build_object('version', p_version, 'items', v_items, 'batches', v_batches, 'batch_size', p_batch_size,
                            'digest', v_digest, 'totals', v_totals);
end $$;

create function public.toast_snapshot_dedup_abandon(p_version integer) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare m public.toast_snapshot_dedup_manifests%rowtype;
begin
  select * into m from public.toast_snapshot_dedup_manifests where version = p_version for update;
  if not found then raise exception 'manifest_not_found'; end if;
  if m.status not in ('building','built','applying') then raise exception 'manifest_not_active'; end if;
  -- Applied batches stay applied and recorded; the rest of the manifest is never applied.
  update public.toast_snapshot_dedup_manifests set status = 'abandoned', ended_at = clock_timestamp() where id = m.id;
  return jsonb_build_object('version', p_version, 'status', 'abandoned', 'applied_batches', m.applied_batches);
end $$;

-- 7. THE delete. One batch per call, one transaction, one audit row.
create function public.toast_snapshot_dedup_apply(p_version integer, p_digest text, p_batch integer, p_expected jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public set timezone = 'UTC' set lock_timeout = '5s' as $$
declare
  m public.toast_snapshot_dedup_manifests%rowtype; b public.toast_snapshot_dedup_batches%rowtype;
  v_expected jsonb; v_reason text; v_n bigint; v_audit uuid; v_last boolean; v_changed boolean; v_unequal boolean;
begin
  begin
    lock table public.toast_orders in share row exclusive mode;
  exception when lock_not_available then raise exception 'dedup_busy';
  end;
  select * into m from public.toast_snapshot_dedup_manifests where version = p_version for update;
  if not found then raise exception 'manifest_not_found'; end if;
  if m.status not in ('built','applying') then raise exception 'manifest_not_built'; end if;
  if p_digest is null or p_digest is distinct from m.digest then raise exception 'digest_mismatch'; end if;
  select * into b from public.toast_snapshot_dedup_batches where manifest_id = m.id and batch = p_batch;
  if not found then raise exception 'batch_not_found'; end if;
  if b.applied_at is not null then raise exception 'batch_already_applied'; end if;
  if p_batch <> (select min(x.batch) from public.toast_snapshot_dedup_batches x where x.manifest_id = m.id and x.applied_at is null) then
    raise exception 'batch_out_of_order'; end if;
  v_expected := jsonb_build_object('snapshots', b.snapshots, 'checks', b.checks, 'discounts', b.discounts,
                                   'service_charges', b.service_charges, 'payments', b.payments);
  if p_expected is null or p_expected <> v_expected then raise exception 'expected_mismatch'; end if;
  perform public.toast_snapshot_dedup_census();

  -- The batch = this manifest's items numbered p_batch (none applied: checked above).
  if (select count(*) from public.toast_snapshot_dedup_items t where t.manifest_id = m.id and t.batch = p_batch and t.applied_at is null) <> b.snapshots then
    raise exception 'manifest_count_mismatch'; end if;

  -- Every refusal below leaves the database untouched (the transaction raises).
  if exists (select 1 from public.toast_snapshot_dedup_items t where t.manifest_id = m.id and t.batch = p_batch and not exists (
               select 1 from public.toast_orders o where o.id = t.snapshot_id and o.location_id = t.location_id and o.business_date = t.business_date)) then
    raise exception 'candidate_missing'; end if;
  if exists (select 1 from public.toast_snapshot_dedup_items t where t.manifest_id = m.id and t.batch = p_batch and not exists (
               select 1 from public.toast_orders o where o.id = t.survivor_id and o.location_id = t.location_id and o.business_date = t.business_date)) then
    raise exception 'survivor_missing'; end if;
  select min(case f.reason when 'toast_order_latest_pointers.snapshot_id' then '1 candidate_now_target'
                           when 'ezcater_toast_links.toast_snapshot_id' then '2 candidate_now_linked'
                           when 'toast_snapshot_registry.survivor_id' then '3 candidate_now_survivor'
                           else '4 candidate_now_evidence' end) into v_reason
    from public.toast_snapshot_reference_ids() f
   where f.snapshot_id in (select t.snapshot_id from public.toast_snapshot_dedup_items t where t.manifest_id = m.id and t.batch = p_batch);
  if v_reason is not null then raise exception '%', substr(v_reason, 3); end if;
  if exists (select 1 from public.toast_snapshot_evidence_ids(m.begun_at - interval '1 hour') e
              where e.snapshot_id in (select t.snapshot_id from public.toast_snapshot_dedup_items t where t.manifest_id = m.id and t.batch = p_batch)) then
    raise exception 'candidate_now_evidence'; end if;
  if exists (select 1 from public.toast_capture_run_orders ro join public.toast_capture_runs r on r.id = ro.run_id
              where r.status = 'running' and ro.snapshot_id in (select t.snapshot_id from public.toast_snapshot_dedup_items t where t.manifest_id = m.id and t.batch = p_batch)) then
    raise exception 'candidate_in_running_run'; end if;
  -- No reference can be pending in a transaction this function cannot see (header: A REFERENCE NOT YET COMMITTED).
  if exists (select 1 from public.toast_capture_run_orders ro join public.toast_capture_runs r on r.id = ro.run_id
              where (r.status = 'running' or r.started_at >= m.begun_at or r.finished_at >= m.begun_at)
                and (ro.location_id, ro.order_guid) in (
                  select g.location_id, g.order_guid from public.toast_snapshot_registry g
                   where g.id in (select t.snapshot_id from public.toast_snapshot_dedup_items t where t.manifest_id = m.id and t.batch = p_batch))) then
    raise exception 'candidate_order_recently_captured'; end if;
  if not coalesce((select r.rolsuper or pg_has_role(r.oid, 'pg_read_all_stats', 'USAGE') from pg_roles r where r.rolname = current_user), false) then
    raise exception 'cannot_see_transactions'; end if;
  if exists (select 1 from pg_prepared_xacts x where x.database = current_database()) then
    raise exception 'prepared_transaction_open'; end if;
  if exists (select 1 from pg_stat_activity a where a.pid <> pg_backend_pid() and a.datname = current_database()
               and a.xact_start is not null and a.xact_start < m.begun_at) then
    raise exception 'open_transaction_older_than_manifest'; end if;
  -- The manifest's digest binds each candidate's content: it must still be what was listed, and FULLY equal to its
  -- survivor's (jsonb equality, never the md5). One pass: each content is computed once.
  select coalesce(bool_or(md5(x.candidate::text) is distinct from t.content_md5), false),
         coalesce(bool_or(x.candidate is distinct from public.toast_snapshot_content(t.survivor_id)), false)
    into v_changed, v_unequal
    from public.toast_snapshot_dedup_items t
    cross join lateral (select public.toast_snapshot_content(t.snapshot_id) as candidate) x
   where t.manifest_id = m.id and t.batch = p_batch;
  if v_changed then raise exception 'content_changed'; end if;
  if v_unequal then raise exception 'content_not_equal'; end if;
  if (select count(*) from public.toast_order_checks c where c.snapshot_id in (select t.snapshot_id from public.toast_snapshot_dedup_items t where t.manifest_id = m.id and t.batch = p_batch)) <> b.checks
     or (select count(*) from public.toast_check_discounts c where c.snapshot_id in (select t.snapshot_id from public.toast_snapshot_dedup_items t where t.manifest_id = m.id and t.batch = p_batch)) <> b.discounts
     or (select count(*) from public.toast_check_service_charges c where c.snapshot_id in (select t.snapshot_id from public.toast_snapshot_dedup_items t where t.manifest_id = m.id and t.batch = p_batch)) <> b.service_charges
     or (select count(*) from public.toast_payments c where c.snapshot_id in (select t.snapshot_id from public.toast_snapshot_dedup_items t where t.manifest_id = m.id and t.batch = p_batch)) <> b.payments then
    raise exception 'manifest_count_mismatch'; end if;

  -- Identity first: the registry row says when, which survivor, which manifest.
  update public.toast_snapshot_registry g
     set payload_deleted_at = clock_timestamp(), survivor_id = t.survivor_id, content_md5 = t.content_md5, manifest_id = m.id
    from public.toast_snapshot_dedup_items t
   where t.manifest_id = m.id and t.batch = p_batch and g.id = t.snapshot_id and g.payload_deleted_at is null;
  get diagnostics v_n = row_count;
  if v_n <> b.snapshots then raise exception 'registry_stamp_mismatch'; end if;

  -- Children before parents; every count must be the manifest's.
  delete from public.toast_check_discounts c where c.snapshot_id in (select t.snapshot_id from public.toast_snapshot_dedup_items t where t.manifest_id = m.id and t.batch = p_batch);
  get diagnostics v_n = row_count;
  if v_n <> b.discounts then raise exception 'delete_count_mismatch'; end if;
  delete from public.toast_check_service_charges c where c.snapshot_id in (select t.snapshot_id from public.toast_snapshot_dedup_items t where t.manifest_id = m.id and t.batch = p_batch);
  get diagnostics v_n = row_count;
  if v_n <> b.service_charges then raise exception 'delete_count_mismatch'; end if;
  delete from public.toast_payments c where c.snapshot_id in (select t.snapshot_id from public.toast_snapshot_dedup_items t where t.manifest_id = m.id and t.batch = p_batch);
  get diagnostics v_n = row_count;
  if v_n <> b.payments then raise exception 'delete_count_mismatch'; end if;
  delete from public.toast_order_checks c where c.snapshot_id in (select t.snapshot_id from public.toast_snapshot_dedup_items t where t.manifest_id = m.id and t.batch = p_batch);
  get diagnostics v_n = row_count;
  if v_n <> b.checks then raise exception 'delete_count_mismatch'; end if;
  delete from public.toast_orders o where o.id in (select t.snapshot_id from public.toast_snapshot_dedup_items t where t.manifest_id = m.id and t.batch = p_batch);
  get diagnostics v_n = row_count;
  if v_n <> b.snapshots then raise exception 'delete_count_mismatch'; end if;

  v_last := not exists (select 1 from public.toast_snapshot_dedup_batches x where x.manifest_id = m.id and x.applied_at is null and x.batch <> p_batch);
  insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
  values (null, null, 'toast.snapshot_dedup', 'toast_snapshot_dedup_manifests', m.id,
    jsonb_build_object('actor_context', 'migration_apply', 'migration', '0351', 'ruling', 'Juan 2026-11-16: delete exact duplicate Toast snapshots',
      'manifest_version', m.version, 'digest', m.digest, 'cutoff_date', m.cutoff_date, 'batch', p_batch, 'batches', m.batches,
      'counts', v_expected), true)
  returning id into v_audit;
  update public.toast_snapshot_dedup_items set applied_at = clock_timestamp() where manifest_id = m.id and batch = p_batch;
  update public.toast_snapshot_dedup_batches set applied_at = clock_timestamp(), audit_id = v_audit where manifest_id = m.id and batch = p_batch;
  update public.toast_snapshot_dedup_manifests
     set status = case when v_last then 'applied' else 'applying' end, applied_batches = applied_batches + 1,
         ended_at = case when v_last then clock_timestamp() end
   where id = m.id;
  return jsonb_build_object('version', m.version, 'batch', p_batch, 'batches', m.batches, 'deleted', v_expected,
                            'status', case when v_last then 'applied' else 'applying' end, 'audit_id', v_audit);
end $$;

-- 8. Verify (read-only). Every check carries ok; "ok" at the top is all of them.
create function public.toast_snapshot_dedup_verify(p_version integer) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public set timezone = 'UTC' as $$
declare m public.toast_snapshot_dedup_manifests%rowtype; v jsonb := '{}'::jsonb; a bigint; b bigint; c bigint; d bigint; e bigint;
begin
  select * into m from public.toast_snapshot_dedup_manifests where version = p_version;
  if not found then raise exception 'manifest_not_found'; end if;

  -- identity: every snapshot has its registry row; a registry row without payload is a stamped one; none was removed.
  select count(*) into a from public.toast_orders o where not exists (select 1 from public.toast_snapshot_registry g where g.id = o.id);
  select count(*) into b from public.toast_snapshot_registry g
   where (g.payload_deleted_at is null) <> exists (select 1 from public.toast_orders o where o.id = g.id);
  select count(*) into c from public.toast_snapshot_registry;
  v := v || jsonb_build_object('identity', jsonb_build_object('ok', a = 0 and b = 0 and c >= m.registry_rows_at_begin,
    'snapshots_without_registry_row', a, 'registry_rows_disagreeing_with_payload', b, 'registry_rows', c,
    'registry_rows_at_begin', m.registry_rows_at_begin));

  -- memberships: no run lost one (per-run baseline from begin; a run still running then may have grown), and no
  -- completed run's count moved away from runs.orders (the readers' guard), beyond what was already so at begin.
  with now_counts as (
    select ro.run_id, count(*) as n from public.toast_capture_run_orders ro group by ro.run_id
  ), base as (
    select x.run_id, x.memberships, x.finished, coalesce(c.n, 0) as n
      from public.toast_snapshot_dedup_runs x left join now_counts c on c.run_id = x.run_id where x.manifest_id = m.id
  )
  select (select count(*) from base where n < memberships),
         (select count(*) from base where finished and n <> memberships),
         (select count(*) from public.toast_capture_runs r left join now_counts c on c.run_id = r.id where r.status = 'completed' and r.orders <> coalesce(c.n, 0)),
         (select coalesce(sum(n), 0) from now_counts)
    into a, c, b, d;
  v := v || jsonb_build_object('memberships', jsonb_build_object('ok', a = 0 and c = 0 and b <= m.completed_runs_wrong_at_begin,
    'runs_with_fewer_memberships', a, 'finished_runs_changed', c, 'completed_runs_with_wrong_count', b,
    'completed_runs_with_wrong_count_at_begin', m.completed_runs_wrong_at_begin, 'memberships', d, 'memberships_at_begin', m.memberships_at_begin));

  -- payload: exactly the applied batches are gone, parents and every child row.
  select coalesce(sum(x.snapshots), 0) into a from public.toast_snapshot_dedup_batches x where x.manifest_id = m.id and x.applied_at is not null;
  select count(*) into b from public.toast_snapshot_registry g where g.manifest_id = m.id;
  select count(*) into c from public.toast_snapshot_dedup_items i where i.manifest_id = m.id and i.applied_at is not null
     and (exists (select 1 from public.toast_orders o where o.id = i.snapshot_id)
       or exists (select 1 from public.toast_order_checks o where o.snapshot_id = i.snapshot_id)
       or exists (select 1 from public.toast_check_discounts o where o.snapshot_id = i.snapshot_id)
       or exists (select 1 from public.toast_check_service_charges o where o.snapshot_id = i.snapshot_id)
       or exists (select 1 from public.toast_payments o where o.snapshot_id = i.snapshot_id));
  select count(*) into d from public.toast_snapshot_dedup_items i where i.manifest_id = m.id and i.applied_at is null
     and not exists (select 1 from public.toast_orders o where o.id = i.snapshot_id);
  select count(*) into e from public.toast_snapshot_dedup_items i where i.manifest_id = m.id and i.applied_at is not null;
  v := v || jsonb_build_object('payload', jsonb_build_object('ok', a = b and a = e and c = 0 and (d = 0 or m.status = 'abandoned'),
    'applied_batch_snapshots', a, 'registry_rows_stamped', b, 'items_applied', e, 'applied_items_with_rows_left', c,
    'unapplied_items_already_gone', d));

  -- survivors: each deleted snapshot's survivor exists and still holds the stamped content.
  select count(*) into a from public.toast_snapshot_registry g where g.manifest_id = m.id
     and not exists (select 1 from public.toast_orders o where o.id = g.survivor_id);
  select count(*) into b from (select distinct g.survivor_id, g.content_md5 from public.toast_snapshot_registry g where g.manifest_id = m.id) s
   where public.toast_snapshot_content_md5(s.survivor_id) is distinct from s.content_md5;
  v := v || jsonb_build_object('survivors', jsonb_build_object('ok', a = 0 and b = 0, 'missing', a, 'content_differs', b));

  -- targets: every pointer target and every link target has its payload.
  select count(*) into a from public.toast_order_latest_pointers p where not exists (select 1 from public.toast_orders o where o.id = p.snapshot_id);
  select count(*) into b from public.ezcater_toast_links l where not exists (select 1 from public.toast_orders o where o.id = l.toast_snapshot_id);
  v := v || jsonb_build_object('targets', jsonb_build_object('ok', a = 0 and b = 0, 'pointers_without_payload', a, 'links_without_payload', b));

  -- audit: one row per applied batch.
  select count(*) into a from public.toast_snapshot_dedup_batches x where x.manifest_id = m.id and x.applied_at is not null;
  select count(*) into b from public.audit_log l where l.action = 'toast.snapshot_dedup' and l.resource_id = m.id and l.destructive;
  v := v || jsonb_build_object('audit', jsonb_build_object('ok', a = b and a = m.applied_batches, 'applied_batches', a, 'audit_rows', b));

  return jsonb_build_object('version', m.version, 'status', m.status, 'digest', m.digest, 'batches', m.batches,
    'applied_batches', m.applied_batches,
    'ok', (select bool_and((x.value->>'ok')::boolean) from jsonb_each(v) x), 'checks', v);
end $$;

-- 9. Ceilings.
do $$
declare t text; f text;
begin
  foreach t in array array['toast_snapshot_registry','toast_snapshot_dedup_manifests','toast_snapshot_dedup_days',
      'toast_snapshot_dedup_retained','toast_snapshot_dedup_items','toast_snapshot_dedup_batches','toast_snapshot_dedup_runs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (false)', t || '_no_user_select', t);
    execute format('create policy %I on public.%I for insert with check (false)', t || '_no_user_insert', t);
    execute format('create policy %I on public.%I for update using (false)', t || '_no_user_update', t);
    execute format('create policy %I on public.%I for delete using (false)', t || '_no_user_delete', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to service_role', t);
  end loop;
  foreach f in array array['toast_snapshot_register()','toast_snapshot_content(uuid)','toast_snapshot_content_md5(uuid)',
      'toast_snapshot_dedup_census()','toast_snapshot_reference_ids()','toast_snapshot_evidence_ids(timestamptz)',
      'toast_snapshot_dedup_begin(integer,date)','toast_snapshot_dedup_build_range(integer,date,date)',
      'toast_snapshot_dedup_finish(integer,integer)','toast_snapshot_dedup_abandon(integer)',
      'toast_snapshot_dedup_apply(integer,text,integer,jsonb)','toast_snapshot_dedup_verify(integer)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', f);
  end loop;
end $$;

-- 10. Memberships now reference the registry (validated here: every membership's snapshot is in the copy above).
alter table public.toast_capture_run_orders
  add constraint toast_capture_run_orders_snapshot_registry_fkey
  foreign key (snapshot_id, location_id, business_date) references public.toast_snapshot_registry (id, location_id, business_date);

-- 11. LAST lock: drop the 0221 membership FK to toast_orders (ACCESS EXCLUSIVE on both tables until COMMIT).
do $$
declare v_name text; v_count integer;
begin
  select count(*), min(conname) into v_count, v_name from pg_constraint
   where contype = 'f' and conrelid = 'public.toast_capture_run_orders'::regclass and confrelid = 'public.toast_orders'::regclass;
  if v_count <> 1 then raise exception '0351: expected exactly one membership FK to toast_orders, found %', v_count; end if;
  execute format('alter table public.toast_capture_run_orders drop constraint %I', v_name);
end $$;

-- 12. Final assertions.
do $$
declare t text;
begin
  if (select count(*) from public.toast_snapshot_registry) <> (select count(*) from public.toast_orders) then
    raise exception '0351: registry copy incomplete'; end if;
  perform public.toast_snapshot_dedup_census();
  if not exists (select 1 from pg_constraint where conname = 'toast_capture_run_orders_snapshot_registry_fkey' and convalidated
                   and conrelid = 'public.toast_capture_run_orders'::regclass and confrelid = 'public.toast_snapshot_registry'::regclass) then
    raise exception '0351: membership FK to the registry missing'; end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.toast_orders'::regclass and tgname = 'toast_orders_register' and tgenabled = 'O') then
    raise exception '0351: register trigger missing'; end if;
  foreach t in array array['toast_snapshot_registry','toast_snapshot_dedup_manifests','toast_snapshot_dedup_days',
      'toast_snapshot_dedup_retained','toast_snapshot_dedup_items','toast_snapshot_dedup_batches','toast_snapshot_dedup_runs'] loop
    if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = t
                 and (grantee in ('PUBLIC','anon','authenticated') or (grantee = 'service_role' and privilege_type <> 'SELECT'))) then
      raise exception '0351: unexpected table grant on %', t; end if;
    if not has_table_privilege('service_role', 'public.' || t, 'SELECT') then raise exception '0351: service_role cannot read %', t; end if;
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception '0351: RLS off on %', t; end if;
    if (select count(*) from pg_policies where schemaname = 'public' and tablename = t) <> 4 then raise exception '0351: policies on %', t; end if;
  end loop;
  if exists (select 1 from information_schema.routine_privileges where routine_schema = 'public'
               and (routine_name like 'toast\_snapshot\_%')
               and grantee in ('PUBLIC','anon','authenticated','service_role')) then
    raise exception '0351: unexpected function grant'; end if;
end $$;
commit;
