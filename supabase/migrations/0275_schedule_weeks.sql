-- Migration 0275_schedule_weeks
-- AUTHORED 2026-10-16. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word, AFTER 0274).
-- Provenance: Smart Scheduling Phase 2, Task 14 (docs/superpowers/plans/2026-10-16-scheduling-phase2-BUILD.md,
--   "Migrations" and the commit / approve sketch), r2 (P1-3 the historical-preservation contract, P2-5 the complete
--   gap set, J11 approval as a separate fact, J12 the overwrite confirmation), r3 (P1 unresolved_search, P2-3
--   inheritance integrity past AND future, P2-4 the validation-context snapshot), r4 (P1 every unresolved_search gap
--   blocks Approve, inherited or not; P2 the complete need grid inside the snapshot), CC chunk B ruling 3 (the daily
--   maximum, HARD, per person per date — chunk C ruling 2), R3 (the Wednesday cron, its lease).
--
-- WHAT (every table deny-all RLS, SELECT-only for service_role; the definer writers are the ONLY writers):
--   1. schedule_weeks: one row per (shop, ISO week) — the HEAD pointer (the newest revision) and the newest approval.
--   2. schedule_revisions: append-only; EVERY revision is a COMPLETE snapshot of the week (generated / regenerated /
--      edited). No 'approved' kind: approval names a snapshot, it copies nothing.
--   3. schedule_revision_shifts: the snapshot's shifts (ET wall-clock quarters of one business date), segments
--      CHECKed by valid_schedule_segments; immutable.
--   4. schedule_revision_days: one row per date of the week — origin_revision_id = the revision in which this day's
--      content was last CHANGED, structure_version_id = the structure it was validated under there, inherited, and the
--      COMPLETE problem list (never truncated); immutable.
--   5. schedule_revision_gaps: the COMPLETE declared gap set with its cause-specific certificate (CHECKed by
--      valid_gap_certificate) — independent of the 50-row display summary; immutable.
--   6. schedule_revision_contexts: the RuleContext snapshot the revision's changed days were validated with (r3/r4:
--      roster, availability, positions, budgets, closing minutes, demand, and the COMPLETE need grid per changed
--      date). Original validation replays against it with no live read.
--   7. schedule_week_approvals: append-only facts "this snapshot is ready for 7shifts".
--   8. The cron lease: cron_route_leases_job_check and claim_cron_route re-emitted from 0268 with 'schedule-draft'.
--
-- WRITERS (SECURITY DEFINER, search_path pinned, service_role only; one advisory lock per (shop, week) taken first):
--   commit_schedule_revision(actor, location, week_start, expected_head, kind, structure_version, shifts, days, gaps,
--     context, meta) — the week's head moves only through here. In order (each a named refusal):
--       the actor (the edit class: GM own / MoO+ / an AGM with agm_access 'edit'; or NO actor = the cron, which may only
--       create a week that has no revision) · the lock · the week row · head_moved (optimistic on the head the person
--       saw; 'generated' only over no head) · shop_not_enabled · past_week · the payload shapes (invalid_payload,
--       edit_segments_malformed, edit_overlap, gap_certificate_invalid, person_not_at_shop) ·
--       history_changed: EVERY day marked inherited, past or future, must equal the head's day row (origin, structure
--         version, problems), its COMPLETE shift set and its COMPLETE gap set; a day not inherited has its origin set to
--         the new revision ·
--       day_locked: a day before ET today must be IDENTICAL to the head's (day row, shift set, gap set) — so a past day
--         re-judged instead of carried is refused, and an unchanged past day is accepted whatever happened since (a
--         person deactivated, a position retired) ·
--       edited_week_unconfirmed: a 'regenerated' revision over a week whose newest generated / regenerated revision is
--         followed by an 'edited' one needs meta.confirmed_overwrite = true (a CONFIRMATION check: the Tier B password
--         lives at the route, never in SQL — J12) ·
--       CURRENT ELIGIBILITY ONLY FOR NEW OR CHANGED FUTURE SHIFTS: a shift dated today or later that is not identical
--         (user, date, start, end, segments) to a head shift needs an active member (person_not_at_shop) and ACTIVE
--         positions of the shop on active stations (position_not_at_shop / position_retired), and the person's day may
--         not exceed the day's daily maximum from the snapshot (shift_over_maximum, HARD). An identical carried shift
--         is never re-judged.
--     Then the revision, its rows and its context are written and the head moves. Returns {revision_id, week_id, kind}.
--   approve_schedule_week(actor, location, week_start, expected_head) — GM own / MoO+ (never the AGM; Tier B at the
--     route): week_not_found · head_moved · shop_not_enabled · past_week · unresolved_gaps (ANY head gap whose cause
--     is unresolved_search, inherited or not — r4 P1) · rules_failing (an error-class problem on a day of the head
--     that is NOT inherited). Inserts an approval and moves approved_revision_id; writes no revision and copies no
--     shift. Approving the already-approved head again is a no-op.
--
-- REFUSALS (raise exception '<code>', P0001), every one a ScheduleErrorCode: invalid_payload · schedule_forbidden ·
--   schedule_role_refused · shop_not_allowed · head_moved · shop_not_enabled · past_week · week_not_found ·
--   edit_segments_malformed · edit_overlap · gap_certificate_invalid · day_locked · edited_week_unconfirmed ·
--   history_changed · person_not_at_shop · position_not_at_shop · position_retired · shift_over_maximum ·
--   unresolved_gaps · rules_failing.
--
-- DEPENDS ON: 0274 (the settings, schedule_actor_require, schedule_et_today, schedule_structures); 0270
--   people_position_at_shop; 0268's claim_cron_route (re-emitted here, its 0243 lease table).
--
-- PRE-FLIGHT (MCP, before apply):
--   select to_regprocedure('public.schedule_actor_require(uuid,uuid,integer)'), to_regclass('public.schedule_structures');  -- present (0274)
--   select position('sevenshifts-sync' in prosrc) > 0, position('schedule-draft' in prosrc) = 0
--     from pg_proc where oid = 'public.claim_cron_route(text)'::regprocedure;                                           -- t, t (0268's body)
--   select to_regclass('public.schedule_weeks');                                                                          -- NULL
--
-- VERIFY AFTER APPLY:
--   select relname, relrowsecurity from pg_class where relname like 'schedule\_%';            -- t ×14 (0274 + 0275)
--   select table_name, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name like 'schedule\_%' order by 1, 2;         -- service_role SELECT only
--   select public.claim_cron_route('schedule-draft');                                        -- t (then f within 330 s)

begin;

-- ── PRE-FLIGHT ──────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.schedule_actor_require(uuid,uuid,integer)') is null or to_regclass('public.schedule_structures') is null
     or to_regprocedure('public.schedule_et_today()') is null or to_regclass('public.schedule_shop_settings') is null then
    raise exception '0275: 0274 must be applied first';
  end if;
  if to_regprocedure('public.people_position_at_shop(uuid,uuid)') is null then
    raise exception '0275: 0270 people_position_at_shop must exist';
  end if;
  if to_regclass('public.cron_route_leases') is null or to_regprocedure('public.claim_cron_route(text)') is null
     or not exists (select 1 from pg_constraint where conrelid = 'public.cron_route_leases'::regclass
                     and conname = 'cron_route_leases_job_check' and contype = 'c') then
    raise exception '0275: the cron lease (0243, re-emitted by 0268) must exist';
  end if;
  if position('sevenshifts-sync' in (select prosrc from pg_proc where oid = 'public.claim_cron_route(text)'::regprocedure)) = 0
     or position('schedule-draft' in (select prosrc from pg_proc where oid = 'public.claim_cron_route(text)'::regprocedure)) > 0 then
    raise exception '0275: claim_cron_route is not 0268''s body';
  end if;
  if to_regclass('public.schedule_weeks') is not null or to_regclass('public.schedule_revisions') is not null then
    raise exception '0275: already applied';
  end if;
end $$;

-- ── SHAPE RULES ─────────────────────────────────────────────────────────────────────────────────
create function public.schedule_uuid_ok(p text) returns boolean
language sql immutable set search_path = pg_catalog, public as $$
  select p is not null and p ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
$$;

-- A shift's segments: a non-empty array, contiguous, spanning [p_start, p_end) exactly, each at least one quarter,
-- each position a uuid or "mod"; the optional flags lastResort (boolean), coverFor and reasonKey (strings). The TS
-- Segment exactly (lib/scheduling/rules-shared.ts).
create function public.valid_schedule_segments(p jsonb, p_start integer, p_end integer) returns boolean
language plpgsql immutable set search_path = pg_catalog, public as $$
declare v_e jsonb; v_at integer := p_start; v_s numeric; v_z numeric; k text;
begin
  if p is null or p_start is null or p_end is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) = 0 or p_start >= p_end then return false; end if;
  for v_e in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(v_e) <> 'object' or not (v_e ?& array['positionId', 'startQ', 'endQ']) then return false; end if;
    for k in select jsonb_object_keys(v_e) loop
      if k not in ('positionId', 'startQ', 'endQ', 'lastResort', 'coverFor', 'reasonKey') then return false; end if;
    end loop;
    if jsonb_typeof(v_e -> 'positionId') <> 'string' or not ((v_e ->> 'positionId') = 'mod' or public.schedule_uuid_ok(v_e ->> 'positionId')) then return false; end if;
    if not public.schedule_json_quarter(v_e -> 'startQ') or not public.schedule_json_quarter(v_e -> 'endQ') then return false; end if;
    v_s := (v_e ->> 'startQ')::numeric; v_z := (v_e ->> 'endQ')::numeric;
    if v_s <> v_at or v_z <= v_s then return false; end if;
    if (v_e ? 'lastResort' and jsonb_typeof(v_e -> 'lastResort') <> 'boolean')
       or (v_e ? 'coverFor' and jsonb_typeof(v_e -> 'coverFor') <> 'string')
       or (v_e ? 'reasonKey' and jsonb_typeof(v_e -> 'reasonKey') <> 'string') then return false; end if;
    v_at := v_z;
  end loop;
  return v_at = p_end;
