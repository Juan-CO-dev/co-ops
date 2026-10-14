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

// ── Quote ↔ lead ↔ customer (B5 #34, #35) ─────────────────────────────────────────────

/**
 * Should saving a quote attach its customer to the linked lead? Only when the quote names
 * both a lead and a customer AND the lead has no customer yet: the link is null-only, so it
 * never moves a lead from one customer to another (B5 #34).
 */
export function shouldLinkLead(args: {
  pipelineId: string | null | undefined;
  customerId: string | null | undefined;
  leadCustomerId: string | null | undefined;
}): boolean {
  return !!args.pipelineId && !!args.customerId && args.leadCustomerId == null;
}

/** Who a saved quote is for — a whitelisted DTO (no phone, no address, no notes). */
export interface QuoteClientRef {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
}
export interface QuoteLeadRef {
  id: string;
  contactName: string;
  company: string | null;
  eventDate: string | null;
}
export interface QuoteParties {
  client: QuoteClientRef | null;
  lead: QuoteLeadRef | null;
}

/** Map the customer + lead rows to the quote page's DTO, picking fields by name only. */
export function mapQuoteParties(
  customer: { id: string; name: string; company: string | null; email: string | null } | null,
  lead: { id: string; contact_name: string; company: string | null; event_date: string | null } | null,
): QuoteParties {
  return {
    client: customer
      ? { id: customer.id, name: customer.name, company: customer.company, email: customer.email }
      : null,
    lead: lead
      ? { id: lead.id, contactName: lead.contact_name, company: lead.company, eventDate: lead.event_date }
      : null,
  };
}

// ── Builder helpers (B5 #37, #38, #39) — pure, client-safe ──────────────────────────────

export interface DraftLineLike {
  description: string;
  unitPrice: string;
  itemId: string | null;
  menuItemId: string | null;
  packageId: string | null;
}

/** A line nobody has touched: no description, no catalog reference, no price. */
export function isUntouchedBlankLine(l: DraftLineLike): boolean {
  return (
    l.description.trim() === "" &&
    l.itemId == null &&
    l.menuItemId == null &&
    l.packageId == null &&
    l.unitPrice.trim() === ""
  );
}

/**
 * Append lines from a package or menu pick, dropping the untouched blank lines first so a
 * new quote does not keep its empty starter line under the package (B5 #37). Appending
 * nothing returns `prev` unchanged.
 */
export function appendLines<T extends DraftLineLike>(prev: readonly T[], next: readonly T[]): T[] {
  if (next.length === 0) return [...prev];
  return [...prev.filter((l) => !isUntouchedBlankLine(l)), ...next];
}

export interface QuoteLeadOption {
  id: string;
  contactName: string;
  company: string | null;
  eventDate: string | null;
  headcount: number | null;
  locationId: string | null;
  locationName?: string | null;
}
export interface QuotePrefillForm {
  contactName: string;
  contactCompany: string;
  eventDate: string;
  headcount: string;
  locationId: string;
}

/**
 * Picking a lead fills the EMPTY name, company, date and headcount, and moves the shop to
 * the lead's shop when the builder offers it. A value the manager already typed is never
 * overwritten (B5 #38).
 */
export function prefillFromLead(
  form: QuotePrefillForm,
  lead: QuoteLeadOption,
  locationIds: readonly string[],
): QuotePrefillForm {
  return {
    contactName: form.contactName.trim() === "" ? lead.contactName : form.contactName,
    contactCompany: form.contactCompany.trim() === "" ? lead.company ?? "" : form.contactCompany,
    eventDate: form.eventDate === "" ? lead.eventDate ?? "" : form.eventDate,
    headcount: form.headcount === "" && lead.headcount != null ? String(lead.headcount) : form.headcount,
    locationId:
      lead.locationId != null && locationIds.includes(lead.locationId) ? lead.locationId : form.locationId,
  };
}

/** "Contact · Company · {date} · {shop}" so two leads with one name can be told apart (B5 #39). */
export function leadOptionLabel(lead: QuoteLeadOption, formatDate: (yyyymmdd: string) => string): string {
  return [
    lead.contactName,
    lead.company,
    lead.eventDate ? formatDate(lead.eventDate) : null,
    lead.locationName,
  ]
    .filter((p): p is string => typeof p === "string" && p.trim() !== "")
    .join(" · ");
}
