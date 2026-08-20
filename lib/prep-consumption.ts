/**
 * Prep-consumption engine (Item/Inventory Spine — production-in-prep fold). SERVER-ONLY,
 * service-role. Recursively flattens an item's item_components recipe to leaf-SKU oz consumed
 * per par-unit, mirroring recipe-math's per-batch ÷ batch_yield semantics —
 * but ACCUMULATING PER LEAF SKU instead of summing. Returns oz-per-output-unit; callers scale.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { skuContentOz, type MeasureUnitFactor, type RecipeInputSku } from "@/lib/recipe-math";
import type { PackChainLevel } from "@/lib/pack-chain-shared";
import {
  buildRecipeGraph,
  perUnitSkuOzForItemFromGraph,
  perUnitSkuOzForMenuItemFromGraph,
  type GraphRecipe,
  type RecipeGraph,
} from "@/lib/prep-consumption-graph";
import { audit } from "@/lib/audit";
import type { RoleCode } from "@/lib/roles";

function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

export async function loadMeasures(): Promise<Map<string, MeasureUnitFactor>> {
  const sb = getServiceRoleClient();
  const { data } = await sb.from("measure_units").select("label, dimension, to_base_factor").eq("active", true).returns<Array<{ label: string; dimension: "weight" | "volume" | "count"; to_base_factor: number | string }>>();
  return new Map((data ?? []).map((m) => [m.label, { dimension: m.dimension, toBaseFactor: num(m.to_base_factor) ?? 0 }]));
}

async function loadSkuPack(skuIds: string[]): Promise<Map<string, RecipeInputSku>> {
  if (skuIds.length === 0) return new Map();
  const sb = getServiceRoleClient();
  const { data } = await sb.from("vendor_items")
    .select("id, pack_format, each_container_label, units_per_pack, each_size, each_measure, avg_oz_per_each")
    .in("id", skuIds)
    .returns<Array<{ id: string; pack_format: string | null; each_container_label: string | null; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null }>>();
  // ONE batch query for the whole universe's active chain levels (loadRecipeGraph
  // law — never per-SKU). Pack-hierarchy 0159; SKUs without a chain get [].
  const chainsBySku = await loadSkuPackChains(skuIds);
  return new Map((data ?? []).map((s) => [s.id, {
    packFormat: s.pack_format, eachContainerLabel: s.each_container_label,
    unitsPerPack: s.units_per_pack, eachSize: num(s.each_size), eachMeasure: s.each_measure,
    avgOzPerEach: num(s.avg_oz_per_each),
    packChain: chainsBySku.get(s.id) ?? null,
  }]));
}

/**
 * Batch-load active pack-chain levels for a set of SKUs into per-SKU level arrays
 * (pack-hierarchy 0159). ONE query regardless of SKU count (loadRecipeGraph law).
 * Returns an empty map when there are no chains — every consumer treats a missing
 * entry as "no chain → legacy flat-field path".
 */
export async function loadSkuPackChains(skuIds: string[]): Promise<Map<string, PackChainLevel[]>> {
  const out = new Map<string, PackChainLevel[]>();
  if (skuIds.length === 0) return out;
  const sb = getServiceRoleClient();
  const { data } = await sb.from("sku_pack_levels")
    .select("id, sku_id, label, contains_qty, contains_level_id, contains_measure_unit, display_ordinal")
    .in("sku_id", skuIds)
    .eq("active", true)
    .order("display_ordinal", { ascending: true })
    .returns<Array<{ id: string; sku_id: string; label: string; contains_qty: number | string; contains_level_id: string | null; contains_measure_unit: string | null; display_ordinal: number }>>();
  for (const r of data ?? []) {
    const list = out.get(r.sku_id) ?? [];
    list.push({
      id: r.id, label: r.label, containsQty: num(r.contains_qty) ?? 0,
      containsLevelId: r.contains_level_id, containsMeasureUnit: r.contains_measure_unit,
      displayOrdinal: r.display_ordinal,
    });
    out.set(r.sku_id, list);
  }
  return out;
}

/**
 * Per-item par BASIS: `oz_per_par_unit` (fan-out allocation weight) plus
 * `default_par_unit` (the label a recipe line may legitimately spell instead of
 * a measure — see itemRefParUnits' unknown-unit refusal). One query, both
 * fields; they come off the same row and are read by the same resolver.
 */
