/**
 * POST /api/written-reports — author a new written report.
 *
 * Body: { body: string, title?: string|null, category?: string|null,
 *         visibilityMinLevel?: number, locationId?: string|null }
 * Response: { ok: true, id: string }
 *
 * AUTHZ: fresh verified server actor, L3+, self-authored, null-or-member
 * location. The data layer uses the service client with these explicit guards.
 * Successful posts emit written_report.submit through the fail-open audit helper.
 */

import { type NextRequest } from "next/server";

import { extractIp, jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { audit } from "@/lib/audit";
import { requireSession } from "@/lib/session";
import { resolveChecklistWriteActor, ChecklistActorNotAuthorizedError } from "@/lib/checklist-write-actor";
import { createWrittenReport, validateWrittenReportDraft } from "@/lib/written-reports";
import { WRITTEN_REPORT_WRITE_MIN_LEVEL } from "@/lib/written-reports-shared";

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;

  const ctx = await requireSession(req, "/api/written-reports");
  if (ctx instanceof Response) return ctx;

  let actor;
  try {
    actor = await resolveChecklistWriteActor(ctx);
  } catch (err) {
    if (err instanceof ChecklistActorNotAuthorizedError) return jsonError(403, "forbidden");
    throw err;
  }

  // Write-floor gate (fresh server actor).
  if (actor.level < WRITTEN_REPORT_WRITE_MIN_LEVEL) {
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
    authorLevel: actor.level,
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
    if (!actor.locations.includes(raw.locationId)) {
      return jsonError(403, "forbidden", {
        message: "You are not assigned to that location.",
        field: "locationId",
      });
    }
    locationId = raw.locationId;
  }

  try {
    const { id } = await createWrittenReport({
      actor,
      locationId,
      draft: result.draft,
    });
    // MED-2 (adversarial review): written reports are staff-relevant free text —
    // audit the submit, mirroring the pm_report.submit precedent. Fail-open.
    void audit({
      actorId: actor.userId,
      actorRole: actor.role,
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
    if (err instanceof ChecklistActorNotAuthorizedError) return jsonError(403, "forbidden");
    const ip = extractIp(req);
    console.error(
      `[/api/written-reports POST] create failed for user=${ctx.user.id} ip=${ip}:`,
      err instanceof Error ? err.message : String(err),
    );
    return jsonError(500, "internal_error", { message: "Could not save the report." });
  }
}
