-- Migration 0279_user_employment_events
-- AUTHORED 2026-10-20. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word).
-- Provenance: staff separations, "End employment" (feat/staff-separations; Juan approved the design 2026-10-20, packet
--   "Staff separations" + its ADDENDUM: GMs manage their own shop's users).
--
-- WHY: the app only knew `users.active` (Deactivate: no reason kept) and the display flag `dormant_at`. Nothing said
--   whether someone is on leave and coming back (school, seasonal) or separated (fired, quit, no-call no-show), and
--   nothing kept the rehire decision.
--
-- WHAT:
--   1. user_employment_events — APPEND-ONLY. One row per act: leave_start · leave_end · separated · rehired · correction.
--      A correction is a NEW row naming the event it corrects (`corrects_id`); nothing is ever updated or deleted.
--      The CURRENT STATUS of a person = their latest leave_start / leave_end / separated / rehired row (created_at, id):
--      leave_start → on_leave · separated → separated · leave_end / rehired / no row → active. Corrections change the
--      fields of the event they correct (the newest correction wins), never the status.
--      Deny-all RLS (explicit `_no_user_*` policies, USING false), no grant to PUBLIC / anon / authenticated, and
--      service_role holds SELECT ONLY (the writer below is the ONLY writer) — asserted by the ceiling guard.
--   2. record_user_employment_event(p_actor, p_user, p_expected, p_kind, p_fields jsonb) — SECURITY DEFINER, search_path
--      pinned, EXECUTE for service_role only. In this order:
--        - the per-person advisory lock `hashtextextended('user-employment/<user>', 0)`, then the users row FOR UPDATE;
--        - THE ACTOR RULE (the SQL twin of lib/admin/employment-shared.ts `employmentActRefusal`): the actor is active
--          and GM (7) or above; never oneself; the subject strictly below the actor (canActOn); below MoO (8) the
--          subject holds at least one active membership and EVERY active membership is at a shop where the actor
--          holds an active membership;
--        - THE HEAD: the person's latest event id must equal p_expected (NULL = no event yet), else 'employment_moved';
--        - THE TRANSITION: leave_start and separated from active (separated also from on_leave); leave_end only from
--          on_leave; rehired only from separated; a correction only of the event in force (the current leave or
--          separation), else 'employment_invalid_transition';
--        - THE REHIRE GATE (rehired, and a correction that loosens the rehire setting): the separation's setting
--          `yes` → the rule above; `only_with_owner_ok` → owner / MoO / CGS only ('rehire_owner_ok_required');
--          `no` → the owner only ('rehire_owner_required'). A rehire on anything but `yes` needs a note (the reason).
--        - the payload, by EXACT keys per kind ('invalid_payload' otherwise);
--        - the insert; then `users.active` follows the new status (false on leave_start / separated, true on
--          leave_end / rehired) and, on leaving active, every live session of the person is revoked IN THE SAME
--          TRANSACTION (the AGENTS.md law: an authorization change revokes sessions).
--      Returns { id, kind, status_before, status_after, sessions_revoked }. The lib (lib/admin/employment.ts) decides
--      every rule first, before any I/O, and writes the audit row (never the reason text).
--
-- PRIVACY: reason and notes are HR-sensitive. They live only in this table; the lib sends them only to owner / MoO / CGS
--   and the GM of a shop the person belongs to (lib/admin/employment-shared.ts `canSeeEmploymentDetail`); everyone else
--   gets the status chip. The audit row carries the event id and kinds, never the text.
--
-- REFUSALS (raise exception '<code>', P0001): invalid_payload · employment_forbidden · employment_outside_shop ·
--   employment_not_found · employment_moved · employment_invalid_transition · rehire_owner_ok_required ·
--   rehire_owner_required.
--
-- DEPENDS ON: users (role, active, phone), user_locations (active), sessions (user_id, revoked_at), 0228's
--   assignment_author_level (reused, never copied).
--
-- PRE-FLIGHT (MCP, before apply):
--   select to_regprocedure('public.assignment_author_level(uuid)');                             -- present
--   select to_regclass('public.user_employment_events');                                       -- NULL
--   select column_name from information_schema.columns where table_schema = 'public' and table_name = 'sessions'
--    and column_name in ('user_id', 'revoked_at');                                             -- both
--   (the preflight block below asserts all of it and refuses otherwise)
--
-- VERIFY AFTER APPLY:
--   select relrowsecurity from pg_class where oid = 'public.user_employment_events'::regclass;   -- t
--   select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public'
--    and table_name = 'user_employment_events' order by 1, 2;                                  -- service_role SELECT (+ postgres)
--   select routine_name, grantee from information_schema.routine_privileges where routine_schema = 'public'
--    and routine_name in ('record_user_employment_event', 'user_employment_json_date', 'user_employment_text') order by 1, 2;
--                                                                                               -- service_role (+ postgres) only

begin;

-- ── PRE-FLIGHT ──────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.user_employment_events') is not null
     or to_regprocedure('public.record_user_employment_event(uuid, uuid, uuid, text, jsonb)') is not null then
    raise exception '0279: already applied';
  end if;
  if to_regprocedure('public.assignment_author_level(uuid)') is null then
    raise exception '0279: assignment_author_level (0228) must be applied first';
  end if;
  if to_regclass('public.users') is null or to_regclass('public.user_locations') is null or to_regclass('public.sessions') is null then
    raise exception '0279: users, user_locations and sessions must exist';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'sessions'
       and column_name in ('user_id', 'revoked_at')) <> 2 then
    raise exception '0279: sessions.user_id and sessions.revoked_at must exist';
  end if;
