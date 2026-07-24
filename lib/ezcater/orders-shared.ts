/**
 * Pure EZCater order normalizer (spec #2c). Shape source: the `orderByID`
 * example in ezCater's Public API User Guide (May 2024 v5) — fixture-fiction
 * rule: tests/fixtures/ezcater/orderByID.json mirrors that document, and the
 * FIRST LIVE payload gets a mandatory re-verification pass (unknowns flagged
 * in the spec: customer contact / delivery address fields are NOT in the
 * documented example — introspect at first-live).
 *
 * Money arrives as { currency, subunits } — subunits ARE cents for USD.
 * Malformed payload throws (whole processing poisons; the raw body is already
 * on the ledger).
 */

export interface EzcaterOrderItem {
  uuid: string | null;
  name: string;
  quantity: number;
  posItemId: string | null;
  menuItemSizeId: string | null;
  specialInstructions: string | null;
  customizations: Array<{ name: string; quantity: number | null; typeName: string | null }>;
}

export interface EzcaterOrder {
  orderNumber: string;
  orderType: string | null;
  headcount: number | null;
  eventTimestamp: string | null;
  handoffTime: string | null;
  catererUuid: string | null;
  totalDueCents: number | null;
  items: EzcaterOrderItem[];
}

interface Money { subunits?: unknown }

function cents(m: unknown): number | null {
  const s = (m as Money | null)?.subunits;
  return typeof s === "number" && Number.isFinite(s) ? Math.round(s) : null;
}

export function normalizeEzcaterOrder(json: unknown): EzcaterOrder {
  const root = json as { data?: { order?: Record<string, unknown> } } | null;
  const order = root?.data?.order ?? (json as Record<string, unknown> | null);
  if (order == null || typeof order !== "object") throw new Error("ezcater order: not an object");
  const o = order as Record<string, unknown>;
  if (typeof o.orderNumber !== "string" || o.orderNumber.length === 0) {
    throw new Error("ezcater order: missing orderNumber");
  }
  const event = (o.event ?? {}) as Record<string, unknown>;
  const caterer = (o.caterer ?? {}) as Record<string, unknown>;
  const totals = (o.totals ?? {}) as Record<string, unknown>;
  const cart = (o.catererCart ?? {}) as Record<string, unknown>;
  const rawItems = Array.isArray(cart.orderItems) ? (cart.orderItems as Array<Record<string, unknown>>) : [];

  const items: EzcaterOrderItem[] = rawItems.map((it) => {
    if (typeof it?.name !== "string" || it.name.length === 0) throw new Error("ezcater order: item without name");
    const qty = typeof it.quantity === "number" && Number.isFinite(it.quantity) ? it.quantity : null;
    if (qty == null) throw new Error(`ezcater order: item ${it.name} without quantity`);
    const rawCustom = Array.isArray(it.customizations) ? (it.customizations as Array<Record<string, unknown>>) : [];
    return {
      uuid: typeof it.uuid === "string" ? it.uuid : null,
      name: it.name,
      quantity: qty,
      posItemId: typeof it.posItemId === "string" ? it.posItemId : null,
      menuItemSizeId: typeof it.menuItemSizeId === "string" ? it.menuItemSizeId : null,
      specialInstructions: typeof it.specialInstructions === "string" && it.specialInstructions.length > 0 ? it.specialInstructions : null,
      customizations: rawCustom
        .filter((c) => typeof c?.name === "string" && (c.name as string).length > 0)
        .map((c) => ({
          name: c.name as string,
          quantity: typeof c.quantity === "number" ? c.quantity : null,
          typeName: typeof c.customizationTypeName === "string" ? c.customizationTypeName : null,
        })),
    };
  });

  return {
    orderNumber: o.orderNumber,
    orderType: typeof event.orderType === "string" ? event.orderType : null,
    headcount: typeof event.headcount === "number" && Number.isFinite(event.headcount) ? event.headcount : null,
    eventTimestamp: typeof event.timestamp === "string" ? event.timestamp : null,
    handoffTime: typeof event.catererHandoffFoodTime === "string" ? event.catererHandoffFoodTime : null,
    catererUuid: typeof caterer.uuid === "string" ? caterer.uuid : null,
    totalDueCents: cents(totals.customerTotalDue),
    items,
  };
}
