/**
 * Catering delivery D2 — "the old shop still sends it": the answer to `pickup_mismatch` (an open job booked for pickup
 * at a shop the order is no longer at). No step-up.
 *
 * Order: same-origin, the session, the switch, the strict parse, the lib. The decision is an append-only row bound to
 * the DESTINATION shop the lead lock saw (`keep_delivery_pickup`): `shop_moved` if the order moved again before the
 * tap, `no_mismatch` when there is nothing to answer, `already_kept` on a second tap. Another transfer raises the
 * mismatch again. The job must be this lead's.
 */
import type { NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { deliveryOffResponse, deliveryRefusal } from "@/lib/delivery/http";
import { keepDeliveryPickup } from "@/lib/delivery/jobs";
import { parseDeliveryId, parseKeepPickup } from "@/lib/delivery/parse-shared";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; jobId: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id, jobId: job } = await params;
  const actor = await requireSession(req, `/api/catering/pipeline/${id}/delivery/${job}/keep-pickup`);
  if (actor instanceof Response) return actor;
  const off = deliveryOffResponse();
  if (off) return off;
  const raw = await parseJsonBody(req);
  if (raw instanceof Response) return raw;
  const leadId = parseDeliveryId(id), jobId = parseDeliveryId(job), input = parseKeepPickup(raw);
  if (!leadId || !jobId || !input) return jsonError(400, "invalid_request");
  try { return jsonOk({ ok: true, decision: await keepDeliveryPickup(actor, { leadId, jobId, ...input }) }); }
  catch (error) { return deliveryRefusal(error); }
}
