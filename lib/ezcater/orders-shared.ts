/**
 * Pure EZCater order normalizer (spec #2c). Shape source: the `orderByID`
 * example in ezCater's Public API User Guide (May 2024 v5) — fixture-fiction
 * rule: tests/fixtures/ezcater/orderByID.json mirrors that document, and the
 * FIRST LIVE payload gets a mandatory re-verification pass (unknowns flagged
 * in the spec: customer contact / delivery address fields are NOT in the
 * documented example — introspect at first-live).
 *
 * Money arrives as { currency, subunits } — subunits ARE cents for USD.
 * Malformed payload throws; callers persist only a sanitized error code.
 */

export interface EzcaterOrderItem {
  uuid: string | null;
  name: string;
  quantity: number;
  posItemId: string | null;
  menuItemSizeId: string | null;
  specialInstructions: string | null;
  noteToCaterer: string | null;
  totalCents: number | null;
  unitPriceCents: number | null;
  customizations: Array<{ name: string; quantity: number | null; typeName: string | null }>;
}

export interface EzcaterOrder {
  enrichmentAvailable: boolean;
  enrichmentFields: string[];
  orderNumber: string;
  orderType: string | null;
  headcount: number | null;
  eventTimestamp: string | null;
  handoffTime: string | null;
  catererUuid: string | null;
  totalDueCents: number | null;
  eventDate: string | null;
  status: string | null;
  subtotalCents: number | null;
  taxCents: number | null;
  tipCents: number | null;
  feesCents: number | null;
  discountsCents: number | null;
  paymentStatus: string | null;
  contact: { name: string | null; email: string | null; phone: string | null; address: string | null } | null;
  items: EzcaterOrderItem[];
}

interface Money { subunits?: unknown }

const eventDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});

/** Provider instants must carry an offset; date-only values are not instants. */
export function ezcaterEventDate(timestamp: string | null | undefined): string | null {
  if (!timestamp || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(timestamp)) return null;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = eventDateFormatter.formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function timestamp(value: unknown): string | null {
  const candidate = text(value);
  return candidate && ezcaterEventDate(candidate) ? candidate : null;
}

function cents(m: unknown): number | null {
  const s = (m as Money | null)?.subunits;
  return typeof s === "number" && Number.isFinite(s) ? Math.round(s) : null;
}

/** An empty category is zero; a missing category or amount is unknown, not zero. */
function sumCategoryCosts(...categories: unknown[]): number | null {
  let total = 0;
  for (const category of categories) {
    if (!Array.isArray(category)) return null;
    for (const entry of category) {
      if (!entry || typeof entry !== "object") return null;
      const cost = (entry as { cost?: unknown }).cost;
      if (!cost || typeof cost !== "object") return null;
      const money = cost as { subunits?: unknown; currency?: unknown };
      if (money.currency !== "USD" || typeof money.subunits !== "number" || !Number.isSafeInteger(money.subunits)) return null;
      total += money.subunits;
      if (!Number.isSafeInteger(total)) return null;
    }
  }
  return total;
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
    if (qty == null || qty < 0) throw new Error("ezcater order: invalid item quantity");
    const rawCustom = Array.isArray(it.customizations) ? (it.customizations as Array<Record<string, unknown>>) : [];
    return {
      uuid: typeof it.uuid === "string" ? it.uuid : null,
      name: it.name,
      quantity: qty,
      totalCents: cents(it.totalInSubunits),
      // Unit prices are provider facts; a line total may include options/discounts.
      unitPriceCents: cents(it.unitPrice),
      noteToCaterer: text(it.noteToCaterer),
      posItemId: typeof it.posItemId === "string" ? it.posItemId : null,
      menuItemSizeId: typeof it.menuItemSizeId === "string" ? it.menuItemSizeId : null,
      specialInstructions: typeof it.specialInstructions === "string" && it.specialInstructions.length > 0 ? it.specialInstructions : null,
      customizations: rawCustom
        .filter((c) => typeof c?.name === "string" && (c.name as string).length > 0)
        .map((c) => ({
          name: c.name as string,
          quantity: typeof c.quantity === "number" && Number.isFinite(c.quantity) ? c.quantity : null,
          typeName: typeof c.customizationTypeName === "string" ? c.customizationTypeName : null,
        })),
    };
  });

  const contact = o.contact && typeof o.contact === "object" ? o.contact as Record<string, unknown> : null;
  const eventContact = event.contact && typeof event.contact === "object" ? event.contact as Record<string, unknown> : null;
  const customer = o.orderCustomer && typeof o.orderCustomer === "object" ? o.orderCustomer as Record<string, unknown> : null;
  const lifecycle = o.lifecycle && typeof o.lifecycle === "object" ? o.lifecycle as Record<string, unknown> : null;
  const address = event.address && typeof event.address === "object" ? event.address as Record<string, unknown> : null;
  const addressText = address ? [text(address.street) ?? text(address.street1), text(address.street2), text(address.city), text(address.state), text(address.zip) ?? text(address.postalCode)].filter(Boolean).join(", ") || null : null;
  const contactPresent = contact || eventContact || customer || address || text(event.contactName) || text(event.contactPhone) || text(event.contactEmail);
  return {
    enrichmentAvailable: false,
    enrichmentFields: [],
    orderNumber: o.orderNumber,
    orderType: typeof event.orderType === "string" ? event.orderType : null,
    headcount: typeof event.headcount === "number" && Number.isFinite(event.headcount) ? event.headcount : null,
    eventTimestamp: timestamp(event.timestamp),
    handoffTime: timestamp(event.catererHandoffFoodTime),
    catererUuid: typeof caterer.uuid === "string" ? caterer.uuid : null,
    totalDueCents: cents(totals.customerTotalDue),
    eventDate: ezcaterEventDate(text(event.timestamp)),
    status: text(lifecycle?.orderIsCurrently) ?? text(o.status),
    subtotalCents: cents(totals.subTotal),
    taxCents: cents(totals.salesTax),
    tipCents: cents(totals.tip),
    feesCents: cents(totals.fees) ?? sumCategoryCosts(cart.enrichmentDeliveryFees, cart.enrichmentMiscFees),
    discountsCents: cents(totals.discounts) ?? sumCategoryCosts(cart.enrichmentDiscounts),
    paymentStatus: text(o.paymentStatus),
    contact: contactPresent ? {
      name: text(eventContact?.name) ?? text(eventContact?.fullName) ?? text(event.contactName) ?? text(contact?.name) ?? text(customer?.fullName),
      email: text(eventContact?.email) ?? text(event.contactEmail) ?? text(contact?.email) ?? text(customer?.email),
      phone: text(eventContact?.phone) ?? text(eventContact?.phoneNumber) ?? text(event.contactPhone) ?? text(contact?.phone) ?? text(customer?.phone),
      address: addressText ?? text(contact?.address),
    } : null,
    items,
  };
}
