-- Migration 0270_people_layer
-- AUTHORED 2026-10-15. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word, AFTER 0269 and BEFORE 0271).
-- Provenance: Smart Scheduling Phase 1, Task 14 (docs/superpowers/plans/2026-10-15-scheduling-phase1-BUILD.md),
--   R8 (staff see a band, never an adjustment), R11 (the skill constants as tunable settings), J19 (company
--   row + optional shop override, MoO+ only), J22 + CC ruling 2026-10-15 on Astra r3 P3 (weights ≥ 0, at
--   least one > 0, NO per-weight cap, finite sum), Astra r2 #3 (one rule set in TS and SQL).
--
-- WHAT:
--   1. people_shop_settings: one row per shop — the PM v2 switch (`pm_v2`, OFF by default; nothing reads
--      it before Task 23) and `prep_position_id`, the shop position prep batches count toward when no
--      interval covers them. The position is proven to be THIS shop's by a composite FK.
--   2. people_skill_adjustments: a manager's ± adjustment of a person's skill at one position, 0.05 steps
--      within ±0.30, a closed reason list ('other' needs a note). APPEND-ONLY: "current" = the latest row
--      per (user, position); a correction is a new row.
--   3. people_skill_ratings: the new-hire starting rating (0..1 in 0.05 steps), same shape, append-only.
--   4. people_skill_tunables: the skill constants (R11) — one company row (location_id NULL) plus an
--      optional row per shop; the jsonb is CHECKed by valid_skill_tunables, the SQL twin of the TS
--      validator `validSkillTunables` (lib/people/tunables-shared.ts). BOTH are pinned against the one
--      shared case file tests/fixtures/skill-tunables-cases.json (vitest + scripts/sql-harness-0270.mjs).
--      A rejected set leaves the previous set live: the writer refuses `invalid_tunables` first, and the
--      CHECK fails the single statement if a bad set ever reached the table. No row = the defaults.
--   5. station_positions_id_location: a unique index on station_positions(id, location_id) for the
--      composite FKs. Additive: `id` is already the primary key, so it cannot fail on existing data and it
--      changes no row and no grant.
--
-- WRITERS (SECURITY DEFINER, search_path pinned, service_role only; every table is SELECT-only for
--   service_role, so these are the ONLY writers — the 0269 posture):
--     save_people_shop_settings(actor, location, pm_v2, prep_position)   GM own shop / MoO+ any
--     record_skill_adjustment(actor, location, user, position, delta, reason, note)
--     record_skill_rating(actor, location, user, position, rating, reason, note)
--                                                         GM own shop / MoO+ any; the actor STRICTLY outranks
--                                                         the subject (canActOn), who is an active member there
--     save_skill_tunables(actor, location|null, tunables)   MoO (8)+ only (the route adds Tier E)
--   The lib (lib/people/skills.ts, lib/people/settings.ts) decides every rule first, before any I/O, and
--   writes the audit row; these RPCs decide them again.
--
-- REFUSALS (raise exception '<code>', P0001): invalid_payload · role_insufficient · location_access_denied
--   · assignee_unavailable · position_not_at_shop · position_retired · invalid_adjustment · invalid_rating
--   · invalid_reason · invalid_tunables.
--
-- DEPENDS ON: 0219 station_positions; 0217 assignment_user_level, 0228 assignment_author_level,
--   0233 toast_link_actor_level (reused, never copied).
--
-- PRE-FLIGHT (MCP, before apply):
--   select column_name from information_schema.columns where table_schema = 'public'
--    and table_name = 'station_positions' and column_name in ('id', 'location_id', 'active');           -- 3 rows
--   select to_regprocedure('public.toast_link_actor_level(uuid,uuid)'), to_regprocedure('public.assignment_user_level(uuid,uuid)'),
--          to_regprocedure('public.assignment_author_level(uuid)');                                        -- all present
--   select to_regclass('public.people_shop_settings'), to_regclass('public.people_skill_tunables');      -- both NULL
--   (the preflight block below asserts all of it and refuses otherwise)
--
-- VERIFY AFTER APPLY:
--   select relname, relrowsecurity from pg_class where relname like 'people\_%';                        -- t ×4
--   select table_name, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name like 'people\_%' order by 1, 2;                         -- service_role SELECT only
--   select routine_name, grantee from information_schema.routine_privileges where routine_schema = 'public'
--    and (routine_name like '%skill%' or routine_name like '%people_shop%') order by 1, 2;               -- service_role (+ postgres) only

