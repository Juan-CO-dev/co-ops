/**
 * Catering delivery (D4) — delivery ECONOMICS: the fee the customer was charged vs what the courier cost us, per
 * order, and the recorded gratuity split (plan r6 sections 6.3, 4.4, 4.5, 4.8). Zero I/O, no clock. Client-safe.
 *
 * COVERAGE PRECEDES NUMBERS. A missing side is NAMED, never 0:
 *   fee   `ezcater_fee_unknown`  an ezCater order: we do not store ezCater's delivery fee
 *         `order_rejected`       the order was lost, or every quote was declined: no fee is counted as charged
 *         `quote_ambiguous`      two or more quotes are accepted: a person settles which stands
 *         `fee_not_on_quote`     nothing accepted (a pending quote, or no quote at all)
 *         known                  ONLY the order quote's `delivery_fee_cents` when its kind is `accepted(q)` (`orderQuoteOf`)
 *   cost  `cost_not_recorded`    no delivery recorded, or none of the deliveries has a cost row
 *         `cost_partial`         some deliveries have no cost row: "at least $X", never $X
 *         known                  ONLY when EVERY delivery of the order has a cost (`orderCost` = `complete`)
 * A NET exists only when the fee is known AND the cost is complete. Period totals run ONLY over orders that have a
 * net, and the orders left out are counted per reason beside them (an order missing both sides counts under both).
 *
 * THE GRATUITY SPLIT IS RECORDED ONLY. One allocation per ORDER: the HEAD of its chain. Totals use heads only; a `void`
 * head or a 0-cent head allocates nothing. Before delivery the split is EXPECTED (the pure rule), and labelled so.
 * `computedSplit` is the TS twin of 0356's `delivery_computed_split`, and `recomputeWouldWrite` of the no-op checks in
 * `delivery_write_split`: they only decide which button the panel offers — the database decides what is written.
 * Its payroll and legal treatment is UNVERIFIED: nothing here pays, pools or exports anything.
 *
 * NOTHING HERE IS A SALES FIGURE. Courier cost, the delivery net and the gratuity split are never added to or
 * subtracted from pipeline value, Toast sales or labor.
 */
import { orderCost, type CostFoldRow, type OrderCost } from "./cost-shared";
import { allocationOf, splitGratuity, splitHead, type SplitFoldRow } from "./gratuity-shared";
import { orderQuoteOf, orderRejected } from "./quote-shared";
import { DEFAULT_GRATUITY_DRIVER_BPS, type DeliveryBookedVia, type DeliveryLeadStage, type DeliveryStatus, type QuoteCandidate } from "./types-shared";

/** Why an order has no net. The fee-side reasons first, then the cost-side ones: the order they are listed in. */
export const ECONOMICS_GAPS = ["ezcater_fee_unknown", "order_rejected", "quote_ambiguous", "fee_not_on_quote", "cost_not_recorded", "cost_partial"] as const;
export type EconomicsGap = (typeof ECONOMICS_GAPS)[number];
export type FeeGap = Extract<EconomicsGap, "ezcater_fee_unknown" | "order_rejected" | "quote_ambiguous" | "fee_not_on_quote">;
export type DeliveryFee = { kind: "known"; cents: number } | { kind: "gap"; reason: FeeGap };

/** What the economics read of a job: no reference, no note, no time. */
export interface EconomicsJob { id: string; attemptNo: number; status: DeliveryStatus; bookedVia: DeliveryBookedVia; providerLabel: string }

export interface OrderEconomicsInput {
  leadId: string;
  /** The lead's event date (YYYY-MM-DD), or null. Which period an order belongs to; never used in a figure. */
  eventDate: string | null;
  stage: DeliveryLeadStage;
  isEzcater: boolean;
  /** The LIVE revision of each of the lead's quote families, with money. */
  candidates: readonly QuoteCandidate[];
  /** ALL the lead's jobs. */
  jobs: readonly EconomicsJob[];
  /** Cost rows of those jobs (rows of other jobs are ignored). */
  costs: readonly CostFoldRow[];
  /** The order's whole gratuity chain. */
  splits: readonly SplitFoldRow[];
  /** The lead's CURRENT shop's driver share; null = no settings row (the default). */
  driverBps: number | null;
}

