-- Migration 0274_schedule_settings
-- AUTHORED 2026-10-16. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word, AFTER 0272 and BEFORE 0275).
-- Provenance: Smart Scheduling Phase 2, Task 13 (docs/superpowers/plans/2026-10-16-scheduling-phase2-BUILD.md,
--   "Migrations"), r2 (P2-7 date-scoped budgets, O1/O2/O6 settings), r3 (per-DATE budget precedence), CC chunk B
--   ruling 3 + chunk C ruling 2 (limits.maxShiftH, default 10.5 h, inside the structure jsonb — no column).
--   CC chunk D ruling 1 (limits.salariedStayLonger, boolean, default ON in the TS defaults — also inside the jsonb).
--   Juan 2026-10-16 (chunk H): limits.salariedTargetWeekH (quarter-hours 0-80, default 40) and limits.salariedFlexH
--   (quarter-hours 0-10, default 10) inside the structure jsonb (decision 4); the hourly estimate's column default 1840
--   (decision 2). The KH-as-MoD 19:00 default and the roster exclusions are TS defaults inside the jsonb (no SQL change).
--
-- WHAT (every table deny-all RLS, SELECT-only for service_role — the definer writers below are the ONLY writers,
--   the accepted Phase 1 posture of 0269/0270):
--   1. schedule_shop_settings: one row per shop — the switch `enabled` (OFF by default; no row = off), the wage
--      estimates (the hourly one defaults to the DC minimum wage, 1840 cents = $18.40/h since Jul 1, 2026 — Juan
--      2026-10-16, decision 2, MoO-editable, re-checked every July 1; the salaried one NULL = blank until the MoO sets
--      it, R2) and `agm_access` ('read' default, R1).
--   2. schedule_structures: the schedule structure, one VERSION per row (append-only); the live structure is the
--      newest row per shop. The jsonb is CHECKed by valid_schedule_structure, the SQL twin of the TS
--      validScheduleStructure (lib/scheduling/structure-shared.ts) — BOTH pinned against the one shared case file
--      tests/fixtures/schedule/structure-cases.json (vitest + scripts/sql-harness-0274.mjs).
--   3. schedule_person_settings: append-only; the latest row per (shop, user) wins (work type, also allowed, leader
--      setting, ordered cover positions, soft range, full timer, roster_include — R6, never for cgs / SMM).
--   4. schedule_budget_entries + schedule_budget_days (r3): one row per manager ENTRY and its per-DATE apportionment,
--      written together; the budget for a date = the day row of the NEWEST entry covering it (created_at, then id).
--   5. schedule_day_types: append-only per-date overrides ('auto' | 'slow' | 'normal' | 'busy'); the latest wins.
--   6. schedule_pins: presence toggles and "Add to schedule" blocks; append-only — a retirement is a NEW row
--      (active = false) naming the pin it retires (`retires_id`), at most one per pin.
--
-- WRITERS (SECURITY DEFINER, search_path pinned, service_role only). Each takes its per-shop (per-shop-user)
--   advisory lock BEFORE it reads, re-checks the actor, the subject and the positions in SQL, and returns what the
--   lib's audit row needs. The lib (lib/scheduling/*) decides every rule first, before any I/O.
--     save_schedule_shop_settings(actor, location, enabled, hourly cents, salaried weekly cents, agm access)  MoO+
--     save_schedule_structure(actor, location, expected, structure)                 GM own shop / MoO+ (Tier E at the route)
--     record_schedule_person_settings(actor, location, user, …)                     GM own / MoO+ / AGM when agm_access = 'edit'
--     record_schedule_budget_entry(actor, location, scope, week, month, hours, days, source, digest, apportioned_by)  (same)
--     record_schedule_day_type(actor, location, date, day type)                     (same)
--     record_schedule_pin(actor, location, date, user, start, end, positions, kind, retires)  (same)
--   schedule_actor_level(actor, location) is the ONE actor rule (it mirrors lib/scheduling/access-shared.ts): the
--   social media manager refused by ROLE; GM (7) own shop; MoO (8)+ any active shop; an AGM only at an own shop and
--   only as an EDITOR when that shop's agm_access = 'edit' (6), else read-only (5, refused by every writer); every
--   other role refused.
--
-- REFUSALS (raise exception '<code>', P0001) — every one a ScheduleErrorCode (lib/scheduling/errors-shared.ts):
--   invalid_payload · schedule_forbidden · schedule_role_refused · shop_not_allowed · structure_moved ·
--   structure_invalid · person_not_at_shop · position_not_at_shop · position_retired · roster_include_refused ·
--   budget_invalid · wage_estimate_invalid · pin_invalid · day_locked.
--
-- DEPENDS ON: 0270 people_position_at_shop + station_positions_id_location; 0228 assignment_author_level (reused,
--   never copied); 0272 (the PostgREST write lockdown — asserted below on two of its tables).
--
-- PRE-FLIGHT (MCP, before apply):
--   select to_regprocedure('public.people_position_at_shop(uuid,uuid)'), to_regprocedure('public.assignment_author_level(uuid)'),
--          to_regclass('public.station_positions_id_location');                                    -- all present
--   select has_table_privilege('authenticated', 'public.user_locations', 'INSERT');               -- f (0272)
--   select to_regclass('public.schedule_shop_settings'), to_regclass('public.schedule_structures'); -- both NULL
--   (the preflight block below asserts all of it and refuses otherwise)
--
-- VERIFY AFTER APPLY:
--   select relname, relrowsecurity from pg_class where relname like 'schedule\_%';                 -- t ×7
--   select table_name, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name like 'schedule\_%' order by 1, 2;              -- service_role SELECT only
--   select routine_name, grantee from information_schema.routine_privileges where routine_schema = 'public'
--    and routine_name like '%schedule%' order by 1, 2;                                            -- service_role (+ postgres) only

begin;

-- ── PRE-FLIGHT ──────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.people_position_at_shop(uuid,uuid)') is null or to_regclass('public.station_positions_id_location') is null then
    raise exception '0274: 0270 (people_position_at_shop + station_positions_id_location) must be applied first';
  end if;
  if to_regprocedure('public.assignment_author_level(uuid)') is null then
    raise exception '0274: the 0228 level helper assignment_author_level must exist';
  end if;
  if has_table_privilege('authenticated', 'public.user_locations', 'INSERT') or has_table_privilege('authenticated', 'public.locations', 'UPDATE') then
    raise exception '0274: 0272 (the PostgREST write lockdown) must be applied first';
  end if;
  if to_regclass('public.schedule_shop_settings') is not null or to_regclass('public.schedule_structures') is not null
     or to_regclass('public.schedule_person_settings') is not null or to_regclass('public.schedule_budget_entries') is not null
     or to_regclass('public.schedule_budget_days') is not null or to_regclass('public.schedule_day_types') is not null
     or to_regclass('public.schedule_pins') is not null then
    raise exception '0274: already applied';
  end if;
end $$;

