import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { recordProduction, ProductionError, type RecordProductionInput } from "@/lib/production";

// Log a production run (SKU → item conversion). KH+ (≥4), location-bound (checked in recordProduction).
export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/operations/production");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 4) return jsonError(403, "forbidden");

  const b = parsed as Partial<RecordProductionInput>;
  if (
    typeof b.locationId !== "string" ||
    typeof b.inputSkuId !== "string" ||
    typeof b.outputItemId !== "string" ||
    typeof b.inputQty !== "number" ||
    typeof b.outputQty !== "number"
  ) {
    return jsonError(400, "invalid_payload");
  }

  try {
    const res = await recordProduction(ctx, b as RecordProductionInput);
    return jsonOk({ productionId: res.productionId }, 201);
  } catch (e) {
    if (e instanceof ProductionError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
