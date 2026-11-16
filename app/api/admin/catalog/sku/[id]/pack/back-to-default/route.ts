/**
 * POST /api/admin/catalog/sku/[id]/pack/back-to-default — a shop drops its own pack version and
 * the global default answers for it again (catalog Phase 2a). The version row is retired (valid_to
 * stamped), never deleted. Tier E; the lib binds the shop.
 * Body: { locationId: uuid, versionId: uuid, conversions: [...], previewToken: string }.
 * PREVIEWED (audit W18/B107): the page shows the par keep-or-convert rows first (preview kind
 * `pack_back_to_default`), and the retire and the accepted conversions land in ONE transaction (0324).
 * A client without a preview token (an old tab) is refused 409 `preview_required`, because a retire
 * that skips the conversion is the bug.
 */
import { type NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { applyPackBackToDefault, CatalogItemError } from "@/lib/catalog/sku-item";
import { parseConversions } from "@/lib/catalog/sku-item-shared";
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
  if (b.previewToken === undefined) return jsonError(409, "preview_required");
  const previewToken = typeof b.previewToken === "string" && /^[0-9a-f]{8}$/.test(b.previewToken) ? b.previewToken : null;
  if (!previewToken) return jsonError(400, "invalid_payload", { field: "previewToken" });
  const conversions = parseConversions(b.conversions ?? []);
  if (!conversions) return jsonError(400, "invalid_payload", { field: "conversions" });
  try {
    const r = await applyPackBackToDefault(ctx, { skuId: id, locationId: b.locationId, versionId: b.versionId, conversions, previewToken });
    return jsonOk(r);
  } catch (e) {
    if (e instanceof CatalogItemError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
