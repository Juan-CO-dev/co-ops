/**
 * POST /api/pulse/layout — save the shop's 3D floor arrangement (GM+; spec "GM+ can drag stations
 * once to match the real shop (saved per shop, audited)"). Body: { locationId, layout: { [stationId]:
 * { x, y } } }. 404 while PULSE_V2 is off; the lib carries the level floor, the bind and the audit.
 */
import type { NextRequest } from "next/server";
import { extractIp, jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { pulseV2Enabled } from "@/lib/pulse/flag";
import { LayoutError, saveStationLayout } from "@/lib/pulse/layout";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  const ctx = await requireSession(req, "/api/pulse/layout");
  if (ctx instanceof Response) return ctx;
  if (!pulseV2Enabled()) return jsonError(404, "not_found");
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(400, "invalid_payload");
  const b = body as Record<string, unknown>;
  if (typeof b.locationId !== "string") return jsonError(400, "invalid_payload", { field: "locationId" });
  try {
    const result = await saveStationLayout(getServiceRoleClient(), ctx, {
      locationId: b.locationId, layout: b.layout, ip: extractIp(req), userAgent: req.headers.get("user-agent"),
    });
    return jsonOk(result);
  } catch (error) {
    if (error instanceof LayoutError) return jsonError(error.status, error.code);
    console.error("[/api/pulse/layout]", error instanceof Error ? error.message : String(error));
    return jsonError(500, "internal_error");
  }
}
