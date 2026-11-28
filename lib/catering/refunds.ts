/**
 * Catering refunds — the server half. SERVER-ONLY (service-role reads; Stripe calls). Pure rules live in
 * lib/catering/refunds-shared.ts and lib/catering/refund-outcomes-shared.ts; the database authority is migration 0357
 * as extended by 0359 (Part B1). Every caller is behind `CATERING_REFUNDS` (the routes answer 503 `refunds_off`
 * before this module is reached), so nothing here runs while the switch is OFF.
 *
 * WHO MAY DO WHAT is unchanged from Part A (0358): the read floor is 5 at a shop the viewer can see; the refund roles
 * are catering manager, AGM, GM, MoO, Owner, CGS; Owner and CGS refund across shops, the others need an active
 * membership at the order's shop. The database asks again under its locks.
 *
 * THE STAFF PRESS (plan B1.1). Only an authorized staff press can create a Stripe refund, and it does so as
 *     claim  ->  complete discovery and financial check  ->  COMMIT ARM  ->  POST
 *   1. `requestRefund` — the confirm tap. Live admission is checked BEFORE the reserve (and again by the reserve
 *      under the epoch lock). `catering_refund_reserve_admitted` keeps 0357's token replay, locked multi-payment
 *      allocation and destructive `catering.refund.request` audit. A replay reports the original rows.
 *   2. `submitRefundRow` — one row. The sender claim (`catering_refund_claim_admitted`), then a COMPLETE discovery
 *      pass through the one financial writer (lib/catering/refund-reconcile.ts): a refund that already exists for
 *      this request is adopted there and nothing is sent. Then `catering_refund_arm`, which re-checks everything under
 *      the locks and writes `create_armed_at` — the write-once evidence that a POST may have left. Immediately before
 *      network I/O the switch, the actual deadline, the claim and the one-minute resend margin are checked again. The
 *      POST uses the original `catering-refund:<request id>` key and the row's frozen parameters. `catering_refund_finish`
 *      records what was learned; a second pass lets the financial apply decide the outcome from an exact read.
 *   3. `retryRefundRequest` — Retry (re-authorized; a prior live arm inside its original 24-hour window may be used
 *      again after fresh admission in the current live epoch), Check Stripe (GETs only) and ordinary Release (after
 *      the original window, with staff verification of the owning charge, on a fresh complete discovery).
 *   4. `resolveRefundAnomaly` — the operator exits (MoO at the shop, Owner, CGS; fresh Tier B; the database decides).
 *
 * READS ARE STORED STATE. `loadRefundSummary` and `loadLeadRefundables` make ZERO provider calls, enqueue nothing,
 * apply nothing: one `catering_refund_summary` call per batch of quotes. An unchecked or held amount is labelled.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext, isAllLocationsAccess } from "@/lib/locations";
import { audit } from "@/lib/audit";
import { createRefund, StripeError, type StripeRefund } from "@/lib/stripe/client";
import {
  canRequestRefund,
  cateringRefundsOn,
  refundIdempotencyKey,
  requestRetryState,
  resendStillInWindow,
  stripeRefundReason,
  summarizeTotals,
  isRefundReasonCode,
  isRefundTrigger,
  type RefundErrorCode,
  type RefundPaymentView,
  type RefundRequestBody,
  type RefundRequestView,
  type RefundStatus,
  type RefundSummary,
} from "@/lib/catering/refunds-shared";
import {
  DISPOSITION_ROLES,
  classifyCreateFailure,
  createRefusalFor,
  dispositionActionsFor,
  epochAllowsWork,
  isRefundIssueCode,
  parseEpochState,
  storedRequestState,
  type RefundDispositionBody,
  type RefundEpochView,
  type RefundIssueView,
  type StoredRefundQuote,
  type StoredRefundSummary,
} from "@/lib/catering/refund-outcomes-shared";
import { RefundReconcileError, loadRefundEpoch, refundRpc, runRefundPass, type RefundPassOutcome } from "@/lib/catering/refund-reconcile";
import type { AuthContext } from "@/lib/session";

export * from "@/lib/catering/refunds-shared";

type ServiceClient = ReturnType<typeof getServiceRoleClient>;

/** Viewing the refund panel: the payments read floor (shift lead+), at a shop the viewer can see. */
export const REFUND_READ_MIN = 5;

