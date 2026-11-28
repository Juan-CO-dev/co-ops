/**
 * Catering refunds — the server half (Part B1 v2). SERVER-ONLY. Pure rules and the read model live in
 * lib/catering/refunds-shared.ts; the read is lib/catering/refund-observe.ts; the database authority is migration 0359
 * (its header and each function's comment block are the contract).
 *
 * NOTHING HERE RUNS WHILE `CATERING_REFUNDS` IS OFF: every route answers 503 `refunds_off` before it calls this module
 * (main's bytes), and every export below refuses again by its own gate.
 *
 * THE ONE SEND (`requestRefund`), with ONE deadline (the route's 120 s less 20 s):
 *   1. the gate (`refundCreateBlock`), the quote, `canSee` (404), `actorMayRefund` (403);
 *   2. F8 PROBE (`p_reads` null): a replay returns the original rows (no read, no POST);
 *   3. a fresh `runRefundRead` of every payment the probe named (25 s in all);
 *   4. ONE F8 call with whatever tokens those reads produced [R7]: `replay`, a named refusal, or the reserved rows;
 *   5. per reserved row, in order, only while 35 s are left (else F11): the PaymentIntent the read proved must be the
 *      one the reserve returned [P3-9]; F9 (the write-once arm, every check again under the locks, 5 s of lock wait);
 *      then exactly ONE `createRefund` through the credential THAT read resolved, and only when its fingerprint is
 *      the one the arm recorded; then F10 records the answer. After the first row that does not end `created`, no
 *      further row is armed (F11 each);
 *   6. best effort: a read again of every payment a POST went to (it mirrors and binds what exists);
 *   7. one `catering.refund.stripe_result` audit row per row.
 * THERE IS NO CODE PATH FROM ANY OUTCOME BACK TO THE POST FOR THE SAME ROW: the loop visits each reserved row once,
 * and nothing else in this module or any module it calls makes a POST.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext, isAllLocationsAccess } from "@/lib/locations";
import { audit } from "@/lib/audit";
import { createRefund, type CreateRefundOutcome } from "@/lib/stripe/client";
import {
  RefundsUnavailableError,
  refundSchemaMissing,
  runRefundRead,
  type RefundReadOutcome,
} from "@/lib/catering/refund-observe";
import {
  canReleaseRefund,
  canRequestRefund,
  cateringRefundsOn,
  isRefundReasonCode,
  refundActionBlock,
  refundCreateBlock,
  refundRefusal,
  refundSummaryFromRpc,
  stripeRefundReason,
  type RefundAccountSlot,
  type RefundAttachBody,
  type RefundErrorCode,
  type RefundRaisingRpc,
  type RefundReleaseBody,
  type RefundRequestBody,
  type RefundSummary,
} from "@/lib/catering/refunds-shared";
import type { AuthContext } from "@/lib/session";

export * from "@/lib/catering/refunds-shared";

type ServiceClient = ReturnType<typeof getServiceRoleClient>;

/** Viewing the refund panel: the payments read floor (shift lead+), at a shop the viewer can see. */
export const REFUND_READ_MIN = 5;

/** The create route's `maxDuration` (s) and the reserve kept back after the lib's deadline (plan 3.4: 120 s - 20 s). */
export const REFUND_ROUTE_MAX_DURATION_S = 120;
export const REFUND_PRESS_BUDGET_MS = (REFUND_ROUTE_MAX_DURATION_S - 20) * 1000;
/** All the press's fresh reads together (step 3). */
export const REFUND_PRESS_READS_MS = 25_000;
/** A row is armed only while at least this much of the press's deadline is left (step 5). */
export const REFUND_ARM_MIN_LEFT_MS = 35_000;
/** F9's `p_max_wait_ms` [R9]. */
export const REFUND_ARM_MAX_WAIT_MS = 5_000;
/** The one POST's own budget. */
export const REFUND_POST_MS = 20_000;
/** A Check Stripe / release / attach read's budget. */
export const REFUND_ACTION_READ_MS = 25_000;

/** A refusal the route answers as `{ status, code, detail }`. Anything else thrown is a defect (500). */
export class CateringRefundError extends Error {
  constructor(public status: number, public code: RefundErrorCode, public detail?: Record<string, unknown>) {
    super(code);
    this.name = "CateringRefundError";
  }
}

const unavailable = () => new CateringRefundError(503, "refunds_unavailable");

function canSee(actor: AuthContext, locationId: string): boolean {
  return isAllLocationsAccess({ role: actor.user.role, locations: actor.locations }) || actor.locations.includes(locationId);
}

/** The app half of the refund gate. 0358's `catering_refund_actor_ok` decides again under the lock. */
export function actorMayRefund(actor: AuthContext, locationId: string): boolean {
  return canRequestRefund(actor.user.role) && lockLocationContext({ role: actor.user.role, locations: actor.locations }, locationId);
}

