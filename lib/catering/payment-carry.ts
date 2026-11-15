/**
 * Carrying a quote family's payments onto its live revision (audit wave W02, finding B006).
 *
 * SERVER-ONLY (it retires Stripe sessions). Called by `reviseQuote` and by nothing else.
 *
 * ── THE BUG ──────────────────────────────────────────────────────────────────────────
 * A quote is append-only and versioned: revising it supersedes the live row and inserts a
 * NEW row (new id, same `root_id`). `catering_payments.quote_id` names ONE row. So every
 * payment stayed behind on the superseded revision, and every reader — the customer's quote
 * page, the already-paid gate, the staff payments panel, the digests, the report package —
 * asks "payments for THIS quote id" and found none. A customer who had paid a deposit was
 * shown no payment, offered the full total again, and let through the double-charge gate.
 *
 * ── THE RULE THIS MODULE ENFORCES ────────────────────────────────────────────────────
 * A FAMILY'S PAYMENTS LIVE ON ITS LIVE REVISION. When a revision is created, every payment
 * row of the family's earlier revisions is re-pointed at it. Re-pointing (rather than
 * teaching each reader to walk the family) is deliberate: it is one writer instead of five
 * readers, and a reader added next year is correct without knowing this file exists. What a
 * payment was ORIGINALLY raised against is not lost — `catering.quote.revise` audits the
 * move, row id by row id, with the revision it left.
 *
 * It looks at the WHOLE family, not just the revision being replaced, so a family orphaned
 * before this fix (or by a carry that failed half way) is healed by its next revise.
 *
 * ── WHAT HAPPENS TO EACH ROW ─────────────────────────────────────────────────────────
 *   paid / refunded / void  → moved as they are. Money history is never rewritten.
 *   due                     → an intent priced for the OLD revision. Exactly one of:
 *       · CARRIED: moved and re-priced to the new revision's snapshot (deposit →
 *         deposit_cents, full → total_cents). Only when nothing in the family is paid,
 *         the new amount is positive, and it is the newest due intent of its kind. This
 *         keeps the staff "Mark paid" seam on a self-serve order whose deposit is unpaid.
 *       · VOIDED (and moved): everything else — a deposit/full intent once ANY payment has
 *         landed (both are priced for an unpaid quote), a `balance` intent (its amount was
 *         total − paid at the old total), an older duplicate, an amount that is now zero.
 *       · LEFT IN FLIGHT (moved, untouched): its Checkout Session is already `complete` —
 *         the customer's money is landing. The row keeps its amount and its session id so
 *         the webhook's flip lands on the live revision and records what was charged.
 *
 * ── THE OPEN CHECKOUT SESSION ────────────────────────────────────────────────────────
 * A due intent may point at a hosted session at the OLD amount that the customer can still
 * pay. It is retired at Stripe (`retireCheckoutSession`) and its id cleared. If it cannot
 * be retired (Stripe is down; the shop has no credentials any more) the row's fate above is
 * unchanged and the session id is KEPT — the next checkout retires it before minting
 * (lib/portal/quotes.ts), and if the customer pays it first, the webhook records the
 * payment and flags it (`amount_mismatch` / `intent_was_void`). Nothing is silently lost.
 *
 * ── A PAYMENT THAT LANDS WHILE WE ARE MOVING IT ──────────────────────────────────────
 * The Stripe webhook can advance a row (due → paid) between this module's read and its
 * write. Every write that DECIDES something about an intent (re-price it, void it) is
 * therefore guarded on the row still being `due`; when that guard misses, the row is not
 * ours to rewrite — but it still belongs on the live revision, so it is moved exactly as it
 * now is (`moveSettled`). Leaving it behind would be this bug again, for the one customer
 * who paid at the moment the manager pressed Save.
 *
 * ── NOT A TRANSACTION, AND HONEST ABOUT IT ───────────────────────────────────────────
 * `reviseQuote` is three round trips with no transaction (see its header); this adds more.
 * Every step is idempotent and the whole pass is re-runnable, so a partial failure leaves a
 * family that the next revise finishes. The caller does not fail the revise on an error
 * here — the revision is already live — it audits `outcome: "payments_carry_failed"`.
 * The one row this pass can knowingly leave behind is a checkout already COMPLETE whose
 * move a unique index refuses (two finished checkouts for one order — a double payment the
 * webhook flags for a person on its own); it is reported in `leftBehind`.
 * LIVE-CHECK for stragglers:
 *   select p.id, p.quote_id, p.status from catering_payments p
 *     join catering_quotes q on q.id = p.quote_id where q.superseded_at is not null;
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { retireCheckoutSession, stripeCredentialsFor, type RetiredCheckoutSession } from "@/lib/stripe/client";

type ServiceClient = ReturnType<typeof getServiceRoleClient>;

export interface CarryPaymentsInput {
  /** The family key: `coalesce(root_id, id)` of any revision. */
  rootId: string;
  /** The revision that is now live. */
  newQuoteId: string;
  /** The new revision's snapshot — what a carried due intent is re-priced to. */
  depositCents: number;
  totalCents: number;
}

