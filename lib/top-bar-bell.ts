/**
 * The top bar's bell read (nav PR 9, plan r2 3.1 TopBarBell, 3.3, 4.2; lead ruling r1 F3). Server-only.
 *
 * ONE unit, used by the bar's streamed `TopBarBell` and by `GET /api/notifications/unread`:
 *   1. the S1 rule FIRST: `notificationBellRoleAllowed(auth.role)`, the session's real role. Refused → null, no read.
 *   2. ONE absolute deadline (6 s) over BOTH reads, the unread read and the shop-code read, on ONE signal: at the
 *      deadline, or when either read rejects, the signal aborts and `withAbortStrict` builds no further query.
 *   3. never rejects: `ok` with `{ notices, locationCodes }`, else `failed` / `timed_out` ("unavailable", never 0).
 * The reader, the location context and the filter it applies are today's, unchanged (lead ruling r1 F6).
 */
import "server-only";
import { notificationBellRoleAllowed } from "@/lib/notification-bell-shared";
import {
  loadNoticeLocationCodes,
  loadUnreadForUser,
  notificationLocationContext,
  type NotificationWithRecipient,
} from "@/lib/notifications";
import { withAbortStrict } from "@/lib/pulse/abort";
import type { RoleCode } from "@/lib/roles";
import { settleWithin, type Settled } from "@/lib/settle-by";
import { getServiceRoleClient } from "@/lib/supabase-server";

export const TOP_BAR_BELL_DEADLINE_MS = 6_000;

export interface BellData {
  readonly notices: NotificationWithRecipient[];
  /** location id → code, exactly for the shops on `notices`. */
  readonly locationCodes: Record<string, string>;
}

export interface BellViewer {
  readonly role: RoleCode;
  readonly level: number;
  readonly locations: string[];
  readonly user: { readonly id: string };
}

/** The bell's read for this viewer, or null (the rule refused: nothing was read). Never rejects. */
export function loadBellUnit(auth: BellViewer): Promise<Settled<BellData>> | null {
  if (!notificationBellRoleAllowed(auth.role)) return null;
  return settleWithin(async (signal) => {
    const sb = withAbortStrict(getServiceRoleClient(), signal);
    const notices = await loadUnreadForUser(sb, auth.user.id, { locationContext: notificationLocationContext(auth) });
    const locationCodes = await loadNoticeLocationCodes(sb, notices);
    return { notices, locationCodes };
  }, TOP_BAR_BELL_DEADLINE_MS, "top_bar.bell");
}
