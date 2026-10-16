-- Migration 0268_sevenshifts_sync
-- AUTHORED 2026-10-15. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word, BEFORE SEVENSHIFTS_SYNC=1).
-- APPLIED TO SIM 2026-10-16 (schema_migrations version 20261016082524, name 'sevenshifts_sync')
-- APPLIED TO PROD 2026-10-16 (schema_migrations version 20261016084016, name 'sevenshifts_sync')
-- Provenance: Smart Scheduling Phase 1, Task 5 (docs/superpowers/plans/2026-10-15-scheduling-phase1-BUILD.md),
--   Astra plan rounds r1–r3 (r1 P2-3 reconciled snapshots, r1 P2-4 per-resource conflict keys, r2 #2
--   snapshot completeness) and chunk A review (time off, deleted punches, labor thresholds).
--
-- WHAT:
--   1. The 7shifts READ mirrors. Raw facts keyed by the 7shifts id (bigint), upserted by
--      lib/sevenshifts/sync.ts through MIRROR_WRITE_SPEC (lib/sevenshifts/mirror-spec-shared.ts), NEVER
--      deleted (7shifts' own `deleted` flag is kept). Nine UPSERT mirrors, each with its own conflict
--      key: (id) for locations, departments, roles, users, availabilities, time_off, shifts,
--      time_punches; (company_id) for labor_settings.
--   2. Two SNAPSHOT-RECONCILED mirrors, user assignments and wages: one LIVE row per identity
--      (partial unique index `where active`), first_seen_run / last_seen_run / retired_run, history
--      kept. Their ONLY writer is reconcile_sevenshifts_user_snapshot (SECURITY DEFINER), which
--      retires a live row only after a COMPLETE per-user snapshot. service_role holds SELECT only,
--      so a plain upsert cannot bypass the snapshot rule.
--   3. The ledger: sevenshifts_sync_run_ids (minted at the START of a run, so reconciled rows can name
--      it) and sevenshifts_sync_runs (one row at the END, same id; append-only by grant). A run id with
--      no ledger row is an interrupted run.
--   4. sevenshifts_sync_state: one watermark row per resource.
--   5. The cron lease: cron_route_leases_job_check and claim_cron_route re-emitted with
--      'sevenshifts-sync' added (0243's body otherwise unchanged; pinned in
--      tests/sevenshifts-sync-migration.test.ts).
--
-- PII RULE: staff personal data from 7shifts is dropped in the pure normalizer BEFORE any write
--   (email, phones, birth date, address, punch_id, hourly_wage, tips, notes, availability and time-off
--   comments/reasons/categories). No such column exists on any table here (harness H6).
--
-- WHO READS / WRITES (service role only, through the lib; no PostgREST role holds anything):
--     lib/sevenshifts/sync.ts   ← every table here (mirrors by upsert, the two reconciled mirrors by the RPC)
--     /admin/sevenshifts (Task 10) reads the ledger and the counts. Phase 1 has no wage reader.
--   Every table: RLS on with NO policy (the 0203/0257 posture), a service_role privilege CEILING.
--
-- PRE-FLIGHT (MCP, before apply — AGENTS.md "pre-flight every SQL emission"):
--   select to_regclass('public.cron_route_leases'), to_regprocedure('public.claim_cron_route(text)');  -- both present (0243)
--   select conname from pg_constraint where conrelid = 'public.cron_route_leases'::regclass and contype = 'c';
--     -- cron_route_leases_job_check
--   select to_regclass('public.sevenshifts_sync_runs');  -- NULL
--   (the preflight block below asserts all of it and refuses otherwise)
--
-- VERIFY AFTER APPLY:
--   select c.relname, c.relrowsecurity from pg_class c where c.relname like 'sevenshifts\_%' and c.relkind = 'r' order by 1;  -- 14 rows, all t
--   select table_name, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name like 'sevenshifts\_%' and grantee = 'service_role' order by 1, 2;
--   select public.claim_cron_route('sevenshifts-sync');  -- t (then f within 330 s)

begin;

-- ── PRE-FLIGHT ──────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.cron_route_leases') is null or to_regprocedure('public.claim_cron_route(text)') is null then
    raise exception '0268: 0243 (cron_route_leases + claim_cron_route) must be applied first';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.cron_route_leases'::regclass
                  and conname = 'cron_route_leases_job_check' and contype = 'c') then
    raise exception '0268: cron_route_leases_job_check not found under that name';
  end if;
  if position('toast-catering-scan' in (select prosrc from pg_proc where oid = 'public.claim_cron_route(text)'::regprocedure)) = 0
     or position('sevenshifts-sync' in (select prosrc from pg_proc where oid = 'public.claim_cron_route(text)'::regprocedure)) > 0 then
    raise exception '0268: claim_cron_route is not 0243''s body';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname like 'sevenshifts\_%') then
    raise exception '0268: a sevenshifts_* relation already exists';
  end if;
