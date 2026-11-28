/**
 * Catering refunds Part B1 — the client-safe contract of the reconciler (no I/O, no server imports). The database
 * authority is migration 0359; this module is its TypeScript twin, held equal by
 * tests/catering-refund-0359-migration.test.ts. The server half is lib/catering/refund-reconcile.ts.
 *
 * Nothing here runs while `CATERING_REFUNDS` is OFF: every caller is behind the switch.
 */

// ── The install and caller contract (0359 `catering_refund_install_manifest`, `catering_refund_admit`) ─────────
/** This build's compiled B1 contract version: the REQUIRED first argument of every protected database call. */
export const REFUND_CALLER_CONTRACT = "b1-1";

// ── The epoch ─────────────────────────────────────────────────────────────────────────────────────────────
/** `none` = no epoch was ever opened (or the last one was closed and its seal released); `sealed` = the final drain
 *  sealed ON ingress; the rest are the open epoch's own states. */
export const REFUND_EPOCH_STATES = ["none", "sealed", "recovering", "live", "draining"] as const;
export type RefundEpochState = (typeof REFUND_EPOCH_STATES)[number];

export interface RefundEpochView {
  state: RefundEpochState;
  epochId: string | null;
  /** False when this build's contract version is not the one the database admits: every action is unavailable. */
  callerOk: boolean;
}

export function parseEpochState(raw: unknown): RefundEpochView {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const state = (REFUND_EPOCH_STATES as readonly string[]).includes(String(r.state)) ? (r.state as RefundEpochState) : "none";
  return { state, epochId: typeof r.epoch_id === "string" ? r.epoch_id : null, callerOk: r.caller_ok === true };
}

/**
 * What a refund ACTION (Confirm, Retry-create) answers for an epoch state, or null when it may proceed.
 * Reads and bounded recovery work have their own rule (`epochAllowsWork`).
 */
export function createRefusalFor(epoch: RefundEpochView): { status: number; code: "refunds_unavailable" | "refunds_no_epoch" | "refunds_recovering" | "refunds_draining" } | null {
  if (!epoch.callerOk) return { status: 503, code: "refunds_unavailable" };
  if (epoch.state === "none" || epoch.state === "sealed") return { status: 503, code: "refunds_no_epoch" };
  if (epoch.state === "recovering") return { status: 503, code: "refunds_recovering" };
  if (epoch.state === "draining") return { status: 503, code: "refunds_draining" };
  return null;
}
export function epochAllowsWork(epoch: RefundEpochView): boolean {
  return epoch.callerOk && (epoch.state === "recovering" || epoch.state === "live" || epoch.state === "draining");
}

/**
 * ACTIVATION ORDER, executable (plan Activation 3; Fable P3-4): the recovery epoch is opened and READ BACK while the
 * master switch is still OFF; only then may the operator be told to set the switch. The activation tooling prints its
 * next step from this function and nothing else.
 */
export type ActivationStep = "open_recovery_first" | "set_switch_on" | "seed_and_recover" | "already_live" | "refuse_incompatible" | "refuse_draining";
export function activationNextStep(input: { switchOn: boolean; epoch: RefundEpochView }): ActivationStep {
  const { switchOn, epoch } = input;
  if (!epoch.callerOk) return "refuse_incompatible";
  if (epoch.state === "none" || epoch.state === "sealed") return "open_recovery_first"; // never "set the switch" without a recovering epoch read back
  if (epoch.state === "draining") return "refuse_draining";
  if (epoch.state === "live") return "already_live";
  return switchOn ? "seed_and_recover" : "set_switch_on";
}

// ── Money classes ─────────────────────────────────────────────────────────────────────────────────────────
export const REFUND_CLASSES = ["reserved", "returned", "void"] as const;
export type RefundClass = (typeof REFUND_CLASSES)[number];
const KNOWN_PROVIDER_STATUSES = ["pending", "requires_action", "succeeded", "failed", "canceled"] as const;

/** 0359 `catering_refund_class_of`: `succeeded` is returned; failed / canceled are void; everything else RESERVES. */
export function refundClassOf(status: string | null | undefined): RefundClass {
  if (status === "succeeded") return "returned";
  if (status === "failed" || status === "canceled") return "void";
  return "reserved";
}
/** A structurally valid provider status or id prefix this build does not know: flagged, reserved, never dropped. */
export function isUnfamiliarRefund(id: string, status: string | null | undefined): boolean {
  return !(KNOWN_PROVIDER_STATUSES as readonly string[]).includes(status ?? "") || !/^(re|pyr)_/.test(id);
}

