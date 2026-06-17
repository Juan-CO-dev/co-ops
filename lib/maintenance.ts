import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoleCode } from "@/lib/roles";
import { audit } from "@/lib/audit";

export const MAINTENANCE_BASE_LEVEL = 3;
export const FRIDGE_DEFAULT_SAFE_MAX_F = 41;

export interface MaintActor {
  userId: string;
  role: RoleCode;
  level: number;
}
export interface Equipment {
  id: string;
  name: string;
  kind: "fridge" | "equipment";
  openingTempItemId: string | null;
  closingTempItemId: string | null;
  safeMaxF: number | null;
}
/** One temp reading: which session (AM/PM), the value, when. */
export interface TempReading {
  date: string;
  phase: "AM" | "PM";
  valueF: number;
  at: string;
  note: string | null;
}
export interface MaintenanceNote {
  id: string;
  equipmentId: string | null;
  otherLabel: string | null;
  note: string;
  byName: string | null;
  at: string;
}

export type FridgeStatus = "ok" | "out_of_range" | "no_reading_today";
export function computeFridgeStatus(todaysReadings: TempReading[], safeMaxF: number): FridgeStatus {
  if (todaysReadings.length === 0) return "no_reading_today";
  return todaysReadings.some((r) => r.valueF > safeMaxF) ? "out_of_range" : "ok";
}

const EQUIP_ROW = "id, name, kind, opening_temp_item_id, closing_temp_item_id, safe_max_f, sort_order";
function rowToEquip(r: Record<string, unknown>): Equipment {
  return {
    id: r.id as string,
    name: r.name as string,
    kind: r.kind as "fridge" | "equipment",
    openingTempItemId: (r.opening_temp_item_id as string | null) ?? null,
    closingTempItemId: (r.closing_temp_item_id as string | null) ?? null,
    safeMaxF: (r.safe_max_f as number | null) ?? null,
  };
}

