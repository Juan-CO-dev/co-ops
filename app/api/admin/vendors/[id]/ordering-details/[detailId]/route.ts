import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  updateVendorOrderingDetail,
  removeVendorOrderingDetail,
  AdminVendorError,
  type UpdateOrderingChanges,
} from "@/lib/admin/vendors";

// PATCH — edit an ordering detail (GM+ ≥7, Tier A). DELETE — remove (GM+ ≥7,
// Tier A; blocked if it's the vendor's last active ordering detail → 400
// last_ordering_detail).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; detailId: string }> },
) {
  const { id, detailId } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/vendors/${id}/ordering-details/${detailId}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  const changes: UpdateOrderingChanges = {};
  if ("method" in b) {
    if (typeof b.method !== "string") return jsonError(400, "invalid_payload", { field: "method" });
    changes.method = b.method;
  }
  if ("value" in b) {
    if (typeof b.value !== "string") return jsonError(400, "invalid_payload", { field: "value" });
    changes.value = b.value;
  }
  if ("label" in b) changes.label = b.label === null ? null : typeof b.label === "string" ? b.label : null;

  try {
    await updateVendorOrderingDetail(ctx, { detailId, changes });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminVendorError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; detailId: string }> },
) {
  const { id, detailId } = await params;
  const ctx = await requireSession(req, `/api/admin/vendors/${id}/ordering-details/${detailId}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  try {
    await removeVendorOrderingDetail(ctx, { detailId });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminVendorError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