/** The route budget of a money mutation (its `maxDuration`), and what is kept back to finish (plan B1.6). */
export const REFUND_ROUTE_BUDGET_MS = 120_000;
export const REFUND_FINISH_RESERVE_MS = 15_000;

export class CateringRefundError extends Error {
  constructor(public status: number, public code: RefundErrorCode, public detail?: Record<string, unknown>) {
    super(code);
    this.name = "CateringRefundError";
  }
}

/** A named database refusal or a missing schema, as the routes answer it. */
function asRefundError(e: unknown): never {
  if (e instanceof RefundReconcileError) {
    // The reserve names what IS refundable in the error's detail (0357's contract, kept).
    const withTotal = (e.code === "payment_held" || e.code === "over_refundable") && e.detail && /^\d+$/.test(e.detail);
    throw new CateringRefundError(e.status, e.code as RefundErrorCode, withTotal ? { refundableCents: Number(e.detail) } : undefined);
  }
  throw e;
}

function canSee(actor: AuthContext, locationId: string): boolean {
  return isAllLocationsAccess({ role: actor.user.role, locations: actor.locations }) || actor.locations.includes(locationId);
}

/** The app half of the refund gate. 0358's `catering_refund_actor_ok` decides again under the lock. */
export function actorMayRefund(actor: AuthContext, locationId: string): boolean {
  return canRequestRefund(actor.user.role) && lockLocationContext({ role: actor.user.role, locations: actor.locations }, locationId);
}

/** The app half of the disposition gate: an active MoO with a membership at the shop, or Owner / CGS (0359 re-checks). */
export function actorMayDisposition(actor: AuthContext, locationId: string): boolean {
  return (DISPOSITION_ROLES as readonly string[]).includes(actor.user.role) && lockLocationContext({ role: actor.user.role, locations: actor.locations }, locationId);
}

interface QuoteRow { id: string; location_id: string; root_id: string | null }
interface RequestRow {
  id: string;
  payment_id: string;
  quote_id: string;
  location_id: string;
  amount_cents: number;
  reason_code: string;
  status: RefundStatus;
  stripe_refund_id: string | null;
  last_error_code: string | null;
  attempts: number;
  first_attempt_at: string | null;
  requested_at: string;
}
const REQUEST_COLS = "id, payment_id, quote_id, location_id, amount_cents, reason_code, status, stripe_refund_id, last_error_code, attempts, first_attempt_at, requested_at";

async function loadQuote(sb: ServiceClient, quoteId: string): Promise<QuoteRow | null> {
  const { data, error } = await sb.from("catering_quotes").select("id, location_id, root_id").eq("id", quoteId).maybeSingle<QuoteRow>();
  if (error) throw new Error(`refunds quote: ${error.message}`);
  return data ?? null;
}

async function loadRequest(sb: ServiceClient, requestId: string): Promise<RequestRow | null> {
  const { data, error } = await sb.from("catering_refund_requests").select(REQUEST_COLS).eq("id", requestId).maybeSingle<RequestRow>();
  if (error) {
    if (["PGRST205", "42P01"].includes(error.code ?? "")) throw new CateringRefundError(503, "refunds_unavailable");
    throw new Error(`refund request: ${error.message}`);
  }
  return data ?? null;
}

// ── Read: stored state only ───────────────────────────────────────────────────────────────────────────────
async function loadStored(sb: ServiceClient, quoteIds: string[]): Promise<StoredRefundSummary | null> {
  try {
    return await refundRpc<StoredRefundSummary>(sb, "catering_refund_summary", { p_quote_ids: quoteIds });
  } catch (e) {
    if (e instanceof RefundReconcileError && e.code === "refunds_unavailable") return null; // 0359 is not installed (or not ours)
    throw e;
  }
}

