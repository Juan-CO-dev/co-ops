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
 *       · HELD AT ITS OWN AMOUNT (moved, untouched): it would be carried, but its Checkout
 *         Session could not be retired — see the next section.
 *
 * ── THE OPEN CHECKOUT SESSION ────────────────────────────────────────────────────────
 * A due intent may point at a hosted session at the OLD amount that the customer can still
 * pay. It is retired at Stripe (`retireCheckoutSession`) and its id cleared; only THEN is
 * the intent re-priced.
 *
 * AN INTENT WHOSE CHECKOUT IS STILL OPEN IS NEVER RE-PRICED (review r1). If the session
 * cannot be retired (Stripe is down; the shop has no credentials any more) the intent is
 * moved with its session id AND ITS AMOUNT — the row's `amount_cents` is what that checkout
 * will charge, and it must go on saying so. Re-pricing it anyway is how $300 got captured
 * on a row that said $200, after which a $200 refund read as "fully refunded". The stale
 * amount is corrected at the first safe moment: the customer's next pay tap retires the
 * session and only then re-prices (lib/portal/quotes.ts `initiatePayment`), failing closed
 * if it still cannot. If the customer pays the old checkout first, the webhook records
 * exactly what was charged and flags it (`amount_not_current`; `intent_was_void` for an
 * intent this pass had to close). Nothing is silently lost, and no row lies about money.
 *
 * A VOIDED INTENT WHOSE SESSION COULD NOT BE RETIRED KEEPS ITS SESSION ID, AND THAT ID MEANS
 * SOMETHING (review r3). Voiding is our bookkeeping; the hosted page is still payable. So a
 * `void` row that still names a session is an UNRESOLVED CHECKOUT, exactly like a `due` one
 * (the rule is written out in lib/catering/payment-sessions.ts): the pay path refuses to
 * open any other checkout on the quote until Stripe confirms that session expired, and only
 * then clears the id (lib/portal/quotes.ts `createQuoteCheckout`; migration 0303's attach
 * function holds the same line under the quote's lock). This pass clears the id ONLY for a
 * session it retired itself (`sessionCleared`) — never to make a row look tidy.
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
 * family that the next pass finishes. The caller does not fail the revise on an error
 * here — the revision is already live — it audits `outcome: "payments_carry_failed"`.
 *
 * ── …SO THE DOORS CHECK, EVERY TIME (review r1) ──────────────────────────────────────
 * "The next revise heals it" left a hole exactly as wide as the bug: after a failed carry
 * the revision could be SENT and PAID with the paid deposit still on the superseded row,
 * and the already-paid gate — keyed on the live quote id — saw nothing. So a best-effort
 * carry is paired with a hard rule at every door a revision passes through on its way to
 * taking money: A REVISION WHOSE FAMILY STILL HAS A PAYMENT ON AN EARLIER REVISION CANNOT
 * BE SENT, ACCEPTED OR PAID. `reconcileFamilyPayments` is that rule. Each door —
 * `sendQuote`, `setQuoteStatus('accepted')` and the portal's `loadPayableQuote` — calls it
 * first: it re-runs this carry when anything is stranded (which also heals a family
 * orphaned before this fix existed, without waiting for a revise) and then RE-READS; a
 * payment still stranded keeps the door shut. A quote that was never revised has no earlier
 * revision and costs no read at all.
 *
 * ── TWO OF THESE CAN RUN AT ONCE, SO EVERY WRITE IS A COMPARE-AND-SET (review r2) ────
 * The doors run this carry from customer requests, and two requests can both read the same
 * stranded intent. Guarding a write on `id` + `status = 'due'` was not enough: request A
 * carried the intent and attached a new checkout to it; request B, resuming its own stale
 * pass, matched the same row and wrote `provider_session_id: null` — erasing A's checkout
 * from our records while it stayed payable at Stripe — and then attached a second one.
 * So a write applies ONLY to the row exactly as this pass read it: same `status`, same
 * `quote_id`, same `provider_session_id`. A write that matches nothing is followed by a
 * re-read, and the answer is one of two facts:
 *   · the row is no longer `due` → a payment landed; it is moved as it now is (above);
 *   · the row is still `due` but is not what we read → ANOTHER REQUEST got there first.
 *     Nothing is written. The whole pass is run again from a fresh read (at most
 *     `MAX_CARRY_PASSES` times, then it throws), so a row that request already moved is
 *     simply no longer ours, and one whose checkout changed is handled as what it is NOW —
 *     its new session retired before anything about it is decided. A SESSION ANOTHER
 *     REQUEST ATTACHED IS NEVER CLEARED BY A PASS THAT DID NOT READ IT.
 * And a pass only writes while its TARGET IS STILL THE LIVE REVISION (re-read at the start
 * of every pass that has something to move): a request that loaded revision 2 just before a
 * manager made revision 3 must not pull the family's payments back onto revision 2. The
 * attach side holds the same line: `createQuoteCheckout` records a session only on an
 * intent that is still on the quote, and at the amount, the session was minted for.
 * Not a transaction (see above) — but no write here can land on a state it did not read.
 *
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
  /** Due intents kept alive on the new revision, re-priced (their checkout, if any, retired). */
  carriedDue: Array<{ paymentId: string; kind: string; fromCents: number; toCents: number }>;
  /** Due intents closed. */
  voided: string[];
  /** Due intents whose checkout was already complete — moved, otherwise untouched. */
  inFlight: string[];
  sessionsRetired: number;
  /** Due intents whose open session could NOT be retired: the row keeps the session id, and
   *  (when it stays due) the AMOUNT that session charges. Never re-priced; see the header. */
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

/** The family's EARLIER revisions: the root itself, plus every row that names it, minus the
 *  live one. THROWS on a read error, labelled for whoever asked. */
async function earlierRevisionIds(sb: ServiceClient, rootId: string, liveQuoteId: string, label: string): Promise<string[]> {
  const { data: revisions, error } = await sb
    .from("catering_quotes")
    .select("id")
    .eq("root_id", rootId)
    .returns<Array<{ id: string }>>();
  if (error) throw new Error(`${label} family: ${error.message}`);
  return [...new Set([rootId, ...(revisions ?? []).map((r) => r.id)])].filter((id) => id !== liveQuoteId);
}

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
  for (let pass = 1; ; pass += 1) {
    // Due intents that were no longer what this pass read when it came to write them (see
    // the header): another request is working the same family. Read again, decide again.
    const changed = await carryPass(sb, input, retire, result);
    if (changed.length === 0) return result;
    if (pass >= MAX_CARRY_PASSES) {
      throw new Error(`carryPayments: payments ${changed.join(", ")} kept changing under the carry — they were left as they are`);
    }
  }
}