export async function loadEquipment(service: SupabaseClient, locationId: string): Promise<Equipment[]> {
  const { data, error } = await service
    .from("maintenance_equipment")
    .select(EQUIP_ROW)
    .eq("location_id", locationId)
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`loadEquipment: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map(rowToEquip);
}

/**
 * Temp readings for a fridge: the live completions of its opening (AM) +
 * closing (PM) temp items across the date window, as TempReadings. Two-step
 * (completions → their instances' operational dates) to avoid a fragile
 * PostgREST embedded-select on an RLS-protected relation (AGENTS.md lesson).
 */
async function loadFridgeReadings(
  service: SupabaseClient,
  equip: Equipment,
  sinceDate: string,
): Promise<TempReading[]> {
  const itemIds = [equip.openingTempItemId, equip.closingTempItemId].filter((v): v is string => !!v);
  if (itemIds.length === 0) return [];

  const { data: comps, error } = await service
    .from("checklist_completions")
    .select("template_item_id, instance_id, count_value, completed_at, notes")
    .in("template_item_id", itemIds)
    .is("superseded_at", null)
    .is("revoked_at", null);
  if (error) throw new Error(`loadFridgeReadings: ${error.message}`);
  const rows = (comps ?? []) as Array<{
    template_item_id: string;
    instance_id: string;
    count_value: number | null;
    completed_at: string;
    notes: string | null;
  }>;
  if (rows.length === 0) return [];

  // Resolve each completion's instance operational date in one query.
  const instanceIds = [...new Set(rows.map((r) => r.instance_id))];
  const { data: insts, error: instErr } = await service
    .from("checklist_instances")
    .select("id, date")
    .in("id", instanceIds);
  if (instErr) throw new Error(`loadFridgeReadings: instances: ${instErr.message}`);
  const dateById = new Map<string, string>();
  for (const i of (insts ?? []) as Array<{ id: string; date: string }>) dateById.set(i.id, i.date);

  const out: TempReading[] = [];
  for (const r of rows) {
    if (r.count_value === null) continue;
    const date = dateById.get(r.instance_id) ?? r.completed_at.slice(0, 10);
    if (date < sinceDate) continue;
    out.push({
      date,
      phase: r.template_item_id === equip.openingTempItemId ? "AM" : "PM",
      valueF: r.count_value,
      at: r.completed_at,
      note: r.notes ?? null,
    });
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : 1));
}

export interface OverviewFridge {
  equip: Equipment;
  latest: TempReading | null;
  status: FridgeStatus;
  spark: number[];
}
export interface MaintenanceOverview {
  fridges: OverviewFridge[];
  equipment: Array<{ equip: Equipment; lastNote: MaintenanceNote | null }>;
}

export async function loadMaintenanceOverview(
  service: SupabaseClient,
  args: { locationId: string; today: string; sinceDate: string },
): Promise<MaintenanceOverview> {
  const equipment = await loadEquipment(service, args.locationId);
  const fridges: OverviewFridge[] = [];
  for (const e of equipment.filter((x) => x.kind === "fridge")) {
    const readings = await loadFridgeReadings(service, e, args.sinceDate);
    const todays = readings.filter((r) => r.date === args.today);
    const latest = readings.length ? readings[readings.length - 1]! : null;
    fridges.push({
      equip: e,
      latest,
      status: computeFridgeStatus(todays, e.safeMaxF ?? FRIDGE_DEFAULT_SAFE_MAX_F),
      spark: readings.slice(-12).map((r) => r.valueF),
    });
  }

  const equip: MaintenanceOverview["equipment"] = [];
  for (const e of equipment.filter((x) => x.kind === "equipment")) {
    const { data } = await service
      .from("maintenance_notes")
      .select("id, note, created_by, created_at")
      .eq("equipment_id", e.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<Record<string, unknown>>();
    let lastNote: MaintenanceNote | null = null;
    if (data) {
      const byId = data.created_by as string | null;
      const nm = byId
        ? (await service.from("users").select("name").eq("id", byId).maybeSingle<{ name: string }>()).data?.name ?? null
        : null;
      lastNote = {
        id: data.id as string,
        equipmentId: e.id,
        otherLabel: null,
        note: data.note as string,
        byName: nm,
        at: data.created_at as string,
      };
    }
    equip.push({ equip: e, lastNote });
  }

  // out-of-range fridges first
  fridges.sort(
    (a, b) => (a.status === "out_of_range" ? 0 : 1) - (b.status === "out_of_range" ? 0 : 1),
  );
  return { fridges, equipment: equip };
}

export interface EquipmentDetail {
  equip: Equipment;
  readings: TempReading[];
  stats: {
    latest: number | null;
    amPmSwingToday: number | null;
    min: number | null;
    max: number | null;
    avg: number | null;
    outOfRangeCount: number;
  } | null;
  notes: MaintenanceNote[]; // maintenance notes + checklist notes merged, newest first
}

export async function loadEquipmentDetail(
  service: SupabaseClient,
  args: { equipmentId: string; today: string; sinceDate: string },
): Promise<EquipmentDetail | null> {
  const { data: eRow } = await service
    .from("maintenance_equipment")
    .select(EQUIP_ROW)
    .eq("id", args.equipmentId)
    .maybeSingle<Record<string, unknown>>();
  if (!eRow) return null;
  const equip = rowToEquip(eRow);

  const readings = equip.kind === "fridge" ? await loadFridgeReadings(service, equip, args.sinceDate) : [];
  let stats: EquipmentDetail["stats"] = null;
  if (readings.length) {
    const vals = readings.map((r) => r.valueF);
    const todays = readings.filter((r) => r.date === args.today);
    const am = todays.find((r) => r.phase === "AM")?.valueF ?? null;
    const pm = todays.find((r) => r.phase === "PM")?.valueF ?? null;
    const safe = equip.safeMaxF ?? FRIDGE_DEFAULT_SAFE_MAX_F;
    stats = {
      latest: vals[vals.length - 1] ?? null,
      amPmSwingToday: am !== null && pm !== null ? pm - am : null,
      min: Math.min(...vals),
      max: Math.max(...vals),
      avg: Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10,
      outOfRangeCount: vals.filter((v) => v > safe).length,
    };
  }

  const { data: notesRows } = await service
    .from("maintenance_notes")
    .select("id, note, created_by, created_at")
    .eq("equipment_id", equip.id)
    .order("created_at", { ascending: false });
  const ids = [...new Set(((notesRows ?? []) as Array<{ created_by: string }>).map((r) => r.created_by))];
  const nameById = new Map<string, string>();
  if (ids.length) {
    const { data: users } = await service.from("users").select("id, name").in("id", ids);
    for (const u of (users ?? []) as Array<{ id: string; name: string }>) nameById.set(u.id, u.name);
  }
  const notes: MaintenanceNote[] = ((notesRows ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    equipmentId: equip.id,
    otherLabel: null,
    note: r.note as string,
    byName: nameById.get(r.created_by as string) ?? null,
    at: r.created_at as string,
  }));

  // checklist notes left on this fridge's temp items → append as read-only history
  const itemIds = [equip.openingTempItemId, equip.closingTempItemId].filter((v): v is string => !!v);
  if (itemIds.length) {
    const { data: cNotes } = await service
      .from("checklist_completions")
      .select("notes, completed_at")
      .in("template_item_id", itemIds)
      .is("superseded_at", null)
      .is("revoked_at", null)
      .not("notes", "is", null)
      .gte("completed_at", args.sinceDate);
    for (const r of (cNotes ?? []) as Array<{ notes: string | null; completed_at: string }>) {
      if (r.notes && r.notes.trim()) {
        notes.push({ id: `c-${r.completed_at}`, equipmentId: equip.id, otherLabel: null, note: r.notes, byName: null, at: r.completed_at });
      }
    }
    notes.sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  return { equip, readings, stats, notes };
}

export async function addMaintenanceNote(
  service: SupabaseClient,
  args: { locationId: string; actor: MaintActor; equipmentId: string | null; otherLabel: string | null; note: string },
): Promise<{ id: string }> {
  const { data, error } = await service
    .from("maintenance_notes")
    .insert({
      location_id: args.locationId,
      equipment_id: args.equipmentId,
      other_label: args.equipmentId ? null : args.otherLabel ?? null,
      note: args.note,
      created_by: args.actor.userId,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw new Error(`addMaintenanceNote: ${error.message}`);
  void audit({
    actorId: args.actor.userId,
    actorRole: args.actor.role,
    action: "maintenance.note",
    resourceTable: "maintenance_notes",
    resourceId: data.id,
    metadata: { equipment_id: args.equipmentId, other: args.otherLabel },
    ipAddress: null,
    userAgent: null,
  });
  return { id: data.id };
}
