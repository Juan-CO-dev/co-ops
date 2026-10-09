/**
 * GET /api/pulse/section?section=<PulseSection>&location=<uuid> — one section's live payload for the
 * Mid-shift Pulse v2 (the client refreshes each section on its own 60 s timer).
 *
 * Order: session → flag (404 while PULSE_V2 is off) → section/location shape → role matrix (403) →
 * location bind (403) → the loader, which re-checks scope itself before any I/O. Response is never
 * cached. Body: { section, state, asOf, data? | code? } (lib/pulse/types SectionState).
 */
import type { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { operationalNow } from "@/lib/midshift-shared";
import { pulseV2Enabled } from "@/lib/pulse/flag";
import { canReadPulseLocation, isPulseSection, sectionAccess } from "@/lib/pulse/scope-shared";
import { defaultPulseDeps, loadPulseSection } from "@/lib/pulse/sections";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/pulse/section");
  if (ctx instanceof Response) return ctx;
  if (!pulseV2Enabled()) return jsonError(404, "not_found");
  const section = req.nextUrl.searchParams.get("section");
  const locationId = req.nextUrl.searchParams.get("location");
  if (!isPulseSection(section)) return jsonError(400, "invalid_section");
  if (!locationId || !UUID.test(locationId)) return jsonError(400, "invalid_location");
  if (sectionAccess({ flagOn: true, level: ctx.level, section }) !== "ok") return jsonError(403, "role_insufficient");
  // The PULSE read grant (Astra #5): 8+ any shop, otherwise membership. Writes elsewhere keep lockLocationContext.
  if (!canReadPulseLocation({ role: ctx.role, locations: ctx.locations, level: ctx.level }, locationId)) return jsonError(403, "location_access_denied");

  const now = new Date();
  const { date } = operationalNow(now);
  const result = await loadPulseSection(defaultPulseDeps(getServiceRoleClient()), { auth: ctx, locationId, date, now }, section);
  const res = jsonOk({ section, ...result });
  res.headers.set("cache-control", "private, no-store");
  return res;
}
