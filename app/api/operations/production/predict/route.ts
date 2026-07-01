import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { predictOutput, ProductionError } from "@/lib/production";

// Advisory yield prediction for a (SKU → item) pair. KH+ (≥4).
export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/operations/production/predict");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 4) return jsonError(403, "forbidden");

  const b = parsed as { inputSkuId?: unknown; outputItemId?: unknown; inputQty?: unknown };
  if (
    typeof b.inputSkuId !== "string" ||
    typeof b.outputItemId !== "string" ||
    typeof b.inputQty !== "number"
  ) {
    return jsonError(400, "invalid_payload");
  }

  try {
    const res = await predictOutput(ctx, {
      inputSkuId: b.inputSkuId,
      outputItemId: b.outputItemId,
      inputQty: b.inputQty,
    });
    return jsonOk({ predicted: res.predicted });
  } catch (e) {
    if (e instanceof ProductionError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
