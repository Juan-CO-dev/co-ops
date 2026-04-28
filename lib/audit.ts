/**
 * Audit logger — Phase 6.
 *
 * recordAudit({ actor, action, resourceTable, resourceId, before?, after?, metadata? }):
 *   - Inserts into audit_log via service role (RLS denies direct user write)
 *   - Sets destructive=true if action is in DESTRUCTIVE_ACTIONS
 *   - Captures actor_role from session at time of action
 *   - Includes IP and user agent from request
 *
 * Wired into every admin-tool mutation. No exceptions.
 */
export {};
