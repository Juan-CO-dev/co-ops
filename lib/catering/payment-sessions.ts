/**
 * Closing a quote's open Stripe Checkout Sessions once money has landed on it (audit wave
 * W02, review r3). SERVER-ONLY (it retires Stripe sessions).
 *
 * ── WHAT A SESSION ID ON A ROW MEANS ─────────────────────────────────────────────────
 * `catering_payments.provider_session_id` on a row that is `due` OR `void` is an UNRESOLVED
 * CHECKOUT: a hosted page a customer may still be able to pay. It stops being one in
 * exactly two ways — Stripe confirms the session expired (the id is then CLEARED), or the
 * session is paid (the webhook flips the row to `paid`, and the id becomes history). A
 * `paid` / `refunded` row's id is history and is never read as an open checkout.
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
 * ── IT HAS A TIME BUDGET, BECAUSE OF WHO CALLS IT ────────────────────────────────────
 * The webhook runs this AFTER the paid flip and BEFORE its audit row and staff email — the
 * reasons it finds belong in both. A retried delivery of a flip that already landed reports
 * `already_advanced` with no audit and no email, so a webhook that hung here on a slow
 * Stripe and was cut off would leave a payment recorded and nobody told. So the whole pass
 * is bounded (`budgetMs`, our own number — not a provider rule): a session whose retirement
 * has not been confirmed inside it is reported `stillOpen`, exactly like one that failed.
 * The common case costs nothing: no row of the quote names a session, Stripe is not asked.
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { retireSessionFor, type RetireSession } from "@/lib/catering/payment-carry";

type ServiceClient = ReturnType<typeof getServiceRoleClient>;

/** What happened to each checkout this pass looked at, by PAYMENT id. */
export interface ClosedCheckouts {
  /** Stripe confirmed the session expired; its id was cleared from the row. */
  retired: string[];
  /** Could not be confirmed closed (Stripe unreachable, no credentials, a failed read or
   *  write). The row still names the session. A person needs to look. */
  stillOpen: string[];
  /** The session was already `complete`: that customer's money is landing, and its own
   *  webhook event will record and flag it. The row keeps the id. */
  completing: string[];
}

export const NO_CHECKOUTS = (): ClosedCheckouts => ({ retired: [], stillOpen: [], completing: [] });

export interface CloseQuoteCheckoutsInput {
  quoteId: string;
  /** The quote's shop: the account that owns its sessions. Null = unknown, nothing is retired. */
  locationId: string | null;
  /**
   * The payment that just settled. Its siblings' checkouts are closed. Its OWN session is
   * closed too when `includeSettled` is true — a payment recorded BY HAND, whose hosted
   * page the customer could still pay by card as well. A payment that settled THROUGH its
   * session (the webhook) leaves that id alone: it is history.
   */
  settledPaymentId: string;
  includeSettled?: boolean;
  /** Test seam. Production resolves the shop's own credentials (`retireSessionFor`). */
  retire?: RetireSession;
  /** The most this pass may spend waiting on Stripe, in ms (see the header). */
  budgetMs?: number;
}

/** The default budget: long enough for a healthy expire call, short enough for a webhook. */
export const CLOSE_CHECKOUTS_BUDGET_MS = 6_000;

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

/**
 * Retire the quote's unresolved deposit / full checkouts (see the header). NEVER THROWS.
 * Asks Stripe nothing when no row of the quote names a session.
 */
export async function closeQuoteCheckouts(sb: ServiceClient, input: CloseQuoteCheckoutsInput): Promise<ClosedCheckouts> {
  const out = NO_CHECKOUTS();
  let targets: SessionRow[] = [];
  try {
    // Every row of the quote (a handful); the session filter is applied below.
    const { data, error } = await sb
      .from("catering_payments")
      .select("id, kind, status, provider_session_id")
      .eq("quote_id", input.quoteId)
      .returns<SessionRow[]>();
    if (error) throw new Error(error.message);
    targets = (data ?? []).filter((r) => {
      if (!r.provider_session_id) return false;
      if (r.id === input.settledPaymentId) return input.includeSettled === true;
      return (r.status === "due" || r.status === "void") && (r.kind === "deposit" || r.kind === "full");
    });
  } catch (e) {
    // We could not look, so we cannot say the quote is clean. The settled payment's id
    // stands in for "this quote's checkouts" — the caller flags it for a person.
    console.error(`[catering] could not read the open checkouts of quote ${input.quoteId}:`, e instanceof Error ? e.message : e);
    out.stillOpen.push(input.settledPaymentId);
    return out;
  }
  if (targets.length === 0) return out;

  let retire: RetireSession = null;
  try {
    retire = input.retire !== undefined ? input.retire : input.locationId ? await retireSessionFor(sb, input.locationId) : null;
  } catch (e) {
    console.error(`[catering] could not resolve Stripe for quote ${input.quoteId}:`, e instanceof Error ? e.message : e);
  }

  const deadline = Date.now() + (input.budgetMs ?? CLOSE_CHECKOUTS_BUDGET_MS);
  for (const row of targets) {
    const sessionId = row.provider_session_id as string;
    if (!retire) {
      out.stillOpen.push(row.id);
      continue;
    }
    // Checked BEFORE the call is made: a retire we start and then abandon would be a Stripe
    // request nobody is listening to. (One that outlives the budget below is still raced, so
    // its late answer — or its late failure — is handled, never an unhandled rejection.)
    const left = deadline - Date.now();
    if (left <= 0) {
      out.stillOpen.push(row.id);
      continue;
    }
    try {
      const outcome = await within(retire(sessionId), left);
      if (outcome === "complete") {
        out.completing.push(row.id);
        continue;
      }
      // Confirmed expired. Clear the id — guarded on the exact session we retired, so a row
      // another request has since given a new checkout is left alone.
      // Zero rows is not a failure: the row no longer names that session (someone else
      // cleared or replaced it), and the session we were asked about IS closed either way.
      const { error } = await sb
        .from("catering_payments")
        .update({ provider_session_id: null })
        .eq("id", row.id)
        .eq("provider_session_id", sessionId);
      if (error) throw new Error(error.message);
      out.retired.push(row.id);
    } catch (e) {
      console.error(`[catering] could not close the checkout session of payment ${row.id}:`, e instanceof Error ? e.message : e);
      out.stillOpen.push(row.id);
    }
  }
  return out;
}
