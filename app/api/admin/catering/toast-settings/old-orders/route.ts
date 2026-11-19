/**
 * Item 21 PR 5 — matching the OLD orders (Juan answer 7: old orders are suggestions a person confirms).
 * GET ?location=<id>: the shop's house orders not matched yet and the Toast checks the system is sure about.
 * POST { locationId, skip }: link ONE batch of those checks. Each is an ordinary human link through the one writer
 * (`decide_catering_toast`: its own decision row and audit row, the same refusals), made as the person who pressed.
 * The server recomputes the list on every batch; a client never sends the pairs.
 *
 * POST order: same-origin, the session, the trusted role (Owner / CGS / MoO, before any I/O), Tier A (the password once
 * in this session: one press links many checks, and its batches outlast Tier B's two minutes), the strict parse, then
 * the batch under this route's own deadline.
 */
import type { NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { requireSession } from "@/lib/session";
import { canManageCateringToastSettings } from "@/lib/catering/catering-toast-settings-shared";
import { parseOldOrdersLink } from "@/lib/catering/catering-toast-old-orders-shared";
import { CateringToastSettingsError, linkOldOrders, loadOldOrders } from "@/lib/catering/catering-toast-settings";

export const runtime = "nodejs";
export const maxDuration = 60;
const PATH = "/api/admin/catering/toast-settings/old-orders";
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
  try { return jsonOk({ oldOrders: await loadOldOrders(ctx, locationId.toLowerCase()) }); }
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
  const input = parseOldOrdersLink(body);
  if (!input) return jsonError(400, "invalid_settings");
  try { return jsonOk({ result: await linkOldOrders(ctx, input.locationId, input.skip, { deadlineAt: startedAt + 40_000 }) }); }
  catch (error) { return refusal(error); }
}
