/**
 * Catering refunds — the client-safe half (no I/O, no server imports). The server half is lib/catering/refunds.ts.
 *
 * Juan 2026-11-23: when a catering order that the customer already paid for (a deposit, a balance, or both) is
 * rejected, cancelled or lost, an authorized person can refund it from inside the app: they see what was paid and
 * what is still refundable, choose full or partial, a reason, and confirm with one explicit tap. The server reserves
 * the refund (migration 0357 `catering_refund_reserve`, which recomputes every figure under the payment row locks and
 * never trusts the client), asks Stripe for it with an idempotency key derived from the reserved row's id, records the
 * answer, and the EXISTING Stripe webhook (`charge.refunded`, lib/stripe/webhook.ts) reconciles the payment row and the
 * refund events the reports read. Nothing here writes a payment row or a refund event.
 *
 * SHIPS DARK: `CATERING_REFUNDS=1` (server env). Unset = today's behaviour exactly: no refund UI is rendered and every
 * refund route answers 503 `refunds_off`.
 */
import type { RoleCode } from "@/lib/roles";

// ── The switch ─────────────────────────────────────────────────────────────────────────────────────────
/** The switch. Read on the server only and passed to the client as a prop (a `-shared` module never reads env). */
export function cateringRefundsOn(env: Record<string, string | undefined>): boolean {
  return env.CATERING_REFUNDS === "1";
}

// ── Vocabulary (held equal to migration 0357 by tests/catering-refund-0357-migration.test.ts) ─────────────
export const REFUND_REASON_CODES = [
  "customer_cancelled",
  "event_lost",
  "quote_declined",
  "duplicate_charge",
  "service_issue",
  "other",
] as const;
export type RefundReasonCode = (typeof REFUND_REASON_CODES)[number];

/** Where the refund step was opened from: the payment panel, a declined quote, a lost lead. */
export const REFUND_TRIGGERS = ["panel", "declined", "lost"] as const;
export type RefundTrigger = (typeof REFUND_TRIGGERS)[number];

