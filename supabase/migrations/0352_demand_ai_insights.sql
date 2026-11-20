-- Migration 0352_demand_ai_insights
-- AUTHORED 2026-11-19 (item 4 PR 7, CO Claude). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod on Juan's word. Apply AFTER 0343.
-- NUMBER: 0347 is the highest on main; 0348-0351 are claimed by other open PRs (portal 4 / 5, business-report access,
-- toast snapshot dedup), so this file takes 0352. It touches no object of theirs and can be applied in any order with them.
-- Plan: CHIEF 03-PROJECTS/co-ops/2026-11-15-juan-product-notes/item-04-DEMAND-SIGNALS-PLAN-r2.md, section 8 (AI
-- safeguards), with Astra r2 P2 #4 (the model returns claims only; nothing it writes is shown).
--
-- WHAT THIS IS. The SPEND LEDGER of the demand-signals AI insights, and the place a call's validated claims are
-- kept. Nothing here changes a par, a prep number, an order or a schedule, and nothing here calls anything: the
-- call is made by the app, only with DEMAND_AI=1 AND a key, and only when a person asks.
--   demand_ai_reservations   one row per ATTEMPT, written BEFORE the call: who asked, for which shop and ET day,
--                            the model, the prompt version, the hash of what was sent, and the WORST-CASE cost
--                            reserved (microdollars). ONE PER SHOP PER ET DAY (the unique index is the arbiter).
--   demand_ai_settlements    at most one row per reservation, written AFTER the call: the real tokens and cost,
--                            the stop reason, and the claims that PASSED validation, each with the facts it cites
--                            (so the page renders from this row, never from model text). No row = the call crashed.
-- THE CAP IS HELD HERE AS WELL AS IN CODE. demand_ai_reserve takes ONE advisory lock, then counts what this ET
-- month has cost so far: a settled call at its real cost, a FAILED or UNSETTLED one at its full reservation (a
-- crashed call keeps its reservation; nothing ever releases one). The month's total plus the new reservation must
-- fit the cap the caller passes, and that cap can never exceed demand_ai_cap_ceiling_micro() (5,000,000 = $5.00
-- a month): an environment value can only LOWER the cap. Refusals by name: demand_ai_forbidden,
-- demand_ai_shop_forbidden, demand_ai_invalid, demand_ai_daily_limit, demand_ai_cap_reached, demand_ai_unknown,
-- demand_ai_settled.
-- WHO: an active gm (a shop they are an active member of) or moo / owner / cgs (any shop), re-read on the users
-- row here. Every reservation writes its own audit row (demand_ai.request, not destructive: who, shop, model,
-- the reserved amount; never the content). The stored claims hold a category, a date and a reason code: no
-- title, no note, no name, no number about demand.
-- APPEND-ONLY BY GRANT: deny-all RLS, service_role SELECT only, every write through a SECURITY DEFINER function.
-- There is no update and no delete path.
-- Proof: tests/demand-signals-0352-harness.test.ts (PGlite, the real file on the real 0342 and 0343).
--
-- PRE-FLIGHT (MCP, before apply):
--   select to_regprocedure('public.demand_today_et()');   -- present (0342)
--   select to_regclass('public.demand_sources');          -- present (0343)
--   select to_regclass('public.demand_ai_reservations');  -- null
begin;

do $$ begin
  if to_regprocedure('public.demand_today_et()') is null or to_regclass('public.demand_sources') is null then
    raise exception '0352: apply 0342 and 0343 first'; end if;
  if to_regclass('public.locations') is null or to_regclass('public.users') is null or to_regclass('public.user_locations') is null
    or to_regclass('public.audit_log') is null then raise exception '0352: missing locations / users / user_locations / audit_log'; end if;
  if to_regclass('public.demand_ai_reservations') is not null or to_regclass('public.demand_ai_settlements') is not null then
    raise exception '0352: already applied'; end if;
end $$;

-- ── 1. the tables ───────────────────────────────────────────────────────────────────────────────
create table public.demand_ai_reservations (
 id uuid primary key default gen_random_uuid(),
 seq bigint generated always as identity unique,
 location_id uuid not null references public.locations(id),
 day_et date not null,
 input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
 model text not null check (model ~ '^[a-z0-9][a-z0-9.-]{2,63}$'),
 prompt_version integer not null check (prompt_version between 1 and 9999),
 reserved_micro bigint not null check (reserved_micro between 1 and 5000000),
 requested_by uuid not null references public.users(id),
 requested_role text not null,
 reserved_at timestamptz not null default clock_timestamp()
);
-- ONE attempt per shop per ET day: the arbiter of two people asking at once.
create unique index demand_ai_reservations_one_per_day on public.demand_ai_reservations (location_id, day_et);
create index demand_ai_reservations_month on public.demand_ai_reservations (day_et);
comment on table public.demand_ai_reservations is
  '0352: the demand-signals AI spend ledger. One row per attempt, written BEFORE the call with the worst-case cost. One per shop per ET day. Written only by demand_ai_reserve. Deny-all RLS; service_role SELECT only.';

