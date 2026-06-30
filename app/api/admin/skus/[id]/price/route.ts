import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { recordSkuPrice, AdminCostError } from "@/lib/admin/cost";

// Record a SKU purchase price into the append-only ledger. AGM+ (≥6), Tier A.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/skus/${id}/price`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 6) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.unitPrice !== "number") return jsonError(400, "invalid_price", { field: "unitPrice" });
  if (typeof b.effectiveDate !== "string") return jsonError(400, "invalid_date", { field: "effectiveDate" });

  try {
    const res = await recordSkuPrice(ctx, { skuId: id, unitPrice: b.unitPrice, effectiveDate: b.effectiveDate });
    return jsonOk({ id: res.id }, 201);
  } catch (e) {
    if (e instanceof AdminCostError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
