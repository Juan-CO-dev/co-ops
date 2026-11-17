/** Item 2 PR 2b: the pure ORDER fact builder. Zero I/O, no env, no clock.
 * Plan: C:\co\audit\item2-plan-r3-orders.md (§2, §3) with Astra r3's two P2s folded in:
 *  - a zero-check order is a valid order: it is in the MANIFEST (`orders`), separate from fact rows;
 *  - line money comes ONLY from the snapshot's own inline line-price fields (TOAST_LINE_PRICES), else
 *    'not covered' (null), never 0. Phase 2's attachment table plugs in through `LinePriceSource`
 *    and a FACT_BUILDER_VERSION bump, which changes every day's fingerprint (0337).
 * Facts hold only what capture recorded: raw keys and flags. Classification (sales_report_class, the
 * ezCater link, the channel map) is applied when reports READ, so a map or link edit never makes a fact
 * wrong. The revenue-head rule and the line sum are REUSED from lib/toast/line-prices-shared. */
import { isRevenueHead, lineRevenue, type CheckLinePrices, type LineMeasure, type LineRevenue } from "@/lib/toast/line-prices-shared";
import { etCalendarDate, etWallMinutesInstant } from "@/lib/operational-day";

/** Bumped whenever a stored fact would change for the same source; a bump rebuilds every day. */
export const FACT_BUILDER_VERSION = "orders-v1";

type Row = Record<string, unknown>;
const obj = (v: unknown): Row => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const int = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) ? n : null;
};
const str = (v: unknown): string | null => typeof v === "string" && v !== "" ? v : null;
const bool = (v: unknown): boolean => v === true;

export interface SourceOrder {
  snapshot_id: string; order_guid: string; opened_at: string | null; paid_at: string | null; closed_at: string | null;
  promised_at: string | null; source: string | null; revenue_center_guid: string | null; dining_option_guid: string | null;
  server_guid: string | null; deleted: boolean; voided: boolean; excess_food: boolean;
  third_party_provider_guid: string | null; third_party_provider_name: string | null; selection_units: unknown[];
}
export interface SourceCheck {
  snapshot_id: string; check_guid: string; amount_cents: number | string | null; tax_cents: number | string | null;
  total_cents: number | string | null; voided: boolean; deleted: boolean; accounting: unknown;
}
export interface SourceDiscount { snapshot_id: string; check_guid: string; selection_guid: string | null; amount_cents: number | string | null }
export interface SourcePayment {
  snapshot_id: string; check_guid: string; payment_guid: string; payment_status: string | null; refund_status: string | null;
  refund_amount_cents: number | string | null; refund_tip_cents: number | string | null; refund_business_date: string | null;
  sales_refund_cents: number | string | null;
}
/** One shop-day as the pointers publish it: exactly the latest snapshot of every order of the day. */
export interface OrderDaySource {
  locationId: string; businessDate: string;
  orders: SourceOrder[]; checks: SourceCheck[]; discounts: SourceDiscount[]; payments: SourcePayment[];
}

