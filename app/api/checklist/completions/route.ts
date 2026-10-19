import { resolveChecklistWriteActor, ChecklistActorNotAuthorizedError } from "@/lib/checklist-write-actor";
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
 * Behavior: service-only RPC atomically supersedes and inserts under the
 * parent lock. App validation precedes the call; no partial-write cleanup.
 * Actor attribution comes exclusively from the verified session resolver.
 * Audit: lib emits checklist_completion.create on success.
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
      actor: await resolveChecklistWriteActor(ctx),
      countValue: parsed.countValue ?? null,
      photoId: parsed.photoId ?? null,
      notes: parsed.notes ?? null,
      ipAddress: extractIp(req),
      userAgent: req.headers.get("user-agent"),
    });
    return jsonOk({ completion: result.completion });
  } catch (err) {
    if (err instanceof ChecklistActorNotAuthorizedError) return jsonError(403, "role_level_insufficient", { message: "Writing is not permitted for this session" });
    if (err instanceof ChecklistError) return mapChecklistError(err);
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/checklist/completions POST] unexpected error:", msg);
    return jsonError(500, "internal_error", { message: "completion create failed" });
  }
}