begin;

-- ── PRE-FLIGHT ──────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'station_positions'
        and column_name in ('id', 'location_id', 'active')) <> 3 then
    raise exception '0270: station_positions (0219) with id, location_id, active must exist';
  end if;
  if to_regprocedure('public.toast_link_actor_level(uuid,uuid)') is null
     or to_regprocedure('public.assignment_user_level(uuid,uuid)') is null
     or to_regprocedure('public.assignment_author_level(uuid)') is null then
    raise exception '0270: the 0217 / 0228 / 0233 level helpers must exist';
  end if;
  if to_regclass('public.people_shop_settings') is not null or to_regclass('public.people_skill_adjustments') is not null
     or to_regclass('public.people_skill_ratings') is not null or to_regclass('public.people_skill_tunables') is not null then
    raise exception '0270: already applied';
  end if;
end $$;

-- The composite FKs need an exact unique key on (id, location_id). 0219's unique(id, station_id, location_id)
-- cannot serve. `id` is the primary key, so this cannot fail and changes no row and no grant.
create unique index if not exists station_positions_id_location on public.station_positions (id, location_id);

-- ── THE TUNABLES RULE SET (the SQL twin of validSkillTunables) ───────────────────────────────────
-- One JSON number → a double, or NULL when it is not a number, does not fit a double, or is a nonzero
-- value below the smallest normal double (the TS side refuses the same).
create function public.skill_tunable_num(p jsonb) returns double precision
language plpgsql immutable set search_path = pg_catalog, public as $$
declare v double precision;
begin
  if p is null or jsonb_typeof(p) <> 'number' then return null; end if;
  begin
    v := (p #>> '{}')::double precision;
  exception when others then
    return null;
  end;
  if v = 'Infinity'::double precision or v = '-Infinity'::double precision or v = 'NaN'::double precision then return null; end if;
  if v <> 0 and abs(v) < 2.2250738585072014e-308 then return null; end if;
  return v;
end $$;

create function public.valid_skill_tunables(p jsonb) returns boolean
language plpgsql immutable set search_path = pg_catalog, public as $$
declare
  v_prior double precision; v_k double precision; v_pm double precision; v_close double precision; v_prep double precision;
  v_sum double precision; v_great double precision; v_good double precision; v_nw double precision; v_tol double precision;
  v_grace double precision; v_building double precision; v_strong double precision; v_minq double precision; v_window double precision;
begin
  -- exactly the known keys, nested objects included
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(p)) <> 9
     or not (p ?& array['priorWhenNoRating', 'priorStrength', 'weights', 'gradeValue', 'yieldTolerance', 'closeGraceMinutes',
                        'bands', 'minQualityDaysForLearned', 'windowDays']) then
    return false;
  end if;
  if jsonb_typeof(p -> 'weights') <> 'object' or (select count(*) from jsonb_object_keys(p -> 'weights')) <> 3
     or not ((p -> 'weights') ?& array['pm', 'closeOnTime', 'prepYield']) then return false; end if;
  if jsonb_typeof(p -> 'gradeValue') <> 'object' or (select count(*) from jsonb_object_keys(p -> 'gradeValue')) <> 3
     or not ((p -> 'gradeValue') ?& array['great', 'good', 'needs_work']) then return false; end if;
  if jsonb_typeof(p -> 'bands') <> 'object' or (select count(*) from jsonb_object_keys(p -> 'bands')) <> 2
     or not ((p -> 'bands') ?& array['building', 'strong']) then return false; end if;

  -- every value a JSON number that fits a double
  v_pm := public.skill_tunable_num(p -> 'weights' -> 'pm');
  v_close := public.skill_tunable_num(p -> 'weights' -> 'closeOnTime');
  v_prep := public.skill_tunable_num(p -> 'weights' -> 'prepYield');
  v_great := public.skill_tunable_num(p -> 'gradeValue' -> 'great');
  v_good := public.skill_tunable_num(p -> 'gradeValue' -> 'good');
  v_nw := public.skill_tunable_num(p -> 'gradeValue' -> 'needs_work');
  v_building := public.skill_tunable_num(p -> 'bands' -> 'building');
  v_strong := public.skill_tunable_num(p -> 'bands' -> 'strong');
  v_prior := public.skill_tunable_num(p -> 'priorWhenNoRating');
  v_k := public.skill_tunable_num(p -> 'priorStrength');
  v_tol := public.skill_tunable_num(p -> 'yieldTolerance');
  v_grace := public.skill_tunable_num(p -> 'closeGraceMinutes');
  v_minq := public.skill_tunable_num(p -> 'minQualityDaysForLearned');
  v_window := public.skill_tunable_num(p -> 'windowDays');
  if v_pm is null or v_close is null or v_prep is null or v_great is null or v_good is null or v_nw is null
     or v_building is null or v_strong is null or v_prior is null or v_k is null or v_tol is null or v_grace is null
     or v_minq is null or v_window is null then
    return false;
  end if;

  if v_prior < 0 or v_prior > 1 then return false; end if;
  if not (v_k > 0 and v_k <= 60) then return false; end if;
  -- weights ≥ 0, NO per-weight cap, at least one > 0, and a FINITE double sum (pm + closeOnTime) + prepYield:
  -- a double addition that overflows raises here, exactly where the TS sum becomes Infinity.
  if v_pm < 0 or v_close < 0 or v_prep < 0 then return false; end if;
  begin
    v_sum := (v_pm + v_close) + v_prep;
  exception when numeric_value_out_of_range then
    return false;
  end;
  if not (v_sum > 0) or v_sum > 1.7976931348623157e308 then return false; end if;
  if v_great < 0 or v_great > 1 or v_good < 0 or v_good > 1 or v_nw < 0 or v_nw > 1 then return false; end if;
  if not (v_great >= v_good and v_good >= v_nw) then return false; end if;
  if v_tol < 0.01 or v_tol > 0.5 then return false; end if;
  if v_grace < 0 or v_grace > 120 then return false; end if;
  if not (v_building > 0) or not (v_strong < 1) or not (v_building < v_strong) then return false; end if;
  if v_minq <> trunc(v_minq) or v_minq < 0 or v_minq > 30 then return false; end if;
  if v_window <> trunc(v_window) or v_window < 7 or v_window > 365 then return false; end if;
  return true;
