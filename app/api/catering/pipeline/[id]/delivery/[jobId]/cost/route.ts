/**
 * Catering delivery D2 — what a courier charged US for one job (a payable; never the fee the customer pays).
 *
 * A FIRST cost of a figure (`correctsId` null; "No charge" is an explicit 0) takes no step-up: it is the record itself.
 * A CORRECTION (`correctsId` = the row the person saw, with a reason) is Tier A, asserted AFTER the parse so the tier
 * is chosen by the act, and this path is a step-up surface (lib/session.ts `isCateringStepUpPath`) so the route's own
 * requireSession keeps the unlock the preceding POST /api/auth/step-up set.
 * Order: same-origin, the session, the switch, the strict parse, the tier, the lib. `record_delivery_cost` refuses a
 * second first cost (`cost_exists`), a correction of anything but the current head (`not_current_head`) and a missing
 * reason (`reason_required`) under its locks. Allowed on a closed job: the bill arrives later.
 */
import type { NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { assertStepUp } from "@/lib/admin/step-up";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { deliveryOffResponse, deliveryRefusal } from "@/lib/delivery/http";
import { recordDeliveryCost } from "@/lib/delivery/jobs";
import { parseDeliveryId, parseRecordCost } from "@/lib/delivery/parse-shared";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; jobId: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id, jobId: job } = await params;
  const ctx = await requireSession(req, `/api/catering/pipeline/${id}/delivery/${job}/cost`);
  if (ctx instanceof Response) return ctx;
  const off = deliveryOffResponse();
  if (off) return off;
  const raw = await parseJsonBody(req);
  if (raw instanceof Response) return raw;
  const leadId = parseDeliveryId(id), jobId = parseDeliveryId(job), input = parseRecordCost(raw);
  if (!leadId || !jobId || !input) return jsonError(400, "invalid_request");
  if (input.correctsId !== null) {
    const stepUp = assertStepUp(ctx, "A");
    if (!stepUp.ok) return jsonError(403, stepUp.code);
  }
  try { return jsonOk({ ok: true, cost: await recordDeliveryCost(ctx, { leadId, jobId, ...input }) }); }
  catch (error) { return deliveryRefusal(error); }
}
