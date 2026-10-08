import { etCalendarDate, etYmdMinusDays } from "@/lib/operational-day";
import { firstLevelItemConsumption, perUnitDirectSkuOzForMenuItem, perUnitSkuAttributionsForItem, type RecipeGraph } from "@/lib/prep-consumption-graph";

export const normalizeOrderCode = (code: string) => code.trim().toUpperCase().replace(/-/g, "");
/** Keep only explicit code-shaped tokens, never the surrounding staff/customer note. */
export function orderCodeTokens(text: string): string[] {
  const explicit = [...text.matchAll(/\bez\s*cater\s*(?:order\s*)?(?:#|:)?\s*([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)\b/gi)]
    .map((m) => normalizeOrderCode(m[1]!)).filter((s) => s.length <= 32);
  return [...new Set([...explicit, ...(text.match(/\b[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\b/g) ?? [])
    .map(normalizeOrderCode).filter((s) => /^[A-Z0-9]{6,32}$/.test(s) && /[0-9]/.test(s) && /[A-Z]/.test(s))])];
}
export interface LinkOrder { id: string; location_id: string; event_date: string | null; order_number: string | null }
export interface LinkSelection { location_id: string; business_date: string; order_guid: string; snapshot_id: string; check_guid: string; selection_guid: string; codes: string[] }
export function matchSelection(selection: LinkSelection, orders: LinkOrder[]) {
  const codes = new Set(selection.codes.map(normalizeOrderCode));
  const candidates = orders.filter((o) => o.location_id === selection.location_id && o.event_date &&
    Math.abs(Date.parse(o.event_date) - Date.parse(selection.business_date)) <= 86_400_000 &&
    o.order_number && codes.has(normalizeOrderCode(o.order_number)));
  return { orderId: candidates.length === 1 ? candidates[0]!.id : null,
    candidates: candidates.map((o) => o.id), reason: candidates.length === 1 ? "normalized_code" : candidates.length ? "ambiguous_code" : "unmatched_code" };
}
export interface ItemIdentity { provider_item_uuid: string | null; menu_item_size_id: string | null; pos_item_id: string | null; name: string }
export function itemIdentity(item: ItemIdentity): string | null {
  // A size alone or a display name cannot identify a provider menu item.
  return item.provider_item_uuid ? JSON.stringify([item.provider_item_uuid, item.menu_item_size_id]) : null;
}
export interface ToastMap { toast_item_guid: string; toast_item_name: string; item_id: string | null; menu_item_id: string | null }
export function probeItemMap(item: ItemIdentity, maps: ToastMap[]) {
  const exact = item.pos_item_id ? maps.filter((m) => m.toast_item_guid.toLowerCase() === item.pos_item_id!.toLowerCase()) : [];
  const names = maps.filter((m) => m.toast_item_name.trim().toLowerCase() === item.name.trim().toLowerCase());
  return { confirmed: exact.length === 1 ? exact[0]! : null, evidence: exact.length === 1 ? "pos_guid" : null,
    candidates: (exact.length ? exact : names).map((m) => m.toast_item_guid),
    reason: exact.length > 1 ? "ambiguous_pos_guid" : names.length ? "name_candidate" : "unmapped_item" };
}
export interface ProductionEvidence { location_id: string; output_item_id: string; produced_at: string }
export interface ShadowAmount { sku_id: string; sales_oz: number; suppressed_oz: number; shadow_oz: number }
/** Comparison only. D-1 preparation counts at its actual shop; no production is moved. */
export function shadowAmounts(graph: RecipeGraph, target: Pick<ToastMap, "item_id" | "menu_item_id">,
  quantity: number, locationId: string, eventDate: string, productions: ProductionEvidence[]): ShadowAmount[] {
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error("ezcater_invalid_quantity");
  const produced = new Set(productions.filter((p) => p.location_id === locationId &&
    [eventDate, etYmdMinusDays(eventDate, 1)].includes(etCalendarDate(p.produced_at))).map((p) => p.output_item_id));
  const amounts = new Map<string, ShadowAmount>();
  function add(sku_id: string, amount: number, suppressed: boolean) {
    const r = amounts.get(sku_id) ?? { sku_id, sales_oz: 0, suppressed_oz: 0, shadow_oz: 0 };
    r.sales_oz += amount; r.suppressed_oz += suppressed ? amount : 0; r.shadow_oz += suppressed ? 0 : amount;
    amounts.set(sku_id, r);
  }
  const items = target.item_id ? new Map([[target.item_id, 1]]) : target.menu_item_id ? firstLevelItemConsumption(graph, target.menu_item_id) : new Map<string, number>();
  if (target.menu_item_id) for (const [sku, oz] of perUnitDirectSkuOzForMenuItem(graph, target.menu_item_id)) add(sku, oz * quantity, false);
  for (const [item, units] of items) for (const row of perUnitSkuAttributionsForItem(graph, item))
    add(row.skuId, row.oz * units * quantity, row.itemPath.some((id) => produced.has(id)));
  return [...amounts.values()];
}
