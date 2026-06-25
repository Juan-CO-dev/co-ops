import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  updateVendorContact,
  removeVendorContact,
  AdminVendorError,
  type UpdateContactChanges,
} from "@/lib/admin/vendors";

// PATCH — edit a contact (GM+ ≥7, Tier A). DELETE — remove (GM+ ≥7, Tier A;
// blocked if it's the vendor's last active contact → 400 last_contact).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> },
) {
  const { id, contactId } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/vendors/${id}/contacts/${contactId}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  const changes: UpdateContactChanges = {};
  if ("name" in b) {
    if (typeof b.name !== "string") return jsonError(400, "invalid_payload", { field: "name" });
    changes.name = b.name;
  }
  if ("email" in b) changes.email = b.email === null ? null : typeof b.email === "string" ? b.email : null;
  if ("phone" in b) changes.phone = b.phone === null ? null : typeof b.phone === "string" ? b.phone : null;

  try {
    await updateVendorContact(ctx, { contactId, changes });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminVendorError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; contactId: string }> },
) {
  const { id, contactId } = await params;
  const ctx = await requireSession(req, `/api/admin/vendors/${id}/contacts/${contactId}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  try {
    await removeVendorContact(ctx, { contactId });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminVendorError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
