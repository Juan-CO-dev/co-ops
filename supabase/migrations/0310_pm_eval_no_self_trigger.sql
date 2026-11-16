-- Migration 0310_pm_eval_no_self_trigger
-- AUTHORED 2026-11-15. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word, AFTER 0309 AND ONLY AFTER the W09 PR is deployed READY and older deployments drain).
-- ROLLOUT (enforced order, W09 fix round 2): apply 0309 -> merge + deploy the W09 PR -> older deployments drain -> apply 0310.
-- Provenance: CO-OPS bug audit wave W09 (manager shift reviews: privacy and fairness) — B060 (the SQL backstop).
--   Owner decision (2026-11-15): W09-3 (a) nobody evaluates themselves, either format. Split out of 0309 in W09 fix
--   round 2 (CC ruling: SPLIT) because of the rollout hazard below.
--
-- WHAT:
--   pm_employee_evals_no_self — a BEFORE INSERT trigger refusing author_id = employee_id ('self_evaluation').
--   INSERT only, on purpose: superseding an OLD self-written row (an UPDATE of superseded_at) must keep working so a
--   GM can re-grade that person. A CHECK ... NOT VALID would be checked on that UPDATE and break it.
--
-- WHY IT WAITS FOR THE DRAIN (the hazard 0309 avoids): the pre-W09 writer (origin/main lib/pm-report.ts
--   saveEmployeeEval) supersedes the live evaluation and then inserts the new one as TWO separate PostgREST calls,
--   with no self-evaluation check. With this trigger in place, a key holder saving an evaluation of himself through
--   an OLD deployment would commit the supersede of the GM's live row and then have the INSERT refused: NO live
--   evaluation left for that person that day. The W09 writer (save_pm_employee_eval, 0309) refuses self_evaluation
--   BEFORE it supersedes anything, in one transaction, so once only W09 deployments serve traffic the trigger can
--   never strand a pair. The pre-flight refuses unless save_pm_employee_eval exists; it cannot see deployments, so
--   the drain is the operator's check (Vercel: the W09 deployment READY and promoted, no older deployment serving).
--
-- CASE: author_id = employee_id is uuid = uuid, so an uppercased id cannot dodge it (the harness proves it).
--
-- EXISTING ROWS: none touched. Self-written v1 evaluations already stored stay as history; superseding them works.
--
-- CONSUMERS: none call it; it is the SQL backstop under save_pm_employee_eval's own self_evaluation refusal (which
--   always answers first). Nothing in the app depends on this file being applied.
--
-- DEPENDS ON: 0072/0073 (pm_employee_evals), 0309 (save_pm_employee_eval).
--
-- IDEMPOTENT: the function is `create or replace`, the trigger is dropped and re-created; nothing else changes.
--
-- PRE-FLIGHT (MCP, read-only, before apply):
--   select to_regprocedure('public.save_pm_employee_eval(uuid,uuid,uuid,uuid,text,text,text,text,text,text)') is not null;  -- t
--   Confirm in Vercel that the W09 PR's deployment is READY and promoted and no older deployment still serves.
--
-- VERIFY AFTER APPLY:
--   select tgname, tgenabled from pg_trigger where tgrelid = 'public.pm_employee_evals'::regclass and not tgisinternal;
--     -- pm_employee_evals_no_self | O
--   select routine_name, grantee from information_schema.routine_privileges where routine_schema = 'public'
--    and routine_name = 'pm_employee_evals_no_self';                                                -- postgres only (no API grant)

begin;

-- ── PRE-FLIGHT: 0309's writer must exist (the trigger is only safe behind it) ─────────────────
do $$
begin
  if to_regclass('public.pm_employee_evals') is null then
    raise exception '0310: the PM v1 tables (0072/0073) are missing';
  end if;
  if to_regprocedure('public.save_pm_employee_eval(uuid,uuid,uuid,uuid,text,text,text,text,text,text)') is null then
    raise exception '0310: 0309 (save_pm_employee_eval) must be applied first, and the W09 deploy must have drained';
  end if;
  if position('self_evaluation' in (select prosrc from pg_proc
       where oid = 'public.save_pm_employee_eval(uuid,uuid,uuid,uuid,text,text,text,text,text,text)'::regprocedure)) = 0 then
    raise exception '0310: save_pm_employee_eval does not refuse self_evaluation: refusing';
  end if;
end $$;

-- ── no NEW self-written v1 evaluation (INSERT only; see the header) ──────────────────────────
create or replace function public.pm_employee_evals_no_self() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.author_id = new.employee_id then raise exception 'self_evaluation'; end if;
  return new;
end $$;
drop trigger if exists pm_employee_evals_no_self on public.pm_employee_evals;
create trigger pm_employee_evals_no_self before insert on public.pm_employee_evals
  for each row execute function public.pm_employee_evals_no_self();

-- ── GRANTS: the trigger function is callable by nobody but the trigger ────────────────────────
revoke all on function public.pm_employee_evals_no_self() from public, anon, authenticated, service_role;

-- ── POST-FLIGHT ────────────────────────────────────────────────────────────────────────────────
do $$
declare f regprocedure := 'public.pm_employee_evals_no_self()'::regprocedure;
begin
  if not exists (select 1 from pg_trigger where tgname = 'pm_employee_evals_no_self' and tgrelid = 'public.pm_employee_evals'::regclass
                  and not tgisinternal and tgenabled = 'O'
                  and pg_get_triggerdef(oid) ~* 'before insert on public\.pm_employee_evals for each row') then
    raise exception '0310: the pm_employee_evals_no_self trigger is missing, disabled or not BEFORE INSERT FOR EACH ROW';
  end if;
  if not (select prosecdef from pg_proc where oid = f)
     or not coalesce((select proconfig from pg_proc where oid = f) @> array['search_path=pg_catalog, public'], false) then
    raise exception '0310: % must be SECURITY DEFINER with a pinned search_path', f;
  end if;
  if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
     or has_function_privilege('service_role', f, 'EXECUTE') then
    raise exception '0310: the trigger function must not be callable';
  end if;
end $$;

commit;