async function loadItemParBasis(
  itemIds: string[],
): Promise<Map<string, { ozPerParUnit: number | null; parUnitLabel: string | null }>> {
  if (itemIds.length === 0) return new Map();
  const sb = getServiceRoleClient();
  const { data } = await sb.from("items").select("id, oz_per_par_unit, default_par_unit").in("id", itemIds)
    .returns<Array<{ id: string; oz_per_par_unit: number | string | null; default_par_unit: string | null }>>();
  return new Map((data ?? []).map((r) => [r.id, {
    ozPerParUnit: num(r.oz_per_par_unit),
    parUnitLabel: r.default_par_unit,
  }]));
}

/**
 * Load the WHOLE recipe universe in a fixed number of queries (6), regardless of
 * how many items/menu_items are subsequently resolved. Replaces the former
 * per-recipe-node recursive loading (4+ queries per node — the N+1 the
 * 2026-07-23 council review flagged as a latent cliff for real catering volume).
 * The graph is small (dozens of recipes / a few hundred rows); resolution is
 * pure + in-memory via lib/prep-consumption-graph.ts. Loops (W4b sku-demand,
 * surplus, loadDerivedForItems) load ONE graph and resolve every line against it.
 */
export async function loadRecipeGraph(): Promise<RecipeGraph> {
  const sb = getServiceRoleClient();
  const measures = await loadMeasures();
  const [{ data: recRows }, { data: inRows }, { data: outRows }] = await Promise.all([
    // ACTIVE ONLY (multi-vendor audit P5, second half — 2026-08-20). An inactive
    // recipe is a RETIRED one: `active = false` is how this codebase deactivates
    // config rows, and nothing else in the app treats a retired recipe as live
    // (lib/admin/readiness-load.ts has filtered on it since it shipped). Without
    // the filter, first-wins indexing plus created_at ordering handed the slot to
    // whichever producer was created FIRST — which is systematically the OLDER,
    // retired one. Live that was not hypothetical: the 2026-07-01 `Hot Peppers`
    // recipe (retired, Baldor, 512 oz) beat the active `Hot Peppers (portioned)`,
    // and the 2026-07-06 `AntiPasta2` (retired) beat `Antipasto Pasta
    // (approximate)`. A deactivated recipe was silently defining two items' costs
    // and depletion, and disagreeing with the readiness map about which recipe
    // even produces them.
    //
    // DETERMINISTIC ORDER still matters for the ACTIVE duplicates the filter
    // cannot resolve. buildRecipeGraph indexes producers FIRST-WINS per output, so
    // when two ACTIVE recipes produce the same item the winner is decided purely by
    // row order, and an unordered select gives no guarantee. Ordering makes that
    // repeatable, not correct — nothing here knows which producer is operationally
    // right, which is why duplicate ACTIVE producers now raise a readiness warning
    // (lib/readiness.ts, `duplicate_producers`). created_at is nullable, so `id`
    // (PK, never null) is the tiebreak that makes the order total rather than
    // merely mostly-stable.
    sb.from("recipes").select("id, batch_yield").eq("active", true)
      .order("created_at", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true })
      .returns<Array<{ id: string; batch_yield: number | string | null }>>(),
    sb.from("recipe_inputs").select("recipe_id, quantity, unit, component_sku_id, component_item_id")
      .returns<Array<{ recipe_id: string; quantity: number | string; unit: string | null; component_sku_id: string | null; component_item_id: string | null }>>(),
    sb.from("recipe_outputs").select("recipe_id, output_item_id, output_menu_item_id, yield")
      .returns<Array<{ recipe_id: string; output_item_id: string | null; output_menu_item_id: string | null; yield: number | string }>>(),
  ]);
  const outputItemIds = [...new Set((outRows ?? []).filter((o) => o.output_item_id).map((o) => o.output_item_id!))];
  const skuIds = [...new Set((inRows ?? []).filter((c) => c.component_sku_id).map((c) => c.component_sku_id!))];
  const [parBasis, skuPack] = await Promise.all([loadItemParBasis(outputItemIds), loadSkuPack(skuIds)]);

  const inputsByRecipe = new Map<string, GraphRecipe["inputs"]>();
  for (const c of inRows ?? []) {
    const list = inputsByRecipe.get(c.recipe_id) ?? [];
    list.push({ quantity: num(c.quantity) ?? 0, unit: c.unit, componentSkuId: c.component_sku_id, componentItemId: c.component_item_id });
    inputsByRecipe.set(c.recipe_id, list);
  }
  const outputsByRecipe = new Map<string, GraphRecipe["outputs"]>();
  for (const o of outRows ?? []) {
    const list = outputsByRecipe.get(o.recipe_id) ?? [];
    const basis = o.output_item_id ? parBasis.get(o.output_item_id) : undefined;
    list.push({
      outputItemId: o.output_item_id, outputMenuItemId: o.output_menu_item_id,
      yield: num(o.yield) ?? 0,
      ozPerParUnit: basis?.ozPerParUnit ?? null,
      parUnitLabel: basis?.parUnitLabel ?? null,
    });
    outputsByRecipe.set(o.recipe_id, list);
  }
  const recipes: GraphRecipe[] = (recRows ?? []).map((r) => ({
    recipeId: r.id, batchYield: num(r.batch_yield),
    inputs: inputsByRecipe.get(r.id) ?? [], outputs: outputsByRecipe.get(r.id) ?? [],
  }));
  return buildRecipeGraph(recipes, skuPack, measures);
}

