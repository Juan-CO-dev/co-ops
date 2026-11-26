"use server";

/**
 * The bell's per-item "mark read" Server Action (Build #3 PR 3 Step 7; moved here by nav PR 9, plan r2 3.4).
 *
 * The bell now lives in the top bar on every signed-in page, so the action left the Dashboard tree. It also sits outside
 * `app/admin/**`, so the admin server-action census (spec 8.2 rule 1) never meets it.
 *
 * Order: the session, checked with the step-up NEUTRAL label `/api/notifications/mark-read` (a tap on a notice inside
 * admin neither keeps nor clears the unlock; it used to pass "/dashboard" and clear it) → the S1 rule by the session's
 * real role (`bell_refused` before any read or write: the social media manager) → `markNotificationRead`, whose
 * `WHERE user_id` is the access control on the service-role client. No `revalidatePath`: the bell island refetches.
 *
 * Idempotency: markNotificationRead returns { newlyMarked } and preserves the original read_at on a second call.
 */

import { notificationBellRoleAllowed } from "@/lib/notification-bell-shared";
import { markNotificationRead } from "@/lib/notifications";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

/** The action's session label: step-up neutral (lib/session.ts STEP_UP_NEUTRAL_PATHS). It has no URL of its own. */
const MARK_READ_SESSION_PATH = "/api/notifications/mark-read";

export interface MarkNotificationReadResult {
  ok: boolean;
  /** True when this call landed read_at; false when already read. */
  newlyMarked?: boolean;
  /** Stable error code for client-side error handling. `bell_refused`: this person gets no bell (the island clears). */
  errorCode?: "missing_recipient_id" | "not_authorized" | "server_error" | "bell_refused";
}

export async function markNotificationReadAction(args: {
  recipientId: string;
}): Promise<MarkNotificationReadResult> {
  if (!args.recipientId || typeof args.recipientId !== "string") {
    return { ok: false, errorCode: "missing_recipient_id" };
  }

  const auth = await requireSessionFromHeaders(MARK_READ_SESSION_PATH);
  if (!notificationBellRoleAllowed(auth.role)) return { ok: false, errorCode: "bell_refused" };
  const sb = getServiceRoleClient();

  try {
    const { newlyMarked } = await markNotificationRead(sb, {
      recipientId: args.recipientId,
      userId: auth.user.id,
    });
    return { ok: true, newlyMarked };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Authorization failure (cross-user attempt) surfaces as the lib's
    // "recipient not found OR user_id mismatch" error string. Map to
    // a stable client-facing code without leaking internals.
    if (message.includes("user_id mismatch") || message.includes("not found")) {
      return { ok: false, errorCode: "not_authorized" };
    }
    console.error("markNotificationReadAction failed:", message);
    return { ok: false, errorCode: "server_error" };
  }
}
