/**
 * POST /api/admin/catalog/sku/[id]/price — record a price for a shop (its own lane) or the global
 * default (catalog Phase 2a). Body: { locationId: uuid | null, unitPrice: number, effectiveDate: "YYYY-MM-DD" }.
 * Global below MoO = a FIRST price only, decided under the SKU lock (save_sku_global_price).
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { saveSkuPrice, SkuVersionError } from "@/lib/admin/sku-versions";
import { SHOP_VERSION_WRITE_MIN } from "@/lib/sku-versions-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optUuid = (v: unknown): string | null | undefined =>
  v === null || v === undefined ? null : typeof v === "string" && UUID_RE.test(v) ? v : undefined;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/sku/${id}/price`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < SHOP_VERSION_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);

  const b = (parsed ?? {}) as Record<string, unknown>;
  const locationId = optUuid(b.locationId);
  if (locationId === undefined) return jsonError(400, "invalid_payload", { field: "locationId" });
  if (typeof b.unitPrice !== "number") return jsonError(400, "invalid_price", { field: "unitPrice" });
  if (typeof b.effectiveDate !== "string") return jsonError(400, "invalid_date", { field: "effectiveDate" });
  try {
    const r = await saveSkuPrice(ctx, { skuId: id, scope: locationId, unitPrice: b.unitPrice, effectiveDate: b.effectiveDate });
    return jsonOk({ priceId: r.priceId, laneId: r.laneId, laneCreated: r.laneCreated }, 201);
  } catch (e) {
    if (e instanceof SkuVersionError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
