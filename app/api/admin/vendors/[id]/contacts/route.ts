import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { addVendorContact, AdminVendorError } from "@/lib/admin/vendors";

// POST — append a contact to a vendor (AGM+ ≥6, Tier A).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/vendors/${id}/contacts`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 6) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.name !== "string" || !b.name.trim()) {
    return jsonError(400, "invalid_payload", { field: "name" });
  }

  try {
    const { id: contactId } = await addVendorContact(ctx, {
      vendorId: id,
      name: b.name,
      email: typeof b.email === "string" ? b.email : null,
      phone: typeof b.phone === "string" ? b.phone : null,
    });
    return jsonOk({ id: contactId }, 201);
  } catch (e) {
    if (e instanceof AdminVendorError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