/**
 * The app half of the attach / release gate [DR3]: a release ROLE (MoO, owner, CGS) and the shop (owner and CGS reach
 * every shop; a MoO needs a membership there). 0359 `catering_refund_release_role` decides again under the lock.
 */
export function actorMayRelease(actor: AuthContext, locationId: string): boolean {
  return canReleaseRefund(actor.user.role) && lockLocationContext({ role: actor.user.role, locations: actor.locations }, locationId);
}

interface QuoteRow { id: string; location_id: string; root_id: string | null }

async function loadQuote(sb: ServiceClient, quoteId: string): Promise<QuoteRow | null> {
  const { data, error } = await sb.from("catering_quotes").select("id, location_id, root_id").eq("id", quoteId).maybeSingle<QuoteRow>();
  if (error) throw new Error(`refunds quote: ${error.code ?? "error"}`);
  return data ?? null;
}

/** A named refusal raised by one of 0359's raising RPCs, a missing schema, or a defect. Never returns. */
function raiseRpcError(fn: RefundRaisingRpc, rpcName: string, error: { code?: string; message?: string; details?: string }): never {
  if (refundSchemaMissing(error)) throw unavailable();
  const named = refundRefusal(fn, (error.message ?? "").trim());
  if (named) {
    const d = typeof error.details === "string" ? error.details : "";
    let detail: Record<string, unknown> | undefined;
    if ((named.code === "over_refundable" || named.code === "figures_changed") && /^\d+$/.test(d)) detail = { refundableCents: Number(d) };
    else if (named.code === "stripe_unchecked" && /^[0-9a-f-]{36}$/i.test(d)) detail = { paymentId: d };
    else if (named.code === "not_releasable_yet" && d) detail = { releasableAt: d };
    throw new CateringRefundError(named.status, named.code, detail);
  }
  throw new Error(`${rpcName}: ${error.code ?? "error"} ${(error.message ?? "").slice(0, 80)}`);
}

// ── Read (F7; zero Stripe calls) ────────────────────────────────────────────────────────────────────────────
async function userNames(sb: ServiceClient, ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (ids.length === 0) return out;
  const { data } = await sb.from("users").select("id, name").in("id", ids).returns<Array<{ id: string; name: string | null }>>();
  for (const u of data ?? []) if (u.name) out[u.id] = u.name;
  return out;
}

async function summaryFor(sb: ServiceClient, actor: AuthContext, quote: QuoteRow): Promise<RefundSummary> {
  const { data, error } = await sb.rpc("catering_refund_summary", { p_quote_ids: [quote.id] });
  if (error) {
    if (refundSchemaMissing(error)) throw unavailable();
    throw new Error(`catering_refund_summary: ${error.code ?? "error"}`);
  }
  const first = refundSummaryFromRpc(data, { quoteId: quote.id, canRefund: false, canRelease: false });
  if (!first) throw new CateringRefundError(404, "not_found");
  const people = [...new Set(first.requests.flatMap((r) => [r.requestedBy, r.resolvedBy]).filter((x): x is string => !!x))];
  const names = await userNames(sb, people);
  return refundSummaryFromRpc(data, {
    quoteId: quote.id,
    canRefund: actorMayRefund(actor, quote.location_id),
    canRelease: actorMayRelease(actor, quote.location_id),
    names,
  })!;
}

/**
 * The panel's read model for one order (F7): stored state only, ZERO Stripe calls, no token. The route answers it as
 * `{ summary }`. Refusals: 503 `refunds_off` (the switch, again here), 403 `forbidden` (below the read floor),
 * 404 `not_found`, 503 `refunds_unavailable`.
 */
export async function loadRefundSummary(actor: AuthContext, quoteId: string): Promise<RefundSummary> {
  if (!cateringRefundsOn(process.env)) throw new CateringRefundError(503, "refunds_off");
  if (getRoleLevel(actor.user.role) < REFUND_READ_MIN) throw new CateringRefundError(403, "forbidden");
  const sb = getServiceRoleClient();
  const quote = await loadQuote(sb, quoteId);
  if (!quote || !canSee(actor, quote.location_id)) throw new CateringRefundError(404, "not_found");
  return summaryFor(sb, actor, quote);
}

