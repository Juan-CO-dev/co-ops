-- Migration 0284_schedule_crew_gaps
-- AUTHORED 2026-10-22. NOT YET APPLIED - sim first, prod on Juan's word, AFTER 0283.
-- APPLIED TO SIM 2026-10-22 (schema_migrations version 20261022194041, name '0284_schedule_crew_gaps').
-- Provenance: CC-approved crew Phase 1 plan section 4, binding ruling R4.
-- ROLLOUT: apply 0275 and 0283 first, then 0284 before deploying crew gap writers.
-- VERIFY AFTER APPLY:
--   select public.valid_gap_certificate('crew_shortfall', '{"kind":"station_short","required":2,"assigned":1,"onShiftUserIds":[]}'); -- true
--   select count(*) from public.schedule_revision_gaps where not public.valid_gap_certificate(cause, certificate); -- 0
--   select routine_name, grantee from information_schema.routine_privileges where routine_schema='public'
--     and routine_name in ('valid_gap_certificate','commit_schedule_revision'); -- service_role (+ postgres) only
-- ROLLBACK: revert application first; retain this backward-compatible validator while crew rows exist.
-- Never delete or rewrite append-only history. Restore 0275 only in a database without crew rows.
-- In that database restore BOTH 0275 function bodies and its table CHECKs:
--   schedule_revision_gaps_code_check: code in ('coverage_gap', 'mod_missing', 'closing_manager_missing')
--   schedule_revision_gaps_cause_check: cause in ('budget_limited', 'floor_limit', 'eligibility', 'availability', 'capacity', 'structure', 'unresolved_search')
-- Drop/re-add those named CHECKs in the same transaction as restoring the functions.

begin;
do $$
begin
  if to_regprocedure('public.valid_gap_certificate(text,jsonb)') is null
     or to_regprocedure('public.commit_schedule_revision(uuid,uuid,date,uuid,text,uuid,jsonb,jsonb,jsonb,jsonb,jsonb)') is null
     or to_regprocedure('public.valid_schedule_structure(jsonb)') is null then
    raise exception '0284: 0275 and 0283 must be applied first';
  end if;
  if strpos(pg_get_functiondef('public.valid_schedule_structure(jsonb)'::regprocedure), '0283 crew structure') = 0 then
    raise exception '0284: 0275 and 0283 must be applied first';
  end if;
  if strpos(pg_get_functiondef('public.valid_gap_certificate(text,jsonb)'::regprocedure), '0284 crew gaps') > 0 then
    raise exception '0284: already applied';
  end if;
end $$;

alter table public.schedule_revision_gaps drop constraint schedule_revision_gaps_code_check;
alter table public.schedule_revision_gaps add constraint schedule_revision_gaps_code_check
  check (code in ('coverage_gap', 'mod_missing', 'closing_manager_missing', 'open_shift'));
alter table public.schedule_revision_gaps drop constraint schedule_revision_gaps_cause_check;
alter table public.schedule_revision_gaps add constraint schedule_revision_gaps_cause_check
  check (cause in ('budget_limited', 'floor_limit', 'eligibility', 'availability', 'capacity', 'structure', 'unresolved_search', 'crew_shortfall'));

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
               'maximum_length', 'day_limit', 'soft_max', 'overtime', 'budget', 'manager_limit'))
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

create or replace function public.commit_schedule_revision(p_actor uuid, p_location uuid, p_week_start date, p_expected_head uuid, p_kind text,
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
    -- Astra chunk D P3: an impossible calendar date (2026-02-30) is a named refusal, never a 22008.
    begin v_date := (v_e ->> 'date')::date; exception when others then raise exception 'invalid_payload'; end;
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
    -- Astra chunk D P3: an impossible calendar date (2026-02-30) is a named refusal, never a 22008.
    begin v_date := (v_e ->> 'date')::date; exception when others then raise exception 'invalid_payload'; end;
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
       or jsonb_typeof(v_e -> 'code') <> 'string' or (v_e ->> 'code') not in ('coverage_gap', 'mod_missing', 'closing_manager_missing', 'open_shift')
       or jsonb_typeof(v_e -> 'cause') <> 'string'
       or (v_e ->> 'cause') not in ('budget_limited', 'floor_limit', 'eligibility', 'availability', 'capacity', 'structure', 'unresolved_search', 'crew_shortfall')
       or not (jsonb_typeof(v_e -> 'positionId') = 'null' or public.schedule_uuid_ok(v_e ->> 'positionId'))
       or ((v_e ->> 'code') = 'coverage_gap') <> (jsonb_typeof(v_e -> 'positionId') = 'string')
       or not public.schedule_json_quarter(v_e -> 'fromQ') or not public.schedule_json_quarter(v_e -> 'toQ')
       or (v_e ->> 'fromQ')::numeric >= (v_e ->> 'toQ')::numeric then
      raise exception 'invalid_payload';
    end if;
    if public.valid_gap_certificate(v_e ->> 'cause', v_e -> 'certificate') is not true then raise exception 'gap_certificate_invalid'; end if;
    -- 0284 crew admission: bind each certificate to its storage row. Semantic proof is replayed by the app.
    if (v_e ->> 'code') = 'open_shift' and (v_e ->> 'cause') not in ('crew_shortfall', 'unresolved_search') then
      raise exception 'gap_certificate_invalid';
    end if;
    if (v_e ->> 'cause') = 'crew_shortfall' or (v_e ->> 'code') = 'open_shift' then
      if not exists (select 1 from public.schedule_revision_days d
        where d.revision_id = v_rev and d.business_date::text = v_e ->> 'date' and d.inherited)
        and ((p_context -> 'days' -> (v_e ->> 'date') -> 'structure' ->> 'engine') is distinct from 'crew'
          or public.schedule_json_num(p_context -> 'days' -> (v_e ->> 'date') -> 'crew' -> 'version') is distinct from 1) then
        raise exception 'gap_certificate_invalid';
      end if;
    end if;
    if (v_e ->> 'cause') = 'crew_shortfall' then
      if not coalesce(
        ((v_e ->> 'code') = 'open_shift' and (v_e -> 'certificate' ->> 'kind') = 'open_shifts'
          and not exists (select 1 from jsonb_array_elements(v_e -> 'certificate' -> 'items') x
            where public.schedule_json_num(x -> 'fromQ') <> public.schedule_json_num(v_e -> 'fromQ'))
          and (select max(public.schedule_json_num(x -> 'toQ')) from jsonb_array_elements(v_e -> 'certificate' -> 'items') x)
            = public.schedule_json_num(v_e -> 'toQ'))
        or ((v_e ->> 'code') = 'coverage_gap' and (v_e -> 'certificate' ->> 'kind') = 'station_short'), false) then
        raise exception 'gap_certificate_invalid';
      end if;
    end if;
    begin v_date := (v_e ->> 'date')::date; exception when others then raise exception 'invalid_payload'; end;
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

revoke all on function public.valid_gap_certificate(text,jsonb) from public, anon, authenticated;
revoke all on function public.commit_schedule_revision(uuid,uuid,date,uuid,text,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.valid_gap_certificate(text,jsonb) to service_role;
grant execute on function public.commit_schedule_revision(uuid,uuid,date,uuid,text,uuid,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
commit;
