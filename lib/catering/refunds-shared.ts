/**
 * Catering refunds — the client-safe half (no I/O, no server imports, never reads env except through the `env`
 * argument). The server half is lib/catering/refunds.ts; the read is lib/catering/refund-observe.ts; the database
 * authority is migration 0359 (on 0357 + 0358).
 *
 * Juan 2026-11-23 / 2026-11-28 (D1-D3, Part B1 v2): an authorized person refunds a paid catering order from inside the
 * app. Stripe is the truth, kept as a MIRROR: a figure is shown, and a refund offered, only when the payment is
 * `known` (a complete read that started at least 5 minutes after the last sign of change, while the sweep is live).
 * A create is: probe -> a fresh complete read of every eligible payment -> reserve under the payment locks -> per
 * payment a write-once arm -> exactly ONE `POST /v1/refunds` -> record the answer. Anything that is not a 2xx carrying
 * the matching refund is UNCONFIRMED: it stays reserved, is never POSTed again by any path, and is resolved by a read
 * that binds it, or by a person (attach a retrieved refund; or release after 24 h with a stated finding).
 *
 * THERE IS ONE FIGURES DEFINITION, AND IT IS SQL (0359 `catering_refund_payment_figures`). This module only MAPS what
 * the database answered (`refundSummaryFromRpc`); it computes no refundable amount of its own.
 *
 * TWO SWITCHES (server env, passed in): `CATERING_REFUNDS_OBSERVE=1` (GETs only: the sweep, the mirror, the inventory
 * page) and `CATERING_REFUNDS=1` (the panel and creates; a create also needs OBSERVE and the B2 / B3 gate). Both unset
 * = main, byte for byte.
 */
import type { RoleCode } from "@/lib/roles";

// ── The switches ───────────────────────────────────────────────────────────────────────────────────────
/** The panel / create switch. Read on the server only and passed to the client as a prop. UNCHANGED from 0357's step. */
export function cateringRefundsOn(env: Record<string, string | undefined>): boolean {
  return env.CATERING_REFUNDS === "1";
}

/** The observe switch: GETs only (the sweep, the mirror, the inventory page). */
export function cateringRefundsObserveOn(env: Record<string, string | undefined>): boolean {
  return env.CATERING_REFUNDS_OBSERVE === "1";
}

/**
 * THE BUILD half of the B2 / B3 gate (plan DR2): true only in a build that contains Part B2 and Part B3. `false` in
 * Part B1. The DATABASE half is 0359 `catering_refund_parts_ready()` (false until B2 and B3 are applied); a create
 * needs both.
 */
export const REFUND_PARTS_BUILT: boolean = false;

export type RefundGateCode = "refunds_off" | "refunds_unavailable" | "refunds_not_activated";

/**
 * May a refund be CREATED in this deployment? `null` = yes (the database still decides: F4 and every figure).
 *   refunds_off            `CATERING_REFUNDS` is not on (the routes answer this before reading a body, as main does)
 *   refunds_unavailable    `CATERING_REFUNDS_OBSERVE` is not on: nothing can be read, so nothing can be known
 *   refunds_not_activated  this build does not contain B2 and B3 (`REFUND_PARTS_BUILT`)
 * `partsBuilt` is a parameter only so a test can state every combination; callers pass nothing.
 */
export function refundCreateBlock(env: Record<string, string | undefined>, partsBuilt: boolean = REFUND_PARTS_BUILT): RefundGateCode | null {
  if (!cateringRefundsOn(env)) return "refunds_off";
  if (!cateringRefundsObserveOn(env)) return "refunds_unavailable";
  if (!partsBuilt) return "refunds_not_activated";
  return null;
}

