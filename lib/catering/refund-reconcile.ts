/**
 * Catering refunds Part B1 — the reconciler. SERVER-ONLY. The database authority is migration 0359; the pure rules
 * are lib/catering/refund-outcomes-shared.ts. Nothing here runs while `CATERING_REFUNDS` is OFF.
 *
 * ONE EVIDENCE CONTRACT, ONE FINANCIAL WRITER. Every observer of a payment's refunds (a staff press, the sweep,
 * recovery) runs the SAME pass:
 *
 *   1. `catering_refund_pass_begin`  — the pass token and the GENERATION every later step is fenced on, the ids whose
 *      exact retrieval the contract requires, and the continuation of a list that did not finish.
 *   2. the OWNER — the payment's immutable PaymentIntent, asked of every account the payment's SHOP is permitted
 *      (`stripeAccountsForShop`). Credentials are never an identity: several keys proving the same objects are
 *      equivalent, a rotated key that resolves the same PaymentIntent and charge in the same mode is the owner, and
 *      conflicting answers, no answer, or a failed shop lookup HOLD the pass (never "the shared account by default").
 *   3. DISCOVERY — the PaymentIntent's refund list, page by page, strictly parsed. A real terminal page
 *      (`has_more: false`) is required; a repeated id or cursor, a malformed page, a timeout or a spent budget leave
 *      the pass INCOMPLETE. Learned ids and the cursor are persisted (`catering_refund_pass_remember`) so completion
 *      can span invocations.
 *   4. COVERAGE — an EXACT read of every id: event and create-response hints, bound ids, retained snapshot ids,
 *      permanent identities and the ids just listed. Only an exact read drives provider status.
 *   5. `catering_refund_apply` — the one financial writer, under the payment lock, fenced on the generation.
 *
 * NO DATABASE LOCK IS HELD ACROSS PROVIDER I/O: every database step is one short RPC, and the generation makes a
 * read that went stale in between a named `stale_generation`, never an overwrite.
 *
 * THIS MODULE NEVER CREATES A REFUND. The only POST lives in lib/catering/refunds.ts, behind an authorized staff
 * press. The sweep and recovery perform GETs only.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import {
  listRefundsPageStrict,
  retrievePaymentIntentOwner,
  retrieveRefundStrict,
  StripeError,
  type StrictRefund,
  type StripeCredentials,
} from "@/lib/stripe/client";
import { stripeAccountsForShop } from "@/lib/stripe/session-owner";
import { closeQuoteCheckouts, settlementCleanupComplete, type ClosedCheckouts, type CloseQuoteCheckoutsInput } from "@/lib/catering/payment-sessions";
import { retireSessionFor, type RetireSession } from "@/lib/catering/payment-carry";
import { REFUND_SQL_REFUSALS } from "@/lib/catering/refunds-shared";
import {
  REFUND_B1_SQL_REFUSALS,
  REFUND_CALLER_CONTRACT,
  epochAllowsWork,
  parseEpochState,
  type RefundEpochView,
  type RefundPassResult,
} from "@/lib/catering/refund-outcomes-shared";

type ServiceClient = ReturnType<typeof getServiceRoleClient>;

/** A named refusal of a protected database call (0359 raises it by name), or the schema being absent. */
export class RefundReconcileError extends Error {
  constructor(public status: number, public code: string, public detail?: string) {
    super(code);
    this.name = "RefundReconcileError";
  }
}

function missingRelation(error: { code?: string; message?: string }): boolean {
  return ["PGRST205", "42P01", "PGRST202", "42883", "42501"].includes(error.code ?? "") || /could not find the (table|function)/i.test(error.message ?? "");
}

/**
 * Call one of 0359's protected functions with this build's compiled contract version as the first argument.
 * A missing function, a withdrawn grant or an incompatible caller is `refunds_unavailable` (503): the required schema
 * is missing or incompatible, and nothing falls through to an older money writer. A named refusal is itself.
 */
