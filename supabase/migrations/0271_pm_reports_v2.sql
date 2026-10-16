-- Migration 0271_pm_reports_v2
-- AUTHORED 2026-10-15. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word, AFTER 0270; REQUIRES 0267).
-- Provenance: Smart Scheduling Phase 1, Task 18 (docs/superpowers/plans/2026-10-15-scheduling-phase1-BUILD.md),
--   r1 P1-1 (every grade bound to a valid ACTIVE position at the report's shop that the subject worked or
--   THIS copy added — composite FKs + the RPC), r1 P2-9 / J16 (ONE copy lifecycle: open → done → reopen →
--   sealed; a done copy is read-only), R9 (managers' free text stays with managers), R10 (criteria are DATA,
--   edited behind Tier E by the lib), the no-notification house rule.
--
-- WHAT:
--   1. pm_reports.format ('v1' | 'v2', default 'v1'): stamped when the day row is created, FROZEN after
--      (trigger pm_reports_format_frozen), so a switch flipped mid-day never converts a day. v1 days behave
--      exactly as today; v2 days reuse the same day row, its status flip, its MVP and its finalization.
--   2. pm_criteria: per shop, per position (NULL = every position at the shop), en + es labels, sort,
--      active. Config: deactivate, never delete. One ACTIVE label per (shop, position). The CONFIRMED list
--      (Juan 2026-10-15) is seeded as DATA by scripts/seed-pm-criteria.ts on Juan's word, never here.
--   3. pm_report_copies: one per manager per v2 day; status open → done → sealed. Blind until submit (the
--      LIB decides every read; the database is deny-all).
--   4. pm_copy_grades, pm_copy_notes, pm_copy_positions: append-only with supersede (one live row per key,
--      history kept). Each carries location_id with COMPOSITE FKs proving the copy, the criterion and the
--      position all belong to the report's shop.
--   5. The writer RPCs (the ONLY writers of 3 and 4): open_pm_copy, save_pm_copy_grade, save_pm_copy_note,
--      add_pm_copy_position, set_pm_copy_window, mark_pm_copy_done, reopen_pm_copy, submit_pm_day_v2.
--      Each locks THE DAY ROW FIRST, then the copy (one order everywhere: no deadlock). Submit is ONE
--      guarded open → submitted flip that seals every copy; a losing submit is {changed:false}. NOTHING here
--      enqueues a notification or writes outside these tables.
--
-- THE LIFECYCLE (the SQL twin of PM_COPY_TRANSITIONS, lib/people/access-shared.ts, pinned by the shared case
--   file tests/fixtures/pm-copy-lifecycle-cases.json): write / markDone need `open`; reopen needs `done`
--   (author, day open); only submit seals (`open` and `done` alike).
--
-- REFUSALS (raise exception '<code>', P0001), in order for a grade: forbidden (not a KH+ member of the shop,
--   or the social media manager) · not_copy_author · report_already_submitted · copy_done / copy_sealed ·
--   subject_unavailable · position_not_at_shop (another shop's position OR no position at all) ·
--   position_retired · position_not_worked · criterion_mismatch. Also: invalid_payload · not_found ·
--   format_mismatch · copy_not_done · window_required · invalid_window · invalid_note · invalid_reason ·
--   format_frozen. The pure twin `gradeTargetProblem` (lib/pm-report-v2-shared.ts) is pinned to the SAME codes
--   by tests/fixtures/pm-grade-target-cases.json.
--
-- GRANTS: pm_criteria SELECT/INSERT/UPDATE for service_role (the lib writes it, audited); copies, grades,
--   notes, positions SELECT only (the RPCs are the only writers). RLS on, NO policies, nothing for PostgREST.
--   The pm_reports / pm_employee_evals grants are UNCHANGED (asserted against 0267's literal manifest).
--
-- DEPENDS ON: 0267_pm_evals_privacy (the first statement refuses without its posture), 0270 (the
--   station_positions (id, location_id) index and people_position_at_shop), 0217 assignment_user_level,
--   0217/0219 station_events.position_id.
--
-- PRE-FLIGHT (MCP, before apply):
--   select policyname, cmd from pg_policies where schemaname = 'public' and tablename in ('pm_reports','pm_employee_evals');
--     -- only the four no_user_update / no_user_delete policies (0267)
--   select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public'
--    and table_name in ('pm_reports','pm_employee_evals') order by 1, 2;      -- service_role INSERT/SELECT/UPDATE (+ owner)
--   select to_regclass('public.station_positions_id_location'), to_regprocedure('public.people_position_at_shop(uuid,uuid)');
--   select count(*) from pm_reports;                                           -- every existing row becomes format 'v1'
--   (the preflight blocks below assert all of it and refuse otherwise)
--
-- VERIFY AFTER APPLY:
--   select format, count(*) from pm_reports group by 1;                        -- v1 only
--   select relname, relrowsecurity from pg_class where relname like 'pm\_c%' or relname = 'pm_report_copies';   -- t
--   select table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public'
--    and table_name in ('pm_criteria','pm_report_copies','pm_copy_grades','pm_copy_notes','pm_copy_positions') order by 1, 2;
--   select routine_name, grantee from information_schema.routine_privileges where routine_schema = 'public'
--    and routine_name like '%pm_%copy%' order by 1, 2;                         -- service_role (+ postgres) only

begin;

-- ── PRE-FLIGHT 1: 0267's posture. THE FIRST STATEMENT: no 0271 object exists unless 0267 is applied. ──
do $$
declare t text;
begin
  if to_regclass('public.pm_reports') is null or to_regclass('public.pm_employee_evals') is null then
    raise exception '0271: requires 0267_pm_evals_privacy';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('pm_reports', 'pm_employee_evals')
              and (policyname = 'pm_evals_read_self' or cmd in ('SELECT', 'INSERT', 'ALL'))) then
    raise exception '0271: requires 0267_pm_evals_privacy';
  end if;
  foreach t in array array['pm_reports', 'pm_employee_evals'] loop
    if has_any_column_privilege('anon', 'public.' || t, 'SELECT, INSERT, UPDATE, REFERENCES')
       or has_any_column_privilege('authenticated', 'public.' || t, 'SELECT, INSERT, UPDATE, REFERENCES')
       or has_table_privilege('anon', 'public.' || t, 'DELETE, TRUNCATE, TRIGGER')
       or has_table_privilege('authenticated', 'public.' || t, 'DELETE, TRUNCATE, TRIGGER')
       or not has_table_privilege('service_role', 'public.' || t, 'SELECT')
       or not has_table_privilege('service_role', 'public.' || t, 'INSERT')
       or not has_table_privilege('service_role', 'public.' || t, 'UPDATE')
       or has_table_privilege('service_role', 'public.' || t, 'DELETE, TRUNCATE, REFERENCES, TRIGGER') then
      raise exception '0271: requires 0267_pm_evals_privacy';
    end if;
  end loop;
end $$;

-- ── PRE-FLIGHT 2: 0270, the helpers, the station events, and nothing of 0271 yet ──
do $$
begin
  if to_regclass('public.station_positions_id_location') is null
     or to_regprocedure('public.people_position_at_shop(uuid,uuid)') is null then
    raise exception '0271: requires 0270 (station_positions_id_location, people_position_at_shop)';
  end if;
  if to_regprocedure('public.assignment_user_level(uuid,uuid)') is null then
    raise exception '0271: requires the 0217 assignment_user_level helper';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'station_events'
        and column_name in ('location_id', 'business_date', 'user_id', 'position_id')) <> 4 then
    raise exception '0271: requires station_events with position_id (0217 / 0219)';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pm_reports' and column_name = 'format')
     or to_regclass('public.pm_criteria') is not null or to_regclass('public.pm_report_copies') is not null
     or to_regclass('public.pm_copy_grades') is not null or to_regclass('public.pm_copy_notes') is not null
     or to_regclass('public.pm_copy_positions') is not null then
    raise exception '0271: already applied';
  end if;
