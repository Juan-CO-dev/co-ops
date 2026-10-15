/**
 * POST /api/admin/catalog/sku/[id]/preview — "What this changes" (catalog Phase 2b). A READ: it
 * computes, it never writes, so it takes no step-up. The TARGET is explicit (D4):
 *   { kind: "pack", target: { kind: "shop", shopId } | { kind: "global" }, levels: [...] }
 *   { kind: "price", target: …, unitPrice: number, effectiveDate: "YYYY-MM-DD" }
 */
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { CatalogItemError, computePackPreview, computePricePreview } from "@/lib/catalog/sku-item";
import { parseLevels, parseTarget } from "@/lib/catalog/sku-item-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/sku/${id}/preview`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < 6) return jsonError(403, "forbidden");
  const b = (parsed ?? {}) as Record<string, unknown>;
  const target = parseTarget(b.target);
  if (!target) return jsonError(400, "invalid_payload", { field: "target" });
  try {
    if (b.kind === "pack") {
      const levels = parseLevels(b.levels);
      if (!levels) return jsonError(400, "invalid_payload", { field: "levels" });
      return jsonOk({ preview: await computePackPreview(ctx, id, target, levels) });
    }
    if (b.kind === "price") {
      if (typeof b.unitPrice !== "number") return jsonError(400, "invalid_price", { field: "unitPrice" });
      if (typeof b.effectiveDate !== "string") return jsonError(400, "invalid_date", { field: "effectiveDate" });
      return jsonOk({ preview: await computePricePreview(ctx, id, target, b.unitPrice, b.effectiveDate) });
    }
    return jsonError(400, "invalid_payload", { field: "kind" });
  } catch (e) {
    if (e instanceof CatalogItemError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
