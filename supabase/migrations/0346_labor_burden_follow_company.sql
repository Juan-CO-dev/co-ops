-- Migration 0346_labor_burden_follow_company
-- AUTHORED 2026-11-18 (board two labor views PR 2, CO Claude, for CC). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod on Juan's word.
-- APPLIED TO PROD 2026-11-19 (schema_migrations version 20261119035123, name '0346_labor_burden_follow_company'), after sim. The line above is the authoring-time gate note, kept as history.
-- Apply AFTER 0345 (labor_cost_planned) and 0286 (the live valid_schedule_structure). Nothing shows the new card or
-- the new field until SCHEDULE_LABOR_VIEWS=1 (with FACT_LAYER=1 and FACT_LAYER_LABOR=1).
-- Plan: CHIEF item-02-BOARD-TWO-VIEWS-PLAN-r4.md, "Migration" steps 2 and 3 (the two 0345 left for PR 2), "Burden
-- card", and Juan's answers ("a company default with a per-shop override; the migration adds 'follow the company
-- from <date>'"; "18% editable: optional labor.hourlyTargetPct in the structure; absent = 18").
--
-- A. THE BURDEN: "follow the company from <date>".
--    0338 let a shop row override the company row, with no way back: once a shop had a row, the newest shop row
--    won for every later week. A shop row may now say follow_company (no % and no source of its own). The burden in
--    force for a shop's week is:
--      the shop's row in force (greatest valid_from <= the week start, then the newest) when it carries a rate;
--      else (no shop row in force, or it follows the company) the company row in force;
--      else 12%, `estimated`.
--    fact_labor_burden_for keeps its signature and its two columns, so fact_labor_cost_planned (0345) is untouched.
--    With no follow_company row every answer is 0338's (tests/labor-burden-0346-migration.test.ts reads it before
--    and after this file).
--
--    save_labor_burden's CONTRACT CHANGES (0338's six-argument function is DROPPED; no application code ever
--    called it: it was run by hand from the runbook). New:
--      save_labor_burden(p_actor, p_location_id, p_follow_company, p_burden_pct, p_valid_from, p_source, p_note, p_expected_id)
--    - Owner / CGS / MoO, active, re-checked on the locked users row (as before).
--    - p_valid_from is a SUNDAY on or after the labor history floor week (2026-07-19): the burden is read per
--      payroll week, so any other date only looked like it started mid-week. Refused labor_burden_invalid_date.
--      (Rows already stored keep whatever date they have; the reader's `valid_from <= week start` still holds.)
--    - a rate: 0..50 and a source (`estimated` | `payroll`), as before.
--    - follow the company: a shop only, no % and no source; refused labor_burden_already_following when the shop
--      already reads the company's rate at that date (nothing to end).
--    - p_expected_id = the id of the newest row of that scope the person saw (NULL = none yet), compared under the
--      scope's advisory lock: another save in between is labor_burden_moved, never a silent overwrite.
--    - ONE destructive labor_burden.save audit row in the same transaction, as before: the value the scope read at
--      valid_from before, and what it reads after (for a follow row: the company's rate at that date). The note
--      never enters the audit row (has_note only).
--    The table stays append-only by grant (service_role SELECT only); this function is still its ONE writer.
--
-- B. THE STRUCTURE KEY: optional labor.hourlyTargetPct (the pure-hourly labor target; absent = 18 in the pricer).
--    Re-emits valid_schedule_structure from 0286 with two changes only (tests/labor-burden-0346-migration.test.ts
--    pins the body equal to 0286's with them removed):
--      the labor exact-keys check ignores hourlyTargetPct;
--      when present it is a number > 0, only on the `total` basis (on the `hourly` basis targetPct IS the hourly
--      target), and never above targetPct (pure hourly is a part of fully loaded).
--    Absence preserves every historical snapshot. TS twin: checkLabor (lib/scheduling/structure-shared.ts).
--
-- ROLLOUT: apply (sim, then prod) BEFORE deploying PR 2's code is safe (nothing calls the old writer; a structure
--   without the key validates as before). Do not save an hourlyTargetPct while a deployment older than PR 2 is
--   still serving: its TS validator refuses the unknown key on read.
-- PRE-FLIGHT (MCP, before apply):
--   select to_regprocedure('public.fact_labor_cost_planned(uuid,date,date,text,jsonb)');                      -- present (0345)
--   select md5(regexp_replace(prosrc, '[^\x21-\x7E]+', '', 'g')) from pg_proc where oid = 'public.save_labor_burden(uuid,uuid,numeric,date,text,text)'::regprocedure; -- bee8df547bf26304211500b6197caab6
--   select md5(regexp_replace(prosrc, '[^\x21-\x7E]+', '', 'g')) from pg_proc where oid = 'public.fact_labor_burden_for(uuid,date)'::regprocedure;                    -- f0fc51f620067f3035008c12f15789b1
--   select strpos(pg_get_functiondef('public.valid_schedule_structure(jsonb)'::regprocedure), '0286 backup cover week cap') > 0;                                      -- true
-- VERIFY AFTER APPLY:
--   select strpos(pg_get_functiondef('public.valid_schedule_structure(jsonb)'::regprocedure), '0346 hourly target') > 0; -- true
--   select count(*) from public.schedule_structures where not public.valid_schedule_structure(structure);              -- 0
--   select to_regprocedure('public.save_labor_burden(uuid,uuid,numeric,date,text,text)');                              -- null
--   select count(*) from public.labor_burden_settings where follows_company;                                           -- 0
-- ROLLBACK: revert the application first. Keep these backward-compatible functions while a follow_company row or a
--   structure with hourlyTargetPct exists; never rewrite or delete historical rows.
begin;

do $$ declare v_live text; begin
  if to_regprocedure('public.fact_labor_cost_planned(uuid,date,date,text,jsonb)') is null or to_regclass('public.labor_burden_settings') is null then
    raise exception '0346: apply 0345 first'; end if;
  if to_regprocedure('public.save_labor_burden(uuid,uuid,boolean,numeric,date,text,text,uuid)') is not null then raise exception '0346: already applied'; end if;
  -- The two live bodies this file replaces must be their 0338 definitions (a later definer would be silently lost).
  select md5(regexp_replace(p.prosrc, '[^\x21-\x7E]+', '', 'g')) into v_live from pg_proc p
   where p.oid = to_regprocedure('public.save_labor_burden(uuid,uuid,numeric,date,text,text)');
  if v_live is distinct from 'bee8df547bf26304211500b6197caab6' then
    raise exception '0346: the live body of public.save_labor_burden(uuid,uuid,numeric,date,text,text) (md5 %) is not its 0338 definition -- a later definer exists; re-emit from it. Refusing.', v_live;
  end if;
  select md5(regexp_replace(p.prosrc, '[^\x21-\x7E]+', '', 'g')) into v_live from pg_proc p
   where p.oid = to_regprocedure('public.fact_labor_burden_for(uuid,date)');
  if v_live is distinct from 'f0fc51f620067f3035008c12f15789b1' then
    raise exception '0346: the live body of public.fact_labor_burden_for(uuid,date) (md5 %) is not its 0338 definition -- a later definer exists; re-emit from it. Refusing.', v_live;
  end if;
  if to_regprocedure('public.valid_schedule_structure(jsonb)') is null then raise exception '0346: 0286 must be applied first'; end if;
  if strpos(pg_get_functiondef('public.valid_schedule_structure(jsonb)'::regprocedure), '0286 backup cover week cap') = 0 then
    raise exception '0346: 0286 must be applied first';
  end if;
  if strpos(pg_get_functiondef('public.valid_schedule_structure(jsonb)'::regprocedure), '0346 hourly target') > 0 then
    raise exception '0346: already applied';
  end if;
end $$;

-- ── A. The burden: a shop row may follow the company ────────────────────────────────────────────────
alter table public.labor_burden_settings add column follows_company boolean not null default false;
alter table public.labor_burden_settings alter column burden_pct drop not null;
alter table public.labor_burden_settings alter column source drop not null;
alter table public.labor_burden_settings add constraint labor_burden_settings_rate_or_follow check (
  (follows_company and location_id is not null and burden_pct is null and source is null)
  or (not follows_company and burden_pct is not null and source is not null));
comment on column public.labor_burden_settings.follows_company is
  '0346: a SHOP row that ends the shop''s own rate from valid_from on: the shop reads the company row in force (else 12%, estimated). No % and no source of its own.';

-- The burden in force for a shop's week: the shop's row in force when it carries a rate; else the company row in
-- force; else the 12% default, `estimated`. (0338's signature and columns: 0345's pricer calls it unchanged.)
create or replace function public.fact_labor_burden_for(p_location_id uuid, p_week_start date)
returns table(burden_pct numeric, burden_basis text)
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(b.burden_pct, 12.00), coalesce(b.source, 'estimated') from (select 1) one
  left join lateral (
    select c.burden_pct, c.source from (
      (select h.burden_pct, h.source, 0 ord
         from (select s.burden_pct, s.source, s.follows_company from public.labor_burden_settings s
                where s.location_id = p_location_id and s.valid_from <= p_week_start
                order by s.valid_from desc, s.created_at desc, s.id desc limit 1) h
        where not h.follows_company)
      union all
      (select s.burden_pct, s.source, 1 from public.labor_burden_settings s
        where s.location_id is null and s.valid_from <= p_week_start
        order by s.valid_from desc, s.created_at desc, s.id desc limit 1)
    ) c order by c.ord limit 1) b on true
$$;

drop function public.save_labor_burden(uuid, uuid, numeric, date, text, text);

create function public.save_labor_burden(p_actor uuid, p_location_id uuid, p_follow_company boolean, p_burden_pct numeric, p_valid_from date,
  p_source text, p_note text, p_expected_id uuid)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_id uuid; v_role text; v_before jsonb; v_after jsonb; v_pct numeric(5,2); v_head uuid; v_floor date; v_own record; v_co record;
begin
  if p_actor is not null then
    select u.role into v_role from public.users u where u.id = p_actor and u.active and u.role in ('owner', 'cgs', 'moo') for share;
  end if;
  if v_role is null then raise exception 'labor_burden_forbidden'; end if;
  if p_follow_company is null or p_valid_from is null or char_length(coalesce(p_note, '')) > 500
    or (p_location_id is not null and not exists (select 1 from public.locations l where l.id = p_location_id))
    or (p_follow_company and (p_location_id is null or p_burden_pct is not null or p_source is not null))
    or (not p_follow_company and (p_burden_pct is null or p_burden_pct < 0 or p_burden_pct > 50
          or p_source is null or p_source not in ('estimated', 'payroll'))) then
    raise exception 'labor_burden_invalid'; end if;
  -- The burden is read per payroll week: a start is a Sunday, never before the labor history's first week.
  select floor_week into v_floor from public.fact_labor_constants();
  if extract(dow from p_valid_from) <> 0 or p_valid_from < v_floor then raise exception 'labor_burden_invalid_date'; end if;
  -- Saves of one scope queue, so each audit row's "before" is the value the previous save left, and the expected
  -- head is judged against what is really there.
  perform pg_advisory_xact_lock(hashtextextended('labor_burden:' || coalesce(p_location_id::text, 'company'), 0));
  select s.id into v_head from public.labor_burden_settings s
   where s.location_id is not distinct from p_location_id order by s.created_at desc, s.id desc limit 1;
  if v_head is distinct from p_expected_id then raise exception 'labor_burden_moved'; end if;
  -- What this scope reads at valid_from: its own row in force (a shop's, when it carries a rate), else the
  -- company row in force, else the 12% default.
  select s.id, s.burden_pct, s.source, s.valid_from, s.follows_company into v_own from public.labor_burden_settings s
   where p_location_id is not null and s.location_id = p_location_id and s.valid_from <= p_valid_from
   order by s.valid_from desc, s.created_at desc, s.id desc limit 1;
  select s.id, s.burden_pct, s.source, s.valid_from into v_co from public.labor_burden_settings s
   where s.location_id is null and s.valid_from <= p_valid_from
   order by s.valid_from desc, s.created_at desc, s.id desc limit 1;
  v_before := case
    when v_own.id is not null and not v_own.follows_company then
      jsonb_build_object('burden_pct', v_own.burden_pct, 'source', v_own.source, 'valid_from', v_own.valid_from, 'scope', 'shop', 'row_id', v_own.id)
    when v_co.id is not null then
      jsonb_build_object('burden_pct', v_co.burden_pct, 'source', v_co.source, 'valid_from', v_co.valid_from, 'scope', 'company', 'row_id', v_co.id)
    else jsonb_build_object('burden_pct', 12.00, 'source', 'estimated', 'scope', 'default') end;
  if p_follow_company and (v_own.id is null or v_own.follows_company) then raise exception 'labor_burden_already_following'; end if;
  v_pct := round(p_burden_pct, 2);
  insert into public.labor_burden_settings (location_id, burden_pct, valid_from, source, note, created_by, follows_company)
  values (p_location_id, v_pct, p_valid_from, p_source, nullif(p_note, ''), p_actor, p_follow_company) returning id into v_id;
  v_after := case when p_follow_company then
      -- the shop now reads the company's rate at that date (or the default)
      jsonb_build_object('follow_company', true, 'burden_pct', coalesce(v_co.burden_pct, 12.00), 'source', coalesce(v_co.source, 'estimated'),
        'valid_from', p_valid_from, 'location_id', p_location_id)
    else jsonb_build_object('follow_company', false, 'burden_pct', v_pct, 'source', p_source, 'valid_from', p_valid_from, 'location_id', p_location_id) end;
  insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, before_state, after_state, metadata, destructive)
  values (p_actor, v_role, 'labor_burden.save', 'labor_burden_settings', v_id, v_before, v_after,
    jsonb_build_object('scope', case when p_location_id is null then 'company' else 'shop' end, 'location_id', p_location_id,
      'valid_from', p_valid_from, 'follow_company', p_follow_company, 'has_note', coalesce(p_note, '') <> ''),
    true);
  return v_id;
end $$;

-- ── B. The structure key: optional labor.hourlyTargetPct (re-emitted from 0286) ──────────────────────
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

-- ── CEILINGS (re-proved after the replaces) ─────────────────────────────────────────────────────────
revoke all on function public.valid_schedule_structure(jsonb) from public, anon, authenticated;
grant execute on function public.valid_schedule_structure(jsonb) to service_role;
do $$ declare f regprocedure; p text; begin
  foreach f in array array[
    'public.save_labor_burden(uuid,uuid,boolean,numeric,date,text,text,uuid)'::regprocedure,
    'public.fact_labor_burden_for(uuid,date)'::regprocedure] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.save_labor_burden(uuid,uuid,boolean,numeric,date,text,text,uuid)'::regprocedure,
    'public.fact_labor_burden_for(uuid,date)'::regprocedure,
    'public.valid_schedule_structure(jsonb)'::regprocedure] loop
    if not has_function_privilege('service_role', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE')
      or has_function_privilege('authenticated', f, 'EXECUTE')
      or exists(select 1 from pg_proc pr, lateral aclexplode(pr.proacl) a where pr.oid = f and a.grantee = 0) then
      raise exception '0346: RPC escape %', f; end if;
  end loop;
  -- The table is still append-only by grant: service_role reads, only the definer writer writes.
  foreach p in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('service_role', 'public.labor_burden_settings', p) or has_table_privilege('anon', 'public.labor_burden_settings', p)
      or has_table_privilege('authenticated', 'public.labor_burden_settings', p) then
      raise exception '0346: labor_burden_settings % escape', p; end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
