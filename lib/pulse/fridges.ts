/**
 * Mid-shift Pulse v2 — the batched fridge reader (Astra #3). SERVER-ONLY.
 *
 * `loadMaintenanceOverview` reads completions PER FRIDGE with no date bound (a six-fridge shop paid
 * fourteen queries per poll, and once history outgrew the response cap today's readings could vanish).
 * This reader is THREE bounded queries however many fridges the shop has, every one scoped by
 * location + today first:
 *   1. the shop's fridges (ids, names, temp item ids, safe max), retired ones included so the ONE
 *      temp-item registry (lib/fridge-registry, B8 #4 r4) decides which fridge owns each item; only
 *      active fridges are shown,
 *   2. today's checklist instances at the shop (ids),
 *   3. the live completions on those instances for those temp items (paged).
 * Statuses reuse lib/maintenance's `computeFridgeStatus`. An optional AbortSignal rides into every
 * query so the pulse's deadline cancels database work instead of merely abandoning the promise.
 * The spark is TODAY's readings (AM → PM), never a history window.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeFridgeStatus, type FridgeStatus, type TempReading } from "@/lib/maintenance";
import { buildTempItemRegistry, FRIDGE_REGISTRY_COLUMNS, FRIDGE_DEFAULT_SAFE_MAX_F, itemsOwnedBy } from "@/lib/fridge-registry";
import { selectAllRows } from "@/lib/supabase-paginate";

export interface FridgeToday {
  id: string;
  name: string;
  status: FridgeStatus;
  /** The latest reading TODAY (null when none). */
  latestF: number | null;
  /** Today's readings in time order. */
  readings: number[];
}

type EquipRow = { id: string; name: string; opening_temp_item_id: string | null; closing_temp_item_id: string | null; safe_max_f: number | null; active?: boolean | null; created_at?: string | null };
type CompRow = { template_item_id: string; count_value: number | string | null; completed_at: string };

/** Apply the deadline signal when the builder supports it (every PostgREST filter builder does). */
function withSignal<T extends { abortSignal?: (s: AbortSignal) => T }>(q: T, signal: AbortSignal | undefined): T {
  return signal && typeof q.abortSignal === "function" ? q.abortSignal(signal) : q;
}

export async function loadFridgesToday(service: SupabaseClient, args: { locationId: string; date: string; signal?: AbortSignal }): Promise<FridgeToday[]> {
  const { locationId, date, signal } = args;
  const eqRes = await withSignal(
    service.from("maintenance_equipment").select(`${FRIDGE_REGISTRY_COLUMNS}, name`)
      .eq("location_id", locationId).eq("kind", "fridge").order("sort_order", { ascending: true }).returns<EquipRow[]>(),
    signal,
  );
  if (eqRes.error) throw new Error(`fridges today equipment: ${eqRes.error.message}`);
  const registry = buildTempItemRegistry(eqRes.data ?? []);
  const fridges = (eqRes.data ?? []).filter((f) => f.active !== false);
  if (fridges.length === 0) return [];
  const owned = new Map(fridges.map((f) => [f.id, new Set(itemsOwnedBy(registry, f.id))] as const));
  const itemIds = fridges.flatMap((f) => [...owned.get(f.id)!]);
  const empty = (): FridgeToday[] => fridges.map((f) => ({ id: f.id, name: f.name, status: "no_reading_today", latestF: null, readings: [] }));
  if (itemIds.length === 0) return empty();

  const instances = await selectAllRows<{ id: string }>((from, to) => withSignal(
    service.from("checklist_instances").select("id").eq("location_id", locationId).eq("date", date).order("id").range(from, to),
    signal,
  ));
  if (instances.length === 0) return empty();

  const comps = await selectAllRows<CompRow>((from, to) => withSignal(
    service.from("checklist_completions").select("template_item_id, count_value, completed_at")
      .in("instance_id", instances.map((i) => i.id)).in("template_item_id", itemIds)
      .is("superseded_at", null).is("revoked_at", null).order("id").range(from, to).returns<CompRow[]>(),
    signal,
  ), 500);

  return fridges.map((f) => {
    const mine: TempReading[] = comps
      .filter((c) => c.count_value !== null && owned.get(f.id)!.has(c.template_item_id))
      .map((c) => ({ date, phase: registry.get(c.template_item_id)!.phase, valueF: Number(c.count_value), at: c.completed_at, note: null }))
      .sort((a, b) => a.at.localeCompare(b.at));
    return {
      id: f.id,
      name: f.name,
      status: computeFridgeStatus(mine, f.safe_max_f ?? FRIDGE_DEFAULT_SAFE_MAX_F),
      latestF: mine.length ? mine[mine.length - 1]!.valueF : null,
      readings: mine.map((r) => r.valueF),
    };
  });
}