/** Lead → the live quotes of its order(s) that hold Stripe money (the pipeline's "Refund" banner). */
export interface LeadRefundable {
  quoteId: string;
  /** Null when any eligible payment of the order is not known: no number (never 0). */
  refundableCents: number | null;
  /** Captured over the eligible payments, when known; else null. */
  capturedCents: number | null;
  allKnown: boolean;
  eligiblePayments: number;
}
/** F7 for every live quote of the lead the actor can see (one call, at most 50 quotes). Zero Stripe calls. */
export async function loadLeadRefundables(actor: AuthContext, leadId: string): Promise<LeadRefundable[]> {
  if (!cateringRefundsOn(process.env)) throw new CateringRefundError(503, "refunds_off");
  if (getRoleLevel(actor.user.role) < REFUND_READ_MIN) throw new CateringRefundError(403, "forbidden");
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("catering_quotes")
    .select("id, location_id, root_id")
    .eq("pipeline_id", leadId)
    .is("superseded_at", null)
    .returns<QuoteRow[]>();
  if (error) throw new Error(`refunds lead quotes: ${error.code ?? "error"}`);
  const visible = (data ?? []).filter((q) => canSee(actor, q.location_id)).slice(0, 50);
  if (visible.length === 0) return [];
  const { data: sum, error: sErr } = await sb.rpc("catering_refund_summary", { p_quote_ids: visible.map((q) => q.id) });
  if (sErr) {
    if (refundSchemaMissing(sErr)) throw unavailable();
    throw new Error(`catering_refund_summary: ${sErr.code ?? "error"}`);
  }
  const out: LeadRefundable[] = [];
  for (const q of visible) {
    const s = refundSummaryFromRpc(sum, { quoteId: q.id, canRefund: false, canRelease: false });
    if (!s || s.eligiblePayments === 0) continue;
    out.push({ quoteId: q.id, refundableCents: s.refundableTotalCents, capturedCents: s.totals.capturedCents, allKnown: s.allKnown, eligiblePayments: s.eligiblePayments });
  }
  return out;
}

// ── The one send ─────────────────────────────────────────────────────────────────────────────────────────
/** A row F8 returned (reserved now, or by the same press before: a replay). */
export interface RefundReservedRow {
  id: string;
  paymentId: string;
  amountCents: number;
  status: string;
  armed: boolean;
  stripeRefundId: string | null;
  lastErrorCode: string | null;
}

/**
 * What one reserved row came to in THIS press. `posted` says whether its ONE POST was made.
 * POSTed (the row is armed; it is never POSTed again by any path):
 *   created                           F10 bound the row to the refund the answer named (`alreadyBound`: a read bound
 *                                     the same refund first, and the answer verified)
 *   unconfirmed                       no 2xx carrying the matching refund (non-2xx, 3xx, timeout, no response, an
 *                                     unparseable 2xx): reserved, blocks the payment, found by a read or a person
 *   answer_mismatch                   a 2xx that is not this request's: recorded as unconfirmed
 *   answer_conflict                   the row is bound to another refund, or another request holds the one answered
 *   answered_after_release            the row was closed with no refund and a refund came back (the next read counts it)
 *   already_bound_unconfirmed_answer  a read bound it while this POST's answer was lost
 *   closed                            the row was closed (legacy) and nothing came back
 *   finish_not_armed | finish_state_changed | finish_not_found   F10 found the row in another state than armed
 *   finish_unrecorded                 F10 could not be called or answered something unknown: the row is armed and
 *                                     unbound in the database, i.e. unconfirmed
 * NOT POSTed:
 *   never_sent    F11 cancelled the row (nothing was armed, nothing sent): `cause` says why
 *   not_armable   F9 found the row already armed / closed: its ACTUAL state is in `rowState`, never assumed "not sent"
 *   armed_unsent  the row IS armed but nothing was sent (`cause`): it reads unconfirmed, is never POSTed, and a
 *                 release after 24 h with the finding `no_request` closes it (runbook step 6)
 *   cancel_failed F11 could not be called: the row is reserved and unarmed; the sweep cancels it after 15 minutes
 *   row_not_found F9 / F11 no longer find the row
 */
export type RefundRowOutcomeKind =
  | "created" | "unconfirmed" | "answer_mismatch" | "answer_conflict" | "answered_after_release"
  | "already_bound_unconfirmed_answer" | "closed" | "finish_not_armed" | "finish_state_changed" | "finish_not_found"
  | "finish_unrecorded"
  | "never_sent" | "not_armable" | "armed_unsent" | "cancel_failed" | "row_not_found";

/** Why a row was not POSTed. */
export type RefundNotSentCause =
  | "deadline"                  // less than 35 s of the press were left before the arm
  | "payment_intent_changed"    // the PaymentIntent the read proved is not the one the reserve returned [P3-9]
  | "figures_stale"             // F9: the read is no longer the payment's current, fresh, known one
  | "deadline_passed"           // F9: the lock wait took longer than 5 s
  | "arm_unanswered"            // F9 failed in transport / answered something unknown (15.1 Opus P3-e)
  | "stopped"                   // an earlier row of this press did not end `created`
  | "credential_mismatch"       // the read's credential is not the one the arm recorded [T5]
  | "not_sent_by_client";       // the Stripe client refused before any request (no key, a bad id)

