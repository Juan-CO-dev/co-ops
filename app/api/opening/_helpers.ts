/**
 * Shared helpers for /api/opening/* routes.
 *
 * `_helpers` (leading underscore) marks the folder as a Next.js private
 * folder — opted out of routing, importable as a regular module.
 *
 * mapOpeningError translates the named errors from lib/opening.ts into HTTP
 * responses via lib/api-helpers.ts jsonError(). Each error class has a
 * stable HTTP status:
 *
 *   400 invalid_entry_shape           — caller-driven shape error in entries
 *   400 missing_count                 — fridge temp item without count value
 *   403 role_level_insufficient       — actor below OPENING_BASE_LEVEL
 *   409 instance_not_open             — concurrent confirm or status change
 *   409 phase1_not_eligible           — C.53 entry phase mismatch (status≠'open')
 *   409 phase2_not_eligible           — C.53 entry phase mismatch (status≠'phase1_complete')
 *   409 phase3_not_eligible           — C.53 entry phase mismatch (status≠'phase2_complete')
 *   422 provenance_required           — C.54 reconstructed-morning entries without opener attestation
 *   422 out_of_range_reason_missing   — C.53 Phase 3 out-of-range verification without reason
 *   422 auto_complete_failed          — closing instance doesn't exist for date N-1
 *                                       (caller should NOT retry; data state requires
 *                                       resolution before opening submits)
 *   500 internal_error                — unmatched / unexpected lib error
 *
 * The helper attaches relevant identifiers to the response body so the
 * UI can surface a meaningful translated message via the `code`
 * discriminator (opening.error.<code> namespace).
 */

import {
  OpeningActorNotFoundError,
  OpeningAutoCompleteError,
  OpeningEntryShapeError,
  OpeningError,
  OpeningGroundTruthUnresolvedError,
  OpeningInstanceNotOpenError,
  OpeningMissingCountError,
  OpeningOutOfRangeReasonMissingError,
  OpeningPhase1NotEligibleError,
  OpeningPhase2NotEligibleError,
  OpeningPhase3NotEligibleError,
  OpeningProvenanceRequiredError,
  OpeningNullSourceRequiresRecountError,
  OpeningRoleViolationError,
} from "@/lib/opening";
import { jsonError } from "@/lib/api-helpers";
import type { NextResponse } from "next/server";

export function mapOpeningError(err: OpeningError): NextResponse {
  if (err instanceof OpeningRoleViolationError) {
    return jsonError(403, err.code, {
      message: err.message,
      required: err.required,
      actor_level: err.actual,
    });
  }
  if (err instanceof OpeningInstanceNotOpenError) {
    return jsonError(409, err.code, {
      message: err.message,
      instance_id: err.instanceId,
      status: err.status,
    });
  }
  if (
    err instanceof OpeningPhase1NotEligibleError ||
    err instanceof OpeningPhase2NotEligibleError ||
    err instanceof OpeningPhase3NotEligibleError
  ) {
    return jsonError(409, err.code, {
      message: err.message,
      instance_id: err.instanceId,
      status: err.status,
    });
  }
  if (err instanceof OpeningProvenanceRequiredError) {
    return jsonError(422, err.code, {
      message: err.message,
      instance_id: err.instanceId,
    });
  }
  if (err instanceof OpeningNullSourceRequiresRecountError) {
    return jsonError(422, err.code, {
      message: err.message,
      template_item_id: err.templateItemId,
    });
  }
  if (err instanceof OpeningGroundTruthUnresolvedError) {
    return jsonError(422, err.code, {
      message: err.message,
      template_item_id: err.templateItemId,
    });
  }
  if (err instanceof OpeningActorNotFoundError) {
    // Integrity violation (not user error, not wrong-status). Honest 500 per
    // Triad A code-gate ruling 2026-05-26 — actor row missing from `users`
    // at submit_phase1_atomic dispatch time, after route pre-checked instance.
    // 5xx → form falls back to opening.error.fallback rendering (no
    // dedicated i18n key for this should-never-happen path).
    return jsonError(500, err.code, {
      message: err.message,
      actor_id: err.actorId,
    });
  }
  if (err instanceof OpeningOutOfRangeReasonMissingError) {
    return jsonError(422, err.code, {
      message: err.message,
      setup_item_id: err.setupItemId,
      station_key: err.stationKey,
    });
  }
  if (err instanceof OpeningAutoCompleteError) {
    return jsonError(422, err.code, {
      message: err.message,
      opening_instance_id: err.openingInstanceId,
      closing_report_ref_item_id: err.closingReportRefItemId,
    });
  }
  if (err instanceof OpeningMissingCountError) {
    return jsonError(400, err.code, {
      message: err.message,
      template_item_id: err.templateItemId,
    });
  }
  if (err instanceof OpeningEntryShapeError) {
    return jsonError(400, err.code, {
      message: err.message,
    });
  }
  // Unmatched OpeningError subclass — defensive fall-through.
  return jsonError(500, "internal_error", { message: err.message });
}
