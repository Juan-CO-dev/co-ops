/**
 * Catering delivery (D1) — THE one order-quote selection (plan r6 section 4.8). Zero I/O. Client-safe.
 *
 * A lead can hold SEVERAL quote families, and "live" is one revision per FAMILY (0120: `superseded_at is null`), so
 * "the live quote" is not one row. Every delivery rule — rejection, delivery eligibility, fee, gratuity — reads the
 * quote through `orderQuoteOf` here and `delivery_order_quote` in SQL (0356). They are pinned equal by ONE case file,
 * tests/fixtures/delivery/order-quote-cases.json. Never select a quote any other way.
 *
 * CANDIDATES = the live revision of each of the lead's families. First match wins:
 *   accepted(q)  exactly ONE candidate is accepted            -> the fee / gratuity source is q
 *   ambiguous    two or more candidates are accepted          -> no source; a person must settle which stands
 *   rejected     there are candidates and EVERY one declined  -> the order is rejected by its quote
 *   pending(q)   otherwise: q = the newest non-declined candidate by (created_at, id); nothing accepted, no source
 *   none         the lead has no quote (ezCater and Toast-created leads): not known to be a delivery
 * `expired` is never a rejection.
 */
import type { DeliveryLeadStage, OrderQuote, OrderQuoteKind, QuoteCandidate } from "./types-shared";

/** Newest first by (created_at, id): the instant, then the id as lowercase text (a uuid's own order). */
function newerFirst(a: QuoteCandidate, b: QuoteCandidate): number {
  const ta = Date.parse(a.createdAt), tb = Date.parse(b.createdAt);
  if (ta !== tb) return tb - ta;
  const ia = a.id.toLowerCase(), ib = b.id.toLowerCase();
  return ia < ib ? 1 : ia > ib ? -1 : 0;
}

export function orderQuoteOf(candidates: readonly QuoteCandidate[]): OrderQuote {
  if (candidates.length === 0) return { kind: "none", isDelivery: null };
  const accepted = candidates.filter((c) => c.status === "accepted");
  if (accepted.length === 1) return { kind: "accepted", quote: accepted[0]!, isDelivery: accepted[0]!.isDelivery };
  if (accepted.length > 1) return { kind: "ambiguous", isDelivery: accepted.some((c) => c.isDelivery) };
  const open = candidates.filter((c) => c.status !== "declined");
  if (open.length === 0) return { kind: "rejected", isDelivery: false };
  const newest = [...open].sort(newerFirst)[0]!;
  return { kind: "pending", quote: newest, isDelivery: newest.isDelivery };
}

/** Rejected = the lead is lost OR its order quote is rejected. The SQL twin is `delivery_order_rejected`. */
export function orderRejected(stage: DeliveryLeadStage, quote: { kind: OrderQuoteKind }): boolean {
  return stage === "lost" || quote.kind === "rejected";
}

/** A house delivery order = not ezCater and KNOWN to be a delivery (`none` is not known: never "to book"). */
export function isHouseDeliveryOrder(isEzcater: boolean, quote: { isDelivery: boolean | null }): boolean {
  return !isEzcater && quote.isDelivery === true;
}
