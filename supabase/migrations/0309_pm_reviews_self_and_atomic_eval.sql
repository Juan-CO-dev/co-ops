-- Migration 0309_pm_reviews_self_and_atomic_eval
-- AUTHORED 2026-11-15. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word, AFTER 0271; BEFORE the W09 PR merges).
-- APPLIED TO SIM 2026-11-15 (schema_migrations version 20261115204850, name '0309_pm_reviews_self_and_atomic_eval')
-- APPLIED TO PROD 2026-11-15 (schema_migrations version 20261115205216, name '0309_pm_reviews_self_and_atomic_eval')
-- ROLLOUT (enforced order, W09 fix round 2): apply 0309 -> merge + deploy the W09 PR -> older deployments drain -> apply 0310.
--   0309 is safe for the deployed (old) app; the self-evaluation INSERT trigger is NOT here: it is 0310, see CONSUMERS.
-- Provenance: CO-OPS bug audit wave W09 (manager shift reviews: privacy and fairness) — B059, B060, B164.
--   Owner decisions (2026-11-15): W09-3 (a) nobody evaluates themselves or names themselves MVP, either format;
--   W09-4 (a) where two live v1 evaluations exist for one (report, employee), KEEP THE NEWEST; evaluations people
--   wrote about themselves stay as they are (history).
--
-- WHAT:
--   1. pm_employee_evals_one_live — UNIQUE (pm_report_id, employee_id) WHERE superseded_at IS NULL (B164): at most
--      ONE live v1 evaluation per person per day. Before it is built, the apply COLLAPSES any existing duplicate
--      live pairs to their newest row (created_at, then id), superseding the older ones at the apply instant
--      (W09-4 a), under a SHARE ROW EXCLUSIVE lock on the table so no writer can add a duplicate between the
--      collapse and the index. One audit row (pm_report.eval_duplicate_collapse, destructive, ids only) records
--      exactly which rows were superseded; when there are none, nothing is written.
--   2. save_pm_employee_eval — the v1 evaluation writer (B164 + B060): locks the DAY ROW (FOR NO KEY UPDATE, the
--      house mode for new parent locks), then judges, under that lock: the day exists at that shop (not_found),
--      is v1 (format_mismatch), the actor is a KH+ member of the shop (forbidden; level only — v1's role and task
--      rules stay in the lib), the day is open (report_already_submitted), the employee is not the actor
--      (self_evaluation) and is a member of the shop (invalid_target); then supersedes the live row and inserts
--      the new one in ONE transaction. submitPmReport's guarded status UPDATE waits on the same row lock, so a save
--      can no longer land after submit, and two concurrent saves serialize (the second supersedes the first).
--   3. save_pm_copy_grade / save_pm_copy_note / add_pm_copy_position — the three 0271 writers RE-EMITTED
--      IDENTICAL to 0271 but for ONE line after pm_copy_lock: `if p_subject = p_actor then raise exception
--      'subject_is_author'` (B059). The lifecycle refusals keep their order (who → day → copy state first).
--
-- NOT HERE (moved to 0310_pm_eval_no_self_trigger, W09 fix round 2): the BEFORE INSERT trigger refusing a
--   self-written v1 evaluation. See CONSUMERS for why it must wait until the W09 deploy has drained.
--
-- CASE: every identity compare here (p_employee = p_actor, p_subject = p_actor) is uuid = uuid, never text, so it
--   is case-insensitive: 'CAFE...' and 'cafe...' parse to one uuid (the harness proves the writers refuse an
--   uppercased own id). The lib canonicalizes ids to lowercase before its own self checks (W09 fix round 1). The
--   shift MVP has no SQL backstop (the UPDATE carries no actor); its self check is the lib's, on canonical ids.
--
-- EXISTING ROWS: only the older duplicate live v1 evaluations (if any) are superseded (W09-4 a); nothing is deleted.
--   Self-written v1 evaluations and v2 self-grades stay as history (the lib hides v2 self rows at read time).
--
-- CONSUMERS (the W09 PR): lib/pm-report.ts saveEmployeeEval writes ONLY through save_pm_employee_eval, with NO
--   FALLBACK (the 0278 / 0279 rollout precedent): this file must be on prod BEFORE that PR merges.
--   THE OLD APP AFTER THIS APPLY (until the W09 deploy drains). The deployed origin/main writer supersedes the live
--   row and then inserts the new one as TWO separate PostgREST calls, with NO self-evaluation check of its own.
--   Against 0309 it keeps working (the harness replays exactly that path, C9):
--     - a normal save supersedes the live row and inserts the new one: one live row, as before;
--     - a racing duplicate: the second INSERT fails 23505 (a 500 for that request) instead of landing a second live
--       row; a 23505 means another live row exists, so the pair is never left with no live evaluation;
--     - a self-evaluation still LANDS through the old path (as it does today): 0309 adds no INSERT refusal on
--       pm_employee_evals. That is deliberate. An INSERT refusal behind the old path's already-committed supersede
--       UPDATE would leave NO live evaluation (the GM's row superseded, the self row refused): hence 0310 waits.
--     - the old v2 lib calls the three re-emitted writers; a self grade/note/position now answers subject_is_author
--       inside the RPC's one transaction, so nothing is written (write_failed on the old app; a 403 once W09 deploys).
--   lib/pm-report-v2.ts (W09) refuses subject_is_author before calling the three v2 writers.
--
-- DEPENDS ON: 0072/0073 (pm_employee_evals), 0217 (assignment_user_level), 0267 (the PM table ceilings),
--   0271 (format, the three writers, pm_copy_lock).
--
-- IDEMPOTENT: a second apply changes nothing — the collapse finds no duplicates, the index is `if not exists`
--   (its definition is proven by the post-flight), the functions are `create or replace`, and no audit row is
--   written. Re-applying 0309 after 0310 leaves 0310's trigger in place (0309 never touches it).
--
-- PRE-FLIGHT (MCP, read-only, before apply):
--   select to_regprocedure('public.save_pm_copy_grade(uuid,uuid,uuid,uuid,uuid,text)') is not null,
--          to_regprocedure('public.pm_copy_lock(uuid,uuid,text)') is not null,
--          to_regprocedure('public.assignment_user_level(uuid,uuid)') is not null;                 -- t, t, t
--   select count(*) from (select 1 from public.pm_employee_evals where superseded_at is null
--     group by pm_report_id, employee_id having count(*) > 1) d;                                    -- duplicates the apply collapses
--   select count(*) from public.pm_employee_evals where author_id = employee_id and superseded_at is null;  -- kept as history
--
-- VERIFY AFTER APPLY:
--   select indexdef from pg_indexes where schemaname = 'public' and indexname = 'pm_employee_evals_one_live';
--     -- CREATE UNIQUE INDEX ... (pm_report_id, employee_id) WHERE (superseded_at IS NULL)
--   select count(*) from (select 1 from public.pm_employee_evals where superseded_at is null
--     group by pm_report_id, employee_id having count(*) > 1) d;                                    -- 0
--   select routine_name, grantee from information_schema.routine_privileges where routine_schema = 'public'
--    and routine_name in ('save_pm_employee_eval', 'save_pm_copy_grade',
--                         'save_pm_copy_note', 'add_pm_copy_position') order by 1, 2;              -- service_role (+ postgres)
--   select action, metadata from public.audit_log where action = 'pm_report.eval_duplicate_collapse';  -- one row iff duplicates existed
--   Then CC runs scripts/sim/pm-0309-lock-check-management.mjs on SIM (two-session proof).

begin;

-- ── PRE-FLIGHT: what this stands on, and nothing half-shaped from an earlier attempt ───────────
do $$
declare v_def text;
begin
  if to_regclass('public.pm_employee_evals') is null or to_regclass('public.pm_reports') is null then
    raise exception '0309: the PM v1 tables (0072/0073) are missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pm_reports' and column_name = 'format')
     or to_regprocedure('public.save_pm_copy_grade(uuid,uuid,uuid,uuid,uuid,text)') is null
     or to_regprocedure('public.save_pm_copy_note(uuid,uuid,uuid,uuid,text)') is null
     or to_regprocedure('public.add_pm_copy_position(uuid,uuid,uuid,uuid,text)') is null
     or to_regprocedure('public.pm_copy_lock(uuid,uuid,text)') is null
     or to_regprocedure('public.pm_v2_subject_ok(uuid,uuid)') is null then
    raise exception '0309: 0271 (pm_reports_v2) must be applied first';
  end if;
  if to_regprocedure('public.assignment_user_level(uuid,uuid)') is null then
    raise exception '0309: 0217 (assignment_user_level) must be applied first';
  end if;
  -- 0267's ceiling must hold (this file relies on PostgREST having nothing on the PM tables).
  if has_table_privilege('authenticated', 'public.pm_employee_evals', 'SELECT')
     or has_table_privilege('anon', 'public.pm_employee_evals', 'SELECT') then
    raise exception '0309: 0267_pm_evals_privacy posture missing (PostgREST can read pm_employee_evals)';
  end if;
  -- A same-named index from anything but this file is refused rather than trusted.
  select indexdef into v_def from pg_indexes where schemaname = 'public' and indexname = 'pm_employee_evals_one_live';
  if v_def is not null and v_def !~* '^create unique index pm_employee_evals_one_live on public\.pm_employee_evals using btree \(pm_report_id, employee_id\) where \(superseded_at is null\)$' then
    raise exception '0309: an index named pm_employee_evals_one_live exists with another definition: refusing';
  end if;
