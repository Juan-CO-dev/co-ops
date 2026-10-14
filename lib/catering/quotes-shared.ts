/**
 * Quotes — PURE charge-stack math (no I/O, no server imports; unit-testable and
 * client-safe). Split from quotes.ts on 2026-07-23: the `server-only` guard on
 * lib/supabase-server.ts (PR #165) correctly refused to let the vitest spine
 * (PR #166) import the mixed quotes module — pure money math now lives here.
 * quotes.ts re-exports, so server consumers are unchanged.
 */
import { isQuoteLineKind, type QuoteLineKind } from "@/lib/catering/prep-demand-shared";
export type { QuoteLineKind };

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

// ── Line kind (B7c, migration 0251) ───────────────────────────────────────────────────

export type LineKindResult =
  | { ok: true; lineKind: QuoteLineKind | null; componentsListed: boolean | null }
  /** `outdated`: a package line with no kind — a page loaded before the B7c deploy; the user reloads. */
  | { ok: false; reason: "outdated" | "invalid"; message: string };

/**
 * What a saved line stores in `line_kind` / `components_listed`, checked against its
 * references (the same shape the 0251/0252 CHECKs enforce, so a bad payload is a named error before
 * the quote header is written, never a constraint 500 after it):
 *   · a line with no package id carries no kind (NULL);
 *   · every line WITH a package id must say its kind — a kind-less one is refused as
 *     `outdated` (409 `quote_lines_outdated`: reload the page). It is never stamped by guessing;
 *   · package_header / package_pick — a package id and no item/menu reference;
 *     package_component — a package id and a reference;
 *   · `componentsListed` is kept on a header only (absent → false: the whole package).
 */
export function resolveQuoteLineKind(l: {
  itemId: string | null;
  menuItemId: string | null;
  packageId: string | null;
  lineKind?: unknown;
  componentsListed?: unknown;
}): LineKindResult {
  const hasRef = l.itemId != null || l.menuItemId != null;
  if (l.lineKind == null) {
    if (l.packageId != null) return { ok: false, reason: "outdated", message: "a package line without its line kind (the page is out of date)" };
    return { ok: true, lineKind: null, componentsListed: null };
  }
  if (!isQuoteLineKind(l.lineKind)) return { ok: false, reason: "invalid", message: "unknown line kind" };
  if (l.packageId == null) return { ok: false, reason: "invalid", message: `${l.lineKind} needs a package` };
  if (l.lineKind === "package_component" && !hasRef) return { ok: false, reason: "invalid", message: "a package component needs an item" };
  if (l.lineKind !== "package_component" && hasRef) return { ok: false, reason: "invalid", message: `${l.lineKind} cannot name an item` };
  return {
    ok: true,
    lineKind: l.lineKind,
    componentsListed: l.lineKind === "package_header" ? l.componentsListed === true : null,
  };
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
  /**
   * The quote HAS a client, but it is another shop's customer the viewer may not read (Juan,
   * option b, 2026-10-14): the page says so without showing any of its saved contact data.
   */
  clientHidden: boolean;
}

