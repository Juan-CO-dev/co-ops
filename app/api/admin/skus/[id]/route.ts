import { assertSameOrigin } from "@/lib/portal/csrf";
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { consumeStepUpGrant } from "@/lib/admin/step-up-grants";
import { isUuid } from "@/lib/admin/step-up-shared";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { updateSku, deactivateSku, AdminSkuError, isSkuClass, type UpdateSkuChanges } from "@/lib/admin/skus";
import type { SkuClass } from "@/lib/admin/catalog-shared";

// PATCH — body discriminates (one concern per call, like the vendors route):
//   {active:false}       → deactivateSku  (GM+ ≥7, one-shot grant "sku.deactivate" — asks every time)
//   {active:true}        → deactivateSku  (GM+ ≥7, Tier E — reactivation is an ordinary edit)
//   else (other fields)  → updateSku      (GM+ ≥7, Tier E — the 15-minute catalog edit window)
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
  "eachContainerLabel",
  "avgOzPerEach",
  "itemNumber",
  "sourceUrl",
  "leadTimeDays",
  "weekdayPar",
  "weekendPar",
  "notes",
  "skuClass",
  // Product membership (0179). Key-present null = detach to implicit singleton.
  "productId",
  // Ordering rhythm (0182). Key-present null clears; the form omits both keys entirely
  // until the migration applies, and the lib 503s if one arrives while it has not.
  "cushionClass",
  "parStep",
] as const;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
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

  // GM+. Deactivating a SKU is destructive: a ONE-SHOT grant for exactly this SKU (catalog
  // Phase 1, Astra r1 P1-2). Every other write here rides the 15-minute edit window.
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  if (hasActive && b.active === false) {
    if (!isUuid(id)) return jsonError(400, "invalid_id");
    const grant = await consumeStepUpGrant(ctx, "sku.deactivate", id);
    if (!grant.ok) return jsonError(403, grant.code);
  } else {
    const su = assertStepUp(ctx, "E");
    if (!su.ok) return jsonError(403, su.code);
  }

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
    if ("eachContainerLabel" in b) {
      if (b.eachContainerLabel !== null && typeof b.eachContainerLabel !== "string") return jsonError(400, "invalid_payload", { field: "eachContainerLabel" });
      changes.eachContainerLabel = b.eachContainerLabel as string | null;
    }
    if ("avgOzPerEach" in b) {
      if (b.avgOzPerEach !== null && typeof b.avgOzPerEach !== "number") return jsonError(400, "invalid_payload", { field: "avgOzPerEach" });
      changes.avgOzPerEach = b.avgOzPerEach as number | null;
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
    if ("weekdayPar" in b) {
      if (b.weekdayPar !== null && typeof b.weekdayPar !== "number") return jsonError(400, "invalid_payload", { field: "weekdayPar" });
      changes.weekdayPar = b.weekdayPar as number | null;
    }
    if ("weekendPar" in b) {
      if (b.weekendPar !== null && typeof b.weekendPar !== "number") return jsonError(400, "invalid_payload", { field: "weekendPar" });
      changes.weekendPar = b.weekendPar as number | null;
    }
    if ("notes" in b) {
      if (b.notes !== null && typeof b.notes !== "string") return jsonError(400, "invalid_payload", { field: "notes" });
      changes.notes = b.notes as string | null;
    }
    if ("skuClass" in b) {
      if (!isSkuClass(b.skuClass)) return jsonError(400, "invalid_payload", { field: "skuClass" });
      changes.skuClass = b.skuClass as SkuClass;
    }
    if ("productId" in b) {
      if (b.productId !== null && typeof b.productId !== "string") return jsonError(400, "invalid_payload", { field: "productId" });
      changes.productId = b.productId as string | null;
    }
    if ("cushionClass" in b) {
      if (b.cushionClass !== null && typeof b.cushionClass !== "string") return jsonError(400, "invalid_payload", { field: "cushionClass" });
      changes.cushionClass = b.cushionClass as string | null;
    }
    if ("parStep" in b) {
      if (b.parStep !== null && typeof b.parStep !== "number") return jsonError(400, "invalid_payload", { field: "parStep" });
      changes.parStep = b.parStep as number | null;
    }

    await updateSku(ctx, { id, changes });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminSkuError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