end $$;

-- ── 1. the day row's format, frozen once set ─────────────────────────────────────────────────────
alter table public.pm_reports add column format text not null default 'v1'
  constraint pm_reports_format_check check (format in ('v1', 'v2'));
-- Additive: `id` is the primary key, so this cannot fail; the composite FK from copies needs an exact key.
create unique index if not exists pm_reports_id_location on public.pm_reports (id, location_id);

create function public.pm_reports_format_frozen() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.format is distinct from old.format then raise exception 'format_frozen'; end if;
  return new;
end $$;
create trigger pm_reports_format_frozen before update of format on public.pm_reports
  for each row execute function public.pm_reports_format_frozen();

-- ── 2. criteria (DATA; deactivate, never delete) ────────────────────────────────────────────────
create table public.pm_criteria (
  id          uuid        primary key default gen_random_uuid(),
  location_id uuid        not null references public.locations(id),
  position_id uuid,                                    -- NULL = every position at this shop (shared)
  label       text        not null,
  label_es    text,
  sort        smallint    not null default 100,
  active      boolean     not null default true,
  created_by  uuid        not null references public.users(id),
  created_at  timestamptz not null default clock_timestamp(),
  updated_by  uuid        references public.users(id),
  updated_at  timestamptz,
  constraint pm_criteria_label check (char_length(btrim(label)) between 1 and 80),
  constraint pm_criteria_label_es check (label_es is null or char_length(btrim(label_es)) between 1 and 80),
  constraint pm_criteria_position_at_shop foreign key (position_id, location_id) references public.station_positions (id, location_id),
  constraint pm_criteria_id_location unique (id, location_id)
);
create unique index pm_criteria_one_active_label on public.pm_criteria
  (location_id, coalesce(position_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(label))) where active;