end $$;

-- ── 1. THE TABLE (append-only) ──────────────────────────────────────────────────────────────────
create table public.user_employment_events (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id),
  kind             text not null check (kind in ('leave_start', 'leave_end', 'separated', 'rehired', 'correction')),
  -- the event a correction corrects (a leave_start or a separated row of the same person)
  corrects_id      uuid references public.user_employment_events(id),
  -- leave
  leave_reason     text check (leave_reason in ('school', 'seasonal', 'personal', 'other')),
  expected_back    date,
  -- separation
  separation_type  text check (separation_type in ('fired', 'quit', 'no_call_no_show', 'other')),
  last_day_worked  date,
  reason           text check (reason is null or char_length(reason) between 1 and 2000),
  rehire           text check (rehire in ('yes', 'no', 'only_with_owner_ok')),
  rehire_note      text check (rehire_note is null or char_length(rehire_note) between 1 and 1000),
  -- leave note, leave_end note, rehire reason
  note             text check (note is null or char_length(note) between 1 and 1000),
  actor_id         uuid not null references public.users(id),
  created_at       timestamptz not null default clock_timestamp(),
  constraint user_employment_events_correction check ((kind = 'correction') = (corrects_id is not null)),
  constraint user_employment_events_leave_fields check (
    (leave_reason is not null) = (kind = 'leave_start' or (kind = 'correction' and separation_type is null))
    and (expected_back is null or leave_reason is not null)),
  constraint user_employment_events_separation_fields check (
    (separation_type is not null) = (kind = 'separated' or (kind = 'correction' and leave_reason is null))
    and ((separation_type is null) = (last_day_worked is null))
    and ((separation_type is null) = (rehire is null))
    and (separation_type is null or reason is not null)
    and (rehire is null or rehire = 'yes' or rehire_note is not null)
    and (rehire is not null or rehire_note is null)
    and (separation_type is not null or reason is null))
);
create index user_employment_events_user_head on public.user_employment_events (user_id, created_at desc, id desc);
comment on table public.user_employment_events is
  '0279: on leave / separated / rehired, per person. APPEND-ONLY (a correction is a new row naming corrects_id). Written only by record_user_employment_event. Deny-all RLS; service_role SELECT only. Reason and notes are HR-sensitive: owner / MoO / CGS and the GM of a shop the person belongs to (lib/admin/employment-shared.ts).';

alter table public.user_employment_events enable row level security;
create policy user_employment_events_no_user_select on public.user_employment_events for select using (false);
create policy user_employment_events_no_user_insert on public.user_employment_events for insert with check (false);
create policy user_employment_events_no_user_update on public.user_employment_events for update using (false) with check (false);
create policy user_employment_events_no_user_delete on public.user_employment_events for delete using (false);
revoke all on public.user_employment_events from public, anon, authenticated, service_role;
grant select on public.user_employment_events to service_role;

