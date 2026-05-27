/**
 * POST /api/opening/submit/phase1 — Opening Phase 1 atomic submission per
 * C.53 §3 + C.54 §2.A/§2.B/§2.C + migration 0055.
 *
 * Body: {
 *   instanceId: string,
 *   entries: Array<{
 *     templateItemId: string,
 *     phase: 'phase1',
 *     countValue: number | null,
 *     photoId: string | null,            // always null in this commit (Phase 6 wires upload)
 *     notes: string | null,
 *     // C.53 spot-check fields (NULL on non-spot-check items):
 *     spotCheckStatus: 'matched_via_section_verify' | 'flagged_recount' | null,
 *     openerRecount: number | null,
 *     groundTruthCount: number | null,   // accepted; server re-derives + persists
 *     prepNeed: number | null,           // accepted; server re-derives + persists
 *   }>,
 *   sectionVerifications: Array<{ sectionKey: string, verified: boolean }>,
 *   openerNoPriorDataAttestation: 'planned_closure' | 'missed_or_unknown' | null
 * }
 *
 * Response (success): {
 *   instance: ChecklistInstance,
 *   submittedCompletionIds: string[],
 *   closingAutoCompleteId: null,         // Phase 1 owns no auto-complete (Phase 3 does)
 *   editCount: 0,                         // 0 on original-submission; chain-edit UI lands later
 *   originalSubmissionId: null,           // null on original
 *   underParNotificationIds: []           // Phase 2 concept; always [] for Phase 1
 * }
 *
 * Response (error): { error: string, code: string, ...metadata } per
 * lib/api-helpers.ts jsonError shape, with these typed codes via mapOpeningError:
 *   - 400 invalid_payload              — body shape validation failed
 *   - 400 invalid_entry_shape          — server-side entry shape check failed
 *   - 403 role_level_insufficient      — actor below OPENING_BASE_LEVEL (KH+)
 *   - 403 location_access_denied       — actor lacks user_locations row for instance.location_id
 *   - 404 instance_not_found           — instance load returned no row
 *   - 409 instance_not_open            — RPC raised 23503 (instance OR actor not found)
 *   - 409 phase1_not_eligible          — race-loss: another submitter transitioned status past 'open'
 *   - 422 null_source_requires_recount — NULL closer + section-verified without recount (Aggie A2)
 *   - 422 provenance_required          — reconstructed_morning entries without attestation (C.54 §2.C)
 *   - 422 ground_truth_unresolved      — no section-verify AND no recount on spot-check item
 *   - 500 internal_error               — unexpected
 *
 * Behavior:
 *   - Auth via requireSession + KH+ level gate (lib-enforced)
 *   - Validates instance exists + actor has location access (defense-in-depth)
 *   - Dispatches homogeneous-Phase-1 payload to submitPhase1Atomic (migration 0055)
 *   - RPC handles atomicity: per-item completions + section verifications +
 *     attestation + notification + instance status transition (open → phase1_complete)
 *     in one transaction
 *   - NO closing(N-1) auto-complete (Phase 3 owns; this route does NOT
 *     resolve the cross-reference item id)
 *
 * Audit (lib emits internally):
 *   - opening.phase1_submit with outcomes ∈ {success, role_insufficient,
 *     null_source_requires_recount, provenance_required, ground_truth_unresolved,
 *     phase1_not_eligible, instance_or_actor_not_found, rpc_failed}
 *   - IP + user-agent threaded through from the route
 *
 * Coupled commit per B2 brief 2026-05-26 (Triad A code gate):
 *   - This route + lib/opening.ts submitPhase1Atomic body wiring ship together
 *   - The form-side flip (handleSubmit → handlePhase1Submit) + Piece 4 (legacy
 *     route defensive branch) land as the joint integration commit, gated on
 *     Aggie's Pieces 1+2 (UI scaffolding) being in.
 */

import { type NextRequest } from "next/server";