// ── The ON figures contract (0359 `catering_refund_effective_figures`) ─────────────────────────────────────
export interface EffectiveFiguresInput {
  payment: { amountCents: number; status: string; provider: string | null; providerRef: string | null };
  /** A complete pass has published this payment. Until then the legacy evidence is the provider deduction's lower bound. */
  verified: boolean;
  /** The verified capture when it is known and positive (verified mode), else null. */
  knownCapturedCents: number | null;
  /** 0333's largest `charge_amount_cents` / `cumulative_refunded_cents` for the payment. */
  eventChargeCents: number | null;
  eventCumulativeCents: number | null;
  /** 0357's newest snapshot (legacy mode only). */
  snapshot: { capturedCents: number | null; refunds: ReadonlyArray<{ id: string; amountCents: number; status: string | null }> } | null;
  /** Verified identities of this payment that are not wrong-charge evidence. */
  identities: ReadonlyArray<{ amountCents: number; class: RefundClass; requestId: string | null }>;
  /** Every OUTSTANDING live event floor on the charge. */
  floors: readonly number[];
  requests: ReadonlyArray<{ id: string; amountCents: number; status: "pending" | "submitted" | "succeeded" | "failed"; stripeRefundId: string | null }>;
  /** A blocking issue is open or held on the payment. */
  held: boolean;
  excludeRequestId?: string | null;
}
export interface EffectiveFigures {
  capturedCents: number;
  returnedCents: number;
  reservedCents: number;
  floorCents: number;
  /** greatest(returned + reserved, the LARGEST outstanding floor): a floor is honoured even against a newer snapshot. */
  deductionCents: number;
  /** Our own requests not already counted through a verified bound identity: the independent reservation is kept. */
  reservationsCents: number;
  availableCents: number;
  eligible: boolean;
  held: boolean;
  verified: boolean;
}
const PI_RE = /^pi_[A-Za-z0-9_]+$/;

export function effectiveRefundFigures(i: EffectiveFiguresInput): EffectiveFigures {
  let capturedCents: number;
  let returnedCents = 0;
  let reservedCents = 0;
  if (i.verified) {
    capturedCents = i.knownCapturedCents ?? i.eventChargeCents ?? i.payment.amountCents;
    for (const x of i.identities) {
      if (x.class === "returned") returnedCents += x.amountCents;
      else if (x.class === "reserved") reservedCents += x.amountCents;
    }
  } else {
    capturedCents = i.snapshot?.capturedCents ?? i.eventChargeCents ?? i.payment.amountCents;
    const listed = (i.snapshot?.refunds ?? []).filter((r) => r.status !== "failed" && r.status !== "canceled").reduce((s, r) => s + r.amountCents, 0);
    returnedCents = Math.max(i.eventCumulativeCents ?? 0, listed, i.payment.status === "refunded" ? capturedCents : 0);
  }
  const floorCents = i.floors.reduce((m, f) => Math.max(m, f), 0);
  const deductionCents = Math.max(returnedCents + reservedCents, floorCents);
  const boundVerified = new Set(i.identities.flatMap((x) => (x.requestId ? [x.requestId] : [])));
  const snapshotIds = new Set((i.snapshot?.refunds ?? []).map((r) => r.id));
  const reservationsCents = i.requests
    .filter((r) => r.id !== (i.excludeRequestId ?? null) && r.status !== "failed")
    .filter((r) => !boundVerified.has(r.id))
    .filter((r) => !(!i.verified && i.snapshot && r.stripeRefundId && snapshotIds.has(r.stripeRefundId)))
    .reduce((s, r) => s + r.amountCents, 0);
  const eligible = (i.payment.status === "paid" || i.payment.status === "refunded") && i.payment.provider === "stripe" && PI_RE.test(i.payment.providerRef ?? "");
  return {
    capturedCents, returnedCents, reservedCents, floorCents, deductionCents, reservationsCents,
    availableCents: eligible ? Math.max(0, capturedCents - deductionCents - reservationsCents) : 0,
    eligible, held: i.held, verified: i.verified,
  };
}

