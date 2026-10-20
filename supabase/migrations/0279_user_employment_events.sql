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
--          `no` → the owner or the CGS only ('rehire_owner_required'; Juan 2026-10-20: the CGS holds the owner's
--          authority here). A rehire on anything but `yes` needs a note (the reason).
--        - the payload, by EXACT keys per kind ('invalid_payload' otherwise);
--        - the insert; then `users.active` follows the new status (false on leave_start / separated, true on
--          leave_end / rehired) and, on leaving active, every live session of the person is revoked IN THE SAME
--          TRANSACTION (the AGENTS.md law: an authorization change revokes sessions).
--      Returns { id, kind, status_before, status_after, sessions_revoked }. The lib (lib/admin/employment.ts) decides
--      every rule first, before any I/O, and writes the audit row (never the reason text).
--   3. EVERY USER-ADMIN WRITE GOES THROUGH ONE LOCK (Astra's review of b3213674, BC-007 / BC-022 — the GM target check
--      and Activate were a check on a snapshot followed by a separate write; a separation, a promotion or a new shop
--      could commit in between). `user_admin_lock(actor, user)` is the ONE gate: the per-person advisory lock (the SAME
--      key the employment writer takes), the target users row FOR UPDATE, the actor row FOR SHARE (a change to the
--      actor's own role / shops serializes with it), then THE ACTOR RULE re-checked against that LOCKED state — the
--      actor active and GM (7) or above, never oneself, the target strictly below the actor (canActOn), and below MoO
--      (8) every active membership of the target at a shop where the actor holds an active membership
--      ('target_outside_shop'). Every writer below calls it first, MoO+ included (MoO+ semantics unchanged; their
--      role / location writes now hold the same row lock, so they serialize with a GM's):
--        admin_user_set_active(actor, user, active)        activation re-reads the employment status INSIDE the lock:
--                                                           on leave → 'use_back_from_leave', separated → 'use_rehire';
--                                                           deactivation revokes live sessions in the same transaction
--        admin_user_set_credential(actor, user, kind, hash) pin | password — the lib passes the already-computed HASH,
--                                                           never plaintext; revokes live sessions
--        admin_user_set_role(actor, user, role)            the new role strictly below the actor; revokes sessions
--        admin_user_set_locations(actor, user, shops[])     below owner (9) only the actor's own shops; a GM never
--                                                           leaves the person with none ('locations_required');
--                                                           memberships at shops the actor is not in are left alone
--        admin_user_set_dormant(actor, user, dormant, expected)  compare-and-set on dormant_at ('dormancy_changed')
--        admin_user_update_profile(actor, user, patch)     name / phone / email ('invalid_name', 'email_taken');
--                                                           an email change revokes sessions
--        admin_user_create(actor, name, role, email, phone, pin hash, password hash, shops[])  Add user in ONE transaction:
--                                                           the ACTOR row FOR SHARE and the actor rule re-checked on it
--                                                           (active, GM+, the role strictly below, below 9 only the actor's
--                                                           own shops), then the user row (hashes only, email lowercased)
--                                                           and every membership ('email_required', 'password_required')
--      THE LOCK ORDER (Astra BC-042/040): one advisory lock per call (the target's), then the two users rows in SORTED id
--      order (the lower first, each at its own strength) — so (A,B) and (B,A) queue, never deadlock. A residual 40P01 /
--      55P03 is mapped by the lib to 'user_admin_busy' (409).
--      The lib writes the audit rows after each (unchanged actions and metadata).
--
-- PRIVACY: reason and notes are HR-sensitive. They live only in this table; the lib sends them only to owner / MoO / CGS
--   and the GM of a shop the person belongs to (lib/admin/employment-shared.ts `canSeeEmploymentDetail`); everyone else
--   gets the status chip. The audit row carries the event id and kinds, never the text.
--
-- REFUSALS (raise exception '<code>', P0001): invalid_payload · forbidden · target_outside_shop · user_not_found ·
--   employment_moved · employment_invalid_transition · rehire_owner_ok_required · rehire_owner_required ·
--   use_back_from_leave · use_rehire · locations_required · dormancy_changed · invalid_name · email_taken ·
--   email_required · password_required.
--
-- ROLLOUT: apply 0279 to PROD BEFORE PR #498 merges — the lib has NO fallback for these writes (without 0279 every
--   user-admin write refuses 'user_admin_unavailable', 503).
--
-- DEPENDS ON: users (name, role, active, email, phone, pin_hash, password_hash, dormant_at, dormant_by), user_locations
--   (user_id, location_id, active, assigned_by), locations (id), sessions (user_id, revoked_at). The role levels are
--   `user_admin_role_level`, pinned equal to lib/roles.ts ROLES by tests/user-employment-events-migration.test.ts.
--
-- PRE-FLIGHT (MCP, before apply):
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
--    and routine_name like any (array['record_user_employment_event', 'user_employment_%', 'user_admin_%', 'admin_user_%']) order by 1, 2;
--                                                                                               -- service_role (+ postgres) only

begin;

-- ── PRE-FLIGHT ──────────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.user_employment_events') is not null
     or to_regprocedure('public.record_user_employment_event(uuid, uuid, uuid, text, jsonb)') is not null then
    raise exception '0279: already applied';
  end if;
  if to_regclass('public.users') is null or to_regclass('public.user_locations') is null or to_regclass('public.sessions') is null then
    raise exception '0279: users, user_locations and sessions must exist';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'sessions'
       and column_name in ('user_id', 'revoked_at')) <> 2 then
    raise exception '0279: sessions.user_id and sessions.revoked_at must exist';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'users'
       and column_name in ('name', 'role', 'active', 'email', 'phone', 'pin_hash', 'password_hash', 'dormant_at', 'dormant_by',
                           'email_verified', 'email_verified_at', 'created_by')) <> 12
     or (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'user_locations'
       and column_name in ('user_id', 'location_id', 'active', 'assigned_by')) <> 4
     or to_regclass('public.locations') is null then
    raise exception '0279: the users / user_locations / locations columns the user-admin writers use must exist';
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

