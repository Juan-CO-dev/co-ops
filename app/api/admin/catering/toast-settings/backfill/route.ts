/**
 * Item 21 PR 5 — matching the OLDER orders (Juan answer 7). The cron's house reconciler looks at the last nine days;
 * this runs the SAME reconciler over older stretches for one shop, started by a person, never before the shop's start
 * date. GET ?location=<id>: how many booked house orders have no Toast check, and how many the backfill may reach.
 * POST { locationId, cursor }: ONE step (lib/catering/catering-toast-settings.ts runBackfillStep): the note lookup
 * examines a stretch's captures, or the reconciler links the stretch. Every rule is the reconciler's own, in SQL.
 *
 * POST order: same-origin, the session, the trusted role (Owner / CGS / MoO, before any I/O), Tier A (the password once
 * in this session: a backfill is many steps and outlasts Tier B's two minutes), the strict parse, then the step under
 * this route's own deadline.
 */
import type { NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { requireSession } from "@/lib/session";
import { canManageCateringToastSettings } from "@/lib/catering/catering-toast-settings-shared";
import { parseBackfillStep } from "@/lib/catering/catering-toast-backfill-shared";
import { CateringToastSettingsError, loadBackfillStatus, runBackfillStep } from "@/lib/catering/catering-toast-settings";

export const runtime = "nodejs";
export const maxDuration = 60;
const PATH = "/api/admin/catering/toast-settings/backfill";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const locationId = req.nextUrl.searchParams.get("location") ?? "";
  if (!UUID.test(locationId)) return jsonError(400, "invalid_settings");
  try { return jsonOk({ status: await loadBackfillStatus(ctx, locationId.toLowerCase()) }); }
  catch (error) { return refusal(error); }
}

export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const startedAt = Date.now();
  const ctx = await requireSession(req, PATH);
  if (ctx instanceof Response) return ctx;
  if (!canManageCateringToastSettings(ctx.role)) return jsonError(403, "forbidden");
  const stepUp = assertStepUp(ctx, "A");
  if (!stepUp.ok) return jsonError(403, stepUp.code);
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  const input = parseBackfillStep(body);
  if (!input) return jsonError(400, "invalid_settings");
  try { return jsonOk({ step: await runBackfillStep(ctx, input.locationId, input.cursor, { deadlineAt: startedAt + 40_000, signal: req.signal }) }); }
  catch (error) { return refusal(error); }
}