/** Per-one-unit leaf-SKU oz for an ITEM (one-shot; loops should loadRecipeGraph once and use the FromGraph variant). */
export async function perUnitSkuOzForItem(itemId: string): Promise<Map<string, number>> {
  const graph = await loadRecipeGraph();
  return perUnitSkuOzForItemFromGraph(graph, itemId);
}

/**
 * Per-one-unit leaf-SKU oz for a MENU_ITEM (sub) — the sub-shop analog of perUnitSkuOzForItem.
 * One-shot wrapper; loops should loadRecipeGraph once and use the FromGraph variant.
 */
export async function perUnitSkuOzForMenuItem(menuItemId: string): Promise<Map<string, number>> {
  const graph = await loadRecipeGraph();
  return perUnitSkuOzForMenuItemFromGraph(graph, menuItemId);
}

export async function skuConsumptionForItem(itemId: string, outputQty: number): Promise<Map<string, number>> {
  if (!Number.isFinite(outputQty) || outputQty <= 0) return new Map();
  const perUnit = await perUnitSkuOzForItem(itemId);
  const out = new Map<string, number>();
  for (const [sku, oz] of perUnit) out.set(sku, oz * outputQty);
  return out;
}

/** One leaf SKU's derived (per-one-output-unit) consumption, hydrated for the panel UI. */
export interface DerivedSku { skuId: string; skuName: string; perUnitOz: number; unitsPerPack: number | null; contentOz: number | null; }
/** A confirmed/edited consumption line coming back from the panel. */
export interface ConfirmedInput { skuId: string; qtyOz: number; qtyEntered: number | null; unitEntered: string | null; derivedOz: number | null; }
export interface RecordFromPrepInput {
  locationId: string; instanceId: string; templateItemId: string;
  outputItemId: string; outputQty: number;
  confirmedConsumption: ConfirmedInput[];
  source: "opening_p2" | "mid_day_p2";
}

/**
 * Per convertible item, the hydrated per-one-output-unit leaf-SKU consumption (for the
 * panel's live-scaled "Uses:" summary + editable rows). Items whose recipe is incomplete
 * (empty perUnitSkuOzForItem) map to [] = non-convertible (no panel). Batches the SKU
 * name/pack loads across all items.
 */
export async function loadDerivedForItems(itemIds: string[]): Promise<Map<string, DerivedSku[]>> {
  const out = new Map<string, DerivedSku[]>();
  const uniq = [...new Set(itemIds.filter(Boolean))];
  if (uniq.length === 0) return out;
  const sb = getServiceRoleClient();
  const graph = await loadRecipeGraph();
  const perItem = new Map<string, Map<string, number>>();
  const allSkuIds = new Set<string>();
  for (const id of uniq) {
    const m = perUnitSkuOzForItemFromGraph(graph, id);
    perItem.set(id, m);
    for (const sku of m.keys()) allSkuIds.add(sku);
  }
  const measures = graph.measures;
  const skuInfo = new Map<string, { name: string; unitsPerPack: number | null; contentOz: number | null }>();
  if (allSkuIds.size > 0) {
    const { data: skus } = await sb.from("vendor_items").select("id, name, units_per_pack, each_size, each_measure, avg_oz_per_each").in("id", [...allSkuIds])
      .returns<Array<{ id: string; name: string; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null; avg_oz_per_each: number | string | null }>>();
    const chainsBySku = await loadSkuPackChains([...allSkuIds]); // chain-aware content (0159)
    for (const s of skus ?? []) {
      const contentOz = skuContentOz({ unitsPerPack: s.units_per_pack, eachSize: num(s.each_size), eachMeasure: s.each_measure, avgOzPerEach: num(s.avg_oz_per_each), packChain: chainsBySku.get(s.id) ?? null }, measures);
      skuInfo.set(s.id, { name: s.name, unitsPerPack: s.units_per_pack, contentOz });
    }
  }
  for (const id of uniq) {
    const m = perItem.get(id) ?? new Map();
    const list: DerivedSku[] = [];
    for (const [skuId, perUnitOz] of m) {
      const info = skuInfo.get(skuId);
      list.push({ skuId, skuName: info?.name ?? "(sku)", perUnitOz, unitsPerPack: info?.unitsPerPack ?? null, contentOz: info?.contentOz ?? null });
    }
    out.set(id, list);
  }
  return out;
}

