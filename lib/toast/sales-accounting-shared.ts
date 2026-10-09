/** Pure item-sales projection. No raw payload, names, notes or customer data survives here.
 * Prices and refundDetails on a parent INCLUDE its modifiers (Toast Orders contract).
 * Missing evidence is null; neither a custom refund nor inclusive tax is guessed.
 */
type Row = Record<string, unknown>;
const obj = (v: unknown): Row => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const rows = (v: unknown): Row[] => Array.isArray(v) ? v.map(obj) : [];
const id = (v: unknown): string | null => typeof obj(v).guid === "string" ? obj(v).guid as string : null;
type Cents = (v: unknown) => number | null;
type BusinessDate = (v: unknown) => string | null;
const plus = (a: number | null, b: number | null): number | null => a === null || b === null ? null : a + b;
const minus = (a: number | null, b: number | null): number | null => a === null || b === null ? null : a - b;
const excluded = (s: Row) => s.deferred === true || ["HOUSE_ACCOUNT_PAY_BALANCE", "TOAST_CARD_SELL", "TOAST_CARD_RELOAD"].includes(String(s.selectionType));

export interface CheckSalesAccounting {
  version: 1;
  gross_cents: number | null;
  discounts_comps_cents: number | null;
  voids_cents: number | null;
  service_charges_cents: number | null;
  pre_refund_cents: number | null;
}

export function projectCheckSales(check: Row, cents: Cents): CheckSalesAccounting {
  let services: number | null = 0;
  for (const s of rows(check.appliedServiceCharges)) {
    if (s.gratuity !== true) services = plus(services, cents(s.chargeAmount ?? s.amount));
  }
  let excludedNet: number | null = 0, excludedDiscount: number | null = 0, voids: number | null = 0;
  let discounts: number | null = 0, rootNet: number | null = 0;
  const addDiscounts = (s: Row) => {
    for (const d of rows(s.appliedDiscounts)) {
      // discountAmount can include tax. There is deliberately no fallback to it.
      discounts = plus(discounts, cents(d.nonTaxDiscountAmount));
    }
  };
  addDiscounts(check);
  const visit = (items: unknown, parentExcluded: boolean, parentVoided: boolean, root: boolean) => {
    for (const s of rows(items)) {
      if (s.deleted === true || s.selectionType === "SPECIAL_REQUEST") continue;
      const isExcluded = parentExcluded || excluded(s);
      const isVoid = parentVoided || s.voided === true;
      if (root && !isVoid) rootNet = plus(rootNet, cents(s.price));
      if (!isVoid) addDiscounts(s);
      // Subtree prices already contain modifiers and quantities: subtract/add only its head.
      if (isExcluded && !parentExcluded && !isVoid) {
        excludedNet = plus(excludedNet, cents(s.price));
        excludedDiscount = plus(excludedDiscount, minus(cents(s.preDiscountPrice), cents(s.price)));
      }
      if (isVoid && !parentVoided && !isExcluded) voids = plus(voids, cents(s.preDiscountPrice));
      visit(s.modifiers, isExcluded, isVoid, false);
    }
  };
  visit(check.selections, false, false, true);
  const items = minus(cents(check.amount), services);
  // A missing selections array, or inconsistent deleted/modifier pricing, cannot prove exactness.
  const reconciled = Array.isArray(check.selections) && items !== null && rootNet === items;
  const pre = reconciled ? minus(items, excludedNet) : null;
  discounts = minus(discounts, excludedDiscount);
  if (discounts !== null && discounts < 0) discounts = null;
  return { version: 1, gross_cents: plus(plus(pre, discounts), voids), discounts_comps_cents: discounts,
    voids_cents: voids, service_charges_cents: services, pre_refund_cents: pre };
}

/** One deterministic carrier per transaction, NOT a claim about individual tender allocation.
 * All payments in a transaction must reconcile, share a valid refund date and be eligible.
 * The minimum payment GUID carries its sales amount, the others carry zero. This is linear,
 * stable under payment reordering, and sums once in the refund-date SQL aggregation.
 */
export function projectSalesRefunds(check: Row, cents: Cents, date: BusinessDate): Map<string, number | null> {
  type Allocation = { total: number | null; sales: number | null };
  const allocations = new Map<string, Allocation>();
  const add = (detail: Row, sales: boolean, ambiguous: boolean) => {
    const tx = id(detail.refundTransaction);
    if (!tx) return;
    const a = allocations.get(tx) ?? { total: 0, sales: 0 };
    const amount = cents(detail.refundAmount), tax = cents(detail.taxRefundAmount);
    const valid = amount !== null && tax !== null && amount >= 0 && tax >= 0 && !ambiguous;
    a.total = plus(a.total, valid ? amount + tax : null);
    a.sales = plus(a.sales, valid ? sales ? amount : 0 : null);
    allocations.set(tx, a);
  };
  // Precompute heterogeneous subtrees once; never repeatedly scan descendants.
  const mixed = new WeakMap<Row, boolean>();
  const mark = (s: Row): boolean => {
    let has = excluded(s) || s.deleted === true || s.voided === true;
    for (const child of rows(s.modifiers)) has = mark(child) || has;
    mixed.set(s, has); return has;
  };
  const selections = rows(check.selections);
  for (const s of selections) mark(s);
  const covered = new Set<string>();
  const visit = (s: Row, eligible: boolean) => {
    const ownEligible = eligible && !excluded(s) && s.deleted !== true && s.voided !== true;
    const detail = obj(s.refundDetails), tx = id(detail.refundTransaction);
    const owns = tx !== null && !covered.has(tx);
    if (owns) {
      add(detail, ownEligible, ownEligible && mixed.get(s) === true);
      covered.add(tx);
    }
    for (const child of rows(s.modifiers)) visit(child, ownEligible);
    if (owns) covered.delete(tx!);
  };
  for (const s of selections) visit(s, true);
  for (const charge of rows(check.appliedServiceCharges)) {
    // Gratuity refunds belong to tipRefundAmount, outside the non-tip reconciliation.
    if (charge.gratuity !== true) add(obj(charge.refundDetails), false, false);
  }
  const result = new Map<string, number | null>();
  type Group = { payments: string[]; carrier: string; amount: number | null; date: string | null; valid: boolean };
  const groups = new Map<string, Group>();
  for (const p of rows(check.payments)) {
    if (typeof p.guid !== "string") continue;
    const refund = obj(p.refund), amount = cents(refund.refundAmount ?? refund.amount);
    result.set(p.guid, amount === 0 || p.refund == null ? 0 : null);
    if (p.refund == null) continue;
    const tx = id(refund.refundTransaction);
    if (!tx) continue;
    const d = date(refund.refundBusinessDate);
    const g = groups.get(tx) ?? { payments: [], carrier: p.guid, amount: 0, date: d, valid: true };
    g.payments.push(p.guid);
    if (p.guid < g.carrier) g.carrier = p.guid;
    g.amount = plus(g.amount, amount);
    g.valid = g.valid && d !== null && d === g.date && amount !== null && amount >= 0 && !["VOIDED", "DENIED"].includes(String(p.paymentStatus));
    groups.set(tx, g);
  }
  for (const [tx, g] of groups) {
    const a = allocations.get(tx);
    const exact = g.valid && a?.total !== null && a?.total === g.amount && a.sales !== null;
    const tipOnly = g.valid && g.amount === 0 && (!a || a.total === 0);
    for (const payment of g.payments) result.set(payment, exact ? payment === g.carrier ? a.sales : 0 : tipOnly ? 0 : null);
  }
  return result;
}