/** May a Check / Attach / Release run (GETs and staff resolutions; no create)? `null` = yes. */
export function refundActionBlock(env: Record<string, string | undefined>): Exclude<RefundGateCode, "refunds_not_activated"> | null {
  if (!cateringRefundsOn(env)) return "refunds_off";
  if (!cateringRefundsObserveOn(env)) return "refunds_unavailable";
  return null;
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

/**
 * The request row's stored status (0357's CHECK). v2 reuses it (DR7): `pending` = unresolved; `submitted` = bound to a
 * Stripe refund; `failed` = closed with no refund. `succeeded` is written only by 0357's retired sender.
 */
export const REFUND_STATUSES = ["pending", "submitted", "succeeded", "failed"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const MAX_REFUND_NOTE = 500;

export function isRefundReasonCode(v: unknown): v is RefundReasonCode {
  return typeof v === "string" && (REFUND_REASON_CODES as readonly string[]).includes(v);
}
export function isRefundTrigger(v: unknown): v is RefundTrigger {
  return typeof v === "string" && (REFUND_TRIGGERS as readonly string[]).includes(v);
}

// ── Who may refund (Juan 2026-11-25: GM and AGM too, at a shop they belong to) ─────────────────────────────
/**
 * The catering manager, the AGM, the GM, and level 8+ (MoO, owner, CGS) — the same roles as migration 0358's
 * `catering_refund_actor_ok`, which is the authority. Owner and CGS refund at any shop; the others need an ACTIVE
 * membership at the order's shop (`actorMayRefund`, lib/catering/refunds.ts, and the RPC again under the lock). A ROLE
 * check, never level-only: level 6 also holds the prep and social media managers, who stay out.
 * TWO HOMES, HELD EQUAL: this list and the SQL rule's (tests/catering-refund-0358-migration.test.ts).
 */
export const REFUND_ROLES: readonly RoleCode[] = ["catering_mgr", "agm", "gm", "moo", "owner", "cgs"];
export function canRequestRefund(role: RoleCode): boolean {
  return REFUND_ROLES.includes(role);
}

/**
 * Who may RESOLVE an unconfirmed refund (attach a retrieved refund, or release after 24 h) [DR3]: an active MoO with an
 * active membership at the request's shop, or the owner / CGS at any shop. A ROLE list. TWO HOMES, HELD EQUAL: this
 * list and 0359 `catering_refund_release_role`, which decides again under the lock.
 */
export const REFUND_RELEASE_ROLES: readonly RoleCode[] = ["moo", "owner", "cgs"];
export function canReleaseRefund(role: RoleCode): boolean {
  return REFUND_RELEASE_ROLES.includes(role);
}

// ── Stripe's vocabulary ─────────────────────────────────────────────────────────────────────────────────
/**
 * A Refund object's `status` (docs.stripe.com/api/refunds/object: "This can be `pending`, `requires_action`,
 * `succeeded`, `failed`, or `canceled`") → the request status word 0357 used. Anything else → null. (v2 records
 * Stripe's own status verbatim in the mirror; this is the vocabulary only.)
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

/** Stripe's own `reason` enum is `duplicate | fraudulent | requested_by_customer`; ours maps onto two of them. */
export function stripeRefundReason(code: RefundReasonCode): "duplicate" | "requested_by_customer" | null {
  if (code === "duplicate_charge") return "duplicate";
  if (code === "customer_cancelled" || code === "quote_declined" || code === "event_lost") return "requested_by_customer";
  return null;
}

/** The one Stripe Idempotency-Key spelling for a request row. v2 sends it exactly once per row and never re-uses it. */
export function refundIdempotencyKey(requestId: string): string {
  return `catering-refund:${requestId}`;
}

/** The credential slot a read resolved (`StripeCredentials.source`): this shop's own account, or the shared one. */
export const REFUND_ACCOUNT_SLOTS = ["location", "default"] as const;
export type RefundAccountSlot = (typeof REFUND_ACCOUNT_SLOTS)[number];

// ── Request bodies (strict) ────────────────────────────────────────────────────────────────────────────
export interface RefundRequestBody {
  clientToken: string;
  /** The exact amount the person confirmed — REQUIRED, "Full" included. */
  amountCents: number;
  /** The refundable total the panel SHOWED when the person confirmed [DR6]; the reserve refuses `figures_changed` otherwise. */
  seenRefundableCents: number;
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

function plainObject(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}
function onlyKeys(b: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(b).every((k) => keys.includes(k));
}
/** An optional note: absent / null / blank = null; a string over 500 characters or a non-string = invalid. */
function parseNote(v: unknown): string | null | "invalid" {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return "invalid";
  const t = v.trim();
  if (t.length > MAX_REFUND_NOTE) return "invalid";
  return t.length > 0 ? t : null;
}

export function parseRefundBody(raw: unknown): RefundRequestBody | "invalid_request" | "note_required" | "invalid_amount" {
  const b = plainObject(raw);
  if (!b) return "invalid_request";
  if (!onlyKeys(b, ["clientToken", "amountCents", "seenRefundableCents", "reasonCode", "reasonNote", "trigger"])) return "invalid_request";
  if (!isUuid(b.clientToken)) return "invalid_request";
  if (!isRefundReasonCode(b.reasonCode)) return "invalid_request";
  if (!isRefundTrigger(b.trigger)) return "invalid_request";
  if (typeof b.amountCents !== "number" || !Number.isInteger(b.amountCents)) return "invalid_amount";
  if (b.amountCents <= 0 || b.amountCents > MAX_REFUND_CENTS) return "invalid_amount";
  if (typeof b.seenRefundableCents !== "number" || !Number.isInteger(b.seenRefundableCents)) return "invalid_request";
  if (b.seenRefundableCents < 0 || b.seenRefundableCents > MAX_REFUND_CENTS) return "invalid_request";
  const note = parseNote(b.reasonNote);
  if (note === "invalid") return "invalid_request";
  if (b.reasonCode === "other" && note === null) return "note_required";
  return {
    clientToken: b.clientToken.toLowerCase(),
    amountCents: b.amountCents,
    seenRefundableCents: b.seenRefundableCents,
    reasonCode: b.reasonCode,
    reasonNote: note,
    trigger: b.trigger,
  };
}

/**
 * What Stripe's request log showed for the key `catering-refund:<request id>`, as the person states it (runbook step 6):
 *   no_request         no refund request with that key
 *   request_failed     the request answered with an error and no refund
 *   request_succeeded  a refund was created: ATTACH it, never release (`use_attach`)
 *   unclear            could not tell: nothing is released, the panel sends nothing (tell CC)
 */
export const REFUND_FINDINGS = ["no_request", "request_failed", "request_succeeded", "unclear"] as const;
export type RefundFinding = (typeof REFUND_FINDINGS)[number];
/** The two findings a release may state (0359 F12 refuses every other). */
export const REFUND_RELEASE_FINDINGS = ["no_request", "request_failed"] as const;
export type RefundReleaseFinding = (typeof REFUND_RELEASE_FINDINGS)[number];

export interface RefundReleaseBody {
  finding: RefundReleaseFinding;
  /** The Stripe account the person READ the log in (not pre-selected by the panel). */
  accountSlot: RefundAccountSlot;
  /** The mode they read it in: true = live, false = test. */
  livemode: boolean;
  note: string | null;
}
/** Release body: `{ finding, accountSlot, livemode, note? }` exactly. A `request_succeeded` finding is `use_attach`. */
export function parseReleaseBody(raw: unknown): RefundReleaseBody | "invalid_request" | "use_attach" | "finding_not_releasable" {
  const b = plainObject(raw);
  if (!b || !onlyKeys(b, ["finding", "accountSlot", "livemode", "note"])) return "invalid_request";
  if (typeof b.finding !== "string" || !(REFUND_FINDINGS as readonly string[]).includes(b.finding)) return "invalid_request";
  if (typeof b.accountSlot !== "string" || !(REFUND_ACCOUNT_SLOTS as readonly string[]).includes(b.accountSlot)) return "invalid_request";
  if (typeof b.livemode !== "boolean") return "invalid_request";
  const note = parseNote(b.note);
  if (note === "invalid") return "invalid_request";
  if (b.finding === "request_succeeded") return "use_attach";
  if (b.finding === "unclear") return "finding_not_releasable";
  return { finding: b.finding as RefundReleaseFinding, accountSlot: b.accountSlot as RefundAccountSlot, livemode: b.livemode, note };
}

/** A Stripe refund id as 0359 stores it. */
export const STRIPE_REFUND_ID_RE = /^(re|pyr)_[A-Za-z0-9_]{1,250}$/;
export interface RefundAttachBody {
  refundId: string;
  note: string | null;
}
/** Attach body: `{ refundId, note? }` exactly. */
export function parseAttachBody(raw: unknown): RefundAttachBody | "invalid_request" {
  const b = plainObject(raw);
  if (!b || !onlyKeys(b, ["refundId", "note"])) return "invalid_request";
  if (typeof b.refundId !== "string" || !STRIPE_REFUND_ID_RE.test(b.refundId)) return "invalid_request";
  const note = parseNote(b.note);
  if (note === "invalid") return "invalid_request";
  return { refundId: b.refundId, note };
}

/** Check Stripe body: `{}` exactly (it never carries anything; it never sends). */
export function parseCheckBody(raw: unknown): true | "invalid_request" {
  const b = plainObject(raw);
  return b && Object.keys(b).length === 0 ? true : "invalid_request";
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
/** Every code a refund route may answer. Each has en + es `catering.refunds.error.<code>` (the i18n piece writes them). */
export const REFUND_ERROR_CODES = [
  "refunds_off",
  "refunds_unavailable",
  "refunds_not_activated",
  "forbidden",
  "not_found",
  "invalid_request",
  "invalid_reason",
  "invalid_amount",
  "note_required",
  "note_too_long",
  "quote_not_found",
  "request_not_found",
  "nothing_refundable",
  "over_refundable",
  "token_reused",
  "stripe_not_configured",
  /** The create's 409 when a read did not end complete / was replaced / is no longer current [S11]. */
  "stripe_unchecked",
  /** A release or attach whose read is not the payment's current, fresh, known one. */
  "figures_stale",
  "figures_changed",
  "not_releasable",
  "not_releasable_yet",
  "use_attach",
  "finding_not_releasable",
  "credential_changed",
  "wrong_account",
  "refund_candidates",
  "not_attachable",
  "refund_not_attachable",
  "generic",
] as const;
export type RefundErrorCode = (typeof REFUND_ERROR_CODES)[number];

/**
 * 0357's reserve refusals, by the name it RAISES. KEPT EXACTLY (tests/catering-refund-0357-migration.test.ts holds
 * its keys equal to 0357's raises). v2's are `REFUND_RPC_REFUSALS` below.
 */
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

/** The 0359 functions that refuse by RAISING a named P0001 (the others answer `{ result }`). */
export type RefundRaisingRpc = "reserve" | "release" | "attach";

/**
 * Every named P0001 of 0359's raising functions → the route's status and code, per function. A name not listed here
 * for that function is NOT a refusal: the lib throws it as a defect (500), never as success.
 * `figures_stale` is `stripe_unchecked` on the create [S11] (its text never says the PRESS sent nothing) and
 * `figures_stale` on a release / attach (press Check Stripe, then try again).
 */
export const REFUND_RPC_REFUSALS: Readonly<Record<RefundRaisingRpc, Readonly<Record<string, { status: number; code: RefundErrorCode }>>>> = {
  reserve: {
    ...REFUND_SQL_REFUSALS,
    refunds_not_activated: { status: 503, code: "refunds_not_activated" },
    figures_stale: { status: 409, code: "stripe_unchecked" },
    figures_changed: { status: 409, code: "figures_changed" },
  },
  release: {
    invalid_request: { status: 400, code: "invalid_request" },
    note_too_long: { status: 400, code: "note_too_long" },
    request_not_found: { status: 404, code: "request_not_found" },
    forbidden: { status: 403, code: "forbidden" },
    not_releasable: { status: 409, code: "not_releasable" },
    not_releasable_yet: { status: 409, code: "not_releasable_yet" },
    use_attach: { status: 409, code: "use_attach" },
    finding_not_releasable: { status: 400, code: "finding_not_releasable" },
    figures_stale: { status: 409, code: "figures_stale" },
    credential_changed: { status: 409, code: "credential_changed" },
    wrong_account: { status: 409, code: "wrong_account" },
    refund_candidates: { status: 409, code: "refund_candidates" },
  },
  attach: {
    invalid_request: { status: 400, code: "invalid_request" },
    note_too_long: { status: 400, code: "note_too_long" },
    request_not_found: { status: 404, code: "request_not_found" },
    forbidden: { status: 403, code: "forbidden" },
    not_attachable: { status: 409, code: "not_attachable" },
    figures_stale: { status: 409, code: "figures_stale" },
    credential_changed: { status: 409, code: "credential_changed" },
    refund_not_attachable: { status: 409, code: "refund_not_attachable" },
  },
};

/** The named refusal for `name` raised by `fn`, or null (an own-property lookup: "constructor" is never a refusal). */
export function refundRefusal(fn: RefundRaisingRpc, name: string): { status: number; code: RefundErrorCode } | null {
  const map = REFUND_RPC_REFUSALS[fn];
  return Object.prototype.hasOwnProperty.call(map, name) ? map[name]! : null;
}

// ── The read model the panel draws (mapped from 0359 F7 `catering_refund_summary`) ─────────────────────────
/** F3's state, first match wins: `paused` (observation off or not live) · `never_read` · `dirty` · `known`. */
export const REFUND_PAYMENT_STATES = ["paused", "never_read", "dirty", "known"] as const;
export type RefundPaymentState = (typeof REFUND_PAYMENT_STATES)[number];

/** How a mirrored refund relates to our requests (0359 `catering_refund_claims`). */
export const REFUND_CLAIM_KINDS = ["bound", "none", "candidate", "ambiguous", "mismatch", "unarmed", "released", "duplicate", "foreign"] as const;
export type RefundClaimKind = (typeof REFUND_CLAIM_KINDS)[number];

/**
 * What a request row IS, for the panel:
 *   reserved     pending, not armed (the press is in progress, or died before the arm; the sweep cancels it)
 *   unconfirmed  pending and armed: Stripe has not confirmed it; never sent again; blocks the payment
 *   bound        bound to a Stripe refund (by the POST's answer, a read, or a person's attach)
 *   released     closed by a person with a finding, no refund
 *   never_sent   closed: it was never armed, nothing was sent
 *   closed       any other closed row (a pre-v2 row of 0357's sender)
 */
export const REFUND_REQUEST_VIEWS = ["reserved", "unconfirmed", "bound", "released", "never_sent", "closed"] as const;
export type RefundRequestViewKind = (typeof REFUND_REQUEST_VIEWS)[number];

export function requestView(r: { status: string; armed: boolean; stripeRefundId: string | null; lastErrorCode: string | null }): RefundRequestViewKind {
  if (r.status === "pending") return r.armed ? "unconfirmed" : "reserved";
  if (r.status === "submitted" && r.stripeRefundId) return "bound";
  if (r.status === "failed" && r.lastErrorCode === "released_no_refund") return "released";
  if (r.status === "failed" && r.lastErrorCode === "never_sent") return "never_sent";
  return "closed";
}

export interface RefundStripeRefundView {
  refundId: string;
  amountCents: number;
  currency: string;
  /** Stripe's own status, as last RETRIEVED. */
  status: string | null;
  previousStatus: string | null;
  statusChangedAt: string | null;
  createdAt: string;
  /** The request this refund is bound to (or held by), else null. */
  requestId: string | null;
  /** Did its metadata name a request at all? */
  namesRequest: boolean;
  claimKind: RefundClaimKind;
  /** The unresolved armed request a release-role person could ATTACH this refund to (F16's rule), else null. */
  attachableTo: string | null;
}

export interface RefundRequestView {
  id: string;
  paymentId: string;
  amountCents: number;
  /** The stored status word (DR7); `view` is what it means. */
  status: RefundStatus;
  view: RefundRequestViewKind;
  reasonCode: RefundReasonCode;
  trigger: RefundTrigger;
  requestedBy: string | null;
  requestedByName: string | null;
  requestedAt: string;
  armed: boolean;
  armedAt: string | null;
  /** `armed_at + 24 h` for an unconfirmed row (the earliest a release can happen), else null. */
  releasableAt: string | null;
  stripeRefundId: string | null;
  lastErrorCode: string | null;
  /** Who attached or released it (null = a POST answer or a read bound it, or nobody resolved it). */
  resolvedBy: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  settledAt: string | null;
  /** The credential slot and mode the arm recorded [T5] (null when not armed). */
  armAccountSlot: RefundAccountSlot | null;
  armLivemode: boolean | null;
  /** Armed by 0357's retired sender (no credential fingerprint): only a read can bind it; a person's exit goes to CC. */
  legacy: boolean;
}

export interface RefundPaymentView {
  id: string;
  kind: "deposit" | "balance" | "full";
  status: string;
  amountCents: number;
  paidAt: string | null;
  /** The PaymentIntent (only for an eligible payment): what a person opens in Stripe to resolve a request. */
  paymentIntentId: string | null;
  /** A Stripe-paid row with a PaymentIntent (F3 `o_eligible`). A hand-marked payment is refunded outside the app. */
  eligible: boolean;
  state: RefundPaymentState;
  known: boolean;
  /** When the last complete read started (F3 `o_checked_at`). */
  checkedAt: string | null;
  // Figures: NULL unless known. Unknown is never 0.
  capturedCents: number | null;
  countedCents: number | null;
  inFlightCents: number | null;
  refundableCents: number | null;
  /** An unresolved request holds this payment: no other refund on it until it is resolved. */
  blocked: boolean;
  stripeWhole: boolean | null;
  /** Known, and main's `refunded` status disagrees with Stripe's mirror (B1 never corrects it, D1). */
  disagrees: boolean;
  /** The slot, mode and credential fingerprint of the last complete read (where a person must look) [T5]. */
  accountSlot: RefundAccountSlot | null;
  livemode: boolean | null;
  credentialFp: string | null;
  lastAttemptAt: string | null;
  lastAttemptResult: string | null;
  refunds: RefundStripeRefundView[];
  requests: RefundRequestView[];
}

export interface RefundTotals {
  /** Sums over the eligible payments; ALL null unless every eligible payment is known. */
  capturedCents: number | null;
  countedCents: number | null;
  inFlightCents: number | null;
  refundableCents: number | null;
  /** Paid rows that are not Stripe-paid (refunded outside the app). Always a number. */
  outsideAppCents: number;
}

export interface RefundSummary {
  quoteId: string;
  locationId: string;
  /** The actor may refund here (role + shop). The form is offered only when `refundFormOffered` says so. */
  canRefund: boolean;
  /** The actor may attach / release here (release roles + shop). */
  canRelease: boolean;
  /** The database half of the B2 / B3 gate (F4). */
  partsReady: boolean;
  /** Every eligible payment of the order is known (vacuously true with none). */
  allKnown: boolean;
  eligiblePayments: number;
  /** The order's refundable total; null when any eligible payment is not known. */
  refundableTotalCents: number | null;
  payments: RefundPaymentView[];
  /** Every request of the order, oldest first (also nested per payment). */
  requests: RefundRequestView[];
  totals: RefundTotals;
  generatedAt: string | null;
}

/** Totals over the payments: null figures unless every eligible payment is known. */
export function summarizeTotals(payments: readonly RefundPaymentView[]): RefundTotals {
  const eligible = payments.filter((p) => p.eligible);
  const outsideAppCents = payments.filter((p) => !p.eligible && p.status === "paid").reduce((s, p) => s + p.amountCents, 0);
  if (!eligible.every((p) => p.known)) {
    return { capturedCents: null, countedCents: null, inFlightCents: null, refundableCents: null, outsideAppCents };
  }
  const sum = (f: (p: RefundPaymentView) => number | null) => eligible.reduce((s, p) => s + (f(p) ?? 0), 0);
  return {
    capturedCents: sum((p) => p.capturedCents),
    countedCents: sum((p) => p.countedCents),
    inFlightCents: sum((p) => p.inFlightCents),
    refundableCents: sum((p) => p.refundableCents),
    outsideAppCents,
  };
}

/**
 * Is the Refund form offered? Only when the actor may refund, the database gate is open, EVERY eligible payment of the
 * order is known, and the order's refundable total is above 0 (plan 4.3). Not known = no number, no button.
 */
export function refundFormOffered(s: Pick<RefundSummary, "canRefund" | "partsReady" | "allKnown" | "refundableTotalCents">): boolean {
  return s.canRefund && s.partsReady && s.allKnown && s.refundableTotalCents !== null && s.refundableTotalCents > 0;
}

// ── The F7 mapper (pure; the panel piece and lib/catering/refunds.ts both use it) ──────────────────────────
const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const bool = (v: unknown): boolean => v === true;
const boolOrNull = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const cents = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) ? n : null;
};
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null);
const KINDS = ["deposit", "balance", "full"] as const;

export interface RefundSummaryMapOptions {
  quoteId: string;
  canRefund: boolean;
  canRelease: boolean;
  /** Display names by user id (requested by / resolved by), when the caller read them. */
  names?: Readonly<Record<string, string>>;
}

/**
 * F7's JSON → the read model for ONE quote. null when the answer does not carry that quote (the quote has no family
 * row: the caller answers 404). Unknown values fail CLOSED: an unknown payment state reads `paused` (no figures), an
 * unknown claim kind reads `foreign`, and an unknown request status reads `closed`.
 */
export function refundSummaryFromRpc(raw: unknown, opts: RefundSummaryMapOptions): RefundSummary | null {
  const root = asObj(raw);
  const q = asArr(root.quotes).map(asObj).find((x) => typeof x.quote_id === "string" && x.quote_id.toLowerCase() === opts.quoteId.toLowerCase());
  if (!q) return null;
  const name = (id: string | null) => (id && opts.names ? opts.names[id] ?? null : null);
  const allRequests: RefundRequestView[] = [];
  const payments: RefundPaymentView[] = asArr(q.payments).map(asObj).map((p) => {
    const state = oneOf(REFUND_PAYMENT_STATES, p.state) ?? "paused";
    const known = state === "known" && bool(p.known);
    const fig = (v: unknown) => (known ? cents(v) : null);
    const requests: RefundRequestView[] = asArr(p.requests).map(asObj).map((r) => {
      const status = oneOf(REFUND_STATUSES, r.status) ?? "failed";
      const armed = bool(r.armed);
      const stripeRefundId = str(r.stripe_refund_id);
      const lastErrorCode = str(r.last_error_code);
      const statusKnown = oneOf(REFUND_STATUSES, r.status) !== null;
      const view = statusKnown ? requestView({ status, armed, stripeRefundId, lastErrorCode }) : "closed";
      const requestedBy = str(r.requested_by);
      const resolvedBy = str(r.resolved_by);
      return {
        id: String(r.id ?? ""),
        paymentId: String(p.payment_id ?? ""),
        amountCents: cents(r.amount_cents) ?? 0,
        status,
        view,
        reasonCode: oneOf(REFUND_REASON_CODES, r.reason_code) ?? "other",
        trigger: oneOf(REFUND_TRIGGERS, r.trigger) ?? "panel",
        requestedBy,
        requestedByName: name(requestedBy),
        requestedAt: String(r.requested_at ?? ""),
        armed,
        armedAt: str(r.armed_at),
        releasableAt: view === "unconfirmed" ? str(r.releasable_at) : null,
        stripeRefundId,
        lastErrorCode,
        resolvedBy,
        resolvedByName: name(resolvedBy),
        resolvedAt: str(r.resolved_at),
        settledAt: str(r.settled_at),
        armAccountSlot: oneOf(REFUND_ACCOUNT_SLOTS, r.arm_account_slot),
        armLivemode: boolOrNull(r.arm_livemode),
        legacy: bool(r.legacy),
      };
    });
    allRequests.push(...requests);
    const refunds: RefundStripeRefundView[] = asArr(p.refunds).map(asObj).map((m) => ({
      refundId: String(m.refund_id ?? ""),
      amountCents: cents(m.amount_cents) ?? 0,
      currency: String(m.currency ?? ""),
      status: str(m.status),
      previousStatus: str(m.previous_status),
      statusChangedAt: str(m.status_changed_at),
      createdAt: String(m.created_at ?? ""),
      requestId: str(m.request_id),
      namesRequest: bool(m.names_request),
      claimKind: oneOf(REFUND_CLAIM_KINDS, m.kind) ?? "foreign",
      attachableTo: str(m.attachable_to),
    }));
    const eligible = bool(p.eligible);
    return {
      id: String(p.payment_id ?? ""),
      kind: oneOf(KINDS, p.kind) ?? "full",
      status: String(p.status ?? ""),
      amountCents: cents(p.amount_cents) ?? 0,
      paidAt: str(p.paid_at),
      paymentIntentId: eligible ? str(p.payment_intent) : null,
      eligible,
      state,
      known,
      checkedAt: str(p.checked_at),
      capturedCents: fig(p.captured_cents),
      countedCents: fig(p.counted_cents),
      inFlightCents: fig(p.in_flight_cents),
      refundableCents: fig(p.refundable_cents),
      blocked: bool(p.blocked),
      stripeWhole: known ? boolOrNull(p.stripe_whole) : null,
      disagrees: bool(p.disagrees),
      accountSlot: oneOf(REFUND_ACCOUNT_SLOTS, p.account_slot),
      livemode: boolOrNull(p.livemode),
      credentialFp: str(p.credential_fp),
      lastAttemptAt: str(p.last_attempt_at),
      lastAttemptResult: str(p.last_attempt_result),
      refunds,
      requests,
    };
  });
  allRequests.sort((a, b) => (a.requestedAt < b.requestedAt ? -1 : a.requestedAt > b.requestedAt ? 1 : a.id < b.id ? -1 : 1));
  const allKnown = payments.filter((p) => p.eligible).every((p) => p.known);
  const total = cents(q.refundable_total_cents);
  return {
    quoteId: String(q.quote_id),
    locationId: String(q.location_id ?? ""),
    canRefund: opts.canRefund,
    canRelease: opts.canRelease,
    partsReady: bool(root.parts_ready),
    allKnown,
    eligiblePayments: payments.filter((p) => p.eligible).length,
    refundableTotalCents: allKnown ? total : null,
    payments,
    requests: allRequests,
    totals: summarizeTotals(payments),
    generatedAt: str(root.generated_at),
  };
}