export interface RefundRowOutcome {
  requestId: string;
  paymentId: string;
  amountCents: number;
  outcome: RefundRowOutcomeKind;
  posted: boolean;
  cause: RefundNotSentCause | null;
  /** The refund F10 bound (or the answer named), when there is one. */
  stripeRefundId: string | null;
  /** The credential slot the POST went through (or would have), when a read resolved it. */
  accountSlot: RefundAccountSlot | null;
  /** The POST's HTTP status, when an answer came back. */
  httpStatus: number | null;
  /** The row as F9 / F10 / F11 reported it (status, armed, refund id). */
  rowState: { status: string | null; armed: boolean | null; stripeRefundId: string | null } | null;
  alreadyBound: boolean;
}

/**
 * The route answers:
 *   { kind: "replay" }   200 — the SAME press already reserved: its original rows, nothing read, nothing POSTed;
 *   { kind: "pressed" }  200 — one outcome per reserved row (above), plus a fresh summary the route loads.
 * Refusals are THROWN as `CateringRefundError`: 503 `refunds_off` / `refunds_unavailable` / `refunds_not_activated`;
 * 404 `not_found`; 403 `forbidden`; 409 `stripe_unchecked` (a read did not end complete or is no longer current: the
 * S11 text, "This copy of your press did not send a refund. Check the list below before you try again." — the route
 * adds a fresh summary); 409 `figures_changed` (detail `refundableCents`: the total now); and 0357's named refusals.
 */
export type RefundPressResult =
  | { kind: "replay"; requests: RefundReservedRow[] }
  | { kind: "pressed"; rows: RefundRowOutcome[] };

export interface RefundPressOptions {
  /** Absolute epoch-ms deadline for the press. Default: now + `REFUND_PRESS_BUDGET_MS`. */
  deadlineMs?: number;
}

interface F8Answer {
  replay: boolean;
  probe: boolean;
  location_id?: string;
  payments?: Array<{ payment_id: string; payment_intent: string }>;
  requests?: Array<{ id: string; payment_id: string; amount_cents: number; status: string; armed: boolean; stripe_refund_id?: string | null; last_error_code?: string | null; payment_intent?: string; read_token?: string }>;
}
interface RowAnswer { result?: string; status?: string; armed?: boolean; stripe_refund_id?: string | null }
interface ArmAnswer extends RowAnswer {
  request_id?: string; payment_id?: string; amount_cents?: number; payment_intent?: string; charge?: string;
  currency?: string; livemode?: boolean; account_slot?: string; credential_fp?: string;
}
interface FinishAnswer extends RowAnswer { already_bound?: boolean; answered_refund_id?: string | null }

const rowStateOf = (a: RowAnswer | null) =>
  a ? { status: typeof a.status === "string" ? a.status : null, armed: typeof a.armed === "boolean" ? a.armed : null, stripeRefundId: a.stripe_refund_id ?? null } : null;

function reservedRows(a: F8Answer): RefundReservedRow[] {
  return (a.requests ?? []).map((r) => ({
    id: r.id, paymentId: r.payment_id, amountCents: Number(r.amount_cents), status: r.status, armed: r.armed === true,
    stripeRefundId: r.stripe_refund_id ?? null, lastErrorCode: r.last_error_code ?? null,
  }));
}

async function reserve(sb: ServiceClient, actor: AuthContext, quoteId: string, body: RefundRequestBody, reads: Array<{ payment_id: string; read_token: string | null }> | null): Promise<F8Answer> {
  const { data, error } = await sb.rpc("catering_refund_reserve_fresh", {
    p_actor_id: actor.user.id,
    p_quote_id: quoteId,
    p_client_token: body.clientToken,
    p_amount_cents: body.amountCents,
    p_seen_refundable_cents: body.seenRefundableCents,
    p_reason_code: body.reasonCode,
    p_reason_note: body.reasonNote,
    p_trigger: body.trigger,
    p_reads: reads,
  });
  if (error) raiseRpcError("reserve", "catering_refund_reserve_fresh", error);
  if (!data || typeof data !== "object") throw new Error("catering_refund_reserve_fresh: no answer");
  return data as F8Answer;
}

/** F11 once; never throws (a failed call is `cancel_failed`). */
async function cancelUnarmed(sb: ServiceClient, requestId: string, why: string): Promise<{ answer: RowAnswer | null }> {
  try {
    const { data, error } = await sb.rpc("catering_refund_cancel_unarmed", { p_request_id: requestId, p_reason: why });
    if (error || !data) return { answer: null };
    return { answer: data as RowAnswer };
  } catch {
    return { answer: null };
  }
}