end $$;

-- A JSON array of strings.
create function public.schedule_json_strings(p jsonb) returns boolean
language sql immutable set search_path = pg_catalog, public as $$
  select p is not null and jsonb_typeof(p) = 'array'
     and not exists (select 1 from jsonb_array_elements(p) e where jsonb_typeof(e) <> 'string')
$$;

-- A non-negative JSON number.
create function public.schedule_json_nonneg(p jsonb) returns boolean
language sql immutable set search_path = pg_catalog, public as $$
  select coalesce(public.schedule_json_num(p) >= 0, false)
$$;

-- A gap certificate's SHAPE per cause (the TS certificate types, lib/scheduling/rules-shared.ts): the exact key set,
-- strings where ids go, non-negative numbers where numbers go. Whether it VERIFIES is the validator's job
-- (checkCertificate, replayed against the revision's own context snapshot); SQL refuses what is not even a certificate.
create function public.valid_gap_certificate(p_cause text, c jsonb) returns boolean
language plpgsql immutable set search_path = pg_catalog, public as $$
declare k text; v jsonb;
begin
  if p_cause is null or c is null or jsonb_typeof(c) <> 'object' then return false; end if;
  case p_cause
    when 'budget' then
      return public.schedule_json_exact_keys(c, array['budgetedDates', 'budgetHours', 'usedHours', 'essentialHours', 'hoursNeeded'])
        and public.schedule_json_strings(c -> 'budgetedDates') and public.schedule_json_nonneg(c -> 'budgetHours')
        and public.schedule_json_nonneg(c -> 'usedHours') and public.schedule_json_nonneg(c -> 'essentialHours')
        and public.schedule_json_nonneg(c -> 'hoursNeeded');
    when 'floor_limit' then
      if not public.schedule_json_exact_keys(c, array['managerIds', 'floorHoursUsed', 'limitH']) or not public.schedule_json_strings(c -> 'managerIds')
         or jsonb_typeof(c -> 'floorHoursUsed') <> 'object' or not public.schedule_json_nonneg(c -> 'limitH') then return false; end if;
      for k, v in select key, value from jsonb_each(c -> 'floorHoursUsed') loop
        if not public.schedule_json_nonneg(v) then return false; end if;
      end loop;
      return true;
    when 'eligibility' then
      return public.schedule_json_exact_keys(c, array['positionId', 'eligibleCount'])
        and jsonb_typeof(c -> 'positionId') in ('string', 'null') and public.schedule_json_num(c -> 'eligibleCount') = 0;
    when 'availability' then
      return public.schedule_json_exact_keys(c, array['eligibleIds', 'unavailableIds'])
        and public.schedule_json_strings(c -> 'eligibleIds') and public.schedule_json_strings(c -> 'unavailableIds');
    when 'capacity' then
      return public.schedule_json_exact_keys(c, array['fromQ', 'toQ', 'positionIds', 'requiredHeads', 'peopleIds', 'people', 'shortBy'])
        and public.schedule_json_quarter(c -> 'fromQ') and public.schedule_json_quarter(c -> 'toQ')
        and public.schedule_json_num(c -> 'fromQ') < public.schedule_json_num(c -> 'toQ')
        and public.schedule_json_strings(c -> 'positionIds') and public.schedule_json_strings(c -> 'peopleIds')
        and public.schedule_json_int(c -> 'requiredHeads', 0, 1000) and public.schedule_json_int(c -> 'people', 0, 1000)
        and public.schedule_json_int(c -> 'shortBy', 1, 1000);
    when 'structure' then
      return public.schedule_json_exact_keys(c, array['rule', 'detail']) and jsonb_typeof(c -> 'rule') = 'string'
        and (c ->> 'rule') in ('primary_window_closed', 'no_mod_member', 'no_closing_role', 'max_shift')
        and jsonb_typeof(c -> 'detail') = 'object';
    when 'unresolved_search' then
      return public.schedule_json_exact_keys(c, array['searched', 'limits', 'candidateIds'])
        and public.schedule_json_exact_keys(c -> 'searched', array['steps', 'donorsTried', 'chainDepth'])
        and public.schedule_json_int(c -> 'searched' -> 'steps', 0, 1e6) and public.schedule_json_int(c -> 'searched' -> 'donorsTried', 0, 1e6)
        and public.schedule_json_int(c -> 'searched' -> 'chainDepth', 0, 1e6)
        and public.schedule_json_exact_keys(c -> 'limits', array['REPAIR_MAX_STEPS', 'maxDonors', 'maxChainDepth'])
        and public.schedule_json_int(c -> 'limits' -> 'REPAIR_MAX_STEPS', 0, 1e6) and public.schedule_json_int(c -> 'limits' -> 'maxDonors', 0, 1e6)
        and public.schedule_json_int(c -> 'limits' -> 'maxChainDepth', 0, 1e6)
        and public.schedule_json_strings(c -> 'candidateIds');
    else
      return false;
  end case;
end $$;

-- A day's problem list compared across revisions: the per-problem `inherited` flag is how a LATER revision labels a
-- carried problem, not part of the problem — it is set aside; everything else (and the order) must be identical.
create function public.schedule_problems_canon(p jsonb) returns jsonb
language sql immutable set search_path = pg_catalog, public as $$
  select coalesce((select jsonb_agg(case when jsonb_typeof(e) = 'object' then e - 'inherited' else e end order by i)
                     from jsonb_array_elements(p) with ordinality as x(e, i)), '[]'::jsonb)
$$;

-- ── THE TABLES ──────────────────────────────────────────────────────────────────────────────────
create table public.schedule_weeks (
  id                   uuid        primary key default gen_random_uuid(),
  location_id          uuid        not null references public.locations(id),
  week_start           date        not null check (extract(isodow from week_start) = 1),
  head_revision_id     uuid,
  approved_revision_id uuid,
  created_at           timestamptz not null default clock_timestamp(),
  unique (location_id, week_start),
  unique (id, location_id)
);
comment on table public.schedule_weeks is
  '0275: one row per (shop, ISO week): the head pointer (the newest revision) and the newest approval. Moved only by commit_schedule_revision / approve_schedule_week. Deny-all RLS.';

create table public.schedule_revisions (
  id                   uuid        primary key default gen_random_uuid(),
  week_id              uuid        not null,
  location_id          uuid        not null,
  kind                 text        not null check (kind in ('generated', 'regenerated', 'edited')),
  based_on_revision_id uuid,
  structure_version_id uuid,
  inputs_digest        text        not null check (char_length(inputs_digest) between 1 and 128),
  generator_version    text        not null check (char_length(generator_version) between 1 and 32),
  horizon_run_id       uuid,
  problems_summary     jsonb       not null check (jsonb_typeof(problems_summary) = 'object'),
  created_by           uuid        references public.users(id),
  actor_context        text        not null check (actor_context in ('user', 'cron')),
  created_at           timestamptz not null default clock_timestamp(),
  check ((created_by is null) = (actor_context = 'cron')),
  check (actor_context <> 'cron' or kind = 'generated'),
  unique (id, location_id),
  foreign key (week_id, location_id) references public.schedule_weeks (id, location_id),
  foreign key (based_on_revision_id, location_id) references public.schedule_revisions (id, location_id),
  foreign key (structure_version_id, location_id) references public.schedule_structures (id, location_id)
);
create index schedule_revisions_week on public.schedule_revisions (week_id, created_at desc, id desc);
comment on table public.schedule_revisions is
  '0275: a COMPLETE snapshot of one week (generated / regenerated / edited) — append-only by grant, with no exception. structure_version_id NULL = built on the seeded defaults (no saved structure). problems_summary is DISPLAY ONLY; the complete problems and gaps are in schedule_revision_days / _gaps. Deny-all RLS.';

alter table public.schedule_weeks
  add constraint schedule_weeks_head foreign key (head_revision_id, location_id) references public.schedule_revisions (id, location_id),
  add constraint schedule_weeks_approved foreign key (approved_revision_id, location_id) references public.schedule_revisions (id, location_id);

create table public.schedule_revision_shifts (
  revision_id     uuid     not null,
  location_id     uuid     not null,
  user_id         uuid     not null references public.users(id),
  business_date   date     not null,
  start_q         smallint not null,
  end_q           smallint not null,
  segments        jsonb    not null,
  closing_manager boolean  not null,
  flex            boolean  not null,
  pinned          boolean  not null,
  reasons         jsonb,
  constraint schedule_revision_shifts_window check (0 <= start_q and start_q < end_q and end_q <= 96),
  constraint schedule_revision_shifts_segments check (public.valid_schedule_segments(segments, start_q, end_q)),
  constraint schedule_revision_shifts_reasons check (reasons is null or jsonb_typeof(reasons) = 'object'),
  unique (revision_id, user_id, business_date, start_q),
  foreign key (revision_id, location_id) references public.schedule_revisions (id, location_id)
);
comment on table public.schedule_revision_shifts is
  '0275: the shifts of one revision snapshot (ET wall-clock quarters of a business date; segments CHECKed by valid_schedule_segments). Immutable by grant. Deny-all RLS.';

create table public.schedule_revision_days (
  revision_id          uuid    not null,
  location_id          uuid    not null,
  business_date        date    not null,
  origin_revision_id   uuid,
  structure_version_id uuid,
  inherited            boolean not null,
  problems             jsonb   not null check (jsonb_typeof(problems) = 'array'),
  unique (revision_id, business_date),
  foreign key (revision_id, location_id) references public.schedule_revisions (id, location_id),
  foreign key (origin_revision_id, location_id) references public.schedule_revisions (id, location_id),
  foreign key (structure_version_id, location_id) references public.schedule_structures (id, location_id),
  check (inherited or origin_revision_id = revision_id)
);
comment on table public.schedule_revision_days is
  '0275 (r2 P1-3): one row per date of a revision — origin_revision_id = where this day''s content last CHANGED (the revision itself when not inherited), the structure it was validated under there, and the COMPLETE problem list. Immutable by grant. Deny-all RLS.';

create table public.schedule_revision_gaps (
  revision_id        uuid     not null,
  location_id        uuid     not null,
  business_date      date     not null,
  code               text     not null check (code in ('coverage_gap', 'mod_missing', 'closing_manager_missing')),
  position_id        uuid,
  from_q             smallint not null,
  to_q               smallint not null,
  cause              text     not null check (cause in ('budget', 'floor_limit', 'eligibility', 'availability', 'capacity', 'structure', 'unresolved_search')),
  certificate        jsonb    not null,
  origin_revision_id uuid,
  constraint schedule_revision_gaps_window check (0 <= from_q and from_q < to_q and to_q <= 96),
  constraint schedule_revision_gaps_position check ((code = 'coverage_gap') = (position_id is not null)),
  constraint schedule_revision_gaps_certificate check (public.valid_gap_certificate(cause, certificate)),
  foreign key (revision_id, location_id) references public.schedule_revisions (id, location_id),
  foreign key (origin_revision_id, location_id) references public.schedule_revisions (id, location_id)
);
create unique index schedule_revision_gaps_one
  on public.schedule_revision_gaps (revision_id, business_date, code, coalesce(position_id, '00000000-0000-0000-0000-000000000000'::uuid), from_q);
comment on table public.schedule_revision_gaps is
  '0275 (r2 P2-5, r3): the COMPLETE declared gap set of a revision with its cause-specific certificate (shape CHECKed by valid_gap_certificate), independent of the display summary. origin_revision_id = the origin of its day. Immutable by grant. Deny-all RLS.';

create table public.schedule_revision_contexts (
  revision_id    uuid  primary key,
  location_id    uuid  not null,
  context        jsonb not null check (jsonb_typeof(context) = 'object' and octet_length(context::text) <= 262144),
  context_digest text  not null check (char_length(context_digest) between 1 and 128),
  foreign key (revision_id, location_id) references public.schedule_revisions (id, location_id)
);
comment on table public.schedule_revision_contexts is
  '0275 (r3 P2-4, r4 P2): the RuleContext snapshot a revision''s changed days were validated with — people, availability, positions, budgets, closing minutes, demand and the COMPLETE quarter-hour need grid per changed date. Original validation replays against it with NO live read; the digest is for quick comparison only. Immutable by grant. Deny-all RLS.';

create table public.schedule_week_approvals (
  id          uuid        primary key default gen_random_uuid(),
  week_id     uuid        not null,
  location_id uuid        not null,
  revision_id uuid        not null,
  approved_by uuid        not null references public.users(id),
  approved_at timestamptz not null default clock_timestamp(),
  foreign key (week_id, location_id) references public.schedule_weeks (id, location_id),
  foreign key (revision_id, location_id) references public.schedule_revisions (id, location_id)
);
create index schedule_week_approvals_week on public.schedule_week_approvals (week_id, approved_at desc);
comment on table public.schedule_week_approvals is
  '0275 (r2, J11): append-only facts "this snapshot is ready for 7shifts". An approval NAMES a revision; it copies nothing and is not a revision. Written only by approve_schedule_week. Deny-all RLS.';

alter table public.schedule_weeks enable row level security;
alter table public.schedule_revisions enable row level security;
alter table public.schedule_revision_shifts enable row level security;
alter table public.schedule_revision_days enable row level security;
alter table public.schedule_revision_gaps enable row level security;
alter table public.schedule_revision_contexts enable row level security;
alter table public.schedule_week_approvals enable row level security;
revoke all on public.schedule_weeks, public.schedule_revisions, public.schedule_revision_shifts, public.schedule_revision_days,
  public.schedule_revision_gaps, public.schedule_revision_contexts, public.schedule_week_approvals
  from public, anon, authenticated, service_role;
grant select on public.schedule_weeks, public.schedule_revisions, public.schedule_revision_shifts, public.schedule_revision_days,
  public.schedule_revision_gaps, public.schedule_revision_contexts, public.schedule_week_approvals
  to service_role;

-- ── CANONICAL DAY CONTENT ───────────────────────────────────────────────────────────────────────
-- One date of one revision, canonical: the day row (origin, structure version, problems with the carried-label set
-- aside), the COMPLETE shift set (user, start, end, segments, the three flags; ordered) and the COMPLETE gap set
-- (code, position, window, cause, certificate, origin; ordered). A date with no row reads as an empty day (no
-- origin, no problems, no shifts, no gaps). `p_with_sv` false sets the structure version aside — used only when
-- the HEAD has no row for the date (a day nobody built yet). Shift `reasons` are explanation, not content: the
-- generator relabels a carried shift "inherited", so they are not bound.
create function public.schedule_day_canon(p_revision uuid, p_date date, p_with_sv boolean)
returns jsonb language sql stable set search_path = pg_catalog, public as $$
  select jsonb_build_object(
    'origin', (select to_jsonb(d.origin_revision_id) from public.schedule_revision_days d where d.revision_id = p_revision and d.business_date = p_date),
    'sv', case when p_with_sv then (select to_jsonb(d.structure_version_id) from public.schedule_revision_days d
                                     where d.revision_id = p_revision and d.business_date = p_date) else null end,
    'problems', coalesce((select public.schedule_problems_canon(d.problems) from public.schedule_revision_days d
                           where d.revision_id = p_revision and d.business_date = p_date), '[]'::jsonb),
    'shifts', coalesce((select jsonb_agg(jsonb_build_object('user', s.user_id, 'start', s.start_q, 'end', s.end_q, 'segments', s.segments,
                                  'cm', s.closing_manager, 'flex', s.flex, 'pinned', s.pinned) order by s.user_id, s.start_q)
                          from public.schedule_revision_shifts s where s.revision_id = p_revision and s.business_date = p_date), '[]'::jsonb),
    'gaps', coalesce((select jsonb_agg(jsonb_build_object('code', g.code, 'position', g.position_id, 'from', g.from_q, 'to', g.to_q,
                                'cause', g.cause, 'certificate', g.certificate, 'origin', g.origin_revision_id)
                                order by g.code, g.position_id nulls first, g.from_q)
                        from public.schedule_revision_gaps g where g.revision_id = p_revision and g.business_date = p_date), '[]'::jsonb))
$$;

-- Is the new revision's date identical to the head's? (No head, or no head row for the date: an empty day, the
-- structure version set aside.)
create function public.schedule_day_same_as_head(p_new uuid, p_head uuid, p_date date)
returns boolean language plpgsql stable set search_path = pg_catalog, public as $$
declare v_has boolean;
begin
  v_has := p_head is not null and exists (select 1 from public.schedule_revision_days where revision_id = p_head and business_date = p_date);
  if v_has then
    return public.schedule_day_canon(p_new, p_date, true) = public.schedule_day_canon(p_head, p_date, true);
  end if;
  return public.schedule_day_canon(p_new, p_date, false)
       = jsonb_build_object('origin', null, 'sv', null, 'problems', '[]'::jsonb, 'shifts', '[]'::jsonb, 'gaps', '[]'::jsonb);
end $$;

-- ── THE WRITERS ─────────────────────────────────────────────────────────────────────────────────
create function public.commit_schedule_revision(p_actor uuid, p_location uuid, p_week_start date, p_expected_head uuid, p_kind text,
  p_structure_version uuid, p_shifts jsonb, p_days jsonb, p_gaps jsonb, p_context jsonb, p_meta jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_week public.schedule_weeks%rowtype; v_rev uuid; v_today date := public.schedule_et_today(); v_head uuid;
  v_e jsonb; k text; v_date date; v_dates date[]; v_seen date[] := '{}'; v_inh boolean; v_origin uuid; v_sv uuid;
  v_start integer; v_end integer; v_user uuid; v_pos text; v_max numeric; v_day record; v_shift record;
begin
  -- 0. the payload envelope and the actor (the cron has none, and may only create a week that has no revision)
  if p_location is null or p_week_start is null or p_kind is null or p_kind not in ('generated', 'regenerated', 'edited')
     or p_meta is null or jsonb_typeof(p_meta) <> 'object' or extract(isodow from p_week_start) <> 1 then
    raise exception 'invalid_payload';
  end if;
  for k in select jsonb_object_keys(p_meta) loop
    if k not in ('actor_context', 'confirmed_overwrite', 'inputs_digest', 'generator_version', 'horizon_run_id', 'problems_summary',
                 'revision_id', 'context_digest') then raise exception 'invalid_payload'; end if;
  end loop;
  if jsonb_typeof(p_meta -> 'actor_context') is distinct from 'string' or (p_meta ->> 'actor_context') not in ('user', 'cron')
     or jsonb_typeof(p_meta -> 'inputs_digest') is distinct from 'string' or char_length(p_meta ->> 'inputs_digest') not between 1 and 128
     or jsonb_typeof(p_meta -> 'generator_version') is distinct from 'string' or char_length(p_meta ->> 'generator_version') not between 1 and 32
     or jsonb_typeof(p_meta -> 'problems_summary') is distinct from 'object'
     or jsonb_typeof(p_meta -> 'context_digest') is distinct from 'string' or char_length(p_meta ->> 'context_digest') not between 1 and 128
     or (p_meta ? 'confirmed_overwrite' and jsonb_typeof(p_meta -> 'confirmed_overwrite') <> 'boolean')
     or (p_meta ? 'horizon_run_id' and jsonb_typeof(p_meta -> 'horizon_run_id') <> 'null' and not public.schedule_uuid_ok(p_meta ->> 'horizon_run_id'))
     or (p_meta ? 'revision_id' and not public.schedule_uuid_ok(p_meta ->> 'revision_id')) then
    raise exception 'invalid_payload';
  end if;
  if p_actor is null then
    if (p_meta ->> 'actor_context') <> 'cron' or p_kind <> 'generated' then raise exception 'schedule_forbidden'; end if;
    if not exists (select 1 from public.locations where id = p_location and active) then raise exception 'shop_not_allowed'; end if;
  else
    if (p_meta ->> 'actor_context') <> 'user' then raise exception 'invalid_payload'; end if;
    perform public.schedule_actor_require(p_actor, p_location, 6);
  end if;
  if (p_kind = 'generated') <> (p_expected_head is null) then raise exception 'invalid_payload'; end if;

  -- 1–3. one lock per (shop, week), the week row, the head the person saw
  perform pg_advisory_xact_lock(hashtextextended('schedule-week/' || p_location::text || '/' || p_week_start::text, 0));
  insert into public.schedule_weeks (location_id, week_start) values (p_location, p_week_start) on conflict (location_id, week_start) do nothing;
  select * into v_week from public.schedule_weeks where location_id = p_location and week_start = p_week_start for update;
  v_head := v_week.head_revision_id;
  if v_head is distinct from p_expected_head then raise exception 'head_moved'; end if;

  -- 4–5. the switch; a week that is entirely past
  if not coalesce((select enabled from public.schedule_shop_settings where location_id = p_location), false) then raise exception 'shop_not_enabled'; end if;
  if p_week_start + 6 < v_today then raise exception 'past_week'; end if;

  -- 6. shapes: the context, the days (exactly the week's 7), the shifts, the gaps
  if p_context is null or jsonb_typeof(p_context) <> 'object' or octet_length(p_context::text) > 262144
     or (p_context ->> 'locationId') is distinct from p_location::text or (p_context ->> 'weekStart') is distinct from to_char(p_week_start, 'YYYY-MM-DD')
     or jsonb_typeof(p_context -> 'days') is distinct from 'object' then
    raise exception 'invalid_payload';
  end if;
  if p_structure_version is not null and not exists (select 1 from public.schedule_structures where id = p_structure_version and location_id = p_location) then
    raise exception 'invalid_payload';
  end if;
  if p_days is null or jsonb_typeof(p_days) <> 'array' or jsonb_array_length(p_days) <> 7
     or p_shifts is null or jsonb_typeof(p_shifts) <> 'array' or p_gaps is null or jsonb_typeof(p_gaps) <> 'array' then
    raise exception 'invalid_payload';
  end if;
  v_dates := array(select p_week_start + i from generate_series(0, 6) i);

  v_rev := coalesce((p_meta ->> 'revision_id')::uuid, gen_random_uuid());
  if exists (select 1 from public.schedule_revisions where id = v_rev) then raise exception 'invalid_payload'; end if;
  insert into public.schedule_revisions (id, week_id, location_id, kind, based_on_revision_id, structure_version_id, inputs_digest, generator_version,
      horizon_run_id, problems_summary, created_by, actor_context)
    values (v_rev, v_week.id, p_location, p_kind, v_head, p_structure_version, p_meta ->> 'inputs_digest', p_meta ->> 'generator_version',
      case when jsonb_typeof(p_meta -> 'horizon_run_id') = 'string' then (p_meta ->> 'horizon_run_id')::uuid end,
      p_meta -> 'problems_summary', p_actor, p_meta ->> 'actor_context');

  for v_e in select value from jsonb_array_elements(p_days) loop
    if not public.schedule_json_exact_keys(v_e, array['date', 'originRevisionId', 'structureVersionId', 'inherited', 'problems'])
       or jsonb_typeof(v_e -> 'date') <> 'string' or (v_e ->> 'date') !~ '^\d{4}-\d{2}-\d{2}$'
       or jsonb_typeof(v_e -> 'inherited') <> 'boolean' or jsonb_typeof(v_e -> 'problems') <> 'array'
       or not (jsonb_typeof(v_e -> 'originRevisionId') = 'null' or public.schedule_uuid_ok(v_e ->> 'originRevisionId'))
       or not (jsonb_typeof(v_e -> 'structureVersionId') = 'null' or public.schedule_uuid_ok(v_e ->> 'structureVersionId')) then
      raise exception 'invalid_payload';
    end if;
    v_date := (v_e ->> 'date')::date;
    if not (v_date = any (v_dates)) or v_date = any (v_seen) then raise exception 'invalid_payload'; end if;
    v_seen := v_seen || v_date;
    v_inh := (v_e ->> 'inherited')::boolean;
    v_origin := (v_e ->> 'originRevisionId')::uuid;
    v_sv := (v_e ->> 'structureVersionId')::uuid;
    if not v_inh then
      -- A day built (or changed) in this revision: its origin is THIS revision, its context is in the snapshot.
      if v_origin is not null and v_origin <> v_rev then raise exception 'invalid_payload'; end if;
      if v_sv is distinct from p_structure_version or jsonb_typeof(p_context -> 'days' -> to_char(v_date, 'YYYY-MM-DD')) is distinct from 'object' then
        raise exception 'invalid_payload';
      end if;
      v_origin := v_rev;
    elsif v_origin is not null and not exists (select 1 from public.schedule_revisions where id = v_origin and location_id = p_location) then
      raise exception 'history_changed';
    end if;
    if v_sv is not null and not exists (select 1 from public.schedule_structures where id = v_sv and location_id = p_location) then
      raise exception 'history_changed';
    end if;
    insert into public.schedule_revision_days (revision_id, location_id, business_date, origin_revision_id, structure_version_id, inherited, problems)
      values (v_rev, p_location, v_date, v_origin, v_sv, v_inh, v_e -> 'problems');
  end loop;

  for v_e in select value from jsonb_array_elements(p_shifts) loop
    if jsonb_typeof(v_e) <> 'object' or not (v_e ?& array['userId', 'date', 'startQ', 'endQ', 'segments', 'closingManager', 'flex', 'pinned']) then
      raise exception 'invalid_payload';
    end if;
    for k in select jsonb_object_keys(v_e) loop
      if k not in ('userId', 'date', 'startQ', 'endQ', 'segments', 'closingManager', 'flex', 'pinned', 'reasons') then raise exception 'invalid_payload'; end if;
    end loop;
    if not public.schedule_uuid_ok(v_e ->> 'userId') or jsonb_typeof(v_e -> 'date') <> 'string' or (v_e ->> 'date') !~ '^\d{4}-\d{2}-\d{2}$'
       or not public.schedule_json_quarter(v_e -> 'startQ') or not public.schedule_json_quarter(v_e -> 'endQ')
       or jsonb_typeof(v_e -> 'closingManager') <> 'boolean' or jsonb_typeof(v_e -> 'flex') <> 'boolean' or jsonb_typeof(v_e -> 'pinned') <> 'boolean'
       or (v_e ? 'reasons' and jsonb_typeof(v_e -> 'reasons') not in ('object', 'null')) then
      raise exception 'invalid_payload';
    end if;
    v_date := (v_e ->> 'date')::date;
    v_start := (v_e ->> 'startQ')::numeric; v_end := (v_e ->> 'endQ')::numeric;
    v_user := (v_e ->> 'userId')::uuid;
    if not (v_date = any (v_dates)) then raise exception 'invalid_payload'; end if;
    if v_start >= v_end or not public.valid_schedule_segments(v_e -> 'segments', v_start, v_end) then raise exception 'edit_segments_malformed'; end if;
    if not exists (select 1 from public.users where id = v_user) then raise exception 'person_not_at_shop'; end if;
    if exists (select 1 from public.schedule_revision_shifts where revision_id = v_rev and user_id = v_user and business_date = v_date
                and start_q < v_end and end_q > v_start) then
      raise exception 'edit_overlap';
    end if;
    insert into public.schedule_revision_shifts (revision_id, location_id, user_id, business_date, start_q, end_q, segments, closing_manager, flex, pinned, reasons)
      values (v_rev, p_location, v_user, v_date, v_start, v_end, v_e -> 'segments', (v_e ->> 'closingManager')::boolean, (v_e ->> 'flex')::boolean,
        (v_e ->> 'pinned')::boolean, case when jsonb_typeof(v_e -> 'reasons') = 'object' then v_e -> 'reasons' end);
  end loop;

  for v_e in select value from jsonb_array_elements(p_gaps) loop
    if not public.schedule_json_exact_keys(v_e, array['date', 'code', 'positionId', 'fromQ', 'toQ', 'cause', 'certificate'])
       or jsonb_typeof(v_e -> 'date') <> 'string' or (v_e ->> 'date') !~ '^\d{4}-\d{2}-\d{2}$'
       or jsonb_typeof(v_e -> 'code') <> 'string' or (v_e ->> 'code') not in ('coverage_gap', 'mod_missing', 'closing_manager_missing')
       or jsonb_typeof(v_e -> 'cause') <> 'string'
       or (v_e ->> 'cause') not in ('budget', 'floor_limit', 'eligibility', 'availability', 'capacity', 'structure', 'unresolved_search')
       or not (jsonb_typeof(v_e -> 'positionId') = 'null' or public.schedule_uuid_ok(v_e ->> 'positionId'))
       or ((v_e ->> 'code') = 'coverage_gap') <> (jsonb_typeof(v_e -> 'positionId') = 'string')
       or not public.schedule_json_quarter(v_e -> 'fromQ') or not public.schedule_json_quarter(v_e -> 'toQ')
       or (v_e ->> 'fromQ')::numeric >= (v_e ->> 'toQ')::numeric then
      raise exception 'invalid_payload';
    end if;
    if not public.valid_gap_certificate(v_e ->> 'cause', v_e -> 'certificate') then raise exception 'gap_certificate_invalid'; end if;
    v_date := (v_e ->> 'date')::date;
    if not (v_date = any (v_dates)) then raise exception 'invalid_payload'; end if;
    if exists (select 1 from public.schedule_revision_gaps where revision_id = v_rev and business_date = v_date and code = (v_e ->> 'code')
                and position_id is not distinct from (v_e ->> 'positionId')::uuid and from_q = (v_e ->> 'fromQ')::numeric) then
      raise exception 'invalid_payload';
    end if;
    -- A gap's origin is its day's: carried with an inherited day, this revision's on a built day.
    insert into public.schedule_revision_gaps (revision_id, location_id, business_date, code, position_id, from_q, to_q, cause, certificate, origin_revision_id)
      select v_rev, p_location, v_date, v_e ->> 'code', (v_e ->> 'positionId')::uuid, (v_e ->> 'fromQ')::numeric, (v_e ->> 'toQ')::numeric,
             v_e ->> 'cause', v_e -> 'certificate', d.origin_revision_id
        from public.schedule_revision_days d where d.revision_id = v_rev and d.business_date = v_date;
  end loop;

  insert into public.schedule_revision_contexts (revision_id, location_id, context, context_digest)
    values (v_rev, p_location, p_context, p_meta ->> 'context_digest');

  -- 9 (r3 P2-3), judged FIRST among the content checks: inheritance integrity, past AND future: an inherited day is the head's day exactly.
  for v_day in select business_date from public.schedule_revision_days where revision_id = v_rev and inherited order by business_date loop
    if not public.schedule_day_same_as_head(v_rev, v_head, v_day.business_date) then raise exception 'history_changed'; end if;
  end loop;

  -- 6'. day_locked: every day before ET today (inherited or, refused here, re-judged) is IDENTICAL to the head's (an unchanged past day is accepted whatever
  -- happened since — a person deactivated, a position retired — because nothing in it is re-judged).
  for v_date in select unnest(v_dates) loop
    if v_date < v_today and not public.schedule_day_same_as_head(v_rev, v_head, v_date) then raise exception 'day_locked'; end if;
  end loop;

  -- 7. edited_week_unconfirmed: a regenerate over manager edits needs the per-week confirmation (J12; no password here).
  if p_kind = 'regenerated' and exists (
       select 1 from public.schedule_revisions r
        where r.week_id = v_week.id and r.id <> v_rev and r.kind = 'edited'
          and r.created_at > coalesce((select max(g.created_at) from public.schedule_revisions g
                                        where g.week_id = v_week.id and g.id <> v_rev and g.kind in ('generated', 'regenerated')), '-infinity'::timestamptz))
     and coalesce((p_meta ->> 'confirmed_overwrite')::boolean, false) is not true then
    raise exception 'edited_week_unconfirmed';
  end if;

  -- 8 (r2 P1-3). current eligibility ONLY for new or changed future shifts; the daily maximum for their person-day.
  for v_shift in
    select s.* from public.schedule_revision_shifts s
     where s.revision_id = v_rev and s.business_date >= v_today
       and not exists (select 1 from public.schedule_revision_shifts h
                        where h.revision_id = v_head and h.user_id = s.user_id and h.business_date = s.business_date
                          and h.start_q = s.start_q and h.end_q = s.end_q and h.segments = s.segments)
     order by s.business_date, s.user_id, s.start_q
  loop
    if not exists (select 1 from public.users where id = v_shift.user_id and active)
       or (coalesce(public.assignment_author_level(v_shift.user_id), 0) < 8
           and not exists (select 1 from public.user_locations where user_id = v_shift.user_id and location_id = p_location and active)) then
      raise exception 'person_not_at_shop';
    end if;
    for v_pos in select distinct g ->> 'positionId' from jsonb_array_elements(v_shift.segments) g where g ->> 'positionId' <> 'mod' loop
      perform public.people_position_at_shop(v_pos::uuid, p_location);
    end loop;
    v_max := public.schedule_json_num(p_context -> 'days' -> to_char(v_shift.business_date, 'YYYY-MM-DD') -> 'structure' -> 'limits' -> 'maxShiftH');
    if v_max is null then raise exception 'invalid_payload'; end if;
    if (select sum(end_q - start_q) from public.schedule_revision_shifts
         where revision_id = v_rev and user_id = v_shift.user_id and business_date = v_shift.business_date) > v_max * 4 then
      raise exception 'shift_over_maximum';
    end if;
  end loop;

  -- 10. the head moves
  update public.schedule_weeks set head_revision_id = v_rev where id = v_week.id;
  return jsonb_build_object('revision_id', v_rev, 'week_id', v_week.id, 'kind', p_kind);
end $$;

create function public.approve_schedule_week(p_actor uuid, p_location uuid, p_week_start date, p_expected_head uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_week public.schedule_weeks%rowtype; v_id uuid;
begin
  if p_actor is null or p_location is null or p_week_start is null or p_expected_head is null then raise exception 'invalid_payload'; end if;
  perform public.schedule_actor_require(p_actor, p_location, 7);
  perform pg_advisory_xact_lock(hashtextextended('schedule-week/' || p_location::text || '/' || p_week_start::text, 0));
  select * into v_week from public.schedule_weeks where location_id = p_location and week_start = p_week_start for update;
  if not found or v_week.head_revision_id is null then raise exception 'week_not_found'; end if;
  if v_week.head_revision_id <> p_expected_head then raise exception 'head_moved'; end if;
  if not coalesce((select enabled from public.schedule_shop_settings where location_id = p_location), false) then raise exception 'shop_not_enabled'; end if;
  if p_week_start + 6 < public.schedule_et_today() then raise exception 'past_week'; end if;
  -- r4 (P1): EVERY unresolved_search gap of the head blocks Approve, inherited or not — the inherited-error exemption
  -- never covers it (the lib's approvalRefusal checks it first, too).
  if exists (select 1 from public.schedule_revision_gaps where revision_id = v_week.head_revision_id and cause = 'unresolved_search') then
    raise exception 'unresolved_gaps';
  end if;
  -- J18: an error-class problem blocks only when it is NOT inherited (a carried earlier problem does not).
  if exists (select 1 from public.schedule_revision_days d, jsonb_array_elements(d.problems) p
              where d.revision_id = v_week.head_revision_id and not d.inherited
                and p ->> 'severity' = 'error' and not coalesce((p ->> 'inherited')::boolean, false)) then
    raise exception 'rules_failing';
  end if;
  if v_week.approved_revision_id = v_week.head_revision_id then
    return jsonb_build_object('approval_id', null, 'revision_id', v_week.head_revision_id, 'already_approved', true);
  end if;
  insert into public.schedule_week_approvals (week_id, location_id, revision_id, approved_by)
    values (v_week.id, p_location, v_week.head_revision_id, p_actor) returning id into v_id;
  update public.schedule_weeks set approved_revision_id = v_week.head_revision_id where id = v_week.id;
  return jsonb_build_object('approval_id', v_id, 'revision_id', v_week.head_revision_id, 'already_approved', false);
end $$;

-- ── GRANTS: every function service_role only; the tables sit at the SELECT ceiling ───────────────
revoke all on function public.schedule_uuid_ok(text) from public, anon, authenticated;
revoke all on function public.valid_schedule_segments(jsonb, integer, integer) from public, anon, authenticated;
revoke all on function public.schedule_json_strings(jsonb) from public, anon, authenticated;
revoke all on function public.schedule_json_nonneg(jsonb) from public, anon, authenticated;
revoke all on function public.valid_gap_certificate(text, jsonb) from public, anon, authenticated;
revoke all on function public.schedule_problems_canon(jsonb) from public, anon, authenticated;
revoke all on function public.schedule_day_canon(uuid, date, boolean) from public, anon, authenticated;
revoke all on function public.schedule_day_same_as_head(uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.commit_schedule_revision(uuid, uuid, date, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.approve_schedule_week(uuid, uuid, date, uuid) from public, anon, authenticated;
grant execute on function public.schedule_uuid_ok(text) to service_role;
grant execute on function public.valid_schedule_segments(jsonb, integer, integer) to service_role;
grant execute on function public.schedule_json_strings(jsonb) to service_role;
grant execute on function public.schedule_json_nonneg(jsonb) to service_role;
grant execute on function public.valid_gap_certificate(text, jsonb) to service_role;
grant execute on function public.schedule_problems_canon(jsonb) to service_role;
grant execute on function public.schedule_day_canon(uuid, date, boolean) to service_role;
grant execute on function public.schedule_day_same_as_head(uuid, uuid, date) to service_role;
grant execute on function public.commit_schedule_revision(uuid, uuid, date, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.approve_schedule_week(uuid, uuid, date, uuid) to service_role;

-- ── THE CEILING GUARD ───────────────────────────────────────────────────────────────────────────
do $$
declare
  t text;
  p text;
  f regprocedure;
begin
  foreach t in array array['schedule_weeks', 'schedule_revisions', 'schedule_revision_shifts', 'schedule_revision_days', 'schedule_revision_gaps',
                           'schedule_revision_contexts', 'schedule_week_approvals'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception '0275: RLS is off on %', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      raise exception '0275: % must have no policy', t;
    end if;
    if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = t
                and grantee in ('PUBLIC', 'anon', 'authenticated')) then
      raise exception '0275: a PostgREST role holds a grant on %', t;
    end if;
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege('service_role', 'public.' || t, p) <> (p = 'SELECT') then
        raise exception '0275: service_role % on % is not at its ceiling (SELECT)', p, t;
      end if;
    end loop;
  end loop;
  foreach f in array array[
    'public.schedule_uuid_ok(text)'::regprocedure,
    'public.valid_schedule_segments(jsonb, integer, integer)'::regprocedure,
    'public.schedule_json_strings(jsonb)'::regprocedure,
    'public.schedule_json_nonneg(jsonb)'::regprocedure,
    'public.valid_gap_certificate(text, jsonb)'::regprocedure,
    'public.schedule_problems_canon(jsonb)'::regprocedure,
    'public.schedule_day_canon(uuid, date, boolean)'::regprocedure,
    'public.schedule_day_same_as_head(uuid, uuid, date)'::regprocedure,
    'public.commit_schedule_revision(uuid, uuid, date, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb, jsonb)'::regprocedure,
    'public.approve_schedule_week(uuid, uuid, date, uuid)'::regprocedure
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
       or not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '0275: function grant escaped on %', f;
    end if;
    if not coalesce((select proconfig from pg_proc where oid = f) @> array['search_path=pg_catalog, public'], false) then
      raise exception '0275: % must pin its search_path', f;
    end if;
  end loop;
  foreach f in array array[
    'public.commit_schedule_revision(uuid, uuid, date, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb, jsonb)'::regprocedure,
    'public.approve_schedule_week(uuid, uuid, date, uuid)'::regprocedure
  ] loop
    if not (select prosecdef from pg_proc where oid = f) then
      raise exception '0275: writer % must be SECURITY DEFINER', f;
    end if;
  end loop;
  if exists (select 1 from information_schema.routine_privileges where routine_schema = 'public'
              and routine_name in ('schedule_uuid_ok', 'valid_schedule_segments', 'schedule_json_strings', 'schedule_json_nonneg', 'valid_gap_certificate',
                                   'schedule_problems_canon', 'schedule_day_canon', 'schedule_day_same_as_head', 'commit_schedule_revision', 'approve_schedule_week')
              and grantee in ('PUBLIC', 'anon', 'authenticated')) then
    raise exception '0275: a PostgREST role can execute a 0275 function';
  end if;
end $$;

-- ── THE CRON LEASE: 0268 re-emitted with 'schedule-draft' (R3) ──────────────────────────────────
alter table public.cron_route_leases drop constraint cron_route_leases_job_check,
  add constraint cron_route_leases_job_check check (job in ('toast-sales-today', 'toast-catering-scan', 'sevenshifts-sync', 'schedule-draft'));

create or replace function public.claim_cron_route(p_job text)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare claimed text;
begin
  if p_job is null or p_job not in ('toast-sales-today', 'toast-catering-scan', 'sevenshifts-sync', 'schedule-draft') then
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