import { extractIp, jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { lockLocationContext } from "@/lib/locations";
import { OpeningError, submitPhase1Atomic } from "@/lib/opening";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { OpeningNoPriorDataReason, OpeningSpotCheckStatus } from "@/lib/types";

import { mapOpeningError } from "../../_helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Body shape + validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wire body shape — Phase 1 entries only (no discriminated union; the per-phase
 * route enforces homogeneous payload per C.53 restructure). Phase 1 entries
 * carry top-level countValue/photoId/notes PLUS the C.53 spot-check fields
 * (spotCheckStatus / openerRecount / groundTruthCount / prepNeed). The
 * spot-check fields are nullable and accepted as wire values; the RPC
 * (migration 0055) re-derives ground_truth + prep_need server-side and the
 * client-supplied groundTruthCount + prepNeed are UX hints only.
 *
 * Per Triad A 2026-05-26: spotCheckStatus is a non-null/null discriminator
 * (signals "is this a spot-check item") — specific value is accepted but the
 * RPC re-derives the persisted spot_check_status from openerRecount. Validator
 * accepts any of (matched_via_section_verify | flagged_recount | null) and
 * does NOT reject on the specific value.
 */
interface WireEntry {
  templateItemId: string;
  phase: "phase1";
  countValue: number | null;
  photoId: string | null;
  notes: string | null;
  spotCheckStatus: OpeningSpotCheckStatus | null;
  openerRecount: number | null;
  groundTruthCount: number | null;
  prepNeed: number | null;
}

interface WireSectionVerification {
  sectionKey: string;
  verified: boolean;
}

