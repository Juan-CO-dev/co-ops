/**
 * POST /api/prep/submit — AM Prep submission per SPEC_AMENDMENTS.md C.18 +
 * C.42 + C.44 + C.46.
 *
 * Body: {
 *   instanceId: string,
 *   entries: Array<{ templateItemId: string, inputs: PrepInputs }>,
 *   isUpdate?: boolean,                 // C.46 A6 — true on chained update
 *   originalSubmissionId?: string       // required UUID when isUpdate=true
 * }
 *
 * Response (success): {
 *   instance: ChecklistInstance,
 *   submittedCompletionIds: string[],
 *   closingAutoCompleteId: string | null,  // always null on update path (A4)
 *   editCount: number,                      // 0 on original; 1-3 on update
 *   originalSubmissionId: string | null     // null on original; FK on update
 * }
 *
 * Response (error): { error: string, code: string, ...metadata } per
 * lib/api-helpers.ts jsonError shape.
 *
 * Behavior:
 *   - Validates instance exists + actor has location access (defense-in-
 *     depth; RLS would also reject under normal conditions).
 *   - Original-submission path (isUpdate=false):
 *       * Resolves closing's report-reference template item id for am_prep
 *         (null when no closing template OR no am_prep ref item — RPC
 *         handles gracefully per migration 0041 case (a)).
 *       * Resolves active assignment for the actor on this date (sub-KH+
 *         users need this for authorization).
 *       * Delegates to submitAmPrep with isUpdate=false (default flow).
 *   - Update path (isUpdate=true) per C.46:
 *       * Skips closing-ref + assignment resolution (lib's update branch
 *         doesn't use either; canEditReport handles authorization, A4
 *         keeps closing untouched).
 *       * Delegates to submitAmPrep with isUpdate=true + originalSubmissionId;
 *         lib's submitAmPrepUpdate handles chain head load, max edit_count
 *         load, closing status load, canEditReport gate, snapshot inheritance,
 *         changed_fields diff, and RPC invocation atomically.
 *   - Translates lib's typed errors to HTTP responses via mapPrepError.
 *
 * Authorization (lib-enforced):
 *   - Original-submission path: actor.level >= AM_PREP_BASE_LEVEL (3, per
 *     C.41), OR active report_assignment for (user, am_prep, location, date).
 *   - Update path: canEditReport predicate (C.46 A1) — original submitter
 *     while closing is open, OR KH+ at any time, until edit_count=3 cap.
 *
 * No PIN attestation — closing finalize PIN attests to the whole shift
 * including AM Prep (locked decision per Build #2 PR 1 surface S5).
 *
 * Audit:
 *   - Original-submission path: lib emits prep.submit with
 *     metadata.outcome ∈ {success, role_insufficient, instance_not_open,
 *     auto_complete_failed}.
 *   - Update path: RPC emits report.update inside its transaction (per
 *     C.46 A7) on success; lib emits prep.submit with metadata.outcome ∈
 *     {update_denied, update_rpc_failed} on failure paths.
 *   IP + user-agent threaded through from the route per the standard
 *   lib/audit.ts pattern.
 *
 * No rate-limiting in this PR (per Phase 2 Session 3 deferral pattern;
 * per-IP throttling lands when KV infra arrives).
 *
 * No idempotency tokens in this PR (per same deferral pattern; idempotency-
 * key infra lands when KV arrives). Real-world risk on update path is
 * small given KH+ correction frequency and UI submit-button disabled
 * state during request. If duplicate updates surface operationally,
 * capture as a future amendment with the idempotency-token pattern.
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
  /** C.46 A6 — when true, this is a chained update. */
  isUpdate?: boolean;
  /** C.46 A6 — chain head submission id; required when isUpdate=true. */
  originalSubmissionId?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Hand-rolled type guard. Returns either { ok: true, body } on a structurally
 * valid body OR { ok: false, field } pointing at the first invalid field.
 * Empty entries: [] is allowed — submits a "noted nothing today" prep per
 * the locked semantic.
 *
 * C.46 update-path validation: isUpdate must be boolean if present;
 * originalSubmissionId must be a valid UUID when isUpdate=true. Error
 * field name matches the body field name (originalSubmissionId / isUpdate)
 * for UI clarity.
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

  // C.46 update-path fields. isUpdate type check first; conditional
  // originalSubmissionId UUID check follows.
  let isUpdate: boolean | undefined;
  let originalSubmissionId: string | undefined;
  if (r.isUpdate !== undefined) {
    if (typeof r.isUpdate !== "boolean") {
      return { ok: false, field: "isUpdate" };
    }
    isUpdate = r.isUpdate;
  }
  if (isUpdate === true) {
    if (
      typeof r.originalSubmissionId !== "string" ||
      !UUID_RE.test(r.originalSubmissionId)
    ) {
      return { ok: false, field: "originalSubmissionId" };
    }
    originalSubmissionId = r.originalSubmissionId;
  }

  return {
    ok: true,
    body: {
      instanceId: r.instanceId,
      entries,
      ...(isUpdate !== undefined ? { isUpdate } : {}),
      ...(originalSubmissionId !== undefined ? { originalSubmissionId } : {}),
    },
  };
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

  // C.46 update path skips closing-ref + assignment resolution: lib's
  // submitAmPrepUpdate doesn't use either (per A4 closing untouched;
  // canEditReport replaces the role/assignment gate).
  let closingReportRefItemId: string | null = null;
  let activeAssignmentId: string | null = null;
  if (!body.isUpdate) {
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
  }

  // 4. Submit. lib emits the prep.submit audit row internally per outcome
  // on original-submission path (success or error); on update path, success
  // audit is RPC-side (per C.46 A7) and only failures audit JS-side. Route
  // just threads ipAddress + userAgent through.
  try {
    const result = await submitAmPrep(service, {
      instanceId: body.instanceId,
      actor: { userId: ctx.user.id, role: ctx.role, level: ctx.level },
      entries: body.entries,
      closingReportRefItemId,
      activeAssignmentId,
      ipAddress: extractIp(req),
      userAgent: req.headers.get("user-agent"),
      isUpdate: body.isUpdate,
      originalSubmissionId: body.originalSubmissionId,
    });
    return jsonOk({
      instance: result.instance,
      submittedCompletionIds: result.submittedCompletionIds,
      closingAutoCompleteId: result.closingAutoCompleteId,
      editCount: result.editCount,
      originalSubmissionId: result.originalSubmissionId,
    });
  } catch (err) {
    if (err instanceof PrepError) return mapPrepError(err);
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[/api/prep/submit] unexpected error:`, msg);
    return jsonError(500, "internal_error", { message: "submit failed" });
  }
}
