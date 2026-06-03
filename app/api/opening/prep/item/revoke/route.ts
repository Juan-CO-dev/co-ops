/**
 * POST /api/opening/prep/item/revoke — Phase 2 per-item §8.4 REVOKE (C.53 Lane D).
 *
 * This is the §8.4 REVOKE path — OWN thin lib (revokePhase2Completion →
 * append-only supersede of the live phase2 completion's revoked_* fields). It is
 * NOT the §8.4 WRITE path (POST /api/opening/prep/item → savePhase2Item) and NOT
 * closing's revoke routes (left untouched).
 *
 * HIERARCHICAL gate lives entirely in the lib; the CLIENT must NOT predict the
 * silent-vs-structured path (clock skew, 60s boundary). The lib decides from
 * (isSelf, elapsed, isKHPlus) and returns `path` so the client can react. The
 * route only validates the wire shape and forwards.
 *
 * Body: {
 *   instanceId: string,                       // uuid, required
 *   completionId: string,                     // uuid, required (the live phase2 row)
 *   reason?: "re_enter_count" | "other" | null,  // structured-path reason (OUTPUT)
 *   note?: string | null                      // required by lib when reason === 'other'
 * }
 *
 * Response (success): { completion, templateItemId, instanceId, path }
 *   path ∈ { "silent", "structured" } — silent writes NO audit row.
 *
 * Response (error) via mapOpeningError:
 *   - 400 invalid_payload          — body shape invalid
 *   - 403 location_access_denied   — caller can't see this location
 *   - 403 not_self                 — neither completer nor KH+ (post-window)
 *   - 404 instance_not_found       — instance row missing
 *   - 409 phase2_not_eligible      — instance status ≠ 'phase1_complete'
 *   - 409 revoke_conflict          — no live phase2 completion to revoke (raced/gone)
 *   - 422 reason_required          — structured revoke with no reason; the client's
 *                                    SIGNAL to open RevokeReasonModal (no display string)
 *   - 400 invalid_entry_shape      — target isn't a phase2 row, or reason='other' with no note
 *   - 422 revocation_reason_invalid — revocation_reason CHECK (23514) defense
 *   - 500 internal_error
 *
 * Audit (lib emits internally, STRUCTURED path only): opening.phase2.revoke.
 */

import { type NextRequest } from "next/server";

import { extractIp, jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { lockLocationContext } from "@/lib/locations";
import { OpeningError, revokePhase2Completion } from "@/lib/opening";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

import { mapOpeningError } from "../../../_helpers";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REVOKE_REASONS: ReadonlySet<string> = new Set(["re_enter_count", "other"]);

interface ValidBody {
  instanceId: string;
  completionId: string;
  reason: "re_enter_count" | "other" | null;
  note: string | null;
}

function validateBody(
  raw: unknown,
): { ok: true; body: ValidBody } | { ok: false; field: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, field: "<root>" };
  const r = raw as Record<string, unknown>;

  if (typeof r.instanceId !== "string" || !UUID_RE.test(r.instanceId)) {
    return { ok: false, field: "instanceId" };
  }
  if (typeof r.completionId !== "string" || !UUID_RE.test(r.completionId)) {
    return { ok: false, field: "completionId" };
  }

  // reason — nullable; when present must be in the structured vocabulary. The lib
  // re-validates reason as an OUTPUT after it picks the path (silent path ignores
  // it and stamps 'quick_reenter'); the route only rejects out-of-vocab values.
  let reason: ValidBody["reason"] = null;
  if (r.reason !== null && r.reason !== undefined) {
    if (typeof r.reason !== "string" || !REVOKE_REASONS.has(r.reason)) {
      return { ok: false, field: "reason" };
    }
    reason = r.reason as ValidBody["reason"];
  }

  // note — nullable string; required-when-'other' enforcement is the lib's call.
  let note: string | null = null;
  if (r.note !== null && r.note !== undefined) {
    if (typeof r.note !== "string") return { ok: false, field: "note" };
    note = r.note;
  }

  return { ok: true, body: { instanceId: r.instanceId, completionId: r.completionId, reason, note } };
}

export async function POST(req: NextRequest) {
  // 1. Auth.
  const ctx = await requireSession(req, "/api/opening/prep/item/revoke");
  if (ctx instanceof Response) return ctx;

  // 2. Parse + validate body.
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const validation = validateBody(parsed);
  if (!validation.ok) {
    return jsonError(400, "invalid_payload", {
      message:
        "Body must include instanceId (uuid), completionId (uuid), and optional reason ('re_enter_count'|'other') + note per the Phase 2 §8.4 revoke shape.",
      field: validation.field,
    });
  }
  const { instanceId, completionId, reason, note } = validation.body;

  // 3. Instance load + location access check (defense-in-depth).
  const service = getServiceRoleClient();
  const { data: instance, error: instErr } = await service
    .from("checklist_instances")
    .select("id, location_id, status")
    .eq("id", instanceId)
    .maybeSingle<{ id: string; location_id: string; status: string }>();
  if (instErr) {
    console.error(`[/api/opening/prep/item/revoke] instance load failed:`, instErr.message);
    return jsonError(500, "internal_error", { message: "instance load failed" });
  }
  if (!instance) {
    return jsonError(404, "instance_not_found", {
      message: `Instance ${instanceId} not found`,
      instance_id: instanceId,
    });
  }
  if (
    !lockLocationContext({ role: ctx.role, locations: ctx.locations }, instance.location_id)
  ) {
    return jsonError(403, "location_access_denied", {
      message: "You don't have access to this location.",
      location_id: instance.location_id,
    });
  }

  // 4. Revoke. Lib decides silent-vs-structured and emits audit (structured only).
  try {
    const result = await revokePhase2Completion(service, {
      instanceId,
      completionId,
      actor: { userId: ctx.user.id, role: ctx.role, level: ctx.level },
      reason,
      note,
      ipAddress: extractIp(req),
      userAgent: req.headers.get("user-agent"),
    });
    return jsonOk({
      completion: result.completion,
      templateItemId: result.templateItemId,
      instanceId: result.instanceId,
      path: result.path,
    });
  } catch (err) {
    if (err instanceof OpeningError) return mapOpeningError(err);
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[/api/opening/prep/item/revoke] unexpected error:`, msg);
    return jsonError(500, "internal_error", { message: "revoke failed" });
  }
}