function buildSummary(actor: AuthContext, quote: QuoteRow, stored: StoredRefundQuote | undefined, epoch: RefundEpochView, installed: boolean, names: Map<string, string>, nowMs: number): RefundSummary {
  const mayDisposition = actorMayDisposition(actor, quote.location_id);
  const payments: RefundPaymentView[] = (stored?.payments ?? []).map((p) => ({
    id: p.id,
    kind: p.kind,
    status: p.status,
    provider: p.provider,
    amountCents: Number(p.amount_cents),
    paidAt: p.paid_at,
    figures: {
      capturedCents: Number(p.captured_cents),
      refundedCents: Number(p.deduction_cents),
      inFlightCents: Number(p.reservations_cents),
      // A held payment gives nothing until its hold is resolved; the figure it WOULD give is still stored.
      refundableCents: p.held ? 0 : Number(p.available_cents),
      eligible: p.eligible,
    },
    held: p.held,
    verified: p.verified,
    lastVerifiedAt: p.last_verified_at,
    returnedCents: Number(p.returned_cents),
    reservedCents: Number(p.reserved_cents),
    floorCents: Number(p.floor_cents),
    cleanupOwed: p.cleanup_owed,
  }));
  const requests: RefundRequestView[] = (stored?.requests ?? []).map((r) => ({
    id: r.id,
    paymentId: r.payment_id,
    amountCents: Number(r.amount_cents),
    status: r.status,
    reasonCode: isRefundReasonCode(r.reason_code) ? r.reason_code : "other",
    reasonNote: r.reason_note,
    trigger: isRefundTrigger(r.trigger_kind) ? r.trigger_kind : "panel",
    stripeStatus: r.stripe_status,
    lastErrorCode: r.last_error_code,
    attempts: r.attempts,
    requestedAt: r.requested_at,
    requestedByName: names.get(r.requested_by) ?? null,
    ...requestRetryState({ status: r.status, firstAttemptAt: r.first_attempt_at, requestedAt: r.requested_at }, nowMs),
    state: storedRequestState({ status: r.status, armed: r.armed, bound: r.bound, bindingHold: r.binding_hold, claimLive: r.claim_live, lastErrorCode: r.last_error_code }),
    armed: r.armed,
    bindingHold: r.binding_hold,
  }));
  const issues: RefundIssueView[] = (stored?.issues ?? []).flatMap((i) =>
    isRefundIssueCode(i.code)
      ? [{
          id: i.id, code: i.code, state: i.state, blocking: i.blocking, paymentId: i.payment_id, requestId: i.request_id,
          refundId: i.refund_id, eventId: i.event_id, openedAt: i.opened_at, aged: i.aged, generation: i.generation == null ? null : Number(i.generation),
          detail: i.detail ?? {},
          actions: mayDisposition && epochAllowsWork(epoch) ? dispositionActionsFor(i.code, i.state) : [],
        }]
      : []);
  return {
    quoteId: quote.id,
    locationId: quote.location_id,
    canRefund: installed && createRefusalFor(epoch) === null && actorMayRefund(actor, quote.location_id),
    installed,
    payments,
    requests,
    totals: summarizeTotals(payments),
    // The figures are stored state: any eligible payment no complete pass has published yet is "unchecked".
    stripeUnchecked: payments.some((p) => p.figures.eligible && p.verified === false),
    epoch,
    issues,
  };
}

async function requesterNames(sb: ServiceClient, stored: StoredRefundSummary | null): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const people = [...new Set((stored?.quotes ?? []).flatMap((q) => q.requests.map((r) => r.requested_by)))];
  if (people.length > 0) {
    const { data } = await sb.from("users").select("id, name").in("id", people).returns<Array<{ id: string; name: string | null }>>();
    for (const u of data ?? []) if (u.name) names.set(u.id, u.name);
  }
  return names;
}

export async function loadRefundSummary(actor: AuthContext, quoteId: string, nowMs: number = Date.now()): Promise<RefundSummary> {
  if (getRoleLevel(actor.user.role) < REFUND_READ_MIN) throw new CateringRefundError(403, "forbidden");
  const sb = getServiceRoleClient();
  const quote = await loadQuote(sb, quoteId);
  if (!quote || !canSee(actor, quote.location_id)) throw new CateringRefundError(404, "not_found");
  const stored = await loadStored(sb, [quote.id]);
  const epoch: RefundEpochView = stored ? parseEpochState(stored.epoch) : { state: "none", epochId: null, callerOk: false };
  return buildSummary(actor, quote, stored?.quotes.find((q) => q.quote_id === quote.id), epoch, stored !== null, await requesterNames(sb, stored), nowMs);
}

// ── Write: the confirm tap ────────────────────────────────────────────────────────────────────────────────
export interface RefundAttemptResult {
  id: string;
  paymentId: string;
  amountCents: number;
  status: RefundStatus;
  /** Set when this attempt did not end in a verified Stripe outcome (see `submitRefundRow`). */
  errorCode: string | null;
}