create table public.demand_ai_settlements (
 reservation_id uuid primary key references public.demand_ai_reservations(id),
 outcome text not null check (outcome in ('ok','failed')),
 -- 'ok': the real usage and cost. 'failed': unknown, so NULL, and the month counts the full reservation.
 input_tokens integer check (input_tokens >= 0),
 output_tokens integer check (output_tokens >= 0),
 actual_micro bigint check (actual_micro >= 0),
 stop_reason text check (stop_reason ~ '^[a-z_]{1,40}$'),
 error_code text check (error_code ~ '^[a-z_]{1,40}$'),
 -- The claims that PASSED validation, each with the facts it cites: [{type, facts: [{id, kind, ...}]}].
 claims jsonb not null default '[]'::jsonb check (jsonb_typeof(claims) = 'array' and octet_length(claims::text) <= 16384),
 rejected_count integer not null default 0 check (rejected_count >= 0),
 settled_at timestamptz not null default clock_timestamp(),
 check ((outcome = 'ok') = (input_tokens is not null and output_tokens is not null and actual_micro is not null and error_code is null)),
 check (outcome = 'ok' or (error_code is not null and jsonb_array_length(claims) = 0))
);
comment on table public.demand_ai_settlements is
  '0352: what one AI call really cost and the validated claims it returned. At most one row per reservation; none = the call crashed and its reservation stands in full. Written only by demand_ai_settle. Deny-all RLS; service_role SELECT only.';

-- ── 2. the cap ──────────────────────────────────────────────────────────────────────────────────
-- The most this feature may cost in one ET month, in microdollars. The app's own constant is the same number
-- (DEMAND_AI_CODE_CAP_MICRO); a caller may pass a LOWER cap, never a higher one.
create function public.demand_ai_cap_ceiling_micro() returns bigint language sql immutable set search_path = pg_catalog, public as $$
  select 5000000::bigint
$$;

-- What the ET month of p_day has cost so far: real cost where a call settled 'ok', the full reservation otherwise.
create function public.demand_ai_month_spent_micro(p_day date) returns bigint
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(sum(case when s.outcome = 'ok' then s.actual_micro else r.reserved_micro end), 0)::bigint
  from public.demand_ai_reservations r
  left join public.demand_ai_settlements s on s.reservation_id = r.id
  where r.day_et >= date_trunc('month', p_day)::date and r.day_et < (date_trunc('month', p_day) + interval '1 month')::date
$$;

-- ── 3. reserve (before the call) ────────────────────────────────────────────────────────────────
create function public.demand_ai_reserve(p_actor uuid, p_location_id uuid, p_input_hash text, p_model text, p_prompt_version integer,
  p_reserve_micro bigint, p_cap_micro bigint)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_role text; v_today date := public.demand_today_et(); v_spent bigint; v_id uuid;
begin
  if p_actor is not null then
    select u.role into v_role from public.users u where u.id = p_actor and u.active and u.role in ('gm', 'moo', 'owner', 'cgs') for share;
  end if;
  if v_role is null then raise exception 'demand_ai_forbidden'; end if;
  if p_location_id is null or p_input_hash is null or p_input_hash !~ '^[0-9a-f]{64}$' or p_model is null or p_model !~ '^[a-z0-9][a-z0-9.-]{2,63}$'
    or p_prompt_version is null or p_prompt_version not between 1 and 9999
    or p_reserve_micro is null or p_reserve_micro < 1 or p_cap_micro is null or p_cap_micro < 1
    or p_cap_micro > public.demand_ai_cap_ceiling_micro() then raise exception 'demand_ai_invalid'; end if;
  if not exists (select 1 from public.locations l where l.id = p_location_id and l.active) then raise exception 'demand_ai_invalid'; end if;
  if v_role = 'gm' and not exists (select 1 from public.user_locations m where m.user_id = p_actor and m.location_id = p_location_id and m.active) then
    raise exception 'demand_ai_shop_forbidden'; end if;
  -- ONE lock for every reservation: the month's total is counted and the row is written under it.
  perform pg_advisory_xact_lock(hashtextextended('demand_ai_spend', 0));
  if exists (select 1 from public.demand_ai_reservations r where r.location_id = p_location_id and r.day_et = v_today) then
    raise exception 'demand_ai_daily_limit'; end if;
  v_spent := public.demand_ai_month_spent_micro(v_today);
  if v_spent + p_reserve_micro > p_cap_micro then raise exception 'demand_ai_cap_reached'; end if;
  begin
    insert into public.demand_ai_reservations (location_id, day_et, input_hash, model, prompt_version, reserved_micro, requested_by, requested_role)
    values (p_location_id, v_today, p_input_hash, p_model, p_prompt_version, p_reserve_micro, p_actor, v_role)
    returning id into v_id;
  exception when unique_violation then raise exception 'demand_ai_daily_limit'; end;
  -- Who asked, for which shop, with which model and how much was set aside. Never what was sent.
  insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, metadata, destructive)
  values (p_actor, v_role, 'demand_ai.request', 'demand_ai_reservations', v_id,
    jsonb_build_object('location_id', p_location_id, 'day_et', v_today, 'model', p_model, 'prompt_version', p_prompt_version,
      'reserved_micro', p_reserve_micro, 'month_spent_before_micro', v_spent, 'cap_micro', p_cap_micro), false);
  return jsonb_build_object('id', v_id, 'day_et', v_today, 'month_spent_before_micro', v_spent);
