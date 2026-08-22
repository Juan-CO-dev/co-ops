import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  setVendorRhythmPair,
  deactivateVendorRhythmPair,
  VendorRhythmError,
  RHYTHM_APPEND_MIN,
  RHYTHM_WRITE_MIN,
} from "@/lib/vendor-rhythm";

// Vendor delivery rhythm — the per-location order→delivery PAIRS (Dynamic Pars Phase 1).
//
// Mirrors the cutoffs route exactly: append = AGM+ (≥6), deactivate = GM+ (≥7), both
// Tier A step-up, both riding vendor.full_profile_edit with a metadata.scope. The one
// deliberate difference from cutoffs is that locationId is REQUIRED and may never be
// null — a rhythm row is per-shop by construction (migration 0182), because trucks are
// not shared between two shops of one vendor the way a phone deadline is.

// POST — author (or re-author) the pair for one (vendor, location, order day).
// Body: { locationId: string, orderDow: 0..6, leadDays: 0..14 }.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/vendors/${id}/rhythm`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < RHYTHM_APPEND_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.locationId !== "string" || !b.locationId) {
    return jsonError(400, "invalid_payload", { field: "locationId" });
  }
  if (typeof b.orderDow !== "number") return jsonError(400, "invalid_payload", { field: "orderDow" });
  if (typeof b.leadDays !== "number") return jsonError(400, "invalid_payload", { field: "leadDays" });

  try {
    const { id: rhythmId } = await setVendorRhythmPair(ctx, {
      vendorId: id,
      locationId: b.locationId,
      orderDow: b.orderDow,
      leadDays: b.leadDays,
    });
    return jsonOk({ id: rhythmId }, 201);
  } catch (e) {
    if (e instanceof VendorRhythmError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

// DELETE — retire one pair. Body: { rhythmId: string }. Append-only (active = false).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/vendors/${id}/rhythm`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < RHYTHM_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.rhythmId !== "string" || !b.rhythmId) {
    return jsonError(400, "invalid_payload", { field: "rhythmId" });
  }

  try {
    await deactivateVendorRhythmPair(ctx, { id: b.rhythmId });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof VendorRhythmError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
