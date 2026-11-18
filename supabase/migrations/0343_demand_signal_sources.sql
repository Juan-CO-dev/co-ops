-- Migration 0343_demand_signal_sources
-- AUTHORED 2026-11-18 (item 4 PR 2, CO Claude). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod on Juan's word.
-- Plan: CHIEF 03-PROJECTS/co-ops/2026-11-15-juan-product-notes/item-04-DEMAND-SIGNALS-PLAN-r2.md, sections 6 and 7,
-- with Astra r2 P2 #3 (revoking a source stops USE of its stored signals, not only collection) and Juan's
-- answers of 2026-11-18 (free sources only; manual events by GM+ AND automatic discovery; MoO+ approves).
--
-- WHAT THIS IS. The SOURCE REGISTER, its verification gate, the signal tables and the manual-event writer.
-- Nothing here changes a par, a prep number or a schedule, and nothing reads these tables on an operational
-- path. EVERY SOURCE IS 'unverified' AT SHIP: this file inserts no source and no status event. Sources are
-- tenant DATA, registered by scripts/seed-demand-sources.ts through demand_source_register (never a migration).
--   demand_sources         one row per DEFINITION of a source (endpoint, terms, gate, adapter version). The
--                          definition is canonical JSON text named by its sha256, recomputed here; the typed
--                          columns are extracted from that text here, so they cannot disagree with it. A
--                          source's CURRENT definition is its greatest seq. Append-only.
--   demand_source_events   'verified' / 'revoked', by whom, when, with a note. Append-only. A source's STATUS
--                          is the latest event ON ITS CURRENT DEFINITION; no event = 'unverified'. So a changed
--                          endpoint, adapter version or terms text is unverified again until a person marks it.
--   demand_signal_runs     the run ledger (proves freshness; an unchanged fetch writes a run and no row).
--   demand_weather_hourly  hourly forecast vintages: one wide typed row per shop, valid hour and vintage. No
--                          nullable key. The four times: valid_hour (valid), issued_at (by the source),
--                          available_at (when WE held it); the decision time is the reader's p_as_of.
--   demand_day_events      day-grain events: feed vintages (alerts, discovered events) AND manual entries by
--                          GM+ (origin 'manual', a correction chain). location NULL = every shop, made unique
--                          through the generated scope_key. A feed event that LEAVES its feed before its end
--                          (cancelled, or replaced) gets a WITHDRAWAL vintage (withdrawn = true): the reader
--                          stops returning it from then on, and an earlier as-of still sees it.
-- TERMS EVIDENCE: a definition whose terms are 'verified' names the page AND quotes the sentence (terms_url,
-- terms_quote of 10+ characters). Refused by name (source_terms_evidence_missing) at registration, by the
-- table's own check, and again on the row a person marks verified.
-- THE GATE IS IN SQL AS WELL AS IN CODE. Every writer of a sourced row (demand_weather_ingest,
-- demand_events_ingest) and every reader of one (demand_usable_weather, demand_usable_day_events) asks the
-- register for the CURRENT status inside its own statement / transaction, under the source's advisory key
-- (shared; demand_source_mark takes it exclusive). A source that is not 'verified' at that instant:
--   collect  the writer raises source_unverified / source_revoked and writes nothing (no row, no run).
--   compute, render  the reader returns no row of that source. The stored rows are KEPT (history).
--   accept   demand_sources_assert_usable(ids) is the check a later accept writer calls inside its write.
-- Only a definition whose gate is 'allow' or 'allow_with_conditions' can ever be marked verified; 'pending_terms'
-- (nobody has read its terms yet), 'named_only' (no feed: people enter it by hand) and 'refuse' (its terms
-- forbid it) are refused by name (source_not_ingestible). Paid sources cannot be registered (cost = 'free').
-- WHO: marking = an ACTIVE moo / owner / cgs (trusted role, re-read on the users row here), with a note; it
-- writes its own destructive audit row (demand_source.mark: who, when, which definition; never the note).
-- Manual events = an active gm (own shop only, an active membership) or moo / owner / cgs (any shop, or all).
-- APPEND-ONLY BY GRANT: deny-all RLS, service_role SELECT only, every write through a SECURITY DEFINER
-- function. There is NO delete path; a revocation deletes nothing. Retention (25 months) is its own later sweep.
-- ALSO: re-emits claim_cron_route (0337's body, md5-guarded) with 'demand-signals' added; no job is dropped.
-- Proof: tests/demand-signals-0343-harness.test.ts (PGlite, the real file).
--
-- PRE-FLIGHT (MCP, before apply):
--   select to_regprocedure('public.demand_today_et()');           -- present (0342)
--   select to_regclass('public.demand_sources');                  -- null
--   select md5(regexp_replace(prosrc, '[^\x21-\x7E]+', '', 'g')) from pg_proc where proname = 'claim_cron_route';  -- the value below
begin;

do $$ declare v_jobs text[]; v_live text; begin
  if to_regprocedure('public.demand_today_et()') is null or to_regclass('public.demand_input_blobs') is null then
    raise exception '0343: apply 0342 first'; end if;
  if to_regclass('public.locations') is null or to_regclass('public.users') is null or to_regclass('public.user_locations') is null
    or to_regclass('public.audit_log') is null then raise exception '0343: missing locations / users / user_locations / audit_log'; end if;
  if to_regclass('public.demand_sources') is not null or to_regclass('public.demand_day_events') is not null then
    raise exception '0343: already applied'; end if;
  if to_regclass('public.cron_route_leases') is null or to_regprocedure('public.claim_cron_route(text)') is null then
    raise exception '0343: missing cron_route_leases / claim_cron_route'; end if;
  select array_agg(distinct m[1] order by m[1]) into v_jobs
    from pg_constraint c, lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z-]+)''', 'g') m
    where c.conrelid = 'public.cron_route_leases'::regclass and c.conname = 'cron_route_leases_job_check' and c.contype = 'c' and c.convalidated;
  if v_jobs is distinct from array['catering-inbox-delivery','fact-build','meta-leads','schedule-draft','sevenshifts-sync','toast-catering-scan','toast-sales-today']::text[] then
    raise exception '0343: cron_route_leases_job_check is not the 0337 seven-job union (%)', v_jobs; end if;
  select md5(regexp_replace(p.prosrc, '[^\x21-\x7E]+', '', 'g')) into v_live from pg_proc p where p.oid = to_regprocedure('public.claim_cron_route(text)');
  if v_live is distinct from '170e841ae33f33e666ca30b71bd61bea' then
    raise exception '0343: the live body of claim_cron_route (md5 %) is not its 0337 definition -- a later definer exists; re-emit from it. Refusing.', v_live; end if;
end $$;

-- ── 1. the register ─────────────────────────────────────────────────────────────────────────────
create table public.demand_sources (
 seq bigint generated always as identity primary key,
 source_id text not null check (source_id ~ '^[a-z0-9_]{2,40}$'),
 definition_hash text not null check (definition_hash ~ '^[0-9a-f]{64}$'),
 definition text not null check (octet_length(definition) between 2 and 16384),
 name text not null check (length(btrim(name)) between 2 and 120),
 category text not null check (category in ('weather','government_status','holiday_calendar','transit','street_closure',
   'public_event','school_calendar','sports','venue','race','news','other')),
 cost text not null check (cost = 'free'),
 gate text not null check (gate in ('allow','allow_with_conditions','pending_terms','named_only','refuse')),
 terms_status text not null check (terms_status in ('verified','unverified')),
 terms_url text check (terms_url ~ '^https://'),
 terms_quote text,
 adapter text check (adapter ~ '^[a-z0-9_]{2,40}@[0-9]{1,4}$'),
 registered_at timestamptz not null default clock_timestamp(),
 -- A source whose terms nobody has read can never be ingestible, and a 'verified' terms claim carries its
 -- evidence: the page AND the sentence quoted from it (definitionProblem, sources-shared.ts: the same rule).
 constraint demand_sources_terms_evidence check (terms_status = 'unverified'
   or (terms_url is not null and terms_quote is not null and length(btrim(terms_quote)) >= 10)),
 check (gate in ('pending_terms','named_only','refuse') or terms_status = 'verified')
);
create index demand_sources_current on public.demand_sources (source_id, seq desc);
comment on table public.demand_sources is
  '0343: the demand-signal SOURCE REGISTER. One row per definition; the current definition of a source is its greatest seq. Written only by demand_source_register. Status lives in demand_source_events. Deny-all RLS; service_role SELECT only.';

create table public.demand_source_events (
 seq bigint generated always as identity primary key,
 source_seq bigint not null references public.demand_sources(seq),
 source_id text not null,
 status text not null check (status in ('verified','revoked')),
 actor_id uuid not null references public.users(id),
 actor_role text not null,
 note text not null check (length(btrim(note)) between 3 and 500),
 created_at timestamptz not null default clock_timestamp()
);
create index demand_source_events_latest on public.demand_source_events (source_seq, seq desc);

-- The advisory key of one source. demand_source_mark takes it EXCLUSIVE; every use takes it SHARED.
create function public.demand_source_key(p_source_id text) returns bigint language sql immutable set search_path = pg_catalog, public as $$
  select hashtextextended('demand_source:' || p_source_id, 0)
$$;

-- THE one reading of the register: every source at its current definition, with its status NOW.
create function public.demand_source_states()
returns table (source_id text, source_seq bigint, definition_hash text, name text, category text, gate text, terms_status text,
  terms_url text, adapter text, status text, marked_at timestamptz, marked_by uuid)
language sql stable security definer set search_path = pg_catalog, public as $$
  select s.source_id, s.seq, s.definition_hash, s.name, s.category, s.gate, s.terms_status, s.terms_url, s.adapter,
    coalesce(e.status, 'unverified'), e.created_at, e.actor_id
  from public.demand_sources s
  left join lateral (select ev.status, ev.created_at, ev.actor_id from public.demand_source_events ev
    where ev.source_seq = s.seq order by ev.seq desc limit 1) e on true
  where s.seq = (select max(c.seq) from public.demand_sources c where c.source_id = s.source_id)
$$;

-- The status of one source NOW. An unregistered source is 'unverified'.
create function public.demand_source_status(p_source_id text) returns text
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((select st.status from public.demand_source_states() st where st.source_id = p_source_id), 'unverified')
$$;

-- The gate every USE passes, inside the caller's transaction: the shared key, then the status now.
-- p_definition_hash (collection only): the definition the adapter in code was built for must be the current one.
create function public.demand_source_gate(p_source_id text, p_definition_hash text) returns bigint
language plpgsql security definer set search_path = pg_catalog, public as $$
declare st record;
begin
  if p_source_id is null then raise exception 'source_unverified'; end if;
  perform pg_advisory_xact_lock_shared(public.demand_source_key(p_source_id));
  select * into st from public.demand_source_states() s where s.source_id = p_source_id;
  if not found then raise exception 'source_unverified'; end if;
  if st.status = 'revoked' then raise exception 'source_revoked'; end if;
  if st.status <> 'verified' then raise exception 'source_unverified'; end if;
  if p_definition_hash is not null and st.definition_hash is distinct from p_definition_hash then raise exception 'source_unverified'; end if;
  return st.source_seq;
end $$;

-- The check an ACCEPT writer (PR 6) calls inside its own write. Keys are taken in sorted order.
create function public.demand_sources_assert_usable(p_source_ids text[]) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_id text;
begin
  for v_id in select distinct x from unnest(coalesce(p_source_ids, '{}'::text[])) x order by x loop
    perform public.demand_source_gate(v_id, null);
  end loop;
end $$;

-- Register a definition (canonical JSON text). The hash is recomputed and the columns are read from the text.
-- An unchanged current definition writes nothing; any other text is a NEW definition, unverified.
create function public.demand_source_register(p_definition text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare d jsonb; v_id text; v_hash text; v_cur public.demand_sources%rowtype; v_seq bigint; v_adapter text;
begin
  if p_definition is null then raise exception 'source_definition_invalid'; end if;
  begin d := p_definition::jsonb; exception when others then raise exception 'source_definition_invalid'; end;
  if jsonb_typeof(d) <> 'object' or jsonb_typeof(d->'sourceId') is distinct from 'string' then raise exception 'source_definition_invalid'; end if;
  v_id := d->>'sourceId';
  v_hash := encode(sha256(convert_to(p_definition, 'UTF8')), 'hex');
  if d->'adapter' is not null and jsonb_typeof(d->'adapter') = 'object' then
    v_adapter := (d->'adapter'->>'key') || '@' || (d->'adapter'->>'version');
  end if;
  -- Terms recorded as read carry their evidence: the page AND the quoted sentence. Refused by name.
  if d->>'termsStatus' = 'verified' and (d->>'termsUrl' is null or length(btrim(coalesce(d->>'termsQuote', ''))) < 10) then
    raise exception 'source_terms_evidence_missing'; end if;
  perform pg_advisory_xact_lock(public.demand_source_key(v_id));
  select * into v_cur from public.demand_sources s where s.source_id = v_id order by s.seq desc limit 1;
  if found and v_cur.definition_hash = v_hash then return jsonb_build_object('result', 'exists', 'seq', v_cur.seq, 'definition_hash', v_hash); end if;
  insert into public.demand_sources (source_id, definition_hash, definition, name, category, cost, gate, terms_status, terms_url, terms_quote, adapter)
  values (v_id, v_hash, p_definition, d->>'name', d->>'category', d->>'cost', d->>'gate', d->>'termsStatus', d->>'termsUrl', d->>'termsQuote', v_adapter)
  returning seq into v_seq;
  insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
  values (null, null, 'demand_source.register', 'demand_sources', null,
    jsonb_build_object('source_id', v_id, 'source_seq', v_seq, 'definition_hash', v_hash, 'gate', d->>'gate',
      'replaced_seq', v_cur.seq, 'actor_context', 'seed_demand_sources'), false);
  return jsonb_build_object('result', case when v_cur.seq is null then 'registered' else 'redefined' end, 'seq', v_seq, 'definition_hash', v_hash);
end $$;

-- Mark a source verified or revoked. Refusals by name: demand_source_forbidden, demand_source_invalid,
-- source_unknown, source_definition_moved (not the definition the person read), source_not_ingestible,
-- source_terms_evidence_missing (verifying a row whose terms are not recorded as read with page and quote),
-- source_status_unchanged.
create function public.demand_source_mark(p_actor uuid, p_source_id text, p_definition_hash text, p_status text, p_note text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_role text; v_cur public.demand_sources%rowtype; v_before text; v_seq bigint;
begin
  if p_actor is not null then
    select u.role into v_role from public.users u where u.id = p_actor and u.active and u.role in ('owner', 'cgs', 'moo') for share;
  end if;
  if v_role is null then raise exception 'demand_source_forbidden'; end if;
  if p_source_id is null or p_status is null or p_status not in ('verified', 'revoked')
    or length(btrim(coalesce(p_note, ''))) not between 3 and 500 then raise exception 'demand_source_invalid'; end if;
  perform pg_advisory_xact_lock(public.demand_source_key(p_source_id));
  select * into v_cur from public.demand_sources s where s.source_id = p_source_id order by s.seq desc limit 1;
  if not found then raise exception 'source_unknown'; end if;
  if v_cur.definition_hash is distinct from p_definition_hash then raise exception 'source_definition_moved'; end if;
  if p_status = 'verified' and v_cur.gate not in ('allow', 'allow_with_conditions') then raise exception 'source_not_ingestible'; end if;
  if p_status = 'verified' and (v_cur.terms_status is distinct from 'verified' or v_cur.terms_url is null
      or length(btrim(coalesce(v_cur.terms_quote, ''))) < 10) then raise exception 'source_terms_evidence_missing'; end if;
  select coalesce((select e.status from public.demand_source_events e where e.source_seq = v_cur.seq order by e.seq desc limit 1), 'unverified') into v_before;
  if v_before = p_status then raise exception 'source_status_unchanged'; end if;
  insert into public.demand_source_events (source_seq, source_id, status, actor_id, actor_role, note)
  values (v_cur.seq, p_source_id, p_status, p_actor, v_role, btrim(p_note)) returning seq into v_seq;
  insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, before_state, after_state, metadata, destructive)
  values (p_actor, v_role, 'demand_source.mark', 'demand_sources', null,
    jsonb_build_object('status', v_before), jsonb_build_object('status', p_status),
    jsonb_build_object('source_id', p_source_id, 'source_seq', v_cur.seq, 'definition_hash', v_cur.definition_hash, 'event_seq', v_seq, 'has_note', true),
    true);
  return jsonb_build_object('event_seq', v_seq, 'status', p_status, 'source_seq', v_cur.seq);
end $$;

-- ── 2. the signal tables ────────────────────────────────────────────────────────────────────────
create table public.demand_signal_runs (
 id uuid primary key default gen_random_uuid(),
 source_id text not null,
 source_seq bigint not null references public.demand_sources(seq),
 location_id uuid references public.locations(id),
 feed text not null check (feed in ('weather_hourly','day_events')),
 outcome text not null check (outcome in ('written','unchanged','failed')),
 error_code text check (error_code ~ '^[a-z_]{1,40}$'),
 rows_seen integer not null check (rows_seen >= 0),
 rows_written integer not null check (rows_written >= 0 and rows_written <= rows_seen),
 -- day_events only: stored events this run found GONE from the feed before their end (a withdrawal vintage each).
 rows_withdrawn integer not null default 0 check (rows_withdrawn >= 0),
 started_at timestamptz not null,
 finished_at timestamptz not null default clock_timestamp(),
 check ((outcome = 'failed') = (error_code is not null)),
 check ((outcome = 'written') = (rows_written + rows_withdrawn > 0)),
 check (rows_withdrawn = 0 or feed = 'day_events')
);
create index demand_signal_runs_recent on public.demand_signal_runs (source_id, feed, finished_at desc);

create table public.demand_weather_hourly (
 id bigint generated always as identity primary key,
 source_id text not null,
 source_seq bigint not null references public.demand_sources(seq),
 run_id uuid not null references public.demand_signal_runs(id),
 location_id uuid not null references public.locations(id),
 valid_hour timestamptz not null,
 issued_at timestamptz not null,
 available_at timestamptz not null default clock_timestamp(),
 content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
 temperature_f numeric(5,1) not null check (temperature_f between -80 and 140),
 precip_probability_pct smallint check (precip_probability_pct between 0 and 100),
 wind_speed_mph numeric(5,1) check (wind_speed_mph between 0 and 250),
 relative_humidity_pct smallint check (relative_humidity_pct between 0 and 100),
 is_daytime boolean not null,
 condition text not null check (length(condition) between 1 and 160)
);
create index demand_weather_hourly_vintage on public.demand_weather_hourly (location_id, valid_hour, available_at desc, issued_at desc, id desc);

create table public.demand_day_events (
 id uuid primary key default gen_random_uuid(),
 seq bigint generated always as identity unique,
 origin text not null check (origin in ('manual','feed')),
 source_id text,
 source_seq bigint references public.demand_sources(seq),
 run_id uuid references public.demand_signal_runs(id),
 location_id uuid references public.locations(id),
 scope_key text generated always as (coalesce(location_id::text, 'all')) stored,
 category text not null check (category in ('weather_alert','government_closure','federal_holiday','school_closure','transit_disruption',
   'street_closure','sports_game','concert_show','convention','race','festival_parade','demonstration','other')),
 valid_from date not null,
 valid_to date not null,
 start_local time,
 end_local time,
 title text not null check (length(btrim(title)) between 2 and 120),
 expected_impact text not null check (expected_impact in ('up','down','unknown')),
 severity text check (severity in ('minor','moderate','severe','extreme','unknown')),
 external_key text check (length(external_key) between 1 and 200),
 note text check (length(note) <= 500),
 content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
 issued_at timestamptz,
 -- Feed rows: the instant the event ends at its source (null = the end of valid_to, ET).
 ends_at timestamptz,
 -- Feed rows: this vintage records that the event LEFT its feed before its end (cancelled or replaced).
 withdrawn boolean not null default false,
 available_at timestamptz not null default clock_timestamp(),
 created_by uuid references public.users(id),
 supersedes_id uuid references public.demand_day_events(id),
 retracted boolean not null default false,
 check (valid_to >= valid_from and valid_to - valid_from <= 60),
 check ((origin = 'manual') = (created_by is not null)),
 check ((origin = 'feed') = (source_id is not null and source_seq is not null and run_id is not null and external_key is not null)),
 check (origin = 'manual' or (supersedes_id is null and not retracted and note is null)),
 constraint demand_day_events_feed_withdrawal check (origin = 'feed' or (not withdrawn and ends_at is null))
);
-- One correction per manual row: the unique index IS the arbiter of two people correcting the same entry.
create unique index demand_day_events_one_correction on public.demand_day_events (supersedes_id) where supersedes_id is not null;
create index demand_day_events_scope on public.demand_day_events (scope_key, valid_from, valid_to);
create index demand_day_events_feed on public.demand_day_events (source_id, scope_key, external_key, available_at desc, id desc) where origin = 'feed';

-- A run that fetched and FAILED (a fixed code). Asks nothing of the register: it stores no signal.
create function public.demand_signal_run_fail(p_source_id text, p_location_id uuid, p_feed text, p_started_at timestamptz, p_error_code text)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_seq bigint; v_id uuid;
begin
  select max(s.seq) into v_seq from public.demand_sources s where s.source_id = p_source_id;
  if v_seq is null then raise exception 'source_unknown'; end if;
  insert into public.demand_signal_runs (source_id, source_seq, location_id, feed, outcome, error_code, rows_seen, rows_written, started_at)
  values (p_source_id, v_seq, p_location_id, p_feed, 'failed', p_error_code, 0, 0, coalesce(p_started_at, clock_timestamp()))
  returning id into v_id;
  return v_id;
end $$;

-- Store one shop's hourly forecast: rows = [{valid_hour, temperature_f, precip_probability_pct, wind_speed_mph,
-- relative_humidity_pct, is_daytime, condition}]. THE GATE FIRST. An hour whose latest stored vintage has the
-- same content writes no row. More than 224 rows refuses (2 shops x 7 days x 16 service hours is the whole run).
create function public.demand_weather_ingest(p_source_id text, p_definition_hash text, p_location_id uuid, p_issued_at timestamptz,
  p_started_at timestamptz, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_seq bigint; v_run uuid := gen_random_uuid(); v_seen integer; v_fresh integer; v_now timestamptz := clock_timestamp();
begin
  v_seq := public.demand_source_gate(p_source_id, p_definition_hash);
  if p_definition_hash is null then raise exception 'source_unverified'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or p_location_id is null or p_issued_at is null then raise exception 'weather_rows_invalid'; end if;
  v_seen := jsonb_array_length(p_rows);
  if v_seen > 224 then raise exception 'rows_over_cap'; end if;
  if p_issued_at > v_now + interval '10 minutes' then raise exception 'weather_rows_invalid'; end if;
  create temporary table if not exists demand_weather_incoming (
    valid_hour timestamptz, temperature_f numeric, precip_probability_pct integer, wind_speed_mph numeric,
    relative_humidity_pct integer, is_daytime boolean, condition text, content_hash text) on commit drop;
  truncate demand_weather_incoming;
  insert into demand_weather_incoming
  select r.valid_hour, r.temperature_f, r.precip_probability_pct, r.wind_speed_mph, r.relative_humidity_pct, r.is_daytime, r.condition,
    encode(sha256(convert_to(concat_ws('|', r.temperature_f::numeric(5,1)::text, coalesce(r.precip_probability_pct::text, ''),
      coalesce(r.wind_speed_mph::numeric(5,1)::text, ''), coalesce(r.relative_humidity_pct::text, ''), r.is_daytime::text, r.condition), 'UTF8')), 'hex')
  from jsonb_to_recordset(p_rows) as r(valid_hour timestamptz, temperature_f numeric, precip_probability_pct integer, wind_speed_mph numeric,
    relative_humidity_pct integer, is_daytime boolean, condition text);
  if exists (select 1 from demand_weather_incoming i where i.valid_hour is null or i.temperature_f is null or i.is_daytime is null or i.condition is null
      or date_trunc('hour', i.valid_hour) <> i.valid_hour or i.valid_hour < v_now - interval '2 hours' or i.valid_hour > v_now + interval '8 days')
    or (select count(distinct i.valid_hour) from demand_weather_incoming i) <> v_seen then raise exception 'weather_rows_invalid'; end if;
  delete from demand_weather_incoming i where i.content_hash = (
    select w.content_hash from public.demand_weather_hourly w
    where w.source_id = p_source_id and w.location_id = p_location_id and w.valid_hour = i.valid_hour
    order by w.available_at desc, w.issued_at desc, w.id desc limit 1);
  select count(*) into v_fresh from demand_weather_incoming;
  insert into public.demand_signal_runs (id, source_id, source_seq, location_id, feed, outcome, rows_seen, rows_written, started_at)
  values (v_run, p_source_id, v_seq, p_location_id, 'weather_hourly', case when v_fresh > 0 then 'written' else 'unchanged' end, v_seen, v_fresh,
    coalesce(p_started_at, v_now));
  insert into public.demand_weather_hourly (source_id, source_seq, run_id, location_id, valid_hour, issued_at, content_hash, temperature_f,
    precip_probability_pct, wind_speed_mph, relative_humidity_pct, is_daytime, condition)
  select p_source_id, v_seq, v_run, p_location_id, i.valid_hour, p_issued_at, i.content_hash, i.temperature_f, i.precip_probability_pct,
    i.wind_speed_mph, i.relative_humidity_pct, i.is_daytime, i.condition
  from demand_weather_incoming i order by i.valid_hour;
  return jsonb_build_object('run_id', v_run, 'seen', v_seen, 'written', v_fresh);
end $$;

-- Store feed events (alerts, discovered events): events = [{external_key, category, valid_from, valid_to,
-- start_local, end_local, title, expected_impact, severity, issued_at, ends_at}]. THE GATE FIRST; unchanged = no row.
-- p_events IS THE COMPLETE CURRENT SET of this source for this scope (one shop, or all): a SNAPSHOT. So a stored
-- event that is not in it has LEFT the feed. If its end has not passed (ends_at, else the end of valid_to in ET)
-- it was cancelled or replaced: a WITHDRAWAL vintage is appended (the head's own fields, withdrawn = true) and the
-- reader stops returning it. If its end has passed it ran its course: nothing is written and it stays history.
-- Only a call that reaches this point withdraws: a failed fetch or a refused payload never calls it. An event
-- that comes back after a withdrawal is a new vintage (its content differs from the withdrawal's).
create function public.demand_events_ingest(p_source_id text, p_definition_hash text, p_location_id uuid, p_started_at timestamptz, p_events jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_seq bigint; v_run uuid := gen_random_uuid(); v_seen integer; v_fresh integer; v_scope text := coalesce(p_location_id::text, 'all');
  v_now timestamptz := clock_timestamp(); v_gone uuid[]; v_withdrawn integer;
begin
  v_seq := public.demand_source_gate(p_source_id, p_definition_hash);
  if p_definition_hash is null then raise exception 'source_unverified'; end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' then raise exception 'events_invalid'; end if;
  v_seen := jsonb_array_length(p_events);
  if v_seen > 50 then raise exception 'rows_over_cap'; end if;
  create temporary table if not exists demand_events_incoming (
    external_key text, category text, valid_from date, valid_to date, start_local time, end_local time, title text,
    expected_impact text, severity text, issued_at timestamptz, ends_at timestamptz, content_hash text) on commit drop;
  truncate demand_events_incoming;
  insert into demand_events_incoming
  select e.external_key, e.category, e.valid_from, e.valid_to, e.start_local, e.end_local, btrim(e.title), coalesce(e.expected_impact, 'unknown'), e.severity, e.issued_at, e.ends_at,
    encode(sha256(convert_to(concat_ws('|', e.category, e.valid_from::text, e.valid_to::text, coalesce(e.start_local::text, ''), coalesce(e.end_local::text, ''),
      btrim(e.title), coalesce(e.expected_impact, 'unknown'), coalesce(e.severity, ''), coalesce(floor(extract(epoch from e.ends_at))::bigint::text, '')), 'UTF8')), 'hex')
  from jsonb_to_recordset(p_events) as e(external_key text, category text, valid_from date, valid_to date, start_local time, end_local time,
    title text, expected_impact text, severity text, issued_at timestamptz, ends_at timestamptz);
  if exists (select 1 from demand_events_incoming i where i.external_key is null or i.category is null or i.valid_from is null or i.valid_to is null or i.title is null)
    or (select count(distinct i.external_key) from demand_events_incoming i) <> v_seen then raise exception 'events_invalid'; end if;
  -- What left the feed before its end: the current head of each stored event of this source and scope that the
  -- snapshot does not list. Decided on the whole snapshot, before the unchanged rows are set aside.
  select array_agg(h.id) into v_gone
  from (select distinct on (d.external_key) d.id, d.external_key, d.withdrawn, d.valid_to, d.ends_at
        from public.demand_day_events d
        where d.origin = 'feed' and d.source_id = p_source_id and d.scope_key = v_scope
        order by d.external_key, d.available_at desc, d.id desc) h
  where not h.withdrawn
    and coalesce(h.ends_at, ((h.valid_to + 1)::timestamp at time zone 'America/New_York')) > v_now
    and not exists (select 1 from demand_events_incoming i where i.external_key = h.external_key);
  v_withdrawn := coalesce(cardinality(v_gone), 0);
  delete from demand_events_incoming i where i.content_hash = (
    select d.content_hash from public.demand_day_events d
    where d.origin = 'feed' and d.source_id = p_source_id and d.scope_key = v_scope and d.external_key = i.external_key
    order by d.available_at desc, d.id desc limit 1);
  select count(*) into v_fresh from demand_events_incoming;
  insert into public.demand_signal_runs (id, source_id, source_seq, location_id, feed, outcome, rows_seen, rows_written, rows_withdrawn, started_at)
  values (v_run, p_source_id, v_seq, p_location_id, 'day_events', case when v_fresh + v_withdrawn > 0 then 'written' else 'unchanged' end, v_seen, v_fresh,
    v_withdrawn, coalesce(p_started_at, v_now));
  insert into public.demand_day_events (origin, source_id, source_seq, run_id, location_id, category, valid_from, valid_to, start_local, end_local,
    title, expected_impact, severity, external_key, content_hash, issued_at, ends_at)
  select 'feed', p_source_id, v_seq, v_run, p_location_id, i.category, i.valid_from, i.valid_to, i.start_local, i.end_local, i.title,
    i.expected_impact, i.severity, i.external_key, i.content_hash, i.issued_at, i.ends_at
  from demand_events_incoming i order by i.external_key;
  -- The withdrawals: appended, never an update or a removal of the vintage they withdraw.
  insert into public.demand_day_events (origin, source_id, source_seq, run_id, location_id, category, valid_from, valid_to, start_local, end_local,
    title, expected_impact, severity, external_key, content_hash, issued_at, ends_at, withdrawn)
  select 'feed', p_source_id, v_seq, v_run, d.location_id, d.category, d.valid_from, d.valid_to, d.start_local, d.end_local, d.title,
    d.expected_impact, d.severity, d.external_key, encode(sha256(convert_to(d.content_hash || '|withdrawn', 'UTF8')), 'hex'), d.issued_at, d.ends_at, true
  from public.demand_day_events d where d.id = any(coalesce(v_gone, '{}'::uuid[])) order by d.external_key;
  return jsonb_build_object('run_id', v_run, 'seen', v_seen, 'written', v_fresh, 'withdrawn', v_withdrawn);
end $$;

-- ── 3. manual events (GM+). The page is PR 5; this is its one writer. ───────────────────────────────
-- A new entry, a correction (p_supersedes = the entry's current head) or a retraction (p_retract, which keeps
-- the head's own fields). Refusals by name: demand_event_forbidden (role), demand_event_shop_forbidden (a GM
-- outside their shops, or all shops), demand_event_invalid, demand_event_moved (not the head any more).
create function public.demand_event_save(p_actor uuid, p_location_id uuid, p_category text, p_valid_from date, p_valid_to date,
  p_start_local time, p_end_local time, p_title text, p_impact text, p_note text, p_supersedes uuid, p_retract boolean)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_role text; v_old public.demand_day_events%rowtype; v_id uuid; v_today date := public.demand_today_et(); v_retract boolean := coalesce(p_retract, false);
  v_loc uuid := p_location_id; v_cat text := p_category; v_from date := p_valid_from; v_to date := coalesce(p_valid_to, p_valid_from);
  v_start time := p_start_local; v_end time := p_end_local; v_title text := btrim(coalesce(p_title, '')); v_impact text := coalesce(p_impact, 'unknown');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_actor is not null then
    select u.role into v_role from public.users u where u.id = p_actor and u.active and u.role in ('gm', 'moo', 'owner', 'cgs') for share;
  end if;
  if v_role is null then raise exception 'demand_event_forbidden'; end if;
  if v_retract and p_supersedes is null then raise exception 'demand_event_invalid'; end if;
  if p_supersedes is not null then
    select * into v_old from public.demand_day_events d where d.id = p_supersedes and d.origin = 'manual' for update;
    if not found then raise exception 'demand_event_invalid'; end if;
    if v_old.retracted or exists (select 1 from public.demand_day_events n where n.supersedes_id = v_old.id) then raise exception 'demand_event_moved'; end if;
    if v_role = 'gm' and (v_old.location_id is null or not exists (select 1 from public.user_locations m
        where m.user_id = p_actor and m.location_id = v_old.location_id and m.active)) then raise exception 'demand_event_shop_forbidden'; end if;
    if v_retract then
      v_loc := v_old.location_id; v_cat := v_old.category; v_from := v_old.valid_from; v_to := v_old.valid_to; v_start := v_old.start_local;
      v_end := v_old.end_local; v_title := v_old.title; v_impact := v_old.expected_impact; v_note := coalesce(v_note, v_old.note);
    end if;
  end if;
  if v_role = 'gm' and (v_loc is null or not exists (select 1 from public.user_locations m
      where m.user_id = p_actor and m.location_id = v_loc and m.active)) then raise exception 'demand_event_shop_forbidden'; end if;
  if v_loc is not null and not exists (select 1 from public.locations l where l.id = v_loc and l.active) then raise exception 'demand_event_invalid'; end if;
  if v_cat is null or v_from is null or v_to < v_from or v_to - v_from > 60 or length(v_title) not between 2 and 120
    or v_impact not in ('up', 'down', 'unknown') or length(coalesce(v_note, '')) > 500
    or v_from < v_today - 400 or v_to > v_today + 400 or (v_start is not null and v_end is not null and v_to = v_from and v_end <= v_start)
    or v_cat not in ('weather_alert','government_closure','federal_holiday','school_closure','transit_disruption','street_closure',
      'sports_game','concert_show','convention','race','festival_parade','demonstration','other') then
    raise exception 'demand_event_invalid'; end if;
  begin
    insert into public.demand_day_events (origin, location_id, category, valid_from, valid_to, start_local, end_local, title, expected_impact,
      note, content_hash, created_by, supersedes_id, retracted)
    values ('manual', v_loc, v_cat, v_from, v_to, v_start, v_end, v_title, v_impact, v_note,
      encode(sha256(convert_to(concat_ws('|', v_cat, v_from::text, v_to::text, coalesce(v_start::text, ''), coalesce(v_end::text, ''), v_title, v_impact,
        v_retract::text), 'UTF8')), 'hex'),
      p_actor, p_supersedes, v_retract)
    returning id into v_id;
  exception when unique_violation then raise exception 'demand_event_moved'; end;
  -- Neither the title nor the note enters the audit row.
  insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
  values (p_actor, v_role, case when p_supersedes is null then 'demand_event.record' else 'demand_event.correct' end, 'demand_day_events', v_id,
    jsonb_build_object('location_id', v_loc, 'category', v_cat, 'valid_from', v_from, 'valid_to', v_to, 'expected_impact', v_impact,
      'supersedes_id', p_supersedes, 'retracted', v_retract, 'has_note', v_note is not null),
    p_supersedes is not null);
  return jsonb_build_object('id', v_id, 'retracted', v_retract);
end $$;

-- ── 4. the gated readers (compute, render) ──────────────────────────────────────────────────────
-- The latest vintage per valid hour as of p_as_of (available_at, then issued_at, then id), ONLY from sources
-- whose status is 'verified' NOW. A revoked or unverified source's rows stay stored and are not returned.
-- TOTALLY ORDERED by (source_id, valid_hour), unique after the DISTINCT ON, so the store can page it.
create function public.demand_usable_weather(p_location_id uuid, p_from timestamptz, p_to timestamptz, p_as_of timestamptz)
returns table (source_id text, valid_hour timestamptz, issued_at timestamptz, available_at timestamptz, vintage_id bigint,
  temperature_f numeric, precip_probability_pct smallint, wind_speed_mph numeric, relative_humidity_pct smallint, is_daytime boolean, condition text)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if p_location_id is null or p_from is null or p_to is null or p_as_of is null or p_to < p_from or p_to - p_from > interval '9 days' then
    raise exception 'signal_window_invalid'; end if;
  return query
  select distinct on (w.source_id, w.valid_hour) w.source_id, w.valid_hour, w.issued_at, w.available_at, w.id, w.temperature_f,
    w.precip_probability_pct, w.wind_speed_mph, w.relative_humidity_pct, w.is_daytime, w.condition
  from public.demand_weather_hourly w
  where w.location_id = p_location_id and w.valid_hour >= p_from and w.valid_hour < p_to and w.available_at <= p_as_of
    and public.demand_source_status(w.source_id) = 'verified'
  order by w.source_id, w.valid_hour, w.available_at desc, w.issued_at desc, w.id desc;
end $$;

-- Day events for a shop (its own and the all-shop ones) as of p_as_of: manual heads that are not retracted
-- (no source: always usable on this axis) and the latest feed vintage per event from sources verified NOW,
-- unless that vintage is a WITHDRAWAL (the event was cancelled or replaced: not usable from then on; an as-of
-- before the withdrawal still returns it). TOTALLY ORDERED by (valid_from, id), id being unique, so a caller
-- can page the set: the store reads it in pages with an exact count and refuses a set that moved.
create function public.demand_usable_day_events(p_location_id uuid, p_from date, p_to date, p_as_of timestamptz)
returns table (id uuid, origin text, source_id text, location_id uuid, category text, valid_from date, valid_to date, start_local time,
  end_local time, title text, expected_impact text, severity text, issued_at timestamptz, available_at timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if p_location_id is null or p_from is null or p_to is null or p_as_of is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'signal_window_invalid'; end if;
  return query
  select u.* from (
  select m.id, m.origin, m.source_id, m.location_id, m.category, m.valid_from, m.valid_to, m.start_local, m.end_local, m.title,
    m.expected_impact, m.severity, m.issued_at, m.available_at
  from public.demand_day_events m
  where m.origin = 'manual' and not m.retracted and m.available_at <= p_as_of
    and m.scope_key in (p_location_id::text, 'all') and m.valid_from <= p_to and m.valid_to >= p_from
    and not exists (select 1 from public.demand_day_events n where n.supersedes_id = m.id and n.available_at <= p_as_of)
  union all
  select f.id, f.origin, f.source_id, f.location_id, f.category, f.valid_from, f.valid_to, f.start_local, f.end_local, f.title,
    f.expected_impact, f.severity, f.issued_at, f.available_at
  from (select distinct on (d.source_id, d.scope_key, d.external_key) d.*
        from public.demand_day_events d
        where d.origin = 'feed' and d.available_at <= p_as_of and d.scope_key in (p_location_id::text, 'all')
        order by d.source_id, d.scope_key, d.external_key, d.available_at desc, d.id desc) f
  where f.valid_from <= p_to and f.valid_to >= p_from and not f.withdrawn and public.demand_source_status(f.source_id) = 'verified'
  ) u order by u.valid_from, u.id;
end $$;

-- ── 5. the cron lease: 0337's body with 'demand-signals' added; no job is dropped ───────────────────
alter table public.cron_route_leases drop constraint cron_route_leases_job_check,
  add constraint cron_route_leases_job_check check(job in ('toast-sales-today','toast-catering-scan','sevenshifts-sync','schedule-draft','catering-inbox-delivery','meta-leads','fact-build','demand-signals'));
create or replace function public.claim_cron_route(p_job text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare claimed text;
begin
  if p_job is null or p_job not in ('toast-sales-today','toast-catering-scan','sevenshifts-sync','schedule-draft','catering-inbox-delivery','meta-leads','fact-build','demand-signals') then raise exception 'invalid_cron_route'; end if;
  insert into public.cron_route_leases(job,lease_until) values(p_job,clock_timestamp()+interval '330 seconds')
  on conflict(job) do update set lease_until=clock_timestamp()+interval '330 seconds'
    where cron_route_leases.lease_until<=clock_timestamp() returning job into claimed;
  return claimed is not null;
end $$;

-- ── 6. ceilings: deny-all RLS with the four explicit denials, service_role SELECT only ──────────────
do $$ declare t text; f regprocedure; begin
  foreach t in array array['demand_sources','demand_source_events','demand_signal_runs','demand_weather_hourly','demand_day_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (false)', t || '_no_user_select', t);
    execute format('create policy %I on public.%I for insert with check (false)', t || '_no_user_insert', t);
    execute format('create policy %I on public.%I for update using (false)', t || '_no_user_update', t);
    execute format('create policy %I on public.%I for delete using (false)', t || '_no_user_delete', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to service_role', t);
  end loop;
  foreach f in array array[
    'public.demand_source_key(text)'::regprocedure,
    'public.demand_source_states()'::regprocedure,
    'public.demand_source_status(text)'::regprocedure,
    'public.demand_source_gate(text,text)'::regprocedure,
    'public.demand_sources_assert_usable(text[])'::regprocedure,
    'public.demand_source_register(text)'::regprocedure,
    'public.demand_source_mark(uuid,text,text,text,text)'::regprocedure,
    'public.demand_signal_run_fail(text,uuid,text,timestamptz,text)'::regprocedure,
    'public.demand_weather_ingest(text,text,uuid,timestamptz,timestamptz,jsonb)'::regprocedure,
    'public.demand_events_ingest(text,text,uuid,timestamptz,jsonb)'::regprocedure,
    'public.demand_event_save(uuid,uuid,text,date,date,time,time,text,text,text,uuid,boolean)'::regprocedure,
    'public.demand_usable_weather(uuid,timestamptz,timestamptz,timestamptz)'::regprocedure,
    'public.demand_usable_day_events(uuid,date,date,timestamptz)'::regprocedure,
    'public.claim_cron_route(text)'::regprocedure] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

do $$ declare t text; f regprocedure; p text; begin
  foreach t in array array['demand_sources','demand_source_events','demand_signal_runs','demand_weather_hourly','demand_day_events'] loop
    if not has_table_privilege('service_role', 'public.' || t, 'SELECT') then raise exception '0343: % lacks service_role SELECT', t; end if;
    foreach p in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege('service_role', 'public.' || t, p) then raise exception '0343: service_role holds % on %', p, t; end if;
    end loop;
    foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] loop
      if has_table_privilege('anon', 'public.' || t, p) or has_table_privilege('authenticated', 'public.' || t, p) then
        raise exception '0343: PostgREST role holds % on %', p, t; end if;
    end loop;
  end loop;
  foreach f in array array[
    'public.demand_source_key(text)'::regprocedure,
    'public.demand_source_states()'::regprocedure,
    'public.demand_source_status(text)'::regprocedure,
    'public.demand_source_gate(text,text)'::regprocedure,
    'public.demand_sources_assert_usable(text[])'::regprocedure,
    'public.demand_source_register(text)'::regprocedure,
    'public.demand_source_mark(uuid,text,text,text,text)'::regprocedure,
    'public.demand_signal_run_fail(text,uuid,text,timestamptz,text)'::regprocedure,
    'public.demand_weather_ingest(text,text,uuid,timestamptz,timestamptz,jsonb)'::regprocedure,
    'public.demand_events_ingest(text,text,uuid,timestamptz,jsonb)'::regprocedure,
    'public.demand_event_save(uuid,uuid,text,date,date,time,time,text,text,text,uuid,boolean)'::regprocedure,
    'public.demand_usable_weather(uuid,timestamptz,timestamptz,timestamptz)'::regprocedure,
    'public.demand_usable_day_events(uuid,date,date,timestamptz)'::regprocedure,
    'public.claim_cron_route(text)'::regprocedure] loop
    if not has_function_privilege('service_role', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE')
      or has_function_privilege('authenticated', f, 'EXECUTE')
      or exists (select 1 from pg_proc pr, lateral aclexplode(pr.proacl) a where pr.oid = f and a.grantee = 0) then
      raise exception '0343: RPC escape %', f; end if;
  end loop;
  -- Ship state: no source, no status event, no signal.
  if exists (select 1 from public.demand_sources) or exists (select 1 from public.demand_source_events) then
    raise exception '0343: the register must ship empty'; end if;
end $$;

notify pgrst, 'reload schema';
commit;
