/**
 * POST /api/opening/submit — Opening Phase 1 submission per
 * BUILD_3_OPENING_REPORT_DESIGN.md §2 + SPEC_AMENDMENTS.md C.42 + C.49.
 *
 * Body: {
 *   instanceId: string,
 *   entries: Array<{
 *     templateItemId: string,
 *     countValue: number | null,
 *     photoId: string | null,   // always null in PR 2 (Phase 6 wires upload)
 *     notes: string | null
 *   }>
 * }
 *
 * Response (success): {
 *   instance: ChecklistInstance,
 *   submittedCompletionIds: string[],
 *   closingAutoCompleteId: string | null,  // closing(N-1) "Opening verified" auto-complete
 *   editCount: number,                      // 0 on original (PR 2 ships only original-submission path)
 *   originalSubmissionId: string | null     // null on original
 * }
 *
 * Response (error): { error: string, code: string, ...metadata } per
 * lib/api-helpers.ts jsonError shape.
 *
 * Behavior:
 *   - Validates instance exists + actor has location access (defense-in-
 *     depth; RLS would also reject)
 *   - Resolves closing(N-1)'s "Opening verified" item id for cross-reference
 *     auto-completion (NULL when no prior closing — first-ever-at-location
 *     case; RPC handles gracefully)
 *   - Delegates to submitOpening lib (invokes submit_opening_atomic RPC)
 *   - Translates lib's typed errors to HTTP responses via mapOpeningError
 *
 * Authorization (lib-enforced):
 *   - Original-submission path: actor.level >= OPENING_BASE_LEVEL (3, KH+)
 *   - Update path (PR 4+; not exposed in PR 2): canEditReport predicate
 *
 * No PIN attestation in PR 2 — Phase 2 prep entry submission may add PIN
 * attestation in PR 3 if operationally needed.
 *
 * Audit:
 *   - Lib emits opening.submit with metadata.outcome ∈ {success,
 *     role_insufficient, instance_not_open, auto_complete_failed,
 *     rpc_failed}.
 *   - IP + user-agent threaded through from the route.
 */

import { type NextRequest } from "next/server";