export async function refundRpc<T>(sb: ServiceClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, { p_caller: REFUND_CALLER_CONTRACT, ...args });
  if (!error) return data as T;
  if (missingRelation(error)) throw new RefundReconcileError(503, "refunds_unavailable", fn);
  const name = (error.message ?? "").trim();
  // Part B1's own names first, then the reserve's (0357's refusals, which the admitted reserve keeps by name).
  const named = Object.prototype.hasOwnProperty.call(REFUND_B1_SQL_REFUSALS, name)
    ? REFUND_B1_SQL_REFUSALS[name]
    : Object.prototype.hasOwnProperty.call(REFUND_SQL_REFUSALS, name) ? REFUND_SQL_REFUSALS[name] : undefined;
  if (named) throw new RefundReconcileError(named.status, named.code, typeof error.details === "string" ? error.details : undefined);
  throw new Error(`${fn}: ${error.message}`);
}

/** Where admission stands. A database without 0359 (or one that does not admit this build) is `callerOk: false`. */
export async function loadRefundEpoch(sb: ServiceClient): Promise<RefundEpochView & { installed: boolean }> {
  const { data, error } = await sb.rpc("catering_refund_epoch_state", { p_caller: REFUND_CALLER_CONTRACT });
  if (error) {
    if (missingRelation(error)) return { state: "none", epochId: null, callerOk: false, installed: false };
    throw new Error(`catering_refund_epoch_state: ${error.message}`);
  }
  return { ...parseEpochState(data), installed: true };
}

// ── The owner ─────────────────────────────────────────────────────────────────────────────────────────────
export type RefundOwner =
  | { status: "resolved"; account: StripeCredentials; accounts: StripeCredentials[]; paymentIntentId: string; chargeId: string; currency: string; livemode: boolean; capturedCents: number | null }
  | { status: "indeterminate" | "conflict" | "unreachable"; accounts: StripeCredentials[] };

/** The shop's `locations.code`. THROWS on a failed read: "we do not know the shop" is never "the shared account". */
async function shopCode(sb: ServiceClient, locationId: string): Promise<string | null> {
  const { data, error } = await sb.from("locations").select("id, code").eq("id", locationId).maybeSingle<{ id: string; code: string | null }>();
  if (error) throw new Error(`refund shop: ${error.message}`);
  if (!data) throw new Error("refund shop: no such location");
  return data.code ?? null;
}

/**
 * Resolve the immutable payment identity through the credentials currently permitted for the payment's shop.
 *   resolved      at least one account knows the PaymentIntent, and every account that knows it reports the SAME
 *                 charge, currency and mode (several credentials proving the same objects are equivalent).
 *   conflict      two accounts know it and disagree.
 *   indeterminate every account answered and none knows it, or the shop has no usable credential.
 *   unreachable   none knows it and at least one could not be asked (or the shop itself could not be read).
 */
export async function resolveRefundOwner(sb: ServiceClient, locationId: string, paymentIntentId: string, deadlineMs: number): Promise<RefundOwner> {
  let accounts: StripeCredentials[];
  try {
    accounts = stripeAccountsForShop(await shopCode(sb, locationId));
  } catch {
    return { status: "unreachable", accounts: [] };
  }
  if (accounts.length === 0) return { status: "indeterminate", accounts };
  let found: { account: StripeCredentials; chargeId: string; currency: string; livemode: boolean; capturedCents: number | null } | null = null;
  let couldNotAsk = false;
  for (const account of accounts) {
    try {
      const read = await retrievePaymentIntentOwner(account.secretKey, paymentIntentId, deadlineMs - Date.now());
      if (read.status !== "found") continue;
      if (!read.chargeId || !read.currency || read.livemode === null) {
        couldNotAsk = true; // it knows the PaymentIntent but the answer does not prove the charge: not usable evidence
        continue;
      }
      if (found && (found.chargeId !== read.chargeId || found.currency !== read.currency || found.livemode !== read.livemode)) {
        return { status: "conflict", accounts };
      }
      found ??= { account, chargeId: read.chargeId, currency: read.currency, livemode: read.livemode, capturedCents: read.amountCapturedCents };
    } catch {
      couldNotAsk = true;
    }
  }
  if (found) return { status: "resolved", accounts, paymentIntentId, ...found };
  return { status: couldNotAsk ? "unreachable" : "indeterminate", accounts };
}

