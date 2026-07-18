import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import {
  deactivateRateRule,
  AdminCateringRateError,
  RATE_MIN,
} from "@/lib/admin/catering/rate-rules";

// DELETE — deactivate a location's active rate rule (append-only: active=false, never DELETE row).
//   MoO+ (>=8), Tier B (financial). locationId from the query string.

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ ruleId: string }> }) {
  const { ruleId } = await params;
  const ctx = await requireSession(req, `/api/admin/catering/rate-rules/${ruleId}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < RATE_MIN) return jsonError(403, "forbidden");

  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const locationId = req.nextUrl.searchParams.get("locationId");
  if (!locationId) return jsonError(400, "invalid_payload", { field: "locationId" });

  try {
    await deactivateRateRule(ctx, { ruleId, locationId });
    return jsonOk({});
  } catch (e) {
    if (e instanceof AdminCateringRateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
