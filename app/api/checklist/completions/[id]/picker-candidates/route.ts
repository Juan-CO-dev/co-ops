/**
 * GET /api/checklist/completions/[id]/picker-candidates — picker scope for tagging.
 *
 * Response: { candidates: Array<{ id, name, role, level }> }
 *
 * Per SPEC_AMENDMENTS.md C.28's picker scope rules. Authorization: KH+ (level >= 4)
 * OR self when actor === completed_by. Returns the full candidate set
 * (completers ∪ (location-assigned ∩ today's sign-ins), filtered by item's
 * min_role_level + active). Self-exclusion for the wrong_user_credited
 * self-correction flow is the UI's responsibility (per PR 2 design lock #7);
 * this endpoint returns the unfiltered server-side scope.
 *
 * Forwards lib's ChecklistError taxonomy through the standard mapper:
 *   400 completion_not_found  — id not visible to caller, revoked, or superseded
 *   403 role_level_insufficient — actor is below KH AND not self
 *
 * No write side effects; no audit row (read-only operation).
 */

import { type NextRequest } from "next/server";

import { ChecklistError, loadPickerCandidatesForCompletion } from "@/lib/checklists";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { requireSession, SESSION_COOKIE_NAME } from "@/lib/session";
import { createAuthedClient } from "@/lib/supabase-server";

import { mapChecklistError } from "../../../_helpers";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: completionId } = await params;

  const ctx = await requireSession(
    req,
    `/api/checklist/completions/${completionId}/picker-candidates`,
  );
  if (ctx instanceof Response) return ctx;

  const rawJwt = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!rawJwt) {
    return jsonError(500, "internal_error", { message: "session cookie missing after auth" });
  }
  const authed = createAuthedClient(rawJwt);

  try {
    const candidates = await loadPickerCandidatesForCompletion(authed, {
      completionId,
      actor: { userId: ctx.user.id, role: ctx.role, level: ctx.level },
    });
    return jsonOk({ candidates });
  } catch (err) {
    if (err instanceof ChecklistError) return mapChecklistError(err);
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[/api/checklist/completions/${completionId}/picker-candidates GET] unexpected error:`,
      msg,
    );
    return jsonError(500, "internal_error", { message: "picker-candidates load failed" });
  }
}
