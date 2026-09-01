-- Migration 0189_rls_perimeter_revokes_and_read_floors
-- AUTHORED 2026-09-01. NOT YET APPLIED — GATE (LEAD/JUAN). Rehearsed on the sim sandbox first.
--
-- 0189: close the three direct-PostgREST perimeter holes the 2026-09-01 full audit
-- confirmed live (ledger P2-1 partial, P2-2, P2-3, P3-4 — .claude/council/2026-09-01-full-audit-v2/LEDGER.md).
--
-- ── WHY THIS LAYER IS THE PERIMETER ────────────────────────────────────────────────
-- The staff JWT carries `role:'authenticated'` and is signed with the project secret,
-- so it is a valid PostgREST bearer. Every app-layer floor (INSIGHTS_READ_MIN = 5,
-- PIPELINE_READ_MIN = 5, COMPANY/CUSTOMER_READ_MIN = 5) is invisible on that path;
-- only RLS quals and function grants stand. Pre-flight against prod 2026-09-01: the
-- app has ZERO authed-client readers of these tables (all service-role), so nothing
-- below changes what the app shows anyone — it changes what a cookie + curl can reach.
--
-- ── A. Two SECURITY DEFINER functions were executable by ANY staff level ─────────────
-- AGENTS.md law: "REVOKE FROM PUBLIC is NOT enough… revoke from anon too and verify via
-- routine_privileges." 0121 and 0046 revoked anon and PUBLIC and left `authenticated`
-- (the default ACL grants all three). Migration 0132 got this right for four sibling
-- RPCs; these two predate it and were never swept. Neither appears in any RLS qual, so
-- `authenticated` needs no EXECUTE at all. Their only callers are service-role (lib/
-- catering/insights.ts; the 6-hourly pg_cron + the dashboard's lazy evaluation).
--   catering_insights(uuid[])         — cross-location revenue/pipeline aggregates; app floor 5.
--   release_overdue_closings(uuid[])  — MUTATES (open → auto_finalized). Blast radius was
--                                       ≤6h acceleration of what the cron does anyway; closed
--                                       here because the cost is one line.
--
-- ── B. Catering READ policies had a location predicate but NO role floor ────────────────
-- Live quals (prod, 2026-09-01):
--   catering_pipeline_read : (location_id IS NULL) OR (location_id = ANY(cul())) OR (level >= 9)
--   catering_customers_read: (primary_location_id = ANY(cul()))                 OR (level >= 9)
--   catering_orders_read   : (location_id = ANY(cul()))                         OR (level >= 9)
--   customer_feedback_read : (location_id = ANY(cul()))                         OR (level >= 9)
-- So a level-3 line cook could read their own shop's catering customers/orders/feedback
-- (data the app never shows below level 5) plus every unassigned pipeline lead. This
-- adds the app's own floor (5) as an AND on the location arm; the level-9 all-locations
-- arm is unchanged; the pipeline's `location_id IS NULL` arm (unassigned leads, by
-- design visible to catering-capable roles) is KEPT but now floored too. Every INSERT/
-- UPDATE sibling on these tables was already floored at 6 — the asymmetry is the tell.
--
-- ── C. current_user_role_level() ignored `users.active` ──────────────────────────────
-- Session revocation / deactivation stops the APP (dual verification) but PostgREST
-- validates signature + exp only; a deactivated user's captured JWT kept resolving a
-- role level for up to 12h (audit P2-1). Adding `AND active` makes the helper return
-- NULL for a deactivated user, and NULL >= N is never true — every level-gated policy
-- denies. `current_user_locations()` already reads the live table. This is the RLS half
-- of P2-1; the JWT-lifetime half waits for PR #315 (it touches lib/auth.ts).
-- Same attributes as the live definition: LANGUAGE sql, SECURITY DEFINER,
-- SET search_path = pg_catalog, public; CREATE OR REPLACE preserves the existing ACL.
-- No active user is affected (active = true is the only path the app ever mints a
-- session for; createSession refuses inactive users).
--
-- ── VERIFY AFTER APPLY (the law: verify grants via routine_privileges) ──────────────────
--   select routine_name, grantee from information_schema.routine_privileges
--    where specific_schema='public' and privilege_type='EXECUTE'
--      and routine_name in ('catering_insights','release_overdue_closings')
--    order by 1,2;                                   -- expect ONLY service_role (+ postgres owner)
--   select tablename, policyname, qual from pg_policies
--    where schemaname='public' and cmd='SELECT'
--      and tablename in ('catering_pipeline','catering_customers','catering_orders','customer_feedback');
--                                                    -- expect every qual to contain ">= (5)"
--   select prosrc from pg_proc where proname='current_user_role_level';  -- expect "AND active"
--
-- Rollback (if ever needed): re-grant EXECUTE to authenticated; re-run the pre-flight
-- quals above without the level-5 AND; re-create the function without `AND active`.

begin;

-- A. Function grants
revoke execute on function public.catering_insights(uuid[])        from authenticated;
revoke execute on function public.release_overdue_closings(uuid[]) from authenticated;

-- B. Read floors (level-9 arm unchanged; location arm floored at the app's own 5)
alter policy catering_pipeline_read on public.catering_pipeline
  using (
    (public.current_user_role_level() >= (9)::numeric)
    or (
      public.current_user_role_level() >= (5)::numeric
      and (location_id is null or location_id = any (public.current_user_locations()))
    )
  );

alter policy catering_customers_read on public.catering_customers
  using (
    (public.current_user_role_level() >= (9)::numeric)
    or (
      public.current_user_role_level() >= (5)::numeric
      and primary_location_id = any (public.current_user_locations())
    )
  );

alter policy catering_orders_read on public.catering_orders
  using (
    (public.current_user_role_level() >= (9)::numeric)
    or (
      public.current_user_role_level() >= (5)::numeric
      and location_id = any (public.current_user_locations())
    )
  );

alter policy customer_feedback_read on public.customer_feedback
  using (
    (public.current_user_role_level() >= (9)::numeric)
    or (
      public.current_user_role_level() >= (5)::numeric
      and location_id = any (public.current_user_locations())
    )
  );

-- C. Deactivated users resolve no level (RLS half of the post-revocation window)
create or replace function public.current_user_role_level()
returns numeric
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case role
    when 'cgs' then 10
    when 'owner' then 9
    when 'moo' then 8
    when 'gm' then 7
    when 'agm' then 6
    when 'catering_mgr' then 6
    when 'prep_mgr' then 6
    when 'social_media_mgr' then 6
    when 'shift_lead' then 5
    when 'key_holder' then 4
    when 'trainer' then 4
    when 'employee' then 3
    when 'trainee' then 2
    when 'hired_not_yet_worked' then 1
    when 'prospect' then 0
    else 0
  end
  from public.users
  where id = public.current_user_id()
    and active
$$;

commit;