-- ── 2. PAYLOAD HELPERS ──────────────────────────────────────────────────────────────────────────
-- A jsonb date field: absent / null → null; a 'YYYY-MM-DD' that is a real date → that date; anything else 'invalid_payload'.
create function public.user_employment_json_date(p jsonb, k text)
returns date language plpgsql immutable security definer set search_path = pg_catalog, public as $$
declare v text;
begin
  if p is null or not (p ? k) or jsonb_typeof(p -> k) = 'null' then return null; end if;
  if jsonb_typeof(p -> k) <> 'string' then raise exception 'invalid_payload'; end if;
  v := p ->> k;
  if v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'invalid_payload'; end if;
  begin
    if to_char(v::date, 'YYYY-MM-DD') <> v then raise exception 'invalid_payload'; end if;
    return v::date;
  exception when invalid_datetime_format or datetime_field_overflow then raise exception 'invalid_payload';
  end;
end $$;

-- A jsonb text field, trimmed: absent / null / blank → null; over p_max characters or not a string → 'invalid_payload'.
create function public.user_employment_text(p jsonb, k text, p_max integer)
returns text language plpgsql immutable security definer set search_path = pg_catalog, public as $$
declare v text;
begin
  if p is null or not (p ? k) or jsonb_typeof(p -> k) = 'null' then return null; end if;
  if jsonb_typeof(p -> k) <> 'string' then raise exception 'invalid_payload'; end if;
  v := btrim(p ->> k);
  if v = '' then return null; end if;
  if char_length(v) > p_max then raise exception 'invalid_payload'; end if;
  return v;
end $$;

