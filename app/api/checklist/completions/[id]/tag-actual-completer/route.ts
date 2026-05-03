/**
 * POST /api/checklist/completions/[id]/tag-actual-completer — KH+ peer correction
 * (or self wrong_user_credited).
 *
 * Body: { actualCompleterId: string }
 *
 * Response: { tagged: true, completion: ChecklistCompletion, replacedPriorTag: boolean }
 *
 * Per SPEC_AMENDMENTS.md C.28 accountability-truth model:
 *   - Authorization: KH+ (level >= 4) OR self when actor === completed_by
 *   - Past 60s of completed_at — else 409 tag_within_quick_window (during the
 *     silent window the actor self-corrects via /revoke; tagging blocked to
 *     avoid racing the actor's own correction)
 *   - actualCompleterId must be in picker scope: completer on this instance
 *     OR location-assigned + signed in today, AND active, AND level >=
 *     template_item.min_role_level — else 400 invalid_picker_candidate
 *     (with reason ∈ {out_of_scope, role_below_floor, inactive, not_found})
 *   - When replacing an existing tag, replacer level must be >= current
 *     tagger's level (lateral-and-upward only); self-correction by the
 *     original tagger is always allowed — else 403 tag_hierarchy_violation
 *
 * Audit: lib emits checklist_completion.tag_actual_completer with metadata
 * including actual_completer_id and replaced_prior_tag (when applicable).
 * Destructive=true on the audit row.
 *
 * Operational note: completed_by is NEVER modified (operational truth — the
 * append-only tap event). Only the actual_completer_* columns are written
 * (accountability truth — retrospective correction of who actually did the
 * work).
 */

import { type NextRequest } from "next/server";

import { ChecklistError, tagActualCompleter } from "@/lib/checklists";
import { extractIp, jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { requireSession, SESSION_COOKIE_NAME } from "@/lib/session";
import { createAuthedClient } from "@/lib/supabase-server";

import { mapChecklistError } from "../../../_helpers";

interface TagActualCompleterBody {
  actualCompleterId: string;
}

function isTagActualCompleterBody(raw: unknown): raw is TagActualCompleterBody {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.actualCompleterId !== "string" || r.actualCompleterId.length === 0) return false;
  return true;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: completionId } = await params;

  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  if (!isTagActualCompleterBody(parsed)) {
    return jsonError(400, "invalid_payload", {
      message: "Body must include actualCompleterId (non-empty string).",
    });
  }

  const ctx = await requireSession(
    req,
    `/api/checklist/completions/${completionId}/tag-actual-completer`,
  );
  if (ctx instanceof Response) return ctx;

  const rawJwt = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!rawJwt) {
    return jsonError(500, "internal_error", { message: "session cookie missing after auth" });
  }
  const authed = createAuthedClient(rawJwt);

  try {
    const result = await tagActualCompleter(authed, {
      completionId,
      actor: { userId: ctx.user.id, role: ctx.role, level: ctx.level },
      actualCompleterId: parsed.actualCompleterId,
      ipAddress: extractIp(req),
      userAgent: req.headers.get("user-agent"),
    });
    return jsonOk({
      tagged: true,
      completion: result.completion,
      replacedPriorTag: result.replacedPriorTag,
    });
  } catch (err) {
    if (err instanceof ChecklistError) return mapChecklistError(err);
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[/api/checklist/completions/${completionId}/tag-actual-completer POST] unexpected error:`,
      msg,
    );
    return jsonError(500, "internal_error", { message: "tag-actual-completer failed" });
  }
}
