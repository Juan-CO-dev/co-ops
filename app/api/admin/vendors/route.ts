import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { loadVendors, createVendor, AdminVendorError, type CreateVendorInput } from "@/lib/admin/vendors";

// GET — list vendors (≥6). POST — create a vendor (GM+ ≥7, Tier B).
export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/admin/vendors");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 6) return jsonError(403, "forbidden");

  try {
    const vendors = await loadVendors(ctx);
    return jsonOk({ vendors });
  } catch (e) {
    if (e instanceof AdminVendorError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/vendors");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  const fc = (b.firstContact ?? {}) as Record<string, unknown>;
  const fo = (b.firstOrdering ?? {}) as Record<string, unknown>;
  if (
    typeof b.name !== "string" ||
    typeof b.categoryId !== "string" ||
    typeof fc.name !== "string" ||
    typeof fo.method !== "string" ||
    typeof fo.value !== "string"
  ) {
    return jsonError(400, "invalid_payload", {
      message: "name, categoryId, firstContact.name, firstOrdering.method, firstOrdering.value required",
    });
  }

  const input: CreateVendorInput = {
    name: b.name,
    categoryId: b.categoryId,
    paymentTerms: typeof b.paymentTerms === "string" ? b.paymentTerms : null,
    accountNumber: typeof b.accountNumber === "string" ? b.accountNumber : null,
    notes: typeof b.notes === "string" ? b.notes : null,
    firstContact: {
      name: fc.name,
      email: typeof fc.email === "string" ? fc.email : null,
      phone: typeof fc.phone === "string" ? fc.phone : null,
    },
    firstOrdering: {
      method: fo.method,
      value: fo.value,
      label: typeof fo.label === "string" ? fo.label : null,
    },
  };

  try {
    const { id } = await createVendor(ctx, input);
    return jsonOk({ id }, 201);
  } catch (e) {
    if (e instanceof AdminVendorError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
