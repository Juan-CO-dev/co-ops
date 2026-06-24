import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { addUnit, AdminTemplateError } from "@/lib/admin/templates";

// Add a canonical par unit to the registry. Global — affects every location's
// unit dropdown. MoO+ (≥8), Tier B. The label is the unique system key.
export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/checklist-templates/units");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 8) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.label !== "string" || !b.label.trim()) {
    return jsonError(400, "invalid_label", { field: "label" });
  }

  try {
    await addUnit(ctx, { label: b.label });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminTemplateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
