-- Migration 0342_demand_signals_replay
-- AUTHORED 2026-11-17 (item 4 PR 1, CO Claude). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod on Juan's word.
-- Plan: CHIEF 03-PROJECTS/co-ops/2026-11-15-juan-product-notes/item-04-DEMAND-SIGNALS-PLAN-r2.md (Astra r2: no P1),
-- with Astra r2's P2 #1 and P2 #2 folded in:
--   P2 #1  A forecast plus a fingerprint cannot be replayed. Every input the engine read at its boundary is
--          stored as an IMMUTABLE, content-addressed blob (demand_input_blobs); a forecast row names the
--          manifest of its inputs, and the replay (lib/demand-signals/replay.ts) re-runs the engine over them.
--   P2 #2  The holdout is read once per model hash PER TARGET x DECISION LEAD (demand_holdout_reads), because a
--          qualification authorizes exactly one target and one lead (lib/demand-signals/scoring-shared.ts).
--
-- WHAT THIS IS. Five append-only tables and their five writers. Nothing here changes a par, a prep number or a
-- schedule: no existing table, function, trigger or grant is touched, and nothing reads these tables on an
-- operational path. The nightly writes here only when DEMAND_LEDGER=1 (unset = no call at all).
--   demand_input_blobs       text named by its sha256. The database recomputes the hash, so a blob can never be
--                            stored under a name its content does not have. available_at = when WE held it.
--   demand_models            a registered model (a baseline engine or a candidate): its frozen spec is a blob,
--                            its hash is its name, and its feature class says whether the feature is knowable
--                            at the decision ('hindsight' = E0, which can never read a holdout).
--   demand_forecast_ledger   one row per (shop, surface, model, decision date, valid date): what was forecast,
--                            from which inputs. THE E2 CLOCK: a row can only be recorded ON its decision date
--                            (the database's ET date), and the FIRST write wins. A forecast is never back-dated
--                            and never revised.
--   demand_target_freezes    the realized value of a date, frozen no earlier than D+4 (after the T-3 recapture
--                            closes), with its source fingerprint. A day that was not captured is frozen as
--                            'not_covered' (excluded from both arms and counted), never as zero.
--   demand_target_revisions  a later, different reading of a frozen date. Flagged and reported separately; the
--                            score stays on the frozen target.
--   demand_holdout_reads     one row per (model hash, target, lead). A second claim answers 'already_read'.
--                            The window must start after the model was registered and end on a frozen day.
-- APPEND-ONLY BY GRANT: deny-all RLS, service_role SELECT only, every write through a SECURITY DEFINER writer.
-- There is NO delete path. The plan's 25-month retention needs its own reviewed sweep, which must keep every
-- blob a ledger row, a freeze or a model still names.
-- NOT HERE (later PRs): source register and signal tables (PR 2), state machine and persisted terms (PR 4),
-- the page (PR 5), chips (PR 6), AI (PR 7). No cron lease is added: the pass rides the nightly.
-- Proof: tests/demand-signals-0342-harness.test.ts (PGlite, the real file, driven by the real TS replay).
begin;

do $$ begin
  if to_regclass('public.locations') is null then raise exception '0342: missing locations'; end if;
  if to_regclass('public.demand_input_blobs') is not null or to_regclass('public.demand_forecast_ledger') is not null
    or to_regprocedure('public.demand_today_et()') is not null then
    raise exception '0342: already applied'; end if;
end $$;

-- The one clock of this layer: the ET calendar date, read from the database.
create function public.demand_today_et() returns date language sql volatile set search_path = pg_catalog, public as $$
  select (clock_timestamp() at time zone 'America/New_York')::date
$$;

create table public.demand_input_blobs (
 hash text primary key check (hash ~ '^[0-9a-f]{64}$'),
 kind text not null check (kind in ('manifest','par_catalog','par_guard','par_day','labor_inputs','prep_inputs','forecast','target','model')),
 payload text not null,
 bytes integer not null check (bytes between 2 and 2097152),
 available_at timestamptz not null default clock_timestamp(),
 check (bytes = octet_length(payload))
);

create table public.demand_models (
 model_hash text primary key references public.demand_input_blobs(hash),
 surface text not null check (surface in ('pars','labor','prep')),
 model_key text not null check (model_key ~ '^[a-z0-9_]{1,40}$'),
 feature_class text not null check (feature_class in ('baseline','known_in_advance','hindsight')),
 registered_on date not null default public.demand_today_et(),
 registered_at timestamptz not null default clock_timestamp()
);

create table public.demand_forecast_ledger (
 id uuid primary key default gen_random_uuid(),
 location_id uuid not null references public.locations(id),
 surface text not null check (surface in ('pars','labor','prep')),
 model_hash text not null references public.demand_models(model_hash),
 engine text not null check (length(engine) between 1 and 80),
 decision_date date not null,
 decision_at timestamptz not null default clock_timestamp(),
 valid_date date not null,
 lead_days integer not null check (lead_days between 0 and 14),
 manifest_hash text not null references public.demand_input_blobs(hash),
 forecast_hash text not null references public.demand_input_blobs(hash),
 summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object' and length(summary::text) <= 4000),
 check (lead_days = valid_date - decision_date),
 unique (location_id, surface, model_hash, decision_date, valid_date)
);
create index demand_forecast_ledger_valid on public.demand_forecast_ledger(location_id, surface, valid_date);

create table public.demand_target_freezes (
 location_id uuid not null references public.locations(id),
 target text not null check (target ~ '^[a-z_]{1,40}$'),
 valid_date date not null,
 coverage text not null check (coverage in ('covered','not_covered')),
 payload_hash text references public.demand_input_blobs(hash),
 source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
 frozen_on date not null default public.demand_today_et(),
 frozen_at timestamptz not null default clock_timestamp(),
 primary key (location_id, target, valid_date),
 check ((coverage = 'covered') = (payload_hash is not null)),
 check (frozen_on >= valid_date + 4)
);

create table public.demand_target_revisions (
 id uuid primary key default gen_random_uuid(),
 location_id uuid not null,
 target text not null,
 valid_date date not null,
 coverage text not null check (coverage in ('covered','not_covered')),
 payload_hash text references public.demand_input_blobs(hash),
 source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
 seen_on date not null default public.demand_today_et(),
 seen_at timestamptz not null default clock_timestamp(),
 foreign key (location_id, target, valid_date) references public.demand_target_freezes(location_id, target, valid_date),
 check ((coverage = 'covered') = (payload_hash is not null)),
 unique (location_id, target, valid_date, source_fingerprint)
);

create table public.demand_holdout_reads (
 id uuid primary key default gen_random_uuid(),
 model_hash text not null references public.demand_models(model_hash),
 target text not null check (target ~ '^[a-z_]{1,40}$'),
 lead_days integer not null check (lead_days between 0 and 14),
 window_from date not null,
 window_to date not null,
 reader text not null check (length(reader) between 1 and 80),
 read_at timestamptz not null default clock_timestamp(),
 check (window_to >= window_from),
 unique (model_hash, target, lead_days)
);

-- Store blobs: [{kind, hash, text}]. The hash is recomputed here; an unchanged blob writes no row.
create function public.demand_blobs_put(p_blobs jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare b jsonb; v_text text; v_hash text; v_kind text; v_stored integer := 0; v_existed integer := 0; v_rows integer;
begin
  if p_blobs is null or jsonb_typeof(p_blobs) <> 'array' or jsonb_array_length(p_blobs) > 200 then raise exception 'blobs_invalid'; end if;
  for b in select * from jsonb_array_elements(p_blobs) loop
    v_text := b->>'text'; v_hash := b->>'hash'; v_kind := b->>'kind';
    if v_text is null or v_hash is null or v_kind is null then raise exception 'blobs_invalid'; end if;
    if encode(sha256(convert_to(v_text, 'UTF8')), 'hex') <> v_hash then raise exception 'blob_hash_mismatch'; end if;
    insert into public.demand_input_blobs(hash, kind, payload, bytes) values (v_hash, v_kind, v_text, octet_length(v_text))
      on conflict (hash) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 1 then v_stored := v_stored + 1; else v_existed := v_existed + 1; end if;
  end loop;
  return jsonb_build_object('stored', v_stored, 'existed', v_existed);
end $$;

-- Register a model. Its spec blob (kind 'model') must already be stored: the hash of the spec IS the model.
create function public.demand_model_register(p_model_hash text, p_surface text, p_model_key text, p_feature_class text)
returns text language plpgsql security definer set search_path = pg_catalog, public as $$
declare m public.demand_models%rowtype;
begin
  if not exists (select 1 from public.demand_input_blobs where hash = p_model_hash and kind = 'model') then raise exception 'model_blob_missing'; end if;
  insert into public.demand_models(model_hash, surface, model_key, feature_class) values (p_model_hash, p_surface, p_model_key, p_feature_class)
    on conflict (model_hash) do nothing;
  if found then return 'registered'; end if;
  select * into m from public.demand_models where model_hash = p_model_hash;
  if m.surface is distinct from p_surface or m.model_key is distinct from p_model_key or m.feature_class is distinct from p_feature_class then
    raise exception 'model_conflict'; end if;
  return 'exists';
end $$;

-- Record forecasts made TODAY: entries = [{valid_date, forecast_hash, summary}]. First write wins.
create function public.demand_forecast_record(p_location_id uuid, p_surface text, p_model_hash text, p_engine text,
  p_manifest_hash text, p_decision_date date, p_entries jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare e jsonb; v_recorded integer := 0; v_kept integer := 0; v_rows integer; v_valid date; v_hash text;
begin
  if p_decision_date is null or p_decision_date <> public.demand_today_et() then raise exception 'decision_date_not_today'; end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) > 40 then raise exception 'entries_invalid'; end if;
  if not exists (select 1 from public.demand_models where model_hash = p_model_hash and surface = p_surface) then raise exception 'model_unknown'; end if;
  if not exists (select 1 from public.demand_input_blobs where hash = p_manifest_hash) then raise exception 'blob_missing'; end if;
  for e in select * from jsonb_array_elements(p_entries) loop
    v_valid := (e->>'valid_date')::date; v_hash := e->>'forecast_hash';
    if v_valid is null or v_valid < p_decision_date or v_valid - p_decision_date > 14 then raise exception 'entries_invalid'; end if;
    if not exists (select 1 from public.demand_input_blobs where hash = v_hash and kind = 'forecast') then raise exception 'blob_missing'; end if;
    insert into public.demand_forecast_ledger(location_id, surface, model_hash, engine, decision_date, valid_date, lead_days, manifest_hash, forecast_hash, summary)
      values (p_location_id, p_surface, p_model_hash, p_engine, p_decision_date, v_valid, v_valid - p_decision_date, p_manifest_hash, v_hash,
        coalesce(e->'summary', '{}'::jsonb))
      on conflict (location_id, surface, model_hash, decision_date, valid_date) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 1 then v_recorded := v_recorded + 1; else v_kept := v_kept + 1; end if;
  end loop;
  return jsonb_build_object('recorded', v_recorded, 'kept', v_kept);
end $$;

-- Freeze a target at D+4 or later. A later, different reading is a REVISION beside the frozen row.
create function public.demand_target_freeze(p_location_id uuid, p_target text, p_valid_date date, p_coverage text,
  p_payload_hash text, p_fingerprint text)
returns text language plpgsql security definer set search_path = pg_catalog, public as $$
declare f public.demand_target_freezes%rowtype;
begin
  if p_valid_date is null or public.demand_today_et() < p_valid_date + 4 then raise exception 'target_freeze_too_early'; end if;
  if p_coverage = 'covered' and not exists (select 1 from public.demand_input_blobs where hash = p_payload_hash and kind = 'target') then
    raise exception 'blob_missing'; end if;
  insert into public.demand_target_freezes(location_id, target, valid_date, coverage, payload_hash, source_fingerprint)
    values (p_location_id, p_target, p_valid_date, p_coverage, p_payload_hash, p_fingerprint)
    on conflict (location_id, target, valid_date) do nothing;
  if found then return 'frozen'; end if;
  select * into f from public.demand_target_freezes where location_id = p_location_id and target = p_target and valid_date = p_valid_date;
  if f.source_fingerprint = p_fingerprint and f.coverage = p_coverage then return 'kept'; end if;
  insert into public.demand_target_revisions(location_id, target, valid_date, coverage, payload_hash, source_fingerprint)
    values (p_location_id, p_target, p_valid_date, p_coverage, p_payload_hash, p_fingerprint)
    on conflict (location_id, target, valid_date, source_fingerprint) do nothing;
  return 'revised';
end $$;

-- Claim the ONE read of a holdout for a model hash, a target and a decision lead.
create function public.demand_holdout_claim(p_model_hash text, p_target text, p_lead_days integer, p_from date, p_to date, p_reader text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare m public.demand_models%rowtype; r public.demand_holdout_reads%rowtype; v_id uuid;
begin
  select * into m from public.demand_models where model_hash = p_model_hash;
  if not found then raise exception 'model_unknown'; end if;
  if m.feature_class = 'hindsight' then raise exception 'holdout_refused_hindsight'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'holdout_window_invalid'; end if;
  if p_from <= m.registered_on then raise exception 'holdout_before_registration'; end if;
  if public.demand_today_et() < p_to + 4 then raise exception 'holdout_not_frozen'; end if;
  insert into public.demand_holdout_reads(model_hash, target, lead_days, window_from, window_to, reader)
    values (p_model_hash, p_target, p_lead_days, p_from, p_to, p_reader)
    on conflict (model_hash, target, lead_days) do nothing returning id into v_id;
  if v_id is not null then return jsonb_build_object('status', 'granted', 'id', v_id); end if;
  select * into r from public.demand_holdout_reads where model_hash = p_model_hash and target = p_target and lead_days = p_lead_days;
  return jsonb_build_object('status', 'already_read', 'id', r.id, 'read_at', r.read_at, 'window_from', r.window_from, 'window_to', r.window_to);
end $$;

-- Ceilings: deny-all RLS with the four explicit denials, service_role SELECT only, writers service_role only.
do $$ declare t text; f regprocedure; begin
  foreach t in array array['demand_input_blobs','demand_models','demand_forecast_ledger','demand_target_freezes','demand_target_revisions','demand_holdout_reads'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (false)', t || '_no_user_select', t);
    execute format('create policy %I on public.%I for insert with check (false)', t || '_no_user_insert', t);
    execute format('create policy %I on public.%I for update using (false)', t || '_no_user_update', t);
    execute format('create policy %I on public.%I for delete using (false)', t || '_no_user_delete', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to service_role', t);
  end loop;
  foreach f in array array[
    'public.demand_today_et()'::regprocedure,
    'public.demand_blobs_put(jsonb)'::regprocedure,
    'public.demand_model_register(text,text,text,text)'::regprocedure,
    'public.demand_forecast_record(uuid,text,text,text,text,date,jsonb)'::regprocedure,
    'public.demand_target_freeze(uuid,text,date,text,text,text)'::regprocedure,
    'public.demand_holdout_claim(text,text,integer,date,date,text)'::regprocedure] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

do $$ declare t text; f regprocedure; p text; begin
  foreach t in array array['demand_input_blobs','demand_models','demand_forecast_ledger','demand_target_freezes','demand_target_revisions','demand_holdout_reads'] loop
    if not has_table_privilege('service_role', 'public.' || t, 'SELECT') then raise exception '0342: % lacks service_role SELECT', t; end if;
    foreach p in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege('service_role', 'public.' || t, p) then raise exception '0342: service_role holds % on %', p, t; end if;
    end loop;
    foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] loop
      if has_table_privilege('anon', 'public.' || t, p) or has_table_privilege('authenticated', 'public.' || t, p) then
        raise exception '0342: PostgREST role holds % on %', p, t; end if;
    end loop;
  end loop;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public'
     and table_name in ('demand_input_blobs','demand_models','demand_forecast_ledger','demand_target_freezes','demand_target_revisions','demand_holdout_reads')
     and (grantee in ('PUBLIC','anon','authenticated') or (grantee = 'service_role' and privilege_type <> 'SELECT'))) then
    raise exception '0342: unexpected demand table grant'; end if;
  foreach f in array array[
    'public.demand_today_et()'::regprocedure,
    'public.demand_blobs_put(jsonb)'::regprocedure,
    'public.demand_model_register(text,text,text,text)'::regprocedure,
    'public.demand_forecast_record(uuid,text,text,text,text,date,jsonb)'::regprocedure,
    'public.demand_target_freeze(uuid,text,date,text,text,text)'::regprocedure,
    'public.demand_holdout_claim(text,text,integer,date,date,text)'::regprocedure] loop
    if not has_function_privilege('service_role', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE')
      or has_function_privilege('authenticated', f, 'EXECUTE')
      or exists (select 1 from pg_proc pr, lateral aclexplode(pr.proacl) a where pr.oid = f and a.grantee = 0) then
      raise exception '0342: RPC escape %', f; end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
