/**
 * Audit logger — Phase 2.
 *
 * Single helper. Service-role-only (RLS denies direct user writes to
 * audit_log; service-role bypasses).
 *
 * Failure semantics: audit failures MUST NOT break the calling flow. If the
 * insert fails, log to console and return; the caller's request continues.
 * Audit log is forensic evidence — losing one entry is bad, but breaking the
 * user-facing operation because logging failed is worse.
 *
 * Append-only: orphaned resource_id values are expected and acceptable. The
 * row containing the audit event is the source of truth for "what happened";
 * the resource it referred to may have been deactivated, superseded, or in
 * test/smoke contexts cleaned up. Auditors investigating audit_log entries
 * should not assume resource_id always points to an existing row.
 *
 * destructive flag: auto-derived from isDestructive(action) — actions listed
 * in DESTRUCTIVE_ACTIONS get destructive=true. Callers don't pass it.
 *
 * Schema convention: audit_log has no dedicated ip_address / user_agent
 * columns. The helper merges those caller-supplied fields into the metadata
 * JSONB under the keys `ip_address` and `user_agent`. All callers must pass
 * them top-level on AuditInput (even as null) — never bury them in their
 * own metadata. Auditors querying audit_log can reliably read
 * `metadata->>'ip_address'` and `metadata->>'user_agent'` without looking
 * elsewhere.
 */

import { getServiceRoleClient } from "./supabase-server";
import { isDestructive } from "./destructive-actions";
import type { RoleCode } from "./roles";

export interface AuditInput {
  actorId: string | null;
  actorRole: RoleCode | null;
  action: string;
  resourceTable: string;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
}

export async function audit(input: AuditInput): Promise<void> {
  try {
    const sb = getServiceRoleClient();
    const { error } = await sb.from("audit_log").insert({
      actor_id: input.actorId,
      actor_role: input.actorRole,
      action: input.action,
      resource_table: input.resourceTable,
      resource_id: input.resourceId,
      metadata: {
        ...input.metadata,
        ip_address: input.ipAddress,
        user_agent: input.userAgent,
      },
      destructive: isDestructive(input.action),
    });
    if (error) {
      console.error(`[audit] insert failed for action=${input.action}:`, error.message);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[audit] unexpected error for action=${input.action}:`, msg);
  }
}
