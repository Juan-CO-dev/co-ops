/**
 * POST /api/checklist/completions/[id]/revoke — silent within-60s self-untick.
 *
 * Body: {} (empty object)
 *
 * Response: { revoked: true, completion: ChecklistCompletion }
 *
 * Per SPEC_AMENDMENTS.md C.28 two-window architecture:
 *   - Self-only (actor.userId === completed_by) — else 403 not_self
 *   - Within 60s of completed_at — else 409 outside_quick_window (caller
 *     should switch to /revoke-with-reason for the structured path)
 *   - 404-equivalent (400 completion_not_found) if the completion is
 *     already revoked or superseded
 *
 * Audit: lib emits checklist_completion.revoke with metadata.in_quick_window=true
 * and reason='error_tap'. Action is on DESTRUCTIVE_ACTIONS so the audit row
 * carries destructive=true.
 */

import { type NextRequest } from "next/server";

import { ChecklistError, revokeCompletion } from "@/lib/checklists";
import { extractIp, jsonError, jsonOk } from "@/lib/api-helpers";
import { requireSession, SESSION_COOKIE_NAME } from "@/lib/session";
import { createAuthedClient } from "@/lib/supabase-server";

import { mapChecklistError } from "../../../_helpers";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: completionId } = await params;

  const ctx = await requireSession(req, `/api/checklist/completions/${completionId}/revoke`);
  if (ctx instanceof Response) return ctx;

  const rawJwt = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!rawJwt) {
    return jsonError(500, "internal_error", { message: "session cookie missing after auth" });
  }
  const authed = createAuthedClient(rawJwt);

  try {
    const result = await revokeCompletion(authed, {
      completionId,
      actor: { userId: ctx.user.id, role: ctx.role, level: ctx.level },
      ipAddress: extractIp(req),
      userAgent: req.headers.get("user-agent"),
    });
    return jsonOk({ revoked: true, completion: result.completion });
  } catch (err) {
    if (err instanceof ChecklistError) return mapChecklistError(err);
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[/api/checklist/completions/${completionId}/revoke POST] unexpected error:`,
      msg,
    );
    return jsonError(500, "internal_error", { message: "revoke failed" });
  }
}