/** Map the customer + lead rows to the quote page's DTO, picking fields by name only. */
export function mapQuoteParties(
  customer: { id: string; name: string; company: string | null; email: string | null } | null,
  lead: { id: string; contact_name: string; company: string | null; event_date: string | null } | null,
  clientHidden = false,
): QuoteParties {
  return {
    clientHidden: customer ? false : clientHidden,
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

// ── Package expansion (D-45) — pure, client-safe ────────────────────────────────────────

/** The fields of a catering package the builder expands into quote lines. */
export interface ExpandablePackage {
  id: string;
  labelEn: string;
  /** `per_head` | `per_platter` | `fixed` (0115 CHECK). */
  pricingMode: string;
  priceCents: number;
  items: ReadonlyArray<{
    itemId: string | null;
    menuItemId: string | null;
    label: string;
    quantity: number;
    unitPriceCents: number;
  }>;
}
/** One expanded line, in the builder's string form (quantity and dollars as typed text). */
export interface ExpandedPackageLine {
  description: string;
  quantity: string;
  unitPrice: string;
  itemId: string | null;
  menuItemId: string | null;
  packageId: string | null;
  /** What part of the package this line is (migration 0251). */
  lineKind: QuoteLineKind;
  /** Header only: true when the package's composition is listed as its own lines. */
  componentsListed: boolean | null;
}

/**
 * How many people a package line is for (D-45, Juan 2026-10-13): a PER-HEAD package is priced
 * per person, so its lines default to the quote's headcount. A per-platter or fixed package
 * keeps its own count (multiplier 1), and so does a per-head package while the headcount is
 * empty or not a whole number above zero.
 */
export function packageHeadcountMultiplier(pricingMode: string, headcount: string): number {
  if (pricingMode !== "per_head") return 1;
  const raw = headcount.trim();
  if (raw === "") return 1;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

const centsToDollarText = (c: number): string => (c ? (c / 100).toString() : "");
const scaleQty = (q: number, n: number): string => String(Math.round(q * n * 1000) / 1000);

/**
 * Expand a package into editable quote lines (the staff builder's "Add package").
 *
 * - Each composition line keeps its own quantity × the headcount multiplier (1 unless the
 *   package is per-head and a headcount is set — D-45). A fixed-count platter keeps its count.
 * - A package with no composition becomes one priced line for the package itself.
 * - A package whose composition is all unpriced carries the package price on ONE header line
 *   (the guide-walk $115 × 8 fix). That line is per person for a per-head package, so its Qty
 *   is the headcount too.
 *
 * ONE REPRESENTATION, THREE KINDS OF LINE, EACH SAYING WHAT IT IS (`line_kind`, migration
 * 0251) — what Prep Demand (`resolveDemandFromLines`) counts:
 *   · package_header — package id, no item/menu reference. Qty = package units. With
 *     `componentsListed = true` (the composition follows as its own lines) Prep Demand expands
 *     ONLY its choice slots (→ "needs a pick"), even after every component is removed; with no
 *     composition it stands for the whole package.
 *   · package_component — a concrete item/menu reference (+ the package id). Counted at its OWN
 *     Qty, so editing it moves the demand, and it still counts if the header is removed.
 *   · package_pick — a "Choose your sub" slot (package id, no reference). Display only while a
 *     header of the package is on the quote (the header reserves the slot, exactly once); if
 *     every header of the package is removed it counts its own Qty.
 * A header is emitted whenever the package has no composition, is priced only as a whole,
 * or has a pick slot (then at $0 when the components carry the prices), so a slot always
 * has a header to be reserved through. Prices and quantities are exactly as before 0251.
 */
export function expandPackageLines(pkg: ExpandablePackage, headcount: string): ExpandedPackageLine[] {
  const n = packageHeadcountMultiplier(pkg.pricingMode, headcount);
  const header = (priceCents: number): ExpandedPackageLine => ({
    description: pkg.labelEn,
    quantity: String(n),
    unitPrice: (priceCents / 100).toString(),
    itemId: null,
    menuItemId: null,
    packageId: pkg.id,
    lineKind: "package_header",
    componentsListed: pkg.items.length > 0,
  });
  const isPick = (pi: ExpandablePackage["items"][number]) => pi.itemId == null && pi.menuItemId == null;
  const lines: ExpandedPackageLine[] = pkg.items.map((pi) => ({
    description: pi.label,
    quantity: scaleQty(pi.quantity, n),
    unitPrice: centsToDollarText(pi.unitPriceCents),
    itemId: pi.itemId,
    menuItemId: pi.menuItemId,
    packageId: pkg.id,
    lineKind: isPick(pi) ? "package_pick" : "package_component",
    componentsListed: null,
  }));
  if (lines.length === 0) return [header(pkg.priceCents)];
  const pricedAsWhole = pkg.priceCents > 0 && lines.every((l) => l.unitPrice === "");
  if (pricedAsWhole) return [header(pkg.priceCents), ...lines];
  if (pkg.items.some(isPick)) return [header(0), ...lines];
  return lines;
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
