import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { ADMIN_MIN_LEVEL } from "@/lib/admin/users";
import { LinkError, toastRosterForPicker, whosHereEnabled } from "@/lib/toast/employee-links";

/**
 * GET ?location=<shop>: the shop's Toast employees for the Add user picker (staff separations, 2026-10-20). A read: no
 * step-up. GM own shop / MoO+ (the Toast link bind, in the lib). Off (404) until who's-here is on (0233).
 */
export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/admin/users/toast-roster");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < ADMIN_MIN_LEVEL) return jsonError(403, "forbidden");
  if (!whosHereEnabled()) return jsonError(404, "not_enabled");
  const locationId = new URL(req.url).searchParams.get("location") ?? "";
  try {
    const employees = await toastRosterForPicker(getServiceRoleClient(), {
      actor: { userId: ctx.user.id, role: ctx.user.role, level: ROLES[ctx.user.role].level, locations: ctx.locations }, locationId,
    });
    return jsonOk({ employees });
  } catch (e) {
    if (e instanceof LinkError) return jsonError(e.status, e.code);
    // A Toast failure names a fixed code, never provider text.
    return jsonError(502, e instanceof Error && /^toast_employees_/.test(e.message) ? e.message : "toast_employees_failed");
  }
}
