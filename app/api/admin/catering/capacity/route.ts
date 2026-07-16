import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  loadCapacityPolicies,
  loadBlackoutDates,
  createCapacityPolicy,
  addBlackoutDate,
  AdminCateringError,
  CAPACITY_MIN,
  type CapacityPolicyInput,
} from "@/lib/admin/catering/capacity";

// GET  — per-location capacity policies + active blackout dates the actor manages. GM+ (>=7), no step-up (read).
// POST — one concern per call, both GM+ (>=7):
//   policy   {locationId, maxCoversPerDay, maxEventsPerDay, minLeadTimeHours} → create the location's active policy, Tier B.
//   blackout {locationId, blackoutDate, reason?}                              → add a blackout date, Tier A.

const CAP_KEYS = ["maxCoversPerDay", "maxEventsPerDay", "minLeadTimeHours"] as const;

export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/admin/catering/capacity");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < CAPACITY_MIN) return jsonError(403, "forbidden");

  try {
    const [policies, blackouts] = await Promise.all([
      loadCapacityPolicies(ctx),
      loadBlackoutDates(ctx),
    ]);
    return jsonOk({ policies, blackouts });
  } catch (e) {
    if (e instanceof AdminCateringError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

/** null passes through; a number passes through; anything else → undefined (rejected). */
function capOrNull(v: unknown): number | null | undefined {
  return v === null ? null : typeof v === "number" ? v : undefined;
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/catering/capacity");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < CAPACITY_MIN) return jsonError(403, "forbidden");

  const b = parsed as Record<string, unknown>;
  const hasPolicy = CAP_KEYS.some((k) => k in b);
  const hasBlackout = "blackoutDate" in b || "reason" in b;

  // Exactly one concern per POST.
  const concerns = [hasPolicy, hasBlackout].filter(Boolean).length;
  if (concerns === 0) return jsonError(400, "invalid_payload", { message: "No recognized fields" });
  if (concerns > 1) {
    return jsonError(400, "mixed_concerns", { message: "One concern per POST: policy or blackout" });
  }

  if (typeof b.locationId !== "string") return jsonError(400, "invalid_payload", { field: "locationId" });
  const locationId = b.locationId;

  try {
    if (hasBlackout) {
      // Blackout add — Tier A.
      const su = assertStepUp(ctx, "A");
      if (!su.ok) return jsonError(403, su.code);

      if (typeof b.blackoutDate !== "string") return jsonError(400, "invalid_date", { field: "blackoutDate" });
      const reason =
        b.reason === undefined || b.reason === null
          ? null
          : typeof b.reason === "string"
            ? b.reason
            : undefined;
      if (reason === undefined) return jsonError(400, "invalid_payload", { field: "reason" });

      const { id } = await addBlackoutDate(ctx, { locationId, blackoutDate: b.blackoutDate, reason });
      return jsonOk({ id }, 201);
    }

    // Policy create — Tier B. All three caps required together (atomic save; null = no cap).
    const su = assertStepUp(ctx, "B");
    if (!su.ok) return jsonError(403, su.code);

    const maxCoversPerDay = capOrNull(b.maxCoversPerDay);
    if (maxCoversPerDay === undefined) return jsonError(400, "invalid_payload", { field: "maxCoversPerDay" });
    const maxEventsPerDay = capOrNull(b.maxEventsPerDay);
    if (maxEventsPerDay === undefined) return jsonError(400, "invalid_payload", { field: "maxEventsPerDay" });
    const minLeadTimeHours = capOrNull(b.minLeadTimeHours);
    if (minLeadTimeHours === undefined) return jsonError(400, "invalid_payload", { field: "minLeadTimeHours" });

    const input: CapacityPolicyInput = { locationId, maxCoversPerDay, maxEventsPerDay, minLeadTimeHours };
    const { id } = await createCapacityPolicy(ctx, input);
    return jsonOk({ id }, 201);
  } catch (e) {
    if (e instanceof AdminCateringError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