// ── The computed allocation (twin of 0356 delivery_computed_split) ──────────
export type ComputedSplit =
  | { kind: "ambiguous" }
  /** No delivered job of ours: nothing to allocate. */
  | { kind: "nothing" }
  | { kind: "split"; jobId: string; attemptNo: number; gratuityCents: number; driverBps: number; driverCents: number; crewCents: number };

/** A job a split may be credited to: delivered, and booked by us or by a person (never the courier ezCater sent). */
function creditable(job: EconomicsJob): boolean {
  return job.status === "delivered" && (job.bookedVia === "manual" || job.bookedVia === "co_ops_api");
}

export function computedSplit(input: Pick<OrderEconomicsInput, "candidates" | "jobs" | "driverBps">): ComputedSplit {
  const quote = orderQuoteOf(input.candidates);
  if (quote.kind === "ambiguous") return { kind: "ambiguous" };
  const job = input.jobs.filter(creditable).reduce<EconomicsJob | null>((best, j) => (!best || j.attemptNo > best.attemptNo ? j : best), null);
  if (!job) return { kind: "nothing" };
  const gratuityCents = quote.kind === "accepted" ? quote.quote.gratuityCents : 0;
  const driverBps = input.driverBps ?? DEFAULT_GRATUITY_DRIVER_BPS;
  return { kind: "split", jobId: job.id, attemptNo: job.attemptNo, gratuityCents, driverBps, ...splitGratuity(gratuityCents, driverBps) };
}

/** Would "recompute" append a row? (No head and no gratuity = nothing to record; a head that already says it = no change.) */
export function recomputeWouldWrite(head: SplitFoldRow | null, computed: ComputedSplit): boolean {
  if (computed.kind !== "split") return false;
  if (!head) return computed.gratuityCents !== 0;
  return !(head.kind === "split" && head.jobId === computed.jobId && head.gratuityCents === computed.gratuityCents && head.driverBps === computed.driverBps
    && head.driverCents === computed.driverCents && head.crewCents === computed.crewCents);
}

/**
 * The ONE correction the panel offers: "Recalculate from the current quote" when the computed allocation differs from
 * the head; otherwise "Remove — this delivery didn't happen" while the head still allocates something; else none.
 */
export function gratuityCorrectionOffer(head: SplitFoldRow | null, computed: ComputedSplit): "recompute" | "void" | null {
  if (recomputeWouldWrite(head, computed)) return "recompute";
  return allocationOf(head) ? "void" : null;
}

// ── One order ───────────────────────────────────────────────────────────────
export type OrderGratuity =
  /** The head allocates: the recorded split. `needsRecalc` = the current quote / delivered job / share says otherwise. */
  | { kind: "allocated"; headId: string; jobId: string; attemptNo: number | null; gratuityCents: number; driverBps: number; driverCents: number; crewCents: number; needsRecalc: boolean }
  /** The head is a `void`: the delivery recorded as delivered did not happen. Allocates nothing. */
  | { kind: "voided"; headId: string }
  /** Delivered, nothing allocated (no row, or a 0-cent head). `needsRecalc` false = no gratuity on the quote. */
  | { kind: "nothing_allocated"; headId: string | null; needsRecalc: boolean }
  /** Not delivered yet: what the pure rule WOULD split. Expected, not recorded. */
  | { kind: "expected"; gratuityCents: number; driverBps: number; driverCents: number; crewCents: number }
  /** Two quotes are accepted: no gratuity source. */
  | { kind: "quote_ambiguous" }
  /** No split applies: an ezCater courier (the tip is ezCater's fact), a pickup, an order with no gratuity to expect. */
  | { kind: "none" };

