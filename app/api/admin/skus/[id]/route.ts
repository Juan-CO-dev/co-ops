import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { updateSku, deactivateSku, AdminSkuError, type UpdateSkuChanges } from "@/lib/admin/skus";

// PATCH — body discriminates (one concern per call, like the vendors route):
//   {active}-only        → deactivateSku  (GM+ ≥7, Tier A)
//   else (other fields)  → updateSku      (GM+ ≥7, Tier A)
// Mixing `active` with other fields is rejected. The route floors ≥6;
// the lib write fns enforce ≥7.
const UPDATE_KEYS = [
  "vendorId",
  "locationId",
  "name",
  "packFormat",
  "unitsPerPack",
  "eachSize",
  "eachMeasure",
  "itemNumber",
  "sourceUrl",
  "leadTimeDays",
  "notes",
] as const;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/skus/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 6) return jsonError(403, "forbidden");

  const b = parsed as Record<string, unknown>;
  const hasActive = "active" in b;
  const hasUpdate = UPDATE_KEYS.some((k) => k in b);

  if (!hasActive && !hasUpdate) {
    return jsonError(400, "invalid_payload", { message: "No recognized fields to update" });
  }
  if (hasActive && hasUpdate) {
    return jsonError(400, "mixed_concerns", { message: "active must be the only field when toggling activation" });
  }

  // Both deactivate + update are GM+ Tier A.
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  try {
    if (hasActive) {
      if (typeof b.active !== "boolean") return jsonError(400, "invalid_payload", { field: "active" });
      await deactivateSku(ctx, { id, active: b.active });
      return jsonOk({ ok: true });
    }

    const changes: UpdateSkuChanges = {};
    if ("vendorId" in b) {
      if (b.vendorId !== null && typeof b.vendorId !== "string") return jsonError(400, "invalid_payload", { field: "vendorId" });
      changes.vendorId = b.vendorId as string | null;
    }
    if ("locationId" in b) {
      if (b.locationId !== null && typeof b.locationId !== "string") return jsonError(400, "invalid_payload", { field: "locationId" });
      changes.locationId = b.locationId as string | null;
    }
    if ("name" in b) {
      if (typeof b.name !== "string") return jsonError(400, "invalid_payload", { field: "name" });
      changes.name = b.name;
    }
    if ("packFormat" in b) {
      if (typeof b.packFormat !== "string") return jsonError(400, "invalid_payload", { field: "packFormat" });
      changes.packFormat = b.packFormat;
    }
    if ("unitsPerPack" in b) {
      if (b.unitsPerPack !== null && typeof b.unitsPerPack !== "number") return jsonError(400, "invalid_payload", { field: "unitsPerPack" });
      changes.unitsPerPack = b.unitsPerPack as number | null;
    }
    if ("eachSize" in b) {
      if (b.eachSize !== null && typeof b.eachSize !== "number") return jsonError(400, "invalid_payload", { field: "eachSize" });
      changes.eachSize = b.eachSize as number | null;
    }
    if ("eachMeasure" in b) {
      if (b.eachMeasure !== null && typeof b.eachMeasure !== "string") return jsonError(400, "invalid_payload", { field: "eachMeasure" });
      changes.eachMeasure = b.eachMeasure as string | null;
    }
    if ("itemNumber" in b) {
      if (b.itemNumber !== null && typeof b.itemNumber !== "string") return jsonError(400, "invalid_payload", { field: "itemNumber" });
      changes.itemNumber = b.itemNumber as string | null;
    }
    if ("sourceUrl" in b) {
      if (b.sourceUrl !== null && typeof b.sourceUrl !== "string") return jsonError(400, "invalid_payload", { field: "sourceUrl" });
      changes.sourceUrl = b.sourceUrl as string | null;
    }
    if ("leadTimeDays" in b) {
      if (b.leadTimeDays !== null && typeof b.leadTimeDays !== "number") return jsonError(400, "invalid_payload", { field: "leadTimeDays" });
      changes.leadTimeDays = b.leadTimeDays as number | null;
    }
    if ("notes" in b) {
      if (b.notes !== null && typeof b.notes !== "string") return jsonError(400, "invalid_payload", { field: "notes" });
      changes.notes = b.notes as string | null;
    }

    await updateSku(ctx, { id, changes });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminSkuError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