end $$;

-- ── THE TABLES ──────────────────────────────────────────────────────────────────────────────────
create table public.people_shop_settings (
  location_id      uuid        primary key references public.locations(id),
  pm_v2            boolean     not null default false,
  prep_position_id uuid,
  updated_by       uuid        not null references public.users(id),
  updated_at       timestamptz not null default clock_timestamp(),
  constraint people_shop_settings_prep_position_at_shop
    foreign key (prep_position_id, location_id) references public.station_positions (id, location_id)
);
comment on table public.people_shop_settings is
  '0270: one row per shop — the PM v2 switch (off by default) and the prep evidence position (a position of THIS shop, composite FK). Written only by save_people_shop_settings. Deny-all RLS.';

create table public.people_skill_adjustments (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references public.users(id),
  location_id uuid        not null references public.locations(id),
  position_id uuid        not null,
  delta       numeric     not null,
  reason_code text        not null,
  reason_note text,
  actor_id    uuid        not null references public.users(id),
  created_at  timestamptz not null default clock_timestamp(),
  -- 0.05 steps within ±0.30. Unconstrained numeric, so 0.149 is refused, never silently rounded to 0.15.
  constraint people_skill_adjustments_step check (delta between -0.30 and 0.30 and (delta * 100) % 5 = 0),
  constraint people_skill_adjustments_reason check (reason_code in ('observed_on_floor', 'training_completed', 'correction', 'other')),
  constraint people_skill_adjustments_note check (reason_note is null or char_length(reason_note) <= 500),
  constraint people_skill_adjustments_other_needs_note check (reason_code <> 'other' or coalesce(reason_note ~ '[^[:space:]]', false)),
  constraint people_skill_adjustments_position_at_shop
    foreign key (position_id, location_id) references public.station_positions (id, location_id)
);
create index people_skill_adjustments_head on public.people_skill_adjustments (user_id, position_id, created_at desc);
create index people_skill_adjustments_shop on public.people_skill_adjustments (location_id, created_at desc);
comment on table public.people_skill_adjustments is
  '0270: a manager adjustment of a skill at one position (±0.30, 0.05 steps, reason required). Append-only by grant: the latest row per (user, position) is current; a correction is a new row. Never shown to the person (R8). Written only by record_skill_adjustment. Deny-all RLS.';