create index pm_criteria_shop on public.pm_criteria (location_id, active, sort);
comment on table public.pm_criteria is
  '0271: PM v2 criteria per shop and position (NULL position = every position). DATA, never code: seeded once per shop from the list Juan confirmed 2026-10-15, then edited in the Tier E editor (lib/pm-criteria.ts, audited). Deactivate, never delete. Deny-all RLS.';

-- ── 3. copies ───────────────────────────────────────────────────────────────────────────────────
create table public.pm_report_copies (
  id            uuid        primary key default gen_random_uuid(),
  pm_report_id  uuid        not null,
  location_id   uuid        not null references public.locations(id),
  author_id     uuid        not null references public.users(id),
  status        text        not null default 'open',
  observed_from timestamptz,
  observed_to   timestamptz,
  created_at    timestamptz not null default clock_timestamp(),
  sealed_at     timestamptz,
  constraint pm_report_copies_report_at_shop foreign key (pm_report_id, location_id) references public.pm_reports (id, location_id),
  constraint pm_report_copies_id_location unique (id, location_id),
  constraint pm_report_copies_one_per_author unique (pm_report_id, author_id),
  constraint pm_report_copies_status check (status in ('open', 'done', 'sealed')),
  constraint pm_report_copies_sealed check ((status = 'sealed') = (sealed_at is not null)),
  constraint pm_report_copies_window check (observed_to is null or observed_from is null or observed_to > observed_from)
);
create index pm_report_copies_author on public.pm_report_copies (author_id, created_at desc);
comment on table public.pm_report_copies is
  '0271: one PM v2 copy per manager per day. open → done → (reopen) → sealed at submit. Private to its author until the closing manager submits (decided by the lib). Written only by the 0271 RPCs. Deny-all RLS.';

-- ── 4. grades, notes, added positions (append-only with supersede; shop proven by composite FKs) ─
create table public.pm_copy_grades (
  id           uuid        primary key default gen_random_uuid(),
  copy_id      uuid        not null,
  location_id  uuid        not null,                    -- the copy's shop, PROVEN by the FKs below
  subject_id   uuid        not null references public.users(id),
  position_id  uuid,                                    -- NULL = no position recorded (shared criteria only)
  criterion_id uuid        not null,
  grade        text,                                    -- NULL = "Didn't see" (an explicit answer)
  created_at   timestamptz not null default clock_timestamp(),
  superseded_at timestamptz,
  constraint pm_copy_grades_grade check (grade is null or grade in ('great', 'good', 'needs_work')),
  constraint pm_copy_grades_copy_at_shop foreign key (copy_id, location_id) references public.pm_report_copies (id, location_id),
  constraint pm_copy_grades_criterion_at_shop foreign key (criterion_id, location_id) references public.pm_criteria (id, location_id),
  constraint pm_copy_grades_position_at_shop foreign key (position_id, location_id) references public.station_positions (id, location_id)
);
create unique index pm_copy_grades_one_live on public.pm_copy_grades
  (copy_id, subject_id, coalesce(position_id, '00000000-0000-0000-0000-000000000000'::uuid), criterion_id)
  where superseded_at is null;
