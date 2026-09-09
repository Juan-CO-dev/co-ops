/**
 * Quotes — PURE charge-stack math (no I/O, no server imports; unit-testable and
 * client-safe). Split from quotes.ts on 2026-07-23: the `server-only` guard on
 * lib/supabase-server.ts (PR #165) correctly refused to let the vitest spine
 * (PR #166) import the mixed quotes module — pure money math now lives here.
 * quotes.ts re-exports, so server consumers are unchanged.
 */

export interface ChargeRates {
  taxRateBps: number;
  gratuityBps: number;
  serviceChargeBps: number;
  depositPctBps: number;
  taxOnDelivery: boolean;
  taxOnGratuity: boolean;
}
export interface ChargeStack {
  subtotalCents: number;
  deliveryFeeCents: number;
  serviceChargeCents: number;
  gratuityCents: number;
  taxCents: number;
  totalCents: number;
  depositCents: number;
}

/** basis-points of an integer-cents base, rounded half-up to the nearest cent. Defense-in-depth:
 *  a non-finite or negative rate/base contributes 0 (never a negative or NaN charge) — the charge
 *  stack must never go negative regardless of the rate inputs (see A-H1). Valid rates are >=0, so
 *  this is a no-op for legitimate inputs. */
function bpsOf(baseCents: number, bps: number): number {
  if (!Number.isFinite(baseCents) || !Number.isFinite(bps) || bps <= 0 || baseCents <= 0) return 0;
  return Math.max(0, Math.round((baseCents * bps) / 10000));
}
/** A single line's frozen total: quantity x unit price, rounded to the nearest cent. */
export function lineTotalCents(quantity: number, unitPriceCents: number): number {
  return Math.round(quantity * unitPriceCents);
}

/**
 * The one place quote money is computed. `lineTotals` are the per-line frozen totals
 * (already quantity x unit). Returns the full breakdown; the caller snapshots it + `rates`
 * onto the quote row so the math is immutable regardless of later pricing changes.
 */
export function computeChargeStack(
  lineTotals: number[],
  deliveryFeeCents: number,
  rates: ChargeRates,
): ChargeStack {
  const subtotalCents = lineTotals.reduce((s, n) => s + n, 0);
  const serviceChargeCents = bpsOf(subtotalCents, rates.serviceChargeBps);
  const gratuityCents = bpsOf(subtotalCents, rates.gratuityBps);
  const taxBase =
    subtotalCents +
    serviceChargeCents + // service charge is always in the tax base
    (rates.taxOnDelivery ? deliveryFeeCents : 0) +
    (rates.taxOnGratuity ? gratuityCents : 0);
  const taxCents = bpsOf(taxBase, rates.taxRateBps);
  const totalCents =
    subtotalCents + deliveryFeeCents + serviceChargeCents + gratuityCents + taxCents;
  const depositCents = bpsOf(totalCents, rates.depositPctBps);
  return {
    subtotalCents,
    deliveryFeeCents,
    serviceChargeCents,
    gratuityCents,
    taxCents,
    totalCents,
    depositCents,
  };
}

// ── Line references: catalog item vs menu item ─────────────────────────────────────────
// A quote line points at ONE of: an `items` row (`itemId`) or a `menu_items` row (`menuItemId`).
// `catering_quote_items.item_id` is an FK to `items`, `menu_item_id` to `menu_items` — a menu-item
// id written into `item_id` is a 23505-class FK failure AFTER the quote header has been inserted
// (the guide-walk sim of 2026-09-08 reproduced it: "Case of Assorted Chips (24)" is a menu item,
// and the staff builder put its id in `itemId` for every à-la-carte pick). This pure step lets the
// server put a reference on the side it actually belongs to when the ids are known, and name the
// line when they are not — before any write.

export interface QuoteLineRefLike {
  itemId: string | null;
  menuItemId: string | null;
}

export interface QuoteLineRefKnown {
  /** ids that exist in `items` */
  itemIds: ReadonlySet<string>;
  /** ids that exist in `menu_items` */
  menuItemIds: ReadonlySet<string>;
}

export interface QuoteLineRefUnknown {
  /** 0-based line index */
  index: number;
  field: "itemId" | "menuItemId";
  id: string;
}

export interface QuoteLineRefResult<T extends QuoteLineRefLike> {
  lines: T[];
  /** references moved from one side to the other */
  moved: number;
  /** references found on neither side — the caller refuses the write and names the line */
  unknown: QuoteLineRefUnknown[];
}

/**
 * Put each line's reference on the side it exists on. A line whose reference is already on the
 * right side is returned as the SAME object (identity preserved); a moved line is a shallow copy.
 * Lines with a reference on neither side are reported, never dropped and never guessed.
 */
export function reclassifyQuoteLineRefs<T extends QuoteLineRefLike>(
  lines: readonly T[],
  known: QuoteLineRefKnown,
): QuoteLineRefResult<T> {
  const out: T[] = [];
  const unknown: QuoteLineRefUnknown[] = [];
  let moved = 0;
  lines.forEach((l, index) => {
    let itemId = l.itemId;
    let menuItemId = l.menuItemId;
    if (l.itemId != null && !known.itemIds.has(l.itemId)) {
      if (known.menuItemIds.has(l.itemId)) {
        menuItemId = l.itemId;
        itemId = null;
        moved += 1;
      } else {
        unknown.push({ index, field: "itemId", id: l.itemId });
      }
    }
    if (l.menuItemId != null && !known.menuItemIds.has(l.menuItemId)) {
      if (known.itemIds.has(l.menuItemId)) {
        itemId = l.menuItemId;
        menuItemId = null;
        moved += 1;
      } else {
        unknown.push({ index, field: "menuItemId", id: l.menuItemId });
      }
    }
    out.push(itemId === l.itemId && menuItemId === l.menuItemId ? l : { ...l, itemId, menuItemId });
  });
  return { lines: out, moved, unknown };
}
