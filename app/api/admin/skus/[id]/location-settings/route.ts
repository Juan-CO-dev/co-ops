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
//
// ── THE MACHINE-LANE BYPASS IS CLOSED HERE, STRUCTURALLY (Dynamic Pars, r3) ────────
// NO BEHAVIOUR CHANGE in this file — it is recorded because r3 requires the exclusion to
// be explicit. The body parser below is an EXPLICIT FIELD LIST: locationId,
// activeOverride, weekdayPar, weekendPar. Migration 0183's auto_* / pinned_* columns are
// not read from `b` anywhere, so no operator payload can reach them; an unknown key is
// simply ignored. What an admin edit DOES to the machine's lane (null the auto value, the
// baseline, the stamp, and clear the pin — on the slots whose value actually changed) is
// decided by parWriteColumns() in lib/dynamic-pars-shared.ts, the one authority every par
// writer resolves its columns through. This route keeps its own Tier-A step-up; only the
// walker's accept/dismiss/revert drop it (plan D2).
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
