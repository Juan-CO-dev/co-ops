import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { upsertLocationSkuSettings, AdminSkuError, SKU_WRITE_MIN } from "@/lib/admin/skus";

// PUT — upsert the per-(location, sku) overlay row (VO-7). GM+ (≥7), Tier A —
// mirrors a SKU edit / pack-chain replace (a SKU write). Body:
//   { locationId, activeOverride: true|false|null, weekdayPar: number|null,
//     weekendPar: number|null }
// Tri-state: null on activeOverride = inherit global; null on a par = inherit the
// global par. Upsert-in-place keyed on (location_id, sku_id); revert-to-all-inherit
// nulls the fields (never a delete — append-only).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/skus/${id}/location-settings`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < SKU_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.locationId !== "string" || !b.locationId) {
    return jsonError(400, "invalid_payload", { field: "locationId" });
  }
  // activeOverride: true | false | null (inherit). Anything else is invalid.
  const activeOverride =
    b.activeOverride === null || b.activeOverride === undefined
      ? null
      : b.activeOverride === true || b.activeOverride === false
        ? b.activeOverride
        : undefined;
  if (activeOverride === undefined) return jsonError(400, "invalid_payload", { field: "activeOverride" });

  const weekdayPar =
    b.weekdayPar === null || b.weekdayPar === undefined
      ? null
      : typeof b.weekdayPar === "number"
        ? b.weekdayPar
        : undefined;
  if (weekdayPar === undefined) return jsonError(400, "invalid_payload", { field: "weekdayPar" });

  const weekendPar =
    b.weekendPar === null || b.weekendPar === undefined
      ? null
      : typeof b.weekendPar === "number"
        ? b.weekendPar
        : undefined;
  if (weekendPar === undefined) return jsonError(400, "invalid_payload", { field: "weekendPar" });

  try {
    await upsertLocationSkuSettings(ctx, {
      skuId: id,
      locationId: b.locationId,
      activeOverride,
      weekdayPar,
      weekendPar,
    });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminSkuError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