export const REFUND_STATUSES = ["pending", "submitted", "succeeded", "failed"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const MAX_REFUND_NOTE = 500;

export function isRefundReasonCode(v: unknown): v is RefundReasonCode {
  return typeof v === "string" && (REFUND_REASON_CODES as readonly string[]).includes(v);
}
export function isRefundTrigger(v: unknown): v is RefundTrigger {
  return typeof v === "string" && (REFUND_TRIGGERS as readonly string[]).includes(v);
}

// ── Who may refund (the conservative gate; Juan to confirm) ───────────────────────────────────────────────
/**
 * Money OUT is more sensitive than sending a quote. The catering manager, and level 8+ (MoO, owner, CGS) — the same
 * roles as 0357's `catering_refund_actor_ok`, which is the authority (a MoO or catering manager also needs an active
 * membership at the order's shop; the app checks that with `lockLocationContext` before the RPC, and the RPC again
 * under the lock). GM and AGM are deliberately NOT included until Juan says so. A ROLE check, never level-only:
 * level 6 also holds the prep and social media managers.
 */
export const REFUND_ROLES: readonly RoleCode[] = ["catering_mgr", "moo", "owner", "cgs"];
export function canRequestRefund(role: RoleCode): boolean {
  return REFUND_ROLES.includes(role);
}

// ── The figures (the TS twin of 0357 `catering_refund_figures`) ───────────────────────────────────────────
export interface RefundPaymentInput {
  amountCents: number;
  status: string;
  provider: string | null;
  providerRef: string | null;
}
export interface RefundEventInput {
  cumulativeRefundedCents: number;
  chargeAmountCents: number | null;
  /** The event's own time (0333 `refunded_at`); compared with a snapshot's listing time. */
  refundedAt?: string | null;
}
/**
 * The newest Stripe listing of a charge's refunds (0357 `catering_refund_stripe_snapshots`, review r6): each refund's
 * id, amount, CURRENT status and our request id (null = not made by CO-OPS), and the charge's captured amount.
 */
export interface RefundSnapshotInput {
  listedAt: string;
  capturedCents: number | null;
  refunds: ReadonlyArray<{ id: string; amountCents: number; status: string | null; requestId: string | null }>;
}
export interface RefundRequestInput {
  /** The request row's id (matched against a listed refund's request id). */
  id?: string;
  amountCents: number;
  status: RefundStatus;
  /** The Stripe refund this row recorded (matched against a listed refund's id). */
  stripeRefundId?: string | null;
}
export interface RefundFigures {
  /** The charge amount Stripe reported (when it did) — the charge is the money, in both directions — else the row's. */
  capturedCents: number;
  /**
   * BY IDENTITY AND CURRENT STATUS (review r4-r6), from the newest Stripe snapshot: every listed refund not failed /
   * canceled, plus our own accepted refunds it does not list yet. An event NEWER than the snapshot: the larger of the
   * two. No snapshot: the larger of the webhook's cumulative and our own accepted sum.
   */
  refundedCents: number;
  /** Our own requests whose Stripe answer is not confirmed yet. */
  inFlightCents: number;
  /** What CO-OPS may still ask Stripe to give back. Never below 0. */
  refundableCents: number;
  /** A Stripe-paid row with a PaymentIntent. A hand-marked payment is refunded outside the app. */
  eligible: boolean;
}

const PI_RE = /^pi_[A-Za-z0-9_]+$/;

export function refundFigures(
  payment: RefundPaymentInput,
  events: readonly RefundEventInput[],
  requests: readonly RefundRequestInput[],
  snapshot: RefundSnapshotInput | null = null,
): RefundFigures {
  const charge = events.reduce<number | null>(
    (m, e) => (e.chargeAmountCents == null ? m : m == null ? e.chargeAmountCents : Math.max(m, e.chargeAmountCents)),
    null,
  );
  const cumulative = events.reduce((m, e) => Math.max(m, e.cumulativeRefundedCents), 0);
  const accepted = requests.filter((r) => r.status === "submitted" || r.status === "succeeded");
  let capturedCents: number;
  let refundedCents: number;
  let inFlightCents: number;
  if (!snapshot) {
    inFlightCents = requests.filter((r) => r.status === "pending").reduce((s, r) => s + r.amountCents, 0);
    capturedCents = charge ?? payment.amountCents;
    refundedCents = Math.max(cumulative, accepted.reduce((s, r) => s + r.amountCents, 0));
  } else {
    const listedIds = new Set(snapshot.refunds.map((x) => x.id));
    const listedRequests = new Set(snapshot.refunds.flatMap((x) => (x.requestId ? [x.requestId] : [])));
    const listed = snapshot.refunds.filter((x) => x.status !== "failed" && x.status !== "canceled").reduce((s, x) => s + x.amountCents, 0);
    const ownUnlisted = accepted.filter((r) => !r.stripeRefundId || !listedIds.has(r.stripeRefundId)).reduce((s, r) => s + r.amountCents, 0);
    inFlightCents = requests.filter((r) => r.status === "pending" && !(r.id && listedRequests.has(r.id))).reduce((s, r) => s + r.amountCents, 0);
    capturedCents = snapshot.capturedCents ?? charge ?? payment.amountCents;
    const lastEvent = events.reduce<number | null>((m, e) => {
      const t = e.refundedAt ? Date.parse(e.refundedAt) : NaN;
      return Number.isFinite(t) ? (m == null ? t : Math.max(m, t)) : m;
    }, null);
    const snapRefunded = listed + ownUnlisted;
    refundedCents = lastEvent == null || Date.parse(snapshot.listedAt) >= lastEvent ? snapRefunded : Math.max(cumulative, snapRefunded);
  }
  const eligible = payment.status === "paid" && payment.provider === "stripe" && PI_RE.test(payment.providerRef ?? "");
  return {
    capturedCents,
    refundedCents,
    inFlightCents,
    refundableCents: eligible ? Math.max(0, capturedCents - refundedCents - inFlightCents) : 0,
    eligible,
  };
}

/** The allocation order 0357 uses: the balance, then a full payment, then the deposit; newest first within a kind. */
export interface AllocatablePayment {
  id: string;
  kind: "deposit" | "balance" | "full";
  paidAt: string | null;
  refundableCents: number;
}
const KIND_RANK: Record<AllocatablePayment["kind"], number> = { balance: 1, full: 2, deposit: 3 };
export function allocateRefund(payments: readonly AllocatablePayment[], wantCents: number): Array<{ id: string; amountCents: number }> {
  const ordered = [...payments].sort((a, b) => {
    const k = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (k !== 0) return k;
    const ta = a.paidAt ? Date.parse(a.paidAt) : Number.NEGATIVE_INFINITY;
    const tb = b.paidAt ? Date.parse(b.paidAt) : Number.NEGATIVE_INFINITY;
    if (ta !== tb) return tb - ta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const out: Array<{ id: string; amountCents: number }> = [];
  let left = wantCents;
  for (const p of ordered) {
    if (left <= 0) break;
    if (p.refundableCents <= 0) continue;
    const take = Math.min(left, p.refundableCents);
    out.push({ id: p.id, amountCents: take });
    left -= take;
  }
  return out;
}

// ── Stripe's answers ────────────────────────────────────────────────────────────────────────────────────
/**
 * A Refund object's `status` (docs.stripe.com/api/refunds/object: "This can be `pending`, `requires_action`,
 * `succeeded`, `failed`, or `canceled`") → our row's status. Anything else is unknown → null (the row stays pending).
 */
export function refundStatusFromStripe(stripeStatus: string | null | undefined): Exclude<RefundStatus, "pending"> | null {
  switch (stripeStatus) {
    case "succeeded":
      return "succeeded";
    case "pending":
    case "requires_action":
      return "submitted";
    case "failed":
    case "canceled":
      return "failed";
    default:
      return null;
  }
}

/**
 * Did a failed create call certainly NOT make a refund?
 *   `unknown`  — no response (network), a 5xx (Stripe: "Treat the outcome of a request that returns `500` as
 *                indeterminate"), a 409 (another request with the same key still executing) or a 429 (rate limited,
 *                no result cached). The row stays pending and counts against the refundable figure; a retry first
 *                looks for a refund carrying our request id, then re-sends the SAME key and parameters.
 *   `refused`  — any other 4xx: Stripe refused the request (already refunded, more than is left, a bad id, an auth
 *                problem). No refund exists for it. The row becomes `failed` and its amount is released.
 * Source: docs.stripe.com/error-low-level (content / network / server errors, the status table).
 */
export function stripeCreateFailure(httpStatus: number): "unknown" | "refused" {
  if (httpStatus >= 500 || httpStatus === 409 || httpStatus === 429 || httpStatus === 0) return "unknown";
  if (httpStatus >= 400) return "refused";
  return "unknown";
}

/**
 * "Limit retries of an unresolved operation to the first 24 hours after the original request, using the same key and
 * parameters ... If the outcome is still unknown after that window, don't retry with either the old key or a new one"
 * (docs.stripe.com/error-low-level). Past this, a pending row is `needs_reconcile`: a person checks Stripe.
 */
export const REFUND_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Stripe's own `reason` enum is `duplicate | fraudulent | requested_by_customer`; ours maps onto two of them. */
export function stripeRefundReason(code: RefundReasonCode): "duplicate" | "requested_by_customer" | null {
  if (code === "duplicate_charge") return "duplicate";
  if (code === "customer_cancelled" || code === "quote_declined" || code === "event_lost") return "requested_by_customer";
  return null;
}

/** The one Stripe Idempotency-Key spelling for a request row: stable across every retry of that row. */
export function refundIdempotencyKey(requestId: string): string {
  return `catering-refund:${requestId}`;
}

// ── The request body (strict) ─────────────────────────────────────────────────────────────────────────
export interface RefundRequestBody {
  clientToken: string;
  /**
   * The exact amount the person saw and confirmed — REQUIRED, "Full" included (review r1): the server never re-reads
   * "everything" at execution, so money that lands between the screen and the tap cannot grow the refund.
   */
  amountCents: number;
  reasonCode: RefundReasonCode;
  reasonNote: string | null;
  trigger: RefundTrigger;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}
/** The largest refund a body may name: well above any catering order, well inside an integer. */
export const MAX_REFUND_CENTS = 10_000_000;

export function parseRefundBody(raw: unknown): RefundRequestBody | "invalid_request" | "note_required" | "invalid_amount" {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "invalid_request";
  const b = raw as Record<string, unknown>;
  const allowed = new Set(["clientToken", "amountCents", "reasonCode", "reasonNote", "trigger"]);
  if (Object.keys(b).some((k) => !allowed.has(k))) return "invalid_request";
  if (!isUuid(b.clientToken)) return "invalid_request";
  if (!isRefundReasonCode(b.reasonCode)) return "invalid_request";
  if (!isRefundTrigger(b.trigger)) return "invalid_request";
  if (typeof b.amountCents !== "number" || !Number.isInteger(b.amountCents)) return "invalid_amount";
  if (b.amountCents <= 0 || b.amountCents > MAX_REFUND_CENTS) return "invalid_amount";
  const amountCents = b.amountCents;
  let reasonNote: string | null = null;
  if (b.reasonNote !== null && b.reasonNote !== undefined) {
    if (typeof b.reasonNote !== "string") return "invalid_request";
    const t = b.reasonNote.trim();
    if (t.length > MAX_REFUND_NOTE) return "invalid_request";
    reasonNote = t.length > 0 ? t : null;
  }
  if (b.reasonCode === "other" && reasonNote === null) return "note_required";
  return { clientToken: b.clientToken.toLowerCase(), amountCents, reasonCode: b.reasonCode, reasonNote, trigger: b.trigger };
}

/** "$12.34" typed by a person → cents, or null. Two decimals at most; never a float multiply. */
export function refundDollarsToCents(v: string): number | null {
  const t = v.trim().replace(/^\$/, "");
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return cents > 0 ? cents : null;
}

// ── Named refusals ────────────────────────────────────────────────────────────────────────────────────────
/** Every refusal the reserve RPC raises (0357), and the app's own. Each has en + es `catering.refunds.error.<code>`. */
export const REFUND_ERROR_CODES = [
  "refunds_off",
  "refunds_unavailable",
  "forbidden",
  "not_found",
  "invalid_request",
  "invalid_reason",
  "invalid_amount",
  "note_required",
  "note_too_long",
  "quote_not_found",
  "nothing_refundable",
  "over_refundable",
  "token_reused",
  "stripe_not_configured",
  "needs_reconcile",
  "not_retryable",
  "not_releasable",
  "generic",
] as const;
export type RefundErrorCode = (typeof REFUND_ERROR_CODES)[number];

export const REFUND_SQL_REFUSALS: Readonly<Record<string, { status: number; code: RefundErrorCode }>> = {
  forbidden: { status: 403, code: "forbidden" },
  invalid_request: { status: 400, code: "invalid_request" },
  invalid_reason: { status: 400, code: "invalid_reason" },
  invalid_amount: { status: 400, code: "invalid_amount" },
  note_required: { status: 400, code: "note_required" },
  note_too_long: { status: 400, code: "note_too_long" },
  quote_not_found: { status: 404, code: "not_found" },
  nothing_refundable: { status: 409, code: "nothing_refundable" },
  over_refundable: { status: 409, code: "over_refundable" },
  token_reused: { status: 409, code: "token_reused" },
};

// ── The read model the panel draws ────────────────────────────────────────────────────────────────────────
export interface RefundPaymentView {
  id: string;
  kind: "deposit" | "balance" | "full";
  status: string;
  provider: string | null;
  amountCents: number;
  paidAt: string | null;
  figures: RefundFigures;
}
export interface RefundRequestView {
  id: string;
  paymentId: string;
  amountCents: number;
  status: RefundStatus;
  reasonCode: RefundReasonCode;
  reasonNote: string | null;
  trigger: RefundTrigger;
  stripeStatus: string | null;
  lastErrorCode: string | null;
  attempts: number;
  requestedAt: string;
  requestedByName: string | null;
  /**
   * A pending row past the 24 h retry window (REFUND_RETRY_WINDOW_MS). Nothing is ever SENT for it again; "Check
   * Stripe" looks for a refund carrying its id and adopts it (review r2), and "Release" closes it once Stripe shows none.
   */
  needsReconcile: boolean;
  /** Can a press of Retry / Refresh do something now? */
  retryable: boolean;
}
export interface RefundSummary {
  quoteId: string;
  locationId: string;
  canRefund: boolean;
  /** False until 0357 is applied: the panel says so instead of offering a refund. */
  installed: boolean;
  payments: RefundPaymentView[];
  requests: RefundRequestView[];
  totals: { paidCents: number; refundedCents: number; inFlightCents: number; refundableCents: number; outsideAppCents: number };
  /** Stripe could not be asked about a payment just now (review r6): the figures may be out of date. */
  stripeUnchecked?: boolean;
}

export function summarizeTotals(payments: readonly RefundPaymentView[]): RefundSummary["totals"] {
  let paidCents = 0, refundedCents = 0, inFlightCents = 0, refundableCents = 0, outsideAppCents = 0;
  for (const p of payments) {
    if (p.status !== "paid" && p.status !== "refunded") continue;
    if (p.figures.eligible || (p.status === "refunded" && p.provider === "stripe")) {
      paidCents += p.figures.capturedCents;
      refundedCents += p.status === "refunded" ? p.figures.capturedCents : p.figures.refundedCents;
      inFlightCents += p.figures.inFlightCents;
      refundableCents += p.figures.refundableCents;
    } else if (p.status === "paid") {
      outsideAppCents += p.amountCents;
    }
  }
  return { paidCents, refundedCents, inFlightCents, refundableCents, outsideAppCents };
}

/** Pending row: retry within the window. Submitted row: refresh from Stripe. Anything else: nothing to do. */
export function requestRetryState(
  r: { status: RefundStatus; firstAttemptAt: string | null; requestedAt: string },
  nowMs: number,
): { needsReconcile: boolean; retryable: boolean } {
  if (r.status === "submitted") return { needsReconcile: false, retryable: true };
  if (r.status !== "pending") return { needsReconcile: false, retryable: false };
  const start = Date.parse(r.firstAttemptAt ?? r.requestedAt);
  const past = Number.isFinite(start) && nowMs - start > REFUND_RETRY_WINDOW_MS;
  return { needsReconcile: past, retryable: !past };
}