/** How many times one carry re-reads a family that another request keeps changing. */
const MAX_CARRY_PASSES = 4;

const pushOnce = (list: string[], id: string): void => {
  if (!list.includes(id)) list.push(id);
};

/**
 * ONE read-then-write pass over the family, accumulating into `result`. Returns the ids of
 * the due intents another request changed between this pass's read and its write; the
 * caller runs a fresh pass for them.
 */
async function carryPass(
  sb: ServiceClient,
  input: CarryPaymentsInput,
  retire: RetireSession,
  result: CarryPaymentsResult,
): Promise<string[]> {
  const changed: string[] = [];

  const earlier = await earlierRevisionIds(sb, input.rootId, input.newQuoteId, "carryPayments");
  if (earlier.length === 0) return changed;

  const { data: rows, error: payErr } = await sb
    .from("catering_payments")
    .select("id, quote_id, kind, status, amount_cents, provider_session_id, created_at")
    .in("quote_id", earlier)
    .order("created_at", { ascending: false })
    .returns<FamilyPayment[]>();
  if (payErr) throw new Error(`carryPayments read: ${payErr.message}`);
  const payments = rows ?? [];
  if (payments.length === 0) return changed;

  // THE TARGET MUST STILL BE THE LIVE REVISION (see the header). Read on every pass, once we
  // know there is something to move and before anything is retired or written.
  const { data: target, error: targetErr } = await sb
    .from("catering_quotes")
    .select("id, superseded_at")
    .eq("id", input.newQuoteId)
    .maybeSingle<{ id: string; superseded_at: string | null }>();
  if (targetErr) throw new Error(`carryPayments target: ${targetErr.message}`);
  if (!target || target.superseded_at != null) {
    throw new Error(`carryPayments: revision ${input.newQuoteId} is no longer the live revision — nothing was moved onto it`);
  }

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
    else pushOnce(result.sessionsNotRetired, p.id);
  }

  // ── pass 2: the due intents, newest first ─────────────────────────────────────────
  for (const p of payments) {
    if (p.status !== "due") continue;
    const outcome = session.get(p.id);
    const from = { paymentId: p.id, fromQuoteId: p.quote_id };

    if (outcome === "complete") {
      // IN FLIGHT: the customer finished this checkout. Do not re-price or void what they
      // are paying; just make sure the webhook's flip lands on the live revision.
      const wrote = await writeDue(sb, p, { quote_id: input.newQuoteId });
      if (wrote === "written") {
        result.moved.push(from);
        result.inFlight.push(p.id);
        liveDueKinds.add(p.kind);
      } else if (wrote === "advanced") {
        // The webhook's flip beat us to it: the money has landed. Move the row as it is.
        if (await moveSettled(sb, p, input.newQuoteId)) result.moved.push(from);
      } else if (wrote === "changed") {
        changed.push(p.id);
      } else {
        pushOnce(result.leftBehind, p.id);
      }
      continue;
    }
    // No session, or one we just retired ⇒ the row may stop pointing at it.
    const sessionCleared = outcome === undefined || outcome === "expired";

    const priced = p.kind === "deposit" ? input.depositCents : p.kind === "full" ? input.totalCents : null;
    const carry = !anythingPaid && priced != null && priced > 0 && !liveDueKinds.has(p.kind);

    let wrote: DueWrite = "conflict";
    if (carry) {
      // RE-PRICED ONLY ONCE ITS CHECKOUT IS GONE (see the header). With a session we could
      // not retire, the row moves as it is: its amount is what that checkout will charge.
      const patch: Record<string, unknown> = sessionCleared
        ? { quote_id: input.newQuoteId, amount_cents: priced, provider_session_id: null }
        : { quote_id: input.newQuoteId };
      // A unique-index refusal (0130 / 0303) is a legacy collision, not a fault: fall
      // through to voiding this intent rather than abandoning the whole carry.
      wrote = await writeDue(sb, p, patch);
      if (wrote === "written") {
        result.moved.push(from);
        if (sessionCleared) {
          result.carriedDue.push({ paymentId: p.id, kind: p.kind, fromCents: p.amount_cents, toCents: priced as number });
        }
        liveDueKinds.add(p.kind);
        continue;
      }
    }

    if (wrote === "conflict") {
      // VOID it (and move it with the rest of the family's history). A void row is outside
      // both unique indexes, so this write cannot collide.
      // The session id is cleared ONLY when its session was confirmed retired above. One we
      // could not retire stays on the void row: that is what tells the pay path a checkout
      // for this order may still be open (review r3 — see the header).
      const patch: Record<string, unknown> = { status: "void", quote_id: input.newQuoteId };
      if (sessionCleared) patch.provider_session_id = null;
      wrote = await writeDue(sb, p, patch);
      if (wrote === "written") {
        result.moved.push(from);
        result.voided.push(p.id);
        continue;
      }
      if (wrote === "conflict") throw new Error(`carryPayments write ${p.id}: a void write was refused by a unique index`);
    }

    if (wrote === "changed") {
      // ANOTHER REQUEST GOT THERE FIRST (see the header): still due, but not the row this
      // pass read. Nothing was written, and nothing about it is decided from a stale read.
      changed.push(p.id);
      continue;
    }

    // "advanced": the row stopped being `due` under us (see the header). It is history now.
    if (await moveSettled(sb, p, input.newQuoteId)) result.moved.push(from);
  }

  // ── everything that is not due: move it as it is ──────────────────────────────────
  for (const p of payments) {
    if (p.status === "due") continue;
    if (await moveSettled(sb, p, input.newQuoteId)) result.moved.push({ paymentId: p.id, fromQuoteId: p.quote_id });
  }

  return changed;
}

