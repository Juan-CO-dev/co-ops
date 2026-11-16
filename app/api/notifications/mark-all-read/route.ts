import { type NextRequest } from "next/server";

import { jsonError, jsonOk } from "@/lib/api-helpers";
import { markAllNotificationsRead, notificationLocationContext } from "@/lib/notifications";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

/**
 * POST /api/notifications/mark-all-read — "Mark all read" on the dashboard
 * notification widget (owner decision W26-5 b).
 *
 * Same-origin FIRST, then the session. The client sends nothing but the
 * intent: the user is the session user and the location context is the one
 * the widget reads with (`notificationLocationContext`), so it marks exactly
 * what the widget can show. Answers `{ marked: n }` = rows actually changed.
 * Not audited (routine self-act, like the per-item mark-read).
 */
export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const ctx = await requireSession(req, "/api/notifications/mark-all-read");
  if (ctx instanceof Response) return ctx;

  try {
    const { marked } = await markAllNotificationsRead(getServiceRoleClient(), {
      userId: ctx.user.id,
      locationContext: notificationLocationContext(ctx),
    });
    return jsonOk({ marked });
  } catch (err) {
    console.error("mark-all-read failed:", err instanceof Error ? err.message : String(err));
    return jsonError(500, "server_error");
  }
}
