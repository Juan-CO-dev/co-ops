/**
 * The report family's role rule (nav spec r3, section 8.2, PR S1). Pure and client-safe.
 *
 * The social media manager is treated as an adversarial role ("we can't outright show them our
 * numbers"), so EVERY report surface refuses it: each page under app/(authed)/reports/**, the export
 * route (CSV and PDF, every family), the written-report routes and the export loader. The rule is by
 * ROLE, never by level: the role is level 6, the same as the AGM, prep and catering managers, who keep
 * exactly what they had. It reads the REAL role (the session's `role` claim); a scheduling "works as"
 * role never reaches it (lib/scheduling/works-as-shared.ts says the same of every authorization).
 *
 * Every report gate calls this as its first statement after the session, before any read.
 * tests/reports-smm-refusal.test.ts is the census: a report page or route without it fails.
 */
import type { RoleCode } from "@/lib/roles";

/** Roles the whole report family refuses. Closed list; adding a role here closes every report surface to it. */
export const REPORTS_REFUSED_ROLES: readonly RoleCode[] = ["social_media_mgr"];

export function reportsRoleAllowed(role: RoleCode): boolean {
  return !REPORTS_REFUSED_ROLES.includes(role);
}

/** Where a refused report page sends the person: the Dashboard, with the denial notice. */
export const REPORTS_DENIED_HREF = "/dashboard?denied=reports";