/** What a guarded write to a due intent did. */
type DueWrite =
  | "written" //   the row was exactly as this pass read it, and took the patch
  | "advanced" //  the row is no longer `due` (a webhook got there first) — nothing written
  | "changed" //   still `due`, but another request moved it or changed its checkout — nothing written
  | "conflict"; // a unique index (0130 / 0303) refused the patch — nothing written

/** The part of a row every write is compared against: what this pass READ. */
type ReadPayment = Pick<FamilyPayment, "id" | "quote_id" | "provider_session_id">;

/**
 * One COMPARE-AND-SET write to an intent this pass read as `due`: applied only while the row
 * is still `due`, still on the revision we read it on, and still holding the Checkout
 * Session we read (or still holding none). A write guarded on less than that is how one
 * request cleared a session another had just attached (see the header).
 *
 * A write that matches nothing is followed by a re-read, which tells `advanced` (a payment
 * landed) from `changed` (another request moved it or gave it a checkout). THROWS on any
 * database error other than a unique-index refusal.
 */
async function writeDue(sb: ServiceClient, read: ReadPayment, patch: Record<string, unknown>): Promise<DueWrite> {
  const guarded = sb
    .from("catering_payments")
    .update(patch, { count: "exact" })
    .eq("id", read.id)
    .eq("status", "due")
    .eq("quote_id", read.quote_id);
  const { error, count } = await (read.provider_session_id
    ? guarded.eq("provider_session_id", read.provider_session_id)
    : guarded.is("provider_session_id", null));
  if (error) {
    if (error.code === "23505") return "conflict";
    throw new Error(`carryPayments write ${read.id}: ${error.message}`);
  }
  if ((count ?? 0) > 0) return "written";

  const { data: now, error: readErr } = await sb
    .from("catering_payments")
    .select("id, status")
    .eq("id", read.id)
    .maybeSingle<{ id: string; status: string }>();
  if (readErr) throw new Error(`carryPayments re-read ${read.id}: ${readErr.message}`);
  return now?.status === "due" ? "changed" : "advanced";
}

