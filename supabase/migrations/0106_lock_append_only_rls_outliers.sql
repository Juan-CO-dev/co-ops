-- Migration 0106_lock_append_only_rls_outliers
-- Applied via Supabase MCP apply_migration on 2026-07-13.
-- Canonical reference: 2026-07-11 dual-repo audit (backlog items 7+8);
--   AGENTS.md "Append-only philosophy is enforced at RLS".
--
-- Two tables were granted end-user UPDATE/DELETE that no app path uses (all writes
-- go through the service-role client, which bypasses RLS). This is unused attack
-- surface, and for opening_setup_items also an append-only-invariant violation
-- (every other config table is _no_user_delete USING(false) + no in-place update).
-- Lock both to service-role-only writes. Reversible; no data change.

-- opening_setup_items: migration 0054 granted end-user DELETE/UPDATE (KH+/level>=4).
drop policy if exists opening_setup_items_update_policy on public.opening_setup_items;
drop policy if exists opening_setup_items_delete_policy on public.opening_setup_items;
create policy opening_setup_items_no_user_update on public.opening_setup_items for update using (false);
create policy opening_setup_items_no_user_delete on public.opening_setup_items for delete using (false);

-- pm_reports: migration 0072 granted KH+ unrestricted column UPDATE (backdate
-- submitted_at, reassign MVP, resurrect a superseded report by nulling superseded_at).
-- Deny end-user UPDATE; all writes are service-role + app-gated. DELETE already denied.
drop policy if exists pm_reports_update on public.pm_reports;
create policy pm_reports_no_user_update on public.pm_reports for update using (false);
