/**
 * POST /api/opening/prep/item — Phase-2-aware per-item §8.4 SAVE per C.53 §3 +
 * SPLIT (Question A) + migration 0056.
 *
 * This is the §8.4 WRITE path (NOT the legacy /api/checklist/completions route,
 * NOT the finalize RPC). Writes ONE prep item's phase2 completion in the §8.4
 * 14-field shape via savePhase2Item → save_phase2_item_atomic (append-only:
 * supersede-then-INSERT, D1). Returns the written completion + server-computed
 * delta/status for optimistic local state update. Revert is NOT here — it has its
 * own thin path POST /api/opening/prep/item/revoke → revokePhase2Completion
 * (Lane D; sets revoked_at only, no §8.4 write; closing's revoke routes untouched).
 *
 * Body: {
 *   instanceId: string,
 *   entry: {
 *     templateItemId: string,
 *     openerPrepped: number,                 // required, finite
 *     overPar: { reasonCategory, directedBy: string|null, freeText: string|null } | null,
 *     underPar: { reasonCategory, freeText: string } | null
 *   }
 * }
 *
 * Response (success): { completion, templateItemId, completionId, deltaVsPrepNeed, overUnderStatus }
 *
 * Response (error) via mapOpeningError:
 *   - 400 invalid_payload / invalid_entry_shape — body or entry shape invalid
 *   - 403 role_level_insufficient / location_access_denied
 *   - 404 instance_not_found
 *   - 409 phase2_not_eligible            — instance status ≠ 'phase1_complete'
 *   - 422 ground_truth_unresolved        — item has no live prep_data->phase1 (phase1_not_resolved)
 *   - 500 internal_error
 *
 * Audit (lib emits internally): opening.phase2.item_saved.
 */

import { type NextRequest } from "next/server";

import { extractIp, jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { lockLocationContext } from "@/lib/locations";
import { OpeningError, savePhase2Item } from "@/lib/opening";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { OpeningEntryPhase2 } from "@/lib/types";

import { mapOpeningError } from "../../_helpers";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OVER_REASONS: ReadonlySet<string> = new Set([
  "management_directive",
  "clear_fridge_space",
  "prevent_expiration",
  "forecast_busy",
  "bulk_efficiency",
  "other",
]);
const UNDER_REASONS: ReadonlySet<string> = new Set([
  "ingredient_unavailable",
  "equipment_issue",
  "time_constraint",
  "staff_shortage",
  "other",
]);

interface ValidBody {
  instanceId: string;
  entry: OpeningEntryPhase2;
}

function validateBody(
  raw: unknown,
): { ok: true; body: ValidBody } | { ok: false; field: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, field: "<root>" };
  const r = raw as Record<string, unknown>;

  if (typeof r.instanceId !== "string" || !UUID_RE.test(r.instanceId)) {
    return { ok: false, field: "instanceId" };
  }
  if (typeof r.entry !== "object" || r.entry === null) return { ok: false, field: "entry" };
  const e = r.entry as Record<string, unknown>;

  if (typeof e.templateItemId !== "string" || !UUID_RE.test(e.templateItemId)) {
    return { ok: false, field: "entry.templateItemId" };
  }
  // openerPrepped — required, finite (universal even on par-null items per §7).
  if (typeof e.openerPrepped !== "number" || !Number.isFinite(e.openerPrepped)) {
    return { ok: false, field: "entry.openerPrepped" };
  }

  // overPar — nullable; when present: reasonCategory in set; directedBy required
  // for management_directive; freeText required for 'other'.
  let overPar: OpeningEntryPhase2["overPar"] = null;
  if (e.overPar !== null && e.overPar !== undefined) {
    if (typeof e.overPar !== "object") return { ok: false, field: "entry.overPar" };
    const op = e.overPar as Record<string, unknown>;
    if (typeof op.reasonCategory !== "string" || !OVER_REASONS.has(op.reasonCategory)) {
      return { ok: false, field: "entry.overPar.reasonCategory" };
    }
    const directedBy =
      op.directedBy === null || op.directedBy === undefined ? null : op.directedBy;
    if (directedBy !== null && (typeof directedBy !== "string" || !UUID_RE.test(directedBy))) {
      return { ok: false, field: "entry.overPar.directedBy" };
    }
    if (op.reasonCategory === "management_directive" && directedBy === null) {
      return { ok: false, field: "entry.overPar.directedBy" };
    }
    const freeText =
      op.freeText === null || op.freeText === undefined ? null : op.freeText;
    if (freeText !== null && typeof freeText !== "string") {
      return { ok: false, field: "entry.overPar.freeText" };
    }
    if (op.reasonCategory === "other" && (freeText === null || freeText.trim() === "")) {
      return { ok: false, field: "entry.overPar.freeText" };
    }
    overPar = {
      reasonCategory: op.reasonCategory as NonNullable<OpeningEntryPhase2["overPar"]>["reasonCategory"],
      directedBy: directedBy as string | null,
      freeText: (freeText as string | null) ?? null,
    };
  }

  // underPar — nullable; when present: reasonCategory in set; freeText REQUIRED (§7).
  let underPar: OpeningEntryPhase2["underPar"] = null;
  if (e.underPar !== null && e.underPar !== undefined) {
    if (typeof e.underPar !== "object") return { ok: false, field: "entry.underPar" };
    const up = e.underPar as Record<string, unknown>;
    if (typeof up.reasonCategory !== "string" || !UNDER_REASONS.has(up.reasonCategory)) {
      return { ok: false, field: "entry.underPar.reasonCategory" };
    }
    if (typeof up.freeText !== "string" || up.freeText.trim() === "") {
      return { ok: false, field: "entry.underPar.freeText" };
    }
    underPar = {
      reasonCategory: up.reasonCategory as NonNullable<OpeningEntryPhase2["underPar"]>["reasonCategory"],
      freeText: up.freeText,
    };
  }

  // Both present is contradictory (can't be over AND under). Reject.
  if (overPar !== null && underPar !== null) {
    return { ok: false, field: "entry.overPar|underPar" };
  }

  return {
    ok: true,
    body: {
      instanceId: r.instanceId,
      entry: {
        templateItemId: e.templateItemId,
        phase: "phase2",
        openerPrepped: e.openerPrepped,
        deltaVsPrepNeed: null, // client hint unused — server recomputes authoritatively
        overPar,
        underPar,
      },
    },
  };
}

