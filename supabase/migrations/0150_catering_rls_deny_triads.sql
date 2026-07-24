-- Migration 0150_catering_rls_deny_triads
-- STAGED in PR (catering audit 2026-07-24); prod apply deferred to Juan's go.
--
-- Audit finding: catering_rate_rules (0128) and catering_package_slot_options
-- (0136) enabled RLS but never declared the explicit split deny policies the
-- house law mandates ("never FOR ALL; explicit _no_user_{insert,update,delete}").
-- Default-deny already held (no permissive policies existed) — this is the
-- defense-in-depth triad, not a hole being closed. 0135 had retrofitted only
-- the DELETE deny on catering_rate_rules.

create policy catering_rate_rules_no_user_insert on public.catering_rate_rules for insert with check (false);
create policy catering_rate_rules_no_user_update on public.catering_rate_rules for update using (false);

create policy catering_package_slot_options_no_user_insert on public.catering_package_slot_options for insert with check (false);
create policy catering_package_slot_options_no_user_update on public.catering_package_slot_options for update using (false);
create policy catering_package_slot_options_no_user_delete on public.catering_package_slot_options for delete using (false);