end $$;

-- ── THE LEDGER ──────────────────────────────────────────────────────────────────────────────────
create table public.sevenshifts_sync_run_ids (
  id         uuid        primary key default gen_random_uuid(),
  started_at timestamptz not null default clock_timestamp(),
  trigger    text        not null check (trigger in ('cron', 'manual'))
);
comment on table public.sevenshifts_sync_run_ids is
  '7shifts sync run identities, minted at the START of a run (0268) so reconciled rows can name it. Writer: lib/sevenshifts/sync.ts. Append-only by grant. A run id with no sevenshifts_sync_runs row is an interrupted run.';

create table public.sevenshifts_sync_runs (
  id           uuid        primary key references public.sevenshifts_sync_run_ids(id),
  trigger      text        not null check (trigger in ('cron', 'manual')),
  requested_by uuid        references public.users(id),
  started_at   timestamptz not null,
  finished_at  timestamptz not null,
  status       text        not null check (status in ('ok', 'partial', 'failed')),
  company_id   bigint      check (company_id > 0),
  requests     integer     not null check (requests >= 0),
  results      jsonb       not null check (jsonb_typeof(results) = 'object'),
  constraint sevenshifts_sync_runs_manual_has_requester check ((trigger = 'manual') = (requested_by is not null)),
  constraint sevenshifts_sync_runs_finish_after_start check (finished_at >= started_at)
);
create index sevenshifts_sync_runs_recent on public.sevenshifts_sync_runs (finished_at desc);
comment on table public.sevenshifts_sync_runs is
  '7shifts sync ledger (0268): ONE row per finished run, written at the end by lib/sevenshifts/sync.ts. results = per resource {rows, skipped, pages, error_code}; counts and fixed codes only, never names, payloads or URLs. Append-only by grant.';

create table public.sevenshifts_sync_state (
  resource           text        primary key check (resource in ('locations', 'departments', 'roles', 'users', 'assignments',
                       'wages', 'availabilities', 'time_off', 'shifts', 'time_punches', 'labor_settings')),
  last_success_at    timestamptz,
  modified_watermark timestamptz,
  last_error_code    text        check (last_error_code is null or last_error_code ~ '^[a-z_]{1,40}$'),
  updated_at         timestamptz not null default clock_timestamp()
);
comment on table public.sevenshifts_sync_state is
  '7shifts sync watermark per resource (0268). Advanced by lib/sevenshifts/sync.ts ONLY for a resource that fully succeeded.';

