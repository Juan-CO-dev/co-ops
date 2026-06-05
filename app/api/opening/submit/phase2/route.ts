/**
 * POST /api/opening/submit/phase2 — Opening Phase 2 FINALIZE per C.53 §3 +
 * SPLIT (Question A) + migration 0056.
 *
 * SPLIT note: this route takes NO entries. Per-item §8.4 writes happen at
 * POST /api/opening/prep/item (savePhase2Item → save_phase2_item_atomic) BEFORE
 * finalize. This route reads the persisted phase2 completions back, validates
 * completeness over the Model Y universe (every `openingPhase2` item has a live
 * phase2 completion), recomputes deltas authoritatively, dispatches under-prep
 * notifications, and advances `phase1_complete → phase2_complete`. Bypasses the
 * legacy `submitOpening` dispatcher (Question C — direct call into the RPC).
 *
 * Body: { instanceId: string }
 *
 * Response (success): {
 *   instance, submittedCompletionIds, closingAutoCompleteId: null,
 *   editCount: 0, originalSubmissionId: null, underParNotificationIds: string[]
 * }
 *
 * Response (error) via mapOpeningError:
 *   - 400 invalid_payload         — body shape validation failed
 *   - 403 role_level_insufficient — actor below OPENING_BASE_LEVEL (KH+)
 *   - 403 location_access_denied  — actor lacks user_locations row for instance.location_id
 *   - 404 instance_not_found      — instance load returned no row
 *   - 409 phase2_not_eligible     — instance status ≠ 'phase1_complete' (or race-loss)
 *   - 422 phase2_incomplete       — one or more Model Y universe items unsaved
 *   - 422 ground_truth_unresolved — a universe item has no live prep_data->phase1 at finalize
 *   - 500 internal_error          — unexpected (incl. inert phase2 chain-edit attempt, D3)
 *
 * Audit (lib emits internally): opening.phase2.submit with outcomes ∈ {success,
 * role_insufficient, phase2_not_eligible, phase2_incomplete, phase1_not_resolved,
 * actor_not_found, rpc_failed}. IP + user-agent threaded through.
 */

import { type NextRequest } from "next/server";

import { extractIp, jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { lockLocationContext } from "@/lib/locations";
import { OpeningError, submitPhase2Atomic } from "@/lib/opening";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

import { mapOpeningError } from "../../_helpers";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  // 1. Auth.
  const ctx = await requireSession(req, "/api/opening/submit/phase2");
  if (ctx instanceof Response) return ctx;

  // 2. Parse + validate body — finalize takes only the instance id (SPLIT).
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).instanceId !== "string" ||
    !UUID_RE.test((parsed as Record<string, unknown>).instanceId as string)
  ) {
    return jsonError(400, "invalid_payload", {
      message: "Body must include instanceId (uuid). Phase 2 finalize takes no entries (per-item saves persist beforehand).",
      field: "instanceId",
    });
  }
  const instanceId = (parsed as { instanceId: string }).instanceId;

  // 3. Server-side context resolution — instance load + location access check.
  const service = getServiceRoleClient();
  const { data: instance, error: instErr } = await service
    .from("checklist_instances")
    .select("id, location_id, status")
    .eq("id", instanceId)
    .maybeSingle<{ id: string; location_id: string; status: string }>();
  if (instErr) {
    console.error(`[/api/opening/submit/phase2] instance load failed:`, instErr.message);
    return jsonError(500, "internal_error", { message: "instance load failed" });
  }
  if (!instance) {
    return jsonError(404, "instance_not_found", {
      message: `Instance ${instanceId} not found`,
      instance_id: instanceId,
    });
  }
  if (
    !lockLocationContext({ role: ctx.role, locations: ctx.locations }, instance.location_id)
  ) {
    return jsonError(403, "location_access_denied", {
      message: "You don't have access to this location.",
      location_id: instance.location_id,
    });
  }

  // 4. Finalize. Lib emits the opening.phase2.submit audit row internally.
  try {
    const result = await submitPhase2Atomic(service, {
      instanceId,
      actor: { userId: ctx.user.id, role: ctx.role, level: ctx.level },
      ipAddress: extractIp(req),
      userAgent: req.headers.get("user-agent"),
    });
    return jsonOk({
      instance: result.instance,
      submittedCompletionIds: result.submittedCompletionIds,
      closingAutoCompleteId: result.closingAutoCompleteId, // always null
      editCount: result.editCount,
      originalSubmissionId: result.originalSubmissionId,
      underParNotificationIds: result.underParNotificationIds,
    });
  } catch (err) {
    if (err instanceof OpeningError) return mapOpeningError(err);
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[/api/opening/submit/phase2] unexpected error:`, msg);
    return jsonError(500, "internal_error", { message: "submit failed" });
  }
}