/** A clock anchored at the press's ENTRY: `atMs` is the instant the press started; every reading adds the real time since. */
export function anchoredClock(atMs: number = Date.now()): () => number {
  const startedReal = Date.now();
  return () => atMs + (Date.now() - startedReal);
}

/** Refuse a create (Confirm, Retry-create) unless a LIVE epoch admits this build. Before any reserve or claim. */
async function assertCreateAdmitted(sb: ServiceClient): Promise<void> {
  const epoch = await loadRefundEpoch(sb);
  const refusal = createRefusalFor(epoch);
  if (refusal) throw new CateringRefundError(refusal.status, refusal.code);
}

export async function requestRefund(
  actor: AuthContext,
  quoteId: string,
  body: RefundRequestBody,
  deadlineMs: number = Date.now() + REFUND_ROUTE_BUDGET_MS - REFUND_FINISH_RESERVE_MS,
): Promise<{ replay: boolean; results: RefundAttemptResult[] }> {
  const sb = getServiceRoleClient();
  const quote = await loadQuote(sb, quoteId);
  if (!quote || !canSee(actor, quote.location_id)) throw new CateringRefundError(404, "not_found");
  if (!actorMayRefund(actor, quote.location_id)) throw new CateringRefundError(403, "forbidden");
  await assertCreateAdmitted(sb);

  let reserved: { replay: boolean; location_id: string; requests: Array<{ id: string; payment_id: string; amount_cents: number; status: RefundStatus }> };
  try {
    reserved = await refundRpc(sb, "catering_refund_reserve_admitted", {
      p_actor_id: actor.user.id,
      p_session_id: actor.session.id,
      p_quote_id: quoteId,
      p_client_token: body.clientToken,
      p_amount_cents: body.amountCents,
      p_reason_code: body.reasonCode,
      p_reason_note: body.reasonNote,
      p_trigger: body.trigger,
    });
  } catch (e) {
    return asRefundError(e); // 0357's named refusals (kept by the admitted reserve) and Part B1's, each by name
  }

  if (reserved.replay) {
    // The same tap again: report what it made. Stripe is NOT asked a second time.
    return { replay: true, results: reserved.requests.map((r) => ({ id: r.id, paymentId: r.payment_id, amountCents: Number(r.amount_cents), status: r.status, errorCode: null })) };
  }
  const results: RefundAttemptResult[] = [];
  for (const r of reserved.requests) {
    // A press that dies between rows leaves the later ones reserved and UNARMED: the sweep raises them
    // (`reserved_not_sent`) and never sends them.
    results.push(await submitRefundRow(sb, actor, r.id, anchoredClock(), deadlineMs));
  }
  return { replay: false, results };
}

// ── One row, one Stripe request ───────────────────────────────────────────────────────────────────────────
function result(row: RequestRow, status: RefundStatus, errorCode: string | null): RefundAttemptResult {
  return { id: row.id, paymentId: row.payment_id, amountCents: Number(row.amount_cents), status, errorCode };
}

function stripeOutcomeAudit(actor: AuthContext, row: RequestRow, outcome: Record<string, unknown>): void {
  void audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "catering.refund.stripe_result",
    resourceTable: "catering_refund_requests",
    resourceId: row.id,
    metadata: { quote_id: row.quote_id, payment_id: row.payment_id, location_id: row.location_id, amount_cents: Number(row.amount_cents), ...outcome },
    ipAddress: null,
    userAgent: null,
  });
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

interface Claim { claimed: boolean; reason?: string; status?: RefundStatus; claim_token?: string; claimed_until?: string; first_attempt_at?: string | null; armed_before?: boolean }
interface Arm { result: string; armed_before?: boolean; claimed_until?: string; first_attempt_at?: string }

type FinishOutcome = "created" | "refused_unexecuted" | "local_refusal" | "uncertain" | "not_sent";
async function finish(sb: ServiceClient, row: RequestRow, claimToken: string, outcome: FinishOutcome, refundId: string | null, code: string | null, message: string | null): Promise<string> {
  const out = await refundRpc<{ result: string }>(sb, "catering_refund_finish", {
    p_request_id: row.id, p_claim_token: claimToken, p_outcome: outcome, p_refund_id: refundId,
    p_error_code: code ? code.slice(0, 80) : null, p_error_message: message ? message.slice(0, 500) : null,
  });
  return out.result;
}