-- ── THE UPSERT MIRRORS (conflict keys = MIRROR_WRITE_SPEC) ──────────────────────────────────────
create table public.sevenshifts_locations (
  id         bigint      primary key check (id > 0),
  company_id bigint      not null check (company_id > 0),
  name       text        check (char_length(name) <= 200),
  timezone   text        check (char_length(timezone) <= 64),
  active     boolean,
  pulled_at  timestamptz not null default clock_timestamp()
);
create table public.sevenshifts_departments (
  id          bigint      primary key check (id > 0),
  location_id bigint      check (location_id > 0),
  name        text        check (char_length(name) <= 200),
  pulled_at   timestamptz not null default clock_timestamp()
);
create table public.sevenshifts_roles (
  id            bigint      primary key check (id > 0),
  location_id   bigint      check (location_id > 0),
  department_id bigint      check (department_id > 0),
  name          text        check (char_length(name) <= 200),
  active        boolean,
  pulled_at     timestamptz not null default clock_timestamp()
);
create table public.sevenshifts_users (
  id                   bigint      primary key check (id > 0),
  company_id           bigint      not null check (company_id > 0),
  first_name           text        check (char_length(first_name) <= 60),
  last_name            text        check (char_length(last_name) <= 60),
  preferred_first_name text        check (char_length(preferred_first_name) <= 60),
  employee_id          text        check (char_length(employee_id) <= 64),
  user_type            text        check (char_length(user_type) <= 40),
  active               boolean     not null,
  hire_date            date,
  skill_level          smallint,
  source_modified_at   timestamptz,
  pulled_at            timestamptz not null default clock_timestamp()
);
create table public.sevenshifts_availabilities (
  id                 bigint      primary key check (id > 0),
  user_id            bigint      not null check (user_id > 0),
  week               date,
  week_to            date,
  repeating          boolean,
  status             smallint,
  -- {mon:{code,from,to}, …}: 7shifts' RAW day codes, mapped at read time by a pure function; no comments, no reasons.
  days               jsonb       not null check (jsonb_typeof(days) = 'object'),
  source_modified_at timestamptz,
  pulled_at          timestamptz not null default clock_timestamp()
);
create index sevenshifts_availabilities_user_week on public.sevenshifts_availabilities (user_id, week);
create table public.sevenshifts_time_off (
  id                 bigint      primary key check (id > 0),
  user_id            bigint      not null check (user_id > 0),
  from_date          date        not null,
  to_date            date        not null,
  partial            boolean,
  from_time          time,
  to_time            time,
  status             smallint,
  hours              numeric     check (hours >= 0),
  source_modified_at timestamptz,
  pulled_at          timestamptz not null default clock_timestamp()
);
create table public.sevenshifts_shifts (
  id                 bigint      primary key check (id > 0),
  user_id            bigint      check (user_id > 0),
  location_id        bigint      check (location_id > 0),
  department_id      bigint      check (department_id > 0),
  role_id            bigint      check (role_id > 0),
  station_id         bigint      check (station_id > 0),
  start_at           timestamptz not null,
  end_at             timestamptz not null,
  draft              boolean,
  open               boolean,
  deleted            boolean     not null default false,
  source_modified_at timestamptz,
  pulled_at          timestamptz not null default clock_timestamp()
);
create index sevenshifts_shifts_location_start on public.sevenshifts_shifts (location_id, start_at);
create table public.sevenshifts_time_punches (
  id                 bigint      primary key check (id > 0),
  user_id            bigint      not null check (user_id > 0),
  location_id        bigint      check (location_id > 0),
  department_id      bigint      check (department_id > 0),
  role_id            bigint      check (role_id > 0),
  shift_id           bigint      check (shift_id > 0),
  clocked_in         timestamptz not null,
  clocked_out        timestamptz,
  break_minutes      integer     check (break_minutes >= 0),
  approved           boolean,
  auto_clocked_out   boolean,
  deleted            boolean     not null default false,
  source_modified_at timestamptz,
  pulled_at          timestamptz not null default clock_timestamp()
);
create index sevenshifts_time_punches_location_in on public.sevenshifts_time_punches (location_id, clocked_in);
create index sevenshifts_time_punches_user_in on public.sevenshifts_time_punches (user_id, clocked_in);
create table public.sevenshifts_labor_settings (
  company_id                   bigint      primary key check (company_id > 0),
  daily_ot_threshold           numeric,
  weekly_ot_threshold          numeric,
  premium_ot_threshold         numeric,
  consecutive_days_threshold   integer,
  overtime_enabled             boolean,
  overtime_by_location_enabled boolean,
  multipliers                  jsonb       not null check (jsonb_typeof(multipliers) = 'object'),
  pulled_at                    timestamptz not null default clock_timestamp()
);

