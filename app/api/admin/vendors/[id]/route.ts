import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  getVendor,
  updateVendor,
  deactivateVendor,
  AdminVendorError,
  VENDOR_READ_MIN_LEVEL,
  type VendorChanges,
} from "@/lib/admin/vendors";

// Columns that require GM+ (full profile). Touching any of these — or the
// active toggle — escalates the step-up tier to B; trivial-only edits are Tier A.
const FULL_ONLY = new Set(["name", "category", "ordering_days", "payment_terms", "account_number", "active"]);
const TRIVIAL = new Set(["contact_person", "contact_email", "contact_phone", "ordering_email", "ordering_url", "notes"]);

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(req, `/api/admin/vendors/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < VENDOR_READ_MIN_LEVEL) return jsonError(403, "forbidden");

  try {
    const vendor = await getVendor(ctx, id);
    if (!vendor) return jsonError(404, "vendor_not_found");
    return jsonOk({ vendor });
  } catch (e) {
    if (e instanceof AdminVendorError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/vendors/${id}`);
  if (ctx instanceof Response) return ctx;
  // Floor gate — AGM+. The lib enforces the per-column GM+ requirement.
  if (ROLES[ctx.user.role].level < VENDOR_READ_MIN_LEVEL) return jsonError(403, "forbidden");

  const body = parsed as Record<string, unknown>;
  // Validate payload shape: only known columns, correct primitive types.
  const keys = Object.keys(body).filter((k) => body[k] !== undefined);
  for (const k of keys) {
    if (k === "active") {
      if (typeof body.active !== "boolean") {
        return jsonError(400, "invalid_payload", { message: "active must be a boolean" });
      }
    } else if (k === "name") {
      if (typeof body.name !== "string") {
        return jsonError(400, "invalid_payload", { message: "name must be a string" });
      }
    } else if (FULL_ONLY.has(k) || TRIVIAL.has(k)) {
      if (body[k] !== null && typeof body[k] !== "string") {
        return jsonError(400, "invalid_payload", { message: `${k} must be a string or null` });
      }
    } else {
      return jsonError(400, "invalid_payload", { message: `Unknown field: ${k}` });
    }
  }
  if (keys.length === 0) return jsonError(400, "invalid_payload", { message: "No fields to update" });

  // Step-up tier: Tier B if the body touches a FULL_ONLY field (incl. active);
  // otherwise Tier A for a trivial-only edit.
  const touchesFull = keys.some((k) => FULL_ONLY.has(k));
  const su = assertStepUp(ctx, touchesFull ? "B" : "A");
  if (!su.ok) return jsonError(403, su.code);

  try {
    // The active toggle is its own action (activate/deactivate); everything
    // else goes through updateVendor's column-split.
    if (keys.length === 1 && keys[0] === "active") {
      await deactivateVendor(ctx, { id, active: body.active as boolean });
      return jsonOk({ ok: true });
    }
    if (keys.includes("active")) {
      return jsonError(400, "invalid_payload", {
        message: "Update `active` on its own, not alongside other fields",
      });
    }
    const changes: VendorChanges = {};
    for (const k of keys) {
      (changes as Record<string, unknown>)[k] = body[k];
    }
    await updateVendor(ctx, { id, changes });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminVendorError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
