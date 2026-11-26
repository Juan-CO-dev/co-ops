/**
 * Catering delivery D2 — a lead's delivery. Read with AGENTS.md "Catering delivery".
 *
 * GET: the view the LIB decides for this viewer (lib/delivery/jobs.ts `loadLeadDelivery`), returned as the body:
 *   { view: "off" }            200  the switch is off (no query was made) — the panel renders nothing
 *   { view: "not_installed" }  200  migration 0356 is not on the database — the panel renders nothing
 *   { view: "lead", enabled, state, status, detail?, cost? }  200  a viewer who passes the status gate at the lead's
 *                              CURRENT shop; `enabled: false` (the shop is off) also renders nothing
 *   { view: "history", jobs }  200  the pickup shop's AGM / GM after the order moved away: their shop's jobs only
 *   404 `lead_not_found`       nothing this viewer may see (or no such lead); 403 `forbidden` for a role no gate admits.
 * POST: record a delivery booked outside CO-OPS (`manual`), or the courier ezCater sent (`provider_native`). No
 * step-up: an operational act on one job's record. Order: same-origin, the session, the switch, the strict parse, the
 * lib (the write gate at the shop the person saw, before any I/O); `record_manual_delivery_job` re-checks everything
 * under the lead lock and writes its own audit row. Sends nothing.
 */
import type { NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { deliveryTrackingOn } from "@/lib/delivery/config";
import { deliveryOffResponse, deliveryRefusal } from "@/lib/delivery/http";
import { loadLeadDelivery, recordManualDeliveryJob } from "@/lib/delivery/jobs";
import { parseDeliveryId, parseRecordJob } from "@/lib/delivery/parse-shared";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireSession(req, `/api/catering/pipeline/${id}/delivery`);
  if (actor instanceof Response) return actor;
  if (!deliveryTrackingOn()) return jsonOk({ view: "off" });
  const leadId = parseDeliveryId(id);
  if (!leadId) return jsonError(404, "lead_not_found");
  try {
    const view = await loadLeadDelivery(actor, leadId);
    return view ? jsonOk(view) : jsonError(404, "lead_not_found");
  } catch (error) { return deliveryRefusal(error); }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id } = await params;
  const actor = await requireSession(req, `/api/catering/pipeline/${id}/delivery`);
  if (actor instanceof Response) return actor;
  const off = deliveryOffResponse();
  if (off) return off;
  const raw = await parseJsonBody(req);
  if (raw instanceof Response) return raw;
  const leadId = parseDeliveryId(id), input = parseRecordJob(raw);
  if (!leadId || !input) return jsonError(400, "invalid_request");
  try { return jsonOk({ ok: true, job: await recordManualDeliveryJob(actor, { leadId, ...input }) }); }
  catch (error) { return deliveryRefusal(error); }
}
