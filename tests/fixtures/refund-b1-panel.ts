/**
 * Typed fixtures for the refund panel's Part B1 STORED-state rendering (tests/catering-refund-panel-ui.test.ts).
 * Synthetic ids and amounts only. Every object is a `RefundSummary` the server could send: the compiler holds the
 * fixtures to the contract in lib/catering/refunds-shared.ts and lib/catering/refund-outcomes-shared.ts.
 */
import { refundFigures, summarizeTotals, type RefundPaymentView, type RefundRequestView, type RefundSummary } from "@/lib/catering/refunds-shared";
import {
  dispositionActionsFor,
  type RefundEpochState,
  type RefundEpochView,
  type RefundIssueCode,
  type RefundIssueView,
  type StoredRequestState,
} from "@/lib/catering/refund-outcomes-shared";

export const B1_QUOTE = "00000000-0000-4000-8000-0000000000b1";
export const B1_ISSUE = "00000000-0000-4000-8000-0000000000e1";
export const B1_REQUEST = "00000000-0000-4000-8000-0000000000f1";
export const B1_VERIFIED_AT = "2026-11-20T15:30:00.000Z";

export function epoch(state: RefundEpochState, callerOk = true): RefundEpochView {
  return { state, epochId: state === "none" ? null : "00000000-0000-4000-8000-0000000000a1", callerOk };
}

export function b1Payment(over: Partial<RefundPaymentView> = {}): RefundPaymentView {
  const figures = refundFigures({ amountCents: 30000, status: "paid", provider: "stripe", providerRef: "pi_b1" }, [], []);
  return {
    id: "00000000-0000-4000-8000-0000000000c1",
    kind: "deposit",
    status: "paid",
    provider: "stripe",
    amountCents: 30000,
    paidAt: null,
    figures,
    held: false,
    verified: true,
    lastVerifiedAt: B1_VERIFIED_AT,
    returnedCents: 0,
    reservedCents: 0,
    floorCents: 0,
    cleanupOwed: false,
    ...over,
  };
}

/** A held payment: the server gives 0 refundable (its stored available figure is kept server-side). */
export function heldPayment(): RefundPaymentView {
  const p = b1Payment({ held: true });
  return { ...p, figures: { ...p.figures, refundableCents: 0 } };
}

export function b1Request(state: StoredRequestState, over: Partial<RefundRequestView> = {}): RefundRequestView {
  const status: RefundRequestView["status"] =
    state === "succeeded" ? "succeeded" : state === "submitted" ? "submitted" : state === "failed" || state === "released" ? "failed" : "pending";
  return {
    id: B1_REQUEST,
    paymentId: "00000000-0000-4000-8000-0000000000c1",
    amountCents: 5000,
    status,
    reasonCode: "customer_cancelled",
    reasonNote: null,
    trigger: "panel",
    stripeStatus: null,
    lastErrorCode: state === "released" ? "released_no_refund" : null,
    attempts: 1,
    requestedAt: "2026-11-20T14:00:00.000Z",
    requestedByName: null,
    needsReconcile: false,
    retryable: false,
    state,
    armed: state === "submission_unconfirmed",
    bindingHold: state === "held" ? "ambiguous_binding" : null,
    ...over,
  };
}

/** One issue; `withActions` = what the server sends a viewer who may disposition (MoO at the shop, Owner, CGS). */
export function b1Issue(code: RefundIssueCode, withActions: boolean, over: Partial<RefundIssueView> = {}): RefundIssueView {
  const state = over.state ?? "open";
  return {
    id: B1_ISSUE,
    code,
    state,
    blocking: true,
    paymentId: "00000000-0000-4000-8000-0000000000c1",
    requestId: null,
    refundId: null,
    eventId: null,
    openedAt: "2026-11-19T12:00:00.000Z",
    aged: false,
    generation: 3,
    detail: {},
    actions: withActions ? dispositionActionsFor(code, state) : [],
    ...over,
  };
}

export function b1Summary(over: Partial<RefundSummary> = {}): RefundSummary {
  const payments = over.payments ?? [b1Payment()];
  return {
    quoteId: B1_QUOTE,
    locationId: "00000000-0000-4000-8000-0000000000d2",
    canRefund: true,
    installed: true,
    payments,
    requests: [],
    totals: summarizeTotals(payments),
    stripeUnchecked: payments.some((p) => p.figures.eligible && p.verified === false),
    epoch: epoch("live"),
    issues: [],
    ...over,
  };
}
