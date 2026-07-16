import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { createCustomer, CateringCustomerError, CUSTOMER_WRITE_MIN, type CreateCustomerInput } from "@/lib/catering/customers";

// POST — create a catering customer (catering_mgr+ >= 6).
export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/catering/customers");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < CUSTOMER_WRITE_MIN) return jsonError(403, "forbidden");

  const b = parsed as Record<string, unknown>;
  const name = b.name;
  if (typeof name !== "string" || name.trim().length === 0) {
    return jsonError(400, "invalid_payload", { field: "name" });
  }
  const optStr = (v: unknown): string | null | undefined =>
    v === null || v === undefined ? null : typeof v === "string" ? v : undefined;

  const company = optStr(b.company);
  const contactPerson = optStr(b.contactPerson);
  const email = optStr(b.email);
  const phone = optStr(b.phone);
  const primaryLocationId = optStr(b.primaryLocationId);
  const notes = optStr(b.notes);
  for (const [field, v] of Object.entries({ company, contactPerson, email, phone, primaryLocationId, notes })) {
    if (v === undefined) return jsonError(400, "invalid_payload", { field });
  }

  const input: CreateCustomerInput = {
    name,
    company: company ?? null,
    contactPerson: contactPerson ?? null,
    email: email ?? null,
    phone: phone ?? null,
    primaryLocationId: primaryLocationId ?? null,
    notes: notes ?? null,
  };

  try {
    const { id } = await createCustomer(ctx, input);
    return jsonOk({ id }, 201);
  } catch (e) {
    if (e instanceof CateringCustomerError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
