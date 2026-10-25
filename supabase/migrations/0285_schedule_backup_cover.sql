-- Migration 0285_schedule_backup_cover
-- AUTHORED 2026-10-24. NOT YET APPLIED - sim first, prod on Juan's word, AFTER 0284.
-- APPLIED TO SIM 2026-10-24 (schema_migrations version 20261025030559, name '0285_schedule_backup_cover').
-- Provenance: CC-cleared Backup cover implementation, Juan's 2026-10-24 crew-engine ruling.
-- Re-emits 0283 structure validation with only the optional roster.backupCoverPerDay key.
-- Re-emits 0284 gap validation with only the backup_cover_cap rejection reason.
-- ROLLOUT: apply AFTER 0284, before deploying Backup cover structure or gap writers.
-- VERIFY AFTER APPLY:
--   select strpos(pg_get_functiondef('public.valid_schedule_structure(jsonb)'::regprocedure), '0285 backup cover') > 0; -- true
--   select count(*) from public.schedule_structures where not public.valid_schedule_structure(structure); -- 0
--   select count(*) from public.schedule_revision_gaps where not public.valid_gap_certificate(cause, certificate); -- 0
--   select routine_name, grantee from information_schema.routine_privileges where routine_schema = 'public'
--     and routine_name in ('valid_schedule_structure', 'valid_gap_certificate'); -- service_role (+ postgres) only
-- ROLLBACK: revert application first; keep these backward-compatible validators while new-format rows exist.
-- Restore 0283/0284 validators only in a database without new-format rows.
-- Never rewrite or delete append-only history to roll back.

begin;
do $$
begin
  if to_regprocedure('public.valid_schedule_structure(jsonb)') is null
     or to_regprocedure('public.valid_gap_certificate(text,jsonb)') is null then
    raise exception '0285: 0283 and 0284 must be applied first';
  end if;
  if strpos(pg_get_functiondef('public.valid_schedule_structure(jsonb)'::regprocedure), '0283 crew structure') = 0
     or strpos(pg_get_functiondef('public.valid_gap_certificate(text,jsonb)'::regprocedure), '0284 crew gaps') = 0 then
    raise exception '0285: 0283 and 0284 must be applied first';
  end if;
  if strpos(pg_get_functiondef('public.valid_schedule_structure(jsonb)'::regprocedure), '0285 backup cover') > 0 then
    raise exception '0285: already applied';
  end if;
end $$;

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
  if not public.schedule_json_exact_keys(case when jsonb_typeof(v_cat) = 'object' then v_cat - 'crewShift' else v_cat end, array['minHeadcount', 'extraPrepDishHeads', 'defaultStartQ', 'defaultEndQ', 'leadMinutes']) then return false; end if;
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
  if not public.schedule_json_exact_keys(case when jsonb_typeof(p -> 'roster') = 'object' then (p -> 'roster') - 'backupCoverPerDay' else p -> 'roster' end, array['excludedRoles'])
     or not public.schedule_role_list_ok(p -> 'roster' -> 'excludedRoles') then return false; end if;

  -- 0285 backup cover: optional per-shop daily cap; absence preserves historical snapshots.
  if (p -> 'roster') ? 'backupCoverPerDay'
     and not public.schedule_json_int(p -> 'roster' -> 'backupCoverPerDay', 0, 3) then return false; end if;

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

