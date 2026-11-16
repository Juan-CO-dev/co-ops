/**
 * B8 #4 r4 (Astra round 3): THE fridge temp-item registry — which fridge a checklist item's
 * reading belongs to, and that fridge's safe max. Reports, Trends, Pulse, the maintenance list and
 * day page, the equipment pages and the hub summary all read readings through this one map; no
 * surface keeps its own list of fridges or items.
 *
 * - Every fridge at the location is in it, retired ones included: their past readings are history.
 * - One owner per item. When several fridges carry the same item, the ACTIVE fridge wins; among
 *   fridges of the same status, the most recently created wins, then the lowest id. (The table has
 *   no updated_at.) Row order from the database never decides it.
 * - A reading is a flag when it is strictly above its owner's safe max, 41°F when unset.
 * - W15/B022: a publish re-mints every line with a NEW id, so the two pointer columns alone
 *   lose the republished line (its readings vanished and a hot one was never flagged). The
 *   registry also claims every opening/closing count line LINKED to a fridge
 *   (`checklist_template_items.equipment_id`, 0181) on ANY version at the same shop — the
 *   same "lines that feed this fridge" rule the equipment page already uses. Pointer claims
 *   still come first and win; a linked line only fills an unclaimed item. A line on another
 *   shop's template is never claimed (a cross-shop mislink can't leak readings).
 *
 * Pure apart from `loadTempItemRegistry`; no server-only imports so client-safe modules may reuse
 * the constant.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const FRIDGE_DEFAULT_SAFE_MAX_F = 41;

export interface FridgeRegistryRow {
  id: string;
  opening_temp_item_id: string | null;
  closing_temp_item_id: string | null;
  safe_max_f: number | null;
  active?: boolean | null;
  created_at?: string | null;
}

export interface TempItemOwner {
  fridgeId: string;
  safeMaxF: number;
  active: boolean;
  /** AM = the fridge's opening temp item, PM = its closing one. */
  phase: "AM" | "PM";
}

export type TempItemRegistry = ReadonlyMap<string, TempItemOwner>;

export const FRIDGE_REGISTRY_COLUMNS = "id, opening_temp_item_id, closing_temp_item_id, safe_max_f, active, created_at";

const isActive = (r: FridgeRegistryRow) => r.active !== false;

/** W15/B022: a count line linked to a fridge, on any version of an opening/closing list at the shop. */
export interface FridgeLinkedLine {
  itemId: string;
  equipmentId: string;
  templateType: "opening" | "closing";
}

/** Rows → item id → owner, by the one deterministic rule above. */
export function buildTempItemRegistry(
  rows: ReadonlyArray<FridgeRegistryRow>,
  linked: ReadonlyArray<FridgeLinkedLine> = [],
): Map<string, TempItemOwner> {
  const ordered = [...rows].sort((a, b) =>
    Number(isActive(b)) - Number(isActive(a))
    || (b.created_at ?? "").localeCompare(a.created_at ?? "")
    || a.id.localeCompare(b.id));
  const out = new Map<string, TempItemOwner>();
  for (const r of ordered) {
    const safeMaxF = r.safe_max_f ?? FRIDGE_DEFAULT_SAFE_MAX_F;
    const claims: Array<[string | null, "AM" | "PM"]> = [[r.opening_temp_item_id, "AM"], [r.closing_temp_item_id, "PM"]];
    for (const [item, phase] of claims) {
      if (item && !out.has(item)) out.set(item, { fridgeId: r.id, safeMaxF, active: isActive(r), phase });
    }
  }
  // W15/B022: then every linked line of every version, in a stable order (item id).
  const fridges = new Map(rows.map((r) => [r.id, r] as const));
  const lines = [...linked].sort((a, b) => a.itemId.localeCompare(b.itemId) || a.equipmentId.localeCompare(b.equipmentId));
  for (const l of lines) {
    const f = fridges.get(l.equipmentId);
    if (!f || out.has(l.itemId)) continue;
    out.set(l.itemId, {
      fridgeId: f.id,
      safeMaxF: f.safe_max_f ?? FRIDGE_DEFAULT_SAFE_MAX_F,
      active: isActive(f),
      phase: l.templateType === "opening" ? "AM" : "PM",
    });
  }
  return out;
}

/** Is this PostgREST error "the 0181 equipment_id column does not exist yet"? */
function equipmentColumnMissing(err: { code?: string | null; message?: string | null } | null): boolean {
  if (!err) return false;
  const code = err.code ?? "";
  if (code === "PGRST204" || code === "PGRST205" || code === "42703") return true;
  const msg = (err.message ?? "").toLowerCase();
  return msg.includes("equipment_id") && (msg.includes("does not exist") || msg.includes("could not find"));
}

