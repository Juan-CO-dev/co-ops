import type { RecipeGraph } from "@/lib/prep-consumption-graph";
import { applyModifierEffect, skuPortionOz, type ModifierEffect } from "@/lib/toast/modifiers-shared";
import { allocatePackagePicks } from "@/lib/toast/platter-shared";
import { shadowAmounts, type ShadowAmount, type ProductionEvidence, type TransferEvidence } from "./pass2-shared";

export interface CustomizationMap {
  location_id: string;
  customization_id: string;
  status: "confirmed" | "ignored";
  effects: ModifierEffect[];
  pick_menu_item_id: string | null;
}
export interface PackageLine {
  id: string; package_id: string; slot_type: string; item_id: string | null; menu_item_id: string | null;
  quantity: number | string; depletion_qty?: number | string | null; display_order?: number;
}
export interface PackageOption { package_item_id: string; item_id: string | null; menu_item_id: string | null; classic: boolean }
export interface PackageComposition { lines: PackageLine[]; options: PackageOption[] }
export interface CustomizationIssue { code: string; identity_key: string }
type Pick = { id: string; menuItemId: string; qty: number };
type Target = { item_id: string | null; menu_item_id: string | null; units: number };

/** Provider quantities are selected counts for the entire order line, not per-unit multipliers. */
export function resolveCustomizations(options: unknown[], maps: CustomizationMap[], locationId: string) {
  const effects: Array<{ id: string; effect: ModifierEffect; quantity: number }> = [];
  const picks: Pick[] = [];
  const issues: CustomizationIssue[] = [];
  for (const [index, raw] of options.entries()) {
    const option = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const id = typeof option.customizationId === "string" && option.customizationId.trim() ? option.customizationId : null;
    if (!id) { issues.push({ code: "customization_identity_missing", identity_key: String(index) }); continue; }
    const matches = maps.filter((map) => map.location_id === locationId && map.customization_id === id);
    const map = matches.length === 1 ? matches[0] : undefined;
    if (!map) { issues.push({ code: "customization_unmapped", identity_key: id }); continue; }
    if (map.status === "ignored") continue;
    if (typeof option.quantity !== "number" || !Number.isFinite(option.quantity) || option.quantity < 0) {
      issues.push({ code: "customization_quantity_invalid", identity_key: id }); continue;
    }
    if (map.pick_menu_item_id) picks.push({ id: `${index}:${id}`, menuItemId: map.pick_menu_item_id, qty: option.quantity });
    else if (!map.effects.length) issues.push({ code: "customization_effects_missing", identity_key: id });
    else for (const effect of map.effects) effects.push({ id, effect, quantity: option.quantity });
  }
  return { effects, picks, issues };
}

/** Same binding/cap rule as Toast spec B; only unfilled capacity receives the even mix. */
export function packageTargets(context: PackageComposition, packageId: string, quantity: number, picks: Pick[] = []) {
  const lines = context.lines.filter((line) => line.package_id === packageId);
  const issues: CustomizationIssue[] = [];
  const targets: Target[] = [];
  const fail = () => ({ targets: [] as Target[], issues: [{ code: "recipe_unresolved", identity_key: packageId }] });
  if (!lines.length || !Number.isFinite(quantity) || quantity < 0) return fail();
  if (lines.some((line) => !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0 ||
    !Number.isFinite(Number(line.depletion_qty ?? line.quantity)) || Number(line.depletion_qty ?? line.quantity) <= 0)) return fail();
  const allocation = allocatePackagePicks(lines.filter((line) => line.slot_type === "choice").map((line) => ({
    id: line.id, quantity: Number(line.quantity), depletionQty: Number(line.depletion_qty ?? line.quantity),
    displayOrder: line.display_order ?? 0,
    menuItemIds: context.options.filter((option) => option.package_item_id === line.id && option.menu_item_id).map((option) => option.menu_item_id!),
  })), picks, quantity);
  if (picks.some((pick) => !allocation.consumed.has(pick.id))) return { targets: [], issues: [{ code: "customization_pick_unbound", identity_key: packageId }] };
  for (const line of lines) {
    const units = Number(line.depletion_qty ?? line.quantity) * quantity;
    if (line.slot_type !== "choice") { targets.push({ ...line, units }); continue; }
    const slot = allocation.bySlot.get(line.id)!;
    if (slot.excess) issues.push({ code: "customization_pick_excess", identity_key: line.id });
    targets.push(...slot.picks.map((pick) => ({ item_id: null, menu_item_id: pick.menuItemId, units: pick.units })));
    if (slot.remaining > 0) {
      const pool = context.options.filter((option) => option.package_item_id === line.id);
      if (!pool.length) return fail();
      targets.push(...pool.map((option) => ({ ...option, units: slot.remaining / pool.length })));
    }
  }
  if (targets.some((target) => !target.item_id && !target.menu_item_id)) return fail();
  return { targets, issues };
}