/** The outcome of a row this press did NOT post, from F11's answer (the row's real state, never assumed). */
function fromCancel(base: Omit<RefundRowOutcome, "outcome" | "posted" | "cause" | "rowState">, cause: RefundNotSentCause, c: RowAnswer | null): RefundRowOutcome {
  const rowState = rowStateOf(c);
  const out = (outcome: RefundRowOutcomeKind): RefundRowOutcome => ({ ...base, outcome, posted: false, cause, rowState });
  switch (c?.result) {
    case "cancelled": return out("never_sent");
    case "not_cancelled": return out(c.armed === true && c.status === "pending" ? "armed_unsent" : "not_armable");
    case "not_found": return out("row_not_found");
    default: return out("cancel_failed");
  }
}

function finishArgs(o: CreateRefundOutcome): { p_outcome: "created" | "unconfirmed"; p_refund: Record<string, unknown> | null; p_error_code: string | null; p_error_message: string | null } {
  switch (o.kind) {
    case "created":
      return {
        p_outcome: "created",
        p_refund: {
          id: o.refund.id, amount: o.refund.amountCents, currency: o.refund.currency, payment_intent: o.refund.paymentIntentId,
          charge: o.refund.chargeId, status: o.refund.status, request_id: o.refund.requestId,
        },
        p_error_code: null,
        p_error_message: null,
      };
    case "unparseable":
      return { p_outcome: "unconfirmed", p_refund: null, p_error_code: "unparseable_2xx", p_error_message: `HTTP ${o.httpStatus}` };
    case "refused":
      return { p_outcome: "unconfirmed", p_refund: null, p_error_code: o.code.slice(0, 80), p_error_message: `HTTP ${o.httpStatus}` };
    case "no_response":
      return { p_outcome: "unconfirmed", p_refund: null, p_error_code: o.code, p_error_message: null };
    case "not_sent":
      // Never reached: a `not_sent` outcome is not finished (nothing was sent).
      throw new Error("finishArgs: not_sent is never finished");
  }
}

/** F10's result → the row's outcome. Exhaustive; an unknown answer is `finish_unrecorded`, never success. */
function fromFinish(result: string | undefined): RefundRowOutcomeKind {
  switch (result) {
    case "created": return "created";
    case "unconfirmed": return "unconfirmed";
    case "answer_mismatch": return "answer_mismatch";
    case "answer_conflict": return "answer_conflict";
    case "answered_after_release": return "answered_after_release";
    case "already_bound_unconfirmed_answer": return "already_bound_unconfirmed_answer";
    case "closed": return "closed";
    case "not_armed": return "finish_not_armed";
    case "state_changed": return "finish_state_changed";
    case "not_found": return "finish_not_found";
    default: return "finish_unrecorded";
  }
}

/**
 * The confirm tap (see the module header for the seven steps). Never POSTs a row twice; never POSTs a row it did not
 * arm in THIS call; never POSTs through a credential whose fingerprint is not the one the arm recorded.
 */
