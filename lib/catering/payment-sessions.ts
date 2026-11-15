/**
 * Closing a quote's open Stripe Checkout Sessions once money has landed on it (audit wave
 * W02, review r3). SERVER-ONLY (it retires Stripe sessions).
 *
 * ── WHAT A SESSION ID ON A ROW MEANS ─────────────────────────────────────────────────
 * `catering_payments.provider_session_id` on a row that is `due` OR `void` is an UNRESOLVED
 * CHECKOUT: a hosted page a customer may still be able to pay. It stops being one in
 * exactly three ways, each of them Stripe's own word:
 *   · Stripe confirms the session EXPIRED — a retire call that answered `expired`, or its
 *     `checkout.session.expired` event — and the id is CLEARED;
 *   · Stripe says the session's DELAYED PAYMENT FAILED (`checkout.session.
 *     async_payment_failed`, review r5): the session is `complete` and can never be expired,
 *     so the failure event is the only thing that ends that attempt — the id is CLEARED
 *     (lib/stripe/webhook.ts has the rule and the Stripe pages it rests on);
 *   · the session is PAID: the webhook flips the row to `paid`, and the id becomes history.
 * Every clear is guarded on the exact session id it is about. A `paid` / `refunded` row's
 * id is history and is never read as an open checkout.
 *
 * "The intent is void" was read as "its checkout is closed", and it is not: voiding is our
 * bookkeeping, the session lives at Stripe. A revise that could not retire a session moved
 * the intent as `void` with the id still on it, and the next pay request — which looked
 * only at `due` rows — opened a second checkout beside it.
 *
 * So:
 *   · THE PAY PATH (lib/portal/quotes.ts `createQuoteCheckout`) treats every unresolved
 *     checkout on the quote as blocking. It retires each one or refuses — fail closed — and
 *     offers a replacement only after the retirement is confirmed.
 *   · THIS MODULE is the other half: when a payment LANDS (the Stripe webhook, or a person
 *     marking one paid by hand), the quote's other deposit / full checkouts are priced for
 *     an unpaid quote and must not stay payable. They are retired here. It is BEST-EFFORT
 *     and NEVER THROWS — the money is already recorded and nothing may undo that — but it
 *     always REPORTS: a checkout it could not confirm closed is returned in `stillOpen`,
 *     keeps its id on its row (so the pay path still sees it), and the caller flags it for a
 *     person.
 *
 * A `balance` intent is the next step of the designed deposit → balance sequence, not a
 * duplicate of what was just paid, so its checkout is never touched here.
 *
 * ── A SETTLEMENT RUNS BESIDE A REVISE, NOT AFTER IT (review r4) ──────────────────────
 * Recording money is "read the payment, flip it to paid, close the order's checkouts", and
 * a manager's revise can land between any two of those: its carry (payment-carry.ts)
 * re-points the family's payments at a NEW quote row. The first cut of this module was
 * handed the quote id the settlement had READ and looked only there — so a payment that
 * moved between the read and the flip was recorded paid while its own hosted page, attached
 * on the new revision, stayed payable, and the audit row said nothing was open.
 *
 * So this module never trusts a revision:
 *   1. THE SETTLED INTENT'S OWN CHECKOUT comes from the settlement's FLIP, which returns the
 *      row it wrote (`settledSessionId`). It is retired FIRST, from that value alone — no
 *      read, no quote filter, nothing a revise can move out from under it. A session a
 *      payment was paid THROUGH (`paidThroughSessionId`, the webhook's event) is history and
 *      is left alone; any OTHER session the paid row names is a second way to pay the same
 *      money and is closed like the rest.
 *   2. THE ORDER'S OTHER CHECKOUTS are looked for across the whole FAMILY (every revision:
 *      `familyRevisionIds`), in one statement. A payment never leaves its family, so a row
 *      the carry has moved, or has not moved yet, is found wherever it is.
 *   3. …AND THE LOOK IS CHECKED. The family is read again afterwards; a revision that
 *      appeared in between may hold rows the look could not see, so the look is repeated
 *      (at most `MAX_FAMILY_LOOKS` times). A family still changing after that, or one that
 *      could not be read at all, is reported `stillOpen` under the settled payment's id.
 *      THIS MODULE NEVER ANSWERS "NOTHING OPEN" ABOUT AN ORDER IT COULD NOT FINISH LOOKING AT.
 *
 * THE ORDER OF OPERATIONS, AND WHY NO LOCK IS ADDED. A settlement is, in this order: the
 * guarded flip of ONE payment row (a single-row write: it queues behind migration 0303's
 * attach function, which holds every payment row of the quote while it decides, and behind
 * a carry's compare-and-set on the same row) → this module's reads → its retire calls → its
 * guarded clears. It takes no quote lock and holds nothing across a Stripe call, so it adds
 * no lock order to the one 0303 documents (quote row, then payment rows). What keeps a NEW
 * checkout from appearing after the look is the other half of that function: once the flip
 * has committed, an attach on this order answers `already_paid` (before 0303: the attach's
 * own re-read does). A hand-recorded payment's flip is additionally a compare-and-set on
 * the revision it was read on (lib/catering/payments.ts `markPaymentPaid`): a payment the
 * carry moved first is refused instead of recorded on a row nobody was looking at.
 *
 * ── IT HAS A TIME BUDGET, BECAUSE OF WHO CALLS IT ────────────────────────────────────
 * The webhook runs this AFTER the paid flip and BEFORE it stamps its verdict, writes its
 * audit row and sends the staff email — the reasons it finds belong in all three. A webhook
 * that hung here on a slow Stripe would be cut off by the platform with nothing stamped and
 * nobody told. That is no longer final (review r5: the redelivery RESUMES a settlement cut
 * off after its flip, and this function is idempotent — retiring an expired session answers
 * `expired`, every clear is guarded on its session id), but a redelivery is hours of an
 * open checkout away, so the pass is still bounded (`budgetMs`, our own number — not a
 * provider rule): a session whose retirement has not been confirmed inside it is reported
 * `stillOpen`, exactly like one that failed, and the payment is flagged NOW.
 * The common case costs nothing at Stripe: no row of the family names a session.
 *
 * ── A HAND-RECORDED PAYMENT HAS NO REDELIVERY, SO IT HAS A SECOND PRESS (review r5) ──
 * `markPaymentPaid` calls this once, inside the person's request. If that request is cut
 * off between its flip and this call, no redelivery will ever run it again. So the same
 * function, asked to mark a payment that is already paid BY HAND, runs this cleanup again
 * before it refuses (lib/catering/payments.ts) — pressing "Mark paid" again finishes the
 * job. KNOWN LIMIT: that needs the person to press it again. Until then every OTHER intent's
 * checkout keeps its id on its `due` / `void` row (visible to the pay path, which refuses
 * new collection on a paid order anyway), and a card charge through any leftover page is
 * recorded and flagged by the webhook (`already_settled` / `another_payment_already_paid`).
 * A hosted page cannot outlive Stripe's own limit either way ("It can be anywhere from 30
 * minutes to 24 hours after Checkout Session creation" — docs.stripe.com/api/checkout/
 * sessions/create, `expires_at`).
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { familyRevisionIds, retireSessionFor, type RetireSession } from "@/lib/catering/payment-carry";

type ServiceClient = ReturnType<typeof getServiceRoleClient>;

/** What happened to each checkout this pass looked at, by PAYMENT id. */
export interface ClosedCheckouts {
  /** Stripe confirmed the session expired; its id was cleared from the row. */
  retired: string[];
  /** Could not be confirmed closed (Stripe unreachable, no credentials, a failed read or
   *  write) — OR the order could not be looked at to the end, in which case the settled
   *  payment's own id stands in for "this order's checkouts". A row listed here still names
   *  its session. A person needs to look. */
  stillOpen: string[];
  /** The session was already `complete`: that customer's money is landing, and its own
   *  webhook event will record and flag it. The row keeps the id. */
  completing: string[];
}