// ── The hold vocabulary (0359 `catering_refund_issues.code`; CLOSED; every code has an exit) ───────────────
export const REFUND_ISSUE_CODES = [
  "awaiting_identity", "verified_unreadable", "ambiguous_binding", "refund_revived", "released_request_has_refund",
  "unfamiliar_identity", "capture_review", "wrong_charge", "owner_indeterminate", "quarantined_hint", "reserved_not_sent",
  "submission_unconfirmed", "checkout_still_open",
] as const;
export type RefundIssueCode = (typeof REFUND_ISSUE_CODES)[number];
export function isRefundIssueCode(v: unknown): v is RefundIssueCode {
  return typeof v === "string" && (REFUND_ISSUE_CODES as readonly string[]).includes(v);
}
/** The codes that HOLD the payment (no create, no smaller publication, no Release) while open or held. */
export const BLOCKING_REFUND_ISSUE_CODES: readonly RefundIssueCode[] = [
  "awaiting_identity", "verified_unreadable", "ambiguous_binding", "refund_revived", "released_request_has_refund",
  "capture_review", "wrong_charge", "owner_indeterminate",
];

export const REFUND_DISPOSITION_ACTIONS = [
  "resolve_event_floor", "bind_verified_refund", "treat_as_external", "exclude_unrelated_hint", "recheck_after_access",
  "access_still_required", "evidence_reviewed", "keep_held", "reopen_recheck", "release_unsent", "acknowledge_followup",
] as const;
export type RefundDispositionAction = (typeof REFUND_DISPOSITION_ACTIONS)[number];
export function isRefundDispositionAction(v: unknown): v is RefundDispositionAction {
  return typeof v === "string" && (REFUND_DISPOSITION_ACTIONS as readonly string[]).includes(v);
}

