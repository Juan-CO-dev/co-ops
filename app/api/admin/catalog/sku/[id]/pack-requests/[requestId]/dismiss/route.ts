/**
 * POST …/pack-requests/[requestId]/dismiss — "Nothing changed": close a door report (catalog Phase 2b).
 * Tier E. The report must belong to the SKU in the path (a report for another item is not found here).
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { dismissPackChangeRequest, PackChangeRequestError } from "@/lib/pack-change-requests";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; requestId: string }> }) {
  const { id, requestId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(requestId)) return jsonError(404, "not_found");
  const ctx = await requireSession(req, `/api/admin/catalog/sku/${id}/pack-requests/${requestId}/dismiss`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < 6) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);
  try {
    await dismissPackChangeRequest(ctx, { requestId, skuId: id });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof PackChangeRequestError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
