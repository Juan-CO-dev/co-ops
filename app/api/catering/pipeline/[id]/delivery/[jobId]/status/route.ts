/**
 * Catering delivery D2 — one status a person saw (Picked up, Delivered, Cancelled, Failed). No step-up.
 *
 * Order: same-origin, the session, the switch, the strict parse, the lib. The body names the shop and the status the
 * person saw; `record_delivery_event` refuses `shop_moved` / `status_moved` under its locks, judges the move against
 * the CURRENT status (recording order is status order; the entered time is information only), and nothing follows a
 * terminal status (`job_closed`). A wrong tap is not undone: the fix is a new delivery. The job must be this lead's.
 */
import type { NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { deliveryOffResponse, deliveryRefusal } from "@/lib/delivery/http";
import { recordDeliveryEvent } from "@/lib/delivery/jobs";
import { parseDeliveryId, parseRecordStatus } from "@/lib/delivery/parse-shared";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; jobId: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id, jobId: job } = await params;
  const actor = await requireSession(req, `/api/catering/pipeline/${id}/delivery/${job}/status`);
  if (actor instanceof Response) return actor;
  const off = deliveryOffResponse();
  if (off) return off;
  const raw = await parseJsonBody(req);
  if (raw instanceof Response) return raw;
  const leadId = parseDeliveryId(id), jobId = parseDeliveryId(job), input = parseRecordStatus(raw);
  if (!leadId || !jobId || !input) return jsonError(400, "invalid_request");
  try { return jsonOk({ ok: true, event: await recordDeliveryEvent(actor, { leadId, jobId, ...input }) }); }
  catch (error) { return deliveryRefusal(error); }
}