create or replace function public.valid_gap_certificate(p_cause text, c jsonb) returns boolean
language plpgsql immutable set search_path = pg_catalog, public as $$
declare k text; v jsonb; r jsonb; v_ids text[]; v_types text[]; v_from numeric;
begin
  if p_cause is null or c is null or jsonb_typeof(c) <> 'object' then return false; end if;
  case p_cause
    when 'crew_shortfall' then
      -- 0284 crew gaps: shape only; TypeScript replays complete evidence against the frozen context.
      if c ->> 'kind' = 'station_short' then
        return coalesce(public.schedule_json_exact_keys(c, array['kind', 'required', 'assigned', 'onShiftUserIds'])
          and public.schedule_json_int(c -> 'required', 1, 1000)
          and public.schedule_json_int(c -> 'assigned', 0, 1000)
          and public.schedule_json_num(c -> 'assigned') < public.schedule_json_num(c -> 'required')
          and public.schedule_json_strings(c -> 'onShiftUserIds')
          and not exists (select 1 from jsonb_array_elements_text(c -> 'onShiftUserIds') x where x = '')
          and not exists (select 1 from (select x, lag(x) over (order by n) prev
            from jsonb_array_elements_text(c -> 'onShiftUserIds') with ordinality a(x,n)) t where prev collate "C" >= x collate "C"), false);
      end if;
      if not coalesce(public.schedule_json_exact_keys(c, array['kind', 'items']) and c ->> 'kind' = 'open_shifts'
        and jsonb_typeof(c -> 'items') = 'array', false) then return false; end if;
      if jsonb_array_length(c -> 'items') = 0 then return false; end if;
      v_types := '{}'; v_from := null;
      for v in select value from jsonb_array_elements(c -> 'items') loop
        if not coalesce(public.schedule_json_exact_keys(v, array['typeId', 'fromQ', 'toQ', 'required', 'placed', 'missing', 'rejected'])
          and jsonb_typeof(v -> 'typeId') = 'string' and length(v ->> 'typeId') > 0
          and public.schedule_json_quarter(v -> 'fromQ') and public.schedule_json_quarter(v -> 'toQ')
          and public.schedule_json_num(v -> 'fromQ') < public.schedule_json_num(v -> 'toQ')
          and public.schedule_json_int(v -> 'required', 1, 1000) and public.schedule_json_int(v -> 'placed', 0, 1000)
          and public.schedule_json_int(v -> 'missing', 1, 1000)
          and public.schedule_json_num(v -> 'required') - public.schedule_json_num(v -> 'placed') = public.schedule_json_num(v -> 'missing')
          and jsonb_typeof(v -> 'rejected') = 'array', false) then return false; end if;
        if (v ->> 'typeId') collate "C" <= v_types[array_length(v_types, 1)] collate "C"
          or (v_from is not null and v_from <> public.schedule_json_num(v -> 'fromQ')) then return false; end if;
        v_types := array_append(v_types, v ->> 'typeId'); v_from := public.schedule_json_num(v -> 'fromQ');
        v_ids := '{}';
        for r in select value from jsonb_array_elements(v -> 'rejected') loop
          if not coalesce(public.schedule_json_exact_keys(r, array['userId', 'codes'])
            and jsonb_typeof(r -> 'userId') = 'string' and length(r ->> 'userId') > 0
            and public.schedule_json_strings(r -> 'codes'), false) then return false; end if;
          if (r ->> 'userId') collate "C" <= v_ids[array_length(v_ids, 1)] collate "C" or jsonb_array_length(r -> 'codes') = 0
            or exists (select 1 from jsonb_array_elements_text(r -> 'codes') x where x not in
              ('off', 'time_off', 'unavailable', 'already_scheduled', 'position', 'leader_setting', 'minimum_length',
               'maximum_length', 'day_limit', 'soft_max', 'overtime', 'budget', 'manager_limit', 'backup_cover_cap'))
            or (select count(*) <> count(distinct x) from jsonb_array_elements_text(r -> 'codes') x) then return false; end if;
          v_ids := array_append(v_ids, r ->> 'userId');
        end loop;
      end loop;
      return true;
    when 'budget_limited' then
      -- CC chunk D design ruling: "remaining R h < the cheapest legal fill FOUND, W h", with the witness fill's steps
      -- (rules-shared FillStep: relabel / extend / new_block), never a minimality claim.
      if not coalesce(public.schedule_json_exact_keys(c, array['budgetedDates', 'budgetHours', 'usedHours', 'essentialHours', 'remainingHours',
                                                                'fillHours', 'witness'])
         and public.schedule_json_strings(c -> 'budgetedDates') and public.schedule_json_nonneg(c -> 'budgetHours')
         and public.schedule_json_nonneg(c -> 'usedHours') and public.schedule_json_nonneg(c -> 'essentialHours')
         and public.schedule_json_num(c -> 'remainingHours') is not null and public.schedule_json_nonneg(c -> 'fillHours')
         and jsonb_typeof(c -> 'witness') = 'array' and jsonb_array_length(c -> 'witness') > 0, false) then return false; end if;
      for v in select value from jsonb_array_elements(c -> 'witness') loop
        if not coalesce(jsonb_typeof(v) = 'object' and jsonb_typeof(v -> 'kind') = 'string'
           and case v ->> 'kind'
                 when 'relabel' then public.schedule_json_exact_keys(v, array['kind', 'userId', 'shiftStartQ', 'fromPositionId', 'positionId', 'fromQ', 'toQ'])
                   and jsonb_typeof(v -> 'fromPositionId') = 'string' and public.schedule_json_quarter(v -> 'shiftStartQ')
                 when 'extend' then public.schedule_json_exact_keys(v, array['kind', 'userId', 'shiftStartQ', 'positionId', 'fromQ', 'toQ', 'hours'])
                   and public.schedule_json_quarter(v -> 'shiftStartQ') and public.schedule_json_nonneg(v -> 'hours')
                 when 'new_block' then public.schedule_json_exact_keys(v, array['kind', 'userId', 'positionId', 'fromQ', 'toQ', 'hours'])
                   and public.schedule_json_nonneg(v -> 'hours')
                 else false end
           and jsonb_typeof(v -> 'userId') = 'string' and jsonb_typeof(v -> 'positionId') = 'string'
           and public.schedule_json_quarter(v -> 'fromQ') and public.schedule_json_quarter(v -> 'toQ')
           and public.schedule_json_num(v -> 'fromQ') < public.schedule_json_num(v -> 'toQ'), false) then return false; end if;
      end loop;
      return true;
    when 'floor_limit' then
      -- CC chunk H4–H8 (Astra H3–H7 P1s): the CONSERVATIVE certificate — the four limits, EVERY candidate (whoever may legally hold
      -- the position by any path the validator accepts) → the reason (unavailable / flex_exhausted / day_at_max / never_generated) and,
      -- for the salaried candidates, their flex and floor hours; 'on_shift_legal' is not a reason (it means no certificate). The condition
      -- that excluded them (flex_exhausted / ineligible / unavailable / day_at_max) with their flex and floor hours; whether
      -- it still holds is checkCertificate's recomputation, not this shape.
      if not public.schedule_json_exact_keys(c, array['limitH', 'targetWeekH', 'salariedFlexH', 'maxShiftH', 'excludedBy', 'flexHoursUsed', 'floorHoursUsed'])
         or not public.schedule_json_nonneg(c -> 'limitH') or not public.schedule_json_nonneg(c -> 'targetWeekH')
         or not public.schedule_json_nonneg(c -> 'salariedFlexH') or not public.schedule_json_nonneg(c -> 'maxShiftH')
         or jsonb_typeof(c -> 'excludedBy') <> 'object' or jsonb_typeof(c -> 'flexHoursUsed') <> 'object'
         or jsonb_typeof(c -> 'floorHoursUsed') <> 'object' then return false; end if;
      for k, v in select key, value from jsonb_each(c -> 'excludedBy') loop
        if jsonb_typeof(v) <> 'string' or (v #>> '{}') not in ('unavailable', 'flex_exhausted', 'day_at_max', 'never_generated') then return false; end if;
      end loop;
      for k, v in select key, value from jsonb_each(c -> 'flexHoursUsed') loop
        if not public.schedule_json_nonneg(v) then return false; end if;
      end loop;
      for k, v in select key, value from jsonb_each(c -> 'floorHoursUsed') loop
        if not public.schedule_json_nonneg(v) then return false; end if;
      end loop;
      return true;
    when 'eligibility' then
      return coalesce(public.schedule_json_exact_keys(c, array['positionId', 'eligibleCount'])
        and jsonb_typeof(c -> 'positionId') in ('string', 'null') and public.schedule_json_num(c -> 'eligibleCount') = 0, false);
    when 'availability' then
      return coalesce(public.schedule_json_exact_keys(c, array['eligibleIds', 'unavailableIds'])
        and public.schedule_json_strings(c -> 'eligibleIds') and public.schedule_json_strings(c -> 'unavailableIds'), false);
    when 'capacity' then
      return coalesce(public.schedule_json_exact_keys(c, array['fromQ', 'toQ', 'positionIds', 'requiredHeads', 'peopleIds', 'people', 'shortBy'])
        and public.schedule_json_quarter(c -> 'fromQ') and public.schedule_json_quarter(c -> 'toQ')
        and public.schedule_json_num(c -> 'fromQ') < public.schedule_json_num(c -> 'toQ')
        and public.schedule_json_strings(c -> 'positionIds') and public.schedule_json_strings(c -> 'peopleIds')
        and public.schedule_json_int(c -> 'requiredHeads', 0, 1000) and public.schedule_json_int(c -> 'people', 0, 1000)
        and public.schedule_json_int(c -> 'shortBy', 1, 1000), false);
    when 'structure' then
      return coalesce(public.schedule_json_exact_keys(c, array['rule', 'detail']) and jsonb_typeof(c -> 'rule') = 'string'
        and (c ->> 'rule') in ('primary_window_closed', 'no_mod_member', 'no_closing_role', 'max_shift')
        and jsonb_typeof(c -> 'detail') = 'object', false);
    when 'unresolved_search' then
      return coalesce(public.schedule_json_exact_keys(c, array['searched', 'limits', 'candidateIds'])
        and public.schedule_json_exact_keys(c -> 'searched', array['steps', 'donorsTried', 'chainDepth'])
        and public.schedule_json_int(c -> 'searched' -> 'steps', 0, 1e6) and public.schedule_json_int(c -> 'searched' -> 'donorsTried', 0, 1e6)
        and public.schedule_json_int(c -> 'searched' -> 'chainDepth', 0, 1e6)
        and public.schedule_json_exact_keys(c -> 'limits', array['REPAIR_MAX_STEPS', 'maxDonors', 'maxChainDepth'])
        and public.schedule_json_int(c -> 'limits' -> 'REPAIR_MAX_STEPS', 0, 1e6) and public.schedule_json_int(c -> 'limits' -> 'maxDonors', 0, 1e6)
        and public.schedule_json_int(c -> 'limits' -> 'maxChainDepth', 0, 1e6)
        and public.schedule_json_strings(c -> 'candidateIds'), false);
    else
      return false;
  end case;
exception when invalid_parameter_value then return false;
end $$;

revoke all on function public.valid_schedule_structure(jsonb) from public, anon, authenticated;
revoke all on function public.valid_gap_certificate(text,jsonb) from public, anon, authenticated;
grant execute on function public.valid_schedule_structure(jsonb) to service_role;
grant execute on function public.valid_gap_certificate(text,jsonb) to service_role;
commit;
