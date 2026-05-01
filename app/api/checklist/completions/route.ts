/**
 * POST /api/checklist/completions — record a single item completion.
 *
 * Body: {
 *   instanceId: string,
 *   templateItemId: string,
 *   countValue?: number | null,
 *   photoId?: string | null,
 *   notes?: string | null
 * }
 *
 * Response: { completion: ChecklistCompletion }
 *
 * Behavior: append-only with synchronous prior-completion supersession
 * (see lib/checklists.ts completeItem). On supersede partial-failure, the
 * lib audits and throws ChecklistSupersedeFailedError carrying both
 * completion ids; the route surfaces 500 supersede_failed with both ids
 * in the response body so the caller can pursue cleanup.
 *
 * RLS gates: completed_by = current_user_id(), instance status='open',
 * template_item.min_role_level <= caller level. App-layer checks in the
 * lib produce clearer errors before RLS rejection.
 *
 * Audit: lib emits checklist_completion.create on success and
 * checklist_completion.supersede_failure on the partial-failure path.
 */

import { type NextRequest } from "next/server";

import { ChecklistError, completeItem } from "@/lib/checklists";
import { extractIp, jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { requireSession, SESSION_COOKIE_NAME } from "@/lib/session";
import { createAuthedClient } from "@/lib/supabase-server";

import { mapChecklistError } from "../_helpers";

interface CompleteBody {
  instanceId: string;
  templateItemId: string;
  countValue?: number | null;
  photoId?: string | null;
  notes?: string | null;
}

function isCompleteBody(raw: unknown): raw is CompleteBody {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.instanceId !== "string" || typeof r.templateItemId !== "string") return false;
  if (
    r.countValue !== undefined &&
    r.countValue !== null &&
    typeof r.countValue !== "number"
  )
    return false;
  if (r.photoId !== undefined && r.photoId !== null && typeof r.photoId !== "string") return false;
  if (r.notes !== undefined && r.notes !== null && typeof r.notes !== "string") return false;
  return true;
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  if (!isCompleteBody(parsed)) {
    return jsonError(400, "invalid_payload", {
      message: "Body must include instanceId, templateItemId; optional countValue (number), photoId (string), notes (string).",
    });
  }

  const ctx = await requireSession(req, "/api/checklist/completions");
  if (ctx instanceof Response) return ctx;

  const rawJwt = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!rawJwt) {
    return jsonError(500, "internal_error", { message: "session cookie missing after auth" });
  }
  const authed = createAuthedClient(rawJwt);

  try {
    const result = await completeItem(authed, {
      instanceId: parsed.instanceId,
      templateItemId: parsed.templateItemId,
      actor: { userId: ctx.user.id, role: ctx.role, level: ctx.level },
      countValue: parsed.countValue ?? null,
      photoId: parsed.photoId ?? null,
      notes: parsed.notes ?? null,
      ipAddress: extractIp(req),
      userAgent: req.headers.get("user-agent"),
    });
    return jsonOk({ completion: result.completion });
  } catch (err) {
    if (err instanceof ChecklistError) return mapChecklistError(err);
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/checklist/completions POST] unexpected error:", msg);
    return jsonError(500, "internal_error", { message: "completion create failed" });
  }
}