end $$;

-- ── 1. collapse duplicate live v1 evaluations to the newest (W09-4 a), then one live row per (report, employee) ──
lock table public.pm_employee_evals in share row exclusive mode;

do $$
declare v_ids uuid[]; v_pairs integer;
begin
  with ranked as (
    select id, pm_report_id, employee_id,
           row_number() over (partition by pm_report_id, employee_id order by created_at desc, id desc) as rn
      from public.pm_employee_evals where superseded_at is null
  )
  select coalesce(array_agg(id order by id), '{}'), count(distinct (pm_report_id, employee_id))::int
    into v_ids, v_pairs
    from ranked where rn > 1;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise notice '0309: no duplicate live v1 evaluations';
    return;
  end if;
  update public.pm_employee_evals set superseded_at = clock_timestamp() where id = any(v_ids) and superseded_at is null;
  insert into public.audit_log (actor_id, actor_role, action, resource_table, resource_id, destructive, metadata)
  values (null, null, 'pm_report.eval_duplicate_collapse', 'pm_employee_evals', null, true,
    jsonb_build_object('actor_context', 'migration_apply', 'migration', '0309_pm_reviews_self_and_atomic_eval',
      'rule', 'keep_newest_live_eval_per_report_employee', 'pairs', v_pairs, 'superseded_ids', to_jsonb(v_ids)));
  raise notice '0309: superseded % older live v1 evaluation(s) across % (report, employee) pair(s)', array_length(v_ids, 1), v_pairs;
