import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { loadReceivingFormData, ReceivingError } from "@/lib/receiving";
import { loadPendingStoreItems, resolvePendingStoreItem } from "@/lib/receiving-stores";

const PATH = "/api/admin/skus/pending";
export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, PATH);
  if (ctx instanceof Response) return ctx;
  const locationId = req.nextUrl.searchParams.get("locationId") ?? "";
  try {
    const items = await loadPendingStoreItems(ctx, locationId);
    const { skus } = await loadReceivingFormData(ctx, locationId);
    const pending = new Set(items.map((i) => i.id));
    return jsonOk({ items, skus: skus.filter((s) => !pending.has(s.id)) });
  } catch (e) {
    if (e instanceof ReceivingError) return jsonError(e.status, e.code);
    throw e;
  }
}

export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const ctx = await requireSession(req, PATH);
  if (ctx instanceof Response) return ctx;
  const step = assertStepUp(ctx, "B");
  if (!step.ok) return jsonError(403, step.code);
  const raw = await parseJsonBody(req);
  if (raw instanceof Response) return raw;
  if (!raw || typeof raw !== "object") return jsonError(400, "invalid_payload");
  const b = raw as Record<string, unknown>;
  if (typeof b.locationId !== "string" || typeof b.skuId !== "string" || typeof b.referenceSkuId !== "string") {
    return jsonError(400, "invalid_payload");
  }
  try {
    return jsonOk(await resolvePendingStoreItem(ctx, { locationId: b.locationId, skuId: b.skuId, referenceSkuId: b.referenceSkuId, contentOz: b.contentOz }));
  } catch (e) {
    if (e instanceof ReceivingError) return jsonError(e.status, e.code);
    throw e;
  }
}
