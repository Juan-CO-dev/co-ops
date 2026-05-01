/**
 * Shared helpers for /api/checklist/* routes.
 *
 * `_helpers` (leading underscore) marks the folder as a Next.js private
 * folder — opted out of routing, importable as a regular module.
 *
 * mapChecklistError translates the named errors from lib/checklists.ts
 * into HTTP responses via lib/api-helpers.ts jsonError(). Each error
 * class has a stable HTTP status:
 *
 *   400 invalid_payload      — caller-driven request errors
 *       missing_count, missing_photo, missing_reasons, extra_reasons,
 *       empty_batch, completion_not_found, completion_wrong_instance,
 *       completion_wrong_author
 *   401 pin_mismatch         — confirmation PIN didn't match (no lockout)
 *   403 role_level_insufficient — actor's role level too low for the op
 *   409 instance_closed | single_submission_locked — state conflict
 *   500 supersede_failed     — partial-failure forensic case (rare)
 *
 * The helper attaches relevant identifiers (templateItemId, missing IDs,
 * etc.) to the response body so the UI can surface a meaningful message
 * to the user without parsing the human-readable `error` string.
 */

import {
  ChecklistError,
  ChecklistInstanceClosedError,
  ChecklistLockedError,
  ChecklistRoleViolationError,
  ChecklistMissingCountError,
  ChecklistMissingPhotoError,
  ChecklistPinMismatchError,
  ChecklistMissingReasonError,
  ChecklistExtraReasonError,
  ChecklistSupersedeFailedError,
} from "@/lib/checklists";
import { jsonError } from "@/lib/api-helpers";
import type { NextResponse } from "next/server";

export function mapChecklistError(err: ChecklistError): NextResponse {
  if (err instanceof ChecklistInstanceClosedError) {
    return jsonError(409, err.code, {
      message: err.message,
      instance_id: err.instanceId,
      status: err.status,
    });
  }
  if (err instanceof ChecklistLockedError) {
    return jsonError(409, err.code, {
      message: err.message,
      instance_id: err.instanceId,
    });
  }
  if (err instanceof ChecklistRoleViolationError) {
    return jsonError(403, err.code, {
      message: err.message,
      required: err.required,
      actual: err.actual,
    });
  }
  if (err instanceof ChecklistMissingCountError) {
    return jsonError(400, err.code, {
      message: err.message,
      template_item_id: err.templateItemId,
      field: "countValue",
    });
  }
  if (err instanceof ChecklistMissingPhotoError) {
    return jsonError(400, err.code, {
      message: err.message,
      template_item_id: err.templateItemId,
      field: "photoId",
    });
  }
  if (err instanceof ChecklistPinMismatchError) {
    return jsonError(401, err.code, { message: err.message });
  }
  if (err instanceof ChecklistMissingReasonError) {
    return jsonError(400, err.code, {
      message: err.message,
      missing_template_item_ids: err.missingTemplateItemIds,
    });
  }
  if (err instanceof ChecklistExtraReasonError) {
    return jsonError(400, err.code, {
      message: err.message,
      extra_template_item_ids: err.extraTemplateItemIds,
    });
  }
  if (err instanceof ChecklistSupersedeFailedError) {
    return jsonError(500, err.code, {
      message: err.message,
      new_completion_id: err.newCompletionId,
      prior_completion_id: err.priorCompletionId,
    });
  }
  // Generic ChecklistError with an in-band code (empty_batch,
  // completion_not_found, completion_wrong_instance, completion_wrong_author).
  return jsonError(400, err.code, { message: err.message });
}
