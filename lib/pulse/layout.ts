/**
 * Mid-shift Pulse v2 — the saved 3D floor layout (0240 `pulse_station_layouts`). SERVER-ONLY.
 * Read: any pulse viewer of the shop (fail-soft to null while unapplied — the floor auto-arranges).
 * Save: GM+ (FLOOR_ARRANGE_LEVEL), location-bound, only stations of THIS shop, audited with the
 * before/after points (`station.layout_update`, destructive: shared config changed by a human).
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "@/lib/audit";
import { lockLocationContext } from "@/lib/locations";
import type { AuthContext } from "@/lib/session";
import { validLayout } from "@/lib/pulse/floor-shared";
import { isMissingTable } from "@/lib/pulse/handoff";
import { canArrangeFloor } from "@/lib/pulse/scope-shared";
import type { FloorLayout } from "@/lib/pulse/types";

export class LayoutError extends Error {
  constructor(public status: number, public code: string) { super(code); this.name = "LayoutError"; }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = { station_id: string; x: number | string; y: number | string };

export async function loadStationLayout(service: SupabaseClient, locationId: string): Promise<FloorLayout | null> {
  const { data, error } = await service.from("pulse_station_layouts").select("station_id, x, y").eq("location_id", locationId).returns<Row[]>();
  if (error) {
    if (isMissingTable(error)) return null;
    throw new Error(`station layout: ${error.message}`);
  }
  if (!data || data.length === 0) return null;
  const out: FloorLayout = {};
  for (const r of data) out[r.station_id] = { x: Number(r.x), y: Number(r.y) };
  return out;
}

export async function saveStationLayout(service: SupabaseClient, actor: AuthContext, args: {
  locationId: string; layout: unknown; ip: string | null; userAgent: string | null;
}): Promise<{ saved: number }> {
  if (!canArrangeFloor(actor.level)) throw new LayoutError(403, "role_insufficient");
  if (!UUID.test(args.locationId) || !lockLocationContext({ role: actor.role, locations: actor.locations }, args.locationId)) {
    throw new LayoutError(403, "location_access_denied");
  }
  if (!validLayout(args.layout)) throw new LayoutError(400, "invalid_payload");
  const layout: FloorLayout = args.layout;
  const ids = Object.keys(layout);
  if (ids.length === 0) return { saved: 0 };
  if (!ids.every((id) => UUID.test(id))) throw new LayoutError(400, "invalid_payload");
  // Only this shop's stations may be placed (the FK enforces it too; refusing here names the error).
  const { data: stations, error: sErr } = await service.from("stations").select("id").eq("location_id", args.locationId).in("id", ids).returns<Array<{ id: string }>>();
  if (sErr) throw new Error(`station layout stations: ${sErr.message}`);
  const own = new Set((stations ?? []).map((s) => s.id));
  if (ids.some((id) => !own.has(id))) throw new LayoutError(400, "station_not_in_shop");
  const before = await loadStationLayout(service, args.locationId);
  const rows = ids.map((id) => ({
    location_id: args.locationId, station_id: id, x: layout[id]!.x, y: layout[id]!.y,
    updated_by: actor.user.id, updated_at: new Date().toISOString(),
  }));
  const { error } = await service.from("pulse_station_layouts").upsert(rows, { onConflict: "location_id,station_id" });
  if (error) {
    if (isMissingTable(error)) throw new LayoutError(503, "not_installed");
    throw new Error(`station layout save: ${error.message}`);
  }
  await audit({
    actorId: actor.user.id, actorRole: actor.role, action: "station.layout_update", resourceTable: "pulse_station_layouts", resourceId: args.locationId,
    metadata: { location_id: args.locationId, before: before ?? {}, after: layout, stations: ids.length },
    ipAddress: args.ip, userAgent: args.userAgent,
  });
  return { saved: ids.length };
}
