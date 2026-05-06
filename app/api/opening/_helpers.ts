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
 *   400 invalid_entry_shape       — caller-driven shape error in entries
 *   400 missing_count             — fridge temp item without count value
 *   403 role_level_insufficient   — actor below OPENING_BASE_LEVEL
 *   409 instance_not_open         — concurrent confirm or status change
 *   422 auto_complete_failed      — closing instance doesn't exist for date N-1
 *                                   (caller should NOT retry; data state requires
 *                                   resolution before opening submits)
 *   500 internal_error            — unmatched / unexpected lib error
 *
 * The helper attaches relevant identifiers to the response body so the
 * UI can surface a meaningful translated message via the `code`
 * discriminator (opening.error.<code> namespace).
 */

import {
  OpeningAutoCompleteError,
  OpeningEntryShapeError,
  OpeningError,
  OpeningInstanceNotOpenError,
  OpeningMissingCountError,
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
