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
import type { OpeningSpotCheckStatus } from "@/lib/types";

import { mapOpeningError } from "../_helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Body shape + validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wire body shape — discriminated union per entry.phase, matching the C.53
 * type-contract-locked OpeningEntry union in lib/types.ts.
 *
 * Phase 1 entries carry top-level countValue/photoId/notes PLUS the C.53
 * spot-check fields (spotCheckStatus / openerRecount / groundTruthCount /
 * prepNeed). The spot-check fields are nullable + defaulted by the
 * validator when absent (legacy form omits them; they'll be populated by
 * the new Phase 1 UI when it lands).
 *
 * Phase 2 entries use the new FLAT shape per C.53 (no `phase2:` wrapper,
 * no openerRecount field — recount moved to Phase 1). lib/opening.ts's
 * dispatcher adapts the flat shape back to the nested `phase2:` wrapper
 * for the unchanged submit_opening_atomic RPC.
 *
 * Phase 3 wire validation is not yet exposed — the dispatcher throws
 * `phase3_rpc_not_implemented` so there is no caller-visible Phase 3 path.
 * The wire type is reserved here without a corresponding validator branch.
 */
type WireEntry =
  | {
      templateItemId: string;
      phase: "phase1";
      countValue: number | null;
      photoId: string | null;
      notes: string | null;
      // C.53 spot-check fields — accepted but not yet populated by legacy
      // form; the Phase 1 UI restructure will populate them.
      spotCheckStatus: OpeningSpotCheckStatus | null;
      openerRecount: number | null;
      groundTruthCount: number | null;
      prepNeed: number | null;
    }
  | {
      templateItemId: string;
      phase: "phase2";
      // C.53 flat shape: top-level fields, no `phase2:` wrapper.
      openerPrepped: number;
      deltaVsPrepNeed: number | null;
      overPar: WireOverPar | null;
      underPar: WireUnderPar | null;
    };

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

// WireCloserSnapshot interface dropped in Phase 4 cleanup — orphan after C.50
// removed closerEstimateSnapshot from the request payload (server reads from
// persisted opening_closer_count_snapshots table).

/**
 * Section verification entry per C.50 §2 — top-level field on the request
 * body alongside `entries`. Server inserts one row to
 * opening_section_verifications per `verified=true` entry; absence of a
 * section in the array IS the unverified state.
 */
interface WireSectionVerification {
  sectionKey: string;
  verified: boolean;
}

interface SubmitBody {
  instanceId: string;
  entries: WireEntry[];
  sectionVerifications: WireSectionVerification[];
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

