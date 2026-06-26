/**
 * Admin item BOM ("Made from") data layer — Item/Inventory Spine, Slice C2.
 *
 * SERVER-ONLY. Service-role client throughout — admin authorization is enforced
 * APP-LAYER by the calling routes AND re-checked here per-action (the lib is the
 * authority). Service-role bypasses RLS (item_components is deny-all to users).
 *
 * Captures what a portioned ITEM is "made from": component SKUs and/or sub-items,
 * each with a quantity consumed per ONE of the parent item's par-units, in a
 * common recipe measure (oz/lb/count…, the C1 measure_units registry). The
 * yield/cost numbers + unit conversions + the reverse per-SKU view are C3.
 *
 * Schema (live, migration 0079 — NO new migration for C2):
 *   item_components — id, item_id (NOT NULL — parent), component_sku_id (nullable
 *                     → a vendor_items SKU), component_item_id (nullable → a sub-
 *                     item), quantity (NOT NULL numeric), unit (nullable text —
 *                     a measure label), display_order, created_at/by.
 *   A row links a SKU XOR a sub-item (exactly one of the two component fks).
 *   This is a composition EDGE (hard-deleted on remove, like vendor_categories),
 *   not the append-only config pattern — the audit row carries the before-state.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";

// ── Authority floors ─────────────────────────────────────────────────────────
export const BOM_READ_MIN = 6; // AGM+ — view
export const BOM_WRITE_MIN = 7; // GM+ — add / remove

// ── Types ────────────────────────────────────────────────────────────────────
/** The C1 SKU pack fields, surfaced so the client can formatSkuPack the detail. */
export interface SkuPackDetail {
  packFormat: string | null;
  unitsPerPack: number | null;
  eachSize: number | null;
  eachMeasure: string | null;
}

export interface ComponentView {
  id: string;
  itemId: string;
  kind: "sku" | "item";
  componentSkuId: string | null;
  componentItemId: string | null;
  componentName: string; // hydrated SKU name or sub-item name
  skuPack: SkuPackDetail | null; // present when kind === "sku"
  quantity: number;
  unit: string | null;
  displayOrder: number;
}

export class AdminItemComponentError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "AdminItemComponentError";
  }
}

// ── Guards / helpers ─────────────────────────────────────────────────────────
function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) {
    throw new AdminItemComponentError(403, "forbidden", "Insufficient role level for this action");
  }
}

function toNum(v: number | string | null): number {
  const n = typeof v === "string" ? Number(v) : v ?? 0;
  return Number.isFinite(n) ? n : 0;
}

function normalizeUnit(s: string | null | undefined): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t || null;
}

async function assertItemActive(itemId: string, code: string): Promise<void> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("items")
    .select("id")
    .eq("id", itemId)
    .eq("active", true)
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`assertItemActive failed: ${error.message}`);
  if (!data) throw new AdminItemComponentError(400, code, "Item not found or inactive");
}

async function assertSkuActive(skuId: string): Promise<void> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("vendor_items")
    .select("id")
    .eq("id", skuId)
    .eq("active", true)
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`assertSkuActive failed: ${error.message}`);
  if (!data) throw new AdminItemComponentError(400, "invalid_sku", "SKU not found or inactive");
}

/**
 * Cycle guard for sub-item components. Adding `childItemId` as a component of
 * `parentItemId` would create a cycle iff `parentItemId` is reachable from
 * `childItemId` by following component_item_id edges (incl. child === parent).
 * Walks the full item_components item→item graph (bounded; visited-set stops on
 * any pre-existing bad data).
 */
async function wouldCreateCycle(parentItemId: string, childItemId: string): Promise<boolean> {
  if (parentItemId === childItemId) return true;
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("item_components")
    .select("item_id, component_item_id")
    .not("component_item_id", "is", null)
    .returns<Array<{ item_id: string; component_item_id: string }>>();
  if (error) throw new Error(`wouldCreateCycle load failed: ${error.message}`);

  const childrenOf = new Map<string, string[]>();
  for (const e of data ?? []) {
    const list = childrenOf.get(e.item_id) ?? [];
    list.push(e.component_item_id);
    childrenOf.set(e.item_id, list);
  }

  // BFS from childItemId following edges; if we reach parentItemId → cycle.
  const visited = new Set<string>();
  const queue = [childItemId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === parentItemId) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const next of childrenOf.get(cur) ?? []) queue.push(next);
  }
  return false;
}

interface DbComponentRow {
  id: string;
  item_id: string;
  component_sku_id: string | null;
  component_item_id: string | null;
  quantity: number | string;
  unit: string | null;
  display_order: number;
}

