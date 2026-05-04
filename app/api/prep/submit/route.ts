/**
 * POST /api/prep/submit — AM Prep submission per SPEC_AMENDMENTS.md C.18 +
 * C.42 + C.44.
 *
 * Body: {
 *   instanceId: string,
 *   entries: Array<{ templateItemId: string, inputs: PrepInputs }>
 * }
 *
 * Response (success): {
 *   instance: ChecklistInstance,
 *   submittedCompletionIds: string[],
 *   closingAutoCompleteId: string | null
 * }
 *
 * Response (error): { error: string, code: string, ...metadata } per
 * lib/api-helpers.ts jsonError shape.
 *
 * Behavior:
 *   - Validates instance exists + actor has location access (defense-in-
 *     depth; RLS would also reject under normal conditions).
 *   - Resolves closing's report-reference template item id for am_prep
 *     (null when no closing template OR no am_prep ref item — RPC handles
 *     gracefully per migration 0041 case (a)).
 *   - Resolves active assignment for the actor on this date (sub-KH+
 *     users need this for authorization).
 *   - Delegates to lib/prep.ts submitAmPrep, which invokes the
 *     submit_am_prep_atomic SECURITY DEFINER RPC (migration 0041) for
 *     atomic write across completions + submission + instance confirmation
 *     + closing auto-complete.
 *   - Translates lib's typed errors to HTTP responses via mapPrepError
 *     in app/api/prep/_helpers.ts.
 *
 * Authorization (lib-enforced):
 *   - actor.level >= AM_PREP_BASE_LEVEL (3, per C.41 reconciliation), OR
 *   - active report_assignment for (user, am_prep, location, date)
 *
 * No PIN attestation — closing finalize PIN attests to the whole shift
 * including AM Prep (locked decision per Build #2 PR 1 surface S5).
 *
 * Audit (lib-side, after RPC success): prep.submit with metadata.outcome
 * ∈ {success, role_insufficient, instance_not_open, auto_complete_failed}.
 * IP and user-agent threaded through from the route per the standard
 * lib/audit.ts pattern.
 *
 * No rate-limiting in this PR (per Phase 2 Session 3 deferral pattern;
 * per-IP throttling lands when KV infra arrives).
 */

import { type NextRequest } from "next/server";

import { extractIp, jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { lockLocationContext } from "@/lib/locations";
import {
  PrepError,
  isPrepInputs,
  loadAssignmentForToday,
  resolveClosingReportRefItemId,
  submitAmPrep,
} from "@/lib/prep";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { PrepInputs } from "@/lib/types";

import { mapPrepError } from "../_helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Body shape + validation
// ─────────────────────────────────────────────────────────────────────────────

interface SubmitBody {
  instanceId: string;
  entries: Array<{
    templateItemId: string;
    inputs: PrepInputs;
  }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Hand-rolled type guard. Returns either { ok: true, body } on a structurally
 * valid body OR { ok: false, field } pointing at the first invalid field.
 * Empty entries: [] is allowed — submits a "noted nothing today" prep per
 * the locked semantic.
 */
function validateBody(
  raw: unknown,
): { ok: true; body: SubmitBody } | { ok: false; field: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, field: "<root>" };
  const r = raw as Record<string, unknown>;

  if (typeof r.instanceId !== "string" || !UUID_RE.test(r.instanceId)) {
    return { ok: false, field: "instanceId" };
  }
  if (!Array.isArray(r.entries)) return { ok: false, field: "entries" };

  const entries: SubmitBody["entries"] = [];
  for (let i = 0; i < r.entries.length; i++) {
    const e = r.entries[i];
    if (typeof e !== "object" || e === null) return { ok: false, field: `entries[${i}]` };
    const er = e as Record<string, unknown>;
    if (typeof er.templateItemId !== "string" || !UUID_RE.test(er.templateItemId)) {
      return { ok: false, field: `entries[${i}].templateItemId` };
    }
    if (!isPrepInputs(er.inputs)) {
      return { ok: false, field: `entries[${i}].inputs` };
    }
    // isPrepInputs narrows er.inputs to PrepInputs.
    entries.push({ templateItemId: er.templateItemId, inputs: er.inputs });
  }

  return { ok: true, body: { instanceId: r.instanceId, entries } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // 1. Auth.
  const ctx = await requireSession(req, "/api/prep/submit");
  if (ctx instanceof Response) return ctx;

  // 2. Parse + validate body.
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;

  const validation = validateBody(parsed);
  if (!validation.ok) {
    return jsonError(400, "invalid_payload", {
      message:
        "Body must include instanceId (uuid) and entries (Array<{templateItemId: uuid, inputs: PrepInputs}>).",
      field: validation.field,
    });
  }
  const body = validation.body;

  // 3. Server-side context resolution.
  const service = getServiceRoleClient();

  const { data: instance, error: instErr } = await service
    .from("checklist_instances")
    .select("id, location_id, date, status, template_id")
    .eq("id", body.instanceId)
    .maybeSingle<{
      id: string;
      location_id: string;
      date: string;
      status: string;
      template_id: string;
    }>();
  if (instErr) {
    console.error(`[/api/prep/submit] instance load failed:`, instErr.message);
    return jsonError(500, "internal_error", { message: "instance load failed" });
  }
  if (!instance) {
    return jsonError(404, "instance_not_found", {
      message: `Instance ${body.instanceId} not found`,
      instance_id: body.instanceId,
    });
  }

  // Defense-in-depth — RLS would also block, but explicit gate gives a
  // clean message. Mirrors closing/page.tsx's lockLocationContext pattern.
  if (
    !lockLocationContext(
      { role: ctx.role, locations: ctx.locations },
      instance.location_id,
    )
  ) {
    return jsonError(403, "location_access_denied", {
      message: "You don't have access to this location.",
      location_id: instance.location_id,
    });
  }

  let closingReportRefItemId: string | null = null;
  let activeAssignmentId: string | null = null;
  try {
    closingReportRefItemId = await resolveClosingReportRefItemId(service, {
      locationId: instance.location_id,
      reportType: "am_prep",
    });
    const assignment = await loadAssignmentForToday(service, {
      userId: ctx.user.id,
      reportType: "am_prep",
      locationId: instance.location_id,
      date: instance.date,
    });
    activeAssignmentId = assignment?.assignmentId ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[/api/prep/submit] context resolution failed:`, msg);
    return jsonError(500, "internal_error", { message: "context resolution failed" });
  }

  // 4. Submit. lib emits the prep.submit audit row internally per outcome
  // (success or error path); route just threads ipAddress + userAgent
  // through.
  try {
    const result = await submitAmPrep(service, {
      instanceId: body.instanceId,
      actor: { userId: ctx.user.id, role: ctx.role, level: ctx.level },
      entries: body.entries,
      closingReportRefItemId,
      activeAssignmentId,
      ipAddress: extractIp(req),
      userAgent: req.headers.get("user-agent"),
    });
    return jsonOk({
      instance: result.instance,
      submittedCompletionIds: result.submittedCompletionIds,
      closingAutoCompleteId: result.closingAutoCompleteId,
    });
  } catch (err) {
    if (err instanceof PrepError) return mapPrepError(err);
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[/api/prep/submit] unexpected error:`, msg);
    return jsonError(500, "internal_error", { message: "submit failed" });
  }
}