/** The panel actions of each code, EXACTLY as 0359 `catering_refund_resolve_anomaly` admits them (the SQL decides). */
const ACTIONS_BY_CODE: Readonly<Record<RefundIssueCode, readonly RefundDispositionAction[]>> = {
  awaiting_identity: ["resolve_event_floor", "recheck_after_access", "access_still_required", "keep_held"],
  verified_unreadable: ["recheck_after_access", "access_still_required", "keep_held"],
  ambiguous_binding: ["bind_verified_refund", "treat_as_external", "keep_held"],
  refund_revived: ["evidence_reviewed", "keep_held"],
  released_request_has_refund: ["evidence_reviewed", "keep_held"],
  unfamiliar_identity: ["evidence_reviewed", "acknowledge_followup"],
  capture_review: ["evidence_reviewed", "recheck_after_access", "keep_held"],
  wrong_charge: ["exclude_unrelated_hint", "recheck_after_access", "keep_held"],
  owner_indeterminate: ["recheck_after_access", "access_still_required", "keep_held"],
  quarantined_hint: ["exclude_unrelated_hint", "acknowledge_followup"],
  reserved_not_sent: ["release_unsent", "acknowledge_followup"],
  submission_unconfirmed: ["acknowledge_followup"],
  checkout_still_open: ["acknowledge_followup"],
};
/** What the panel may offer for an issue in a state. A HELD issue also offers "Reopen and recheck". */
export function dispositionActionsFor(code: RefundIssueCode, state: "open" | "held"): readonly RefundDispositionAction[] {
  return state === "held" ? [...ACTIONS_BY_CODE[code], "reopen_recheck"] : ACTIONS_BY_CODE[code];
}
/** Actions that must carry a bounded evidence reference (0359 raises `evidence_required` without one). */
export const EVIDENCE_REQUIRED_ACTIONS: readonly RefundDispositionAction[] = [
  "resolve_event_floor", "bind_verified_refund", "treat_as_external", "exclude_unrelated_hint", "access_still_required",
  "evidence_reviewed", "keep_held", "release_unsent",
];
/** Actions that name a refund id (`p_target`). */
export const TARGET_REQUIRED_ACTIONS: readonly RefundDispositionAction[] = ["bind_verified_refund", "treat_as_external"];
/** A structured reference to the operator's own reconciliation record. Never free-form customer data. */
export const EVIDENCE_REF_RE = /^[A-Za-z0-9_.:/#-]{1,120}$/;
export const REFUND_TARGET_RE = /^[A-Za-z0-9_]{1,255}$/;
/** Who may disposition (0359 re-checks under the lock): an active MoO with a membership at the shop, or Owner / CGS. */
export const DISPOSITION_ROLES = ["moo", "owner", "cgs"] as const;

export interface RefundDispositionBody {
  issueId: string;
  expectedGeneration: number;
  action: RefundDispositionAction;
  evidenceRef: string | null;
  target: string | null;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The strict body of POST /api/catering/quotes/[id]/refunds/disposition. Anything unknown is refused. */
export function parseDispositionBody(raw: unknown): RefundDispositionBody | "invalid_request" | "evidence_required" {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "invalid_request";
  const b = raw as Record<string, unknown>;
  const allowed = new Set(["issueId", "expectedGeneration", "action", "evidenceRef", "target"]);
  if (Object.keys(b).some((k) => !allowed.has(k))) return "invalid_request";
  if (typeof b.issueId !== "string" || !UUID_RE.test(b.issueId)) return "invalid_request";
  if (typeof b.expectedGeneration !== "number" || !Number.isSafeInteger(b.expectedGeneration) || b.expectedGeneration < 1) return "invalid_request";
  if (!isRefundDispositionAction(b.action)) return "invalid_request";
  const evidenceRef = b.evidenceRef === undefined || b.evidenceRef === null ? null : b.evidenceRef;
  if (evidenceRef !== null && (typeof evidenceRef !== "string" || !EVIDENCE_REF_RE.test(evidenceRef))) return "invalid_request";
  const target = b.target === undefined || b.target === null ? null : b.target;
  if (target !== null && (typeof target !== "string" || !REFUND_TARGET_RE.test(target))) return "invalid_request";
  if (TARGET_REQUIRED_ACTIONS.includes(b.action) && target === null) return "invalid_request";
  if (EVIDENCE_REQUIRED_ACTIONS.includes(b.action) && evidenceRef === null) return "evidence_required";
  return { issueId: b.issueId.toLowerCase(), expectedGeneration: b.expectedGeneration, action: b.action, evidenceRef, target };
}

// ── Named results and refusals of the protected calls ──────────────────────────────────────────────────────
/** Every P0001 name 0359 raises, with the HTTP answer the routes give it. Each code has en + es wording. */
export const REFUND_B1_ERROR_CODES = [
  "refunds_no_epoch", "refunds_recovering", "refunds_draining", "payment_held", "stale_generation", "step_up_stale",
  "evidence_required", "invalid_action", "issue_closed", "stale_evidence", "in_progress", "staff_verification_required",
] as const;
export type RefundB1ErrorCode = (typeof REFUND_B1_ERROR_CODES)[number];

export const REFUND_B1_SQL_REFUSALS: Readonly<Record<string, { status: number; code: string }>> = {
  // The authority and shape checks every worker function repeats under its locks.
  forbidden: { status: 403, code: "forbidden" },
  invalid_request: { status: 400, code: "invalid_request" },
  caller_incompatible: { status: 503, code: "refunds_unavailable" },
  refunds_sealed: { status: 503, code: "refunds_no_epoch" },
  refunds_no_epoch: { status: 503, code: "refunds_no_epoch" },
  refunds_recovering: { status: 503, code: "refunds_recovering" },
  refunds_draining: { status: 503, code: "refunds_draining" },
  payment_held: { status: 409, code: "payment_held" },
  stale_generation: { status: 409, code: "stale_generation" },
  step_up_stale: { status: 403, code: "step_up_stale" },
  evidence_required: { status: 400, code: "evidence_required" },
  invalid_action: { status: 409, code: "invalid_action" },
  issue_closed: { status: 409, code: "issue_closed" },
  stale_evidence: { status: 409, code: "stale_evidence" },
  not_found: { status: 404, code: "not_found" },
};

/** The result of one discovery pass over a payment (0359 `catering_refund_apply`, or why it never got there). */
export const REFUND_PASS_RESULTS = [
  "applied", "incomplete_evidence", "held", "stale_generation", "unsettled_payment", "busy", "deferred", "unavailable",
] as const;
export type RefundPassResult = (typeof REFUND_PASS_RESULTS)[number];

/**
 * A FIRST, POSITIVELY IDENTIFIED, UNEXECUTED refusal of a create (plan B1.1): Stripe named the reason, and the reason
 * is one that means the refund was not made. A closed list of Stripe's documented error codes
 * (docs.stripe.com/error-codes); a blanket inference from "HTTP 4xx" is UNVERIFIED and is never made: every other
 * answer is `uncertain` and keeps the request pending and reserved.
 */
export const UNEXECUTED_REFUSAL_CODES = ["charge_already_refunded", "charge_disputed"] as const;
export function classifyCreateFailure(httpStatus: number, code: string | null | undefined): "refused_unexecuted" | "uncertain" {
  return httpStatus === 400 && (UNEXECUTED_REFUSAL_CODES as readonly string[]).includes(code ?? "") ? "refused_unexecuted" : "uncertain";
}

// ── What a stored request reads as on the panel ────────────────────────────────────────────────────────────
export type StoredRequestState =
  | "reserved_not_sent"       // "Reserved, not sent. Review this payment and use Retry if it should go ahead."
  | "submission_unconfirmed"  // an armed row whose response is lost: a create MAY have left
  | "in_progress"             // a live sender claim
  | "submitted" | "succeeded" | "failed" | "released" | "held";
export function storedRequestState(r: { status: string; armed: boolean; legacyPossiblySent?: boolean; bound: boolean; bindingHold: string | null; claimLive: boolean; lastErrorCode: string | null }): StoredRequestState {
  if (r.bindingHold) return "held";
  if (r.status === "failed") return r.lastErrorCode === "released_no_refund" || r.lastErrorCode === "released_unsent" ? "released" : "failed";
  if (r.status === "succeeded") return "succeeded";
  if (r.status === "submitted") return "submitted";
  if (r.claimLive) return "in_progress";
  // Only a never-armed row can say that no create was sent.
  return r.armed || r.legacyPossiblySent ? "submission_unconfirmed" : "reserved_not_sent";
}

// ── The stored summary (0359 `catering_refund_summary`) as the app reads it ─────────────────────────────────
export interface StoredRefundPayment {
  id: string; kind: "deposit" | "balance" | "full"; status: string; provider: string | null; amount_cents: number; paid_at: string | null;
  captured_cents: number; returned_cents: number; reserved_cents: number; floor_cents: number; deduction_cents: number;
  reservations_cents: number; available_cents: number; eligible: boolean; held: boolean; verified: boolean;
  last_verified_at: string | null; baseline_at: string | null; restricted: boolean; cleanup_owed: boolean;
  cleanup_report: Record<string, unknown> | null;
}
export interface StoredRefundRequest {
  id: string; payment_id: string; amount_cents: number; status: "pending" | "submitted" | "succeeded" | "failed";
  reason_code: string; reason_note: string | null; trigger_kind: string; stripe_status: string | null; last_error_code: string | null;
  attempts: number; first_attempt_at: string | null; requested_at: string; requested_by: string; armed: boolean; bound: boolean;
  /** Attempted before 0359 (no arm could be reconstructed): possibly sent, never "reserved, not sent". */
  legacy_possibly_sent?: boolean;
  binding_hold: string | null; first_reversed_at: string | null; claim_live: boolean;
}
export interface StoredRefundIssue {
  id: string; code: string; state: "open" | "held"; blocking: boolean; payment_id: string; request_id: string | null;
  refund_id: string | null; event_id: string | null; opened_at: string; aged: boolean; disposition: string | null;
  detail: Record<string, unknown>; generation: number | null;
}
export interface StoredRefundQuote {
  quote_id: string; location_id: string; payments: StoredRefundPayment[]; requests: StoredRefundRequest[]; issues: StoredRefundIssue[];
}
export interface StoredRefundSummary { epoch: unknown; quotes: StoredRefundQuote[] }

/** What the panel shows for one open issue. */
export interface RefundIssueView {
  id: string;
  code: RefundIssueCode;
  state: "open" | "held";
  blocking: boolean;
  paymentId: string;
  requestId: string | null;
  refundId: string | null;
  eventId: string | null;
  openedAt: string;
  aged: boolean;
  /** The payment's generation the panel must send back (a stale one is the named conflict `stale_generation`). */
  generation: number | null;
  /** Bounded figures only (cents, counts, a reason word). Never customer data. */
  detail: Record<string, unknown>;
  /** Empty unless the viewer may disposition (MoO at this shop, Owner, CGS). */
  actions: readonly RefundDispositionAction[];
}