export interface CarryPaymentsResult {
  /** Every row re-pointed at the new revision, with the revision it left. */
  moved: Array<{ paymentId: string; fromQuoteId: string }>;
  /** Due intents kept alive on the new revision, re-priced. */
  carriedDue: Array<{ paymentId: string; kind: string; fromCents: number; toCents: number }>;
  /** Due intents closed. */
  voided: string[];
  /** Due intents whose checkout was already complete — moved, otherwise untouched. */
  inFlight: string[];
  sessionsRetired: number;
  /** Due intents whose open session could NOT be retired (the id is kept on the row). */
  sessionsNotRetired: string[];
  /** Rows that could NOT be moved (see the header) — still on a superseded revision. */
  leftBehind: string[];
}

/** Retire one Checkout Session, or throw. Null = this shop cannot reach Stripe at all. */
export type RetireSession = ((sessionId: string) => Promise<RetiredCheckoutSession>) | null;

interface FamilyPayment {
  id: string;
  quote_id: string;
  kind: string;
  status: string;
  amount_cents: number;
  provider_session_id: string | null;
  created_at: string;
}

const EMPTY = (): CarryPaymentsResult => ({
  moved: [],
  carriedDue: [],
  voided: [],
  inFlight: [],
  sessionsRetired: 0,
  sessionsNotRetired: [],
  leftBehind: [],
});

/**
 * Move a family's payments onto `newQuoteId`. THROWS on a database error — the caller
 * catches, audits and carries on (see the header). `retire` is injected so the vitest
 * spine can drive every branch without a network.
 */
export async function carryPaymentsToRevision(
  sb: ServiceClient,
  input: CarryPaymentsInput,
  retire: RetireSession,
): Promise<CarryPaymentsResult> {
  const result = EMPTY();

  // The family's EARLIER revisions: the root itself, plus every row that names it.
  const { data: revisions, error: famErr } = await sb
    .from("catering_quotes")
    .select("id")
    .eq("root_id", input.rootId)
    .returns<Array<{ id: string }>>();
  if (famErr) throw new Error(`carryPayments family: ${famErr.message}`);
  const earlier = [...new Set([input.rootId, ...(revisions ?? []).map((r) => r.id)])].filter((id) => id !== input.newQuoteId);
  if (earlier.length === 0) return result;

  const { data: rows, error: payErr } = await sb
    .from("catering_payments")
    .select("id, quote_id, kind, status, amount_cents, provider_session_id, created_at")
    .in("quote_id", earlier)
    .order("created_at", { ascending: false })
    .returns<FamilyPayment[]>();
  if (payErr) throw new Error(`carryPayments read: ${payErr.message}`);
  const payments = rows ?? [];
  if (payments.length === 0) return result;

  // Payments already ON the new revision count too: a second carry pass (a retry, or a
  // heal) must not resurrect a due deposit beside a deposit that has since been paid there.
  const { data: onNew, error: newErr } = await sb
    .from("catering_payments")
    .select("id, kind, status")
    .eq("quote_id", input.newQuoteId)
    .returns<Array<{ id: string; kind: string; status: string }>>();
  if (newErr) throw new Error(`carryPayments read new: ${newErr.message}`);

  let anythingPaid = payments.some((p) => p.status === "paid") || (onNew ?? []).some((p) => p.status === "paid");
  const liveDueKinds = new Set((onNew ?? []).filter((p) => p.status === "due").map((p) => p.kind));

  // ── pass 1: the open sessions. Retire each, or learn its money is already landing ───
  // Done for EVERY due intent before any is re-priced or voided, because one checkout in
  // flight changes the fate of all the others (they are priced for an unpaid quote).
  const session = new Map<string, RetiredCheckoutSession | "failed">();
  for (const p of payments) {
    if (p.status !== "due" || !p.provider_session_id) continue;
    let outcome: RetiredCheckoutSession | "failed" = "failed";
    if (retire) {
      try {
        outcome = await retire(p.provider_session_id);
      } catch (e) {
        console.error(`[catering] could not retire the checkout session of payment ${p.id}:`, e instanceof Error ? e.message : e);
      }
    }
    session.set(p.id, outcome);
    if (outcome === "complete") anythingPaid = true;
    else if (outcome === "expired") result.sessionsRetired += 1;
    else result.sessionsNotRetired.push(p.id);
  }

  // ── pass 2: the due intents, newest first ─────────────────────────────────────────
  for (const p of payments) {
    if (p.status !== "due") continue;
    const outcome = session.get(p.id);
    const from = { paymentId: p.id, fromQuoteId: p.quote_id };

    if (outcome === "complete") {
      // IN FLIGHT: the customer finished this checkout. Do not re-price or void what they
      // are paying; just make sure the webhook's flip lands on the live revision.
      const wrote = await writeDue(sb, p.id, { quote_id: input.newQuoteId });
      if (wrote === "written") {
        result.moved.push(from);
        result.inFlight.push(p.id);
        liveDueKinds.add(p.kind);
      } else if (wrote === "advanced") {
        // The webhook's flip beat us to it: the money has landed. Move the row as it is.
        if (await moveSettled(sb, p.id, input.newQuoteId)) result.moved.push(from);
      } else {
        result.leftBehind.push(p.id);
      }
      continue;
    }
    // No session, or one we just retired ⇒ the row may stop pointing at it.
    const sessionCleared = outcome === undefined || outcome === "expired";

    const target = p.kind === "deposit" ? input.depositCents : p.kind === "full" ? input.totalCents : null;
    const carry = !anythingPaid && target != null && target > 0 && !liveDueKinds.has(p.kind);

    let wrote: DueWrite = "conflict";
    if (carry) {
      const patch: Record<string, unknown> = { quote_id: input.newQuoteId, amount_cents: target };
      if (sessionCleared) patch.provider_session_id = null;
      // A unique-index refusal (0130 / 0303) is a legacy collision, not a fault: fall
      // through to voiding this intent rather than abandoning the whole carry.
      wrote = await writeDue(sb, p.id, patch);
      if (wrote === "written") {
        result.moved.push(from);
        result.carriedDue.push({ paymentId: p.id, kind: p.kind, fromCents: p.amount_cents, toCents: target as number });
        liveDueKinds.add(p.kind);
        continue;
      }
    }

    if (wrote === "conflict") {
      // VOID it (and move it with the rest of the family's history). A void row is outside
      // both unique indexes, so this write cannot collide.
      const patch: Record<string, unknown> = { status: "void", quote_id: input.newQuoteId };
      if (sessionCleared) patch.provider_session_id = null;
      wrote = await writeDue(sb, p.id, patch);
      if (wrote === "written") {
        result.moved.push(from);
        result.voided.push(p.id);
        continue;
      }
      if (wrote === "conflict") throw new Error(`carryPayments write ${p.id}: a void write was refused by a unique index`);
    }

    // "advanced": the row stopped being `due` under us (see the header). It is history now.
    if (await moveSettled(sb, p.id, input.newQuoteId)) result.moved.push(from);
  }

  // ── everything that is not due: move it as it is ──────────────────────────────────
  for (const p of payments) {
    if (p.status === "due") continue;
    if (await moveSettled(sb, p.id, input.newQuoteId)) result.moved.push({ paymentId: p.id, fromQuoteId: p.quote_id });
  }

  return result;
}

