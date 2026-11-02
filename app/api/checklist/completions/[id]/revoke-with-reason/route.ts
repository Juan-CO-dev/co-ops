import { assertSameOrigin } from "@/lib/portal/csrf";
/**
 * POST /api/checklist/completions/[id]/revoke-with-reason — post-60s structured self-revoke.
 *
 * Body: { reason: 'not_actually_done' | 'other', note?: string }
 *
 * Response: { revoked: true, completion: ChecklistCompletion }
 *
 * Per SPEC_AMENDMENTS.md C.28 two-window architecture:
 *   - Self-only (actor.userId === completed_by) — else 403 not_self
 *   - Past 60s of completed_at — else 400 use_quick_revoke (caller should
 *     switch to /revoke for the silent path)
 *   - reason='error_tap' rejected here (silent path only) — 400 invalid_payload
 *   - reason='other' requires non-empty note — else 400 revocation_note_required
 *
 * Audit: lib emits checklist_completion.revoke with metadata.in_quick_window=false,
 * reason, and (when present) note. Destructive=true on the audit row.
 */

import { type NextRequest } from "next/server";

import { ChecklistError, revokeWithReason } from "@/lib/checklists";
import { extractIp, jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { requireSession, SESSION_COOKIE_NAME } from "@/lib/session";
import { resolveChecklistWriteActor, ChecklistActorNotAuthorizedError, ChecklistActorTransientError } from "@/lib/checklist-write-actor";
import { createAuthedClient } from "@/lib/supabase-server";

import { mapChecklistError } from "../../../_helpers";

interface RevokeWithReasonBody {
  reason: "not_actually_done" | "other";
  note?: string | null;
}

function isRevokeWithReasonBody(raw: unknown): raw is RevokeWithReasonBody {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  if (r.reason !== "not_actually_done" && r.reason !== "other") return false;
  if (r.note !== undefined && r.note !== null && typeof r.note !== "string") return false;
  return true;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id: completionId } = await params;

  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  if (!isRevokeWithReasonBody(parsed)) {
    return jsonError(400, "invalid_payload", {
      message: "Body must include reason ('not_actually_done' or 'other'); optional note (string).",
    });
  }

  const ctx = await requireSession(
    req,
    `/api/checklist/completions/${completionId}/revoke-with-reason`,
  );
  if (ctx instanceof Response) return ctx;

  const rawJwt = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!rawJwt) {
    return jsonError(500, "internal_error", { message: "session cookie missing after auth" });
  }
  const authed = createAuthedClient(rawJwt);

  try {
    const result = await revokeWithReason(authed, {
      completionId,
      actor: await resolveChecklistWriteActor(ctx),
      reason: parsed.reason,
      note: parsed.note ?? null,
      ipAddress: extractIp(req),
      userAgent: req.headers.get("user-agent"),
    });
    return jsonOk({ revoked: true, completion: result.completion });
  } catch (err) {
    if (err instanceof ChecklistActorTransientError) return jsonError(503, "checklist_actor_unavailable");
    if (err instanceof ChecklistActorNotAuthorizedError) return jsonError(403, "role_level_insufficient", { message: "Writing is not permitted for this session" });
    if (err instanceof ChecklistError) return mapChecklistError(err);
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[/api/checklist/completions/${completionId}/revoke-with-reason POST] unexpected error:`,
      msg,
    );
    return jsonError(500, "internal_error", { message: "revoke-with-reason failed" });
  }
}
