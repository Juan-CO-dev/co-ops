import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { setItemPar, AdminTemplateError } from "@/lib/admin/templates";
import { type ParMode } from "@/lib/types";

// PER-LOCATION par OVERRIDE for the item linked to a prep line. Writes
// item_par_levels (not the global items row). AGM+, Tier A.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/checklist-templates/${id}/items/${itemId}/par`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 6) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  const locationId = b.locationId;
  if (typeof locationId !== "string" || !locationId) {
    return jsonError(400, "invalid_payload", { field: "locationId" });
  }
  const parMode = b.parMode;
  if (parMode !== "inherit" && parMode !== "manual" && parMode !== "auto") {
    return jsonError(400, "invalid_par_mode", { field: "parMode" });
  }
  const dayOfWeek =
    b.dayOfWeek === null || typeof b.dayOfWeek === "number" ? (b.dayOfWeek as number | null) : null;
  const parValue =
    b.parValue === null || typeof b.parValue === "number" ? (b.parValue as number | null) : null;
  const parUnit =
    b.parUnit === null || typeof b.parUnit === "string" ? (b.parUnit as string | null) : null;

  try {
    await setItemPar(ctx, {
      templateId: id,
      lineItemId: itemId,
      locationId,
      dayOfWeek,
      parValue,
      parUnit,
      parMode: parMode as ParMode,
    });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminTemplateError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
