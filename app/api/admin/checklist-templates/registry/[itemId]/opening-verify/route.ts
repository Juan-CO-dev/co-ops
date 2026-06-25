import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { setItemOpeningVerify, AdminTemplateError } from "@/lib/admin/templates";

// Toggle whether an item is included in Opening verification. Turning it on
// creates the item's am_prep→Opening mirror at each location; off deactivates
// it. MoO+ (≥8), Tier B.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const { itemId } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/checklist-templates/registry/${itemId}/opening-verify`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 8) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.openingVerify !== "boolean") return jsonError(400, "invalid_payload", { field: "openingVerify" });
  try {
    const result = await setItemOpeningVerify(ctx, { itemId, openingVerify: b.openingVerify });
    return jsonOk(result);
  } catch (e) {
    if (e instanceof AdminTemplateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