import { extractIp, jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { lockLocationContext } from "@/lib/locations";
import {
  OpeningError,
  resolveClosingOpeningVerifiedRefItemId,
  submitOpening,
} from "@/lib/opening";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

import { mapOpeningError } from "../_helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Body shape + validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wire body shape — discriminated union per entry.phase, matching
 * lib/opening.ts OpeningEntry contract (Step 4). Phase 1 entries carry
 * top-level countValue/photoId/notes; Phase 2 entries carry phase2 sub-object.
 */
type WireEntry =
  | {
      templateItemId: string;
      phase: "phase1";
      countValue: number | null;
      photoId: string | null;
      notes: string | null;
    }
  | {
      templateItemId: string;
      phase: "phase2";
      phase2: WirePhase2;
    };

interface WirePhase2 {
  openerActual: number;
  openerPrepped: number;
  overPar: WireOverPar | null;
  underPar: WireUnderPar | null;
  closerEstimateSnapshot: WireCloserSnapshot | null;
}

type OverParReason =
  | "management_directive"
  | "clear_fridge_space"
  | "prevent_expiration"
  | "forecast_busy"
  | "bulk_efficiency"
  | "other";

type UnderParReason =
  | "ingredient_unavailable"
  | "equipment_issue"
  | "time_constraint"
  | "staff_shortage"
  | "other";

interface WireOverPar {
  reasonCategory: OverParReason;
  directedBy: string | null;
  freeText: string | null;
}

interface WireUnderPar {
  reasonCategory: UnderParReason;
  freeText: string;
}

interface WireCloserSnapshot {
  total: number;
  parValue: number | null;
  itemName: string;
  amPrepCompletionId: string;
  amPrepInstanceId: string;
  amPrepCompletedAt: string;
  amPrepEditCount: number;
}

interface SubmitBody {
  instanceId: string;
  entries: WireEntry[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OVER_PAR_REASONS = new Set([
  "management_directive",
  "clear_fridge_space",
  "prevent_expiration",
  "forecast_busy",
  "bulk_efficiency",
  "other",
]);
const UNDER_PAR_REASONS = new Set([
  "ingredient_unavailable",
  "equipment_issue",
  "time_constraint",
  "staff_shortage",
  "other",
]);

function validateBody(
  raw: unknown,
): { ok: true; body: SubmitBody } | { ok: false; field: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, field: "<root>" };
  const r = raw as Record<string, unknown>;

  if (typeof r.instanceId !== "string" || !UUID_RE.test(r.instanceId)) {
    return { ok: false, field: "instanceId" };
  }
  if (!Array.isArray(r.entries)) return { ok: false, field: "entries" };

  const entries: WireEntry[] = [];
  for (let i = 0; i < r.entries.length; i++) {
    const e = r.entries[i];
    if (typeof e !== "object" || e === null) return { ok: false, field: `entries[${i}]` };
    const er = e as Record<string, unknown>;
    if (typeof er.templateItemId !== "string" || !UUID_RE.test(er.templateItemId)) {
      return { ok: false, field: `entries[${i}].templateItemId` };
    }
    const phase = er.phase ?? "phase1";
    if (phase !== "phase1" && phase !== "phase2") {
      return { ok: false, field: `entries[${i}].phase` };
    }

    if (phase === "phase1") {
      let countValue: number | null = null;
      if (er.countValue !== null && er.countValue !== undefined) {
        if (typeof er.countValue !== "number" || !Number.isFinite(er.countValue)) {
          return { ok: false, field: `entries[${i}].countValue` };
        }
        countValue = er.countValue;
      }
      let photoId: string | null = null;
      if (er.photoId !== null && er.photoId !== undefined) {
        if (typeof er.photoId !== "string" || !UUID_RE.test(er.photoId)) {
          return { ok: false, field: `entries[${i}].photoId` };
        }
        photoId = er.photoId;
      }
      let notes: string | null = null;
      if (er.notes !== null && er.notes !== undefined) {
        if (typeof er.notes !== "string") {
          return { ok: false, field: `entries[${i}].notes` };
        }
        const trimmed = er.notes.trim();
        notes = trimmed.length > 0 ? trimmed : null;
      }
      entries.push({
        templateItemId: er.templateItemId,
        phase: "phase1",
        countValue,
        photoId,
        notes,
      });
    } else {
      // phase === 'phase2'
      const p2 = er.phase2;
      if (typeof p2 !== "object" || p2 === null) {
        return { ok: false, field: `entries[${i}].phase2` };
      }
      const p2r = p2 as Record<string, unknown>;
      if (typeof p2r.openerActual !== "number" || !Number.isFinite(p2r.openerActual)) {
        return { ok: false, field: `entries[${i}].phase2.openerActual` };
      }
      if (typeof p2r.openerPrepped !== "number" || !Number.isFinite(p2r.openerPrepped)) {
        return { ok: false, field: `entries[${i}].phase2.openerPrepped` };
      }

      // overPar (nullable; reasonCategory in OVER_PAR_REASONS; directedBy
      // required when management_directive; freeText required when 'other').
      let overPar: WireOverPar | null = null;
      if (p2r.overPar !== null && p2r.overPar !== undefined) {
        if (typeof p2r.overPar !== "object") {
          return { ok: false, field: `entries[${i}].phase2.overPar` };
        }
        const o = p2r.overPar as Record<string, unknown>;
        if (typeof o.reasonCategory !== "string" || !OVER_PAR_REASONS.has(o.reasonCategory)) {
          return { ok: false, field: `entries[${i}].phase2.overPar.reasonCategory` };
        }
        const directedBy =
          o.directedBy === null || o.directedBy === undefined
            ? null
            : typeof o.directedBy === "string" && UUID_RE.test(o.directedBy)
              ? o.directedBy
              : "INVALID";
        if (directedBy === "INVALID") {
          return { ok: false, field: `entries[${i}].phase2.overPar.directedBy` };
        }
        if (o.reasonCategory === "management_directive" && directedBy === null) {
          return { ok: false, field: `entries[${i}].phase2.overPar.directedBy` };
        }
        const freeText =
          o.freeText === null || o.freeText === undefined
            ? null
            : typeof o.freeText === "string"
              ? o.freeText.trim() || null
              : "INVALID";
        if (freeText === "INVALID") {
          return { ok: false, field: `entries[${i}].phase2.overPar.freeText` };
        }
        if (o.reasonCategory === "other" && (freeText === null || freeText.length === 0)) {
          return { ok: false, field: `entries[${i}].phase2.overPar.freeText` };
        }
        overPar = {
          reasonCategory: o.reasonCategory as OverParReason,
          directedBy,
          freeText,
        };
      }

      // underPar (nullable; reasonCategory in UNDER_PAR_REASONS; freeText REQUIRED).
      let underPar: WireUnderPar | null = null;
      if (p2r.underPar !== null && p2r.underPar !== undefined) {
        if (typeof p2r.underPar !== "object") {
          return { ok: false, field: `entries[${i}].phase2.underPar` };
        }
        const u = p2r.underPar as Record<string, unknown>;
        if (typeof u.reasonCategory !== "string" || !UNDER_PAR_REASONS.has(u.reasonCategory)) {
          return { ok: false, field: `entries[${i}].phase2.underPar.reasonCategory` };
        }
        if (typeof u.freeText !== "string" || u.freeText.trim().length === 0) {
          return { ok: false, field: `entries[${i}].phase2.underPar.freeText` };
        }
        underPar = {
          reasonCategory: u.reasonCategory as UnderParReason,
          freeText: u.freeText.trim(),
        };
      }

      // closerEstimateSnapshot (nullable; loose shape validation — RPC trusts).
      let closerEstimateSnapshot: WireCloserSnapshot | null = null;
      if (p2r.closerEstimateSnapshot !== null && p2r.closerEstimateSnapshot !== undefined) {
        if (typeof p2r.closerEstimateSnapshot !== "object") {
          return { ok: false, field: `entries[${i}].phase2.closerEstimateSnapshot` };
        }
        const s = p2r.closerEstimateSnapshot as Record<string, unknown>;
        if (typeof s.total !== "number") {
          return { ok: false, field: `entries[${i}].phase2.closerEstimateSnapshot.total` };
        }
        if (typeof s.amPrepCompletionId !== "string" || !UUID_RE.test(s.amPrepCompletionId)) {
          return {
            ok: false,
            field: `entries[${i}].phase2.closerEstimateSnapshot.amPrepCompletionId`,
          };
        }
        closerEstimateSnapshot = {
          total: s.total,
          parValue:
            typeof s.parValue === "number"
              ? s.parValue
              : s.parValue === null
                ? null
                : null,
          itemName: typeof s.itemName === "string" ? s.itemName : "",
          amPrepCompletionId: s.amPrepCompletionId,
          amPrepInstanceId:
            typeof s.amPrepInstanceId === "string" ? s.amPrepInstanceId : "",
          amPrepCompletedAt:
            typeof s.amPrepCompletedAt === "string" ? s.amPrepCompletedAt : "",
          amPrepEditCount: typeof s.amPrepEditCount === "number" ? s.amPrepEditCount : 0,
        };
      }

      entries.push({
        templateItemId: er.templateItemId,
        phase: "phase2",
        phase2: {
          openerActual: p2r.openerActual,
          openerPrepped: p2r.openerPrepped,
          overPar,
          underPar,
          closerEstimateSnapshot,
        },
      });
    }
  }

  return {
    ok: true,
    body: { instanceId: r.instanceId, entries },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // 1. Auth.
  const ctx = await requireSession(req, "/api/opening/submit");
  if (ctx instanceof Response) return ctx;

  // 2. Parse + validate body.
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;

  const validation = validateBody(parsed);
  if (!validation.ok) {
    return jsonError(400, "invalid_payload", {
      message:
        "Body must include instanceId (uuid) and entries (Array<{templateItemId: uuid, countValue: number|null, photoId: uuid|null, notes: string|null}>).",
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
    console.error(`[/api/opening/submit] instance load failed:`, instErr.message);
    return jsonError(500, "internal_error", { message: "instance load failed" });
  }
  if (!instance) {
    return jsonError(404, "instance_not_found", {
      message: `Instance ${body.instanceId} not found`,
      instance_id: body.instanceId,
    });
  }

  // Defense-in-depth — RLS would also block, but explicit gate gives a
  // clean message.
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

  // Resolve closing(N-1)'s "Opening verified" item id for cross-reference.
  // NULL is fine — RPC handles (no auto-complete, no error).
  let closingReportRefItemId: string | null = null;
  try {
    closingReportRefItemId = await resolveClosingOpeningVerifiedRefItemId(service, {
      locationId: instance.location_id,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[/api/opening/submit] closing-ref resolution failed:`, msg);
    return jsonError(500, "internal_error", { message: "context resolution failed" });
  }

  // 4. Submit. Lib emits the opening.submit audit row internally per outcome.
  try {
    // Build #3 PR 3 Step 6: wire body now carries discriminated union per
    // entry.phase. validateBody already narrowed to WireEntry shape matching
    // OpeningEntry contract; pass through directly.
    const result = await submitOpening(service, {
      instanceId: body.instanceId,
      actor: { userId: ctx.user.id, role: ctx.role, level: ctx.level },
      entries: body.entries,
      closingReportRefItemId,
      ipAddress: extractIp(req),
      userAgent: req.headers.get("user-agent"),
    });
    return jsonOk({
      instance: result.instance,
      submittedCompletionIds: result.submittedCompletionIds,
      closingAutoCompleteId: result.closingAutoCompleteId,
      editCount: result.editCount,
      originalSubmissionId: result.originalSubmissionId,
      underParNotificationIds: result.underParNotificationIds,
    });
  } catch (err) {
    if (err instanceof OpeningError) return mapOpeningError(err);
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[/api/opening/submit] unexpected error:`, msg);
    return jsonError(500, "internal_error", { message: "submit failed" });
  }
}
