/**
 * Who gets the notification bell (nav spec r3, section 8.1 "Bell: none", PR S1). Pure and client-safe.
 *
 * The unread read (`loadUnreadForUser`) picks rows by recipient, unread state and shop, never by the
 * person's role today, so a notice stored under an earlier role (an under-par alert carrying the item,
 * the opener's name, the prepped amount, the par and the closer's count) would still be served after
 * the person becomes the social media manager. None of today's types is safe for that role, so for it
 * NO notification read is issued and NO bell is drawn, whatever is stored.
 *
 * By the REAL role only (the session's `role` claim). A scheduling "works as" role never changes it.
 * If the role's own feature later needs notices, it must add an explicit type allowlist (starting
 * empty) AND filter the read by it; never just remove the role from this list.
 */
import type { RoleCode } from "@/lib/roles";

/** Roles that get no notification read and no bell. */
export const BELL_REFUSED_ROLES: readonly RoleCode[] = ["social_media_mgr"];

export function notificationBellRoleAllowed(role: RoleCode): boolean {
  return !BELL_REFUSED_ROLES.includes(role);
}
