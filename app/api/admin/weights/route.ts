import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  recordWeightMeasurement,
  WeightError,
  WEIGHT_WRITE_MIN,
  type WeightMeasurementInput,
  type WeightMeasurementResult,
} from "@/lib/weights";

// The weigh session (spec 2026-08-20, "Weight & trim audit"). Owner-invoked,
// mirroring the /counts session: pick subjects, enter measurements, commit.
//
// GM+ (WEIGHT_WRITE_MIN 7) + Tier B step-up. Tier B — a FRESH password, not merely
// an unlocked one — because a weight is the denominator of every cost and every
// depletion that resolves through it: changing what a slice weighs re-prices the
// menu, and that is the same weight of decision the registry creates carry.
//
// A SESSION IS A SET OF INDEPENDENT MEASUREMENTS. Each is its own append with its
// own audit row, and a failure on measurement 3 does NOT roll back 1 and 2 — those
// are true facts somebody actually put on a scale. The response reports per-item
// outcomes so the surface can say exactly which ones landed.
const MAX_MEASUREMENTS = 50;
const SUBJECT_KINDS = new Set(["sku", "product", "item"]);

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/weights");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < WEIGHT_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const body = parsed as Record<string, unknown>;
  const raw = body.measurements;
  if (!Array.isArray(raw) || raw.length === 0) {
    return jsonError(400, "invalid_payload", { field: "measurements" });
  }
  if (raw.length > MAX_MEASUREMENTS) return jsonError(400, "too_many_measurements");

  const measurements: WeightMeasurementInput[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      return jsonError(400, "invalid_payload", { field: "measurements" });
    }
    const m = entry as Record<string, unknown>;
    if (typeof m.subjectKind !== "string" || !SUBJECT_KINDS.has(m.subjectKind)) {
      return jsonError(400, "invalid_payload", { field: "subjectKind" });
    }
    if (typeof m.subjectId !== "string" || m.subjectId.length === 0) {
      return jsonError(400, "invalid_payload", { field: "subjectId" });
    }
    // A weight is a NUMBER. A numeric string here would silently coerce and a
    // typo would become a measurement, so the type is checked, not parsed.
    if (typeof m.valueOz !== "number" || !Number.isFinite(m.valueOz) || m.valueOz <= 0) {
      return jsonError(400, "invalid_weight", { field: "valueOz" });
    }
    if (m.sourceNote !== undefined && m.sourceNote !== null && typeof m.sourceNote !== "string") {
      return jsonError(400, "invalid_payload", { field: "sourceNote" });
    }
    measurements.push({
      subjectKind: m.subjectKind as WeightMeasurementInput["subjectKind"],
      subjectId: m.subjectId,
      valueOz: m.valueOz,
      sourceNote: typeof m.sourceNote === "string" ? m.sourceNote : null,
    });
  }

  const recorded: WeightMeasurementResult[] = [];
  for (const m of measurements) {
    try {
      recorded.push(await recordWeightMeasurement(ctx, m));
    } catch (e) {
      if (e instanceof WeightError) {
        // Report the partial truthfully — the ones already written STAND. Hiding
        // them behind a bare error would make the operator re-weigh work that is
        // already recorded, and the audit trail would disagree with the message.
        return jsonError(e.status, e.code, { message: e.message, recorded: recorded.length });
      }
      throw e;
    }
  }

  return jsonOk({ recorded });
}
