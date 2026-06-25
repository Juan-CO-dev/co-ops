import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  getVendor,
  updateVendorCore,
  updateVendorNotes,
  deactivateVendor,
  AdminVendorError,
  type UpdateVendorCoreChanges,
} from "@/lib/admin/vendors";

// GET — fetch one vendor (≥6). PATCH — one concern per call:
//   core  {name,paymentTerms,accountNumber} → MoO+ (≥8), Tier B
//   notes {notes}                           → GM+  (≥7)
//   active {active}                         → MoO+ (≥8), Tier B
// (Classification — categories / order types — is GM+ via the dedicated
//  /categories + /order-types PUT routes, not a core PATCH concern.)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(req, `/api/admin/vendors/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 6) return jsonError(403, "forbidden");

  try {
    const vendor = await getVendor(ctx, id);
    if (!vendor) return jsonError(404, "not_found");
    return jsonOk({ vendor });
  } catch (e) {
    if (e instanceof AdminVendorError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

const CORE_KEYS = ["name", "paymentTerms", "accountNumber"] as const;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/vendors/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 6) return jsonError(403, "forbidden");

  const b = parsed as Record<string, unknown>;
  const hasCore = CORE_KEYS.some((k) => k in b);
  const hasNotes = "notes" in b;
  const hasActive = "active" in b;

  // Exactly one concern per PATCH.
  const concerns = [hasCore, hasNotes, hasActive].filter(Boolean).length;
  if (concerns === 0) return jsonError(400, "invalid_payload", { message: "No recognized fields to update" });
  if (concerns > 1) {
    return jsonError(400, "mixed_concerns", { message: "One concern per PATCH: core, notes, or active" });
  }

  const level = ROLES[ctx.user.role].level;

  try {
    if (hasActive) {
      if (level < 8) return jsonError(403, "forbidden");
      const su = assertStepUp(ctx, "B");
      if (!su.ok) return jsonError(403, su.code);
      if (typeof b.active !== "boolean") return jsonError(400, "invalid_payload", { field: "active" });
      await deactivateVendor(ctx, { id, active: b.active });
      return jsonOk({ ok: true });
    }

    if (hasNotes) {
      if (level < 7) return jsonError(403, "forbidden");
      const notes = b.notes === null ? null : typeof b.notes === "string" ? b.notes : undefined;
      if (notes === undefined) return jsonError(400, "invalid_payload", { field: "notes" });
      await updateVendorNotes(ctx, { id, notes });
      return jsonOk({ ok: true });
    }

    // hasCore
    if (level < 8) return jsonError(403, "forbidden");
    const su = assertStepUp(ctx, "B");
    if (!su.ok) return jsonError(403, su.code);
    const changes: UpdateVendorCoreChanges = {};
    if ("name" in b) {
      if (typeof b.name !== "string") return jsonError(400, "invalid_payload", { field: "name" });
      changes.name = b.name;
    }
    if ("paymentTerms" in b) {
      changes.paymentTerms = b.paymentTerms === null ? null : typeof b.paymentTerms === "string" ? b.paymentTerms : undefined;
      if (changes.paymentTerms === undefined) return jsonError(400, "invalid_payload", { field: "paymentTerms" });
    }
    if ("accountNumber" in b) {
      changes.accountNumber = b.accountNumber === null ? null : typeof b.accountNumber === "string" ? b.accountNumber : undefined;
      if (changes.accountNumber === undefined) return jsonError(400, "invalid_payload", { field: "accountNumber" });
    }
    await updateVendorCore(ctx, { id, changes });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminVendorError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