// ── One exact read, across every permitted account ────────────────────────────────────────────────────────
type RefundRead =
  | { id: string; read: "ok"; payment_intent: string | null; charge: string | null; amount: number; currency: string; status: string | null; created: number; request: string | null; meta_payment: string | null; meta_quote: string | null }
  | { id: string; read: "not_found_all" | "denied" | "transient" };

function okRead(r: StrictRefund): RefundRead {
  return { id: r.id, read: "ok", payment_intent: r.paymentIntentId, charge: r.chargeId, amount: r.amountCents, currency: r.currency, status: r.status, created: r.createdSec, request: r.requestId, meta_payment: r.metaPaymentId, meta_quote: r.metaQuoteId };
}

/**
 * EXACTLY retrieve one refund id. The owning account is asked first; a 404 there proves nothing, so every other
 * permitted account is asked before the answer is `not_found_all` (EVERY permitted account answered 404). An account
 * that refused (401 / 403) makes it `denied`; a timeout, 429, 5xx, malformed answer or spent budget makes it
 * `transient`. Neither of those counts as a 404 anywhere.
 */
export async function readRefundExact(owner: Extract<RefundOwner, { status: "resolved" }>, refundId: string, deadlineMs: number): Promise<RefundRead> {
  const ordered = [owner.account, ...owner.accounts.filter((a) => a.secretKey !== owner.account.secretKey)];
  let denied = false;
  let transient = false;
  for (const account of ordered) {
    try {
      const read = await retrieveRefundStrict(account.secretKey, refundId, deadlineMs - Date.now());
      if (read.status === "found") return okRead(read.refund);
    } catch (e) {
      const status = e instanceof StripeError ? e.status : 0;
      if (status === 401 || status === 403) denied = true;
      else transient = true;
    }
  }
  if (transient) return { id: refundId, read: "transient" };
  if (denied) return { id: refundId, read: "denied" };
  return { id: refundId, read: "not_found_all" };
}

// ── The pass ──────────────────────────────────────────────────────────────────────────────────────────────
export interface RefundPassOptions {
  /** An absolute deadline (epoch ms) for the whole pass: the route budget minus its finishing reserve. */
  deadlineMs: number;
  /** One id per scheduled sweep run: three DISTINCT scheduled all-404 passes quarantine a never-verified hint. */
  runId?: string;
  scheduled?: boolean;
  /** List pages read in THIS invocation (the rest continues from the persisted cursor). */
  maxPages?: number;
  /** Test seam: the reversal checkout cleanup. */
  cleanup?: (sb: ServiceClient, paymentId: string) => Promise<ReversalCleanup>;
}

interface PassBegun {
  result: string;
  pass_token: string;
  generation: number;
  epoch_state: string;
  location_id: string;
  payment_intent: string;
  cursor: { after: string | null; pages: number } | null;
  ids: Array<{ id: string; verified: boolean }>;
}
export interface RefundApplyResult {
  result: RefundPassResult;
  reason?: string;
  generation?: number;
  payment_status?: string;
  previous_payment_status?: string;
  transitions?: number;
  floors_outstanding?: number;
  held?: boolean;
  captured_cents?: number;
  returned_cents?: number;
  reserved_cents?: number;
  floor_cents?: number;
  available_cents?: number;
  cleanup_owed?: boolean;
}
export interface RefundPassOutcome extends RefundApplyResult {
  /** The resolved owner of a pass that got that far (the staff press arms and POSTs against exactly this). */
  owner?: Extract<RefundOwner, { status: "resolved" }>;
  /** Every refund this pass read exactly, by id. */
  reads?: RefundRead[];
}

