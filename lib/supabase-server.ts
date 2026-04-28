/**
 * Server-side Supabase clients — Phase 1.
 *
 * Two factories:
 *   - createServerClient(jwt): per-request, RLS-enforcing
 *   - createServiceRoleClient(): bypasses RLS — use sparingly
 *     (audit log inserts, supersession updates, prep resolution generation)
 */
export {};