-- ── 3. THE ONE GATE: the per-person lock, the locked rows, the actor rule ────────────────────────
-- The role levels (the twin of lib/roles.ts ROLES; pinned equal by the migration test).
create function public.user_admin_role_level(p_role text)
returns integer language sql immutable security definer set search_path = pg_catalog, public as $$
  select case p_role when 'cgs' then 10 when 'owner' then 9 when 'moo' then 8 when 'gm' then 7 when 'agm' then 6
    when 'catering_mgr' then 6 when 'prep_mgr' then 6 when 'social_media_mgr' then 6 when 'shift_lead' then 5
    when 'key_holder' then 4 when 'trainer' then 4 when 'employee' then 3 when 'trainee' then 2
    when 'hired_not_yet_worked' then 1 when 'prospect' then 0 else null end
$$;

-- Every user-admin writer calls this FIRST. The advisory key is the employment writer's, so an activation, a separation,
-- a credential reset, a promotion or a shop change of one person run one at a time; the target row is locked FOR UPDATE
-- (a MoO's promotion or new shop for the same person waits, or has committed and is SEEN here), the actor row FOR SHARE
-- (a change to the actor's own role or shops waits, or is seen). The actor rule is the twin of lib/admin/
-- user-access-shared.ts `userAdminRefusal`, judged on the LOCKED state.
create function public.user_admin_lock(p_actor uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_target_role text; v_target_active boolean; v_actor_role text; v_actor_active boolean; v_actor_level integer; v_target_level integer;
  v_target_found boolean; v_actor_found boolean;
begin
  if p_actor is null or p_user is null then raise exception 'invalid_payload'; end if;
  if p_actor = p_user then raise exception 'forbidden'; end if;
  -- ONE advisory lock per call (the target's), so two calls never wait on each other's advisory locks in opposite order.
  perform pg_advisory_xact_lock(hashtextextended('user-employment/' || p_user::text, 0));
  -- THE ROW LOCKS IN SORTED ID ORDER, by construction (Astra BC-042/040): (A,B) and (B,A) take the lower id's row first,
  -- so they queue instead of deadlocking (40P01). Each row at its own strength: the target FOR UPDATE, the actor FOR SHARE.
  if p_actor < p_user then
    select role, active into v_actor_role, v_actor_active from public.users where id = p_actor for share;
    v_actor_found := found;
    select role, active into v_target_role, v_target_active from public.users where id = p_user for update;
    v_target_found := found;
  else
    select role, active into v_target_role, v_target_active from public.users where id = p_user for update;
    v_target_found := found;
    select role, active into v_actor_role, v_actor_active from public.users where id = p_actor for share;
    v_actor_found := found;
  end if;
  -- Then the checks, on the locked rows.
  if not v_target_found then raise exception 'user_not_found'; end if;
  if not v_actor_found or not v_actor_active then raise exception 'forbidden'; end if;
  v_actor_level := coalesce(public.user_admin_role_level(v_actor_role), 0);
  v_target_level := coalesce(public.user_admin_role_level(v_target_role), 0);
  if v_actor_level < 7 or v_target_level >= v_actor_level then raise exception 'forbidden'; end if;
  if v_actor_level < 8 then
    if not exists (select 1 from public.user_locations t where t.user_id = p_user and t.active)
       or exists (select 1 from public.user_locations t where t.user_id = p_user and t.active
                   and not exists (select 1 from public.user_locations a where a.user_id = p_actor and a.active and a.location_id = t.location_id)) then
      raise exception 'target_outside_shop';
    end if;
  end if;
  return jsonb_build_object('actor_role', v_actor_role, 'actor_level', v_actor_level, 'target_role', v_target_role,
    'target_level', v_target_level, 'target_active', v_target_active);
end $$;

-- The employment status in force (twin of employmentStateOf's status): the latest non-correction event.
create function public.user_employment_status(p_user uuid)
returns text language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((select case e.kind when 'leave_start' then 'on_leave' when 'separated' then 'separated' else 'active' end
    from public.user_employment_events e where e.user_id = p_user and e.kind <> 'correction' order by e.created_at desc, e.id desc limit 1), 'active')
$$;

-- ── 4. THE EMPLOYMENT WRITER ───────────────────────────────────────────────────────────────────
create function public.record_user_employment_event(p_actor uuid, p_user uuid, p_expected uuid, p_kind text, p_fields jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_ctx jsonb; v_actor_role text;
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

  -- The one gate (the lock BEFORE any read, the locked rows, the actor rule on the locked state).
  v_ctx := public.user_admin_lock(p_actor, p_user);
  v_actor_role := v_ctx ->> 'actor_role';

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
    if v_current_rehire = 'no' and v_new_rehire <> 'no' and v_actor_role not in ('owner', 'cgs') then raise exception 'rehire_owner_required'; end if;
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

-- ── 5. THE USER-ADMIN WRITERS (each: the gate first, then its write, all in one transaction) ─────────
create function public.admin_user_set_active(p_actor uuid, p_user uuid, p_active boolean)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_ctx jsonb; v_status text; v_revoked integer := 0;
begin
  if p_active is null then raise exception 'invalid_payload'; end if;
  v_ctx := public.user_admin_lock(p_actor, p_user);
  if p_active then
    -- Re-read INSIDE the lock: a separation that committed after the screen loaded is seen here.
    v_status := public.user_employment_status(p_user);
    if v_status = 'on_leave' then raise exception 'use_back_from_leave'; end if;
    if v_status = 'separated' then raise exception 'use_rehire'; end if;
  end if;
  update public.users set active = p_active where id = p_user;
  if not p_active then
    update public.sessions set revoked_at = clock_timestamp() where user_id = p_user and revoked_at is null;
    get diagnostics v_revoked = row_count;
  end if;
  return jsonb_build_object('active', p_active, 'was_active', (v_ctx ->> 'target_active')::boolean, 'sessions_revoked', v_revoked);
end $$;

create function public.admin_user_set_credential(p_actor uuid, p_user uuid, p_kind text, p_hash text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_revoked integer := 0;
begin
  if p_kind is null or p_kind not in ('pin', 'password') or p_hash is null or char_length(p_hash) not between 20 and 255 then
    raise exception 'invalid_payload';
  end if;
  perform public.user_admin_lock(p_actor, p_user);
  if p_kind = 'pin' then update public.users set pin_hash = p_hash where id = p_user;
  else update public.users set password_hash = p_hash where id = p_user; end if;
  update public.sessions set revoked_at = clock_timestamp() where user_id = p_user and revoked_at is null;
  get diagnostics v_revoked = row_count;
  return jsonb_build_object('kind', p_kind, 'sessions_revoked', v_revoked);
end $$;

create function public.admin_user_set_role(p_actor uuid, p_user uuid, p_role text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_ctx jsonb; v_revoked integer := 0;
begin
  if public.user_admin_role_level(p_role) is null then raise exception 'invalid_payload'; end if;
  v_ctx := public.user_admin_lock(p_actor, p_user);
  if public.user_admin_role_level(p_role) >= (v_ctx ->> 'actor_level')::integer then raise exception 'forbidden'; end if;
  if p_role = v_ctx ->> 'target_role' then
    return jsonb_build_object('changed', false, 'from_role', v_ctx ->> 'target_role', 'to_role', p_role, 'sessions_revoked', 0);
  end if;
  update public.users set role = p_role where id = p_user;
  update public.sessions set revoked_at = clock_timestamp() where user_id = p_user and revoked_at is null;
  get diagnostics v_revoked = row_count;
  return jsonb_build_object('changed', true, 'from_role', v_ctx ->> 'target_role', 'to_role', p_role, 'sessions_revoked', v_revoked);
end $$;

create function public.admin_user_set_locations(p_actor uuid, p_user uuid, p_locations uuid[])
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_ctx jsonb; v_level integer; v_desired uuid[]; v_mine uuid[]; v_loc uuid; v_revoked integer := 0;
begin
  if p_locations is null or array_position(p_locations, null) is not null then raise exception 'invalid_payload'; end if;
  v_ctx := public.user_admin_lock(p_actor, p_user);
  v_level := (v_ctx ->> 'actor_level')::integer;
  v_desired := array(select distinct x from unnest(p_locations) x order by x);
  if exists (select 1 from unnest(v_desired) x where not exists (select 1 from public.locations l where l.id = x)) then raise exception 'invalid_payload'; end if;
  select coalesce(array_agg(location_id), '{}'::uuid[]) into v_mine from public.user_locations where user_id = p_actor and active;
  -- Below the all-shops level (9) only the actor's own shops; a GM never leaves the person with none.
  if v_level < 9 and not (v_desired <@ v_mine) then raise exception 'forbidden'; end if;
  if v_level < 8 and cardinality(v_desired) = 0 then raise exception 'locations_required'; end if;
  foreach v_loc in array v_desired loop
    if not exists (select 1 from public.user_locations where user_id = p_user and location_id = v_loc) then
      insert into public.user_locations (user_id, location_id, assigned_by, active) values (p_user, v_loc, p_actor, true);
    elsif exists (select 1 from public.user_locations where user_id = p_user and location_id = v_loc and not active) then
      update public.user_locations set active = true, assigned_by = p_actor where user_id = p_user and location_id = v_loc;
    end if;
  end loop;
  -- A membership at a shop the actor is not in (below 9) is left alone.
  update public.user_locations set active = false
   where user_id = p_user and active and not (location_id = any (v_desired)) and (v_level >= 9 or location_id = any (v_mine));
  update public.sessions set revoked_at = clock_timestamp() where user_id = p_user and revoked_at is null;
  get diagnostics v_revoked = row_count;
  return jsonb_build_object('locations', to_jsonb(v_desired), 'sessions_revoked', v_revoked);
end $$;

create function public.admin_user_set_dormant(p_actor uuid, p_user uuid, p_dormant boolean, p_expected timestamptz)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_cur timestamptz; v_active boolean; v_at timestamptz;
begin
  if p_dormant is null then raise exception 'invalid_payload'; end if;
  perform public.user_admin_lock(p_actor, p_user);
  select dormant_at, active into v_cur, v_active from public.users where id = p_user;
  -- Compare-and-set on the marker the screen saw: two taps never both write.
  if v_cur is distinct from p_expected then raise exception 'dormancy_changed'; end if;
  if p_dormant and not v_active then return jsonb_build_object('changed', false, 'dormant_at', v_cur); end if;
  v_at := case when p_dormant then clock_timestamp() else null end;
  update public.users set dormant_at = v_at, dormant_by = case when p_dormant then p_actor else null end where id = p_user;
  return jsonb_build_object('changed', true, 'dormant_at', v_at);
end $$;

create function public.admin_user_update_profile(p_actor uuid, p_user uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_key text; v_name text; v_phone text; v_email text; v_old_email text; v_fields text[] := '{}'; v_revoked integer := 0;
  v_email_changed boolean := false;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'invalid_payload'; end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('name', 'phone', 'email') then raise exception 'invalid_payload'; end if;
    if jsonb_typeof(p_patch -> v_key) not in ('string', 'null') then raise exception 'invalid_payload'; end if;
  end loop;
  perform public.user_admin_lock(p_actor, p_user);
  select email into v_old_email from public.users where id = p_user;
  if p_patch ? 'name' then
    v_name := btrim(coalesce(p_patch ->> 'name', ''));
    if v_name = '' then raise exception 'invalid_name'; end if;
    update public.users set name = v_name where id = p_user;
    v_fields := array_append(v_fields, 'name');
  end if;
  if p_patch ? 'phone' then
    v_phone := nullif(btrim(coalesce(p_patch ->> 'phone', '')), '');
    if char_length(v_phone) > 40 then raise exception 'invalid_payload'; end if;
    update public.users set phone = v_phone where id = p_user;
    v_fields := array_append(v_fields, 'phone');
  end if;
  if p_patch ? 'email' then
    v_email := nullif(lower(btrim(coalesce(p_patch ->> 'email', ''))), '');
    if v_email is not null and exists (select 1 from public.users where lower(email) = v_email and id <> p_user) then
      raise exception 'email_taken';
    end if;
    update public.users set email = v_email where id = p_user;
    v_fields := array_append(v_fields, 'email');
    v_email_changed := v_email is distinct from v_old_email;
  end if;
  if v_email_changed then
    update public.sessions set revoked_at = clock_timestamp() where user_id = p_user and revoked_at is null;
    get diagnostics v_revoked = row_count;
  end if;
  return jsonb_build_object('fields', to_jsonb(v_fields), 'email_changed', v_email_changed, 'sessions_revoked', v_revoked);
end $$;

-- ── 6. THE CREATION WRITER (Astra's review of c649ed52, BC-007/004) ─────────────────────────────
-- Add user had no target to lock: the lib checked the actor's role and shops, hashed the credentials (slow), then inserted
-- the user and, separately, the memberships — a demotion, a deactivation or a shop removal of the ACTOR committed in
-- between still produced an active account with known credentials at the former shop. Now ONE transaction: the actor row
-- FOR SHARE (a MoO's role / shop / employment write on the actor locks it FOR UPDATE, so it waits for this create or is
-- seen by it), the actor rule re-checked on it — active, GM or above, the new role strictly below the actor, and below the
-- all-shops level (9) every requested shop among the actor's active shops — then the user row (the HASHES, never
-- plaintext; the email lowercased per the law) and every membership.
create function public.admin_user_create(p_actor uuid, p_name text, p_role text, p_email text, p_phone text, p_pin_hash text,
  p_password_hash text, p_locations uuid[])
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor_role text; v_actor_active boolean; v_actor_level integer; v_role_level integer; v_name text; v_email text; v_phone text;
  v_desired uuid[] := '{}'::uuid[]; v_mine uuid[]; v_id uuid; v_email_auth boolean;
begin
  if p_actor is null or p_role is null or p_locations is null or array_position(p_locations, null) is not null then raise exception 'invalid_payload'; end if;
  v_role_level := public.user_admin_role_level(p_role);
  if v_role_level is null then raise exception 'invalid_payload'; end if;
  if p_pin_hash is null or char_length(p_pin_hash) not between 20 and 255
     or (p_password_hash is not null and char_length(p_password_hash) not between 20 and 255) then
    raise exception 'invalid_payload';
  end if;
  select role, active into v_actor_role, v_actor_active from public.users where id = p_actor for share;
  if not found or not v_actor_active then raise exception 'forbidden'; end if;
  v_actor_level := coalesce(public.user_admin_role_level(v_actor_role), 0);
  if v_actor_level < 7 or v_role_level >= v_actor_level then raise exception 'forbidden'; end if;
  v_name := btrim(coalesce(p_name, ''));
  if v_name = '' then raise exception 'invalid_name'; end if;
  v_email := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone := nullif(btrim(coalesce(p_phone, '')), '');
  if char_length(v_phone) > 40 then raise exception 'invalid_payload'; end if;
  -- The email-auth roles (level 6 and up, lib/roles.ts hasEmailAuth) sign in with an email and a password.
  v_email_auth := v_role_level >= 6;
  if v_email_auth and v_email is null then raise exception 'email_required'; end if;
  if v_email_auth and p_password_hash is null then raise exception 'password_required'; end if;
  if not v_email_auth and p_password_hash is not null then raise exception 'invalid_payload'; end if;
  if v_email is not null and exists (select 1 from public.users where lower(email) = v_email) then raise exception 'email_taken'; end if;
  if v_role_level < 9 then
    v_desired := array(select distinct x from unnest(p_locations) x order by x);
    if cardinality(v_desired) = 0 then raise exception 'locations_required'; end if;
    if exists (select 1 from unnest(v_desired) x where not exists (select 1 from public.locations l where l.id = x)) then raise exception 'invalid_payload'; end if;
    if v_actor_level < 9 then
      select coalesce(array_agg(location_id), '{}'::uuid[]) into v_mine from public.user_locations where user_id = p_actor and active;
      if not (v_desired <@ v_mine) then raise exception 'forbidden'; end if;
    end if;
  end if;
  insert into public.users (name, email, role, active, email_verified, email_verified_at, pin_hash, password_hash, phone, created_by)
    values (v_name, v_email, p_role, true, v_email_auth, case when v_email_auth then clock_timestamp() else null end, p_pin_hash,
      p_password_hash, v_phone, p_actor)
    returning id into v_id;
  insert into public.user_locations (user_id, location_id, assigned_by, active)
    select v_id, x, p_actor, true from unnest(v_desired) x;
  return jsonb_build_object('id', v_id, 'role', p_role, 'locations', to_jsonb(v_desired));
end $$;

-- ── GRANTS: service_role only ───────────────────────────────────────────────────────────────────
revoke all on function public.user_employment_json_date(jsonb, text) from public, anon, authenticated;
revoke all on function public.user_employment_text(jsonb, text, integer) from public, anon, authenticated;
revoke all on function public.user_admin_role_level(text) from public, anon, authenticated;
revoke all on function public.user_admin_lock(uuid, uuid) from public, anon, authenticated;
revoke all on function public.user_employment_status(uuid) from public, anon, authenticated;
revoke all on function public.record_user_employment_event(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.admin_user_set_active(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.admin_user_set_credential(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_user_set_role(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_user_set_locations(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.admin_user_set_dormant(uuid, uuid, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.admin_user_update_profile(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.admin_user_create(uuid, text, text, text, text, text, text, uuid[]) from public, anon, authenticated;
grant execute on function public.user_employment_json_date(jsonb, text) to service_role;
grant execute on function public.user_employment_text(jsonb, text, integer) to service_role;
grant execute on function public.user_admin_role_level(text) to service_role;
grant execute on function public.user_admin_lock(uuid, uuid) to service_role;
grant execute on function public.user_employment_status(uuid) to service_role;
grant execute on function public.record_user_employment_event(uuid, uuid, uuid, text, jsonb) to service_role;
grant execute on function public.admin_user_set_active(uuid, uuid, boolean) to service_role;
grant execute on function public.admin_user_set_credential(uuid, uuid, text, text) to service_role;
grant execute on function public.admin_user_set_role(uuid, uuid, text) to service_role;
grant execute on function public.admin_user_set_locations(uuid, uuid, uuid[]) to service_role;
grant execute on function public.admin_user_set_dormant(uuid, uuid, boolean, timestamptz) to service_role;
grant execute on function public.admin_user_update_profile(uuid, uuid, jsonb) to service_role;
grant execute on function public.admin_user_create(uuid, text, text, text, text, text, text, uuid[]) to service_role;

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
    'public.user_admin_role_level(text)'::regprocedure,
    'public.user_admin_lock(uuid, uuid)'::regprocedure,
    'public.user_employment_status(uuid)'::regprocedure,
    'public.record_user_employment_event(uuid, uuid, uuid, text, jsonb)'::regprocedure,
    'public.admin_user_set_active(uuid, uuid, boolean)'::regprocedure,
    'public.admin_user_set_credential(uuid, uuid, text, text)'::regprocedure,
    'public.admin_user_set_role(uuid, uuid, text)'::regprocedure,
    'public.admin_user_set_locations(uuid, uuid, uuid[])'::regprocedure,
    'public.admin_user_set_dormant(uuid, uuid, boolean, timestamptz)'::regprocedure,
    'public.admin_user_update_profile(uuid, uuid, jsonb)'::regprocedure,
    'public.admin_user_create(uuid, text, text, text, text, text, text, uuid[])'::regprocedure] loop
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
