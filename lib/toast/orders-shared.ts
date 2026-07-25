/**
 * Pure Toast orders normalizer (read-track 2). CLIENT-SAFE half per the house
 * *-shared pattern; server fetch lives in lib/toast/orders.ts.
 *
 * Real Toast `GET /orders/v2/ordersBulk` contract: a top-level ARRAY of order
 * objects; each order carries `checks[]`; checks carry `selections[]`;
 * selections carry `item.guid`, `displayName`, `quantity`, `price`, `voided`,
 * and NESTED `modifiers[]` (themselves selections — walked recursively with
 * `parentSelectionGuid` threaded). Void-ness propagates: a selection is void
 * when itself, its check, or its order is voided. diningOption rides on the
 * ORDER as a bare ToastReference `{guid, entityType}` — NO name (PR #174
 * review finding #1; names resolve via the config API at ingest time).
 *
 * Malformed payload throws — whole pull poisons, never partial (house rule;
 * PR #173 review finding #1 taught us to pin the REAL shape in fixture+tests).
 *
 * FIRST-LIVE CORRECTION (2026-07-24, real Capitol Hill payload): selections of
 * selectionType SPECIAL_REQUEST are free-text customer notes with `item: null`
 * (e.g. "All vegetarian", $0). They can never resolve through the crosswalk
 * and carry no depletion — SKIPPED (with their modifier subtree), not poison.
 * Poison remains for structurally broken lines (no selection guid; an item
 * present but quantity missing).
 */

export interface ToastSaleLine {
  checkGuid: string;
  selectionGuid: string;
  parentSelectionGuid: string | null;
  itemGuid: string;
  displayName: string;
  quantity: number;
  priceCents: number | null;
  voided: boolean;
  diningOptionGuid: string | null;
}

interface RawSelection {
  guid?: unknown; item?: { guid?: unknown } | null; displayName?: unknown;
  quantity?: unknown; price?: unknown; voided?: unknown; modifiers?: unknown;
}
interface RawCheck { guid?: unknown; voided?: unknown; selections?: unknown }
interface RawOrder { guid?: unknown; voided?: unknown; diningOption?: { guid?: unknown } | null; checks?: unknown }

export function flattenToastOrders(json: unknown): ToastSaleLine[] {
  if (!Array.isArray(json)) throw new Error("toast orders payload: expected an array of orders");
  const out: ToastSaleLine[] = [];

  const walkSelection = (
    sel: RawSelection,
    ctx: { checkGuid: string; dining: string | null; ancestorVoided: boolean; parent: string | null },
  ): void => {
    if (typeof sel?.guid !== "string" || sel.guid.length === 0) {
      throw new Error("toast orders payload: selection without guid");
    }
    const itemGuid = sel.item?.guid;
    if (typeof itemGuid !== "string" || itemGuid.length === 0) {
      // SPECIAL_REQUEST / note lines carry item:null — unmappable by design; skip.
      return;
    }
    const quantity = typeof sel.quantity === "number" && Number.isFinite(sel.quantity) ? sel.quantity : null;
    if (quantity == null) throw new Error(`toast orders payload: selection ${sel.guid} without quantity`);
    const voided = ctx.ancestorVoided || sel.voided === true;
    const price = typeof sel.price === "number" && Number.isFinite(sel.price) ? sel.price : null;
    out.push({
      checkGuid: ctx.checkGuid,
      selectionGuid: sel.guid,
      parentSelectionGuid: ctx.parent,
      itemGuid,
      displayName: typeof sel.displayName === "string" && sel.displayName.length > 0 ? sel.displayName : itemGuid,
      quantity,
      priceCents: price != null ? Math.round(price * 100) : null,
      voided,
      diningOptionGuid: ctx.dining,
    });
    const mods = Array.isArray(sel.modifiers) ? (sel.modifiers as RawSelection[]) : [];
    for (const m of mods) {
      walkSelection(m, { ...ctx, ancestorVoided: voided, parent: sel.guid });
    }
  };

  for (const order of json as RawOrder[]) {
    const orderVoided = order?.voided === true;
    const dining = typeof order?.diningOption?.guid === "string" ? order.diningOption.guid : null;
    const checks = Array.isArray(order?.checks) ? (order.checks as RawCheck[]) : [];
    for (const check of checks) {
      if (typeof check?.guid !== "string" || check.guid.length === 0) {
        throw new Error("toast orders payload: check without guid");
      }
      const checkVoided = orderVoided || check.voided === true;
      const sels = Array.isArray(check.selections) ? (check.selections as RawSelection[]) : [];
      for (const sel of sels) {
        walkSelection(sel, { checkGuid: check.guid, dining, ancestorVoided: checkVoided, parent: null });
      }
    }
  }
  return out;
}

/** Stored-ledger comparison surface for the version diff (append new version when changed). */
export interface StoredSelectionState {
  quantity: number;
  voided: boolean;
  priceCents: number | null;
  itemName: string;
}

export function selectionChanged(prev: StoredSelectionState, next: ToastSaleLine): boolean {
  return (
    prev.quantity !== next.quantity ||
    prev.voided !== next.voided ||
    prev.priceCents !== next.priceCents ||
    prev.itemName !== next.displayName
  );
}
