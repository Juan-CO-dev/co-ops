/**
 * Shared helpers for /api/prep/* routes.
 *
 * `_helpers` (leading underscore) marks the folder as a Next.js private
 * folder — opted out of routing, importable as a regular module.
 *
 * mapPrepError translates the named errors from lib/prep.ts into HTTP
 * responses via lib/api-helpers.ts jsonError(). Each error class has a
 * stable HTTP status:
 *
 *   400 prep_shape          — caller-driven shape error in entries/inputs
 *   403 prep_role_violation — actor below AM_PREP_BASE_LEVEL AND no assignment
 *   403 edit_access_denied  — sub-KH+ user attempting unauthorized edit
 *                             (C.46 A8; reason discriminator distinguishes
 *                             closing_finalized_for_submitter vs
 *                             not_submitter_and_not_kh)
 *   409 prep_instance_not_open — concurrent confirm or instance state changed
 *   422 prep_auto_complete_failed — request well-formed, precondition not met
 *                                   (closing instance doesn't exist for the date;
 *                                   client should start closing first then re-submit)
 *   422 edit_limit_exceeded — chain at edit_count=3 cap (C.46 A8)
 *   500 prep_invariant      — lib-internal narrowing assertion (server bug; never
 *                             reaches user under normal conditions)
 *   500 internal_error      — unmatched/unexpected lib error (shouldn't happen)
 *
 * The helper attaches relevant identifiers to the response body so the
 * UI can surface a meaningful translated message via the `code`
 * discriminator (am_prep.error.<code> namespace) without parsing the
 * human-readable `error` string.
 */

import {
  ChecklistEditAccessDeniedError,
  ChecklistEditLimitExceededError,
  PrepAutoCompleteError,
  PrepError,
  PrepInstanceNotOpenError,
  PrepInvariantError,
  PrepRoleViolationError,
  PrepShapeError,
} from "@/lib/prep";
import { jsonError } from "@/lib/api-helpers";
import type { NextResponse } from "next/server";

export function mapPrepError(err: PrepError): NextResponse {
  if (err instanceof PrepRoleViolationError) {
    return jsonError(403, err.code, {
      message: err.message,
      required: err.required,
      actor_level: err.actorLevel,
    });
  }
  if (err instanceof PrepInstanceNotOpenError) {
    return jsonError(409, err.code, {
      message: err.message,
      instance_id: err.instanceId,
      status: err.status,
    });
  }
  if (err instanceof PrepAutoCompleteError) {
    return jsonError(422, err.code, {
      message: err.message,
      prep_instance_id: err.prepInstanceId,
      closing_item_template_item_id: err.closingItemTemplateItemId,
    });
  }
  if (err instanceof ChecklistEditLimitExceededError) {
    return jsonError(422, err.code, {
      message: err.message,
      original_submission_id: err.originalSubmissionId,
      current_edit_count: err.currentEditCount,
    });
  }
  if (err instanceof ChecklistEditAccessDeniedError) {
    return jsonError(403, err.code, {
      message: err.message,
      reason: err.reason,
    });
  }
  if (err instanceof PrepShapeError) {
    return jsonError(400, err.code, {
      message: err.message,
      template_item_id: err.templateItemId,
    });
  }
  if (err instanceof PrepInvariantError) {
    // Should never reach the route — narrowPrepTemplateItem throws this
    // during read-path narrowing on station/section drift, which would
    // surface during loadAmPrepState (before the user ever clicks submit)
    // OR during submitAmPrep's own narrowing pre-flight (still server-
    // side; user sees a generic submit failure). Either way it's a
    // server bug, not user-actionable.
    return jsonError(500, err.code, {
      message: err.message,
      template_item_id: err.templateItemId,
    });
  }
  // Unmatched PrepError subclass (defensive — every concrete subclass is
  // handled above). Falls through to generic 500.
  return jsonError(500, "internal_error", { message: err.message });
}