export interface CustomizedLineInput {
  graph: RecipeGraph;
  target: { item_id: string | null; menu_item_id: string | null; package_id?: string | null };
  quantity: number; options: unknown[]; maps: CustomizationMap[]; locationId: string; eventDate: string;
  productions: ProductionEvidence[]; transfers?: TransferEvidence[];
  packages?: PackageComposition; skuWeights?: ReadonlyMap<string, number | null>;
}

/** One pure resolver feeds both live counting and the shadow ledger. Unresolved
 * customizations refuse the whole line; linked Toast checks never fill that gap. */
export function customizedLineAmounts(input: CustomizedLineInput): { amounts: ShadowAmount[]; issues: CustomizationIssue[] } {
  const { graph, target, quantity, locationId, eventDate, productions, transfers = [] } = input;
  const resolved = resolveCustomizations(input.options, input.maps, locationId);
  if (resolved.issues.length) return { amounts: [], issues: resolved.issues };
  const issues: CustomizationIssue[] = [];
  const failure = (code: string, identity_key: string) => ({ amounts: [], issues: [...issues, { code, identity_key }] });
  if (!Number.isFinite(quantity) || quantity < 0) return failure("customization_quantity_invalid", "line");
  const composition = target.package_id
    ? packageTargets(input.packages ?? { lines: [], options: [] }, target.package_id, quantity, resolved.picks)
    : { targets: [{ ...target, units: quantity }], issues: [] };
  issues.push(...composition.issues);
  if (!target.package_id && resolved.picks.length) return failure("customization_pick_unbound", resolved.picks[0]!.id);
  if (!composition.targets.length) return { amounts: [], issues };
  const totals = new Map<string, ShadowAmount>();
  const add = (amounts: ShadowAmount[], sign = 1) => {
    for (const row of amounts) {
      const sum = totals.get(row.sku_id) ?? { sku_id: row.sku_id, sales_oz: 0, suppressed_oz: 0, shadow_oz: 0, flattened_oz: 0 };
      for (const key of ["sales_oz", "suppressed_oz", "shadow_oz", "flattened_oz"] as const) sum[key] += sign * row[key];
      totals.set(row.sku_id, sum);
    }
  };
  for (const part of composition.targets) {
    const amounts = shadowAmounts(graph, part, part.units, locationId, eventDate, productions, transfers);
    if (part.units > 0 && !amounts.length) return failure("recipe_unresolved", part.menu_item_id ?? part.item_id ?? "line");
    add(amounts);
  }
  for (const { id, effect, quantity: selected } of resolved.effects) {
    // A package-level bread swap needs a specific parent choice. Without that
    // association the provider has not said which sub to change; refuse guesses.
    if (target.package_id && effect.disposition === "remove") return failure("customization_parent_unresolved", id);
    const applications = effect.disposition === "remove" ? Math.min(selected, quantity) : selected;
    if (effect.disposition === "remove" && selected > quantity) issues.push({ code: "customization_quantity_excess", identity_key: id });
    const applied = applyModifierEffect(graph, effect, target.menu_item_id, applications);
    if (applied.kind === "portion_needed") return failure("customization_portion_needed", id);
    if (applied.kind === "ignored") continue;
    if (applied.kind === "sku") {
      if (applied.portion.qty === 0 || applied.qty === 0) continue;
      const oz = skuPortionOz(applied.portion, input.skuWeights?.get(applied.targetId) ?? graph.skuPack.get(applied.targetId)?.avgOzPerEach ?? null);
      if (oz == null || !Number.isFinite(oz) || oz < 0) return failure("customization_portion_needed", id);
      add([{ sku_id: applied.targetId, sales_oz: oz * applied.qty, suppressed_oz: 0, shadow_oz: oz * applied.qty, flattened_oz: 0 }], applied.sign);
    } else {
      if (applied.amount === 0) continue;
      const amounts = shadowAmounts(graph, { item_id: applied.kind === "item" ? applied.targetId : null,
        menu_item_id: applied.kind === "menu_item" ? applied.targetId : null }, Math.abs(applied.amount), locationId, eventDate, productions, transfers);
      if (!amounts.length) return failure("recipe_unresolved", id);
      add(amounts, Math.sign(applied.amount));
    }
  }
  // Clamp within this line, never against unrelated sales. Keep the ledger's
  // sales = suppressed + shadow invariant even when several removals overlap.
  const amounts = [...totals.values()].map((row) => {
    const sales = Math.max(0, row.sales_oz), shadow = Math.max(0, row.shadow_oz);
    return { ...row, sales_oz: sales, shadow_oz: Math.min(sales, shadow), suppressed_oz: Math.max(0, sales - shadow), flattened_oz: Math.max(0, row.flattened_oz) };
  });
  return { amounts, issues };
}