export interface OrderEconomics {
  leadId: string;
  eventDate: string | null;
  isEzcater: boolean;
  /** How many deliveries were recorded, and the couriers named on them (the shop's own labels), newest first. */
  jobs: number;
  providers: string[];
  fee: DeliveryFee;
  cost: OrderCost;
  /** fee − cost, ONLY when the fee is known and the cost is complete. */
  netCents: number | null;
  /** Every reason the order has no net (fee side, then cost side). Empty exactly when `netCents` is a number. */
  gaps: EconomicsGap[];
  gratuity: OrderGratuity;
}

function feeCharged(input: Pick<OrderEconomicsInput, "isEzcater" | "stage" | "candidates">): DeliveryFee {
  if (input.isEzcater) return { kind: "gap", reason: "ezcater_fee_unknown" };
  const quote = orderQuoteOf(input.candidates);
  if (orderRejected(input.stage, quote)) return { kind: "gap", reason: "order_rejected" };
  if (quote.kind === "accepted") return { kind: "known", cents: quote.quote.deliveryFeeCents };
  if (quote.kind === "ambiguous") return { kind: "gap", reason: "quote_ambiguous" };
  return { kind: "gap", reason: "fee_not_on_quote" };
}

function orderGratuity(input: OrderEconomicsInput): OrderGratuity {
  const head = splitHead(input.splits);
  const computed = computedSplit(input);
  const allocation = allocationOf(head);
  if (head && allocation) {
    const job = input.jobs.find((j) => j.id === allocation.jobId);
    return { kind: "allocated", headId: head.id, jobId: allocation.jobId, attemptNo: job?.attemptNo ?? null, gratuityCents: allocation.gratuityCents,
      driverBps: allocation.driverBps, driverCents: allocation.driverCents, crewCents: allocation.crewCents, needsRecalc: recomputeWouldWrite(head, computed) };
  }
  if (head?.kind === "void") return { kind: "voided", headId: head.id };
  if (computed.kind === "ambiguous") return { kind: "quote_ambiguous" };
  if (computed.kind === "split") return { kind: "nothing_allocated", headId: head?.id ?? null, needsRecalc: recomputeWouldWrite(head, computed) };
  // Nothing delivered by a courier of ours. A 0-cent head with no delivered job left is still "nothing allocated".
  if (head) return { kind: "nothing_allocated", headId: head.id, needsRecalc: false };
  const quote = orderQuoteOf(input.candidates);
  if (input.isEzcater || orderRejected(input.stage, quote) || quote.kind !== "accepted" || quote.quote.gratuityCents === 0) return { kind: "none" };
  // Expected only where a courier of ours is, or is to be, on the order.
  if (!quote.isDelivery && !input.jobs.some((j) => j.bookedVia !== "provider_native")) return { kind: "none" };
  const driverBps = input.driverBps ?? DEFAULT_GRATUITY_DRIVER_BPS;
  return { kind: "expected", gratuityCents: quote.quote.gratuityCents, driverBps, ...splitGratuity(quote.quote.gratuityCents, driverBps) };
}

export function orderEconomics(input: OrderEconomicsInput): OrderEconomics {
  const fee = feeCharged(input);
  const cost = orderCost(input.jobs.map((j) => ({ jobId: j.id, costs: input.costs })));
  const gaps: EconomicsGap[] = [];
  if (fee.kind === "gap") gaps.push(fee.reason);
  if (cost.kind === "none" || cost.kind === "unknown") gaps.push("cost_not_recorded");
  else if (cost.kind === "partial") gaps.push("cost_partial");
  const newestFirst = [...input.jobs].sort((a, b) => b.attemptNo - a.attemptNo);
  return {
    leadId: input.leadId, eventDate: input.eventDate, isEzcater: input.isEzcater, jobs: input.jobs.length,
    providers: [...new Set(newestFirst.map((j) => j.providerLabel))],
    fee, cost, netCents: fee.kind === "known" && cost.kind === "complete" ? fee.cents - cost.cents : null, gaps, gratuity: orderGratuity(input),
  };
}