export interface FactQuarter { quarter_start_at: string | null; wall_quarter: number | null; fold: number | null; et_date: string | null }
export interface FactOrderRow { order_guid: string; snapshot_id: string; check_count: number }
export interface FactCheckRow {
  order_guid: string; check_guid: string; snapshot_id: string;
  opened_at: string | null; paid_at: string | null; closed_at: string | null; promised_at: string | null;
  opened_quarter_start_at: string | null; opened_wall_quarter: number | null; opened_fold: number | null; opened_et_date: string | null;
  promised_quarter_start_at: string | null; promised_wall_quarter: number | null; promised_fold: number | null; promised_et_date: string | null;
  order_voided: boolean; order_deleted: boolean; check_voided: boolean; check_deleted: boolean; excess_food: boolean;
  dining_option_guid: string | null; server_guid: string | null; source: string | null; revenue_center_guid: string | null;
  third_party_provider_guid: string | null; third_party_provider_name: string | null;
  amount_cents: number | null; tax_cents: number | null; total_cents: number | null;
  gross_cents: number | null; discounts_comps_cents: number | null; voids_cents: number | null;
  service_charges_cents: number | null; pre_refund_cents: number | null;
  line_price_state: "inline" | "unpriced"; line_net_cents: number | null;
  source_complete: boolean | null; net_complete: boolean | null; gross_complete: boolean | null; receipt_line_complete: boolean | null;
}
export interface FactLineRow {
  order_guid: string; check_guid: string; selection_guid: string; parent_selection_guid: string | null; is_head: boolean;
  voided: boolean; deleted: boolean; toast_item_guid: string; quantity: number;
  price_state: "inline" | "not_covered"; net_cents: number | null; gross_cents: number | null; receipt_line_cents: number | null;
  tax_cents: number | null; discount_cents: number | null; tax_inclusion: string | null; selection_type: string | null; deferred: boolean | null;
}
export interface FactRefundRow {
  order_guid: string; check_guid: string; payment_guid: string; snapshot_id: string;
  refund_business_date: string | null; refund_status: string | null; payment_status: string | null;
  refund_cents: number | null; refund_tip_cents: number | null; sales_refund_cents: number | null; check_accounting_present: boolean;
  order_voided: boolean; order_deleted: boolean; check_voided: boolean; check_deleted: boolean; excess_food: boolean;
  dining_option_guid: string | null;
}
export interface OrderDayPayload { orders: FactOrderRow[]; checks: FactCheckRow[]; lines: FactLineRow[]; refunds: FactRefundRow[] }

const QUARTER_MS = 15 * 60_000;
const ET_PARTS = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" });

/** Plan r3 §2 item 5: the quarter an instant falls in, its ET wall quarter (0–95) and fold (1 = the
 * repeated fall-back hour). ET offsets are whole hours, so the UTC 15-minute floor IS the wall-quarter
 * start. The first occurrence of a wall time is etWallMinutesInstant's answer; any other is fold 1. */
export function factQuarter(iso: string | null): FactQuarter {
  if (!iso) return { quarter_start_at: null, wall_quarter: null, fold: null, et_date: null };
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error("fact_invalid_instant");
  const start = new Date(Math.floor(ms / QUARTER_MS) * QUARTER_MS);
  const p = Object.fromEntries(ET_PARTS.formatToParts(start).map(({ type, value }) => [type, value]));
  const minutes = (Number(p.hour) % 24) * 60 + Number(p.minute);
  const et_date = etCalendarDate(start.toISOString());
  const first = etWallMinutesInstant(et_date, minutes).getTime();
  return { quarter_start_at: start.toISOString(), wall_quarter: Math.floor(minutes / 15), fold: first === start.getTime() ? 0 : 1, et_date };
}

/** The payment-level half of 0239/0247's refund predicate: dated refunds, plus undated ones with refund
 * evidence (or an unknown sales refund on an accounted check). Classification is NOT applied here. */
export function refundKept(p: Pick<SourcePayment, "refund_business_date" | "sales_refund_cents" | "refund_amount_cents" | "refund_status">,
  checkAccounted: boolean): boolean {
  if (p.refund_business_date) return true;
  const sales = int(p.sales_refund_cents);
  if (sales === 0) return false;
  const evidence = int(p.refund_amount_cents) !== null || p.refund_status === "PARTIAL" || p.refund_status === "FULL";
  return evidence || (sales === null && checkAccounted);
}

const byKey = <T>(key: (t: T) => string) => (a: T, b: T) => { const x = key(a), y = key(b); return x < y ? -1 : x > y ? 1 : 0; };

function inlineLinePrices(accounting: unknown): CheckLinePrices | null {
  const lp = obj(obj(accounting).line_prices);
  return lp.v === 1 ? lp as unknown as CheckLinePrices : null;
}

