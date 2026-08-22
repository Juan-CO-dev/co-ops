import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  addRhythmSkip,
  deactivateRhythmSkip,
  VendorRhythmError,
  RHYTHM_APPEND_MIN,
  RHYTHM_WRITE_MIN,
} from "@/lib/vendor-rhythm";

// Vendor-down skip windows (Dynamic Pars Phase 1). Same floors and posture as the rhythm
// route above it: append = AGM+ (≥6), retract = GM+ (≥7), Tier A step-up, riding
// vendor.full_profile_edit with metadata.scope = "rhythm_skip".
//
// WHY THIS EXISTS: an outage week is not par disagreement. Without a skip, a manager who
// handles a vendor being down by ordering elsewhere reads to the machine as "the human
// keeps overriding the suggestion" — burning budget and pin state on an event that has
// nothing to do with the par.

// POST — open a window. Body: { locationId, skipFrom: "YYYY-MM-DD", skipThrough, note? }.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/vendors/${id}/rhythm/skips`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < RHYTHM_APPEND_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.locationId !== "string" || !b.locationId) {
    return jsonError(400, "invalid_payload", { field: "locationId" });
  }
  if (typeof b.skipFrom !== "string" || !b.skipFrom) return jsonError(400, "invalid_payload", { field: "skipFrom" });
  if (typeof b.skipThrough !== "string" || !b.skipThrough) {
    return jsonError(400, "invalid_payload", { field: "skipThrough" });
  }
  if (b.note !== undefined && b.note !== null && typeof b.note !== "string") {
    return jsonError(400, "invalid_payload", { field: "note" });
  }

  try {
    const { id: skipId } = await addRhythmSkip(ctx, {
      vendorId: id,
      locationId: b.locationId,
      skipFrom: b.skipFrom,
      skipThrough: b.skipThrough,
      note: (b.note as string | null | undefined) ?? null,
    });
    return jsonOk({ id: skipId }, 201);
  } catch (e) {
    if (e instanceof VendorRhythmError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

// DELETE — retract one window. Body: { skipId: string }. Append-only (active = false).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/vendors/${id}/rhythm/skips`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < RHYTHM_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.skipId !== "string" || !b.skipId) return jsonError(400, "invalid_payload", { field: "skipId" });

  try {
    await deactivateRhythmSkip(ctx, { id: b.skipId });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof VendorRhythmError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
