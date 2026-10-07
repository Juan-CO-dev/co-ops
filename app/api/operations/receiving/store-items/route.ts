import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { loadReceivingFormData, ReceivingError } from "@/lib/receiving";
import { createStoreItem } from "@/lib/receiving-stores";

export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const ctx = await requireSession(req, "/api/operations/receiving/store-items");
  if (ctx instanceof Response) return ctx;
  const raw = await parseJsonBody(req);
  if (raw instanceof Response) return raw;
  if (!raw || typeof raw !== "object") return jsonError(400, "invalid_payload");
  const b = raw as Record<string, unknown>;
  if (typeof b.locationId !== "string" || typeof b.storeId !== "string" ||
    (b.referenceSkuId !== undefined && typeof b.referenceSkuId !== "string") ||
    (b.requestId !== undefined && typeof b.requestId !== "string")) return jsonError(400, "invalid_payload");
  try {
    const { skuId } = await createStoreItem(ctx, { locationId: b.locationId, storeId: b.storeId,
      referenceSkuId: b.referenceSkuId, requestId: b.requestId, name: b.name, countUnit: b.countUnit, contentOz: b.contentOz });
    const { skus } = await loadReceivingFormData(ctx, b.locationId);
    const sku = skus.find((s) => s.id === skuId);
    if (!sku) throw new ReceivingError(409, "sku_not_available");
    return jsonOk({ sku }, 201);
  } catch (e) {
    if (e instanceof ReceivingError) return jsonError(e.status, e.code);
    throw e;
  }
}