/** The row as it stands NOW, with the code THIS press earned (a named refusal keeps its name; a clean outcome has none). */
async function reread(sb: ServiceClient, row: RequestRow, errorCode: string | null): Promise<RefundAttemptResult> {
  const now = (await loadRequest(sb, row.id)) ?? row;
  return result(now, now.status, errorCode);
}
/** The same, for a code that only describes a row STILL pending: a row that moved on speaks through its status. */
async function rereadPending(sb: ServiceClient, row: RequestRow, errorCode: string): Promise<RefundAttemptResult> {
  const now = (await loadRequest(sb, row.id)) ?? row;
  return result(now, now.status, now.status === "pending" ? errorCode : null);
}

/**
 * Stripe returned a refund id: DURABLE EVIDENCE. Registering it is retried; if the database still cannot take it, the
 * failure is OURS (never recorded as a Stripe failure): the row stays armed and pending, the sweep finds the refund by
 * PaymentIntent within minutes, and the id is logged for the operator (a refund id is not a secret).
 */
async function registerCreated(sb: ServiceClient, row: RequestRow, token: string, refundId: string): Promise<void> {
  let last: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await finish(sb, row, token, "created", refundId, null, null);
      return;
    } catch (e) {
      last = e;
    }
  }
  console.error(`[catering refunds] refund ${refundId} was created for request ${row.id} but could not be registered:`, last instanceof Error ? last.message : last);
  throw last;
}

/**
 * Send ONE request row to Stripe, or find what an earlier send did. Never throws for a Stripe problem: the row
 * records it. Throws for a named admission refusal or a database failure (the row is then still `pending` and its
 * claim expires by itself).
 */
