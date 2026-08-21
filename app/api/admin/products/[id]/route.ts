import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { setProductUnitOz, ProductError } from "@/lib/products";

// PATCH — establish what ONE unit of the product weighs, with its provenance
// (GM+ ≥7, Tier A — mirrors a SKU edit). `unitOz: null` clears the belief, and
// clearing also clears who/when: NULL is the honest value, never a placeholder.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/products/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (b.unitOz !== null && typeof b.unitOz !== "number") {
    return jsonError(400, "invalid_payload", { field: "unitOz" });
  }
  for (const k of ["unitOzClass", "sourceNote"] as const) {
    if (b[k] !== undefined && b[k] !== null && typeof b[k] !== "string") {
      return jsonError(400, "invalid_payload", { field: k });
    }
  }

  try {
    await setProductUnitOz(ctx, {
      productId: id,
      unitOz: typeof b.unitOz === "number" ? b.unitOz : null,
      unitOzClass: typeof b.unitOzClass === "string" ? b.unitOzClass : null,
      sourceNote: typeof b.sourceNote === "string" ? b.sourceNote : null,
    });
    return jsonOk({});
  } catch (e) {
    if (e instanceof ProductError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
