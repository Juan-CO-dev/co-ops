/**
 * POST /api/admin/catalog/sku/[id]/pack/apply — "It arrives differently now", saved (catalog Phase 2b).
 * Body: { target: { kind: "shop", shopId } | { kind: "global" }, levels: [...],
 *         conversions: [{ locationId: uuid | null, slot, expected, to }], requestId?: uuid | null,
 *         previewToken: string }
 * Tier E. ONE transaction (apply_sku_pack_change): the version, the accepted conversions bound to the
 * values the person was shown, and the door report. A stale preview is 409 preview_stale.
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { applyPackChange, CatalogItemError } from "@/lib/catalog/sku-item";
import { parseConversions, parseLevels, parseTarget } from "@/lib/catalog/sku-item-shared";
import { SHOP_VERSION_WRITE_MIN } from "@/lib/sku-versions-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/sku/${id}/pack/apply`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < SHOP_VERSION_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);

  const b = (parsed ?? {}) as Record<string, unknown>;
  const target = parseTarget(b.target);
  if (!target) return jsonError(400, "invalid_payload", { field: "target" });
  const levels = parseLevels(b.levels);
  if (!levels) return jsonError(400, "invalid_payload", { field: "levels" });
  const conversions = parseConversions(b.conversions);
  if (!conversions) return jsonError(400, "invalid_payload", { field: "conversions" });
  const requestId = b.requestId === null || b.requestId === undefined ? null
    : typeof b.requestId === "string" && UUID_RE.test(b.requestId) ? b.requestId : undefined;
  if (requestId === undefined) return jsonError(400, "invalid_payload", { field: "requestId" });
  const previewToken = typeof b.previewToken === "string" && /^[0-9a-f]{8}$/.test(b.previewToken) ? b.previewToken : null;
  if (!previewToken) return jsonError(400, "invalid_payload", { field: "previewToken" });
  try {
    const r = await applyPackChange(ctx, { skuId: id, target, levels, conversions, requestId, previewToken });
    return jsonOk(r, 201);
  } catch (e) {
    if (e instanceof CatalogItemError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