export async function submitRefundRow(
  sb: ServiceClient,
  actor: AuthContext,
  requestId: string,
  clock: () => number = anchoredClock(),
  deadlineMs: number = Date.now() + REFUND_ROUTE_BUDGET_MS - REFUND_FINISH_RESERVE_MS,
): Promise<RefundAttemptResult> {
  const row = await loadRequest(sb, requestId);
  if (!row) throw new CateringRefundError(404, "not_found");
  if (row.status !== "pending") return result(row, row.status, null);
  try {
    // After the deadline only GETs are performed: the press checks Stripe and never claims a send.
    if (requestRetryState({ status: row.status, firstAttemptAt: row.first_attempt_at, requestedAt: row.requested_at }, clock()).needsReconcile) {
      await runRefundPass(sb, row.payment_id, { deadlineMs });
      return rereadPending(sb, row, "needs_reconcile");
    }

    // THE CLAIM: one sender per row at a time. A press that does not get it sends nothing.
    const claim = await refundRpc<Claim>(sb, "catering_refund_claim_admitted", { p_actor_id: actor.user.id, p_session_id: actor.session.id, p_request_id: row.id });
    if (!claim.claimed || !claim.claim_token) return result(row, claim.status ?? row.status, claim.reason === "payment_held" ? "payment_held" : claim.reason === "in_progress" ? "in_progress" : null);
    const token = claim.claim_token;
    const release = (code: FinishOutcome, c: string, m: string) => finish(sb, row, token, code, null, c, m);

    // COMPLETE DISCOVERY AND THE FINANCIAL CHECK. A refund that already exists for this request is adopted HERE,
    // by the financial writer, and nothing is sent.
    const pass = await runRefundPass(sb, row.payment_id, { deadlineMs });
    if (pass.result !== "applied" || !pass.owner || pass.generation == null) {
      await release("not_sent", "check_incomplete", `Stripe could not be checked (${pass.result}${pass.reason ? `: ${pass.reason}` : ""})`);
      stripeOutcomeAudit(actor, row, { outcome: "pending", error_code: "check_incomplete", pass: pass.result, reason: pass.reason ?? null });
      return rereadPending(sb, row, pass.result === "held" ? "payment_held" : "stripe_unreachable");
    }
    const after = await loadRequest(sb, row.id);
    if (!after || after.status !== "pending") {
      stripeOutcomeAudit(actor, row, { outcome: after?.status ?? "unknown", how: "found" });
      return result(after ?? row, after?.status ?? row.status, null);
    }

    // THE ARM: the last database step before network I/O.
    const arm = await refundRpc<Arm>(sb, "catering_refund_arm", {
      p_actor_id: actor.user.id, p_session_id: actor.session.id, p_request_id: row.id, p_claim_token: token,
      p_expected_generation: pass.generation, p_payment_intent: pass.owner.paymentIntentId, p_charge: pass.owner.chargeId, p_livemode: pass.owner.livemode,
    });
    if (arm.result !== "armed") {
      // Nothing left for this press. A refusal on OUR side closes a row that was never armed (the amount is
      // released); anything that may already have been sent stays pending and reserved.
      const local = arm.result === "over_refundable" || arm.result === "wrong_charge";
      const closed = await release(local ? "local_refusal" : "not_sent", arm.result === "over_refundable" ? "over_charge_remaining" : arm.result, `Not sent: ${arm.result}`);
      stripeOutcomeAudit(actor, row, { outcome: closed === "closed" ? "failed" : "pending", error_code: arm.result });
      return reread(sb, row, arm.result === "window_closed" ? "needs_reconcile" : arm.result === "already_exists" ? "updated_by_stripe"
        : arm.result === "over_refundable" ? "over_charge_remaining" : arm.result);
    }

    // IMMEDIATELY BEFORE NETWORK I/O: the live switch, the actual deadline, the claim, the one-minute resend margin.
    const realNow = Math.max(clock(), Date.now());
    const claimLeft = Date.parse(arm.claimed_until ?? claim.claimed_until ?? "") - Date.now();
    const callBudget = Math.min(20_000, claimLeft - 5_000, deadlineMs - Date.now());
    if (!cateringRefundsOn(process.env) || !resendStillInWindow(arm.first_attempt_at ?? claim.first_attempt_at ?? null, row.requested_at, realNow) || !(callBudget >= 1_000)) {
      await release("not_sent", "not_sent_deadline", "The switch, the 24-hour window, the claim or the route budget ended before the send");
      stripeOutcomeAudit(actor, row, { outcome: "pending", error_code: "not_sent_deadline" });
      return rereadPending(sb, row, "needs_reconcile");
    }

    const reasonCode = isRefundReasonCode(row.reason_code) ? row.reason_code : "other";
    let refund: StripeRefund;
    try {
      // The ORIGINAL key and the row's frozen parameters, whatever the quote has become since. ONLY the POST is
      // inside this try: a failure of ours after it must never be recorded as Stripe's.
      refund = await createRefund(
        pass.owner.account.secretKey,
        { paymentIntentId: pass.owner.paymentIntentId, amountCents: Number(row.amount_cents), reason: stripeRefundReason(reasonCode), metadata: { refund_request_id: row.id, quote_id: row.quote_id, payment_id: row.payment_id } },
        refundIdempotencyKey(row.id),
        callBudget,
      );
    } catch (e) {
      const status = e instanceof StripeError ? e.status : 0;
      const code = e instanceof StripeError ? e.code : "network_error";
      const kind = classifyCreateFailure(status, code);
      const closed = await finish(sb, row, token, kind, null, code, errText(e));
      stripeOutcomeAudit(actor, row, { outcome: closed === "closed" ? "failed" : "pending", error_code: code, http_status: status, classified: kind, recorded: closed });
      // A press that lost its claim reports the row as another press left it.
      return reread(sb, row, closed === "claim_lost" ? "updated_by_stripe" : code);
    }
    // A returned refund id is durable evidence even if the claim expired: register it, retrieve it, apply.
    await registerCreated(sb, row, token, refund.id);
    stripeOutcomeAudit(actor, row, { outcome: "created", how: arm.armed_before ? "created_on_retry" : "created", stripe_refund_id: refund.id, attempt: row.attempts + 1 });
    await runRefundPass(sb, row.payment_id, { deadlineMs }).catch(() => ({ result: "unavailable" as const } satisfies RefundPassOutcome));
    return rereadPending(sb, row, "submission_unconfirmed");
  } catch (e) {
    return asRefundError(e);
  }
}