-- pulled_at moves on every upsert-update (the lib never sends it; the mirror spec's column sets exclude it).
create function public.sevenshifts_touch_pulled_at()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  new.pulled_at := clock_timestamp();
  return new;
end $$;
revoke all on function public.sevenshifts_touch_pulled_at() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['sevenshifts_locations', 'sevenshifts_departments', 'sevenshifts_roles', 'sevenshifts_users',
    'sevenshifts_availabilities', 'sevenshifts_time_off', 'sevenshifts_shifts', 'sevenshifts_time_punches',
    'sevenshifts_labor_settings'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.sevenshifts_touch_pulled_at()',
      t || '_touch', t);
    execute format('comment on table public.%I is %L', t,
      '7shifts read mirror (0268). Writer: lib/sevenshifts/sync.ts, upsert by its MIRROR_WRITE_SPEC key; never deleted. PII is dropped by the normalizer before any write.');
  end loop;
end $$;

-- ── THE RECONCILED MIRRORS (r1 P2-3) ────────────────────────────────────────────────────────────
create table public.sevenshifts_user_assignments (
  id             uuid        primary key default gen_random_uuid(),
  edge_key       text        not null check (edge_key ~ '^\d{1,18}:(\d{1,18}|-):(\d{1,18}|-):(\d{1,18}|-)$'),
  user_id        bigint      not null check (user_id > 0),
  location_id    bigint      check (location_id > 0),
  department_id  bigint      check (department_id > 0),
  role_id        bigint      check (role_id > 0),
  is_primary     boolean,
  active         boolean     not null default true,
  first_seen_run uuid        not null references public.sevenshifts_sync_run_ids(id),
  last_seen_run  uuid        not null references public.sevenshifts_sync_run_ids(id),
  retired_run    uuid        references public.sevenshifts_sync_run_ids(id),
  retired_at     timestamptz,
  constraint sevenshifts_user_assignments_key_matches check (edge_key = user_id::text || ':' || coalesce(location_id::text, '-')
    || ':' || coalesce(department_id::text, '-') || ':' || coalesce(role_id::text, '-')),
  constraint sevenshifts_user_assignments_live check (active = (retired_run is null)),
  constraint sevenshifts_user_assignments_retired_pair check ((retired_run is null) = (retired_at is null))
);
create unique index sevenshifts_user_assignments_one_live on public.sevenshifts_user_assignments (edge_key) where active;
create index sevenshifts_user_assignments_user on public.sevenshifts_user_assignments (user_id, active);
comment on table public.sevenshifts_user_assignments is
  '7shifts user assignment EDGES (0268), snapshot-reconciled per user by reconcile_sevenshifts_user_snapshot, its only writer. One live row per edge_key; a reappearing edge is a new row (history kept).';

create table public.sevenshifts_wages (
  id             uuid        primary key default gen_random_uuid(),
  user_id        bigint      not null check (user_id > 0),
  wage_id        bigint      not null check (wage_id > 0),
  upcoming       boolean     not null,
  effective_date date,
  wage_type      text        not null check (wage_type in ('hourly', 'weekly_salary', 'annual_salary')),
  wage_cents     integer     not null check (wage_cents >= 0),
  role_id        bigint      check (role_id > 0),
  active         boolean     not null default true,
  first_seen_run uuid        not null references public.sevenshifts_sync_run_ids(id),
  last_seen_run  uuid        not null references public.sevenshifts_sync_run_ids(id),
  retired_run    uuid        references public.sevenshifts_sync_run_ids(id),
  retired_at     timestamptz,
  constraint sevenshifts_wages_live check (active = (retired_run is null)),
  constraint sevenshifts_wages_retired_pair check ((retired_run is null) = (retired_at is null))
);
create unique index sevenshifts_wages_one_live on public.sevenshifts_wages (user_id, wage_id, upcoming) where active;
create index sevenshifts_wages_user on public.sevenshifts_wages (user_id, active);
comment on table public.sevenshifts_wages is
  '7shifts wages (0268), snapshot-reconciled per user by reconcile_sevenshifts_user_snapshot, its only writer. Individual rates: MoO+ only (canSeeWageRates); Phase 1 has no reader. An upcoming wage that becomes current is a retire + a new live row.';

-- ── THE RECONCILER (r1 P2-3, r2 #2) ─────────────────────────────────────────────────────────────
-- A row's problem, or null. Ids travel as digit strings (the normalizer's output); null spelled JSON null.
create function public.sevenshifts_snapshot_row_problem(p_kind text, p_user bigint, r jsonb)
returns text language plpgsql immutable set search_path = pg_catalog, public as $$
declare
  k text;
  allowed text[];
begin
  if r is null or jsonb_typeof(r) <> 'object' then return 'not_object'; end if;
  allowed := case p_kind
    when 'assignments' then array['edge_key', 'user_id', 'location_id', 'department_id', 'role_id', 'is_primary']
    else array['user_id', 'wage_id', 'upcoming', 'effective_date', 'wage_type', 'wage_cents', 'role_id'] end;
  for k in select jsonb_object_keys(r) loop
    if not (k = any (allowed)) then return 'unknown_key'; end if;
  end loop;
  if jsonb_typeof(r -> 'user_id') is distinct from 'string' or (r ->> 'user_id') !~ '^[1-9]\d{0,17}$' then
    return 'bad_user';
  end if;
  -- (a separate statement: the cast runs only after the shape check passed)
  if (r ->> 'user_id')::bigint <> p_user then
    return 'bad_user';
  end if;
  if p_kind = 'assignments' then
    foreach k in array array['location_id', 'department_id', 'role_id'] loop
      if not (jsonb_typeof(coalesce(r -> k, 'null'::jsonb)) = 'null'
              or (jsonb_typeof(r -> k) = 'string' and (r ->> k) ~ '^[1-9]\d{0,17}$')) then
        return 'bad_id';
      end if;
    end loop;
    if jsonb_typeof(coalesce(r -> 'is_primary', 'null'::jsonb)) not in ('null', 'boolean') then return 'bad_value'; end if;
    if jsonb_typeof(r -> 'edge_key') is distinct from 'string'
       or (r ->> 'edge_key') <> (r ->> 'user_id') || ':' || coalesce(r ->> 'location_id', '-') || ':'
                                || coalesce(r ->> 'department_id', '-') || ':' || coalesce(r ->> 'role_id', '-') then
      return 'bad_edge_key';
    end if;
  else
    if jsonb_typeof(r -> 'wage_id') is distinct from 'string' or (r ->> 'wage_id') !~ '^[1-9]\d{0,17}$' then return 'bad_id'; end if;
    if not (jsonb_typeof(coalesce(r -> 'role_id', 'null'::jsonb)) = 'null'
            or (jsonb_typeof(r -> 'role_id') = 'string' and (r ->> 'role_id') ~ '^[1-9]\d{0,17}$')) then
      return 'bad_id';
    end if;
    if jsonb_typeof(r -> 'upcoming') is distinct from 'boolean' then return 'bad_value'; end if;
    if (r ->> 'wage_type') is null or (r ->> 'wage_type') not in ('hourly', 'weekly_salary', 'annual_salary') then return 'bad_value'; end if;
    -- at most 9 digits: always inside integer range, never negative, never fractional
    if jsonb_typeof(r -> 'wage_cents') is distinct from 'number' or (r ->> 'wage_cents') !~ '^\d{1,9}$' then
      return 'bad_value';
    end if;
    if not (jsonb_typeof(coalesce(r -> 'effective_date', 'null'::jsonb)) = 'null'
            or (jsonb_typeof(r -> 'effective_date') = 'string' and (r ->> 'effective_date') ~ '^\d{4}-\d{2}-\d{2}$')) then
      return 'bad_date';
    end if;
    if jsonb_typeof(r -> 'effective_date') = 'string' then
      begin
        perform (r ->> 'effective_date')::date;
      exception when others then
        return 'bad_date';
      end;
    end if;
  end if;
  return null;
end $$;
revoke all on function public.sevenshifts_snapshot_row_problem(text, bigint, jsonb) from public, anon, authenticated;

create function public.reconcile_sevenshifts_user_snapshot(p_run uuid, p_user bigint, p_kind text, p_complete boolean, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  r jsonb;
  v_seen integer := 0;
  v_inserted integer := 0;
  v_retired integer := 0;
  v_hit integer;
begin
  if p_kind is null or p_kind not in ('assignments', 'wages') then
    raise exception 'invalid_kind' using errcode = 'P0001';
  end if;
  if p_run is null or p_user is null or p_user <= 0 or p_complete is null
     or p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'invalid_payload' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.sevenshifts_sync_run_ids where id = p_run) then
    raise exception 'unknown_run' using errcode = 'P0001';
  end if;
  -- One snapshot of one user at a time (two runs reconciling the same user serialise here).
  perform pg_advisory_xact_lock(hashtextextended('sevenshifts-snap/' || p_kind || '/' || p_user::text, 0));

  -- Every row is validated BEFORE anything is written: an invalid row writes nothing at all. The lib
  -- passes only rows its normalizer accepted, so this is the RPC defending itself (r2 #2).
  for r in select value from jsonb_array_elements(p_rows) loop
    if public.sevenshifts_snapshot_row_problem(p_kind, p_user, r) is not null then
      raise exception 'invalid_payload' using errcode = 'P0001';
    end if;
  end loop;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_seen := v_seen + 1;
    if p_kind = 'assignments' then
      update public.sevenshifts_user_assignments
         set last_seen_run = p_run, is_primary = (r ->> 'is_primary')::boolean
       where edge_key = r ->> 'edge_key' and active;
      get diagnostics v_hit = row_count;
      if v_hit = 0 then
        insert into public.sevenshifts_user_assignments
          (edge_key, user_id, location_id, department_id, role_id, is_primary, first_seen_run, last_seen_run)
        values (r ->> 'edge_key', p_user, (r ->> 'location_id')::bigint, (r ->> 'department_id')::bigint,
                (r ->> 'role_id')::bigint, (r ->> 'is_primary')::boolean, p_run, p_run);
        v_inserted := v_inserted + 1;
      end if;
    else
      update public.sevenshifts_wages
         set last_seen_run = p_run, effective_date = (r ->> 'effective_date')::date, wage_type = r ->> 'wage_type',
             wage_cents = (r ->> 'wage_cents')::integer, role_id = (r ->> 'role_id')::bigint
       where user_id = p_user and wage_id = (r ->> 'wage_id')::bigint and upcoming = (r ->> 'upcoming')::boolean and active;
      get diagnostics v_hit = row_count;
      if v_hit = 0 then
        insert into public.sevenshifts_wages
          (user_id, wage_id, upcoming, effective_date, wage_type, wage_cents, role_id, first_seen_run, last_seen_run)
        values (p_user, (r ->> 'wage_id')::bigint, (r ->> 'upcoming')::boolean, (r ->> 'effective_date')::date,
                r ->> 'wage_type', (r ->> 'wage_cents')::integer, (r ->> 'role_id')::bigint, p_run, p_run);
        v_inserted := v_inserted + 1;
      end if;
    end if;
  end loop;

  if not p_complete then
    -- An incomplete snapshot (a failed request, a bad shape, ANY rejected row) adds and refreshes
    -- only: the missing row may be exactly the live one a retire would wrongly close.
    return jsonb_build_object('seen', v_seen, 'inserted', v_inserted, 'retired', 0, 'refused_retire', 'snapshot_incomplete');
  end if;

  if p_kind = 'assignments' then
    update public.sevenshifts_user_assignments
       set active = false, retired_run = p_run, retired_at = clock_timestamp()
     where user_id = p_user and active and last_seen_run <> p_run;
  else
    update public.sevenshifts_wages
       set active = false, retired_run = p_run, retired_at = clock_timestamp()
     where user_id = p_user and active and last_seen_run <> p_run;
  end if;
  get diagnostics v_retired = row_count;
  return jsonb_build_object('seen', v_seen, 'inserted', v_inserted, 'retired', v_retired);
end $$;
revoke all on function public.reconcile_sevenshifts_user_snapshot(uuid, bigint, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.reconcile_sevenshifts_user_snapshot(uuid, bigint, text, boolean, jsonb) to service_role;

-- ── GRANTS: RLS on, no policy, the service_role CEILING ─────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['sevenshifts_sync_run_ids', 'sevenshifts_sync_runs', 'sevenshifts_sync_state',
    'sevenshifts_locations', 'sevenshifts_departments', 'sevenshifts_roles', 'sevenshifts_users',
    'sevenshifts_availabilities', 'sevenshifts_time_off', 'sevenshifts_shifts', 'sevenshifts_time_punches',
    'sevenshifts_labor_settings', 'sevenshifts_user_assignments', 'sevenshifts_wages'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
  end loop;
  -- append-only by grant: the run ids and the ledger
  grant select, insert on public.sevenshifts_sync_run_ids, public.sevenshifts_sync_runs to service_role;
  -- state + the nine upsert mirrors
  grant select, insert, update on public.sevenshifts_sync_state, public.sevenshifts_locations, public.sevenshifts_departments,
    public.sevenshifts_roles, public.sevenshifts_users, public.sevenshifts_availabilities, public.sevenshifts_time_off,
    public.sevenshifts_shifts, public.sevenshifts_time_punches, public.sevenshifts_labor_settings to service_role;
  -- the reconciled mirrors: read only (their writer is the definer RPC)
  grant select on public.sevenshifts_user_assignments, public.sevenshifts_wages to service_role;
end $$;

do $$
declare
  t record;
  p text;
begin
  for t in select * from (values
      ('sevenshifts_sync_run_ids', 'SELECT,INSERT'), ('sevenshifts_sync_runs', 'SELECT,INSERT'),
      ('sevenshifts_sync_state', 'SELECT,INSERT,UPDATE'), ('sevenshifts_locations', 'SELECT,INSERT,UPDATE'),
      ('sevenshifts_departments', 'SELECT,INSERT,UPDATE'), ('sevenshifts_roles', 'SELECT,INSERT,UPDATE'),
      ('sevenshifts_users', 'SELECT,INSERT,UPDATE'), ('sevenshifts_availabilities', 'SELECT,INSERT,UPDATE'),
      ('sevenshifts_time_off', 'SELECT,INSERT,UPDATE'), ('sevenshifts_shifts', 'SELECT,INSERT,UPDATE'),
      ('sevenshifts_time_punches', 'SELECT,INSERT,UPDATE'), ('sevenshifts_labor_settings', 'SELECT,INSERT,UPDATE'),
      ('sevenshifts_user_assignments', 'SELECT'), ('sevenshifts_wages', 'SELECT')) as c(name, ceiling) loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t.name)::regclass) then
      raise exception '0268: RLS is off on %', t.name;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t.name) then
      raise exception '0268: % must have no policy', t.name;
    end if;
    if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = t.name
                and grantee in ('PUBLIC', 'anon', 'authenticated')) then
      raise exception '0268: a PostgREST role holds a grant on %', t.name;
    end if;
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege('service_role', 'public.' || t.name, p) <> (p = any (string_to_array(t.ceiling, ','))) then
        raise exception '0268: service_role % on % is not at its ceiling (%)', p, t.name, t.ceiling;
      end if;
    end loop;
  end loop;
  if exists (select 1 from information_schema.routine_privileges where routine_schema = 'public'
              and routine_name in ('reconcile_sevenshifts_user_snapshot', 'sevenshifts_snapshot_row_problem', 'sevenshifts_touch_pulled_at')
              and grantee in ('PUBLIC', 'anon', 'authenticated')) then
    raise exception '0268: a PostgREST role can execute a 0268 function';
  end if;
  if not has_function_privilege('service_role', 'public.reconcile_sevenshifts_user_snapshot(uuid, bigint, text, boolean, jsonb)', 'EXECUTE') then
    raise exception '0268: service_role cannot execute the reconciler';
  end if;
end $$;

-- ── THE CRON LEASE: 0243 re-emitted with 'sevenshifts-sync' ─────────────────────────────────────
alter table public.cron_route_leases drop constraint cron_route_leases_job_check,
  add constraint cron_route_leases_job_check check (job in ('toast-sales-today', 'toast-catering-scan', 'sevenshifts-sync'));

create or replace function public.claim_cron_route(p_job text)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare claimed text;
begin
  if p_job is null or p_job not in ('toast-sales-today', 'toast-catering-scan', 'sevenshifts-sync') then
    raise exception 'invalid_cron_route';
  end if;
  -- ON CONFLICT locks the single route row and rechecks the expiry under that lock.
  -- Use the database clock, never caller timestamps or a ten-minute fixed bucket.
  insert into public.cron_route_leases (job, lease_until)
    values (p_job, clock_timestamp() + interval '330 seconds')
  on conflict (job) do update
    set lease_until = clock_timestamp() + interval '330 seconds'
    where cron_route_leases.lease_until <= clock_timestamp()
  returning job into claimed;
  return claimed is not null;
end $$;
revoke all on function public.claim_cron_route(text) from public, anon, authenticated;
grant execute on function public.claim_cron_route(text) to service_role;

commit;