      // C.53 spot-check fields — optional in wire payload (legacy form omits).
      // The Phase 1 UI restructure will populate them; validator defaults to
      // null when absent so legacy submissions keep working.
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
        if (
          typeof er.openerRecount !== "number" ||
          !Number.isFinite(er.openerRecount)
        ) {
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
    } else {
      // phase === 'phase2' — C.53 flat shape. openerPrepped + deltaVsPrepNeed
      // + overPar/underPar live at the top level of the entry (no `phase2:`
      // wrapper). lib/opening.ts dispatcher adapts back to nested shape for
      // the unchanged submit_opening_atomic RPC.
      if (typeof er.openerPrepped !== "number" || !Number.isFinite(er.openerPrepped)) {
        return { ok: false, field: `entries[${i}].openerPrepped` };
      }
      const openerPrepped = er.openerPrepped;

      let deltaVsPrepNeed: number | null = null;
      if (er.deltaVsPrepNeed !== null && er.deltaVsPrepNeed !== undefined) {
        if (
          typeof er.deltaVsPrepNeed !== "number" ||
          !Number.isFinite(er.deltaVsPrepNeed)
        ) {
          return { ok: false, field: `entries[${i}].deltaVsPrepNeed` };
        }
        deltaVsPrepNeed = er.deltaVsPrepNeed;
      }

      // overPar (nullable; reasonCategory in OVER_PAR_REASONS; directedBy
      // required when management_directive; freeText required when 'other').
      let overPar: WireOverPar | null = null;
      if (er.overPar !== null && er.overPar !== undefined) {
        if (typeof er.overPar !== "object") {
          return { ok: false, field: `entries[${i}].overPar` };
        }
        const o = er.overPar as Record<string, unknown>;
        if (typeof o.reasonCategory !== "string" || !OVER_PAR_REASONS.has(o.reasonCategory)) {
          return { ok: false, field: `entries[${i}].overPar.reasonCategory` };
        }
        const directedBy =
          o.directedBy === null || o.directedBy === undefined
            ? null
            : typeof o.directedBy === "string" && UUID_RE.test(o.directedBy)
              ? o.directedBy
              : "INVALID";
        if (directedBy === "INVALID") {
          return { ok: false, field: `entries[${i}].overPar.directedBy` };
        }
        if (o.reasonCategory === "management_directive" && directedBy === null) {
          return { ok: false, field: `entries[${i}].overPar.directedBy` };
        }
        const freeText =
          o.freeText === null || o.freeText === undefined
            ? null
            : typeof o.freeText === "string"
              ? o.freeText.trim() || null
              : "INVALID";
        if (freeText === "INVALID") {
          return { ok: false, field: `entries[${i}].overPar.freeText` };
        }
        if (o.reasonCategory === "other" && (freeText === null || freeText.length === 0)) {
          return { ok: false, field: `entries[${i}].overPar.freeText` };
        }
        overPar = {
          reasonCategory: o.reasonCategory as OverParReason,
          directedBy,
          freeText,
        };
      }

      // underPar (nullable; reasonCategory in UNDER_PAR_REASONS; freeText REQUIRED).
      let underPar: WireUnderPar | null = null;
      if (er.underPar !== null && er.underPar !== undefined) {
        if (typeof er.underPar !== "object") {
          return { ok: false, field: `entries[${i}].underPar` };
        }
        const u = er.underPar as Record<string, unknown>;
        if (typeof u.reasonCategory !== "string" || !UNDER_PAR_REASONS.has(u.reasonCategory)) {
          return { ok: false, field: `entries[${i}].underPar.reasonCategory` };
        }
        if (typeof u.freeText !== "string" || u.freeText.trim().length === 0) {
          return { ok: false, field: `entries[${i}].underPar.freeText` };
        }
        underPar = {
          reasonCategory: u.reasonCategory as UnderParReason,
          freeText: u.freeText.trim(),
        };
      }

      entries.push({
        templateItemId: er.templateItemId,
        phase: "phase2",
        openerPrepped,
        deltaVsPrepNeed,
        overPar,
        underPar,
      });
    }
  }

  // C.50 §2 — sectionVerifications top-level field. Optional during transition
  // (Phase 3 form sends it; Phase 5 RPC consumes it). Empty array = no
  // sections verified (legitimate state for forms with all-individual-recount).
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

  return {
    ok: true,
    body: { instanceId: r.instanceId, entries, sectionVerifications },
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

  // Piece 4 defensive branch (B2 brief 2026-05-26) — fast-path the
  // `phase1_complete` instance state with a graceful "Phase 2 submission
  // pending next update" response.
  //
  // Why: After Phase 1 wiring goes live (/api/opening/submit/phase1 +
  // migration 0055), an instance can sit in `phase1_complete` while Phase 2
  // wiring (per-phase RPC + per-phase route) is still pending. If the form
  // POSTs Phase 2 entries to this legacy route during that interval, the
  // legacy `submit_opening_atomic` RPC filters `WHERE status='open'` and
  // returns 0 rows updated → check_violation → OpeningInstanceNotOpenError →
  // 409 (bare error). That's the operator's first-touch failure mode and is
  // unhelpful — Phase 1 IS saved, nothing was lost.
  //
  // Per Triad A 2026-05-26 (ack #2): return 200 with `code:
  // 'phase2_pending_next_release'` discriminator. Phase 1 succeeded; the
  // opener did nothing wrong; Phase 2 is simply pending. The form reads the
  // discriminator and renders the graceful message via the i18n keys
  // `opening.phase2.pending_next_release.title` / `.body` (shipped Aggie
  // d9e633f). SQL filter remains as defense-in-depth.
  //
  // Scope: only `phase1_complete` is graceful here. Other non-open statuses
  // (confirmed, incomplete_confirmed, auto_finalized, phase2_complete) fall
  // through to the legacy RPC's existing OpeningInstanceNotOpenError path —
  // those represent operator confusion or terminal state, not the
  // operational interim case Piece 4 is designed for.
  if (instance.status === "phase1_complete") {
    return jsonOk({
      code: "phase2_pending_next_release",
      titleKey: "opening.phase2.pending_next_release.title",
      bodyKey: "opening.phase2.pending_next_release.body",
      instance,
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
      sectionVerifications: body.sectionVerifications,
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
