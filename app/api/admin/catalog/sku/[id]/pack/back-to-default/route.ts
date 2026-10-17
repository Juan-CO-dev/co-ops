/**
 * POST /api/admin/catalog/sku/[id]/pack/back-to-default — a shop drops its own pack version and
 * the global default answers for it again (catalog Phase 2a). Body: { locationId: uuid, versionId: uuid }.
 * The version row is retired (valid_to stamped), never deleted. Tier E; the lib binds the shop.
 */
import { type NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { retireShopPackVersion, SkuVersionError } from "@/lib/admin/sku-versions";
import { SHOP_VERSION_WRITE_MIN } from "@/lib/sku-versions-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/sku/${id}/pack/back-to-default`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < SHOP_VERSION_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);

  const b = (parsed ?? {}) as Record<string, unknown>;
  if (typeof b.locationId !== "string" || !UUID_RE.test(b.locationId)) return jsonError(400, "invalid_payload", { field: "locationId" });
  if (typeof b.versionId !== "string" || !UUID_RE.test(b.versionId)) return jsonError(400, "invalid_payload", { field: "versionId" });
  try {
    await retireShopPackVersion(ctx, { skuId: id, versionId: b.versionId, locationId: b.locationId });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof SkuVersionError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