-- ── THE STRUCTURE RULE SET (the SQL twin of validScheduleStructure) ─────────────────────────────
-- A JSON number → numeric, NULL when it is not a JSON number.
create function public.schedule_json_num(p jsonb) returns numeric
language sql immutable set search_path = pg_catalog, public as $$
  select case when p is not null and jsonb_typeof(p) = 'number' then (p #>> '{}')::numeric end
$$;

-- An integer JSON number in [lo, hi] (the TS isInt: Number.isInteger, so 2.0 counts).
create function public.schedule_json_int(p jsonb, lo numeric, hi numeric) returns boolean
language sql immutable set search_path = pg_catalog, public as $$
  select coalesce((select v = trunc(v) and v between lo and hi from (select public.schedule_json_num(p) as v) x), false)
$$;

-- A quarter of the day: an integer in [0, 96] (the TS isQuarter).
create function public.schedule_json_quarter(p jsonb) returns boolean
language sql immutable set search_path = pg_catalog, public as $$
  select public.schedule_json_int(p, 0, 96)
$$;

-- A number of hours on the quarter-hour grid in [lo, hi] (the TS isQuarterHours).
create function public.schedule_json_qhours(p jsonb, lo numeric, hi numeric) returns boolean
language sql immutable set search_path = pg_catalog, public as $$
  select coalesce((select v between lo and hi and v * 4 = trunc(v * 4) from (select public.schedule_json_num(p) as v) x), false)
$$;

-- An object with EXACTLY these keys (the TS exactKeys).
create function public.schedule_json_exact_keys(p jsonb, keys text[]) returns boolean
language sql immutable set search_path = pg_catalog, public as $$
  select p is not null and jsonb_typeof(p) = 'object'
     and (select count(*) from jsonb_object_keys(p)) = cardinality(keys) and p ?& keys
$$;

-- The role codes (lib/roles.ts ROLES — a product invariant, identical in every tenant).
create function public.schedule_role_codes() returns text[]
language sql immutable set search_path = pg_catalog, public as $$
  select array['cgs', 'owner', 'moo', 'gm', 'agm', 'catering_mgr', 'prep_mgr', 'social_media_mgr', 'shift_lead',
               'key_holder', 'trainer', 'employee', 'trainee', 'hired_not_yet_worked', 'prospect']
$$;

-- An array of distinct role codes (the TS checkRoleList).
create function public.schedule_role_list_ok(p jsonb) returns boolean
language sql immutable set search_path = pg_catalog, public as $$
  select p is not null and jsonb_typeof(p) = 'array'
     and not exists (select 1 from jsonb_array_elements(p) e
                      where jsonb_typeof(e) <> 'string' or not ((e #>> '{}') = any (public.schedule_role_codes())))
     and (select count(*) from jsonb_array_elements(p)) = (select count(distinct e) from jsonb_array_elements(p) e)
$$;

-- The rule set. Returns only true / false: naming the failing key is the TS validator's job (the case file's `key`
-- is checked by vitest only). Every rule of structureProblem, in the same terms; see the TS for each rule's why.
-- The r3 wave-bounds rule (minHeads(q) <= W_q <= maxHeads(q) over the service period) is evaluated in its closed
-- form: W is clamped into [minHeads, maxHeads] by construction (waveProfile), so W_q <= maxHeads(q) always and
-- W_q < minHeads(q) exactly when maxHeads(q) < minHeads(q). The rule therefore fails exactly when, at some quarter
-- before service close, the line floors exceed the line capacity — which is what this computes.
create function public.valid_schedule_structure(p jsonb) returns boolean
language plpgsql immutable set search_path = pg_catalog, public as $$
declare
  v_sd jsonb; v_dt jsonb; v_pos jsonb; v_crews jsonb; v_c jsonb; v_w jsonb; v_x jsonb; v_lead jsonb; v_lim jsonb;
  v_cat jsonb; v_lab jsonb; v_e jsonb; v_pair jsonb; v_p jsonb;
  k text; t text; v_seen text[] := '{}';
  v_prep int; v_dish int; v_start int; v_close int; v_outE int; v_outL int; v_span int;
  v_open int; v_trim int; v_cl int; v_before int; v_after int; v_n numeric; v_cap int;
  v_minh int[]; v_maxh int[]; q int;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  if not public.schedule_json_exact_keys(p, array['version', 'shopDay', 'dayTypes', 'crews', 'positions', 'priority', 'leadership',
                                                   'limits', 'catering', 'labor', 'roster']) then return false; end if;
  if public.schedule_json_num(p -> 'version') is distinct from 1 then return false; end if;

  -- shopDay
  v_sd := p -> 'shopDay';
  if not public.schedule_json_exact_keys(v_sd, array['prepStartQ', 'prepDishArrivalQ', 'serviceStartQ', 'serviceCloseQ', 'outEarliestQ', 'outLatestQ']) then
    return false;
  end if;
  foreach k in array array['prepStartQ', 'prepDishArrivalQ', 'serviceStartQ', 'serviceCloseQ', 'outEarliestQ', 'outLatestQ'] loop
    if not public.schedule_json_quarter(v_sd -> k) then return false; end if;
  end loop;
  v_prep := (v_sd ->> 'prepStartQ')::numeric; v_dish := (v_sd ->> 'prepDishArrivalQ')::numeric;
  v_start := (v_sd ->> 'serviceStartQ')::numeric; v_close := (v_sd ->> 'serviceCloseQ')::numeric;
  v_outE := (v_sd ->> 'outEarliestQ')::numeric; v_outL := (v_sd ->> 'outLatestQ')::numeric;
  if v_dish < v_prep or v_start < v_prep or v_close <= v_start or v_outE < v_close or v_outE > v_outL then return false; end if;

  -- dayTypes
  v_dt := p -> 'dayTypes';
  if not public.schedule_json_exact_keys(v_dt, array['slowBelowCents', 'busyAboveCents', 'weekendIsoDows']) then return false; end if;
  if not public.schedule_json_int(v_dt -> 'slowBelowCents', 0, 1e9) or not public.schedule_json_int(v_dt -> 'busyAboveCents', 0, 1e9) then return false; end if;
  if public.schedule_json_num(v_dt -> 'slowBelowCents') >= public.schedule_json_num(v_dt -> 'busyAboveCents') then return false; end if;
  if jsonb_typeof(v_dt -> 'weekendIsoDows') <> 'array'
     or exists (select 1 from jsonb_array_elements(v_dt -> 'weekendIsoDows') e where not public.schedule_json_int(e, 1, 7))
     or (select count(*) from jsonb_array_elements(v_dt -> 'weekendIsoDows'))
        <> (select count(distinct (e #>> '{}')::numeric) from jsonb_array_elements(v_dt -> 'weekendIsoDows') e) then
    return false;
  end if;

  -- positions
  v_pos := p -> 'positions';
  if jsonb_typeof(v_pos) <> 'object' then return false; end if;
  for k, v_p in select key, value from jsonb_each(v_pos) loop
    if k = '' or k = 'mod' or jsonb_typeof(v_p) <> 'object' then return false; end if;
    if not public.schedule_json_exact_keys(v_p, array['role', 'openQ', 'trimQ', 'closeQ', 'headsBefore', 'headsAfter', 'allowedRoles']) then return false; end if;
    if jsonb_typeof(v_p -> 'role') <> 'string'
       or not ((v_p ->> 'role') = any (array['prep', 'prep_dish', 'register', 'expo', 'walk', 'walk_online', 'line_other'])) then return false; end if;
    if not public.schedule_json_quarter(v_p -> 'openQ') or not public.schedule_json_quarter(v_p -> 'trimQ')
       or not public.schedule_json_quarter(v_p -> 'closeQ') then return false; end if;
    if not public.schedule_json_int(v_p -> 'headsBefore', 0, 8) or not public.schedule_json_int(v_p -> 'headsAfter', 0, 8) then return false; end if;
    if (v_p ->> 'openQ')::numeric > (v_p ->> 'trimQ')::numeric or (v_p ->> 'trimQ')::numeric > (v_p ->> 'closeQ')::numeric then return false; end if;
    if not public.schedule_role_list_ok(v_p -> 'allowedRoles') then return false; end if;
  end loop;

  -- crews
  v_crews := p -> 'crews';
  if not public.schedule_json_exact_keys(v_crews, array['slow', 'normal', 'busy', 'weekend']) then return false; end if;
  foreach t in array array['slow', 'normal', 'busy', 'weekend'] loop
    v_c := v_crews -> t;
    if not public.schedule_json_exact_keys(v_c, array['prepHeads', 'prepUntilQ', 'prepDishHeads', 'waves', 'close', 'lineMinHeads']) then return false; end if;
    if not public.schedule_json_int(v_c -> 'prepHeads', 0, 8) or not public.schedule_json_quarter(v_c -> 'prepUntilQ')
       or not public.schedule_json_int(v_c -> 'prepDishHeads', 0, 8) then return false; end if;
    v_w := v_c -> 'waves';
    if not public.schedule_json_exact_keys(v_w, array['setup', 'service', 'rush']) then return false; end if;
    if not public.schedule_json_exact_keys(v_w -> 'setup', array['heads', 'atQ'])
       or not public.schedule_json_exact_keys(v_w -> 'service', array['heads'])
       or not public.schedule_json_exact_keys(v_w -> 'rush', array['heads', 'atQ']) then return false; end if;
    if not public.schedule_json_int(v_w -> 'setup' -> 'heads', 0, 8) or not public.schedule_json_quarter(v_w -> 'setup' -> 'atQ')
       or not public.schedule_json_int(v_w -> 'service' -> 'heads', 0, 8)
       or not public.schedule_json_int(v_w -> 'rush' -> 'heads', 0, 8) or not public.schedule_json_quarter(v_w -> 'rush' -> 'atQ') then
      return false;
    end if;
    v_x := v_c -> 'close';
    if not public.schedule_json_exact_keys(v_x, array['registerHeads', 'walkHeads', 'prepDishHeads']) then return false; end if;
    if not public.schedule_json_int(v_x -> 'registerHeads', 0, 8) or not public.schedule_json_int(v_x -> 'walkHeads', 0, 8)
       or not public.schedule_json_int(v_x -> 'prepDishHeads', 0, 8) then return false; end if;
    v_x := v_c -> 'lineMinHeads';
    if jsonb_typeof(v_x) <> 'object' then return false; end if;
    for k, v_e in select key, value from jsonb_each(v_x) loop
      v_p := v_pos -> k;
      if v_p is null or not ((v_p ->> 'role') = any (array['register', 'expo', 'walk', 'walk_online', 'line_other']))
         or not public.schedule_json_int(v_e, 0, 8) then return false; end if;
      -- r3: the floor never exceeds the position's head limits.
      v_cap := greatest(case when (v_p ->> 'openQ')::numeric < (v_p ->> 'trimQ')::numeric then (v_p ->> 'headsBefore')::numeric else 0 end,
                        case when (v_p ->> 'trimQ')::numeric < (v_p ->> 'closeQ')::numeric then (v_p ->> 'headsAfter')::numeric else 0 end);
      if (v_e #>> '{}')::numeric > v_cap then return false; end if;
    end loop;
  end loop;

  -- priority
  if jsonb_typeof(p -> 'priority') <> 'array' then return false; end if;
  for v_e in select value from jsonb_array_elements(p -> 'priority') loop
    if not public.schedule_json_exact_keys(v_e, array['pair', 'primary']) then return false; end if;
    v_pair := v_e -> 'pair';
    if jsonb_typeof(v_pair) <> 'array' or jsonb_array_length(v_pair) <> 2
       or jsonb_typeof(v_pair -> 0) <> 'string' or jsonb_typeof(v_pair -> 1) <> 'string'
       or not (v_pos ? (v_pair ->> 0)) or not (v_pos ? (v_pair ->> 1)) or (v_pair ->> 0) = (v_pair ->> 1)
       or (v_pair ->> 0) = any (v_seen) or (v_pair ->> 1) = any (v_seen) then return false; end if;
    if jsonb_typeof(v_e -> 'primary') <> 'string' or not ((v_e ->> 'primary') in ((v_pair ->> 0), (v_pair ->> 1))) then return false; end if;
    v_seen := v_seen || array[(v_pair ->> 0), (v_pair ->> 1)];
  end loop;

  -- leadership
  v_lead := p -> 'leadership';
  if not public.schedule_json_exact_keys(v_lead, array['modRequired', 'closingRoles', 'leaderDefaults', 'keyHolderModAfterQ']) then return false; end if;
  if jsonb_typeof(v_lead -> 'modRequired') <> 'boolean' then return false; end if;
  if jsonb_typeof(v_lead -> 'keyHolderModAfterQ') <> 'null' and not public.schedule_json_quarter(v_lead -> 'keyHolderModAfterQ') then return false; end if;
  if not public.schedule_role_list_ok(v_lead -> 'closingRoles') then return false; end if;
  if jsonb_typeof(v_lead -> 'leaderDefaults') <> 'object' then return false; end if;
  for k, v_e in select key, value from jsonb_each(v_lead -> 'leaderDefaults') loop
    if not (k = any (public.schedule_role_codes())) or jsonb_typeof(v_e) <> 'string'
       or not ((v_e #>> '{}') in ('opens', 'closes', 'mix')) then return false; end if;
  end loop;

  -- limits
  v_lim := p -> 'limits';
  if not public.schedule_json_exact_keys(v_lim, array['minimumShiftQ', 'flexMinimumQ', 'flexUsesPer2w', 'flexMaxQ', 'overtimeH', 'managerFloorH',
                                                       'gmMinimumH', 'agmMinimumH', 'closingMinutesOverride', 'segmentMinQ', 'rushShiftMaxQ', 'maxShiftH',
                                                       'salariedStayLonger', 'salariedTargetWeekH', 'salariedFlexH']) then
    return false;
  end if;
  if not public.schedule_json_int(v_lim -> 'minimumShiftQ', 1, 96) or not public.schedule_json_int(v_lim -> 'flexMinimumQ', 1, 96)
     or not public.schedule_json_int(v_lim -> 'flexUsesPer2w', 0, 14) or not public.schedule_json_int(v_lim -> 'flexMaxQ', 1, 96)
     or not public.schedule_json_qhours(v_lim -> 'overtimeH', 0, 80) or not public.schedule_json_qhours(v_lim -> 'managerFloorH', 0, 80)
     or not public.schedule_json_qhours(v_lim -> 'gmMinimumH', 0, 24) or not public.schedule_json_qhours(v_lim -> 'agmMinimumH', 0, 24)
     or (jsonb_typeof(v_lim -> 'closingMinutesOverride') <> 'null' and not public.schedule_json_int(v_lim -> 'closingMinutesOverride', 0, 240))
     or not public.schedule_json_int(v_lim -> 'segmentMinQ', 1, 16) or not public.schedule_json_int(v_lim -> 'rushShiftMaxQ', 0, 16)
     -- CC chunk D ruling 1: salaried managers may stay longer (default ON), a boolean
     or jsonb_typeof(v_lim -> 'salariedStayLonger') is distinct from 'boolean'
     -- Juan 2026-10-16 (decision 4): the salaried week target (quarter-hours 0-80) and its flex (quarter-hours 0-10)
     or not public.schedule_json_qhours(v_lim -> 'salariedTargetWeekH', 0, 80) or not public.schedule_json_qhours(v_lim -> 'salariedFlexH', 0, 10) then
    return false;
  end if;
  if (v_lim ->> 'flexMinimumQ')::numeric > (v_lim ->> 'minimumShiftQ')::numeric
     or (v_lim ->> 'flexMinimumQ')::numeric > (v_lim ->> 'flexMaxQ')::numeric then return false; end if;
  -- The mockup's guard: the longest required block fits the shop day.
  v_span := v_outL - v_prep;
  if (v_lim ->> 'minimumShiftQ')::numeric > v_span or (v_lim ->> 'gmMinimumH')::numeric * 4 > v_span
     or (v_lim ->> 'agmMinimumH')::numeric * 4 > v_span then return false; end if;
  -- CC chunk B ruling 3: the daily maximum, quarter-hours <= 24 h, never below the hourly or salaried minimums.
  if not public.schedule_json_qhours(v_lim -> 'maxShiftH', 0, 24)
     or (v_lim ->> 'maxShiftH')::numeric * 4 < (v_lim ->> 'minimumShiftQ')::numeric
     or (v_lim ->> 'maxShiftH')::numeric < (v_lim ->> 'gmMinimumH')::numeric
     or (v_lim ->> 'maxShiftH')::numeric < (v_lim ->> 'agmMinimumH')::numeric then return false; end if;

  -- catering
  v_cat := p -> 'catering';
  if not public.schedule_json_exact_keys(v_cat, array['minHeadcount', 'extraPrepDishHeads', 'defaultStartQ', 'defaultEndQ', 'leadMinutes']) then return false; end if;
  if not public.schedule_json_int(v_cat -> 'minHeadcount', 0, 10000) or not public.schedule_json_int(v_cat -> 'extraPrepDishHeads', 0, 8)
     or not public.schedule_json_quarter(v_cat -> 'defaultStartQ') or not public.schedule_json_quarter(v_cat -> 'defaultEndQ')
     or (v_cat ->> 'defaultEndQ')::numeric <= (v_cat ->> 'defaultStartQ')::numeric
     or not public.schedule_json_int(v_cat -> 'leadMinutes', 0, 720) or (v_cat ->> 'leadMinutes')::numeric % 15 <> 0 then
    return false;
  end if;

  -- labor
  v_lab := p -> 'labor';
  if not public.schedule_json_exact_keys(v_lab, array['targetPct', 'basis', 'strong', 'watch', 'budgetDeadbandH']) then return false; end if;
  if public.schedule_json_num(v_lab -> 'targetPct') is null or not (public.schedule_json_num(v_lab -> 'targetPct') > 0)
     or public.schedule_json_num(v_lab -> 'targetPct') > 100 then return false; end if;
  if jsonb_typeof(v_lab -> 'basis') <> 'string' or not ((v_lab ->> 'basis') in ('hourly', 'total')) then return false; end if;
  if public.schedule_json_num(v_lab -> 'strong') is null or not (public.schedule_json_num(v_lab -> 'strong') > 0)
     or not (public.schedule_json_num(v_lab -> 'strong') < 1) then return false; end if;
  if public.schedule_json_num(v_lab -> 'watch') is null or not (public.schedule_json_num(v_lab -> 'watch') > 0)
     or not (public.schedule_json_num(v_lab -> 'watch') < public.schedule_json_num(v_lab -> 'strong')) then return false; end if;
  if not public.schedule_json_qhours(v_lab -> 'budgetDeadbandH', 0, 40) then return false; end if;

  -- roster
  if not public.schedule_json_exact_keys(p -> 'roster', array['excludedRoles'])
     or not public.schedule_role_list_ok(p -> 'roster' -> 'excludedRoles') then return false; end if;

  -- r3 wave bounds, closed form (see the header of this function): floors vs capacity per quarter, per day type.
  foreach t in array array['slow', 'normal', 'busy', 'weekend'] loop
    v_minh := array_fill(0, array[96]);
    v_maxh := array_fill(0, array[96]);
    for k, v_p in select key, value from jsonb_each(v_pos) loop
      if not ((v_p ->> 'role') = any (array['register', 'expo', 'walk', 'walk_online', 'line_other'])) then continue; end if;
      v_open := (v_p ->> 'openQ')::numeric; v_trim := (v_p ->> 'trimQ')::numeric; v_cl := (v_p ->> 'closeQ')::numeric;
      v_before := (v_p ->> 'headsBefore')::numeric; v_after := (v_p ->> 'headsAfter')::numeric;
      v_n := coalesce((v_crews -> t -> 'lineMinHeads' ->> k)::numeric, 0);
      q := v_open;
      while q < v_cl and q < 96 loop
        v_minh[q + 1] := v_minh[q + 1] + v_n;
        v_maxh[q + 1] := v_maxh[q + 1] + case when q < v_trim then v_before else v_after end;
        q := q + 1;
      end loop;
    end loop;
    q := 0;
    while q < v_close and q < 96 loop
      if v_maxh[q + 1] < v_minh[q + 1] then return false; end if;
      q := q + 1;
    end loop;
  end loop;

  return true;
end $$;

-- ── THE TABLES ──────────────────────────────────────────────────────────────────────────────────
create table public.schedule_shop_settings (
  location_id                     uuid        primary key references public.locations(id),
  enabled                         boolean     not null default false,
  estimated_hourly_cents          integer default 1840,
  estimated_salaried_weekly_cents integer,
  agm_access                      text        not null default 'read',
  updated_by                      uuid        not null references public.users(id),
  updated_at                      timestamptz not null default clock_timestamp(),
  constraint schedule_shop_settings_hourly check (estimated_hourly_cents is null or (estimated_hourly_cents > 0 and estimated_hourly_cents <= 100000)),
  constraint schedule_shop_settings_salaried check (estimated_salaried_weekly_cents is null
    or (estimated_salaried_weekly_cents > 0 and estimated_salaried_weekly_cents <= 10000000)),
  constraint schedule_shop_settings_agm_access check (agm_access in ('read', 'edit'))
);
comment on table public.schedule_shop_settings is
  '0274: one row per shop — the scheduling switch (OFF by default; no row = off), the wage estimates (hourly default 1840 = the DC minimum wage since 2026-07-01, decision 2; salaried NULL = blank, R2) and agm_access (read default, R1). Written only by save_schedule_shop_settings (MoO+). Deny-all RLS.';

create table public.schedule_structures (
  id          uuid        primary key default gen_random_uuid(),
  location_id uuid        not null references public.locations(id),
  structure   jsonb       not null constraint schedule_structures_valid check (public.valid_schedule_structure(structure)),
  based_on_id uuid,
  created_by  uuid        not null references public.users(id),
  created_at  timestamptz not null default clock_timestamp(),
  unique (id, location_id),
  constraint schedule_structures_based_on foreign key (based_on_id, location_id) references public.schedule_structures (id, location_id)
);
create index schedule_structures_live on public.schedule_structures (location_id, created_at desc, id desc);
comment on table public.schedule_structures is
  '0274: the schedule structure, one version per row (append-only by grant); live = the newest per shop. CHECKed by valid_schedule_structure (pinned equal to the TS validator by one shared case file). Written only by save_schedule_structure. Deny-all RLS.';

create table public.schedule_person_settings (
  id              uuid         primary key default gen_random_uuid(),
  location_id     uuid         not null references public.locations(id),
  user_id         uuid         not null references public.users(id),
  work_type       text,
  also_allowed    text[]       not null default '{}',
  leader_setting  text,
  cover_positions uuid[]       not null default '{}',
  soft_min_h      numeric(5,2),
  soft_max_h      numeric(5,2),
  full_time       boolean      not null default false,
  full_time_min_h numeric(5,2),
  roster_include  boolean,
  created_by      uuid         not null references public.users(id),
  created_at      timestamptz  not null default clock_timestamp(),
  constraint schedule_person_settings_work_type check (work_type is null or work_type in ('boh', 'foh', 'management')),
  constraint schedule_person_settings_also_allowed check (also_allowed <@ array['boh', 'foh']::text[] and array_position(also_allowed, null) is null),
  constraint schedule_person_settings_leader check (leader_setting is null or leader_setting in ('opens', 'closes', 'mix')),
  constraint schedule_person_settings_cover check (array_position(cover_positions, null) is null),
  constraint schedule_person_settings_soft check ((soft_min_h is null or (soft_min_h between 0 and 80 and soft_min_h * 4 = trunc(soft_min_h * 4)))
    and (soft_max_h is null or (soft_max_h between 0 and 80 and soft_max_h * 4 = trunc(soft_max_h * 4)))
    and (soft_min_h is null or soft_max_h is null or soft_min_h <= soft_max_h)),
  constraint schedule_person_settings_full_time check (full_time_min_h is null or (full_time_min_h between 0 and 80 and full_time_min_h * 4 = trunc(full_time_min_h * 4)))
);
create index schedule_person_settings_head on public.schedule_person_settings (location_id, user_id, created_at desc, id desc);
comment on table public.schedule_person_settings is
  '0274: a person''s scheduling settings at one shop (work type, leader setting, ordered cover positions, soft range, full timer, roster_include — R6). Append-only by grant: the latest row per (shop, user) wins. Written only by record_schedule_person_settings. Deny-all RLS.';

create table public.schedule_budget_entries (
  id                uuid         primary key default gen_random_uuid(),
  location_id       uuid         not null references public.locations(id),
  scope             text         not null check (scope in ('week', 'month')),
  week_start        date         check (week_start is null or extract(isodow from week_start) = 1),
  month             date         check (month is null or extract(day from month) = 1),
  hours             numeric(7,2) not null check (hours between 0 and 8000 and hours * 4 = trunc(hours * 4)),
  source            text         not null check (source in ('manager', 'accepted_suggestion')),
  suggestion_digest text         check (suggestion_digest is null or char_length(suggestion_digest) between 1 and 64),
  apportioned_by    text         not null check (apportioned_by in ('forecast', 'even', 'explicit')),
  created_by        uuid         not null references public.users(id),
  created_at        timestamptz  not null default clock_timestamp(),
  check ((scope = 'week') = (week_start is not null) and (scope = 'month') = (month is not null)),
  check ((source = 'accepted_suggestion') = (suggestion_digest is not null)),
  check (source <> 'accepted_suggestion' or apportioned_by = 'explicit'),
  unique (id, location_id)
);
create index schedule_budget_entries_shop on public.schedule_budget_entries (location_id, created_at desc, id desc);
comment on table public.schedule_budget_entries is
  '0274 (r2 P2-7, r3): one row per manager budget ENTRY (a week or a month). Its per-date rows are schedule_budget_days, written in the same transaction. Append-only by grant. Written only by record_schedule_budget_entry. Deny-all RLS.';

create table public.schedule_budget_days (           -- r3: per-DATE apportionment; the newest entry covering a date wins
  entry_id      uuid         not null,
  location_id   uuid         not null,
  business_date date         not null,
  hours         numeric(6,2) not null check (hours >= 0),
  foreign key (entry_id, location_id) references public.schedule_budget_entries (id, location_id),
  primary key (entry_id, business_date)
);
create index schedule_budget_days_by_date on public.schedule_budget_days (location_id, business_date);
comment on table public.schedule_budget_days is
  '0274 (r3): an entry''s budget per DATE. The writer proves the rows cover exactly the entry''s dates (a week''s 7, a month''s every day) and sum to its hours. The budget for a date = the row of the NEWEST entry (created_at, then id) covering it. Append-only by grant. Deny-all RLS.';

create table public.schedule_day_types (
  id            uuid        primary key default gen_random_uuid(),
  location_id   uuid        not null references public.locations(id),
  business_date date        not null,
  day_type      text        not null check (day_type in ('auto', 'slow', 'normal', 'busy')),
  created_by    uuid        not null references public.users(id),
  created_at    timestamptz not null default clock_timestamp()
);
create index schedule_day_types_head on public.schedule_day_types (location_id, business_date, created_at desc, id desc);
comment on table public.schedule_day_types is
  '0274: the manager''s per-date day type override (auto = none). Append-only by grant: the latest row per (shop, date) wins (J14: it wins over the weekend and the forecast). Written only by record_schedule_day_type. Deny-all RLS.';

create table public.schedule_pins (
  id            uuid        primary key default gen_random_uuid(),
  location_id   uuid        not null references public.locations(id),
  business_date date        not null,
  user_id       uuid        not null references public.users(id),
  start_q       smallint    not null,
  end_q         smallint    not null,
  positions     uuid[]      not null default '{}',
  kind          text        not null check (kind in ('presence', 'added')),
  active        boolean     not null,
  retires_id    uuid,
  created_by    uuid        not null references public.users(id),
  created_at    timestamptz not null default clock_timestamp(),
  constraint schedule_pins_window check (0 <= start_q and start_q < end_q and end_q <= 96),
  constraint schedule_pins_positions check (array_position(positions, null) is null),
  constraint schedule_pins_retire check (active = (retires_id is null)),
  unique (id, location_id),
  constraint schedule_pins_retires foreign key (retires_id, location_id) references public.schedule_pins (id, location_id)
);
create unique index schedule_pins_one_retirement on public.schedule_pins (retires_id) where retires_id is not null;
create index schedule_pins_by_date on public.schedule_pins (location_id, business_date);
comment on table public.schedule_pins is
  '0274: presence toggles and "Add to schedule" blocks (ET quarters of one business date). Append-only by grant: a retirement is a NEW row (active = false) naming the pin it retires, at most one per pin; a pin is live while active and not retired. Written only by record_schedule_pin. Deny-all RLS.';

alter table public.schedule_shop_settings enable row level security;
alter table public.schedule_structures enable row level security;
alter table public.schedule_person_settings enable row level security;
alter table public.schedule_budget_entries enable row level security;
alter table public.schedule_budget_days enable row level security;
alter table public.schedule_day_types enable row level security;
alter table public.schedule_pins enable row level security;
revoke all on public.schedule_shop_settings, public.schedule_structures, public.schedule_person_settings, public.schedule_budget_entries,
  public.schedule_budget_days, public.schedule_day_types, public.schedule_pins
  from public, anon, authenticated, service_role;
grant select on public.schedule_shop_settings, public.schedule_structures, public.schedule_person_settings, public.schedule_budget_entries,
  public.schedule_budget_days, public.schedule_day_types, public.schedule_pins
  to service_role;

-- ── THE ACTOR RULE ──────────────────────────────────────────────────────────────────────────────
-- The SQL twin of lib/scheduling/access-shared.ts `scheduleActRefusal`: the social media manager by ROLE; GM (7)
-- at an own shop; MoO (8)+ at any active shop; an AGM at an own shop as an EDITOR (6) only when that shop's
-- agm_access = 'edit', else read-only (5); everyone else refused. Writers then require their own minimum:
-- edit-class acts 6, the structure and approval 7, the switch / wages / AGM access 8.
create function public.schedule_actor_level(p_actor uuid, p_location uuid)
returns integer language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_role text; v_level integer; v_access text;
begin
  if p_actor is null or p_location is null then raise exception 'invalid_payload'; end if;
  select role into v_role from public.users where id = p_actor and active;
  if not found then raise exception 'schedule_forbidden'; end if;
  if v_role = 'social_media_mgr' then raise exception 'schedule_role_refused'; end if;
  v_level := public.assignment_author_level(p_actor);
  if v_level is null or (v_level < 8 and v_role not in ('gm', 'agm')) then raise exception 'schedule_forbidden'; end if;
  if not exists (select 1 from public.locations where id = p_location and active) then raise exception 'shop_not_allowed'; end if;
  if v_level < 8 and not exists (select 1 from public.user_locations where user_id = p_actor and location_id = p_location and active) then
    raise exception 'shop_not_allowed';
  end if;
  if v_role = 'agm' then
    select agm_access into v_access from public.schedule_shop_settings where location_id = p_location;
    return case when coalesce(v_access, 'read') = 'edit' then 6 else 5 end;
  end if;
  return v_level;
end $$;

-- The actor at its act's minimum level (edit 6 · structure / approve 7 · switch 8), or schedule_forbidden.
create function public.schedule_actor_require(p_actor uuid, p_location uuid, p_min integer)
returns integer language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_level integer;
begin
  v_level := public.schedule_actor_level(p_actor, p_location);
  if v_level < p_min then raise exception 'schedule_forbidden'; end if;
  return v_level;
end $$;

-- A subject at the shop: an active user who is an active member (or MoO+, who works at any shop) — else person_not_at_shop.
create function public.schedule_subject_at_shop(p_user uuid, p_location uuid)
returns text language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_role text;
begin
  select role into v_role from public.users where id = p_user and active;
  if not found then raise exception 'person_not_at_shop'; end if;
  if coalesce(public.assignment_author_level(p_user), 0) < 8
     and not exists (select 1 from public.user_locations where user_id = p_user and location_id = p_location and active) then
    raise exception 'person_not_at_shop';
  end if;
  return v_role;
end $$;

-- The ET business date "today" (the shop day never crosses the 1–3 AM DST hours).
create function public.schedule_et_today()
returns date language sql stable set search_path = pg_catalog, public as $$
  select (now() at time zone 'America/New_York')::date
$$;

-- ── THE WRITERS ─────────────────────────────────────────────────────────────────────────────────

-- The switch, the wage estimates and the AGM access: MoO+ only (Tier E at the route). Before/after for the audit.
create function public.save_schedule_shop_settings(p_actor uuid, p_location uuid, p_enabled boolean,
  p_estimated_hourly_cents integer, p_estimated_salaried_weekly_cents integer, p_agm_access text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_old public.schedule_shop_settings%rowtype; v_had boolean;
begin
  if p_actor is null or p_location is null or p_enabled is null or p_agm_access is null or p_agm_access not in ('read', 'edit') then
    raise exception 'invalid_payload';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('schedule-shop-settings/' || p_location::text, 0));
  perform public.schedule_actor_require(p_actor, p_location, 8);
  if (p_estimated_hourly_cents is not null and (p_estimated_hourly_cents <= 0 or p_estimated_hourly_cents > 100000))
     or (p_estimated_salaried_weekly_cents is not null and (p_estimated_salaried_weekly_cents <= 0 or p_estimated_salaried_weekly_cents > 10000000)) then
    raise exception 'wage_estimate_invalid';
  end if;
  select * into v_old from public.schedule_shop_settings where location_id = p_location for update;
  v_had := found;
  if v_had then
    update public.schedule_shop_settings
       set enabled = p_enabled, estimated_hourly_cents = p_estimated_hourly_cents,
           estimated_salaried_weekly_cents = p_estimated_salaried_weekly_cents, agm_access = p_agm_access,
           updated_by = p_actor, updated_at = clock_timestamp()
     where location_id = p_location;
  else
    insert into public.schedule_shop_settings (location_id, enabled, estimated_hourly_cents, estimated_salaried_weekly_cents, agm_access, updated_by)
      values (p_location, p_enabled, p_estimated_hourly_cents, p_estimated_salaried_weekly_cents, p_agm_access, p_actor);
  end if;
  return jsonb_build_object(
    'before', case when v_had then jsonb_build_object('enabled', v_old.enabled, 'estimated_hourly_cents', v_old.estimated_hourly_cents,
      'estimated_salaried_weekly_cents', v_old.estimated_salaried_weekly_cents, 'agm_access', v_old.agm_access) else null end,
    'after', jsonb_build_object('enabled', p_enabled, 'estimated_hourly_cents', p_estimated_hourly_cents,
      'estimated_salaried_weekly_cents', p_estimated_salaried_weekly_cents, 'agm_access', p_agm_access));
end $$;

-- A new structure version: GM own / MoO+ (Tier E at the route). Optimistic on the version the person saw
-- (structure_moved); the rule set by name (structure_invalid; the CHECK is the backstop); every position key an
-- ACTIVE position of THIS shop on an active station (0270's people_position_at_shop). Returns before/after ids.
create function public.save_schedule_structure(p_actor uuid, p_location uuid, p_expected uuid, p_structure jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_live uuid; v_id uuid; k text;
begin
  if p_actor is null or p_location is null or p_structure is null then raise exception 'invalid_payload'; end if;
  perform pg_advisory_xact_lock(hashtextextended('schedule-structure/' || p_location::text, 0));
  perform public.schedule_actor_require(p_actor, p_location, 7);
  select id into v_live from public.schedule_structures where location_id = p_location order by created_at desc, id desc limit 1;
  if v_live is distinct from p_expected then raise exception 'structure_moved'; end if;
  if not public.valid_schedule_structure(p_structure) then raise exception 'structure_invalid'; end if;
  for k in select jsonb_object_keys(p_structure -> 'positions') loop
    if k !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'position_not_at_shop'; end if;
    perform public.people_position_at_shop(k::uuid, p_location);
  end loop;
  insert into public.schedule_structures (location_id, structure, based_on_id, created_by)
    values (p_location, p_structure, p_expected, p_actor) returning id into v_id;
  return jsonb_build_object('before_id', v_live, 'after_id', v_id);
end $$;

-- A person's scheduling settings: the edit-class actor (GM own / MoO+ / an AGM with agm_access = 'edit'); the
-- subject at the shop; the cover positions active at the shop, distinct, in order; roster_include never for the CGS
-- or the social media manager (R6). One lock per (shop, user) BEFORE the read. Returns {id, before, after}.
create function public.record_schedule_person_settings(p_actor uuid, p_location uuid, p_user uuid, p_work_type text, p_also_allowed text[],
  p_leader_setting text, p_cover_positions uuid[], p_soft_min_h numeric, p_soft_max_h numeric, p_full_time boolean,
  p_full_time_min_h numeric, p_roster_include boolean)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_role text; v_old public.schedule_person_settings%rowtype; v_had boolean; v_id uuid; v_pos uuid;
begin
  if p_actor is null or p_location is null or p_user is null or p_also_allowed is null or p_cover_positions is null or p_full_time is null then
    raise exception 'invalid_payload';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('schedule-person/' || p_location::text || '/' || p_user::text, 0));
  perform public.schedule_actor_require(p_actor, p_location, 6);
  v_role := public.schedule_subject_at_shop(p_user, p_location);
  if (p_work_type is not null and p_work_type not in ('boh', 'foh', 'management'))
     or not (p_also_allowed <@ array['boh', 'foh']::text[]) or array_position(p_also_allowed, null) is not null
     or cardinality(p_also_allowed) <> (select count(distinct x) from unnest(p_also_allowed) x)
     or (p_leader_setting is not null and p_leader_setting not in ('opens', 'closes', 'mix'))
     or array_position(p_cover_positions, null) is not null
     or cardinality(p_cover_positions) <> (select count(distinct x) from unnest(p_cover_positions) x)
     or (p_soft_min_h is not null and (p_soft_min_h < 0 or p_soft_min_h > 80 or p_soft_min_h * 4 <> trunc(p_soft_min_h * 4)))
     or (p_soft_max_h is not null and (p_soft_max_h < 0 or p_soft_max_h > 80 or p_soft_max_h * 4 <> trunc(p_soft_max_h * 4)))
     or (p_soft_min_h is not null and p_soft_max_h is not null and p_soft_min_h > p_soft_max_h)
     or (p_full_time_min_h is not null and (p_full_time_min_h < 0 or p_full_time_min_h > 80 or p_full_time_min_h * 4 <> trunc(p_full_time_min_h * 4))) then
    raise exception 'invalid_payload';
  end if;
  if coalesce(p_roster_include, false) and v_role in ('cgs', 'social_media_mgr') then raise exception 'roster_include_refused'; end if;
  foreach v_pos in array p_cover_positions loop
    perform public.people_position_at_shop(v_pos, p_location);
  end loop;
  select * into v_old from public.schedule_person_settings where location_id = p_location and user_id = p_user
   order by created_at desc, id desc limit 1;
  v_had := found;
  insert into public.schedule_person_settings (location_id, user_id, work_type, also_allowed, leader_setting, cover_positions,
      soft_min_h, soft_max_h, full_time, full_time_min_h, roster_include, created_by)
    values (p_location, p_user, p_work_type, p_also_allowed, p_leader_setting, p_cover_positions, p_soft_min_h, p_soft_max_h,
      p_full_time, p_full_time_min_h, p_roster_include, p_actor)
    returning id into v_id;
  return jsonb_build_object('id', v_id,
    'before', case when v_had then to_jsonb(v_old) - 'id' - 'created_by' - 'created_at' - 'location_id' else null end,
    'after', jsonb_build_object('user_id', p_user, 'work_type', p_work_type, 'also_allowed', to_jsonb(p_also_allowed),
      'leader_setting', p_leader_setting, 'cover_positions', to_jsonb(p_cover_positions), 'soft_min_h', p_soft_min_h,
      'soft_max_h', p_soft_max_h, 'full_time', p_full_time, 'full_time_min_h', p_full_time_min_h, 'roster_include', p_roster_include));
end $$;

-- A budget entry and its per-date rows in ONE transaction (r3). The rows must cover EXACTLY the entry's dates (a
-- week's 7 from its Monday; a month's every day) with hundredths-exact hours that sum to the entry. Refusals by
-- name (budget_invalid). Returns {id, dates}.
create function public.record_schedule_budget_entry(p_actor uuid, p_location uuid, p_scope text, p_week_start date, p_month date,
  p_hours numeric, p_days jsonb, p_source text, p_digest text, p_apportioned_by text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_dates date[]; v_id uuid; v_e jsonb; v_seen date[] := '{}'; v_sum numeric := 0; v_d date; v_h numeric;
begin
  if p_actor is null or p_location is null then raise exception 'invalid_payload'; end if;
  perform pg_advisory_xact_lock(hashtextextended('schedule-budget/' || p_location::text, 0));
  perform public.schedule_actor_require(p_actor, p_location, 6);
  if p_scope is null or p_scope not in ('week', 'month')
     or (p_scope = 'week' and (p_week_start is null or p_month is not null or extract(isodow from p_week_start) <> 1))
     or (p_scope = 'month' and (p_month is null or p_week_start is not null or extract(day from p_month) <> 1))
     or p_hours is null or p_hours < 0 or p_hours > 8000 or p_hours * 4 <> trunc(p_hours * 4)
     or p_source is null or p_source not in ('manager', 'accepted_suggestion')
     or p_apportioned_by is null or p_apportioned_by not in ('forecast', 'even', 'explicit')
     or ((p_source = 'accepted_suggestion') <> (p_digest is not null))
     or (p_digest is not null and char_length(p_digest) not between 1 and 64)
     or (p_source = 'accepted_suggestion' and p_apportioned_by <> 'explicit') then
    raise exception 'budget_invalid';
  end if;
  if p_scope = 'week' then
    v_dates := array(select (p_week_start + i)::date from generate_series(0, 6) i);
  else
    v_dates := array(select p_month + i from generate_series(0, ((p_month + interval '1 month')::date - p_month) - 1) i);
  end if;
  if p_days is null or jsonb_typeof(p_days) <> 'array' or jsonb_array_length(p_days) <> cardinality(v_dates) then raise exception 'budget_invalid'; end if;
  for v_e in select value from jsonb_array_elements(p_days) loop
    if not public.schedule_json_exact_keys(v_e, array['date', 'hours']) or jsonb_typeof(v_e -> 'date') <> 'string'
       or (v_e ->> 'date') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'budget_invalid'; end if;
    begin
      v_d := (v_e ->> 'date')::date;
    exception when others then
      raise exception 'budget_invalid';
    end;
    v_h := public.schedule_json_num(v_e -> 'hours');
    if to_char(v_d, 'YYYY-MM-DD') <> (v_e ->> 'date') or not (v_d = any (v_dates)) or v_d = any (v_seen)
       or v_h is null or v_h < 0 or v_h > 9999.99 or v_h * 100 <> trunc(v_h * 100) then
      raise exception 'budget_invalid';
    end if;
    v_seen := v_seen || v_d;
    v_sum := v_sum + v_h;
  end loop;
  if v_sum <> p_hours then raise exception 'budget_invalid'; end if;
  insert into public.schedule_budget_entries (location_id, scope, week_start, month, hours, source, suggestion_digest, apportioned_by, created_by)
    values (p_location, p_scope, p_week_start, p_month, p_hours, p_source, p_digest, p_apportioned_by, p_actor)
    returning id into v_id;
  insert into public.schedule_budget_days (entry_id, location_id, business_date, hours)
    select v_id, p_location, (e ->> 'date')::date, (e ->> 'hours')::numeric from jsonb_array_elements(p_days) e;
  return jsonb_build_object('id', v_id, 'dates', cardinality(v_dates));
end $$;

-- A day type override for one date (auto = none): the edit-class actor; never a past date (day_locked).
create function public.record_schedule_day_type(p_actor uuid, p_location uuid, p_date date, p_day_type text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_id uuid;
begin
  if p_actor is null or p_location is null or p_date is null or p_day_type is null or p_day_type not in ('auto', 'slow', 'normal', 'busy') then
    raise exception 'invalid_payload';
  end if;
  perform public.schedule_actor_require(p_actor, p_location, 6);
  if p_date < public.schedule_et_today() then raise exception 'day_locked'; end if;
  insert into public.schedule_day_types (location_id, business_date, day_type, created_by)
    values (p_location, p_date, p_day_type, p_actor) returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

-- A presence toggle or an "Add to schedule" block, or (p_retires) the retirement of one: the edit-class actor; the
-- subject at the shop; every listed position active at the shop; an "added" block lists at least one; never a past
-- date. A retirement is a NEW row (active = false) copying the pin it retires; a pin retires at most once.
create function public.record_schedule_pin(p_actor uuid, p_location uuid, p_date date, p_user uuid, p_start_q integer, p_end_q integer,
  p_positions uuid[], p_kind text, p_retires uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_pin public.schedule_pins%rowtype; v_id uuid; v_pos uuid;
begin
  if p_actor is null or p_location is null then raise exception 'invalid_payload'; end if;
  perform pg_advisory_xact_lock(hashtextextended('schedule-pin/' || p_location::text, 0));
  perform public.schedule_actor_require(p_actor, p_location, 6);
  if p_retires is not null then
    select * into v_pin from public.schedule_pins where id = p_retires and location_id = p_location and active;
    if not found or exists (select 1 from public.schedule_pins where retires_id = p_retires) then raise exception 'pin_invalid'; end if;
    if v_pin.business_date < public.schedule_et_today() then raise exception 'day_locked'; end if;
    insert into public.schedule_pins (location_id, business_date, user_id, start_q, end_q, positions, kind, active, retires_id, created_by)
      values (p_location, v_pin.business_date, v_pin.user_id, v_pin.start_q, v_pin.end_q, v_pin.positions, v_pin.kind, false, p_retires, p_actor)
      returning id into v_id;
    return jsonb_build_object('id', v_id, 'retired', p_retires);
  end if;
  if p_date is null or p_user is null or p_start_q is null or p_end_q is null or p_positions is null or p_kind is null
     or p_kind not in ('presence', 'added') or p_start_q < 0 or p_start_q >= p_end_q or p_end_q > 96
     or array_position(p_positions, null) is not null
     or cardinality(p_positions) <> (select count(distinct x) from unnest(p_positions) x)
     or (p_kind = 'added' and cardinality(p_positions) = 0) then
    raise exception 'pin_invalid';
  end if;
  if p_date < public.schedule_et_today() then raise exception 'day_locked'; end if;
  perform public.schedule_subject_at_shop(p_user, p_location);
  foreach v_pos in array p_positions loop
    perform public.people_position_at_shop(v_pos, p_location);
  end loop;
  insert into public.schedule_pins (location_id, business_date, user_id, start_q, end_q, positions, kind, active, created_by)
    values (p_location, p_date, p_user, p_start_q, p_end_q, p_positions, p_kind, true, p_actor)
    returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

-- The budget per DATE (r3): for each date in [from, to], the day row of the NEWEST entry covering it (created_at, then
-- id) — the ONE precedence rule, read by the loader (Task 16) and proved by the harness. A date with no row has no
-- budget (absent, never 0). A reader: invoker rights over the SELECT ceiling, service_role only.
create function public.schedule_budget_by_date(p_location uuid, p_from date, p_to date)
returns table (business_date date, entry_id uuid, scope text, hours numeric)
language sql stable set search_path = pg_catalog, public as $$
  select distinct on (d.business_date) d.business_date, e.id, e.scope, d.hours
    from public.schedule_budget_days d
    join public.schedule_budget_entries e on e.id = d.entry_id and e.location_id = d.location_id
   where d.location_id = p_location and d.business_date between p_from and p_to
   order by d.business_date, e.created_at desc, e.id desc
$$;

-- ── GRANTS: every function service_role only; the tables sit at the SELECT ceiling ───────────────
revoke all on function public.schedule_json_num(jsonb) from public, anon, authenticated;
revoke all on function public.schedule_json_int(jsonb, numeric, numeric) from public, anon, authenticated;
revoke all on function public.schedule_json_quarter(jsonb) from public, anon, authenticated;
revoke all on function public.schedule_json_qhours(jsonb, numeric, numeric) from public, anon, authenticated;
revoke all on function public.schedule_json_exact_keys(jsonb, text[]) from public, anon, authenticated;
revoke all on function public.schedule_role_codes() from public, anon, authenticated;
revoke all on function public.schedule_role_list_ok(jsonb) from public, anon, authenticated;
revoke all on function public.valid_schedule_structure(jsonb) from public, anon, authenticated;
revoke all on function public.schedule_actor_level(uuid, uuid) from public, anon, authenticated;
revoke all on function public.schedule_actor_require(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.schedule_subject_at_shop(uuid, uuid) from public, anon, authenticated;
revoke all on function public.schedule_et_today() from public, anon, authenticated;
revoke all on function public.save_schedule_shop_settings(uuid, uuid, boolean, integer, integer, text) from public, anon, authenticated;
revoke all on function public.save_schedule_structure(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.record_schedule_person_settings(uuid, uuid, uuid, text, text[], text, uuid[], numeric, numeric, boolean, numeric, boolean) from public, anon, authenticated;
revoke all on function public.record_schedule_budget_entry(uuid, uuid, text, date, date, numeric, jsonb, text, text, text) from public, anon, authenticated;
revoke all on function public.record_schedule_day_type(uuid, uuid, date, text) from public, anon, authenticated;
revoke all on function public.record_schedule_pin(uuid, uuid, date, uuid, integer, integer, uuid[], text, uuid) from public, anon, authenticated;
revoke all on function public.schedule_budget_by_date(uuid, date, date) from public, anon, authenticated;
grant execute on function public.schedule_json_num(jsonb) to service_role;
grant execute on function public.schedule_json_int(jsonb, numeric, numeric) to service_role;
grant execute on function public.schedule_json_quarter(jsonb) to service_role;
grant execute on function public.schedule_json_qhours(jsonb, numeric, numeric) to service_role;
grant execute on function public.schedule_json_exact_keys(jsonb, text[]) to service_role;
grant execute on function public.schedule_role_codes() to service_role;
grant execute on function public.schedule_role_list_ok(jsonb) to service_role;
grant execute on function public.valid_schedule_structure(jsonb) to service_role;
grant execute on function public.schedule_actor_level(uuid, uuid) to service_role;
grant execute on function public.schedule_actor_require(uuid, uuid, integer) to service_role;
grant execute on function public.schedule_subject_at_shop(uuid, uuid) to service_role;
grant execute on function public.schedule_et_today() to service_role;
grant execute on function public.save_schedule_shop_settings(uuid, uuid, boolean, integer, integer, text) to service_role;
grant execute on function public.save_schedule_structure(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.record_schedule_person_settings(uuid, uuid, uuid, text, text[], text, uuid[], numeric, numeric, boolean, numeric, boolean) to service_role;
grant execute on function public.record_schedule_budget_entry(uuid, uuid, text, date, date, numeric, jsonb, text, text, text) to service_role;
grant execute on function public.record_schedule_day_type(uuid, uuid, date, text) to service_role;
grant execute on function public.record_schedule_pin(uuid, uuid, date, uuid, integer, integer, uuid[], text, uuid) to service_role;
grant execute on function public.schedule_budget_by_date(uuid, date, date) to service_role;

-- ── THE CEILING GUARD ───────────────────────────────────────────────────────────────────────────
do $$
declare
  t text;
  p text;
  f regprocedure;
begin
  foreach t in array array['schedule_shop_settings', 'schedule_structures', 'schedule_person_settings', 'schedule_budget_entries',
                           'schedule_budget_days', 'schedule_day_types', 'schedule_pins'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception '0274: RLS is off on %', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      raise exception '0274: % must have no policy', t;
    end if;
    if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = t
                and grantee in ('PUBLIC', 'anon', 'authenticated')) then
      raise exception '0274: a PostgREST role holds a grant on %', t;
    end if;
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege('service_role', 'public.' || t, p) <> (p = 'SELECT') then
        raise exception '0274: service_role % on % is not at its ceiling (SELECT)', p, t;
      end if;
    end loop;
  end loop;
  foreach f in array array[
    'public.schedule_json_num(jsonb)'::regprocedure,
    'public.schedule_json_int(jsonb, numeric, numeric)'::regprocedure,
    'public.schedule_json_quarter(jsonb)'::regprocedure,
    'public.schedule_json_qhours(jsonb, numeric, numeric)'::regprocedure,
    'public.schedule_json_exact_keys(jsonb, text[])'::regprocedure,
    'public.schedule_role_codes()'::regprocedure,
    'public.schedule_role_list_ok(jsonb)'::regprocedure,
    'public.valid_schedule_structure(jsonb)'::regprocedure,
    'public.schedule_actor_level(uuid, uuid)'::regprocedure,
    'public.schedule_actor_require(uuid, uuid, integer)'::regprocedure,
    'public.schedule_subject_at_shop(uuid, uuid)'::regprocedure,
    'public.schedule_et_today()'::regprocedure,
    'public.save_schedule_shop_settings(uuid, uuid, boolean, integer, integer, text)'::regprocedure,
    'public.save_schedule_structure(uuid, uuid, uuid, jsonb)'::regprocedure,
    'public.record_schedule_person_settings(uuid, uuid, uuid, text, text[], text, uuid[], numeric, numeric, boolean, numeric, boolean)'::regprocedure,
    'public.record_schedule_budget_entry(uuid, uuid, text, date, date, numeric, jsonb, text, text, text)'::regprocedure,
    'public.record_schedule_day_type(uuid, uuid, date, text)'::regprocedure,
    'public.record_schedule_pin(uuid, uuid, date, uuid, integer, integer, uuid[], text, uuid)'::regprocedure,
    'public.schedule_budget_by_date(uuid, date, date)'::regprocedure
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
       or not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '0274: function grant escaped on %', f;
    end if;
    if not coalesce((select proconfig from pg_proc where oid = f) @> array['search_path=pg_catalog, public'], false) then
      raise exception '0274: % must pin its search_path', f;
    end if;
  end loop;
  foreach f in array array[
    'public.schedule_actor_level(uuid, uuid)'::regprocedure,
    'public.schedule_actor_require(uuid, uuid, integer)'::regprocedure,
    'public.schedule_subject_at_shop(uuid, uuid)'::regprocedure,
    'public.save_schedule_shop_settings(uuid, uuid, boolean, integer, integer, text)'::regprocedure,
    'public.save_schedule_structure(uuid, uuid, uuid, jsonb)'::regprocedure,
    'public.record_schedule_person_settings(uuid, uuid, uuid, text, text[], text, uuid[], numeric, numeric, boolean, numeric, boolean)'::regprocedure,
    'public.record_schedule_budget_entry(uuid, uuid, text, date, date, numeric, jsonb, text, text, text)'::regprocedure,
    'public.record_schedule_day_type(uuid, uuid, date, text)'::regprocedure,
    'public.record_schedule_pin(uuid, uuid, date, uuid, integer, integer, uuid[], text, uuid)'::regprocedure
  ] loop
    if not (select prosecdef from pg_proc where oid = f) then
      raise exception '0274: writer % must be SECURITY DEFINER', f;
    end if;
  end loop;
  if exists (select 1 from information_schema.routine_privileges where routine_schema = 'public'
              and (routine_name like 'schedule\_%' or routine_name in ('valid_schedule_structure', 'save_schedule_shop_settings', 'save_schedule_structure',
                   'record_schedule_person_settings', 'record_schedule_budget_entry', 'record_schedule_day_type', 'record_schedule_pin'))
              and grantee in ('PUBLIC', 'anon', 'authenticated')) then
    raise exception '0274: a PostgREST role can execute a 0274 function';
  end if;
  if exists (select 1 from information_schema.role_usage_grants where object_schema = 'public' and object_type = 'SEQUENCE'
              and object_name like 'schedule\_%' and grantee in ('PUBLIC', 'anon', 'authenticated')) then
    raise exception '0274: a PostgREST role holds a schedule sequence';
  end if;
end $$;

commit;
