import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { updateVendorTransmission, AdminVendorError } from "@/lib/admin/vendors";

// Set a vendor's transmission tier + portal URL (VO-7). GM+ (≥7), Tier A —
// mirrors the schedule route (a vendor.full_profile_edit scope). One concern
// per PATCH: tier + portalUrl travel together (portalUrl is only kept for the
// assisted tier; the lib clears it otherwise).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/vendors/${id}/transmission`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.transmissionTier !== "string") {
    return jsonError(400, "invalid_payload", { field: "transmissionTier" });
  }
  const portalUrl =
    b.portalUrl === null || b.portalUrl === undefined
      ? null
      : typeof b.portalUrl === "string"
        ? b.portalUrl
        : null;

  try {
    await updateVendorTransmission(ctx, {
      vendorId: id,
      transmissionTier: b.transmissionTier,
      portalUrl,
    });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminVendorError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