/** Time kept back at the end of a pass for the database writes that finish it. */
const FINISH_RESERVE_MS = 2_500;
/** Exact refund reads made at once (GETs; well under Stripe's read rate limit). */
const EXACT_READ_CONCURRENCY = 8;

/**
 * Run ONE discovery pass over a settled payment and hand its evidence to the financial writer. Never throws for a
 * provider problem: an unavailable account, a malformed page or a spent budget end as `incomplete_evidence` or
 * `deferred`, with the staged progress kept. Throws only for a named admission refusal or a database failure.
 */
export async function runRefundPass(sb: ServiceClient, paymentId: string, opts: RefundPassOptions): Promise<RefundPassOutcome> {
  const runId = opts.runId ?? crypto.randomUUID();
  const begun = await refundRpc<PassBegun>(sb, "catering_refund_pass_begin", { p_payment_id: paymentId, p_run_id: runId });
  if (begun.result !== "begun") return { result: begun.result as RefundPassResult };
  const token = begun.pass_token;
  const generation = Number(begun.generation);
  const stop = opts.deadlineMs - FINISH_RESERVE_MS;
  const defer = async (reason: string, seconds: number): Promise<RefundPassOutcome> => {
    await refundRpc(sb, "catering_refund_defer", { p_payment_id: paymentId, p_pass_token: token, p_reason: reason, p_retry_seconds: seconds });
    return { result: "deferred", reason, generation };
  };
  const apply = (evidence: Record<string, unknown>) =>
    refundRpc<RefundApplyResult>(sb, "catering_refund_apply", { p_payment_id: paymentId, p_pass_token: token, p_expected_generation: generation, p_evidence: evidence });

  const owner = await resolveRefundOwner(sb, begun.location_id, begun.payment_intent, stop);
  if (owner.status !== "resolved") {
    // The financial writer records the hold (an indeterminate or conflicting owner) and publishes nothing.
    return { ...(await apply({ complete: false, scheduled: opts.scheduled === true, run_id: runId, owner: { status: owner.status }, refunds: [] })) };
  }

  // DISCOVERY: the list, page by page, from the persisted cursor.
  const ids = new Set(begun.ids.map((x) => x.id));
  const listed = new Set<string>();
  const seenCursors = new Set<string>();
  let after = begun.cursor?.after ?? null;
  let pages = Number(begun.cursor?.pages ?? 0);
  let complete = false;
  const maxPages = opts.maxPages ?? 5;
  for (let read = 0; read < maxPages; read++) {
    if (Date.now() >= stop) return defer("budget_exhausted", 60);
    let page;
    try {
      page = await listRefundsPageStrict(owner.account.secretKey, begun.payment_intent, after, stop - Date.now());
    } catch (e) {
      return defer(e instanceof StripeError ? e.code.slice(0, 60) : "list_failed", 60);
    }
    // Ids only: what a LIST entry's metadata names is never a request candidate (the exact read decides that).
    const learned: Array<{ id: string }> = [];
    for (const r of page.refunds) {
      // A repeated id ACROSS pages means the list is not a stable enumeration: incomplete, never "all of them".
      if (listed.has(r.id)) return defer("list_repeated_id", 60);
      listed.add(r.id);
      ids.add(r.id);
      learned.push({ id: r.id });
    }
    pages++;
    if (!page.hasMore) {
      complete = true; // an EXPLICIT terminal page
      if (learned.length > 0) {
        const remembered = await refundRpc<{ result: string }>(sb, "catering_refund_pass_remember", { p_payment_id: paymentId, p_pass_token: token, p_learned: learned, p_cursor: after, p_pages: pages });
        if (remembered.result !== "remembered") return { result: "stale_generation", generation };
      }
      break;
    }
    // A non-terminal page needs an ADVANCING cursor that was never used before.
    if (!page.lastId || page.lastId === after || seenCursors.has(page.lastId)) return defer("list_repeated_cursor", 60);
    seenCursors.add(page.lastId);
    after = page.lastId;
    const remembered = await refundRpc<{ result: string }>(sb, "catering_refund_pass_remember", { p_payment_id: paymentId, p_pass_token: token, p_learned: learned, p_cursor: after, p_pages: pages });
    if (remembered.result !== "remembered") return { result: "stale_generation", generation };
  }

  // COVERAGE: an exact read of every id. A spent budget leaves the rest `transient` (the pass is then incomplete).
  // In bounded parallel (never one long serial walk): a payment with a hundred refunds finishes inside one slice
  // instead of re-reading the same prefix on every sweep.
  const reads: RefundRead[] = [];
  const sorted = [...ids].sort();
  for (let i = 0; i < sorted.length; i += EXACT_READ_CONCURRENCY) {
    const batch = sorted.slice(i, i + EXACT_READ_CONCURRENCY);
    reads.push(...(await Promise.all(batch.map((id): Promise<RefundRead> =>
      Date.now() >= stop ? Promise.resolve({ id, read: "transient" }) : readRefundExact(owner, id, stop)))));
  }

  const applied = await apply({
    complete, scheduled: opts.scheduled === true, run_id: runId,
    owner: { status: "resolved", payment_intent: owner.paymentIntentId, charge: owner.chargeId, currency: owner.currency, livemode: owner.livemode, captured_cents: owner.capturedCents },
    refunds: reads,
  });
  if (applied.result === "applied" && applied.cleanup_owed) {
    // `refunded -> paid` committed with its cleanup obligation; the cleanup itself runs AFTER the commit and is
    // resumed by the sweep if this process dies here.
    await (opts.cleanup ?? runReversalCleanup)(sb, paymentId).catch((e) => {
      console.error(`[catering refunds] reversal cleanup for ${paymentId} did not finish:`, e instanceof Error ? e.message : e);
    });
  }
  return { ...applied, owner, reads };
}

