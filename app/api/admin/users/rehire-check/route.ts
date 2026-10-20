import { assertSameOrigin } from "@/lib/portal/csrf";
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { ADMIN_MIN_LEVEL } from "@/lib/admin/users";
import { findRehireMatches } from "@/lib/admin/employment";

/**
 * POST { phone?, toastGuid? } → the separated people (rehire `no` / owner OK needed) the new person matches by the SAME
 * normalized phone or the SAME Toast employee GUID — never by name (staff separations, 2026-10-20). A read posted as JSON
 * so the phone never rides in a URL; no step-up. Each match is redacted for this viewer (the chip; the reasons only for
 * owner / MoO / CGS and the GM of a shop the person belongs to).
 */
export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/users/rehire-check");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < ADMIN_MIN_LEVEL) return jsonError(403, "forbidden");
  const b = (parsed && typeof parsed === "object" ? parsed : {}) as { phone?: unknown; toastGuid?: unknown };
  if ((b.phone !== undefined && b.phone !== null && typeof b.phone !== "string") || (b.toastGuid !== undefined && b.toastGuid !== null && typeof b.toastGuid !== "string")) {
    return jsonError(400, "invalid_payload");
  }
  const check = await findRehireMatches(getServiceRoleClient(), { role: ctx.user.role, locations: ctx.locations }, {
    phone: typeof b.phone === "string" ? b.phone : null, toastGuids: typeof b.toastGuid === "string" ? [b.toastGuid] : [],
  });
  return jsonOk({ available: check.available, matches: check.matches });
}
