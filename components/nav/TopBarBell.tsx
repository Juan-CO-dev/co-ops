/**
 * The top bar's bell, streamed (nav PR 9, plan r2 3.1, 4.2; lead rulings r1 F3, F5). Async server component, rendered
 * by NavFrame inside a <Suspense> so the page shell never waits for it.
 *
 * First statement: the S1 rule by the session's real role (the social media manager gets no read and no bell; NavFrame
 * also passes no bell for that role, so this is the second line). Then the bar's one bell unit (lib/top-bar-bell.ts):
 * the unread read and the shop-code read under ONE 6 s deadline. `ok` → the island with the list; `failed` /
 * `timed_out` → the island "unavailable" (never a 0 badge). It never rejects. The island is keyed by role and session,
 * so a later allowed render (a new person at the tablet, a role change) mounts a fresh island: nothing leaves `refused`.
 */
import "server-only";
import type { AuthContext } from "@/lib/session";
import { notificationBellRoleAllowed } from "@/lib/notification-bell-shared";
import { loadBellUnit } from "@/lib/top-bar-bell";

import { BellIsland } from "./BellIsland";

export async function TopBarBell({ auth }: { auth: AuthContext }) {
  if (!notificationBellRoleAllowed(auth.role)) return null;
  const unit = loadBellUnit(auth);
  if (!unit) return null;
  const r = await unit;
  return <BellIsland key={`${auth.role}:${auth.session.id}`} initial={r.kind === "ok" ? r.value : null} />;
}
