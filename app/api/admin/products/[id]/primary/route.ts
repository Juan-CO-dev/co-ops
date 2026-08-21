import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { setPrimary, ProductError } from "@/lib/products";

// POST — designate the primary member for a scope (GM+ ≥7, Tier A).
//   locationId null = the GLOBAL default (the "null = global" house idiom);
//   a location-scoped row overrides it for that shop only.
// Membership is DB-proven by the composite FK; a non-member returns a named 400.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/products/${id}/primary`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.primarySkuId !== "string") return jsonError(400, "invalid_payload", { field: "primarySkuId" });
  if (b.locationId !== undefined && b.locationId !== null && typeof b.locationId !== "string") {
    return jsonError(400, "invalid_payload", { field: "locationId" });
  }
  if (b.note !== undefined && b.note !== null && typeof b.note !== "string") {
    return jsonError(400, "invalid_payload", { field: "note" });
  }

  try {
    await setPrimary(ctx, {
      productId: id,
      locationId: typeof b.locationId === "string" ? b.locationId : null,
      primarySkuId: b.primarySkuId,
      note: typeof b.note === "string" ? b.note : null,
    });
    return jsonOk({});
  } catch (e) {
    if (e instanceof ProductError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
