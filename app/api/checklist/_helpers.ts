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
 *   400 invalid_payload         — caller-driven request errors
 *       missing_count, missing_photo, missing_reasons, extra_reasons,
 *       empty_batch, completion_not_found, completion_wrong_instance,
 *       completion_wrong_author, invalid_picker_candidate,
 *       revocation_note_required, use_quick_revoke
 *   401 pin_mismatch            — confirmation PIN didn't match (no lockout)
 *   403 role_level_insufficient — actor's role level too low for the op
 *       not_self                — silent revoke attempted on someone else's row
 *       tag_hierarchy_violation — KH attempting to override AGM tag, etc.
 *   409 instance_closed | single_submission_locked — state conflict
 *       outside_quick_window    — silent revoke attempted past 60s
 *       tag_within_quick_window — KH+ tag attempted within 60s self-correction window
 *       concurrent_modification — revoke/tag UPDATE matched 0 rows (raced)
 *   500 supersede_failed        — partial-failure forensic case (rare)
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
  ChecklistOutsideQuickWindowError,
  ChecklistNotSelfError,
  ChecklistTagWithinQuickWindowError,
  ChecklistInvalidPickerCandidateError,
  ChecklistTagHierarchyViolationError,
  ChecklistRevocationNoteRequiredError,
  ChecklistConcurrentModificationError,
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
  // Revoke / tag errors (per SPEC_AMENDMENTS.md C.28).
  if (err instanceof ChecklistOutsideQuickWindowError) {
    return jsonError(409, err.code, {
      message: err.message,
      completion_id: err.completionId,
      elapsed_ms: err.elapsedMs,
    });
  }
  if (err instanceof ChecklistNotSelfError) {
    return jsonError(403, err.code, {
      message: err.message,
      completion_id: err.completionId,
    });
  }
  if (err instanceof ChecklistTagWithinQuickWindowError) {
    return jsonError(409, err.code, {
      message: err.message,
      completion_id: err.completionId,
      remaining_ms: err.remainingMs,
    });
  }
  if (err instanceof ChecklistInvalidPickerCandidateError) {
    return jsonError(400, err.code, {
      message: err.message,
      completion_id: err.completionId,
      proposed_actual_completer_id: err.proposedActualCompleterId,
      reason: err.reason,
      field: "actualCompleterId",
    });
  }
  if (err instanceof ChecklistTagHierarchyViolationError) {
    return jsonError(403, err.code, {
      message: err.message,
      completion_id: err.completionId,
      current_tagger_level: err.currentTaggerLevel,
      attempted_replacer_level: err.attemptedReplacerLevel,
    });
  }
  if (err instanceof ChecklistRevocationNoteRequiredError) {
    return jsonError(400, err.code, {
      message: err.message,
      completion_id: err.completionId,
      field: "note",
    });
  }
  if (err instanceof ChecklistConcurrentModificationError) {
    return jsonError(409, err.code, {
      message: err.message,
      completion_id: err.completionId,
      operation: err.operation,
    });
  }
  // Generic ChecklistError with an in-band code (empty_batch,
  // completion_not_found, completion_wrong_instance, completion_wrong_author,
  // use_quick_revoke, invalid_payload).
  return jsonError(400, err.code, { message: err.message });
}