type SignalCapable = { abortSignal?: (s: AbortSignal) => unknown };
function withSignal<T>(q: T, signal: AbortSignal | undefined): T {
  const b = q as unknown as SignalCapable;
  return signal && typeof b.abortSignal === "function" ? (b.abortSignal(signal) as T) : q;
}

/**
 * W15/B022: every count line linked to one of `fridgeIds`, on any version (active or not)
 * of an opening/closing list AT `locationId`. Two paged queries, no embed. Degrades to []
 * before 0181 (no equipment_id column).
 */
export async function loadFridgeLinkedLines(
  service: SupabaseClient,
  locationId: string,
  fridgeIds: readonly string[],
  signal?: AbortSignal,
): Promise<FridgeLinkedLine[]> {
  if (fridgeIds.length === 0) return [];
  const items: Array<{ id: string; equipment_id: string; template_id: string }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await withSignal(
      service.from("checklist_template_items").select("id, equipment_id, template_id")
        .in("equipment_id", [...fridgeIds]).eq("expects_count", true).order("id").range(from, from + 999),
      signal,
    );
    if (equipmentColumnMissing(error)) return [];
    if (error) throw new Error(`fridge linked lines: ${error.message}`);
    const page = (data ?? []) as Array<{ id: string; equipment_id: string; template_id: string }>;
    items.push(...page);
    if (page.length < 1000) break;
  }
  if (items.length === 0) return [];
  const templateIds = [...new Set(items.map((r) => r.template_id))];
  const templates = new Map<string, { type: string; location_id: string }>();
  for (let i = 0; i < templateIds.length; i += 100) {
    const { data, error } = await withSignal(
      service.from("checklist_templates").select("id, type, location_id").in("id", templateIds.slice(i, i + 100)),
      signal,
    );
    if (error) throw new Error(`fridge linked line templates: ${error.message}`);
    for (const t of (data ?? []) as Array<{ id: string; type: string; location_id: string }>) templates.set(t.id, t);
  }
  const out: FridgeLinkedLine[] = [];
  for (const r of items) {
    const t = templates.get(r.template_id);
    if (!t || t.location_id !== locationId) continue;
    if (t.type !== "opening" && t.type !== "closing") continue;
    out.push({ itemId: r.id, equipmentId: r.equipment_id, templateType: t.type });
  }
  return out;
}

/** One read: every fridge at the location (active and retired). */
export async function loadTempItemRegistry(service: SupabaseClient, locationId: string): Promise<Map<string, TempItemOwner>> {
  const { data, error } = await service
    .from("maintenance_equipment")
    .select(FRIDGE_REGISTRY_COLUMNS)
    .eq("location_id", locationId)
    .eq("kind", "fridge");
  if (error) throw new Error(`temp item registry: ${error.message}`);
  const rows = (data ?? []) as FridgeRegistryRow[];
  const linked = await loadFridgeLinkedLines(service, locationId, rows.map((r) => r.id));
  return buildTempItemRegistry(rows, linked);
}

/**
 * W15 round 1 (review r1 P2 2): registry item ids per request. The registry claims every fridge line
 * on every version, so it grows with every publish; a completion read filtered by it sends the ids in
 * chunks of this size — one `.in()` over the whole registry outgrows the request line (414) after enough
 * publishes. 50 uuids ≈ 1.9 KB, well inside REQUEST_LINE_BUDGET_BYTES beside an instance chunk of 50.
 */
export const REGISTRY_IN_CHUNK = 50;

/** Split ids into request-sized chunks (an empty list gives no chunk). */
export function chunkIds(ids: Iterable<string>, size: number = REGISTRY_IN_CHUNK): string[][] {
  const all = [...ids];
  const out: string[][] = [];
  for (let i = 0; i < all.length; i += size) out.push(all.slice(i, i + size));
  return out;
}

/** The items whose readings belong to this fridge (never an item another fridge owns). */
export function itemsOwnedBy(registry: TempItemRegistry, fridgeId: string): string[] {
  return [...registry].filter(([, owner]) => owner.fridgeId === fridgeId).map(([item]) => item);
}

/** THE temp-flag rule: a registry item whose reading is strictly above its owner's safe max. */
export function isHotReading(registry: TempItemRegistry, templateItemId: string, countValue: number | null): boolean {
  const owner = registry.get(templateItemId);
  return owner !== undefined && countValue !== null && countValue > owner.safeMaxF;
}