export async function requestRefund(actor: AuthContext, quoteId: string, body: RefundRequestBody, opts: RefundPressOptions = {}): Promise<RefundPressResult> {
  const deadlineMs = opts.deadlineMs ?? Date.now() + REFUND_PRESS_BUDGET_MS;
  // 1. The gates.
  const block = refundCreateBlock(process.env);
  if (block) throw new CateringRefundError(503, block);
  const sb = getServiceRoleClient();
  const quote = await loadQuote(sb, quoteId);
  if (!quote || !canSee(actor, quote.location_id)) throw new CateringRefundError(404, "not_found");
  if (!actorMayRefund(actor, quote.location_id)) throw new CateringRefundError(403, "forbidden");

  // 2. The probe.
  const probe = await reserve(sb, actor, quoteId, body, null);
  if (probe.replay) return { kind: "replay", requests: reservedRows(probe) };
  if (!probe.probe) throw new Error("catering_refund_reserve_fresh: the probe answered neither a probe nor a replay");

  // 3. A fresh read of every payment the probe named (all together inside 25 s).
  const readsDeadline = Math.min(Date.now() + REFUND_PRESS_READS_MS, deadlineMs);
  const reads = new Map<string, RefundReadOutcome>();
  await Promise.all((probe.payments ?? []).map(async (p) => {
    try {
      reads.set(p.payment_id, await runRefundRead(sb, p.payment_id, { deadlineMs: readsDeadline }));
    } catch (e) {
      if (e instanceof RefundsUnavailableError) throw unavailable();
      // F5 itself failed: no read, no token. The reserve answers figures_stale.
    }
  }));

  // 4. ONE reserve with whatever tokens the reads produced, complete or not [R7].
  const reserved = await reserve(sb, actor, quoteId, body, (probe.payments ?? []).map((p) => ({ payment_id: p.payment_id, read_token: reads.get(p.payment_id)?.readToken ?? null })));
  if (reserved.replay) return { kind: "replay", requests: reservedRows(reserved) };

  // 5. Per reserved row, in order.
  const rows: RefundRowOutcome[] = [];
  const posted = new Set<string>();
  let stopped = false;
  for (const r of reserved.requests ?? []) {
    const read = reads.get(r.payment_id) ?? null;
    const owner = read?.owner ?? null;
    const base = {
      requestId: r.id, paymentId: r.payment_id, amountCents: Number(r.amount_cents), stripeRefundId: null,
      accountSlot: owner?.credential.slot ?? null, httpStatus: null, alreadyBound: false,
    };
    const notSent = async (cause: RefundNotSentCause): Promise<RefundRowOutcome> => fromCancel(base, cause, (await cancelUnarmed(sb, r.id, cause)).answer);

    if (stopped) { rows.push(await notSent("stopped")); continue; }
    if (deadlineMs - Date.now() < REFUND_ARM_MIN_LEFT_MS) { rows.push(await notSent("deadline")); continue; }
    if (!owner || read?.result !== "complete" || owner.paymentIntentId !== r.payment_intent) {
      rows.push(await notSent("payment_intent_changed"));
      stopped = true;
      continue;
    }

    // The arm. A transport failure (or an unknown answer) POSTs nothing: F11 once, and its answer is the report.
    let arm: ArmAnswer | null = null;
    try {
      const { data, error } = await sb.rpc("catering_refund_arm", { p_request_id: r.id, p_read_token: r.read_token ?? null, p_max_wait_ms: REFUND_ARM_MAX_WAIT_MS });
      arm = error ? null : ((data ?? null) as ArmAnswer | null);
    } catch {
      arm = null;
    }
    switch (arm?.result) {
      case "armed":
        break;
      case "figures_stale":
      case "deadline_passed":
        rows.push(await notSent(arm.result === "figures_stale" ? "figures_stale" : "deadline_passed"));
        stopped = true;
        continue;
      case "not_armable":
        rows.push({ ...base, outcome: "not_armable", posted: false, cause: null, rowState: rowStateOf(arm) });
        stopped = true;
        continue;
      case "not_found":
        rows.push({ ...base, outcome: "row_not_found", posted: false, cause: null, rowState: null });
        stopped = true;
        continue;
      default:
        rows.push(await notSent("arm_unanswered"));
        stopped = true;
        continue;
    }

    if (!arm) continue; // unreachable: every other answer continued above
    // Armed. POST only through the credential THIS read resolved, and only when it is the one the arm recorded [T5].
    const armedState = { status: "pending", armed: true, stripeRefundId: null };
    if (arm.credential_fp !== owner.credential.fingerprint || arm.account_slot !== owner.credential.slot
        || arm.payment_intent !== owner.paymentIntentId || Number(arm.amount_cents) !== Number(r.amount_cents)) {
      rows.push({ ...base, outcome: "armed_unsent", posted: false, cause: "credential_mismatch", rowState: armedState });
      stopped = true;
      continue;
    }
    const reasonCode = isRefundReasonCode(body.reasonCode) ? body.reasonCode : "other";
    const answer = await createRefund(owner.credential.secretKey(), {
      paymentIntentId: owner.paymentIntentId,
      amountCents: Number(r.amount_cents),
      reason: stripeRefundReason(reasonCode),
      metadata: { refund_request_id: r.id, quote_id: quoteId, payment_id: r.payment_id },
    }, Math.max(1_000, Math.min(REFUND_POST_MS, deadlineMs - Date.now() - 5_000)));
    if (answer.kind === "not_sent") {
      rows.push({ ...base, outcome: "armed_unsent", posted: false, cause: "not_sent_by_client", rowState: armedState });
      stopped = true;
      continue;
    }
    posted.add(r.payment_id);
    const httpStatus = answer.kind === "no_response" ? null : answer.httpStatus;

    // The answer, recorded. Never a second POST, whatever F10 says.
    let fin: FinishAnswer | null = null;
    try {
      const { data, error } = await sb.rpc("catering_refund_finish", { p_request_id: r.id, ...finishArgs(answer) });
      fin = error ? null : ((data ?? null) as FinishAnswer | null);
    } catch {
      fin = null;
    }
    const outcome = fromFinish(fin?.result);
    rows.push({
      ...base,
      outcome,
      posted: true,
      cause: null,
      httpStatus,
      stripeRefundId: fin?.stripe_refund_id ?? (answer.kind === "created" ? answer.refund.id : null),
      rowState: fin ? rowStateOf(fin) : armedState,
      alreadyBound: fin?.already_bound === true,
    });
    if (outcome !== "created") stopped = true;
  }

  // 6. Best effort: a read again of every payment a POST went to.
  const reReadDeadline = Math.min(Date.now() + 15_000, deadlineMs + 15_000);
  await Promise.all([...posted].map((pid) => runRefundRead(sb, pid, { deadlineMs: reReadDeadline }).catch(() => null)));

  // 7. One audit row per row (the existing action).
  for (const row of rows) {
    await audit({
      actorId: actor.user.id,
      actorRole: actor.user.role,
      action: "catering.refund.stripe_result",
      resourceTable: "catering_refund_requests",
      resourceId: row.requestId,
      metadata: {
        quote_id: quoteId, payment_id: row.paymentId, location_id: quote.location_id, amount_cents: row.amountCents,
        outcome: row.outcome, posted: row.posted, cause: row.cause, http_status: row.httpStatus,
        stripe_refund_id: row.stripeRefundId, account_slot: row.accountSlot, already_bound: row.alreadyBound,
        row_status: row.rowState?.status ?? null, row_armed: row.rowState?.armed ?? null,
      },
      ipAddress: null,
      userAgent: null,
    });
  }
  return { kind: "pressed", rows };
}

