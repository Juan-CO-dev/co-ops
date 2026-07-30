/**
 * PATCH /api/written-reports/[id] — self-edit a report inside the 3-hour window.
 *
 * Body: { body: string, title?: string|null, category?: string|null,
 *         visibilityMinLevel?: number }
 * Response: { ok: true } | 403 window_closed
 *
 * AUTHZ: the live `written_reports_update_self` RLS policy is the authority
 * (submitted_by = current_user_id() AND submitted_at > now()-3h). We use an
 * AUTHED client so RLS runs; per AGENTS.md silent-UPDATE-denial law, a 0-rowcount
 * UPDATE is treated as a 403 (window closed or not the author). Append-only:
 * there is NO DELETE route (RLS denies delete outright).
 *
 * No audit row: routine self-authored correction (per AGENTS.md audit vocabulary).
 */

import { type NextRequest } from "next/server";

import { extractIp, jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { requireSession, SESSION_COOKIE_NAME } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { createAuthedClient } from "@/lib/supabase-server";
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

  const raw = parsed as Record<string, unknown>;
  const result = validateWrittenReportDraft({
    title: raw.title,
    body: raw.body,
    category: raw.category,
    visibilityMinLevel: raw.visibilityMinLevel,
    authorLevel: getRoleLevel(ctx.user.role),
  });
  if (!result.ok || !result.draft) {
    return jsonError(400, result.error ?? "invalid_payload", {
      message: "Report draft is invalid.",
      field: result.error === "body_required" || result.error === "body_too_long" ? "body" : undefined,
    });
  }

  const rawJwt = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!rawJwt) {
    return jsonError(500, "internal_error", { message: "session cookie missing after auth" });
  }
  const authed = createAuthedClient(rawJwt);

  try {
    const res = await updateWrittenReport(authed, { id, draft: result.draft });
    if (!res.ok) {
      // RLS denied: not the author, or the 3-hour edit window has closed.
      return jsonError(403, "window_closed", {
        message: "This report can no longer be edited.",
      });
    }
    // MED-2: audit the within-window edit — who changed an incident report's
    // body/visibility, when (the edit path is the security-relevant one).
    void audit({
      actorId: ctx.user.id,
      actorRole: ctx.role,
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
    const ip = extractIp(req);
    console.error(
      `[/api/written-reports/${id} PATCH] update failed for user=${ctx.user.id} ip=${ip}:`,
      err instanceof Error ? err.message : String(err),
    );
    return jsonError(500, "internal_error", { message: "Could not update the report." });
  }
}