/**
 * Move a SETTLED row (paid / refunded / void) onto the live revision, changing nothing else.
 * Whatever its status has become by now is fine — only `due` is excluded, because a due row
 * is inside the unique indexes and its move is `writeDue`'s decision. Guarded on the
 * revision we read it on, so a row a newer pass already moved is not pulled back. Returns
 * whether a row moved.
 */
async function moveSettled(sb: ServiceClient, read: ReadPayment, newQuoteId: string): Promise<boolean> {
  const { error, count } = await sb
    .from("catering_payments")
    .update({ quote_id: newQuoteId }, { count: "exact" })
    .eq("id", read.id)
    .eq("quote_id", read.quote_id)
    .neq("status", "due");
  if (error) throw new Error(`carryPayments move ${read.id}: ${error.message}`);
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

// ── The doors: is this family's money all on its live revision? (review r1) ──────────

/** The LIVE revision of a family, as the reconciliation needs it. */
export interface FamilyQuote {
  id: string;
  /** `catering_quotes.root_id` — null for a quote that was never revised. */
  rootId: string | null;
  locationId: string;
  depositCents: number;
  totalCents: number;
}

export interface FamilyReconciliation {
  /** True when NO payment of the family sits on an earlier revision. The door may open. */
  reconciled: boolean;
  /** False when nothing was stranded to begin with (nothing was read twice or written). */
  attempted: boolean;
  /** Payment ids still on an earlier revision after the attempt. */
  stranded: string[];
  /** What the heal moved. Null when nothing was attempted or the heal threw. */
  healed: CarryPaymentsResult | null;
  /** The heal's own failure, when it threw. */
  error: string | null;
}

/**
 * The ids of every payment of this family that is NOT on `quote` — the caller's LIVE
 * revision (it has already checked `superseded_at IS NULL`). READ-ONLY. THROWS on a read
 * error: "we could not look" is not "there is nothing there".
 *
 * A quote with no `root_id` is the first and only revision of its family, so it has no
 * earlier revision to strand anything on: answered with no query.
 */
export async function strandedFamilyPayments(sb: ServiceClient, quote: Pick<FamilyQuote, "id" | "rootId">): Promise<string[]> {
  if (quote.rootId == null) return [];
  const earlier = await earlierRevisionIds(sb, quote.rootId, quote.id, "strandedFamilyPayments");
  if (earlier.length === 0) return [];
  const { data, error } = await sb
    .from("catering_payments")
    .select("id")
    .in("quote_id", earlier)
    .returns<Array<{ id: string }>>();
  if (error) throw new Error(`strandedFamilyPayments read: ${error.message}`);
  return (data ?? []).map((r) => r.id);
}

/**
 * Make sure a family's payments are on its live revision, or say that they are not (see
 * the header). Called by every door a revision passes on its way to taking money.
 *
 *   nothing stranded → `{ reconciled: true, attempted: false }`, and nothing was written;
 *   something stranded → the carry is re-run (idempotent; its own failure is caught and
 *     reported, never thrown), then the family is READ AGAIN. `reconciled` is that second
 *     read, not the carry's own account of itself — a row the carry had to leave behind
 *     (`leftBehind`: a second finished checkout whose money is landing) keeps the door shut
 *     until its webhook settles it and a later pass moves it.
 *
 * THROWS only when the family cannot be READ. The caller audits and refuses.
 */
export async function reconcileFamilyPayments(sb: ServiceClient, quote: FamilyQuote): Promise<FamilyReconciliation> {
  const before = await strandedFamilyPayments(sb, quote);
  if (before.length === 0) return { reconciled: true, attempted: false, stranded: [], healed: null, error: null };

  let healed: CarryPaymentsResult | null = null;
  let error: string | null = null;
  try {
    const retire = await retireSessionFor(sb, quote.locationId);
    healed = await carryPaymentsToRevision(
      sb,
      { rootId: quote.rootId as string, newQuoteId: quote.id, depositCents: quote.depositCents, totalCents: quote.totalCents },
      retire,
    );
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    console.error(`[catering] could not reconcile the payments of family ${quote.rootId} onto revision ${quote.id}: ${error}`);
  }

  const stranded = await strandedFamilyPayments(sb, quote);
  return { reconciled: stranded.length === 0, attempted: true, stranded, healed, error };
}