// ── Check Stripe (GETs only) ─────────────────────────────────────────────────────────────────────────────
export interface RefundCheckResult {
  paymentId: string;
  /** `complete` | `not_complete` | `read_replaced` | `ineligible` | `record_failed` (refund-observe.ts). */
  result: RefundReadOutcome["result"];
  reason: string | null;
  /** Requests this read bound by itself. */
  bound: number;
}

/**
 * "Check Stripe": a read of every eligible payment of the order. GETs only; it NEVER sends. The route answers the
 * results and a fresh summary (the figures stay "checking with Stripe" until a read at least 5 minutes after any
 * change). Refusals: 503 `refunds_off` / `refunds_unavailable`; 404 `not_found`; 403 `forbidden` (refund roles + shop).
 */
export async function checkRefunds(actor: AuthContext, quoteId: string, opts: { deadlineMs?: number } = {}): Promise<RefundCheckResult[]> {
  const block = refundActionBlock(process.env);
  if (block) throw new CateringRefundError(503, block);
  const sb = getServiceRoleClient();
  const quote = await loadQuote(sb, quoteId);
  if (!quote || !canSee(actor, quote.location_id)) throw new CateringRefundError(404, "not_found");
  if (!actorMayRefund(actor, quote.location_id)) throw new CateringRefundError(403, "forbidden");
  const summary = await summaryFor(sb, actor, quote);
  const deadlineMs = opts.deadlineMs ?? Date.now() + REFUND_ACTION_READ_MS;
  return Promise.all(summary.payments.filter((p) => p.eligible).map(async (p) => {
    try {
      const out = await runRefundRead(sb, p.id, { deadlineMs });
      return { paymentId: p.id, result: out.result, reason: out.reason, bound: out.bound.length };
    } catch (e) {
      if (e instanceof RefundsUnavailableError) throw unavailable();
      return { paymentId: p.id, result: "record_failed" as const, reason: "begin_failed", bound: 0 };
    }
  }));
}

// ── The two staff exits (attach, release) ────────────────────────────────────────────────────────────────
interface RequestRef { id: string; payment_id: string; location_id: string; quote_id: string }

/** The request, if it is a request of THIS order (its payment is one of the quote family's). */
async function loadRequestOfOrder(sb: ServiceClient, quote: QuoteRow, requestId: string): Promise<RequestRef | null> {
  const { data, error } = await sb.from("catering_refund_requests").select("id, payment_id, location_id, quote_id").eq("id", requestId).maybeSingle<RequestRef>();
  if (error) {
    if (refundSchemaMissing(error)) throw unavailable();
    throw new Error(`refund request: ${error.code ?? "error"}`);
  }
  if (!data) return null;
  const root = quote.root_id ?? quote.id;
  const { data: pay, error: pErr } = await sb.from("catering_payments").select("id, quote_id").eq("id", data.payment_id).maybeSingle<{ id: string; quote_id: string }>();
  if (pErr) throw new Error(`refund payment: ${pErr.code ?? "error"}`);
  if (!pay) return null;
  const { data: q, error: qErr } = await sb.from("catering_quotes").select("id, location_id, root_id").eq("id", pay.quote_id).maybeSingle<QuoteRow>();
  if (qErr) throw new Error(`refund payment quote: ${qErr.code ?? "error"}`);
  if (!q || (q.root_id ?? q.id) !== root) return null;
  return data;
}

