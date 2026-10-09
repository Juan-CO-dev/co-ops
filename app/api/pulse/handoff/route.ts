/**
 * POST /api/pulse/handoff — AM→PM handoff notes (AGM+). Body:
 *   { locationId, action: "create", audience: "crew"|"managers"|"all", body }
 *   { locationId, action: "ack", noteId }           — the incoming manager's "Got it"
 *   { locationId, action: "supersede", noteId }     — retract (append-only: never edit/delete)
 * 404 while PULSE_V2 is off; 503 not_installed while 0240 is unapplied. Gates + audit live in the lib.
 */
import type { NextRequest } from "next/server";
import { extractIp, jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { operationalNow } from "@/lib/midshift-shared";
import { pulseV2Enabled } from "@/lib/pulse/flag";
import { ackHandoffNote, createHandoffNote, HandoffError, isHandoffAudience, PulseNotInstalledError, supersedeHandoffNote } from "@/lib/pulse/handoff";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  const ctx = await requireSession(req, "/api/pulse/handoff");
  if (ctx instanceof Response) return ctx;
  if (!pulseV2Enabled()) return jsonError(404, "not_found");
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "invalid_payload");
  const b = body as Record<string, unknown>;
  if (typeof b.locationId !== "string") return jsonError(400, "invalid_payload", { field: "locationId" });
  const service = getServiceRoleClient();
  const meta = { ip: extractIp(req), userAgent: req.headers.get("user-agent") };
  try {
    switch (b.action) {
      case "create": {
        if (!isHandoffAudience(b.audience) || typeof b.body !== "string") return jsonError(400, "invalid_payload");
        const { date } = operationalNow(new Date());
        return jsonOk(await createHandoffNote(service, ctx, { locationId: b.locationId, date, audience: b.audience, body: b.body, ...meta }));
      }
      case "ack": {
        if (typeof b.noteId !== "string") return jsonError(400, "invalid_payload", { field: "noteId" });
        return jsonOk(await ackHandoffNote(service, ctx, { locationId: b.locationId, noteId: b.noteId, ...meta }));
      }
      case "supersede": {
        if (typeof b.noteId !== "string") return jsonError(400, "invalid_payload", { field: "noteId" });
        return jsonOk(await supersedeHandoffNote(service, ctx, { locationId: b.locationId, noteId: b.noteId, ...meta }));
      }
      default:
        return jsonError(400, "invalid_payload", { field: "action" });
    }
  } catch (error) {
    if (error instanceof HandoffError) return jsonError(error.status, error.code);
    if (error instanceof PulseNotInstalledError) return jsonError(503, "not_installed");
    console.error("[/api/pulse/handoff]", error instanceof Error ? error.message : String(error));
    return jsonError(500, "internal_error");
  }
}