/**
 * Is this lead a DELIVERY ORDER for the economics? Yes when a delivery was recorded on it (any stage: a cancelled
 * courier on a lost order may still have cost us), or when it is a confirmed / out / completed HOUSE order whose order
 * quote is a delivery (a courier was owed even if nobody recorded one). A pickup, an unconfirmed lead and an ezCater
 * order with no record are not.
 */
export function isDeliveryOrder(input: Pick<OrderEconomicsInput, "stage" | "isEzcater" | "candidates"> & { jobs: readonly unknown[] }): boolean {
  if (input.jobs.length > 0) return true;
  if (input.isEzcater || (input.stage !== "confirmed" && input.stage !== "out" && input.stage !== "completed")) return false;
  return orderQuoteOf(input.candidates).isDelivery === true;
}

// ── A period ────────────────────────────────────────────────────────────────
export interface DeliveryEconomicsReport {
  /** Every delivery order of the period, newest event date first. */
  orders: OrderEconomics[];
  /** COVERAGE FIRST: of `orders` delivery orders, `withNet` have both a fee and a full cost. */
  coverage: { orders: number; withNet: number };
  /** Over the `withNet` orders ONLY. */
  totals: { feeCents: number; costCents: number; netCents: number };
  /** The orders left out of the totals, per reason (canonical order, zero counts omitted). One order may count twice. */
  excluded: { reason: EconomicsGap; orders: number }[];
  gratuity: {
    /** Orders whose head allocates, and the sums over those HEADS only. */
    orders: number; gratuityCents: number; driverCents: number; crewCents: number;
    /** Delivered orders with no gratuity on the quote (nothing allocated, nothing to recalculate). */
    deliveredNoGratuity: number;
    /** Orders whose head is a void. */
    voided: number;
    /** Orders whose recorded split no longer matches the current quote (recalculate it on the order). */
    needsRecalc: number;
    /** Orders not delivered yet with an expected split (never in the sums). */
    expected: number;
  };
}

const byEventDateDesc = (a: OrderEconomics, b: OrderEconomics) => {
  const da = a.eventDate ?? "", db = b.eventDate ?? "";
  return da !== db ? (da < db ? 1 : -1) : a.leadId < b.leadId ? -1 : a.leadId > b.leadId ? 1 : 0;
};

/** The period report over delivery orders ALREADY selected (`isDeliveryOrder`) and scoped by the caller. */
export function deliveryEconomics(inputs: readonly OrderEconomicsInput[]): DeliveryEconomicsReport {
  const orders = inputs.map(orderEconomics).sort(byEventDateDesc);
  const totals = { feeCents: 0, costCents: 0, netCents: 0 };
  const gratuity = { orders: 0, gratuityCents: 0, driverCents: 0, crewCents: 0, deliveredNoGratuity: 0, voided: 0, needsRecalc: 0, expected: 0 };
  const excluded = new Map<EconomicsGap, number>();
  let withNet = 0;
  for (const o of orders) {
    if (o.netCents !== null && o.fee.kind === "known" && o.cost.kind === "complete") {
      withNet += 1;
      totals.feeCents += o.fee.cents; totals.costCents += o.cost.cents; totals.netCents += o.netCents;
    }
    for (const gap of o.gaps) excluded.set(gap, (excluded.get(gap) ?? 0) + 1);
    const g = o.gratuity;
    if (g.kind === "allocated") {
      gratuity.orders += 1; gratuity.gratuityCents += g.gratuityCents; gratuity.driverCents += g.driverCents; gratuity.crewCents += g.crewCents;
      if (g.needsRecalc) gratuity.needsRecalc += 1;
    } else if (g.kind === "voided") gratuity.voided += 1;
    else if (g.kind === "nothing_allocated") { if (g.needsRecalc) gratuity.needsRecalc += 1; else gratuity.deliveredNoGratuity += 1; }
    else if (g.kind === "expected") gratuity.expected += 1;
  }
  return { orders, coverage: { orders: orders.length, withNet }, totals,
    excluded: ECONOMICS_GAPS.filter((reason) => excluded.has(reason)).map((reason) => ({ reason, orders: excluded.get(reason)! })), gratuity };
}
