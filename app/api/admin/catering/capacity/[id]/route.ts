import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  updateCapacityPolicy,
  deactivateBlackoutDate,
  AdminCateringError,
  CAPACITY_MIN,
  type CapacityPolicyInput,
} from "@/lib/admin/catering/capacity";

// PATCH — one concern per call, both GM+ (>=7):
//   caps   {locationId, maxCoversPerDay, maxEventsPerDay, minLeadTimeHours} → edit the location's single active policy in place, Tier B.
//   active {locationId, active:false} → deactivate a blackout date (never true here — re-add the date to restore it), Tier A.

const CAP_KEYS = ["maxCoversPerDay", "maxEventsPerDay", "minLeadTimeHours"] as const;

/** null passes through; a number passes through; anything else → undefined (rejected). */
function capOrNull(v: unknown): number | null | undefined {
  return v === null ? null : typeof v === "number" ? v : undefined;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catering/capacity/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < CAPACITY_MIN) return jsonError(403, "forbidden");

  const b = parsed as Record<string, unknown>;
  const hasCaps = CAP_KEYS.some((k) => k in b);
  const hasActive = "active" in b;

  // Exactly one concern per PATCH.
  const concerns = [hasCaps, hasActive].filter(Boolean).length;
  if (concerns === 0) return jsonError(400, "invalid_payload", { message: "No recognized fields to update" });
  if (concerns > 1) {
    return jsonError(400, "mixed_concerns", { message: "One concern per PATCH: caps or active" });
  }

  if (typeof b.locationId !== "string") return jsonError(400, "invalid_payload", { field: "locationId" });
  const locationId = b.locationId;

  try {
    if (hasActive) {
      // Blackout deactivate — Tier A.
      const su = assertStepUp(ctx, "A");
      if (!su.ok) return jsonError(403, su.code);

      if (typeof b.active !== "boolean" || b.active !== false) {
        return jsonError(400, "invalid_payload", { field: "active" });
      }
      await deactivateBlackoutDate(ctx, { blackoutId: id, locationId });
      return jsonOk({ ok: true });
    }

    // hasCaps — policy edit, Tier B. All three caps required together (atomic save; null = no cap).
    const su = assertStepUp(ctx, "B");
    if (!su.ok) return jsonError(403, su.code);

    const maxCoversPerDay = capOrNull(b.maxCoversPerDay);
    if (maxCoversPerDay === undefined) return jsonError(400, "invalid_payload", { field: "maxCoversPerDay" });
    const maxEventsPerDay = capOrNull(b.maxEventsPerDay);
    if (maxEventsPerDay === undefined) return jsonError(400, "invalid_payload", { field: "maxEventsPerDay" });
    const minLeadTimeHours = capOrNull(b.minLeadTimeHours);
    if (minLeadTimeHours === undefined) return jsonError(400, "invalid_payload", { field: "minLeadTimeHours" });

    const input: CapacityPolicyInput = { locationId, maxCoversPerDay, maxEventsPerDay, minLeadTimeHours };
    await updateCapacityPolicy(ctx, { policyId: id, input });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminCateringError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
