# Lockdown step 2 — CC rulings on Astra plan (2026-10-19) + live prod evidence

## Live prod evidence (read-only, project bgcvurheqzylyfehqgzh, 2026-10-19)
Grants: anon, authenticated AND service_role each hold DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE on all 5 tables.

Policies (all PERMISSIVE):
- checklist_instances
  - insert (public): CASE template.type IN (opening,prep) THEN level>=4 ELSE level>=3 END AND location_id = ANY(current_user_locations())
  - insert_closing_staff (authenticated): current_user_id() NOT NULL AND level>=3 AND location member AND status='open' AND date = (now() AT TIME ZONE 'America/New_York')::date AND EXISTS template t (t.id=template_id AND t.location_id=location_id AND t.type='closing' AND t.active)
  - update (public): USING location member AND level>=3   ← NO with_check, ANY column (status, confirmed_by, ...) — real hole today
  - no_delete: false
  - read: member OR level>=8
- checklist_completions
  - insert (public): completed_by=self AND template item min_role_level<=level AND parent instance member + status='open'
  - insert_closing_staff (authenticated): completed_by=self AND level>=2 AND instance/template/item join: member, open, t.type='closing', ti.active, level>=ti.min_role_level, ti.report_reference_type IS NULL, NOT(coalesce(ti.ref_track_item_completion,false) AND ti.references_template_item_id IS NOT NULL)
  - update/delete: false; read: parent member OR level>=8
- checklist_submissions: insert = submitted_by=self ONLY (no instance/location check — hole); update/delete false; read via parent
- checklist_incomplete_reasons: insert = reported_by=self ONLY (hole); update/delete false; read via parent
- written_reports: insert = submitted_by=self AND level>=3; update_self USING submitted_by=self AND submitted_at > now()-3h (no with_check); delete false; read = level>=visibility_min_level AND (location null OR member OR level>=8)

Helpers:
- current_user_id(): sessions row where id=jwt.session_id AND user_id=jwt.user_id AND revoked_at IS NULL AND expires_at>now()
- current_user_locations(): array_agg(user_locations.location_id) for current_user_id() — plain membership, NO owner/global override
- current_user_role_level(): role→level map (cgs10 owner9 moo8 gm7 agm/catering_mgr/prep_mgr/social_media_mgr6 shift_lead5 key_holder/trainer4 employee3 trainee2 hired_not_yet_worked1 prospect0) from users where id=current_user_id() AND active (inactive → NULL → every >= check false)

## Rulings
R1 Evidence: the dump above is the authorization contract. App checks must be AT LEAST these predicates (OR across the two INSERT siblings), plus the stronger checks the app already does. Do NOT reproduce the holes: submissions + incomplete_reasons must additionally require the parent instance to be at a member location and open (the app already validates this — keep it, server-side, from the session). Instance UPDATE must be column-scoped per operation, not "any column".
R2 Membership semantics = exactly current_user_locations(): user_locations rows for the session user. NO owner/level-8 write override (level-8 is READ only). Session validity = exactly current_user_id() (session not revoked, not expired, user/session match) and active user. Add a parity test table (role × membership × active × session state) that runs the same cases against the SQL predicates in PGlite and against the app guard and asserts identical allow/deny.
R3 Statement-time enforcement WITHOUT a new prerequisite migration: every UPDATE carries its guard in the same statement (`.eq('id').eq('location_id').eq('status','open')` etc.) and asserts rowcount === 1. For INSERTs that depend on parent open-state (completions, submissions, reasons), take the guard as: precheck + post-insert re-verify parent still open in the same request, and on mismatch compensate (delete via service role is NOT allowed — so instead: the confirm path already claims status=open→confirmed atomically; a completion inserted after a concurrent confirm is a benign late row that confirm ignores. Document this and test it). Only if you find a path where a late insert is NOT benign, stop and report — then CC allocates migration 0276 for a guarded service-only writer and the lockdown becomes 0277. Default numbering: lockdown = 0276.
R4 Service role: NO service_role ceiling in this step (reset/sim scripts rely on service DELETE). Scope of 0276 = mirror 0272 exactly for these 5 tables: revoke INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES from PUBLIC, anon, authenticated (table + column level); drop the permissive INSERT/UPDATE policies; keep the explicit false policies and ALL SELECT policies/grants; per-table asserts; audit rows like 0272. A service ceiling is a separate later item.
R5 Writers move to the service client ONLY inside lib functions that receive a session-derived actor (user id, role level, active, membership) resolved server-side from the verified session — never from request bodies. Keep every route response/error shape.
R6 Deploy order: app cutover PR ships, prod READY + old deployment URLs drained/SSO-gated (as with 0266), checklist flows verified on prod; THEN 0276 sim → prod with Juan's yes.
