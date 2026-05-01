/**
 * POST /api/checklist/confirm — PIN-attestation finalization of a
 * checklist instance.
 *
 * Body: {
 *   instanceId: string,
 *   pin: string,
 *   incompleteReasons: Array<{ templateItemId: string, reason: string }>
 * }
 *
 * Response: {
 *   instance: ChecklistInstance,
 *   status: 'confirmed' | 'incomplete_confirmed',
 *   incompleteReasonRows: ChecklistIncompleteReason[]
 * }
 *
 * Behavior (per spec §6.1 + lib/checklists.ts confirmInstance):
 *   - Validates instance is open, template not single-submission-locked.
 *   - Checks actor.level >= highest min_role_level among completed items.
 *   - Validates the caller-supplied incompleteReasons set matches the
 *     actual required-and-incomplete set exactly.
 *   - Verifies PIN against users.pin_hash via authed self-read.
 *   - Inserts incomplete_reasons rows, final-confirmation submission row,
 *     transitions checklist_instances.status with optimistic concurrency.
 *
 * Audit: every confirm attempt — successful or failed — emits a single
 * checklist.confirm row with metadata.outcome ∈ {success,
 * role_insufficient, pin_mismatch, missing_pin_hash}. Forensic queries
 * find every confirm attempt by filtering on the action alone.
 *
 * NB: Confirmation state is denormalized onto checklist_instances per
 * SPEC_AMENDMENTS.md C.16 — there is no separate checklist_confirmations
 * table.
 */

import { type NextRequest } from "next/server";

import { ChecklistError, confirmInstance } from "@/lib/checklists";
import { extractIp, jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { requireSession, SESSION_COOKIE_NAME } from "@/lib/session";
import { createAuthedClient } from "@/lib/supabase-server";

import { mapChecklistError } from "../_helpers";

interface ConfirmBody {
  instanceId: string;
  pin: string;
  incompleteReasons: Array<{ templateItemId: string; reason: string }>;
}

function isConfirmBody(raw: unknown): raw is ConfirmBody {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.instanceId !== "string" || typeof r.pin !== "string") return false;
  if (!Array.isArray(r.incompleteReasons)) return false;
  for (const item of r.incompleteReasons) {
    if (typeof item !== "object" || item === null) return false;
    const it = item as Record<string, unknown>;
    if (typeof it.templateItemId !== "string" || typeof it.reason !== "string") return false;
  }
  return true;
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  if (!isConfirmBody(parsed)) {
    return jsonError(400, "invalid_payload", {
      message:
        "Body must include instanceId, pin, incompleteReasons (Array<{templateItemId, reason}>).",
    });
  }
  if (parsed.pin.length === 0) {
    return jsonError(400, "invalid_payload", { field: "pin", message: "pin must not be empty" });
  }

  const ctx = await requireSession(req, "/api/checklist/confirm");
  if (ctx instanceof Response) return ctx;

  const rawJwt = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!rawJwt) {
    return jsonError(500, "internal_error", { message: "session cookie missing after auth" });
  }
  const authed = createAuthedClient(rawJwt);

  try {
    const result = await confirmInstance(authed, {
      instanceId: parsed.instanceId,
      actor: { userId: ctx.user.id, role: ctx.role, level: ctx.level },
      pin: parsed.pin,
      incompleteReasons: parsed.incompleteReasons,
      ipAddress: extractIp(req),
      userAgent: req.headers.get("user-agent"),
    });
    return jsonOk({
      instance: result.instance,
      status: result.status,
      incompleteReasonRows: result.incompleteReasonRows,
    });
  } catch (err) {
    if (err instanceof ChecklistError) return mapChecklistError(err);
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/checklist/confirm POST] unexpected error:", msg);
    return jsonError(500, "internal_error", { message: "confirm failed" });
  }
}
