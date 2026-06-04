/**
 * POST /api/checklist/completions/[id]/mark-not-done — cross-user mark-not-done
 * by authority (per SPEC_AMENDMENTS.md C.55).
 *
 * Body: { note: string }
 *
 * Response: { reopened: true, completion: ChecklistCompletion }
 *
 * This is the cross-user extension C.28 left undecided — a KH+ actor
 * reopening a false completion on SOMEONE ELSE's checklist row. Soft-revoke
 * semantics: completed_by stays as operational truth; the row is marked
 * reopened and re-completes via the normal flow.
 *
 * Authorization (all server-enforced in lib markNotDoneByAuthority — the UI
 * gate is cosmetic-only):
 *   - Cross-user only: actor !== completed_by — else 400 use_self_revoke
 *     (self-correction uses the C.28 revoke path)
 *   - Floor: KH+ (level >= 4, post-renumber) — else 403 role_level_insufficient
 *   - Post-60s only — else 409 use_quick_revoke (the completer's own silent
 *     undo owns the first 60s)
 *   - Bound: actor.level >= completer CURRENT level (at-or-below, peers
 *     included; resolved server-side) — else 403 revoke_hierarchy_violation
 *   - Note required unconditionally — else 400 revocation_note_required
 *
 * Audit: lib emits checklist_completion.revoke_by_authority (distinct from
 * C.28's checklist_completion.revoke) with completer/actor levels + note.
 * Destructive=true on the audit row.
 */

import { type NextRequest } from "next/server";

import { ChecklistError, markNotDoneByAuthority } from "@/lib/checklists";
import { extractIp, jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { requireSession, SESSION_COOKIE_NAME } from "@/lib/session";
import { createAuthedClient } from "@/lib/supabase-server";

import { mapChecklistError } from "../../../_helpers";

interface MarkNotDoneBody {
  note: string;
}

function isMarkNotDoneBody(raw: unknown): raw is MarkNotDoneBody {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.note !== "string") return false;
  return true;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: completionId } = await params;

  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  if (!isMarkNotDoneBody(parsed)) {
    return jsonError(400, "invalid_payload", {
      message: "Body must include note (string).",
    });
  }

  const ctx = await requireSession(
    req,
    `/api/checklist/completions/${completionId}/mark-not-done`,
  );
  if (ctx instanceof Response) return ctx;

  const rawJwt = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!rawJwt) {
    return jsonError(500, "internal_error", { message: "session cookie missing after auth" });
  }
  const authed = createAuthedClient(rawJwt);

  try {
    const result = await markNotDoneByAuthority(authed, {
      completionId,
      actor: { userId: ctx.user.id, role: ctx.role, level: ctx.level },
      note: parsed.note,
      ipAddress: extractIp(req),
      userAgent: req.headers.get("user-agent"),
    });
    return jsonOk({
      reopened: true,
      completion: result.completion,
    });
  } catch (err) {
    if (err instanceof ChecklistError) return mapChecklistError(err);
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[/api/checklist/completions/${completionId}/mark-not-done POST] unexpected error:`,
      msg,
    );
    return jsonError(500, "internal_error", { message: "mark-not-done failed" });
  }
}
