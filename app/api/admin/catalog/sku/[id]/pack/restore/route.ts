/**
 * POST /api/admin/catalog/sku/[id]/pack/restore — Restore from the History tab (catalog Phase 2a).
 * Body: { locationId: uuid | null, fromVersionId: uuid, expectedLiveVersionId: uuid | null }.
 * Restore makes a NEW version based on the old one — never a delete, never a revive.
 */
import { type NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { restoreSkuPackVersion, SkuVersionError } from "@/lib/admin/sku-versions";
import { SHOP_VERSION_WRITE_MIN } from "@/lib/sku-versions-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optUuid = (v: unknown): string | null | undefined =>
  v === null || v === undefined ? null : typeof v === "string" && UUID_RE.test(v) ? v : undefined;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/sku/${id}/pack/restore`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < SHOP_VERSION_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);

  const b = (parsed ?? {}) as Record<string, unknown>;
  const locationId = optUuid(b.locationId);
  if (locationId === undefined) return jsonError(400, "invalid_payload", { field: "locationId" });
  const expected = optUuid(b.expectedLiveVersionId);
  if (expected === undefined) return jsonError(400, "invalid_payload", { field: "expectedLiveVersionId" });
  if (typeof b.fromVersionId !== "string" || !UUID_RE.test(b.fromVersionId)) return jsonError(400, "invalid_payload", { field: "fromVersionId" });
  try {
    const r = await restoreSkuPackVersion(ctx, { skuId: id, scope: locationId, fromVersionId: b.fromVersionId, expectedLiveVersionId: expected });
    return jsonOk({ versionId: r.versionId, retiredVersionId: r.retiredVersionId }, 201);
  } catch (e) {
    if (e instanceof SkuVersionError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