create index pm_copy_grades_subject on public.pm_copy_grades (subject_id) where superseded_at is null;

create table public.pm_copy_notes (
  id            uuid        primary key default gen_random_uuid(),
  copy_id       uuid        not null,
  location_id   uuid        not null,
  subject_id    uuid        not null references public.users(id),
  position_id   uuid,
  note          text        not null,
  created_at    timestamptz not null default clock_timestamp(),
  superseded_at timestamptz,
  constraint pm_copy_notes_note check (char_length(btrim(note)) between 1 and 500),
  constraint pm_copy_notes_copy_at_shop foreign key (copy_id, location_id) references public.pm_report_copies (id, location_id),
  constraint pm_copy_notes_position_at_shop foreign key (position_id, location_id) references public.station_positions (id, location_id)
);
create unique index pm_copy_notes_one_live on public.pm_copy_notes
  (copy_id, subject_id, coalesce(position_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where superseded_at is null;
create index pm_copy_notes_subject on public.pm_copy_notes (subject_id, location_id) where superseded_at is null;

create table public.pm_copy_positions (
  id            uuid        primary key default gen_random_uuid(),
  copy_id       uuid        not null,
  location_id   uuid        not null,
  subject_id    uuid        not null references public.users(id),
  position_id   uuid        not null,
  reason        text        not null,
  created_at    timestamptz not null default clock_timestamp(),
  superseded_at timestamptz,
  constraint pm_copy_positions_reason check (char_length(btrim(reason)) between 1 and 200),
  constraint pm_copy_positions_copy_at_shop foreign key (copy_id, location_id) references public.pm_report_copies (id, location_id),
  constraint pm_copy_positions_position_at_shop foreign key (position_id, location_id) references public.station_positions (id, location_id)
);
create unique index pm_copy_positions_one_live on public.pm_copy_positions (copy_id, subject_id, position_id)
  where superseded_at is null;

alter table public.pm_criteria enable row level security;
alter table public.pm_report_copies enable row level security;
alter table public.pm_copy_grades enable row level security;
alter table public.pm_copy_notes enable row level security;
alter table public.pm_copy_positions enable row level security;
revoke all on public.pm_criteria, public.pm_report_copies, public.pm_copy_grades, public.pm_copy_notes, public.pm_copy_positions
  from public, anon, authenticated, service_role;
grant select, insert, update on public.pm_criteria to service_role;
grant select on public.pm_report_copies, public.pm_copy_grades, public.pm_copy_notes, public.pm_copy_positions to service_role;

-- ── 5. the internal helpers (callable only from inside the RPCs) ────────────────────────────────

-- The actor may act on PM v2 at this shop: an active member (0217's rule; level 9+ needs no membership) at
-- key holder (4) or above, and never the social media manager. The pm_report task access is the lib's half.
create function public.pm_v2_actor_ok(p_actor uuid, p_location uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_level integer; v_role text;
begin
  if p_actor is null or p_location is null then raise exception 'forbidden'; end if;
  begin
    v_level := public.assignment_user_level(p_actor, p_location);
  exception when raise_exception then
    raise exception 'forbidden';
  end;
  select role into v_role from public.users where id = p_actor;
  if v_level < 4 or v_role = 'social_media_mgr' then raise exception 'forbidden'; end if;
end $$;

-- The subject is an active member of the shop (0217's rule).
create function public.pm_v2_subject_ok(p_subject uuid, p_location uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if p_subject is null then raise exception 'invalid_payload'; end if;
  begin
    perform public.assignment_user_level(p_subject, p_location);
  exception when raise_exception then
    raise exception 'subject_unavailable';
  end;
end $$;

-- Lock the DAY ROW FIRST, then the copy, and apply the ONE lifecycle for `p_act` (write | markDone | reopen):
-- format → who (forbidden) → author → day open → the copy's state. Returns the locked copy.
create function public.pm_copy_lock(p_actor uuid, p_copy uuid, p_act text) returns public.pm_report_copies
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_report uuid; v_day public.pm_reports%rowtype; v_copy public.pm_report_copies%rowtype;
begin
  if p_actor is null or p_copy is null then raise exception 'invalid_payload'; end if;
  select pm_report_id into v_report from public.pm_report_copies where id = p_copy;
  if not found then raise exception 'not_found'; end if;
  select * into v_day from public.pm_reports where id = v_report for update;
  select * into v_copy from public.pm_report_copies where id = p_copy for update;
  if v_day.format <> 'v2' then raise exception 'format_mismatch'; end if;
  perform public.pm_v2_actor_ok(p_actor, v_copy.location_id);
  if v_copy.author_id <> p_actor then raise exception 'not_copy_author'; end if;
  if v_day.status <> 'open' or v_day.superseded_at is not null then raise exception 'report_already_submitted'; end if;
  if p_act in ('write', 'markDone') then
    if v_copy.status = 'done' then raise exception 'copy_done'; end if;
    if v_copy.status = 'sealed' then raise exception 'copy_sealed'; end if;
  elsif p_act = 'reopen' then
    if v_copy.status = 'sealed' then raise exception 'copy_sealed'; end if;
    if v_copy.status = 'open' then raise exception 'copy_not_done'; end if;
  else
    raise exception 'invalid_payload';
  end if;
  return v_copy;
end $$;

-- r1 P1-1: did the subject work this position on the copy's day at the copy's shop? EITHER a station event
-- (assigned or claimed) at that position that business day, OR a live row of THIS copy adding it. Another
-- manager's addition never opens it for this copy (J12).
create function public.pm_subject_worked_position(p_copy uuid, p_subject uuid, p_position uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
      select 1 from public.pm_report_copies c
        join public.pm_reports r on r.id = c.pm_report_id
        join public.station_events e on e.location_id = c.location_id and e.business_date = r.report_date
       where c.id = p_copy and e.user_id = p_subject and e.position_id = p_position)
    or exists (
      select 1 from public.pm_copy_positions p
       where p.copy_id = p_copy and p.subject_id = p_subject and p.position_id = p_position and p.superseded_at is null)
$$;

-- ── 6. the writer RPCs (SECURITY DEFINER, pinned, service_role only) ────────────────────────────

-- A manager's copy of a v2 day: one per (day, author); a second call returns the same copy.
create function public.open_pm_copy(p_actor uuid, p_report uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_day public.pm_reports%rowtype; v_id uuid;
begin
  if p_actor is null or p_report is null then raise exception 'invalid_payload'; end if;
  select * into v_day from public.pm_reports where id = p_report and superseded_at is null for update;
  if not found then raise exception 'not_found'; end if;
  if v_day.format <> 'v2' then raise exception 'format_mismatch'; end if;
  perform public.pm_v2_actor_ok(p_actor, v_day.location_id);
  if v_day.status <> 'open' then raise exception 'report_already_submitted'; end if;
  insert into public.pm_report_copies (pm_report_id, location_id, author_id)
    values (p_report, v_day.location_id, p_actor)
    on conflict (pm_report_id, author_id) do nothing
    returning id into v_id;
  if v_id is not null then return jsonb_build_object('id', v_id, 'created', true); end if;
  select id into v_id from public.pm_report_copies where pm_report_id = p_report and author_id = p_actor;
  return jsonb_build_object('id', v_id, 'created', false);
end $$;

-- One grade (or "Didn't see" = NULL) per (copy, subject, position, criterion). The refusals in the order the
-- header names; then supersede the live row and insert.
create function public.save_pm_copy_grade(p_actor uuid, p_copy uuid, p_subject uuid, p_position uuid, p_criterion uuid, p_grade text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_copy public.pm_report_copies%rowtype; v_crit public.pm_criteria%rowtype; v_id uuid; v_superseded integer;
begin
  if p_subject is null or p_criterion is null or (p_grade is not null and p_grade not in ('great', 'good', 'needs_work')) then
    raise exception 'invalid_payload';
  end if;
  v_copy := public.pm_copy_lock(p_actor, p_copy, 'write');
  perform public.pm_v2_subject_ok(p_subject, v_copy.location_id);
  if p_position is not null then
    perform public.people_position_at_shop(p_position, v_copy.location_id);
    if not public.pm_subject_worked_position(p_copy, p_subject, p_position) then raise exception 'position_not_worked'; end if;
  end if;
  select * into v_crit from public.pm_criteria where id = p_criterion;
  if not found or v_crit.location_id <> v_copy.location_id or not v_crit.active
     or (v_crit.position_id is not null and v_crit.position_id is distinct from p_position) then
    raise exception 'criterion_mismatch';
  end if;
  update public.pm_copy_grades set superseded_at = clock_timestamp()
   where copy_id = p_copy and subject_id = p_subject and position_id is not distinct from p_position
     and criterion_id = p_criterion and superseded_at is null;
  get diagnostics v_superseded = row_count;
  insert into public.pm_copy_grades (copy_id, location_id, subject_id, position_id, criterion_id, grade)
    values (p_copy, v_copy.location_id, p_subject, p_position, p_criterion, p_grade)
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'superseded', v_superseded);
end $$;

-- The free text for a person (at a position, or none): guards 1–7. A blank note clears the live one.
create function public.save_pm_copy_note(p_actor uuid, p_copy uuid, p_subject uuid, p_position uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_copy public.pm_report_copies%rowtype; v_id uuid; v_superseded integer; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_subject is null then raise exception 'invalid_payload'; end if;
  v_copy := public.pm_copy_lock(p_actor, p_copy, 'write');
  perform public.pm_v2_subject_ok(p_subject, v_copy.location_id);
  if p_position is not null then
    perform public.people_position_at_shop(p_position, v_copy.location_id);
    if not public.pm_subject_worked_position(p_copy, p_subject, p_position) then raise exception 'position_not_worked'; end if;
  end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'invalid_note'; end if;
  update public.pm_copy_notes set superseded_at = clock_timestamp()
   where copy_id = p_copy and subject_id = p_subject and position_id is not distinct from p_position and superseded_at is null;
  get diagnostics v_superseded = row_count;
  if v_note is null then return jsonb_build_object('id', null, 'superseded', v_superseded); end if;
  insert into public.pm_copy_notes (copy_id, location_id, subject_id, position_id, note)
    values (p_copy, v_copy.location_id, p_subject, p_position, v_note)
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'superseded', v_superseded);
end $$;

-- "Worked somewhere else?": the author adds a position the subject worked without tapping in (guards 1–6 —
-- NOT 7: that is its purpose). It opens grading of that position in THIS copy only.
create function public.add_pm_copy_position(p_actor uuid, p_copy uuid, p_subject uuid, p_position uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_copy public.pm_report_copies%rowtype; v_id uuid; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if p_subject is null or p_position is null then raise exception 'invalid_payload'; end if;
  v_copy := public.pm_copy_lock(p_actor, p_copy, 'write');
  perform public.pm_v2_subject_ok(p_subject, v_copy.location_id);
  perform public.people_position_at_shop(p_position, v_copy.location_id);
  if char_length(v_reason) not between 1 and 200 then raise exception 'invalid_reason'; end if;
  update public.pm_copy_positions set superseded_at = clock_timestamp()
   where copy_id = p_copy and subject_id = p_subject and position_id = p_position and superseded_at is null;
  insert into public.pm_copy_positions (copy_id, location_id, subject_id, position_id, reason)
    values (p_copy, v_copy.location_id, p_subject, p_position, v_reason)
    returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

-- "My time on the floor": both instants inside the business day — the ET start of report_date to +30 h
-- (a close after midnight); `to` may stay empty until the end of the shift, else it is after `from`.
create function public.set_pm_copy_window(p_actor uuid, p_copy uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_copy public.pm_report_copies%rowtype; v_start timestamptz;
begin
  v_copy := public.pm_copy_lock(p_actor, p_copy, 'write');
  select (r.report_date::timestamp at time zone 'America/New_York') into v_start
    from public.pm_reports r where r.id = v_copy.pm_report_id;
  if p_from is null or p_from < v_start or p_from > v_start + interval '30 hours'
     or (p_to is not null and (p_to <= p_from or p_to > v_start + interval '30 hours')) then
    raise exception 'invalid_window';
  end if;
  update public.pm_report_copies set observed_from = p_from, observed_to = p_to where id = p_copy;
  return jsonb_build_object('id', p_copy, 'observed_from', p_from, 'observed_to', p_to);
end $$;

-- open → done. The window must be set first (the form says so before Done).
create function public.mark_pm_copy_done(p_actor uuid, p_copy uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_copy public.pm_report_copies%rowtype;
begin
  v_copy := public.pm_copy_lock(p_actor, p_copy, 'markDone');
  if v_copy.observed_from is null then raise exception 'window_required'; end if;
  update public.pm_report_copies set status = 'done' where id = p_copy;
  return jsonb_build_object('id', p_copy, 'status', 'done');
end $$;

-- done → open: the author, on an open day (J16: never a silent reopen by a write).
create function public.reopen_pm_copy(p_actor uuid, p_copy uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  perform public.pm_copy_lock(p_actor, p_copy, 'reopen');
  update public.pm_report_copies set status = 'open' where id = p_copy;
  return jsonb_build_object('id', p_copy, 'status', 'open');
end $$;

-- The closing manager submits the day: ONE guarded open → submitted flip, then every copy is sealed (open and
-- done alike) and an empty observed_to defaults to the submit instant. A losing submit is {changed:false}.
-- No notification; nothing written outside pm_reports and pm_report_copies.
create function public.submit_pm_day_v2(p_actor uuid, p_report uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_day public.pm_reports%rowtype; v_now timestamptz := clock_timestamp(); v_changed integer; v_sealed integer;
begin
  if p_actor is null or p_report is null then raise exception 'invalid_payload'; end if;
  select * into v_day from public.pm_reports where id = p_report and superseded_at is null for update;
  if not found then raise exception 'not_found'; end if;
  if v_day.format <> 'v2' then raise exception 'format_mismatch'; end if;
  perform public.pm_v2_actor_ok(p_actor, v_day.location_id);
  if v_day.status = 'open' and exists (select 1 from public.pm_report_copies where pm_report_id = p_report and status = 'sealed') then
    raise exception 'copy_sealed';
  end if;
  update public.pm_reports set status = 'submitted', submitted_at = v_now, submitted_by = p_actor
   where id = p_report and status = 'open' and format = 'v2' and superseded_at is null;
  get diagnostics v_changed = row_count;
  if v_changed = 0 then return jsonb_build_object('changed', false); end if;
  update public.pm_report_copies
     set status = 'sealed', sealed_at = v_now,
         observed_to = case when observed_to is null and (observed_from is null or observed_from < v_now) then v_now else observed_to end
   where pm_report_id = p_report and status <> 'sealed';
  get diagnostics v_sealed = row_count;
  return jsonb_build_object('changed', true, 'sealed', v_sealed, 'submitted_at', v_now);
end $$;

-- ── GRANTS: the RPCs service_role only; the helpers not even that ───────────────────────────────
revoke all on function public.pm_reports_format_frozen() from public, anon, authenticated, service_role;
revoke all on function public.pm_v2_actor_ok(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.pm_v2_subject_ok(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.pm_copy_lock(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.pm_subject_worked_position(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.open_pm_copy(uuid, uuid) from public, anon, authenticated;
revoke all on function public.save_pm_copy_grade(uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.save_pm_copy_note(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.add_pm_copy_position(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.set_pm_copy_window(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_pm_copy_done(uuid, uuid) from public, anon, authenticated;
revoke all on function public.reopen_pm_copy(uuid, uuid) from public, anon, authenticated;
revoke all on function public.submit_pm_day_v2(uuid, uuid) from public, anon, authenticated;
grant execute on function public.open_pm_copy(uuid, uuid) to service_role;
grant execute on function public.save_pm_copy_grade(uuid, uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.save_pm_copy_note(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.add_pm_copy_position(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.set_pm_copy_window(uuid, uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.mark_pm_copy_done(uuid, uuid) to service_role;
grant execute on function public.reopen_pm_copy(uuid, uuid) to service_role;
grant execute on function public.submit_pm_day_v2(uuid, uuid) to service_role;

do $$
declare
  t text;
  p text;
  f regprocedure;
  v_manifest text;
begin
  foreach t in array array['pm_criteria', 'pm_report_copies', 'pm_copy_grades', 'pm_copy_notes', 'pm_copy_positions'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception '0271: RLS is off on %', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      raise exception '0271: % must have no policy', t;
    end if;
    if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = t
                and grantee in ('PUBLIC', 'anon', 'authenticated')) then
      raise exception '0271: a PostgREST role holds a grant on %', t;
    end if;
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege('service_role', 'public.' || t, p)
         <> (p = 'SELECT' or (t = 'pm_criteria' and p in ('INSERT', 'UPDATE'))) then
        raise exception '0271: service_role % on % is not at its ceiling', p, t;
      end if;
    end loop;
  end loop;
  -- 0267's literal manifest: the PM v1 tables' grants are untouched by this migration.
  foreach t in array array['pm_reports', 'pm_employee_evals'] loop
    select string_agg(grantee || ':' || privilege_type, ',' order by grantee, privilege_type) into v_manifest
      from information_schema.role_table_grants
     where table_schema = 'public' and table_name = t and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role');
    if v_manifest is distinct from 'service_role:INSERT,service_role:SELECT,service_role:UPDATE' then
      raise exception '0271: the % grants moved (%)', t, v_manifest;
    end if;
  end loop;
  foreach f in array array[
    'public.open_pm_copy(uuid, uuid)'::regprocedure,
    'public.save_pm_copy_grade(uuid, uuid, uuid, uuid, uuid, text)'::regprocedure,
    'public.save_pm_copy_note(uuid, uuid, uuid, uuid, text)'::regprocedure,
    'public.add_pm_copy_position(uuid, uuid, uuid, uuid, text)'::regprocedure,
    'public.set_pm_copy_window(uuid, uuid, timestamptz, timestamptz)'::regprocedure,
    'public.mark_pm_copy_done(uuid, uuid)'::regprocedure,
    'public.reopen_pm_copy(uuid, uuid)'::regprocedure,
    'public.submit_pm_day_v2(uuid, uuid)'::regprocedure
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
       or not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '0271: function grant escaped on %', f;
    end if;
    if not (select prosecdef from pg_proc where oid = f) then
      raise exception '0271: writer % must be SECURITY DEFINER', f;
    end if;
    if not coalesce((select proconfig from pg_proc where oid = f) @> array['search_path=pg_catalog, public'], false) then
      raise exception '0271: % must pin its search_path', f;
    end if;
  end loop;
  foreach f in array array[
    'public.pm_reports_format_frozen()'::regprocedure,
    'public.pm_v2_actor_ok(uuid, uuid)'::regprocedure,
    'public.pm_v2_subject_ok(uuid, uuid)'::regprocedure,
    'public.pm_copy_lock(uuid, uuid, text)'::regprocedure,
    'public.pm_subject_worked_position(uuid, uuid, uuid)'::regprocedure
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
       or has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '0271: internal helper % is callable from outside', f;
    end if;
    if not coalesce((select proconfig from pg_proc where oid = f) @> array['search_path=pg_catalog, public'], false) then
      raise exception '0271: % must pin its search_path', f;
    end if;
  end loop;
  if exists (select 1 from information_schema.routine_privileges where routine_schema = 'public'
              and routine_name in ('open_pm_copy', 'save_pm_copy_grade', 'save_pm_copy_note', 'add_pm_copy_position',
                                   'set_pm_copy_window', 'mark_pm_copy_done', 'reopen_pm_copy', 'submit_pm_day_v2',
                                   'pm_reports_format_frozen', 'pm_v2_actor_ok', 'pm_v2_subject_ok', 'pm_copy_lock',
                                   'pm_subject_worked_position')
              and grantee in ('PUBLIC', 'anon', 'authenticated')) then
    raise exception '0271: a PostgREST role can execute a 0271 function';
  end if;
end $$;

commit;
