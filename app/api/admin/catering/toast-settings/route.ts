/**
 * Item 21 PR 5 — the catering ↔ Toast settings card. GET: every shop's row and what is installed. POST: save ONE shop's
 * whole row through `set_catering_toast_settings` (0350), the only writer of the table.
 *
 * POST order: same-origin, the session, the trusted role (Owner / CGS / MoO, before any I/O), Tier B (always prompted:
 * a switch here turns automatic linking on for a shop), the strict parse, then the writer, which re-checks the role on
 * the locked users row, the row the person saw and every dependency, and writes its own destructive
 * `catering.toast_settings_update` audit row in the same transaction. Under /api/admin, so this route's own
 * requireSession keeps the Tier B unlock the preceding POST /api/auth/step-up set. Sends nothing.
 */
import type { NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { requireSession } from "@/lib/session";
import { canManageCateringToastSettings, parseSettingsSave } from "@/lib/catering/catering-toast-settings-shared";
import { CateringToastSettingsError, loadCateringToastSettings, saveCateringToastSettings } from "@/lib/catering/catering-toast-settings";

export const runtime = "nodejs";
const PATH = "/api/admin/catering/toast-settings";

function refusal(error: unknown) {
  if (error instanceof CateringToastSettingsError) {
    const response = jsonError(error.status, error.code);
    if (error.status === 503) response.headers.set("Retry-After", "60");
    return response;
  }
  return jsonError(500, "generic");
}

export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, PATH);
  if (ctx instanceof Response) return ctx;
  if (!canManageCateringToastSettings(ctx.role)) return jsonError(403, "forbidden");
  try { return jsonOk({ settings: await loadCateringToastSettings(ctx) }); }
  catch (error) { return refusal(error); }
}

export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const ctx = await requireSession(req, PATH);
  if (ctx instanceof Response) return ctx;
  if (!canManageCateringToastSettings(ctx.role)) return jsonError(403, "forbidden");
  const stepUp = assertStepUp(ctx, "B");
  if (!stepUp.ok) return jsonError(403, stepUp.code);
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  const input = parseSettingsSave(body);
  if (!input) return jsonError(400, "invalid_settings");
  try { return jsonOk({ saved: await saveCateringToastSettings(ctx, input) }); }
  catch (error) { return refusal(error); }
}