/**
 * Record a prep conversion idempotently, keyed by (instanceId, templateItemId):
 * supersede any live production header for that key, then insert a fresh header +
 * one production_inputs line per confirmed SKU. Empty confirmedConsumption still
 * supersedes the prior (a corrected prep with no convertible inputs clears the old
 * depletion) and inserts nothing. Authorization is the CALLER's (the prep-save gate) —
 * this helper does NOT re-gate role.
 */
export async function recordProductionFromPrep(actor: { userId: string; role: RoleCode }, input: RecordFromPrepInput): Promise<{ productionId: string | null }> {
  const sb = getServiceRoleClient();
  // Check the supersede error: if it fails silently, the insert below lands a
  // SECOND live header for this key → double-counted depletion. (Backstopped at
  // the DB by the partial UNIQUE index productions_prep_live_idx, migration 0107,
  // which also makes a concurrent racing insert fail loudly rather than duplicate.)
  const { error: supErr } = await sb.from("productions").update({ superseded_at: new Date().toISOString() })
    .eq("instance_id", input.instanceId).eq("template_item_id", input.templateItemId)
    .is("superseded_at", null).is("revoked_at", null);
  if (supErr) throw new Error(`recordProductionFromPrep supersede: ${supErr.message}`);
  const positive = input.confirmedConsumption.filter((c) => Number.isFinite(c.qtyOz) && c.qtyOz > 0);
  if (positive.length === 0) return { productionId: null };
  const { data: hdr, error: hErr } = await sb.from("productions").insert({
    location_id: input.locationId, output_item_id: input.outputItemId, output_qty: input.outputQty,
    source: input.source, instance_id: input.instanceId, template_item_id: input.templateItemId, created_by: actor.userId,
  }).select("id").maybeSingle<{ id: string }>();
  if (hErr) throw new Error(`recordProductionFromPrep header: ${hErr.message}`);
  if (!hdr) throw new Error("recordProductionFromPrep header returned no row");
  const { error: lErr } = await sb.from("production_inputs").insert(positive.map((c) => ({
    production_id: hdr.id, input_sku_id: c.skuId, input_oz: c.qtyOz,
    qty_entered: c.qtyEntered, unit_entered: c.unitEntered, derived_oz: c.derivedOz,
  })));
  if (lErr) throw new Error(`recordProductionFromPrep lines: ${lErr.message}`);
  await audit({ actorId: actor.userId, actorRole: actor.role, action: "production.recorded", resourceTable: "productions", resourceId: hdr.id, metadata: { source: input.source, instance_id: input.instanceId, template_item_id: input.templateItemId, output_item_id: input.outputItemId, output_qty: input.outputQty, sku_count: positive.length }, ipAddress: null, userAgent: null });
  return { productionId: hdr.id };
}

/** Reverse (revoke) the live production for a prep (instance, template_item). No-op if none live. */
export async function reverseProductionForPrep(actor: { userId: string; role: RoleCode }, args: { instanceId: string; templateItemId: string }): Promise<void> {
  const sb = getServiceRoleClient();
  const { data: live } = await sb.from("productions").select("id").eq("instance_id", args.instanceId).eq("template_item_id", args.templateItemId).is("superseded_at", null).is("revoked_at", null).maybeSingle<{ id: string }>();
  if (!live) return;
  // Guard on revoked_at IS NULL (silent-UPDATE law): the row must still be live for THIS
  // call to be the one that revoked it. count 0 = a concurrent revoke won the race between
  // the read and the write — the row is already revoked AND already audited by that caller,
  // so returning without a second audit row is the idempotent outcome, not an error.
  const { error: rErr, count } = await sb.from("productions")
    .update({ revoked_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", live.id).is("revoked_at", null);
  if (rErr) throw new Error(`reverseProductionForPrep revoke: ${rErr.message}`);
  if (count === 0) return;
  await audit({ actorId: actor.userId, actorRole: actor.role, action: "production.revoked", resourceTable: "productions", resourceId: live.id, metadata: { instance_id: args.instanceId, template_item_id: args.templateItemId }, ipAddress: null, userAgent: null });
}