async function exitGate(actor: AuthContext, quoteId: string, requestId: string): Promise<{ sb: ServiceClient; request: RequestRef }> {
  const block = refundActionBlock(process.env);
  if (block) throw new CateringRefundError(503, block);
  const sb = getServiceRoleClient();
  const quote = await loadQuote(sb, quoteId);
  if (!quote || !canSee(actor, quote.location_id)) throw new CateringRefundError(404, "not_found");
  if (!actorMayRelease(actor, quote.location_id)) throw new CateringRefundError(403, "forbidden");
  const request = await loadRequestOfOrder(sb, quote, requestId);
  if (!request) throw new CateringRefundError(404, "request_not_found");
  if (!actorMayRelease(actor, request.location_id)) throw new CateringRefundError(403, "forbidden");
  return { sb, request };
}

async function freshToken(sb: ServiceClient, paymentId: string, deadlineMs: number): Promise<{ token: string | null; read: RefundReadOutcome | null }> {
  try {
    const read = await runRefundRead(sb, paymentId, { deadlineMs });
    return { token: read.readToken, read };
  } catch (e) {
    if (e instanceof RefundsUnavailableError) throw unavailable();
    return { token: null, read: null };
  }
}

export interface RefundExitResult {
  result: "released" | "attached";
  requestId: string;
  paymentId: string;
  refundId: string | null;
  resolvedAt: string | null;
  /** The read the exit rested on. */
  read: { result: RefundReadOutcome["result"]; reason: string | null };
}

/**
 * RELEASE an unconfirmed request (the staff exit when NOTHING was sent): a fresh read of the request's payment, then
 * F12 with that read's token. Sends nothing to Stripe. The route answers `{ result: "released" }` + a fresh summary.
 * Refusals (thrown `CateringRefundError`): 503 `refunds_off` / `refunds_unavailable`; 404 `not_found` /
 * `request_not_found`; 403 `forbidden`; and F12's named refusals (`REFUND_RPC_REFUSALS.release`): 409
 * `not_releasable` / `not_releasable_yet` (detail `releasableAt`) / `use_attach` / `figures_stale` /
 * `credential_changed` / `wrong_account` / `refund_candidates`; 400 `finding_not_releasable` / `note_too_long`.
 */
export async function releaseRefund(actor: AuthContext, quoteId: string, requestId: string, body: RefundReleaseBody, opts: { deadlineMs?: number } = {}): Promise<RefundExitResult> {
  const { sb, request } = await exitGate(actor, quoteId, requestId);
  const { token, read } = await freshToken(sb, request.payment_id, opts.deadlineMs ?? Date.now() + REFUND_ACTION_READ_MS);
  const { data, error } = await sb.rpc("catering_refund_release", {
    p_actor_id: actor.user.id, p_request_id: request.id, p_read_token: token, p_finding: body.finding,
    p_account_slot: body.accountSlot, p_livemode: body.livemode, p_note: body.note,
  });
  if (error) raiseRpcError("release", "catering_refund_release", error);
  const a = (data ?? {}) as { result?: string; resolved_at?: string };
  if (a.result !== "released") throw new Error("catering_refund_release: an answer that is not `released`");
  return { result: "released", requestId: request.id, paymentId: request.payment_id, refundId: null, resolvedAt: a.resolved_at ?? null, read: { result: read?.result ?? "record_failed", reason: read?.reason ?? null } };
}

/**
 * ATTACH a retrieved refund to an unconfirmed request (the staff exit when a refund DID land) [Q4]: a fresh read of the
 * request's payment, then F16 with that read's token. Sends nothing to Stripe. The route answers `{ result:
 * "attached" }` + a fresh summary. Refusals: as `releaseRefund`'s gates, and F16's (`REFUND_RPC_REFUSALS.attach`): 409
 * `not_attachable` / `figures_stale` / `credential_changed` / `refund_not_attachable`; 400 `note_too_long`.
 */
export async function attachRefund(actor: AuthContext, quoteId: string, requestId: string, body: RefundAttachBody, opts: { deadlineMs?: number } = {}): Promise<RefundExitResult> {
  const { sb, request } = await exitGate(actor, quoteId, requestId);
  const { token, read } = await freshToken(sb, request.payment_id, opts.deadlineMs ?? Date.now() + REFUND_ACTION_READ_MS);
  const { data, error } = await sb.rpc("catering_refund_attach", {
    p_actor_id: actor.user.id, p_request_id: request.id, p_refund_id: body.refundId, p_read_token: token, p_note: body.note,
  });
  if (error) raiseRpcError("attach", "catering_refund_attach", error);
  const a = (data ?? {}) as { result?: string; resolved_at?: string; refund_id?: string };
  if (a.result !== "attached") throw new Error("catering_refund_attach: an answer that is not `attached`");
  return { result: "attached", requestId: request.id, paymentId: request.payment_id, refundId: a.refund_id ?? body.refundId, resolvedAt: a.resolved_at ?? null, read: { result: read?.result ?? "record_failed", reason: read?.reason ?? null } };
}
