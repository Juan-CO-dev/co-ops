-- Migration 0354_schedule_early_open_mode
-- AUTHORED 2026-11-21 (PR SCH-2, CO Claude, for CC). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod on Juan's word.
-- Plan: CHIEF nav-SCH-PLAN-r5.md sections 4, 6, 9, 17, 20.6 and 20.7 (the plan named this file 0353; nav PR 6 took 0353,
--   so it is 0354), nav-SCH-LEAD-RULINGS-r1.md (A2, C4, D6, D7), Juan's words in nav-DECISIONS-2026-11-20.md: an earlier
--   opening is the extreme case of a heavy catering day, chosen per shop by GM and up: manual (the default), semi (the
--   schedule proposes, a GM accepts) or auto (the schedule applies it).
-- WHAT:
--   A. THE STRUCTURE KEY: optional catering.earlyOpenMode ('manual' | 'semi' | 'auto'; absent = manual in the engine).
--      Re-emits valid_schedule_structure from 0346 with two changes only (tests/schedule-early-open-0354-migration.test.ts
--      pins the body equal to 0346's with them removed):
--        the catering exact-keys check also ignores earlyOpenMode;
--        when present it is a JSON STRING and one of the three values (null, '', 'Auto', a number, a boolean or an
--        object are refused).
--      Absence preserves every historical snapshot: every structure 0346 accepts, this accepts, and the reverse holds
--      for every structure without the key. TS twin: checkCatering (lib/scheduling/structure-shared.ts).
--      The CHECK on schedule_structures.structure (0274) and save_schedule_structure (0274) both call this function,
--      so they follow it with no other change.
--   B. THE READINESS SENTINEL (ruling D7): public.schedule_structure_features() returns text[] = {early_open_mode}.
--      Stable, service_role EXECUTE only. The app (lib/scheduling/schedule-features.ts) reads it, caches a yes for 10
--      minutes and a no for 60 seconds; while it is missing ("function not found") the mode select is hidden, a
--      structure save carrying catering.earlyOpenMode is refused feature_not_ready before any write, and every shop is
--      manual. A later migration that adds a structure feature re-emits this function with the new name appended.
--   A later definer of valid_schedule_structure is re-emitted FROM THIS FILE (never from 0346: 0346's body refuses a
--   stored earlyOpenMode).
-- DEPENDS ON: 0346 only (its valid_schedule_structure must be the live body). NOT on 0353 (nav PR 6's station flags):
--   the two files touch nothing in common and may be applied in either order.
-- DATA: none. No row is written or changed.
-- ROLLOUT: applying this file changes no behaviour: no stored structure carries the key until a GM saves one, and the
--   app shows the mode control only once the sentinel answers. Apply sim first, then prod on Juan's word. The PR SCH-2
--   code may merge before or after the apply; it is inert until then. Do not SAVE a mode while a deployment older than
--   PR SCH-2 is still serving: its TS validator refuses the unknown key in the editor (the 0346 class of warning).
-- PRE-FLIGHT (MCP, before apply):
--   select strpos(pg_get_functiondef('public.valid_schedule_structure(jsonb)'::regprocedure), '0346 hourly target') > 0;       -- true
--   select md5(regexp_replace(prosrc, '[^\x21-\x7E]+', '', 'g')) from pg_proc where oid = 'public.valid_schedule_structure(jsonb)'::regprocedure; -- 9f9617c8ed85f08d01d432f9a756374d
--   select to_regprocedure('public.schedule_structure_features()');                                                       -- null
--   select count(*) from public.schedule_structures where structure -> 'catering' ? 'earlyOpenMode';                        -- 0
-- VERIFY AFTER APPLY:
--   select strpos(pg_get_functiondef('public.valid_schedule_structure(jsonb)'::regprocedure), '0354 early open mode') > 0;     -- true
--   select count(*) from public.schedule_structures where not public.valid_schedule_structure(structure);                   -- 0
--   select public.schedule_structure_features();                                                                            -- {early_open_mode}
--   select has_function_privilege('authenticated', 'public.schedule_structure_features()', 'EXECUTE');                     -- false
-- ROLLBACK (plan section 17): never revert this file while a structure carries the key. To roll PR SCH-2's code back:
--   first, at every shop whose live structure has catering.earlyOpenMode, save a new structure version WITHOUT the key
--   (choosing "Manual" in the editor does exactly that; versions are append-only, nothing else changes, and an older
--   deployment's editor then reads a structure it accepts); then revert the code. Keep this migration: for every
--   structure without the key its validator answers exactly as 0346's did. Never rewrite or delete history.
begin;

do $$ declare v_live text; begin
  if to_regprocedure('public.valid_schedule_structure(jsonb)') is null
     or strpos(pg_get_functiondef('public.valid_schedule_structure(jsonb)'::regprocedure), '0346 hourly target') = 0 then
    raise exception '0354: 0346 must be applied first';
  end if;
  if to_regprocedure('public.schedule_structure_features()') is not null
     or strpos(pg_get_functiondef('public.valid_schedule_structure(jsonb)'::regprocedure), '0354 early open mode') > 0 then
    raise exception '0354: already applied';
  end if;
  -- The live body this file replaces must be 0346's (a later definer would be silently lost).
  select md5(regexp_replace(p.prosrc, '[^\x21-\x7E]+', '', 'g')) into v_live from pg_proc p
   where p.oid = 'public.valid_schedule_structure(jsonb)'::regprocedure;
  if v_live is distinct from '9f9617c8ed85f08d01d432f9a756374d' then
    raise exception '0354: the live body of public.valid_schedule_structure(jsonb) (md5 %) is not its 0346 definition -- a later definer exists; re-emit from it. Refusing.', v_live;
  end if;
end $$;

-- ── A. The structure key: optional catering.earlyOpenMode (re-emitted from 0346) ─────────────────────
create or replace function public.valid_schedule_structure(p jsonb) returns boolean
language plpgsql immutable set search_path = pg_catalog, public as $$
declare
  v_sd jsonb; v_dt jsonb; v_pos jsonb; v_crews jsonb; v_c jsonb; v_w jsonb; v_x jsonb; v_lead jsonb; v_lim jsonb;
  v_cat jsonb; v_lab jsonb; v_e jsonb; v_pair jsonb; v_p jsonb;
  k text; t text; v_seen text[] := '{}';
  v_prep int; v_dish int; v_start int; v_close int; v_outE int; v_outL int; v_span int;
  v_open int; v_trim int; v_cl int; v_before int; v_after int; v_n numeric; v_cap int;
  v_minh int[]; v_maxh int[]; q int;
  v_types jsonb; v_type jsonb; v_crewcat jsonb; v_typeids text[] := '{}'; v_stations text[];
  v_trimchars text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  if not public.schedule_json_exact_keys(p - 'engine' - 'shiftTypes', array['version', 'shopDay', 'dayTypes', 'crews', 'positions', 'priority', 'leadership',
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
  if not public.schedule_json_exact_keys(case when jsonb_typeof(v_cat) = 'object' then v_cat - 'crewShift' - 'earlyOpenMode' else v_cat end, array['minHeadcount', 'extraPrepDishHeads', 'defaultStartQ', 'defaultEndQ', 'leadMinutes']) then return false; end if;
  if not public.schedule_json_int(v_cat -> 'minHeadcount', 0, 10000) or not public.schedule_json_int(v_cat -> 'extraPrepDishHeads', 0, 8)
     or not public.schedule_json_quarter(v_cat -> 'defaultStartQ') or not public.schedule_json_quarter(v_cat -> 'defaultEndQ')
     or (v_cat ->> 'defaultEndQ')::numeric <= (v_cat ->> 'defaultStartQ')::numeric
     or not public.schedule_json_int(v_cat -> 'leadMinutes', 0, 720) or (v_cat ->> 'leadMinutes')::numeric % 15 <> 0 then
    return false;
  end if;
  -- 0354 early open mode: optional per-shop earlier-opening mode; absent means manual in the engine. A JSON string,
  -- one of the three values.
  if v_cat ? 'earlyOpenMode' and (jsonb_typeof(v_cat -> 'earlyOpenMode') <> 'string'
     or not ((v_cat ->> 'earlyOpenMode') in ('manual', 'semi', 'auto'))) then return false; end if;

  -- labor
  v_lab := p -> 'labor';
  if not public.schedule_json_exact_keys(case when jsonb_typeof(v_lab) = 'object' then v_lab - 'hourlyTargetPct' else v_lab end, array['targetPct', 'basis', 'strong', 'watch', 'budgetDeadbandH']) then return false; end if;
  if public.schedule_json_num(v_lab -> 'targetPct') is null or not (public.schedule_json_num(v_lab -> 'targetPct') > 0)
     or public.schedule_json_num(v_lab -> 'targetPct') > 100 then return false; end if;
  if jsonb_typeof(v_lab -> 'basis') <> 'string' or not ((v_lab ->> 'basis') in ('hourly', 'total')) then return false; end if;
  if public.schedule_json_num(v_lab -> 'strong') is null or not (public.schedule_json_num(v_lab -> 'strong') > 0)
     or not (public.schedule_json_num(v_lab -> 'strong') < 1) then return false; end if;
  if public.schedule_json_num(v_lab -> 'watch') is null or not (public.schedule_json_num(v_lab -> 'watch') > 0)
     or not (public.schedule_json_num(v_lab -> 'watch') < public.schedule_json_num(v_lab -> 'strong')) then return false; end if;
  if not public.schedule_json_qhours(v_lab -> 'budgetDeadbandH', 0, 40) then return false; end if;
  -- 0346 hourly target: optional pure-hourly labor target %; absent means 18 in the pricer. Only on the total
  -- basis (on the hourly basis targetPct IS the hourly target) and never above the fully loaded target.
  if v_lab ? 'hourlyTargetPct' and (public.schedule_json_num(v_lab -> 'hourlyTargetPct') is null
     or not (public.schedule_json_num(v_lab -> 'hourlyTargetPct') > 0)
     or (v_lab ->> 'basis') <> 'total'
     or public.schedule_json_num(v_lab -> 'hourlyTargetPct') > public.schedule_json_num(v_lab -> 'targetPct')) then return false; end if;

  -- roster
  if not public.schedule_json_exact_keys(case when jsonb_typeof(p -> 'roster') = 'object' then (p -> 'roster') - 'backupCoverPerDay' - 'backupCoverPerPersonWeek' else p -> 'roster' end, array['excludedRoles'])
     or not public.schedule_role_list_ok(p -> 'roster' -> 'excludedRoles') then return false; end if;

  -- 0285 backup cover: optional per-shop daily cap; absence preserves historical snapshots.
  if (p -> 'roster') ? 'backupCoverPerDay'
     and not public.schedule_json_int(p -> 'roster' -> 'backupCoverPerDay', 0, 3) then return false; end if;

  -- 0286 backup cover week cap: optional per-shop weekly limit; absent means two in the engine.
  if (p -> 'roster') ? 'backupCoverPerPersonWeek'
     and not public.schedule_json_int(p -> 'roster' -> 'backupCoverPerPersonWeek', 0, 7) then return false; end if;

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

  -- 0283 crew structure: optional keys preserve historical snapshots.
  if p ? 'engine' and (jsonb_typeof(p -> 'engine') <> 'string' or p ->> 'engine' not in ('stations', 'crew')) then return false; end if;
  v_types := coalesce(p -> 'shiftTypes', '[]'::jsonb);
  if jsonb_typeof(v_types) <> 'array' then return false; end if;
  if p ->> 'engine' = 'crew' and jsonb_array_length(v_types) = 0 then return false; end if;
  for v_type in select value from jsonb_array_elements(v_types) loop
    if not public.schedule_json_exact_keys(v_type, array['id', 'name', 'fromQ', 'toQ', 'startFlexQ', 'minLengthQ', 'headcount', 'stations', 'countsTowardMod']) then return false; end if;
    if jsonb_typeof(v_type -> 'id') <> 'string' or btrim(v_type ->> 'id', v_trimchars) = '' or v_type ->> 'id' = any(v_typeids) then return false; end if;
    v_typeids := array_append(v_typeids, v_type ->> 'id');
    if jsonb_typeof(v_type -> 'name') <> 'string' or btrim(v_type ->> 'name', v_trimchars) = '' then return false; end if;
    if not public.schedule_json_quarter(v_type -> 'fromQ') or not public.schedule_json_quarter(v_type -> 'toQ') then return false; end if;
    if (v_type ->> 'fromQ')::numeric < v_prep or (v_type ->> 'toQ')::numeric > v_outL
       or (v_type ->> 'fromQ')::numeric >= (v_type ->> 'toQ')::numeric then return false; end if;
    if not public.schedule_json_int(v_type -> 'startFlexQ', 0, 96)
       or not public.schedule_json_int(v_type -> 'minLengthQ', 1, (v_type ->> 'toQ')::numeric - (v_type ->> 'fromQ')::numeric) then return false; end if;
    if not public.schedule_json_exact_keys(v_type -> 'headcount', array['slow','normal','busy','weekend']) then return false; end if;
    foreach t in array array['slow','normal','busy','weekend'] loop
      if not public.schedule_json_int(v_type -> 'headcount' -> t, 0, 20) then return false; end if;
    end loop;
    if jsonb_typeof(v_type -> 'stations') <> 'array' then return false; end if;
    v_stations := '{}';
    for v_e in select value from jsonb_array_elements(v_type -> 'stations') loop
      k := v_e #>> '{}';
      if jsonb_typeof(v_e) <> 'string' or not (v_pos ? k) or k = any(v_stations) then return false; end if;
      v_stations := array_append(v_stations, k);
    end loop;
    if jsonb_typeof(v_type -> 'countsTowardMod') <> 'boolean' then return false; end if;
  end loop;
  if v_cat ? 'crewShift' then
    v_crewcat := v_cat -> 'crewShift';
    if not public.schedule_json_exact_keys(v_crewcat, array['enabled','typeId','extraHeads']) then return false; end if;
    if jsonb_typeof(v_crewcat -> 'enabled') <> 'boolean' then return false; end if;
    if jsonb_typeof(v_crewcat -> 'typeId') not in ('null','string') then return false; end if;
    if jsonb_typeof(v_crewcat -> 'typeId') = 'string' and btrim(v_crewcat ->> 'typeId', v_trimchars) = '' then return false; end if;
    if (v_crewcat ->> 'enabled')::boolean and (v_crewcat ->> 'typeId' is null or not (v_crewcat ->> 'typeId' = any(v_typeids))) then return false; end if;
    if not public.schedule_json_int(v_crewcat -> 'extraHeads', 1, 20) then return false; end if;
  end if;

  return true;
end $$;

-- ── B. The readiness sentinel ───────────────────────────────────────────────────────────────────────
create function public.schedule_structure_features() returns text[]
language sql stable set search_path = pg_catalog, public as $$
  select array['early_open_mode']::text[]
$$;

-- ── CEILINGS (re-proved after the replace) ──────────────────────────────────────────────────────────
revoke all on function public.valid_schedule_structure(jsonb) from public, anon, authenticated;
grant execute on function public.valid_schedule_structure(jsonb) to service_role;
revoke all on function public.schedule_structure_features() from public, anon, authenticated, service_role;
grant execute on function public.schedule_structure_features() to service_role;
do $$ declare f regprocedure; begin
  foreach f in array array[
    'public.valid_schedule_structure(jsonb)'::regprocedure,
    'public.schedule_structure_features()'::regprocedure] loop
    if not has_function_privilege('service_role', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE')
      or has_function_privilege('authenticated', f, 'EXECUTE')
      or exists(select 1 from pg_proc pr, lateral aclexplode(pr.proacl) a where pr.oid = f and a.grantee = 0) then
      raise exception '0354: RPC escape %', f; end if;
  end loop;
  -- Every stored structure is still valid under the re-emitted validator (none can carry the key yet).
  if exists (select 1 from public.schedule_structures s where not public.valid_schedule_structure(s.structure)) then
    raise exception '0354: a stored structure is not valid under the re-emitted validator. Refusing.';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
