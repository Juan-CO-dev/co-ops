import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  loadCustomer,
  editCustomer,
  setCustomerActive,
  CateringCustomerError,
  CUSTOMER_READ_MIN,
  CUSTOMER_WRITE_MIN,
  type EditCustomerInput,
} from "@/lib/catering/customers";

// GET — one customer + their pipeline leads + order history (view >= 5).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(req, `/api/catering/customers/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < CUSTOMER_READ_MIN) return jsonError(403, "forbidden");
  try {
    const detail = await loadCustomer(ctx, id);
    if (!detail) return jsonError(404, "not_found");
    return jsonOk({ customer: detail.customer, leads: detail.leads, orders: detail.orders });
  } catch (e) {
    if (e instanceof CateringCustomerError) return jsonError(e.status, e.code);
    throw e;
  }
}

const EDIT_KEYS = ["name", "company", "contactPerson", "email", "phone", "notes"] as const;

// PATCH — one concern per call (write >= 6): { active } toggle | edit fields.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/catering/customers/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < CUSTOMER_WRITE_MIN) return jsonError(403, "forbidden");

  const b = parsed as Record<string, unknown>;
  const hasActive = "active" in b;
  const hasEdit = EDIT_KEYS.some((k) => k in b);
  const concerns = [hasActive, hasEdit].filter(Boolean).length;
  if (concerns === 0) return jsonError(400, "invalid_payload", { message: "No recognized fields" });
  if (concerns > 1) return jsonError(400, "mixed_concerns", { message: "Toggle active or edit fields, not both" });

  const optStr = (v: unknown): string | null | undefined =>
    v === null || v === undefined ? null : typeof v === "string" ? v : undefined;

  try {
    if (hasActive) {
      if (typeof b.active !== "boolean") return jsonError(400, "invalid_payload", { field: "active" });
      await setCustomerActive(ctx, id, b.active);
      return jsonOk({ ok: true });
    }

    const input: EditCustomerInput = {};
    if ("name" in b) {
      if (typeof b.name !== "string") return jsonError(400, "invalid_payload", { field: "name" });
      input.name = b.name;
    }
    for (const k of ["company", "contactPerson", "email", "phone", "notes"] as const) {
      if (k in b) {
        const v = optStr(b[k]);
        if (v === undefined) return jsonError(400, "invalid_payload", { field: k });
        input[k] = v;
      }
    }

    await editCustomer(ctx, id, input);
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof CateringCustomerError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
