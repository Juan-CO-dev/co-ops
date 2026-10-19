/**
 * PATCH /api/written-reports/[id] — self-edit a report inside the 3-hour window.
 *
 * Body: { body: string, title?: string|null, category?: string|null,
 *         visibilityMinLevel?: number }
 * Response: { ok: true } | 403 window_closed
 *
 * AUTHZ: verified server actor; the service-only 0276 RPC checks self-author
 * and the strict three-hour window in SQL, increments edit_count atomically,
 * and returns rowcount. Zero rows retains the existing 403 window_closed.
 * Successful edits emit written_report.update through the fail-open audit helper.
 */

import { type NextRequest } from "next/server";

import { extractIp, jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { requireSession } from "@/lib/session";
import { resolveChecklistWriteActor, ChecklistActorNotAuthorizedError, ChecklistActorTransientError } from "@/lib/checklist-write-actor";
import { updateWrittenReport, validateWrittenReportDraft } from "@/lib/written-reports";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(id)) {
    return jsonError(400, "invalid_payload", { message: "Bad report id." });
  }

  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;

  const ctx = await requireSession(req, `/api/written-reports/${id}`);
  if (ctx instanceof Response) return ctx;

  let actor;
  try {
    actor = await resolveChecklistWriteActor(ctx);
  } catch (err) {
    if (err instanceof ChecklistActorTransientError) return jsonError(503, "checklist_actor_unavailable");
    if (err instanceof ChecklistActorNotAuthorizedError) return jsonError(403, "forbidden");
    throw err;
  }

  const raw = parsed as Record<string, unknown>;
  const result = validateWrittenReportDraft({
    title: raw.title,
    body: raw.body,
    category: raw.category,
    visibilityMinLevel: raw.visibilityMinLevel,
    authorLevel: actor.level,
  });
  if (!result.ok || !result.draft) {
    return jsonError(400, result.error ?? "invalid_payload", {
      message: "Report draft is invalid.",
      field: result.error === "body_required" || result.error === "body_too_long" ? "body" : undefined,
    });
  }

  try {
    const res = await updateWrittenReport({ actor, id, draft: result.draft });
    if (!res.ok) {
      // Conditional SQL UPDATE denied: not the author, or the 3-hour edit window has closed.
      return jsonError(403, "window_closed", {
        message: "This report can no longer be edited.",
      });
    }
    // MED-2: audit the within-window edit — who changed an incident report's
    // body/visibility, when (the edit path is the security-relevant one).
    void audit({
      actorId: actor.userId,
      actorRole: actor.role,
      action: "written_report.update",
      resourceTable: "written_reports",
      resourceId: id,
      metadata: {
        category: result.draft.category,
        visibility_min_level: result.draft.visibilityMinLevel,
      },
      ipAddress: extractIp(req),
      userAgent: null,
    });
    return jsonOk({ ok: true });
  } catch (err) {
    if (err instanceof ChecklistActorTransientError) return jsonError(503, "checklist_actor_unavailable");
    if (err instanceof ChecklistActorNotAuthorizedError) return jsonError(403, "forbidden");
    const ip = extractIp(req);
    console.error(
      `[/api/written-reports/${id} PATCH] update failed for user=${ctx.user.id} ip=${ip}:`,
      err instanceof Error ? err.message : String(err),
    );
    return jsonError(500, "internal_error", { message: "Could not update the report." });
  }
}