end $$;

create unique index if not exists pm_employee_evals_one_live
  on public.pm_employee_evals (pm_report_id, employee_id) where superseded_at is null;

-- ── 2. the v1 evaluation writer: the day row lock first, then supersede + insert in one transaction ──
create or replace function public.save_pm_employee_eval(
  p_actor uuid, p_report uuid, p_location uuid, p_employee uuid,
  p_arrived_ready text, p_attitude text, p_production text, p_team_player text, p_area text, p_note text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_day public.pm_reports%rowtype; v_level integer; v_id uuid; v_superseded integer;
begin
  if p_actor is null or p_report is null or p_location is null or p_employee is null
     or p_arrived_ready is null or p_arrived_ready not in ('great', 'good', 'needs_work')
     or p_attitude is null or p_attitude not in ('great', 'good', 'needs_work')
     or p_production is null or p_production not in ('great', 'good', 'needs_work')
     or p_team_player is null or p_team_player not in ('great', 'good', 'needs_work') then
    raise exception 'invalid_payload';
  end if;
  select * into v_day from public.pm_reports where id = p_report and superseded_at is null for no key update;
  if not found or v_day.location_id <> p_location then raise exception 'not_found'; end if;
  if v_day.format = 'v2' then raise exception 'format_mismatch'; end if;
  begin
    v_level := public.assignment_user_level(p_actor, p_location);
  exception when raise_exception then
    raise exception 'forbidden';
  end;
  if v_level < 4 then raise exception 'forbidden'; end if;
  if v_day.status <> 'open' then raise exception 'report_already_submitted'; end if;
  if p_employee = p_actor then raise exception 'self_evaluation'; end if;
  begin
    perform public.assignment_user_level(p_employee, p_location);
  exception when raise_exception then
    raise exception 'invalid_target';
  end;
  update public.pm_employee_evals set superseded_at = clock_timestamp()
   where pm_report_id = p_report and employee_id = p_employee and superseded_at is null;
  get diagnostics v_superseded = row_count;
  insert into public.pm_employee_evals (pm_report_id, location_id, employee_id, arrived_ready, attitude,
      production, team_player, area_to_improve, note, author_id)
    values (p_report, p_location, p_employee, p_arrived_ready, p_attitude, p_production, p_team_player,
      p_area, p_note, p_actor)
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'superseded', v_superseded);
end $$;

