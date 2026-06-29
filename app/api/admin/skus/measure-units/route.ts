import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { addMeasureUnit, AdminSkuError } from "@/lib/admin/skus";

// Add a SKU measure unit (oz/lb/count…) to the registry. Global — affects every
// SKU's measure dropdown. MoO+ (≥8), Tier B. Label is the unique key.
export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/skus/measure-units");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 8) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.label !== "string" || !b.label.trim()) {
    return jsonError(400, "invalid_label", { field: "label" });
  }
  if (typeof b.dimension !== "string") {
    return jsonError(400, "invalid_dimension", { field: "dimension" });
  }
  if (typeof b.toBaseFactor !== "number") {
    return jsonError(400, "invalid_factor", { field: "toBaseFactor" });
  }

  try {
    const option = await addMeasureUnit(ctx, {
      label: b.label,
      dimension: b.dimension,
      toBaseFactor: b.toBaseFactor,
    });
    return jsonOk({ option }, 201);
  } catch (e) {
    if (e instanceof AdminSkuError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
