/** Scheduling role overrides never change account authorization. Pure and client-safe. */
import type { RoleCode } from "@/lib/roles";

export const WORKS_AS_ROLES = ["employee", "trainer", "key_holder", "shift_lead"] as const;
export type WorksAsRole = (typeof WORKS_AS_ROLES)[number];
export function canWorkAs(role: RoleCode): boolean {
  return ["cgs", "social_media_mgr", "catering_mgr", "prep_mgr"].includes(role);
}
export function isWorksAsRole(value: unknown): value is WorksAsRole {
  return typeof value === "string" && (WORKS_AS_ROLES as readonly string[]).includes(value);
}
export function worksAsRefusal(role: RoleCode, value: unknown): "invalid_payload" | "works_as_refused" | null {
  if (value === null || value === undefined) return null;
  if (!canWorkAs(role)) return "works_as_refused";
  return isWorksAsRole(value) ? null : "invalid_payload";
}
export function effectiveScheduleRole(role: RoleCode, worksAs?: WorksAsRole | null): RoleCode {
  return canWorkAs(role) && isWorksAsRole(worksAs) ? worksAs : role;
}