export async function POST(req: NextRequest) {
  // 1. Auth.
  const ctx = await requireSession(req, "/api/opening/prep/item");
  if (ctx instanceof Response) return ctx;

  // 2. Parse + validate body.
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const validation = validateBody(parsed);
  if (!validation.ok) {
    return jsonError(400, "invalid_payload", {
      message:
        "Body must include instanceId (uuid) and entry { templateItemId, openerPrepped, overPar?, underPar? } per the Phase 2 §8.4 shape.",
      field: validation.field,
    });
  }
  const { instanceId, entry } = validation.body;

  // 3. Instance load + location access check (defense-in-depth).
  const service = getServiceRoleClient();
  const { data: instance, error: instErr } = await service
    .from("checklist_instances")
    .select("id, location_id, status")
    .eq("id", instanceId)
    .maybeSingle<{ id: string; location_id: string; status: string }>();
  if (instErr) {
    console.error(`[/api/opening/prep/item] instance load failed:`, instErr.message);
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

  // 4. Save. Lib emits opening.phase2.item_saved audit internally.
  try {
    const result = await savePhase2Item(service, {
      instanceId,
      actor: { userId: ctx.user.id, role: ctx.role, level: ctx.level },
      entry,
      ipAddress: extractIp(req),
      userAgent: req.headers.get("user-agent"),
    });
    return jsonOk({
      completion: result.completion,
      templateItemId: result.templateItemId,
      completionId: result.completionId,
      deltaVsPrepNeed: result.deltaVsPrepNeed,
      overUnderStatus: result.overUnderStatus,
    });
  } catch (err) {
    if (err instanceof OpeningError) return mapOpeningError(err);
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[/api/opening/prep/item] unexpected error:`, msg);
    return jsonError(500, "internal_error", { message: "save failed" });
  }
}