export const NO_CHECKOUTS = (): ClosedCheckouts => ({ retired: [], stillOpen: [], completing: [] });

export interface CloseQuoteCheckoutsInput {
  /** ANY revision of the order's family (see the header): the one the flip returned is the
   *  natural choice, but a stale one finds the same family. */
  quoteId: string;
  /** The order's shop: its sessions live in that shop's Stripe account(s). Null = unknown, nothing is retired. */
  locationId: string | null;
  /** The payment that just settled. */
  settledPaymentId: string;
  /**
   * The Checkout Session the settled row NAMED AT THE INSTANT IT WAS FLIPPED — what the
   * flip's own returned row said, never an earlier read. Null = it named none. REQUIRED, so
   * a new way to record money has to decide (see the header, step 1).
   */
  settledSessionId: string | null;
  /** The session the money came THROUGH (the webhook's event). Omit for a payment recorded
   *  by hand: every session its row names is then a second way to pay it. */
  paidThroughSessionId?: string | null;
  /** Test seam. Production resolves the shop's own credentials (`retireSessionFor`). */
  retire?: RetireSession;
  /** The most this pass may spend waiting on Stripe, in ms (see the header). */
  budgetMs?: number;
}

/** The default budget: long enough for a healthy expire call, short enough for a webhook. */
export const CLOSE_CHECKOUTS_BUDGET_MS = 6_000;

/** How many times the family is looked at while revisions keep appearing under the look. */
const MAX_FAMILY_LOOKS = 3;

class BudgetSpent extends Error {}

