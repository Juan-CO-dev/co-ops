import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { loadSkus, createSku, AdminSkuError, type CreateSkuInput } from "@/lib/admin/skus";

// GET — list SKUs (≥6). Optional ?vendorId=<uuid> filters to a vendor;
//   ?vendorId=none → manual / vendor-less SKUs only; absent → all.
// POST — create a SKU (GM+ ≥7, Tier B). vendor_id + location_id optional (null
//   = manual / global). The lib enforces ≥7.
export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/admin/skus");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 6) return jsonError(403, "forbidden");

  const vendorParam = req.nextUrl.searchParams.get("vendorId");
  let opts: { vendorId?: string | null } | undefined;
  if (vendorParam !== null) {
    opts = { vendorId: vendorParam === "none" ? null : vendorParam };
  }

  try {
    const skus = await loadSkus(ctx, opts);
    return jsonOk({ skus });
  } catch (e) {
    if (e instanceof AdminSkuError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/skus");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.name !== "string" || typeof b.unit !== "string") {
    return jsonError(400, "invalid_payload", { message: "name and unit are required" });
  }
  // vendorId / locationId: string id, or null (manual / global). Anything else invalid.
  if (b.vendorId !== undefined && b.vendorId !== null && typeof b.vendorId !== "string") {
    return jsonError(400, "invalid_payload", { field: "vendorId" });
  }
  if (b.locationId !== undefined && b.locationId !== null && typeof b.locationId !== "string") {
    return jsonError(400, "invalid_payload", { field: "locationId" });
  }
  if (b.leadTimeDays !== undefined && b.leadTimeDays !== null && typeof b.leadTimeDays !== "number") {
    return jsonError(400, "invalid_payload", { field: "leadTimeDays" });
  }

  const input: CreateSkuInput = {
    vendorId: typeof b.vendorId === "string" ? b.vendorId : null,
    locationId: typeof b.locationId === "string" ? b.locationId : null,
    name: b.name,
    unit: b.unit,
    unitSize: typeof b.unitSize === "string" ? b.unitSize : null,
    itemNumber: typeof b.itemNumber === "string" ? b.itemNumber : null,
    sourceUrl: typeof b.sourceUrl === "string" ? b.sourceUrl : null,
    leadTimeDays: typeof b.leadTimeDays === "number" ? b.leadTimeDays : null,
    notes: typeof b.notes === "string" ? b.notes : null,
  };

  try {
    const { id } = await createSku(ctx, input);
    return jsonOk({ id }, 201);
  } catch (e) {
    if (e instanceof AdminSkuError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
