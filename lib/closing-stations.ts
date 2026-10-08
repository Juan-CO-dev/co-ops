import "server-only";
import { audit } from "./audit";
import { closingStations, stationChanges } from "./closing-stations-shared";
import { lockLocationContext, type LocationActor } from "./locations";
import { getServiceRoleClient } from "./supabase-server";
import { getRoleLevel } from "./roles";
import { etCalendarDate } from "./operational-day";

export interface StationSyncActor extends LocationActor { userId: string }

/** Matches the currently effective closing version for this shop. */
export async function syncStationsFromClosing(locationId: string, actor: StationSyncActor): Promise<void> {
  if (getRoleLevel(actor.role) < 8 && !lockLocationContext(actor, locationId)) throw new Error("location_access_denied");
  const service = getServiceRoleClient();
  const today = etCalendarDate(new Date().toISOString());
  const templates = await service.from("checklist_templates")
    .select("id,effective_from,created_at").eq("location_id", locationId)
    .eq("type", "closing").eq("active", true)
    .or(`effective_from.is.null,effective_from.lte.${today}`);
  if (templates.error) throw templates.error;
  const latest = (templates.data ?? []).sort((a, b) =>
    (b.effective_from ?? "").localeCompare(a.effective_from ?? "") ||
    b.created_at.localeCompare(a.created_at))[0];
  // A shop without an active closing list has no authoritative station set.
  if (!latest) return;
  const [items, current] = await Promise.all([
    service.from("checklist_template_items").select("station,display_order,translations")
      .eq("template_id", latest.id).eq("active", true).order("display_order"),
    service.from("stations").select("id,name,name_es,sort,active").eq("location_id", locationId),
  ]);
  if (items.error) throw items.error;
  if (current.error) throw current.error;
  const desired = closingStations(items.data ?? []);
  const stored = (current.data ?? []).map((row) => ({ id: row.id, name: row.name,
    nameEs: row.name_es, sort: row.sort, active: row.active }));
  for (const change of stationChanges(desired, stored)) {
    if (change.operation === "deactivate") {
      const result = await service.from("stations").update({ active: false })
        .eq("id", change.id).eq("location_id", locationId).eq("active", true).select("id").maybeSingle();
      if (result.error) throw result.error;
      if (result.data) await audit({ actorId: actor.userId, actorRole: actor.role, action: "station.sync",
        resourceTable: "stations", resourceId: change.id,
        metadata: { location_id: locationId, template_id: latest.id, operation: "deactivate", name: change.name },
        ipAddress: null, userAgent: null });
      continue;
    }
    const old = change.operation === "update" ? stored.find((row) => row.id === change.id) : undefined;
    const next = { name: change.section.name, name_es: change.section.nameEs ?? old?.nameEs ?? null,
      sort: change.section.sort, active: true };
    const result = change.operation === "update"
      ? await service.from("stations").update(next).eq("id", change.id).eq("location_id", locationId).select("id").single()
      : await service.from("stations").insert({ ...next, location_id: locationId }).select("id").single();
    // A concurrent page load may have inserted the same section after our read.
    // The unique (location_id, name) index makes that run the winner; the next
    // sync reconciles any remaining fields without creating a second station.
    if (result.error?.code === "23505" && change.operation === "insert") continue;
    if (result.error) throw result.error;
    await audit({ actorId: actor.userId, actorRole: actor.role, action: "station.sync",
      resourceTable: "stations", resourceId: result.data.id,
      metadata: { location_id: locationId, template_id: latest.id, operation: change.operation, ...next },
      ipAddress: null, userAgent: null });
  }
  // Also heals a prior partial sync if the station insert won but its position did not.
  const [stationRows, positionRows] = await Promise.all([
    service.from("stations").select("id,name").eq("location_id", locationId).eq("active", true),
    service.from("station_positions").select("station_id").eq("location_id", locationId),
  ]);
  if (stationRows.error) throw stationRows.error;
  if (positionRows.error) throw positionRows.error;
  const hasPosition = new Set((positionRows.data ?? []).map((row) => row.station_id));
  for (const station of stationRows.data ?? []) {
    if (hasPosition.has(station.id)) continue;
    const section = desired.find((row) => row.name === station.name);
    if (!section) continue;
    const position = await service.from("station_positions").insert({
      station_id: station.id, location_id: locationId, name: section.name,
      name_es: section.nameEs, sort: 1,
    }).select("id").single();
    if (position.error?.code === "23505") continue;
    if (position.error) throw position.error;
    await audit({ actorId: actor.userId, actorRole: actor.role, action: "station.position_create",
      resourceTable: "station_positions", resourceId: position.data.id,
      metadata: { location_id: locationId, station_id: station.id, source: "closing_sync" },
      ipAddress: null, userAgent: null });
  }
}