// ── Retry / Check Stripe / Release ────────────────────────────────────────────────────────────────────────
export async function retryRefundRequest(
  actor: AuthContext,
  quoteId: string,
  requestId: string,
  nowMs: number = Date.now(),
  /** `retry` = send / Check Stripe; `release` = close a past-24 h row Stripe shows no refund for. */
  mode: "retry" | "release" = "retry",
  /** Release only: the person confirms they looked at the owning charge in Stripe. */
  staffVerified: boolean = false,
  deadlineMs: number = Date.now() + REFUND_ROUTE_BUDGET_MS - REFUND_FINISH_RESERVE_MS,
): Promise<RefundAttemptResult> {
  const clock = anchoredClock(nowMs);
  const sb = getServiceRoleClient();
  const quote = await loadQuote(sb, quoteId);
  if (!quote || !canSee(actor, quote.location_id)) throw new CateringRefundError(404, "not_found");
  if (!actorMayRefund(actor, quote.location_id)) throw new CateringRefundError(403, "forbidden");
  const row = await loadRequest(sb, requestId);
  const stored = await loadStored(sb, [quote.id]);
  if (!stored) throw new CateringRefundError(503, "refunds_unavailable");
  const family = stored.quotes.find((q) => q.quote_id === quote.id);
  // The request must belong to this order's payment family (it was authorized for exactly that).
  if (!row || !family || !family.payments.some((p) => p.id === row.payment_id)) throw new CateringRefundError(404, "not_found");
  const epoch = parseEpochState(stored.epoch);
  if (!epochAllowsWork(epoch)) {
    const refusal = createRefusalFor(epoch);
    throw new CateringRefundError(refusal?.status ?? 503, refusal?.code ?? "refunds_no_epoch");
  }
  // The SQL actor rule is the authority; a Check writes only outcomes, so it is asked here too.
  const { data: okData, error: okErr } = await sb.rpc("catering_refund_actor_ok", { p_actor_id: actor.user.id, p_shop_id: row.location_id });
  if (okErr) throw new Error(`catering_refund_actor_ok: ${okErr.message}`);
  if (okData !== true) throw new CateringRefundError(403, "forbidden");

  try {
    if (row.status === "pending") {
      const state = requestRetryState({ status: row.status, firstAttemptAt: row.first_attempt_at, requestedAt: row.requested_at }, clock());
      if (mode === "release") {
        if (!state.needsReconcile) throw new CateringRefundError(409, "not_releasable");
        // A fresh complete discovery, then the fenced Release on that same generation.
        const pass = await runRefundPass(sb, row.payment_id, { deadlineMs });
        if (pass.result !== "applied" || pass.generation == null) return rereadPending(sb, row, pass.result === "held" ? "payment_held" : "stripe_unreachable");
        const out = await refundRpc<{ result: string }>(sb, "catering_refund_release", {
          p_actor_id: actor.user.id, p_session_id: actor.session.id, p_request_id: row.id, p_expected_generation: pass.generation, p_staff_verified: staffVerified,
        });
        stripeOutcomeAudit(actor, row, { outcome: out.result === "released" ? "released" : "pending", error_code: out.result === "released" ? "released_no_refund" : out.result });
        if (out.result === "staff_verification_required") throw new CateringRefundError(409, "staff_verification_required");
        if (out.result === "not_releasable") throw new CateringRefundError(409, "not_releasable");
        return reread(sb, row, out.result === "released" ? "released_no_refund" : out.result === "has_refund" ? "updated_by_stripe" : out.result);
      }
      if (state.needsReconcile) {
        // Past the 24-hour window nothing is SENT: Check Stripe is GETs only.
        const pass = await runRefundPass(sb, row.payment_id, { deadlineMs });
        return rereadPending(sb, row, pass.result === "applied" ? "needs_reconcile" : "stripe_unreachable");
      }
      // A Retry may create: live admission first, before any claim.
      const refusal = createRefusalFor(epoch);
      if (refusal) throw new CateringRefundError(refusal.status, refusal.code);
      return await submitRefundRow(sb, actor, row.id, clock, deadlineMs);
    }
    if (mode === "release") throw new CateringRefundError(409, "not_releasable");
    if (row.status === "submitted") {
      // A submitted request needs status retrieval only.
      const pass = await runRefundPass(sb, row.payment_id, { deadlineMs });
      return reread(sb, row, pass.result === "applied" ? null : "stripe_unreachable");
    }
    throw new CateringRefundError(409, "not_retryable");
  } catch (e) {
    return asRefundError(e);
  }
}