// ── Reads ────────────────────────────────────────────────────────────────────
/** Load an item's components (≥6), hydrating SKU + sub-item names + SKU pack. */
export async function loadItemComponents(actor: AuthContext, itemId: string): Promise<ComponentView[]> {
  requireLevel(actor, BOM_READ_MIN);
  const sb = getServiceRoleClient();

  const { data, error } = await sb
    .from("item_components")
    .select("id, item_id, component_sku_id, component_item_id, quantity, unit, display_order")
    .eq("item_id", itemId)
    .order("display_order", { ascending: true })
    .returns<DbComponentRow[]>();
  if (error) throw new Error(`loadItemComponents failed: ${error.message}`);
  const rows = data ?? [];
  if (rows.length === 0) return [];

  // Batch-hydrate SKU names + pack fields.
  const skuIds = [...new Set(rows.map((r) => r.component_sku_id).filter((v): v is string => v !== null))];
  const skuById = new Map<string, { name: string } & SkuPackDetail>();
  if (skuIds.length > 0) {
    const { data: skus, error: sErr } = await sb
      .from("vendor_items")
      .select("id, name, pack_format, units_per_pack, each_size, each_measure")
      .in("id", skuIds)
      .returns<Array<{ id: string; name: string; pack_format: string | null; units_per_pack: number | null; each_size: number | string | null; each_measure: string | null }>>();
    if (sErr) throw new Error(`loadItemComponents skus failed: ${sErr.message}`);
    for (const s of skus ?? []) {
      skuById.set(s.id, {
        name: s.name,
        packFormat: s.pack_format,
        unitsPerPack: s.units_per_pack,
        eachSize: s.each_size === null ? null : toNum(s.each_size),
        eachMeasure: s.each_measure,
      });
    }
  }

  // Batch-hydrate sub-item names.
  const subItemIds = [...new Set(rows.map((r) => r.component_item_id).filter((v): v is string => v !== null))];
  const itemNameById = new Map<string, string>();
  if (subItemIds.length > 0) {
    const { data: items, error: iErr } = await sb
      .from("items")
      .select("id, name")
      .in("id", subItemIds)
      .returns<Array<{ id: string; name: string }>>();
    if (iErr) throw new Error(`loadItemComponents items failed: ${iErr.message}`);
    for (const it of items ?? []) itemNameById.set(it.id, it.name);
  }

  return rows.map((r) => {
    const isSku = r.component_sku_id !== null;
    const sku = r.component_sku_id ? skuById.get(r.component_sku_id) : undefined;
    return {
      id: r.id,
      itemId: r.item_id,
      kind: isSku ? ("sku" as const) : ("item" as const),
      componentSkuId: r.component_sku_id,
      componentItemId: r.component_item_id,
      componentName: isSku
        ? sku?.name ?? "(unknown SKU)"
        : (r.component_item_id ? itemNameById.get(r.component_item_id) ?? "(unknown item)" : "(unknown item)"),
      skuPack: isSku && sku
        ? { packFormat: sku.packFormat, unitsPerPack: sku.unitsPerPack, eachSize: sku.eachSize, eachMeasure: sku.eachMeasure }
        : null,
      quantity: toNum(r.quantity),
      unit: r.unit,
      displayOrder: r.display_order,
    };
  });
}

// ── Add (GM+) ─────────────────────────────────────────────────────────────────
export interface AddComponentInput {
  itemId: string;
  componentSkuId?: string | null;
  componentItemId?: string | null;
  quantity: number;
  unit?: string | null;
}

export async function addItemComponent(actor: AuthContext, input: AddComponentInput): Promise<{ id: string }> {
  requireLevel(actor, BOM_WRITE_MIN);

  const skuId = input.componentSkuId ?? null;
  const subItemId = input.componentItemId ?? null;
  // Exactly one of the two component fks.
  if ((skuId === null) === (subItemId === null)) {
    throw new AdminItemComponentError(400, "invalid_component", "Provide exactly one of a SKU or a sub-item");
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new AdminItemComponentError(400, "invalid_quantity", "Quantity must be a positive number");
  }

  await assertItemActive(input.itemId, "item_not_found");
  if (skuId !== null) {
    await assertSkuActive(skuId);
  } else if (subItemId !== null) {
    await assertItemActive(subItemId, "invalid_component_item");
    if (await wouldCreateCycle(input.itemId, subItemId)) {
      throw new AdminItemComponentError(400, "would_create_cycle", "That sub-item would create a cycle");
    }
  }

  const sb = getServiceRoleClient();
  const { data: maxRow } = await sb
    .from("item_components")
    .select("display_order")
    .eq("item_id", input.itemId)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ display_order: number }>();
  const nextOrder = (maxRow?.display_order ?? 0) + 1;

  const { data: inserted, error } = await sb
    .from("item_components")
    .insert({
      item_id: input.itemId,
      component_sku_id: skuId,
      component_item_id: subItemId,
      quantity: input.quantity,
      unit: normalizeUnit(input.unit),
      display_order: nextOrder,
      created_by: actor.user.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`addItemComponent insert failed: ${error.message}`);
  if (!inserted) throw new Error("addItemComponent insert returned no row");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "item_component.add",
    resourceTable: "item_components",
    resourceId: inserted.id,
    metadata: {
      item_id: input.itemId,
      kind: skuId !== null ? "sku" : "item",
      component_sku_id: skuId,
      component_item_id: subItemId,
      quantity: input.quantity,
      unit: normalizeUnit(input.unit),
    },
    ipAddress: null,
    userAgent: null,
  });

  return { id: inserted.id };
}

// ── Remove (GM+; hard-delete the edge, before-state in the audit row) ──────────
export async function removeItemComponent(actor: AuthContext, args: { id: string }): Promise<void> {
  requireLevel(actor, BOM_WRITE_MIN);
  const sb = getServiceRoleClient();

  const { data: before, error: bErr } = await sb
    .from("item_components")
    .select("id, item_id, component_sku_id, component_item_id, quantity, unit, display_order")
    .eq("id", args.id)
    .maybeSingle<DbComponentRow>();
  if (bErr) throw new Error(`removeItemComponent load failed: ${bErr.message}`);
  if (!before) throw new AdminItemComponentError(404, "component_not_found", "Component not found");

  const { error, count } = await sb
    .from("item_components")
    .delete({ count: "exact" })
    .eq("id", args.id);
  if (error) throw new Error(`removeItemComponent delete failed: ${error.message}`);
  if (count === 0) throw new AdminItemComponentError(404, "component_not_found", "Component not found");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "item_component.remove",
    resourceTable: "item_components",
    resourceId: args.id,
    metadata: {
      item_id: before.item_id,
      component_sku_id: before.component_sku_id,
      component_item_id: before.component_item_id,
      quantity: toNum(before.quantity),
      unit: before.unit,
    },
    ipAddress: null,
    userAgent: null,
  });
}
