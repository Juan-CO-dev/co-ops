import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  loadVendors,
  createVendor,
  AdminVendorError,
  VENDOR_READ_MIN_LEVEL,
  VENDOR_FULL_MIN_LEVEL,
  type CreateVendorInput,
} from "@/lib/admin/vendors";

export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/admin/vendors");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < VENDOR_READ_MIN_LEVEL) return jsonError(403, "forbidden");

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
  if (ROLES[ctx.user.role].level < VENDOR_FULL_MIN_LEVEL) return jsonError(403, "forbidden");

  // Create is GM+ + destructive → Tier B step-up.
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Partial<CreateVendorInput>;
  if (typeof b.name !== "string" || b.name.trim() === "") {
    return jsonError(400, "invalid_payload", { message: "name is required" });
  }
  const str = (v: unknown): string | null | undefined =>
    v === null ? null : typeof v === "string" ? v : undefined;
  try {
    const { id } = await createVendor(ctx, {
      name: b.name,
      category: str(b.category),
      contact_person: str(b.contact_person),
      contact_email: str(b.contact_email),
      contact_phone: str(b.contact_phone),
      ordering_email: str(b.ordering_email),
      ordering_url: str(b.ordering_url),
      ordering_days: str(b.ordering_days),
      payment_terms: str(b.payment_terms),
      account_number: str(b.account_number),
      notes: str(b.notes),
    });
    return jsonOk({ id }, 201);
  } catch (e) {
    if (e instanceof AdminVendorError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