/** What a guarded write to a due intent did. */
type DueWrite =
  | "written" //   the row was still `due` and took the patch
  | "advanced" //  the row is no longer `due` (a webhook got there first) — nothing written
  | "conflict"; // a unique index (0130 / 0303) refused the patch — nothing written

/**
 * One guarded write to an intent we read as `due`: applied only while it still is. THROWS
 * on any database error other than a unique-index refusal.
 */
async function writeDue(sb: ServiceClient, paymentId: string, patch: Record<string, unknown>): Promise<DueWrite> {
  const { error, count } = await sb
    .from("catering_payments")
    .update(patch, { count: "exact" })
    .eq("id", paymentId)
    .eq("status", "due");
  if (error) {
    if (error.code === "23505") return "conflict";
    throw new Error(`carryPayments write ${paymentId}: ${error.message}`);
  }
  return (count ?? 0) > 0 ? "written" : "advanced";
}

/**
 * Move a SETTLED row (paid / refunded / void) onto the live revision, changing nothing else.
 * Whatever its status has become by now is fine — only `due` is excluded, because a due row
 * is inside the unique indexes and its move is `writeDue`'s decision. Returns whether a row
 * moved.
 */
async function moveSettled(sb: ServiceClient, paymentId: string, newQuoteId: string): Promise<boolean> {
  const { error, count } = await sb
    .from("catering_payments")
    .update({ quote_id: newQuoteId }, { count: "exact" })
    .eq("id", paymentId)
    .neq("status", "due");
  if (error) throw new Error(`carryPayments move ${paymentId}: ${error.message}`);
  return (count ?? 0) > 0;
}

/**
 * The retire function for a shop, or null when this shop cannot reach Stripe (no
 * credentials, or its `locations.code` could not be read). NEVER resolves the shared
 * account from a failed read (audit W02/B146): a session can only be retired by the account
 * that owns it, and "we do not know which account" means "do not try".
 */
export async function retireSessionFor(sb: ServiceClient, locationId: string): Promise<RetireSession> {
  const { data, error } = await sb
    .from("locations")
    .select("code")
    .eq("id", locationId)
    .maybeSingle<{ code: string | null }>();
  if (error || !data) return null;
  const creds = stripeCredentialsFor(data.code ?? null);
  if (!creds) return null;
  return (sessionId: string) => retireCheckoutSession(creds.secretKey, sessionId);
}
