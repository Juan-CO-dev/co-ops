/**
 * POST /api/prep/draft — autosave the UNSUBMITTED AM prep form (migration 0214).
 *
 * Juan's floor note (2026-10-06): the AM prep count reset whenever someone left the page or
 * the 10-minute idle timer fired, and the crew recounted everything. This route is the
 * write half of the fix; the page loader (`loadAmPrepDraft`) is the read half. Pattern:
 * POST /api/opening/phase1/draft (0203).
 *
 * Body: { instanceId: string (uuid), draft: { version: 1, items: { <templateItemId>: row } } }
 *   `draft.items` is a PATCH — only the lines that changed since this client's last
 *   successful save; an empty row `{}` means the line is blank now. Validated by
 *   `parseAmPrepDraft`, the same pure validator the loader runs on read-back.
 *
 * Response (success): { savedAt: string } — the SERVER's timestamp.
 *
 * Response (error): lib/api-helpers.ts jsonError shape.
 *   403 bad_origin               — cross-site or missing Origin (checked FIRST)
 *   400 invalid_json / invalid_payload
 *   401 (requireSession)
 *   403 location_access_denied   — actor does not hold the instance's shop
 *   403 prep_role_violation      — below AM_PREP_BASE_LEVEL and no assignment (the submit gate)
 *   404 instance_not_found       — no such AM prep instance
 *   409 prep_instance_not_open   — already submitted; the client stops autosaving
 *   409 draft_superseded         — a newer AM prep instance owns today's draft (stale tab)
 *   500 internal_error
 *
 * The role floor and the location bind live in `saveAmPrepDraft` (lib/am-prep-draft.ts),
 * before any write; the location and the business day come from the instance, never the
 * body. No audit row and no rate limit — both for the reasons the opening draft route
 * documents (a keystroke buffer is not the accountability record; no staff operational
 * route throttles).
 *
 * sendBeacon COMPATIBILITY: the client flushes on visibilitychange→hidden, pagehide and
 * unmount with `navigator.sendBeacon`, which sends text/plain and cannot set headers.
 * `parseJsonBody` reads the body text without consulting Content-Type, so a beacon and a
 * JSON fetch land on the same path. Do not add a Content-Type gate.
 */

import { type NextRequest } from "next/server";

import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { AmPrepDraftError, parseAmPrepDraft, saveAmPrepDraft } from "@/lib/am-prep-draft";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  // Same-origin belt FIRST (review fix, PR #383): this is a beacon-compatible POST with no
  // Content-Type gate, so the Origin check is what refuses a cross-site form or beacon. A
  // same-origin `navigator.sendBeacon` sends Origin (and Sec-Fetch-Site: same-origin), so
  // the app's own flushes pass. Mirrors app/api/admin/vendors/[id]/import/*.
  const badOrigin = assertSameOrigin(req);
  if (badOrigin) return badOrigin;

  const ctx = await requireSession(req, "/api/prep/draft");
  if (ctx instanceof Response) return ctx;

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
  const draft = parseAmPrepDraft(raw.draft);
  if (!draft) {
    return jsonError(400, "invalid_payload", {
      message: "draft failed validation (version, items).",
      field: "draft",
    });
  }

  try {
    const { savedAt } = await saveAmPrepDraft(getServiceRoleClient(), {
      actor: ctx,
      instanceId: raw.instanceId,
      patch: draft.items,
    });
    return jsonOk({ savedAt });
  } catch (err) {
    if (err instanceof AmPrepDraftError) {
      return jsonError(err.status, err.code, { message: err.message });
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/prep/draft] draft save failed:", msg);
    return jsonError(500, "internal_error", { message: "draft save failed" });
  }
}
