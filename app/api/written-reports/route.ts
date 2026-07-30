/**
 * POST /api/written-reports — author a new written report.
 *
 * Body: { body: string, title?: string|null, category?: string|null,
 *         visibilityMinLevel?: number, locationId?: string|null }
 * Response: { ok: true, id: string }
 *
 * AUTHZ: L3+ (employee+), self-authored. The live `written_reports_insert` RLS
 * policy (submitted_by = current_user_id() AND level >= 3) is the real
 * authority — we use an AUTHED client so RLS runs. Draft is validated with the
 * shared pure validator; the location, when provided, must be one the actor is
 * authorized for (a null location = an all-location post, allowed).
 *
 * No audit row: a staff-authored written report is content, not a security or
 * authorization event (per AGENTS.md audit vocabulary — self-authored routine
 * artifacts skip audit).
 */

import { type NextRequest } from "next/server";

import { extractIp, jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { requireSession, SESSION_COOKIE_NAME } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { createAuthedClient } from "@/lib/supabase-server";
import { createWrittenReport, validateWrittenReportDraft } from "@/lib/written-reports";
import { WRITTEN_REPORT_WRITE_MIN_LEVEL } from "@/lib/written-reports-shared";

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;

  const ctx = await requireSession(req, "/api/written-reports");
  if (ctx instanceof Response) return ctx;

  // Write-floor gate (app-side early error; RLS is the real authority).
  if (ctx.level < WRITTEN_REPORT_WRITE_MIN_LEVEL) {
    return jsonError(403, "forbidden", {
      message: "Your role cannot write reports.",
    });
  }

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

  // Location: null (all-location post) OR one the actor is authorized for.
  let locationId: string | null = null;
  if (typeof raw.locationId === "string" && raw.locationId.length > 0) {
    if (!ctx.locations.includes(raw.locationId)) {
      return jsonError(403, "forbidden", {
        message: "You are not assigned to that location.",
        field: "locationId",
      });
    }
    locationId = raw.locationId;
  }

  const rawJwt = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!rawJwt) {
    return jsonError(500, "internal_error", { message: "session cookie missing after auth" });
  }
  const authed = createAuthedClient(rawJwt);

  try {
    const { id } = await createWrittenReport(authed, {
      authorId: ctx.user.id,
      authorRole: ctx.role,
      locationId,
      draft: result.draft,
    });
    // MED-2 (adversarial review): written reports are staff-relevant free text —
    // audit the submit, mirroring the pm_report.submit precedent. Fail-open.
    void audit({
      actorId: ctx.user.id,
      actorRole: ctx.role,
      action: "written_report.submit",
      resourceTable: "written_reports",
      resourceId: id,
      metadata: {
        location_id: locationId,
        category: result.draft.category,
        visibility_min_level: result.draft.visibilityMinLevel,
      },
      ipAddress: extractIp(req),
      userAgent: null,
    });
    return jsonOk({ ok: true, id });
  } catch (err) {
    const ip = extractIp(req);
    console.error(
      `[/api/written-reports POST] create failed for user=${ctx.user.id} ip=${ip}:`,
      err instanceof Error ? err.message : String(err),
    );
    return jsonError(500, "internal_error", { message: "Could not save the report." });
  }
}
