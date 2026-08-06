import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { deactivateVendorCutoff, AdminVendorError } from "@/lib/admin/vendors";

// DELETE — deactivate a cutoff (VO-7). GM+ (≥7), Tier A — mirrors the contacts
// DELETE (remove = GM+). Append-only: flips active=false, never a hard delete.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; cutoffId: string }> },
) {
  const { id, cutoffId } = await params;
  const ctx = await requireSession(req, `/api/admin/vendors/${id}/cutoffs/${cutoffId}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  try {
    await deactivateVendorCutoff(ctx, { cutoffId });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminVendorError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