interface SubmitBody {
  instanceId: string;
  entries: WireEntry[];
  sectionVerifications: WireSectionVerification[];
  openerNoPriorDataAttestation: OpeningNoPriorDataReason | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ATTESTATION_REASONS: ReadonlySet<OpeningNoPriorDataReason> = new Set([
  "planned_closure",
  "missed_or_unknown",
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
    // Phase guard — explicit 'phase1' (default for back-compat; strict-rejection
    // here keeps the route locked to its operational phase).
    const phase = er.phase ?? "phase1";
    if (phase !== "phase1") {
      return { ok: false, field: `entries[${i}].phase` };
    }

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

    // C.53 spot-check fields — accept null or the enum values. Per Triad A
    // 2026-05-26 ack #3, validator accepts any of (matched_via_section_verify |
    // flagged_recount | null) and does NOT reject on the specific value — the
    // RPC re-derives the persisted spot_check_status server-side.
    let spotCheckStatus: OpeningSpotCheckStatus | null = null;
    if (er.spotCheckStatus !== null && er.spotCheckStatus !== undefined) {
      if (
        er.spotCheckStatus !== "matched_via_section_verify" &&
        er.spotCheckStatus !== "flagged_recount"
      ) {
        return { ok: false, field: `entries[${i}].spotCheckStatus` };
      }
      spotCheckStatus = er.spotCheckStatus;
    }
    let openerRecount: number | null = null;
    if (er.openerRecount !== null && er.openerRecount !== undefined) {
      if (typeof er.openerRecount !== "number" || !Number.isFinite(er.openerRecount)) {
        return { ok: false, field: `entries[${i}].openerRecount` };
      }
      openerRecount = er.openerRecount;
    }
    let groundTruthCount: number | null = null;
    if (er.groundTruthCount !== null && er.groundTruthCount !== undefined) {
      if (
        typeof er.groundTruthCount !== "number" ||
        !Number.isFinite(er.groundTruthCount)
      ) {
        return { ok: false, field: `entries[${i}].groundTruthCount` };
      }
      groundTruthCount = er.groundTruthCount;
    }
    let prepNeed: number | null = null;
    if (er.prepNeed !== null && er.prepNeed !== undefined) {
      if (typeof er.prepNeed !== "number" || !Number.isFinite(er.prepNeed)) {
        return { ok: false, field: `entries[${i}].prepNeed` };
      }
      prepNeed = er.prepNeed;
    }

    entries.push({
      templateItemId: er.templateItemId,
      phase: "phase1",
      countValue,
      photoId,
      notes,
      spotCheckStatus,
      openerRecount,
      groundTruthCount,
      prepNeed,
    });
  }

  // Section verifications — top-level field. Optional; empty array = no
  // sections verified (legitimate when all items individually recounted).
  const sectionVerifications: WireSectionVerification[] = [];
  if (r.sectionVerifications !== undefined && r.sectionVerifications !== null) {
    if (!Array.isArray(r.sectionVerifications)) {
      return { ok: false, field: "sectionVerifications" };
    }
    for (let i = 0; i < r.sectionVerifications.length; i++) {
      const sv = r.sectionVerifications[i];
      if (typeof sv !== "object" || sv === null) {
        return { ok: false, field: `sectionVerifications[${i}]` };
      }
      const svr = sv as Record<string, unknown>;
      if (typeof svr.sectionKey !== "string" || svr.sectionKey.trim().length === 0) {
        return { ok: false, field: `sectionVerifications[${i}].sectionKey` };
      }
      if (typeof svr.verified !== "boolean") {
        return { ok: false, field: `sectionVerifications[${i}].verified` };
      }
      sectionVerifications.push({
        sectionKey: svr.sectionKey,
        verified: svr.verified,
      });
    }
  }

  // C.54 §2.C attestation — top-level field. Null when no reconstructed_morning
  // entries are present; one of ('planned_closure' | 'missed_or_unknown') when
  // at least one entry resolves via NULL-source. The RPC enforces presence
  // (raises P0001 'provenance_required' when missing); validator just ensures
  // shape correctness.
  let openerNoPriorDataAttestation: OpeningNoPriorDataReason | null = null;
  if (
    r.openerNoPriorDataAttestation !== null &&
    r.openerNoPriorDataAttestation !== undefined
  ) {
    if (
      typeof r.openerNoPriorDataAttestation !== "string" ||
      !ATTESTATION_REASONS.has(
        r.openerNoPriorDataAttestation as OpeningNoPriorDataReason,
      )
    ) {
      return { ok: false, field: "openerNoPriorDataAttestation" };
    }
    openerNoPriorDataAttestation =
      r.openerNoPriorDataAttestation as OpeningNoPriorDataReason;
  }

  return {
    ok: true,
    body: {
      instanceId: r.instanceId,
      entries,
      sectionVerifications,
      openerNoPriorDataAttestation,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // 1. Auth.
  const ctx = await requireSession(req, "/api/opening/submit/phase1");
  if (ctx instanceof Response) return ctx;

  // 2. Parse + validate body.
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;

  const validation = validateBody(parsed);
  if (!validation.ok) {
    return jsonError(400, "invalid_payload", {
      message:
        "Body must include instanceId (uuid), entries (Phase 1 only — homogeneous array), sectionVerifications, and openerNoPriorDataAttestation (planned_closure | missed_or_unknown | null).",
      field: validation.field,
    });
  }
  const body = validation.body;

  // 3. Server-side context resolution — instance load + location access check
  // (defense-in-depth; RLS would also block, but explicit gates give cleaner
  // messages than 500-on-RLS-denial).
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
    console.error(`[/api/opening/submit/phase1] instance load failed:`, instErr.message);
    return jsonError(500, "internal_error", { message: "instance load failed" });
  }
  if (!instance) {
    return jsonError(404, "instance_not_found", {
      message: `Instance ${body.instanceId} not found`,
      instance_id: body.instanceId,
    });
  }

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

  // Note: NO closingReportRefItemId resolution. Per Triad A 2026-05-26
  // (C.54 §2.A), opening→closing auto-complete lives at Phase 3 submit, not
  // Phase 1. This route does not look up the closing(N-1) ref item.

  // 4. Submit. Lib emits the opening.phase1_submit audit row internally per outcome.
  try {
    const result = await submitPhase1Atomic(service, {
      instanceId: body.instanceId,
      actor: { userId: ctx.user.id, role: ctx.role, level: ctx.level },
      entries: body.entries,
      sectionVerifications: body.sectionVerifications,
      openerNoPriorDataAttestation: body.openerNoPriorDataAttestation,
      ipAddress: extractIp(req),
      userAgent: req.headers.get("user-agent"),
    });
    return jsonOk({
      instance: result.instance,
      submittedCompletionIds: result.submittedCompletionIds,
      closingAutoCompleteId: result.closingAutoCompleteId, // always null
      editCount: result.editCount,
      originalSubmissionId: result.originalSubmissionId,
      underParNotificationIds: result.underParNotificationIds, // always []
    });
  } catch (err) {
    if (err instanceof OpeningError) return mapOpeningError(err);
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[/api/opening/submit/phase1] unexpected error:`, msg);
    return jsonError(500, "internal_error", { message: "submit failed" });
  }
}
