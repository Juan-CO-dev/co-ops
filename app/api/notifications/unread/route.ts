/**
 * GET /api/notifications/unread — the top bar's bell refresh (nav PR 9, plan r2 3.3, 4.3; lead rulings r1 F3, F5, F7).
 *
 * Order: the session (its own path, which is step-up NEUTRAL) → the S1 rule by the session's real role, 403
 * `bell_refused` BEFORE any read (the social media manager) → the bar's one bell unit (lib/top-bar-bell.ts: the unread
 * read and the shop-code read under ONE 6 s deadline) → `{ notices, locationCodes }`, exactly those keys. `locationCodes`
 * holds exactly the distinct shops of the returned notices, read fresh per response; the client replaces both together.
 * A failure or a timeout is 503 `notifications_unavailable` (the bell then shows "unavailable" or keeps its last good
 * list), never an empty list. Read-only GET: no same-origin check.
 */
import { type NextRequest } from "next/server";

import { jsonError, jsonOk } from "@/lib/api-helpers";
import { notificationBellRoleAllowed } from "@/lib/notification-bell-shared";
import { requireSession } from "@/lib/session";
import { loadBellUnit } from "@/lib/top-bar-bell";

function noStore<T extends Response>(res: T): T {
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/notifications/unread");
  if (ctx instanceof Response) return ctx;
  if (!notificationBellRoleAllowed(ctx.role)) return noStore(jsonError(403, "bell_refused"));

  const unit = loadBellUnit(ctx);
  if (!unit) return noStore(jsonError(403, "bell_refused"));
  const r = await unit;
  if (r.kind !== "ok") return noStore(jsonError(503, "notifications_unavailable"));
  return noStore(jsonOk({ notices: r.value.notices, locationCodes: r.value.locationCodes }));
}