// ── Reversal checkout cleanup (refunded -> paid) ───────────────────────────────────────────────────────────
export interface ReversalCleanup {
  complete: boolean;
  report: { still_open: number; completing: number; already_paid_duplicates: number; retired: number };
}

/** Does an intent of kind `a` collect the same money as the restored payment of kind `b`? The designed deposit + balance pair does not. */
function duplicatesRestored(a: string, b: string): boolean {
  return a === b || a === "full" || b === "full";
}

/**
 * A payment that read `refunded` re-opened its order's checkout; now that it is `paid` again, a checkout opened
 * meanwhile is a second way to pay the same thing. Two steps:
 *   1. the shared checkout-retirement helper (`closeQuoteCheckouts`), exactly as a settlement runs it;
 *   2. THE REVERSAL CASE that helper does not cover by design (it preserves an ordinary balance): a REPLACEMENT intent
 *      that collects the same money as the restored payment (a new balance for a restored balance, a full for
 *      anything) and still names an open checkout is retired through the owning account too. The designed
 *      deposit + balance pair is left alone.
 * An intent of the same kind ALREADY PAID meanwhile is counted as a possible duplicate. What could not be confirmed
 * closed keeps the obligation owed and is reported. Nothing is ever reimbursed automatically.
 */
export async function runReversalCleanup(
  sb: ServiceClient,
  paymentId: string,
  close: (sb: ServiceClient, input: CloseQuoteCheckoutsInput) => Promise<ClosedCheckouts> = closeQuoteCheckouts,
  retireFor: (sb: ServiceClient, locationId: string) => Promise<RetireSession> = retireSessionFor,
): Promise<ReversalCleanup> {
  const { data: pay, error } = await sb
    .from("catering_payments")
    .select("id, quote_id, kind, status, provider_session_id")
    .eq("id", paymentId)
    .maybeSingle<{ id: string; quote_id: string; kind: string; status: string; provider_session_id: string | null }>();
  if (error) throw new Error(`reversal cleanup payment: ${error.message}`);
  if (!pay) throw new Error("reversal cleanup payment: not found");
  const { data: quote, error: qErr } = await sb.from("catering_quotes").select("id, location_id, root_id").eq("id", pay.quote_id).maybeSingle<{ id: string; location_id: string; root_id: string | null }>();
  if (qErr) throw new Error(`reversal cleanup quote: ${qErr.message}`);
  const closed = await close(sb, { quoteId: pay.quote_id, locationId: quote?.location_id ?? null, settledPaymentId: pay.id, settledSessionId: pay.provider_session_id });
  // An intent of the same kind paid while this one read `refunded`: the customer may have paid twice.
  const root = quote?.root_id ?? quote?.id ?? pay.quote_id;
  const { data: fam, error: fErr } = await sb.from("catering_quotes").select("id").or(`id.eq.${root},root_id.eq.${root}`).returns<Array<{ id: string }>>();
  if (fErr) throw new Error(`reversal cleanup family: ${fErr.message}`);
  const { data: others, error: oErr } = await sb
    .from("catering_payments")
    .select("id, kind, status, provider_session_id")
    .in("quote_id", [...new Set([pay.quote_id, ...(fam ?? []).map((r) => r.id)])])
    .returns<Array<{ id: string; kind: string; status: string; provider_session_id: string | null }>>();
  if (oErr) throw new Error(`reversal cleanup payments: ${oErr.message}`);
  const duplicates = (others ?? []).filter((o) => o.id !== pay.id && o.status === "paid" && duplicatesRestored(o.kind, pay.kind)).length;
  // Step 2: a replacement intent of the restored payment's own money that still names a checkout nobody closed above.
  const handled = new Set([...closed.retired, ...closed.stillOpen, ...closed.completing]);
  const replacements = (others ?? []).filter((o) => o.id !== pay.id && (o.status === "due" || o.status === "void")
    && o.provider_session_id && duplicatesRestored(o.kind, pay.kind) && !handled.has(o.id));
  if (replacements.length > 0) {
    let retire: RetireSession = null;
    try {
      retire = quote?.location_id ? await retireFor(sb, quote.location_id) : null;
    } catch {
      retire = null;
    }
    for (const r of replacements) {
      const sessionId = r.provider_session_id!;
      if (!retire) { closed.stillOpen.push(r.id); continue; }
      try {
        const outcome = await retire(sessionId);
        if (outcome === "complete") { closed.completing.push(r.id); continue; } // that money is landing: its own event records it
        // Confirmed expired by the owning account: clear the id, guarded on the exact session retired.
        const { error: cErr } = await sb.from("catering_payments").update({ provider_session_id: null }).eq("id", r.id).eq("provider_session_id", sessionId);
        if (cErr) throw new Error(cErr.message);
        closed.retired.push(r.id);
      } catch {
        closed.stillOpen.push(r.id); // not confirmed closed: the obligation stays owed and staff are told
      }
    }
  }
  const complete = settlementCleanupComplete(closed);
  const report = { still_open: closed.stillOpen.length, completing: closed.completing.length, already_paid_duplicates: duplicates, retired: closed.retired.length };
  await refundRpc(sb, "catering_refund_cleanup_done", { p_payment_id: paymentId, p_complete: complete, p_report: report });
  return { complete, report };
}