create table public.people_skill_ratings (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references public.users(id),
  location_id uuid        not null references public.locations(id),
  position_id uuid        not null,
  rating      numeric     not null,
  reason_code text        not null,
  reason_note text,
  actor_id    uuid        not null references public.users(id),
  created_at  timestamptz not null default clock_timestamp(),
  constraint people_skill_ratings_step check (rating between 0 and 1 and (rating * 100) % 5 = 0),
  constraint people_skill_ratings_reason check (reason_code in ('observed_on_floor', 'training_completed', 'correction', 'other')),
  constraint people_skill_ratings_note check (reason_note is null or char_length(reason_note) <= 500),
  constraint people_skill_ratings_other_needs_note check (reason_code <> 'other' or coalesce(reason_note ~ '[^[:space:]]', false)),
  constraint people_skill_ratings_position_at_shop
    foreign key (position_id, location_id) references public.station_positions (id, location_id)
);
create index people_skill_ratings_head on public.people_skill_ratings (user_id, position_id, created_at desc);
create index people_skill_ratings_shop on public.people_skill_ratings (location_id, created_at desc);
comment on table public.people_skill_ratings is
  '0270: the new-hire starting rating at one position (0..1, 0.05 steps): the skill prior. Append-only by grant: the latest row per (user, position) wins. Written only by record_skill_rating. Deny-all RLS.';

create table public.people_skill_tunables (
  id          uuid        primary key default gen_random_uuid(),
  location_id uuid        references public.locations(id),
  tunables    jsonb       not null constraint people_skill_tunables_valid check (public.valid_skill_tunables(tunables)),
  updated_by  uuid        not null references public.users(id),
  updated_at  timestamptz not null default clock_timestamp()
);
create unique index people_skill_tunables_one_per_scope
  on public.people_skill_tunables (coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid));
comment on table public.people_skill_tunables is
  '0270: the skill constants (R11). location_id NULL = the company row; a shop row overrides it whole. CHECKed by valid_skill_tunables (pinned equal to the TS validator by one shared case file). No row = the defaults. Written only by save_skill_tunables (MoO+). Deny-all RLS.';

alter table public.people_shop_settings enable row level security;
alter table public.people_skill_adjustments enable row level security;
alter table public.people_skill_ratings enable row level security;
alter table public.people_skill_tunables enable row level security;
revoke all on public.people_shop_settings, public.people_skill_adjustments, public.people_skill_ratings, public.people_skill_tunables
  from public, anon, authenticated, service_role;
