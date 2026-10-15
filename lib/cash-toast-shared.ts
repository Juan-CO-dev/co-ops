/**
 * Cash Deposit — the "Projected (from Toast)" figure. CLIENT-SAFE (pure, no I/O).
 *
 * B10 (owner decision, final): the Projected box prefills with that shop's Toast CASH
 * payments for the business day. The server reads the candidate rows in ONE round trip
 * (`cash_toast_projected_facts`, migration 0253, via lib/cash-toast.ts) and every rule
 * that decides what counts lives HERE, so vitest pins it (tests/cash-toast-projected.test.ts).
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────────────────
 * Projected = Σ amount_cents of counted CASH payments PAID on the day
 *           − Σ refund_amount_cents of counted CASH payments REFUNDED on the day.
 *
 * The SQL already bounds the rows to: this shop · `type = 'CASH'` · the LATEST snapshot of
 * each order (`toast_order_latest_pointers.snapshot_id`) · `paid_business_date = day`
 * (payments) or `refund_business_date = day` (refunds; the refunded order may be from any
 * earlier day — the cash left THIS day's drawer).
 *
 * A row COUNTS unless any of these is true (`cashToastRowCounts`):
 *   · payment_status is VOIDED or DENIED — the house exclusion set (0232/0239/0247 tips
 *     read `coalesce(payment_status,'') not in ('VOIDED','DENIED')`). Toast's other
 *     statuses (CAPTURED, AUTHORIZED, OPEN, PROCESSING, …) describe card settlement; for a
 *     cash tender they are not a "money did not change hands" signal, and a NULL status is
 *     KEPT (unknown is not voided), exactly as the reports do.
 *   · void_business_date is set — Toast stamped a void on the payment.
 *   · the latest order snapshot is deleted or voided (`toast_orders.deleted/voided`).
 *   · the check is deleted or voided (`toast_order_checks.deleted/voided`).
 * refund_status is NOT an exclusion: a refunded cash payment still came into the drawer on
 * its paid day; the refund leaves on ITS day as a separate subtraction (the refunds list).
 *
 * Tips are NOT included (`tip_cents` / `refund_tip_cents` are never read) — the form has its
 * own Cash tips field.
 *
 * UNKNOWN IS NOT ZERO: a counted row with a NULL amount makes the figure unknown → null
 * (no prefill, the key holder types it). No completed capture run for the shop+day → null.
 */

export interface CashToastFlags {
  payment_status: string | null;
  void_business_date: string | null;
  order_deleted: boolean | null;
  order_voided: boolean | null;
  check_deleted: boolean | null;
  check_voided: boolean | null;
}

export interface CashToastPaymentRow extends CashToastFlags { amount_cents: number | null }
export interface CashToastRefundRow extends CashToastFlags { refund_amount_cents: number | null }

/** The wire shape `cash_toast_projected_facts` returns (one jsonb value). */
export interface CashToastFacts {
  as_of: string | null;
  payments: CashToastPaymentRow[];
  refunds: CashToastRefundRow[];
}

/** The figure the form prefills and the deposit stores. */
export interface ToastProjected { cents: number; asOf: string }

/** Payment statuses that mean the tender never stood (house set, see header). */
export const CASH_TOAST_EXCLUDED_STATUSES: readonly string[] = ["VOIDED", "DENIED"];

/** Does this payment/refund row count toward the day's Toast cash? */
export function cashToastRowCounts(row: CashToastFlags): boolean {
  if (row.payment_status !== null && CASH_TOAST_EXCLUDED_STATUSES.includes(row.payment_status.toUpperCase())) return false;
  if (row.void_business_date !== null) return false;
  if (row.order_deleted === true || row.order_voided === true) return false;
  if (row.check_deleted === true || row.check_voided === true) return false;
  return true;
}

/**
 * The day's Toast cash figure, or null when Toast has none (no completed capture run, or a
 * counted row carries an unknown amount). May be negative (refunds above sales) — stored as
 * the truth; the form clamps only its prefill (`toastPrefillDollars`).
 */
export function computeToastCashProjected(facts: CashToastFacts | null): ToastProjected | null {
  if (!facts || !facts.as_of) return null;
  let cents = 0;
  for (const p of facts.payments) {
    if (!cashToastRowCounts(p)) continue;
    if (p.amount_cents === null || !Number.isFinite(p.amount_cents)) return null;
    cents += p.amount_cents;
  }
  for (const r of facts.refunds) {
    if (!cashToastRowCounts(r)) continue;
    if (r.refund_amount_cents === null || !Number.isFinite(r.refund_amount_cents)) return null;
    cents -= r.refund_amount_cents;
  }
  return { cents, asOf: facts.as_of };
}

/** The cents the Projected box is PREFILLED with: the Toast figure, clamped at zero; null = no prefill. */
export function toastPrefillCents(toast: ToastProjected | null): number | null {
  return toast ? Math.max(0, toast.cents) : null;
}

/** The Projected input's starting text: dollars with cents; "" when there is no figure. */
export function toastPrefillDollars(toast: ToastProjected | null): string {
  const cents = toastPrefillCents(toast);
  return cents === null ? "" : (cents / 100).toFixed(2);
}

/**
 * FORM: the Toast figure the Projected box was prefilled with, keyed by shop + business date.
 * The form compares edits against THIS, not the current prop: a router.refresh() (e.g. a language
 * switch) can bring a newer Toast figure while the input still holds the old prefill.
 */
export interface PrefillBaseline { key: string; toast: ToastProjected | null }

export function prefillBaselineKey(locationId: string, date: string): string {
  return `${locationId}|${date}`;
}

/**
 * Keep the baseline unless the shop or business date changed — then the form resets (draft AND
 * baseline together) to the current Toast figure. Returns `prev` itself when nothing changes, so
 * the caller's during-render prev-compare (`next !== prev`) is the reset signal.
 */
export function nextPrefillBaseline(
  prev: PrefillBaseline, locationId: string, date: string, current: ToastProjected | null,
): PrefillBaseline {
  const key = prefillBaselineKey(locationId, date);
  return prev.key === key ? prev : { key, toast: current };
}

/**
 * FORM ONLY: true when the typed Projected differs from what the page PREFILLED. This is a true
 * statement about an edit ("Changed from Toast ($X)") — it compares against the figure the key
 * holder actually saw, never a later re-read.
 */
export function projectedEditedFromPrefill(typedCents: number, toast: ToastProjected | null): boolean {
  const prefilled = toastPrefillCents(toast);
  return prefilled !== null && typedCents !== prefilled;
}

/**
 * SUBMITTED VIEW: which neutral Toast line shows under the stored Projected. The server re-read
 * Toast at save, and Toast may have moved since the page loaded — so a difference here is NOT
 * proof of an edit and the view never says "Changed":
 *   · "at_save" — signed figure differs from the stored Toast figure: "Toast at save: $X · <time>".
 *   · "from"    — they match: "From Toast · <time>".
 *   · "none"    — no Toast figure was stored (pre-0253 rows, or Toast had none).
 */
export function submittedToastLine(
  projectedCents: number, toastCents: number | null, toastAsOf: string | null,
): "at_save" | "from" | "none" {
  if (toastCents === null || !toastAsOf) return "none";
  return projectedCents === toastCents ? "from" : "at_save";
}
