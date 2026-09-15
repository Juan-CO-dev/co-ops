/**
 * POST /api/opening/phase1/draft — autosave the UNSUBMITTED Phase 1 opening form.
 *
 * LRA-121 / STAFF-5. Phase 1 verification work lived only in the browser's React state
 * until a key holder tapped submit. An employee is level 3 and cannot submit
 * (`OPENING_BASE_LEVEL` = 4), so the shift's real sequence — employee walks the shop, key
 * holder opens the same instance on their OWN device and submits — lost every keystroke.
 * This route is the write half of the fix; the page loader is the read half.
 *
 * Body: { instanceId: string (uuid), draft: OpeningPhase1Draft }
 *   `draft` = { version, items, sections, openerNoPriorDataAttestation }, validated by
 *   `parseOpeningPhase1Draft` (lib/opening-draft-shared.ts) — the SAME pure validator the
 *   loader runs on read-back, so what a client can save and what the page can hydrate can
 *   never drift apart. The attestation's vocabulary is checked against the same two
 *   reasons POST /api/opening/submit/phase1 accepts; an unknown one fails the whole draft
 *   (400 invalid_payload) rather than being coerced to null.
 *
 * Response (success): { savedAt: string }  — the SERVER's timestamp, so the status line
 *   in the footer never shows a wrong time from a skewed device clock.
 *
 * Response (error): lib/api-helpers.ts jsonError shape.
 *   400 invalid_json               — body is not JSON
 *   400 invalid_payload            — instanceId not a uuid, or draft failed the parser
 *   401 (requireSession)           — no live session
 *   403 role_level_insufficient    — actor below OPENING_DRAFT_MIN_LEVEL
 *   403 location_access_denied     — actor lacks access to the instance's location
 *   404 instance_not_found         — no such instance
 *   409 phase1_not_open            — instance.status !== 'open'
 *   500 internal_error             — unexpected
 *
 * ── THE ROLE FLOOR IS THE PAGE'S, NOT THE SUBMIT'S ───────────────────────────────────
 * `OPENING_DRAFT_MIN_LEVEL` is 3. The opening PAGE carries no level gate beyond a live
 * session and every opening template item is `min_role_level = 3`; the level-3 employee
 * is precisely the actor whose lost work this route exists to save. Flooring here at
 * `OPENING_BASE_LEVEL` (4, the submit floor) would rebuild LRA-121 inside its own fix.
 * Location access is bound with `lockLocationContext` against the instance's own
 * location, exactly as POST /api/opening/submit/phase1 does it.
 *
 * ── STATUS GATE ──────────────────────────────────────────────────────────────────────
 * 'open' is the sole pre-Phase-1 status (migration 0054). Past it, `submit_phase1_atomic`
 * has written the real `checklist_completions` + `opening_section_verifications` rows,
 * which are the truth; accepting a draft then would let a stale browser tab write scratch
 * over a submitted morning's working state. 409 `phase1_not_open` — a state conflict the
 * client should not blind-retry.
 *
 * ── NO AUDIT ROW, DELIBERATELY ───────────────────────────────────────────────────────
 * This fires every ~800ms of typing. The audit log is the accountability record of human
 * acts on shared operational config — it is NOT a keystroke log, and one row per debounce
 * tick would bury every real row in it. The accountability row for Phase 1 is the one
 * `submit_phase1_atomic` already emits (`opening.phase1_submit`); a draft is unsubmitted
 * scratch that never becomes history. No new audit ACTION is introduced by this arc.
 *
 * ── NO RATE LIMIT ────────────────────────────────────────────────────────────────────
 * `checkAndRecord` (lib/portal/rate-limit.ts) is used by the PORTAL and AUTH surfaces —
 * unauthenticated or enumeration-exposed paths. No staff operational route throttles,
 * including this route's nearest sibling POST /api/opening/prep/item, which is also a
 * blur-driven per-item write. Adding a limiter here alone would be a new convention on
 * the one surface a 6 AM opener depends on. The bounded cost is instead structural: the
 * validator caps items, sections, key length and text length, and the PK means a burst
 * rewrites one row rather than growing the table.
 *
 * ── sendBeacon COMPATIBILITY ─────────────────────────────────────────────────────────
 * The client flushes the last edit on `visibilitychange`→hidden and `pagehide` via
 * `navigator.sendBeacon`, which sends `text/plain` (a Blob's type, or the string
 * default) and cannot set headers. This route therefore must NOT gate on Content-Type —
 * and does not: `parseJsonBody` calls `req.json()`, which parses the body text without
 * consulting the header, so an `application/json` fetch and a `text/plain` beacon land on
 * the identical path. Do not "tighten" this with a Content-Type check; it would silently
 * break navigating-away persistence, which is half the defect.
 */

import { type NextRequest } from "next/server";

import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { lockLocationContext } from "@/lib/locations";
import { OPENING_DRAFT_MIN_LEVEL, parseOpeningPhase1Draft } from "@/lib/opening-draft-shared";
import { saveOpeningPhase1Draft } from "@/lib/opening";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  // 1. Auth.
  const ctx = await requireSession(req, "/api/opening/phase1/draft");
  if (ctx instanceof Response) return ctx;

  if (ctx.level < OPENING_DRAFT_MIN_LEVEL) {
    return jsonError(403, "role_level_insufficient", {
      message: "Your role cannot record opening work.",
      required: OPENING_DRAFT_MIN_LEVEL,
      actor_level: ctx.level,
    });
  }

  // 2. Parse + validate body. The draft validator is the pure one the loader also runs.
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  if (typeof parsed !== "object" || parsed === null) {
    return jsonError(400, "invalid_payload", {
      message: "Body must be an object with instanceId (uuid) and draft.",
      field: "<root>",
    });
  }
  const raw = parsed as Record<string, unknown>;
  if (typeof raw.instanceId !== "string" || !UUID_RE.test(raw.instanceId)) {
    return jsonError(400, "invalid_payload", {
      message: "Body must include instanceId (uuid).",
      field: "instanceId",
    });
  }
  const draft = parseOpeningPhase1Draft(raw.draft);
  if (!draft) {
    return jsonError(400, "invalid_payload", {
      message: "draft failed validation (version, items, sections).",
      field: "draft",
    });
  }
  const instanceId = raw.instanceId;

  // 3. Server-side context — instance load + location bind, the same shape
  // POST /api/opening/submit/phase1 uses.
  const service = getServiceRoleClient();

  const { data: instance, error: instErr } = await service
    .from("checklist_instances")
    .select("id, location_id, status")
    .eq("id", instanceId)
    .maybeSingle<{ id: string; location_id: string; status: string }>();
  if (instErr) {
    console.error("[/api/opening/phase1/draft] instance load failed:", instErr.message);
    return jsonError(500, "internal_error", { message: "instance load failed" });
  }
  if (!instance) {
    return jsonError(404, "instance_not_found", {
      message: `Instance ${instanceId} not found`,
      instance_id: instanceId,
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

  if (instance.status !== "open") {
    return jsonError(409, "phase1_not_open", {
      message: "Phase 1 has already been submitted for this opening.",
      instance_id: instanceId,
      status: instance.status,
    });
  }

  // 4. Upsert. Last write wins (see saveOpeningPhase1Draft).
  try {
    const { savedAt } = await saveOpeningPhase1Draft(service, {
      instanceId,
      locationId: instance.location_id,
      draft,
      savedBy: ctx.user.id,
    });
    return jsonOk({ savedAt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/opening/phase1/draft] draft save failed:", msg);
    return jsonError(500, "internal_error", { message: "draft save failed" });
  }
}
