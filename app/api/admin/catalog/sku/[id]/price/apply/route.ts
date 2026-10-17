/**
 * POST /api/admin/catalog/sku/[id]/price/apply — "Price changed", saved for THE previewed target
 * (catalog Phase 2b). Body: { target, unitPrice: number, effectiveDate: "YYYY-MM-DD", previewToken }.
 * Tier E. 2a's gated writer decides who may write which lane.
 */
import { type NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { applyPriceChange, CatalogItemError } from "@/lib/catalog/sku-item";
import { parseTarget } from "@/lib/catalog/sku-item-shared";
import { SHOP_VERSION_WRITE_MIN } from "@/lib/sku-versions-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/sku/${id}/price/apply`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < SHOP_VERSION_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);

  const b = (parsed ?? {}) as Record<string, unknown>;
  const target = parseTarget(b.target);
  if (!target) return jsonError(400, "invalid_payload", { field: "target" });
  if (typeof b.unitPrice !== "number") return jsonError(400, "invalid_price", { field: "unitPrice" });
  if (typeof b.effectiveDate !== "string") return jsonError(400, "invalid_date", { field: "effectiveDate" });
  const previewToken = typeof b.previewToken === "string" && /^[0-9a-f]{8}$/.test(b.previewToken) ? b.previewToken : null;
  if (!previewToken) return jsonError(400, "invalid_payload", { field: "previewToken" });
  try {
    const r = await applyPriceChange(ctx, { skuId: id, target, unitPrice: b.unitPrice, effectiveDate: b.effectiveDate, previewToken });
    return jsonOk(r, 201);
  } catch (e) {
    if (e instanceof CatalogItemError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