-- ── 3. THE WRITER ───────────────────────────────────────────────────────────────────────────────
create function public.record_user_employment_event(p_actor uuid, p_user uuid, p_expected uuid, p_kind text, p_fields jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_actor_role text; v_actor_active boolean; v_actor_level integer; v_subject_level integer;
  v_head uuid; v_status_event public.user_employment_events%rowtype; v_has_status boolean;
  v_status text; v_after text; v_target public.user_employment_events%rowtype; v_current_rehire text;
  v_new_rehire text; v_allowed text[]; v_required text[]; v_key text; v_target_kind text;
  v_leave_reason text; v_expected_back date; v_sep_type text; v_last_day date; v_reason text; v_rehire text;
  v_rehire_note text; v_note text; v_id uuid; v_revoked integer := 0;
begin
  if p_actor is null or p_user is null or p_kind is null or p_fields is null or jsonb_typeof(p_fields) <> 'object'
     or p_kind not in ('leave_start', 'leave_end', 'separated', 'rehired', 'correction') then
    raise exception 'invalid_payload';
  end if;

  -- The lock BEFORE any read, then the subject row.
  perform pg_advisory_xact_lock(hashtextextended('user-employment/' || p_user::text, 0));
  perform 1 from public.users where id = p_user for update;
  if not found then raise exception 'employment_not_found'; end if;

  -- The actor rule (twin of employmentActRefusal).
  select role, active into v_actor_role, v_actor_active from public.users where id = p_actor;
  if not found or not v_actor_active then raise exception 'employment_forbidden'; end if;
  v_actor_level := coalesce(public.assignment_author_level(p_actor), 0);
  v_subject_level := coalesce(public.assignment_author_level(p_user), 0);
  if v_actor_level < 7 or p_actor = p_user or v_subject_level >= v_actor_level then raise exception 'employment_forbidden'; end if;
  if v_actor_level < 8 then
    if not exists (select 1 from public.user_locations t where t.user_id = p_user and t.active)
       or exists (select 1 from public.user_locations t where t.user_id = p_user and t.active
                   and not exists (select 1 from public.user_locations a where a.user_id = p_actor and a.active and a.location_id = t.location_id)) then
      raise exception 'employment_outside_shop';
    end if;
  end if;

  -- The head (any kind) and the status event in force.
  select id into v_head from public.user_employment_events where user_id = p_user order by created_at desc, id desc limit 1;
  if v_head is distinct from p_expected then raise exception 'employment_moved'; end if;
  select * into v_status_event from public.user_employment_events where user_id = p_user and kind <> 'correction'
   order by created_at desc, id desc limit 1;
  v_has_status := found;
  v_status := case when not v_has_status then 'active' when v_status_event.kind = 'leave_start' then 'on_leave'
                   when v_status_event.kind = 'separated' then 'separated' else 'active' end;

  -- The transition.
  if (p_kind = 'leave_start' and v_status <> 'active')
     or (p_kind = 'separated' and v_status = 'separated')
     or (p_kind = 'leave_end' and v_status <> 'on_leave')
     or (p_kind = 'rehired' and v_status <> 'separated')
     or (p_kind = 'correction' and v_status = 'active') then
    raise exception 'employment_invalid_transition';
  end if;

  -- The kind a correction corrects: the event in force, never another.
  v_target_kind := p_kind;
  if p_kind = 'correction' then
    if not (p_fields ? 'correctsId') or jsonb_typeof(p_fields -> 'correctsId') <> 'string'
       or (p_fields ->> 'correctsId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception 'invalid_payload';
    end if;
    if (p_fields ->> 'correctsId')::uuid <> v_status_event.id then raise exception 'employment_invalid_transition'; end if;
    v_target_kind := v_status_event.kind;
  end if;

  -- Exact keys per kind.
  v_allowed := case v_target_kind
    when 'leave_start' then array['leaveReason', 'expectedBack', 'note']
    when 'leave_end' then array['note']
    when 'separated' then array['separationType', 'lastDayWorked', 'reason', 'rehire', 'rehireNote']
    when 'rehired' then array['note'] end;
  v_required := case v_target_kind
    when 'leave_start' then array['leaveReason']
    when 'separated' then array['separationType', 'lastDayWorked', 'reason', 'rehire']
    else array[]::text[] end;
  if p_kind = 'correction' then v_allowed := v_allowed || array['correctsId']; end if;
  for v_key in select jsonb_object_keys(p_fields) loop
    if not (v_key = any(v_allowed)) then raise exception 'invalid_payload'; end if;
  end loop;
  foreach v_key in array v_required loop
    if not (p_fields ? v_key) or jsonb_typeof(p_fields -> v_key) = 'null' then raise exception 'invalid_payload'; end if;
  end loop;

  if v_target_kind = 'leave_start' then
    v_leave_reason := public.user_employment_text(p_fields, 'leaveReason', 20);
    if v_leave_reason is null or v_leave_reason not in ('school', 'seasonal', 'personal', 'other') then raise exception 'invalid_payload'; end if;
    v_expected_back := public.user_employment_json_date(p_fields, 'expectedBack');
    v_note := public.user_employment_text(p_fields, 'note', 1000);
  elsif v_target_kind = 'separated' then
    v_sep_type := public.user_employment_text(p_fields, 'separationType', 20);
    if v_sep_type is null or v_sep_type not in ('fired', 'quit', 'no_call_no_show', 'other') then raise exception 'invalid_payload'; end if;
    v_last_day := public.user_employment_json_date(p_fields, 'lastDayWorked');
    v_reason := public.user_employment_text(p_fields, 'reason', 2000);
    v_rehire := public.user_employment_text(p_fields, 'rehire', 20);
    v_rehire_note := public.user_employment_text(p_fields, 'rehireNote', 1000);
    if v_last_day is null or v_reason is null or v_rehire is null or v_rehire not in ('yes', 'no', 'only_with_owner_ok')
       or (v_rehire <> 'yes' and v_rehire_note is null) then
      raise exception 'invalid_payload';
    end if;
    if v_rehire = 'yes' then v_rehire_note := null; end if;
  else
    v_note := public.user_employment_text(p_fields, 'note', 1000);
  end if;

  -- The rehire gate: a rehire, or a correction that loosens the setting, needs the current setting's authority.
  if p_kind in ('rehired', 'correction') and v_status = 'separated' then
    select coalesce((select c.rehire from public.user_employment_events c where c.user_id = p_user and c.kind = 'correction'
                      and c.corrects_id = v_status_event.id order by c.created_at desc, c.id desc limit 1), v_status_event.rehire)
      into v_current_rehire;
    v_new_rehire := case when p_kind = 'rehired' then 'yes' else v_rehire end;
    if v_current_rehire = 'no' and v_new_rehire <> 'no' and v_actor_role <> 'owner' then raise exception 'rehire_owner_required'; end if;
    if v_current_rehire = 'only_with_owner_ok' and v_new_rehire = 'yes' and v_actor_role not in ('owner', 'moo', 'cgs') then
      raise exception 'rehire_owner_ok_required';
    end if;
    if p_kind = 'rehired' and v_current_rehire <> 'yes' and v_note is null then raise exception 'invalid_payload'; end if;
  end if;

  insert into public.user_employment_events (user_id, kind, corrects_id, leave_reason, expected_back, separation_type, last_day_worked,
      reason, rehire, rehire_note, note, actor_id)
    values (p_user, p_kind, case when p_kind = 'correction' then v_status_event.id else null end, v_leave_reason, v_expected_back,
      v_sep_type, v_last_day, v_reason, v_rehire, v_rehire_note, v_note, p_actor)
    returning id into v_id;

  v_after := case p_kind when 'leave_start' then 'on_leave' when 'separated' then 'separated'
                         when 'leave_end' then 'active' when 'rehired' then 'active' else v_status end;
  if v_after <> v_status then
    update public.users set active = (v_after = 'active') where id = p_user;
    if v_after <> 'active' then
      update public.sessions set revoked_at = clock_timestamp() where user_id = p_user and revoked_at is null;
      get diagnostics v_revoked = row_count;
    end if;
  end if;

  return jsonb_build_object('id', v_id, 'kind', p_kind, 'status_before', v_status, 'status_after', v_after, 'sessions_revoked', v_revoked);
end $$;

-- ── GRANTS: service_role only ───────────────────────────────────────────────────────────────────
revoke all on function public.user_employment_json_date(jsonb, text) from public, anon, authenticated;
revoke all on function public.user_employment_text(jsonb, text, integer) from public, anon, authenticated;
revoke all on function public.record_user_employment_event(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.user_employment_json_date(jsonb, text) to service_role;
grant execute on function public.user_employment_text(jsonb, text, integer) to service_role;
grant execute on function public.record_user_employment_event(uuid, uuid, uuid, text, jsonb) to service_role;

-- ── THE CEILING GUARD ───────────────────────────────────────────────────────────────────────────
do $$
declare
  p text;
  f regprocedure;
  r text;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.user_employment_events'::regclass) then
    raise exception '0279: RLS is off on user_employment_events';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_employment_events'
              and ((qual is not null and qual <> 'false') or (with_check is not null and with_check <> 'false'))) then
    raise exception '0279: user_employment_events must carry deny-all policies only';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'user_employment_events') <> 4 then
    raise exception '0279: user_employment_events must carry deny-all policies only';
  end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'user_employment_events'
              and grantee in ('PUBLIC', 'anon', 'authenticated')) then
    raise exception '0279: a PostgREST role holds a grant on user_employment_events';
  end if;
  foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('service_role', 'public.user_employment_events', p) <> (p = 'SELECT') then
      raise exception '0279: service_role % on user_employment_events is not at its ceiling (SELECT)', p;
    end if;
    foreach r in array array['anon', 'authenticated'] loop
      if has_table_privilege(r, 'public.user_employment_events', p) then
        raise exception '0279: % holds % on user_employment_events', r, p;
      end if;
    end loop;
  end loop;
  foreach f in array array[
    'public.user_employment_json_date(jsonb, text)'::regprocedure,
    'public.user_employment_text(jsonb, text, integer)'::regprocedure,
    'public.record_user_employment_event(uuid, uuid, uuid, text, jsonb)'::regprocedure] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '0279: % is executable by a PostgREST role', f;
    end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '0279: % is not executable by service_role', f;
    end if;
    if not (select prosecdef from pg_proc where oid = f) then raise exception '0279: % is not SECURITY DEFINER', f; end if;
  end loop;
end $$;

commit;