export function buildOrderDay(src: OrderDaySource): OrderDayPayload {
  const orderBySnapshot = new Map<string, SourceOrder>();
  for (const o of src.orders) {
    if (orderBySnapshot.has(o.snapshot_id)) throw new Error("fact_source_duplicate_snapshot");
    orderBySnapshot.set(o.snapshot_id, o);
  }
  const owner = (snapshot: string): SourceOrder => {
    const o = orderBySnapshot.get(snapshot);
    if (!o) throw new Error("fact_source_orphan");
    return o;
  };
  const checkCount = new Map<string, number>();
  const accounted = new Map<string, boolean>();
  const checks: FactCheckRow[] = src.checks.map((c) => {
    const o = owner(c.snapshot_id);
    checkCount.set(c.snapshot_id, (checkCount.get(c.snapshot_id) ?? 0) + 1);
    const acc = c.accounting == null ? null : obj(c.accounting);
    accounted.set(`${c.snapshot_id}|${c.check_guid}`, acc !== null);
    const lp = inlineLinePrices(acc);
    const opened = factQuarter(o.opened_at), promised = factQuarter(o.promised_at);
    return {
      order_guid: o.order_guid, check_guid: c.check_guid, snapshot_id: c.snapshot_id,
      opened_at: o.opened_at, paid_at: o.paid_at, closed_at: o.closed_at, promised_at: o.promised_at,
      opened_quarter_start_at: opened.quarter_start_at, opened_wall_quarter: opened.wall_quarter, opened_fold: opened.fold, opened_et_date: opened.et_date,
      promised_quarter_start_at: promised.quarter_start_at, promised_wall_quarter: promised.wall_quarter, promised_fold: promised.fold, promised_et_date: promised.et_date,
      order_voided: o.voided, order_deleted: o.deleted, check_voided: c.voided, check_deleted: c.deleted, excess_food: o.excess_food,
      dining_option_guid: o.dining_option_guid, server_guid: o.server_guid, source: o.source, revenue_center_guid: o.revenue_center_guid,
      third_party_provider_guid: o.third_party_provider_guid, third_party_provider_name: o.third_party_provider_name,
      amount_cents: int(c.amount_cents), tax_cents: int(c.tax_cents), total_cents: int(c.total_cents),
      gross_cents: acc ? int(acc.gross_cents) : null, discounts_comps_cents: acc ? int(acc.discounts_comps_cents) : null,
      voids_cents: acc ? int(acc.voids_cents) : null, service_charges_cents: acc ? int(acc.service_charges_cents) : null,
      pre_refund_cents: acc ? int(acc.pre_refund_cents) : null,
      line_price_state: lp ? "inline" : "unpriced", line_net_cents: lp ? int(lp.net_cents) : null,
      source_complete: lp ? lp.source_complete === true : null, net_complete: lp ? lp.net_complete === true : null,
      gross_complete: lp ? lp.gross_complete === true : null, receipt_line_complete: lp ? lp.receipt_line_complete === true : null,
    };
  });
  const discountBySelection = new Map<string, number | null>();
  for (const d of src.discounts) {
    owner(d.snapshot_id);
    if (!d.selection_guid) continue;
    const key = `${d.snapshot_id}|${d.check_guid}|${d.selection_guid}`;
    const prev = discountBySelection.has(key) ? discountBySelection.get(key)! : 0;
    const amount = int(d.amount_cents);
    discountBySelection.set(key, prev === null || amount === null ? null : prev + amount);
  }
  const lines: FactLineRow[] = [];
  for (const o of src.orders) {
    for (const raw of o.selection_units) {
      const s = obj(raw);
      const check_guid = str(s.check_guid), selection_guid = str(s.selection_guid), item = str(s.item_guid);
      if (!check_guid || !selection_guid || !item) throw new Error("fact_source_invalid_unit");
      const quantity = typeof s.quantity === "number" && Number.isFinite(s.quantity) ? s.quantity : null;
      if (quantity === null) throw new Error("fact_source_invalid_unit");
      const priced = s.price_v === 1;
      const parent = str(s.parent_selection_guid);
      const selection_type = priced ? str(s.selection_type) : null;
      const deferred = priced ? bool(s.deferred) : null;
      const key = `${o.snapshot_id}|${check_guid}|${selection_guid}`;
      lines.push({
        order_guid: o.order_guid, check_guid, selection_guid, parent_selection_guid: parent,
        is_head: parent === null && isRevenueHead({ deleted: s.deleted, voided: s.voided, selectionType: selection_type ?? undefined, deferred: deferred === true }),
        voided: bool(s.voided), deleted: bool(s.deleted), toast_item_guid: item, quantity,
        price_state: priced ? "inline" : "not_covered",
        net_cents: priced ? int(s.net_cents) : null, gross_cents: priced ? int(s.gross_cents) : null,
        receipt_line_cents: priced ? int(s.receipt_line_cents) : null, tax_cents: priced ? int(s.tax_cents) : null,
        discount_cents: discountBySelection.has(key) ? discountBySelection.get(key)! : 0,
        tax_inclusion: priced ? str(s.tax_inclusion) : null, selection_type, deferred,
      });
    }
  }
  const refunds: FactRefundRow[] = [];
  const checkBy = new Map(src.checks.map((c) => [`${c.snapshot_id}|${c.check_guid}`, c]));
  for (const p of src.payments) {
    const o = owner(p.snapshot_id);
    const c = checkBy.get(`${p.snapshot_id}|${p.check_guid}`);
    if (!c) throw new Error("fact_source_orphan");
    const isAccounted = accounted.get(`${p.snapshot_id}|${p.check_guid}`) === true;
    if (!refundKept(p, isAccounted)) continue;
    refunds.push({
      order_guid: o.order_guid, check_guid: p.check_guid, payment_guid: p.payment_guid, snapshot_id: p.snapshot_id,
      refund_business_date: p.refund_business_date, refund_status: p.refund_status, payment_status: p.payment_status,
      refund_cents: int(p.refund_amount_cents), refund_tip_cents: int(p.refund_tip_cents), sales_refund_cents: int(p.sales_refund_cents),
      check_accounting_present: isAccounted,
      order_voided: o.voided, order_deleted: o.deleted, check_voided: c.voided, check_deleted: c.deleted, excess_food: o.excess_food,
      dining_option_guid: o.dining_option_guid,
    });
  }
  const orders = src.orders.map((o) => ({ order_guid: o.order_guid, snapshot_id: o.snapshot_id, check_count: checkCount.get(o.snapshot_id) ?? 0 }));
  return {
    orders: orders.sort(byKey((o) => o.order_guid)),
    checks: checks.sort(byKey((c) => `${c.order_guid}|${c.check_guid}`)),
    lines: lines.sort(byKey((l) => `${l.order_guid}|${l.check_guid}|${l.selection_guid}`)),
    refunds: refunds.sort(byKey((r) => `${r.order_guid}|${r.payment_guid}`)),
  };
}

