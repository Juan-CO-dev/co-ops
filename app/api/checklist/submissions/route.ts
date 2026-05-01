/**
 * POST /api/checklist/submissions — record a non-final submission event
 * over a batch of completions the caller just performed.
 *
 * Body: { instanceId: string, completionIds: string[] }
 *
 * Response: { submission: ChecklistSubmission }
 *
 * is_final_confirmation = false on this row. The PIN-attestation /
 * final-confirmation submission belongs to /api/checklist/confirm
 * (which writes its own checklist_submissions row with completion_ids=[]).
 *
 * Validation (in lib/checklists.ts submitBatch): every completionId
 * must exist on this instance and be authored by the actor.
 *
 * Audit: lib emits checklist_submission.create.
 */

import { type NextRequest } from "next/server";

import { ChecklistError, submitBatch } from "@/lib/checklists";
import { extractIp, jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { requireSession, SESSION_COOKIE_NAME } from "@/lib/session";
import { createAuthedClient } from "@/lib/supabase-server";

import { mapChecklistError } from "../_helpers";

interface SubmitBody {
  instanceId: string;
  completionIds: string[];
}

function isSubmitBody(raw: unknown): raw is SubmitBody {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.instanceId !== "string") return false;
  if (!Array.isArray(r.completionIds)) return false;
  for (const id of r.completionIds) {
    if (typeof id !== "string") return false;
  }
  return true;
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  if (!isSubmitBody(parsed)) {
    return jsonError(400, "invalid_payload", {
      message: "Body must include instanceId and completionIds (string[]).",
    });
  }

  const ctx = await requireSession(req, "/api/checklist/submissions");
  if (ctx instanceof Response) return ctx;

  const rawJwt = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!rawJwt) {
    return jsonError(500, "internal_error", { message: "session cookie missing after auth" });
  }
  const authed = createAuthedClient(rawJwt);

  try {
    const result = await submitBatch(authed, {
      instanceId: parsed.instanceId,
      actor: { userId: ctx.user.id, role: ctx.role, level: ctx.level },
      completionIds: parsed.completionIds,
      ipAddress: extractIp(req),
      userAgent: req.headers.get("user-agent"),
    });
    return jsonOk({ submission: result.submission });
  } catch (err) {
    if (err instanceof ChecklistError) return mapChecklistError(err);
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/checklist/submissions POST] unexpected error:", msg);
    return jsonError(500, "internal_error", { message: "submission create failed" });
  }
}