grant select on public.people_shop_settings, public.people_skill_adjustments, public.people_skill_ratings, public.people_skill_tunables
  to service_role;

-- ── THE WRITERS ─────────────────────────────────────────────────────────────────────────────────

-- The position must be an ACTIVE position of THIS shop ON AN ACTIVE STATION (the composite FK is the backstop
-- for the shop). Station sync can deactivate a station without retiring its positions, so the position's own
-- flag is not enough (Astra chunk E #2): a position under an inactive station is retired.
create function public.people_position_at_shop(p_position uuid, p_location uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_active boolean;
begin
  select p.active and s.active into v_active
    from public.station_positions p
    join public.stations s on s.id = p.station_id
   where p.id = p_position and p.location_id = p_location;
  if not found then raise exception 'position_not_at_shop'; end if;
  if not v_active then raise exception 'position_retired'; end if;
end $$;

-- A reason from the closed list; 'other' carries a note; a note is at most 500 characters.
create function public.people_skill_reason_ok(p_reason text, p_note text)
returns void language plpgsql immutable set search_path = pg_catalog, public as $$
begin
  if p_reason is null or p_reason not in ('observed_on_floor', 'training_completed', 'correction', 'other')
     or (p_note is not null and char_length(p_note) > 500)
     or (p_reason = 'other' and not coalesce(p_note ~ '[^[:space:]]', false)) then
    raise exception 'invalid_reason';
  end if;
end $$;

-- People shop settings: GM own shop / MoO+ any (0233's actor helper). Returns before/after for the audit row.
create function public.save_people_shop_settings(p_actor uuid, p_location uuid, p_pm_v2 boolean, p_prep_position uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_old public.people_shop_settings%rowtype; v_had boolean;
begin
  if p_actor is null or p_location is null or p_pm_v2 is null then raise exception 'invalid_payload'; end if;
  -- One shop's settings saves are serialised BEFORE the read (Astra chunk E #6): `select … for update` locks
  -- nothing while the row does not exist yet, so two first saves could both insert and the loser hit 23505.
  perform pg_advisory_xact_lock(hashtextextended('people-shop-settings/' || p_location::text, 0));
  perform public.toast_link_actor_level(p_actor, p_location);
  if p_prep_position is not null then perform public.people_position_at_shop(p_prep_position, p_location); end if;
  select * into v_old from public.people_shop_settings where location_id = p_location for update;
  v_had := found;
  if v_had then
    update public.people_shop_settings
       set pm_v2 = p_pm_v2, prep_position_id = p_prep_position, updated_by = p_actor, updated_at = clock_timestamp()
     where location_id = p_location;
  else
    insert into public.people_shop_settings (location_id, pm_v2, prep_position_id, updated_by)
      values (p_location, p_pm_v2, p_prep_position, p_actor);
  end if;
  return jsonb_build_object(
    'before', case when v_had then jsonb_build_object('pm_v2', v_old.pm_v2, 'prep_position_id', v_old.prep_position_id) else null end,
    'after', jsonb_build_object('pm_v2', p_pm_v2, 'prep_position_id', p_prep_position));
end $$;

-- A skill adjustment. Actor: GM own shop / MoO+ (0233). Subject: an active member of the shop (0217),
-- strictly below the actor (canActOn). The position: active, at this shop. The step and the reason by name.
create function public.record_skill_adjustment(p_actor uuid, p_location uuid, p_user uuid, p_position uuid,
  p_delta numeric, p_reason text, p_note text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor integer; v_subject integer; v_id uuid;
begin
  if p_actor is null or p_location is null or p_user is null or p_position is null or p_delta is null then
    raise exception 'invalid_payload';
  end if;
  v_actor := public.toast_link_actor_level(p_actor, p_location);
  v_subject := public.assignment_user_level(p_user, p_location);
  if v_subject >= v_actor then raise exception 'role_insufficient'; end if;
  perform public.people_position_at_shop(p_position, p_location);
  if p_delta < -0.30 or p_delta > 0.30 or (p_delta * 100) % 5 <> 0 then raise exception 'invalid_adjustment'; end if;
  perform public.people_skill_reason_ok(p_reason, p_note);
  insert into public.people_skill_adjustments (user_id, location_id, position_id, delta, reason_code, reason_note, actor_id)
    values (p_user, p_location, p_position, p_delta, p_reason, nullif(btrim(coalesce(p_note, '')), ''), p_actor)
    returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

-- The new-hire starting rating: the same rules, a rating in [0, 1] in 0.05 steps.
create function public.record_skill_rating(p_actor uuid, p_location uuid, p_user uuid, p_position uuid,
  p_rating numeric, p_reason text, p_note text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor integer; v_subject integer; v_id uuid;
begin
  if p_actor is null or p_location is null or p_user is null or p_position is null or p_rating is null then
    raise exception 'invalid_payload';
  end if;
  v_actor := public.toast_link_actor_level(p_actor, p_location);
  v_subject := public.assignment_user_level(p_user, p_location);
  if v_subject >= v_actor then raise exception 'role_insufficient'; end if;
  perform public.people_position_at_shop(p_position, p_location);
  if p_rating < 0 or p_rating > 1 or (p_rating * 100) % 5 <> 0 then raise exception 'invalid_rating'; end if;
  perform public.people_skill_reason_ok(p_reason, p_note);
  insert into public.people_skill_ratings (user_id, location_id, position_id, rating, reason_code, reason_note, actor_id)
    values (p_user, p_location, p_position, p_rating, p_reason, nullif(btrim(coalesce(p_note, '')), ''), p_actor)
    returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

-- The tunables: MoO (8)+ only, one row per scope (company = NULL). Refused by name before the CHECK; the
-- CHECK is the backstop. One lock serialises the scope's upsert. Returns before/after for the audit row.
create function public.save_skill_tunables(p_actor uuid, p_location uuid, p_tunables jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_level integer; v_old public.people_skill_tunables%rowtype; v_had boolean; v_id uuid;
begin
  if p_actor is null or p_tunables is null then raise exception 'invalid_payload'; end if;
  perform pg_advisory_xact_lock(hashtextextended('people-skill-tunables', 0));
  if not exists (select 1 from public.users where id = p_actor and active) then raise exception 'role_insufficient'; end if;
  v_level := public.assignment_author_level(p_actor);
  if v_level is null or v_level < 8 then raise exception 'role_insufficient'; end if;
  if p_location is not null and not exists (select 1 from public.locations where id = p_location and active) then
    raise exception 'location_access_denied';
  end if;
  if not public.valid_skill_tunables(p_tunables) then raise exception 'invalid_tunables'; end if;
  select * into v_old from public.people_skill_tunables where location_id is not distinct from p_location for update;
  v_had := found;
  if v_had then
    update public.people_skill_tunables set tunables = p_tunables, updated_by = p_actor, updated_at = clock_timestamp()
     where id = v_old.id returning id into v_id;
  else
    insert into public.people_skill_tunables (location_id, tunables, updated_by) values (p_location, p_tunables, p_actor)
      returning id into v_id;
  end if;
  return jsonb_build_object('id', v_id, 'before', case when v_had then v_old.tunables else null end, 'after', p_tunables);
end $$;

-- ── GRANTS: every function service_role only; the tables sit at the SELECT ceiling ───────────────
revoke all on function public.skill_tunable_num(jsonb) from public, anon, authenticated;
revoke all on function public.valid_skill_tunables(jsonb) from public, anon, authenticated;
revoke all on function public.people_position_at_shop(uuid, uuid) from public, anon, authenticated;
revoke all on function public.people_skill_reason_ok(text, text) from public, anon, authenticated;
revoke all on function public.save_people_shop_settings(uuid, uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function public.record_skill_adjustment(uuid, uuid, uuid, uuid, numeric, text, text) from public, anon, authenticated;
revoke all on function public.record_skill_rating(uuid, uuid, uuid, uuid, numeric, text, text) from public, anon, authenticated;
revoke all on function public.save_skill_tunables(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.skill_tunable_num(jsonb) to service_role;
grant execute on function public.valid_skill_tunables(jsonb) to service_role;
grant execute on function public.people_position_at_shop(uuid, uuid) to service_role;
grant execute on function public.people_skill_reason_ok(text, text) to service_role;
grant execute on function public.save_people_shop_settings(uuid, uuid, boolean, uuid) to service_role;
grant execute on function public.record_skill_adjustment(uuid, uuid, uuid, uuid, numeric, text, text) to service_role;
grant execute on function public.record_skill_rating(uuid, uuid, uuid, uuid, numeric, text, text) to service_role;
grant execute on function public.save_skill_tunables(uuid, uuid, jsonb) to service_role;

do $$
declare
  t text;
  p text;
  f regprocedure;
begin
  foreach t in array array['people_shop_settings', 'people_skill_adjustments', 'people_skill_ratings', 'people_skill_tunables'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception '0270: RLS is off on %', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      raise exception '0270: % must have no policy', t;
    end if;
    if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = t
                and grantee in ('PUBLIC', 'anon', 'authenticated')) then
      raise exception '0270: a PostgREST role holds a grant on %', t;
    end if;
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege('service_role', 'public.' || t, p) <> (p = 'SELECT') then
        raise exception '0270: service_role % on % is not at its ceiling (SELECT)', p, t;
      end if;
    end loop;
  end loop;
  foreach f in array array[
    'public.skill_tunable_num(jsonb)'::regprocedure,
    'public.valid_skill_tunables(jsonb)'::regprocedure,
    'public.people_position_at_shop(uuid, uuid)'::regprocedure,
    'public.people_skill_reason_ok(text, text)'::regprocedure,
    'public.save_people_shop_settings(uuid, uuid, boolean, uuid)'::regprocedure,
    'public.record_skill_adjustment(uuid, uuid, uuid, uuid, numeric, text, text)'::regprocedure,
    'public.record_skill_rating(uuid, uuid, uuid, uuid, numeric, text, text)'::regprocedure,
    'public.save_skill_tunables(uuid, uuid, jsonb)'::regprocedure
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
       or not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '0270: function grant escaped on %', f;
    end if;
    if not coalesce((select proconfig from pg_proc where oid = f) @> array['search_path=pg_catalog, public'], false) then
      raise exception '0270: % must pin its search_path', f;
    end if;
  end loop;
  foreach f in array array[
    'public.people_position_at_shop(uuid, uuid)'::regprocedure,
    'public.save_people_shop_settings(uuid, uuid, boolean, uuid)'::regprocedure,
    'public.record_skill_adjustment(uuid, uuid, uuid, uuid, numeric, text, text)'::regprocedure,
    'public.record_skill_rating(uuid, uuid, uuid, uuid, numeric, text, text)'::regprocedure,
    'public.save_skill_tunables(uuid, uuid, jsonb)'::regprocedure
  ] loop
    if not (select prosecdef from pg_proc where oid = f) then
      raise exception '0270: writer % must be SECURITY DEFINER', f;
    end if;
  end loop;
  if exists (select 1 from information_schema.routine_privileges where routine_schema = 'public'
              and routine_name in ('skill_tunable_num', 'valid_skill_tunables', 'people_position_at_shop', 'people_skill_reason_ok',
                                   'save_people_shop_settings', 'record_skill_adjustment', 'record_skill_rating', 'save_skill_tunables')
              and grantee in ('PUBLIC', 'anon', 'authenticated')) then
    raise exception '0270: a PostgREST role can execute a 0270 function';
  end if;
end $$;

commit;