/** Line revenue over stored facts through THE line-revenue function. `saleClass` is the read-time
 * classification (sales_report_class over the ezCater link and the channel map), passed in. */
export function lineRevenueFromFacts(day: Pick<OrderDayPayload, "checks" | "lines">,
  ctx: { captureCovered: boolean; saleClass: (check: FactCheckRow) => boolean }, measure: LineMeasure): LineRevenue {
  const linePrices = (c: FactCheckRow): CheckLinePrices | null => c.line_price_state !== "inline" ? null : {
    v: 1, selections_present: true, heads: 0, uncaptured_heads: 0, mixed_heads: 0, net_cents: c.line_net_cents,
    source_complete: c.source_complete === true, net_complete: c.net_complete === true,
    gross_complete: c.gross_complete === true, receipt_line_complete: c.receipt_line_complete === true,
  };
  return lineRevenue({
    captureCovered: ctx.captureCovered,
    checks: day.checks.filter((c) => !c.order_deleted && !c.check_deleted)
      .map((c) => ({ checkGuid: c.check_guid, saleClass: ctx.saleClass(c), linePrices: linePrices(c) })),
    units: day.lines.map((l) => ({
      check_guid: l.check_guid, parent_selection_guid: l.parent_selection_guid, voided: l.voided, deleted: l.deleted,
      quantity: l.quantity, net_cents: l.net_cents, gross_cents: l.gross_cents, receipt_line_cents: l.receipt_line_cents,
      selection_type: l.selection_type, deferred: l.deferred === true,
    })),
  }, measure);
}