/** `work`, or a `BudgetSpent` rejection once `ms` have passed. The timer never outlives it. */
async function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new BudgetSpent(`not confirmed closed within ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface SessionRow {
  id: string;
  kind: string;
  status: string;
  provider_session_id: string | null;
}

const pushOnce = (list: string[], id: string): void => {
  if (!list.includes(id)) list.push(id);
};

/**
 * Close the settled intent's own checkout and the order's other unresolved deposit / full
 * checkouts (see the header). NEVER THROWS. Asks Stripe nothing when there is no session to
 * close.
 */
export async function closeQuoteCheckouts(sb: ServiceClient, input: CloseQuoteCheckoutsInput): Promise<ClosedCheckouts> {
  const out = NO_CHECKOUTS();
  const deadline = Date.now() + (input.budgetMs ?? CLOSE_CHECKOUTS_BUDGET_MS);

  // The shop's way to Stripe, resolved ONCE and only when there is something to retire.
  let retire: RetireSession | undefined = input.retire;
  const retireFn = async (): Promise<RetireSession> => {
    if (retire !== undefined) return retire;
    retire = null;
    try {
      if (input.locationId) retire = await retireSessionFor(sb, input.locationId);
    } catch (e) {
      console.error(`[catering] could not resolve Stripe for quote ${input.quoteId}:`, e instanceof Error ? e.message : e);
    }
    return retire;
  };

  /** Retire ONE session and, on Stripe's confirmation, clear it from its row. Never throws. */
  const attempted = new Set<string>();
  const closeOne = async (paymentId: string, sessionId: string): Promise<void> => {
    if (attempted.has(`${paymentId}|${sessionId}`)) return;
    attempted.add(`${paymentId}|${sessionId}`);
    const call = await retireFn();
    if (!call) {
      pushOnce(out.stillOpen, paymentId);
      return;
    }
    // Checked BEFORE the call is made: a retire we start and then abandon would be a Stripe
    // request nobody is listening to. (One that outlives the budget below is still raced, so
    // its late answer — or its late failure — is handled, never an unhandled rejection.)
    const left = deadline - Date.now();
    if (left <= 0) {
      pushOnce(out.stillOpen, paymentId);
      return;
    }
    try {
      const outcome = await within(call(sessionId), left);
      if (outcome === "complete") {
        pushOnce(out.completing, paymentId);
        return;
      }
      // Confirmed expired. Clear the id — guarded on the exact session we retired, so a row
      // another request has since given a new checkout is left alone.
      // Zero rows is not a failure: the row no longer names that session (someone else
      // cleared or replaced it), and the session we were asked about IS closed either way.
      const { error } = await sb
        .from("catering_payments")
        .update({ provider_session_id: null })
        .eq("id", paymentId)
        .eq("provider_session_id", sessionId);
      if (error) throw new Error(error.message);
      pushOnce(out.retired, paymentId);
    } catch (e) {
      console.error(`[catering] could not close the checkout session of payment ${paymentId}:`, e instanceof Error ? e.message : e);
      pushOnce(out.stillOpen, paymentId);
    }
  };

  /** We could not finish looking, so we cannot say the order is clean (see the header). */
  const unresolved = (why: string, e?: unknown): ClosedCheckouts => {
    console.error(
      `[catering] the open checkouts of the order of payment ${input.settledPaymentId} (quote ${input.quoteId}) could not be checked: ${why}`,
      e instanceof Error ? e.message : (e ?? ""),
    );
    pushOnce(out.stillOpen, input.settledPaymentId);
    return out;
  };

  // 1. THE SETTLED INTENT'S OWN CHECKOUT — from the flip, before and regardless of any read.
  const own = input.settledSessionId;
  if (own && own !== (input.paidThroughSessionId ?? null)) await closeOne(input.settledPaymentId, own);

  // 2. THE ORDER'S OTHER CHECKOUTS — across the family, and the look is checked (step 3).
  let family: string[];
  try {
    family = await familyRevisionIds(sb, input.quoteId, "closeQuoteCheckouts");
  } catch (e) {
    return unresolved("its revisions could not be read", e);
  }
  for (let look = 1; ; look += 1) {
    let rows: SessionRow[];
    try {
      // Every row of the family (a handful) in ONE statement; the session filter is below.
      const { data, error } = await sb
        .from("catering_payments")
        .select("id, kind, status, provider_session_id")
        .in("quote_id", family)
        .returns<SessionRow[]>();
      if (error) throw new Error(error.message);
      rows = data ?? [];
    } catch (e) {
      return unresolved("its payments could not be read", e);
    }
    for (const r of rows) {
      if (!r.provider_session_id) continue;
      if (r.id === input.settledPaymentId) continue; // its own checkout was step 1's, from the flip
      if (r.status !== "due" && r.status !== "void") continue; // a paid / refunded row's id is history
      if (r.kind !== "deposit" && r.kind !== "full") continue; // a balance is the next step, not a duplicate
      await closeOne(r.id, r.provider_session_id);
    }

    // 3. Was that the whole family? A revision created during the look may hold rows a carry
    //    moved onto it before our statement ran.
    let now: string[];
    try {
      now = await familyRevisionIds(sb, input.quoteId, "closeQuoteCheckouts re-check");
    } catch (e) {
      return unresolved("its revisions could not be re-read", e);
    }
    if (now.every((id) => family.includes(id))) return out;
    if (look >= MAX_FAMILY_LOOKS) return unresolved(`it was revised ${look} times while it was being checked`);
    family = now;
  }
}