end $$;

-- ── 4. settle (after the call) ──────────────────────────────────────────────────────────────────
-- p_claims = the claims that passed validation in the app, each with the facts it cites. The shape is checked
-- again here, totally: an array of at most 5 objects {type, facts}, type from the closed list, facts an array of
-- 1 to 10 objects each with a string id and a kind from the closed list. Anything else is demand_ai_invalid.
create function public.demand_ai_claims_valid(p_claims jsonb) returns boolean language plpgsql immutable set search_path = pg_catalog, public as $$
declare c jsonb; f jsonb;
begin
  if p_claims is null or jsonb_typeof(p_claims) <> 'array' or jsonb_array_length(p_claims) > 5 or octet_length(p_claims::text) > 16384 then return false; end if;
  for c in select * from jsonb_array_elements(p_claims) loop
    if jsonb_typeof(c) <> 'object' or jsonb_typeof(c->'type') is distinct from 'string' or jsonb_typeof(c->'facts') is distinct from 'array' then return false; end if;
    if (c->>'type') not in ('baseline_is_off','signal_helped_on_history','signal_qualified','signal_not_enough_history','data_missing','event_on_date') then return false; end if;
    if jsonb_array_length(c->'facts') not between 1 and 10 then return false; end if;
    for f in select * from jsonb_array_elements(c->'facts') loop
      if jsonb_typeof(f) <> 'object' or jsonb_typeof(f->'id') is distinct from 'string' or jsonb_typeof(f->'kind') is distinct from 'string' then return false; end if;
      if (f->>'kind') not in ('baseline_score','candidate_score','qualification','episode','coverage_gap','named_event') then return false; end if;
    end loop;
  end loop;
  return true;
end $$;