-- ── 3. the three 0271 writers, re-emitted IDENTICAL but for one line after pm_copy_lock (B059) ──
create or replace function public.save_pm_copy_grade(p_actor uuid, p_copy uuid, p_subject uuid, p_position uuid, p_criterion uuid, p_grade text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_copy public.pm_report_copies%rowtype; v_crit public.pm_criteria%rowtype; v_id uuid; v_superseded integer;
begin
  if p_subject is null or p_criterion is null or (p_grade is not null and p_grade not in ('great', 'good', 'needs_work')) then
    raise exception 'invalid_payload';
  end if;
  v_copy := public.pm_copy_lock(p_actor, p_copy, 'write');
  if p_subject = p_actor then raise exception 'subject_is_author'; end if;  -- 0309 (W09/B059)
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

create or replace function public.save_pm_copy_note(p_actor uuid, p_copy uuid, p_subject uuid, p_position uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_copy public.pm_report_copies%rowtype; v_id uuid; v_superseded integer; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_subject is null then raise exception 'invalid_payload'; end if;
  v_copy := public.pm_copy_lock(p_actor, p_copy, 'write');
  if p_subject = p_actor then raise exception 'subject_is_author'; end if;  -- 0309 (W09/B059)
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

create or replace function public.add_pm_copy_position(p_actor uuid, p_copy uuid, p_subject uuid, p_position uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_copy public.pm_report_copies%rowtype; v_id uuid; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if p_subject is null or p_position is null then raise exception 'invalid_payload'; end if;
  v_copy := public.pm_copy_lock(p_actor, p_copy, 'write');
  if p_subject = p_actor then raise exception 'subject_is_author'; end if;  -- 0309 (W09/B059)
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

-- ── GRANTS ─────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.save_pm_employee_eval(uuid, uuid, uuid, uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.save_pm_employee_eval(uuid, uuid, uuid, uuid, text, text, text, text, text, text) to service_role;
-- re-asserted for the re-emitted 0271 writers (create or replace keeps them; the post-flight proves it)
revoke all on function public.save_pm_copy_grade(uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.save_pm_copy_note(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.add_pm_copy_position(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.save_pm_copy_grade(uuid, uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.save_pm_copy_note(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.add_pm_copy_position(uuid, uuid, uuid, uuid, text) to service_role;

-- ── POST-FLIGHT ────────────────────────────────────────────────────────────────────────────────
do $$
declare
  f regprocedure;
  v_src text;
  p text;
  t text;
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'pm_employee_evals_one_live'
                  and indexdef ~* '^create unique index pm_employee_evals_one_live on public\.pm_employee_evals using btree \(pm_report_id, employee_id\) where \(superseded_at is null\)$') then
    raise exception '0309: pm_employee_evals_one_live is not UNIQUE (pm_report_id, employee_id) WHERE superseded_at IS NULL';
  end if;
  foreach f in array array[
    'public.save_pm_employee_eval(uuid, uuid, uuid, uuid, text, text, text, text, text, text)'::regprocedure,
    'public.save_pm_copy_grade(uuid, uuid, uuid, uuid, uuid, text)'::regprocedure,
    'public.save_pm_copy_note(uuid, uuid, uuid, uuid, text)'::regprocedure,
    'public.add_pm_copy_position(uuid, uuid, uuid, uuid, text)'::regprocedure] loop
    if not (select prosecdef from pg_proc where oid = f)
       or not coalesce((select proconfig from pg_proc where oid = f) @> array['search_path=pg_catalog, public'], false) then
      raise exception '0309: % must be SECURITY DEFINER with a pinned search_path', f;
    end if;
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception '0309: % is executable by a PostgREST role', f;
    end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception '0309: service_role cannot execute %', f;
    end if;
  end loop;
  foreach f in array array[
    'public.save_pm_copy_grade(uuid, uuid, uuid, uuid, uuid, text)'::regprocedure,
    'public.save_pm_copy_note(uuid, uuid, uuid, uuid, text)'::regprocedure,
    'public.add_pm_copy_position(uuid, uuid, uuid, uuid, text)'::regprocedure] loop
    select prosrc into v_src from pg_proc where oid = f;
    if position('subject_is_author' in v_src) = 0 or position('pm_copy_lock(p_actor, p_copy, ''write'')' in v_src) = 0
       or position('pm_copy_lock' in v_src) > position('subject_is_author' in v_src) then
      raise exception '0309: % does not refuse subject_is_author after the copy lock', f;
    end if;
  end loop;
  select prosrc into v_src from pg_proc where oid = 'public.save_pm_employee_eval(uuid, uuid, uuid, uuid, text, text, text, text, text, text)'::regprocedure;
  if position('for no key update' in v_src) = 0 or position('self_evaluation' in v_src) = 0 then
    raise exception '0309: save_pm_employee_eval must lock the day row and refuse self_evaluation';
  end if;
  if v_src ~* 'notification' then raise exception '0309: save_pm_employee_eval must not notify'; end if;
  -- the PM table ceilings are unchanged (0267 / 0271)
  foreach t in array array['pm_employee_evals', 'pm_reports'] loop
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege('service_role', format('public.%I', t), p) <> (p in ('SELECT', 'INSERT', 'UPDATE')) then
        raise exception '0309: service_role % on % is not at its 0267 ceiling', p, t;
      end if;
      if has_table_privilege('authenticated', format('public.%I', t), p) or has_table_privilege('anon', format('public.%I', t), p) then
        raise exception '0309: a PostgREST role holds % on %', p, t;
      end if;
    end loop;
  end loop;
  foreach t in array array['pm_copy_grades', 'pm_copy_notes', 'pm_copy_positions'] loop
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege('service_role', format('public.%I', t), p) <> (p = 'SELECT') then
        raise exception '0309: service_role % on % is not at its 0271 ceiling (SELECT)', p, t;
      end if;
    end loop;
  end loop;
  if exists (select 1 from (select 1 from public.pm_employee_evals where superseded_at is null
              group by pm_report_id, employee_id having count(*) > 1) d) then
    raise exception '0309: duplicate live v1 evaluations remain';
  end if;
end $$;

commit;