// ── The sweep ─────────────────────────────────────────────────────────────────────────────────────────────
export interface RefundSweepResult {
  epochState: string;
  /** False = nothing was admitted (no open epoch, or this build is not the admitted one): no lease, no heartbeat. */
  ran: boolean;
  seeded: number;
  passes: number;
  applied: number;
  incomplete: number;
  held: number;
  deferred: number;
  cleanups: number;
  housekeeping: Record<string, unknown> | null;
  /** Payments still due when the budget ran out. */
  left: number;
}

const SWEEP_KINDS = ["armed_unbound", "event_work", "reserved_unarmed", "identity_polls", "discovery"] as const;

/**
 * One sweep run. FAIR, SEPARATELY BOUNDED batches (armed / unbound requests, event work, reserved / unarmed requests,
 * identity polls, settled-payment discovery, post-reversal checkout cleanup), taken ROUND-ROBIN so one kind, one
 * unavailable account or one large payment cannot consume the run. A payment that could not finish defers itself to
 * the back of its due list in the database. GETs only: there is no create capability on this path.
 */
export async function runRefundSweep(sb: ServiceClient, opts: { deadlineMs: number; runId?: string; perKind?: number; cleanup?: RefundPassOptions["cleanup"] }): Promise<RefundSweepResult> {
  const runId = opts.runId ?? crypto.randomUUID();
  const out: RefundSweepResult = { epochState: "none", ran: false, seeded: 0, passes: 0, applied: 0, incomplete: 0, held: 0, deferred: 0, cleanups: 0, housekeeping: null, left: 0 };
  const epoch = await loadRefundEpoch(sb);
  out.epochState = epoch.state;
  if (!epochAllowsWork(epoch)) return out;
  out.ran = true;
  const timeLeft = () => opts.deadlineMs - Date.now();

  if (epoch.state === "recovering") {
    // Bounded recovery work: seed in batches, the cursor committed with each batch.
    for (let i = 0; i < 20 && timeLeft() > 20_000; i++) {
      const b = await refundRpc<{ result: string; rows: number; complete: boolean }>(sb, "catering_refund_recovery_seed_batch", { p_limit: 200 });
      if (b.result !== "seeded") break;
      out.seeded += Number(b.rows ?? 0);
      if (b.complete && Number(b.rows ?? 0) === 0) break;
    }
  }
  out.housekeeping = await refundRpc<Record<string, unknown>>(sb, "catering_refund_sweep_housekeeping", {});

  const due = await refundRpc<Record<string, unknown>>(sb, "catering_refund_sweep_due", { p_limit: opts.perKind ?? 10 });
  const queues = SWEEP_KINDS.map((k) => (Array.isArray(due[k]) ? [...(due[k] as string[])] : []));
  const done = new Set<string>();
  for (;;) {
    let progressed = false;
    for (const q of queues) {
      let id = q.shift();
      while (id && done.has(id)) id = q.shift();
      if (!id) continue;
      progressed = true;
      if (timeLeft() < 15_000) { q.unshift(id); break; }
      done.add(id);
      out.passes++;
      try {
        // Each payment gets a slice of what is left, so one slow account cannot take the whole run.
        const r = await runRefundPass(sb, id, { deadlineMs: Date.now() + Math.min(20_000, timeLeft() - 5_000), runId, scheduled: true, cleanup: opts.cleanup });
        if (r.result === "applied") out.applied++;
        else if (r.result === "held") out.held++;
        else if (r.result === "deferred" || r.result === "busy") out.deferred++;
        else out.incomplete++;
      } catch (e) {
        // One payment's failure never aborts the sweep for another.
        out.incomplete++;
        console.error(`[catering refunds] sweep pass for ${id} failed:`, e instanceof Error ? e.message : e);
      }
    }
    if (!progressed || timeLeft() < 15_000) break;
  }
  out.left = queues.reduce((n, q) => n + q.filter((id) => !done.has(id)).length, 0);

  for (const id of Array.isArray(due.cleanup) ? (due.cleanup as string[]) : []) {
    if (timeLeft() < 10_000) break;
    try {
      await (opts.cleanup ?? runReversalCleanup)(sb, id);
      out.cleanups++;
    } catch (e) {
      console.error(`[catering refunds] sweep cleanup for ${id} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return out;
}