// ── Operator disposition ──────────────────────────────────────────────────────────────────────────────────
/**
 * One panel action on one open issue of this order. The route has already required same-origin, an active session
 * and a fresh Tier B; the role and shop are checked here and AGAIN by `catering_refund_resolve_anomaly`, which takes
 * the actor and the freshness from the session row itself. A recheck action runs one pass straight away (GETs only).
 */
export async function resolveRefundAnomaly(
  actor: AuthContext,
  quoteId: string,
  body: RefundDispositionBody,
  deadlineMs: number = Date.now() + REFUND_ROUTE_BUDGET_MS - REFUND_FINISH_RESERVE_MS,
): Promise<{ result: string; state: string; generation: number }> {
  const sb = getServiceRoleClient();
  const quote = await loadQuote(sb, quoteId);
  if (!quote || !canSee(actor, quote.location_id)) throw new CateringRefundError(404, "not_found");
  if (!actorMayDisposition(actor, quote.location_id)) throw new CateringRefundError(403, "forbidden");
  const stored = await loadStored(sb, [quote.id]);
  if (!stored) throw new CateringRefundError(503, "refunds_unavailable");
  const issue = stored.quotes.find((q) => q.quote_id === quote.id)?.issues.find((i) => i.id === body.issueId);
  // The issue must be one of THIS order's: another payment's evidence cannot be dispositioned from here.
  if (!issue) throw new CateringRefundError(404, "not_found");
  try {
    const out = await refundRpc<{ result: string; state: string; generation: number }>(sb, "catering_refund_resolve_anomaly", {
      p_issue_id: body.issueId, p_expected_generation: body.expectedGeneration, p_action: body.action,
      p_evidence_ref: body.evidenceRef, p_session_id: actor.session.id, p_target: body.target,
    });
    if (body.action === "recheck_after_access" || body.action === "reopen_recheck" || body.action === "bind_verified_refund" || body.action === "treat_as_external" || body.action === "exclude_unrelated_hint") {
      await runRefundPass(sb, issue.payment_id, { deadlineMs }).catch(() => null);
    }
    return { result: out.result, state: out.state, generation: Number(out.generation) };
  } catch (e) {
    return asRefundError(e);
  }
}

// ── The pipeline banner ───────────────────────────────────────────────────────────────────────────────────
/** Lead -> the live quotes of its order(s) with money still refundable (the pipeline's "Refund" banner). */
export interface LeadRefundable {
  quoteId: string;
  refundableCents: number;
  paidCents: number;
  /** The stored figures of this order were never verified by a complete pass, or are held: label them. */
  stripeUnchecked: boolean;
  held?: boolean;
}
/** How many quotes one stored read covers (0359 bounds the batch at 60). */
export const LEAD_REFUND_BATCH = 50;

export async function loadLeadRefundables(actor: AuthContext, leadId: string): Promise<LeadRefundable[]> {
  if (getRoleLevel(actor.user.role) < REFUND_READ_MIN) throw new CateringRefundError(403, "forbidden");
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("catering_quotes")
    .select("id, location_id, root_id")
    .eq("pipeline_id", leadId)
    .is("superseded_at", null)
    .returns<QuoteRow[]>();
  if (error) throw new Error(`refunds lead quotes: ${error.message}`);
  const quotes = (data ?? []).filter((q) => canSee(actor, q.location_id)).sort((a, b) => (a.id < b.id ? -1 : 1));
  const out: LeadRefundable[] = [];
  // ONE stored read per stable batch of quote ids, whatever the number of quotes in it. Zero provider calls.
  for (let i = 0; i < quotes.length; i += LEAD_REFUND_BATCH) {
    const batch = quotes.slice(i, i + LEAD_REFUND_BATCH);
    const stored = await loadStored(sb, batch.map((q) => q.id));
    const epoch: RefundEpochView = stored ? parseEpochState(stored.epoch) : { state: "none", epochId: null, callerOk: false };
    for (const q of batch) {
      const s = buildSummary(actor, q, stored?.quotes.find((x) => x.quote_id === q.id), epoch, stored !== null, new Map(), Date.now());
      const held = s.payments.some((p) => p.held === true);
      if (s.totals.paidCents > 0 || s.stripeUnchecked || held) {
        out.push({ quoteId: q.id, refundableCents: s.totals.refundableCents, paidCents: s.totals.paidCents, stripeUnchecked: s.stripeUnchecked === true, held });
      }
    }
  }
  return out;
}