create function public.demand_ai_settle(p_reservation_id uuid, p_outcome text, p_input_tokens integer, p_output_tokens integer, p_actual_micro bigint,
  p_stop_reason text, p_error_code text, p_claims jsonb, p_rejected_count integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_res public.demand_ai_reservations%rowtype; v_claims jsonb := coalesce(p_claims, '[]'::jsonb);
begin
  if p_reservation_id is null or p_outcome is null or p_outcome not in ('ok', 'failed') then raise exception 'demand_ai_invalid'; end if;
  select * into v_res from public.demand_ai_reservations r where r.id = p_reservation_id for update;
  if not found then raise exception 'demand_ai_unknown'; end if;
  if exists (select 1 from public.demand_ai_settlements s where s.reservation_id = p_reservation_id) then raise exception 'demand_ai_settled'; end if;
  if p_outcome = 'ok' and (p_input_tokens is null or p_input_tokens < 0 or p_output_tokens is null or p_output_tokens < 0
      or p_actual_micro is null or p_actual_micro < 0 or p_error_code is not null) then raise exception 'demand_ai_invalid'; end if;
  if p_outcome = 'failed' and (p_error_code is null or p_error_code !~ '^[a-z_]{1,40}$' or jsonb_array_length(v_claims) <> 0) then raise exception 'demand_ai_invalid'; end if;
  if (p_stop_reason is not null and p_stop_reason !~ '^[a-z_]{1,40}$') or coalesce(p_rejected_count, 0) < 0
    or not public.demand_ai_claims_valid(v_claims) then raise exception 'demand_ai_invalid'; end if;
  begin
    insert into public.demand_ai_settlements (reservation_id, outcome, input_tokens, output_tokens, actual_micro, stop_reason, error_code, claims, rejected_count)
    values (p_reservation_id, p_outcome,
      case when p_outcome = 'ok' then p_input_tokens end, case when p_outcome = 'ok' then p_output_tokens end, case when p_outcome = 'ok' then p_actual_micro end,
      p_stop_reason, p_error_code, v_claims, coalesce(p_rejected_count, 0));
  exception when unique_violation then raise exception 'demand_ai_settled'; end;
  return jsonb_build_object('reservation_id', p_reservation_id, 'outcome', p_outcome);
end $$;

-- ── 5. the page's read: today's attempt for one shop, and the month so far ───────────────────────
create function public.demand_ai_today(p_location_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_today date := public.demand_today_et(); v_row jsonb;
begin
  if p_location_id is null then raise exception 'demand_ai_invalid'; end if;
  select jsonb_build_object('id', r.id, 'day_et', r.day_et, 'input_hash', r.input_hash, 'model', r.model, 'prompt_version', r.prompt_version,
      'reserved_at', r.reserved_at, 'settled', s.reservation_id is not null, 'outcome', s.outcome, 'stop_reason', s.stop_reason,
      'error_code', s.error_code, 'claims', coalesce(s.claims, '[]'::jsonb), 'rejected_count', coalesce(s.rejected_count, 0), 'settled_at', s.settled_at)
    into v_row
  from public.demand_ai_reservations r left join public.demand_ai_settlements s on s.reservation_id = r.id
  where r.location_id = p_location_id and r.day_et = v_today;
  return jsonb_build_object('day_et', v_today, 'attempt', v_row, 'month_spent_micro', public.demand_ai_month_spent_micro(v_today),
    'cap_ceiling_micro', public.demand_ai_cap_ceiling_micro());
end $$;

-- ── 6. ceilings: deny-all RLS with the four explicit denials, service_role SELECT only ──────────────
do $$ declare t text; f regprocedure; begin
  foreach t in array array['demand_ai_reservations','demand_ai_settlements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (false)', t || '_no_user_select', t);
    execute format('create policy %I on public.%I for insert with check (false)', t || '_no_user_insert', t);
    execute format('create policy %I on public.%I for update using (false)', t || '_no_user_update', t);
    execute format('create policy %I on public.%I for delete using (false)', t || '_no_user_delete', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to service_role', t);
  end loop;
  foreach f in array array[
    'public.demand_ai_cap_ceiling_micro()'::regprocedure,
    'public.demand_ai_month_spent_micro(date)'::regprocedure,
    'public.demand_ai_reserve(uuid,uuid,text,text,integer,bigint,bigint)'::regprocedure,
    'public.demand_ai_claims_valid(jsonb)'::regprocedure,
    'public.demand_ai_settle(uuid,text,integer,integer,bigint,text,text,jsonb,integer)'::regprocedure,
    'public.demand_ai_today(uuid)'::regprocedure] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

do $$ declare t text; f regprocedure; p text; begin
  foreach t in array array['demand_ai_reservations','demand_ai_settlements'] loop
    if not has_table_privilege('service_role', 'public.' || t, 'SELECT') then raise exception '0352: % lacks service_role SELECT', t; end if;
    foreach p in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege('service_role', 'public.' || t, p) then raise exception '0352: service_role holds % on %', p, t; end if;
    end loop;
    foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] loop
      if has_table_privilege('anon', 'public.' || t, p) or has_table_privilege('authenticated', 'public.' || t, p) then
        raise exception '0352: PostgREST role holds % on %', p, t; end if;
    end loop;
  end loop;
  foreach f in array array[
    'public.demand_ai_cap_ceiling_micro()'::regprocedure,
    'public.demand_ai_month_spent_micro(date)'::regprocedure,
    'public.demand_ai_reserve(uuid,uuid,text,text,integer,bigint,bigint)'::regprocedure,
    'public.demand_ai_claims_valid(jsonb)'::regprocedure,
    'public.demand_ai_settle(uuid,text,integer,integer,bigint,text,text,jsonb,integer)'::regprocedure,
    'public.demand_ai_today(uuid)'::regprocedure] loop
    if not has_function_privilege('service_role', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE')
      or has_function_privilege('authenticated', f, 'EXECUTE')
      or exists (select 1 from pg_proc pr, lateral aclexplode(pr.proacl) a where pr.oid = f and a.grantee = 0) then
      raise exception '0352: RPC escape %', f; end if;
  end loop;
  -- Ship state: no attempt, no settlement.
  if exists (select 1 from public.demand_ai_reservations) or exists (select 1 from public.demand_ai_settlements) then
    raise exception '0352: the ledger must ship empty'; end if;
end $$;

notify pgrst, 'reload schema';
commit;
