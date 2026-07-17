/**
 * Payment plan — the one pure function encoding the unified quote/order money rules (Juan).
 *
 *   origin='self_serve'  → deposit REQUIRED (pay deposit → team confirms → pay balance).
 *   origin='staff' + event > 1 week out  → deposit OPTIONAL (deposit to lock, or pay in full).
 *   origin='staff' + event ≤ 1 week out (or no date)  → pay in FULL only.
 *
 * Total is always the full price; the deposit amount is the quote's snapshotted deposit_cents.
 * Net-30/60 (company accounts) is a future addition — a `netTermsAvailable` branch slots in here.
 * Amounts are integer cents. Client + server both call this so the pay options never drift.
 */

export type PaymentMode = "deposit_required" | "deposit_optional" | "full_only";
export type PaymentOptionKind = "deposit" | "full";

export interface PaymentOption {
  kind: PaymentOptionKind;
  amountCents: number;
  label: string;
  /** True when paying this locks the event date. */
  locks: boolean;
}
export interface PaymentPlan {
  mode: PaymentMode;
  options: PaymentOption[];
  depositCents: number; // the deposit amount for this quote (0 if the rule sets none)
  balanceCents: number; // remaining after a deposit (total − deposit)
  totalCents: number;
}

export const DEPOSIT_LEAD_DAYS = 7; // "more than a week out" ⇒ deposit is available

/** Whole days from `now` until the event date (local midnight), or null if no/invalid date. */
function daysUntil(eventDate: string | null, now: number): number | null {
  if (!eventDate) return null;
  const t = Date.parse(`${eventDate}T00:00:00`);
  if (Number.isNaN(t)) return null;
  return Math.floor((t - now) / (24 * 60 * 60 * 1000));
}

export interface PaymentPlanInput {
  origin: "self_serve" | "staff";
  eventDate: string | null;
  totalCents: number;
  depositCents: number;
  now?: number;
}

export function paymentPlan(input: PaymentPlanInput): PaymentPlan {
  const now = input.now ?? Date.now();
  const totalCents = input.totalCents;
  const depositCents = input.depositCents;
  const balanceCents = Math.max(0, totalCents - depositCents);

  if (input.origin === "self_serve") {
    // Always deposit-required → wait for confirmation → pay the balance.
    return {
      mode: "deposit_required",
      options: [{ kind: "deposit", amountCents: depositCents, label: "Pay deposit to reserve", locks: true }],
      depositCents,
      balanceCents,
      totalCents,
    };
  }

  // Staff-built custom quote: full price, deposit optional only when the event is far enough out.
  const days = daysUntil(input.eventDate, now);
  const farOut = days != null && days > DEPOSIT_LEAD_DAYS;
  if (farOut) {
    return {
      mode: "deposit_optional",
      options: [
        { kind: "deposit", amountCents: depositCents, label: "Pay deposit to lock the date", locks: true },
        { kind: "full", amountCents: totalCents, label: "Pay in full", locks: true },
      ],
      depositCents,
      balanceCents,
      totalCents,
    };
  }
  // ≤ 1 week out (or no date): pay in full.
  return {
    mode: "full_only",
    options: [{ kind: "full", amountCents: totalCents, label: "Pay in full", locks: true }],
    depositCents,
    balanceCents,
    totalCents,
  };
}
