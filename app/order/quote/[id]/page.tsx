/**
 * /order/quote/[id] — the shared customer review+pay surface (Portal-3).
 *
 * Server component. Requires a customer session (getCustomerFromHeaders → else redirect to sign
 * in). loadCustomerQuoteDetail enforces the ownership boundary (returns null for a quote the
 * caller doesn't own OR a missing quote), so a not-found state covers both without leaking which.
 * Renders the line items + the snapshotted charge stack + a pay panel whose options come from
 * paymentPlan(origin, eventDate, total, deposit). Visual style mirrors /order/review.
 *
 * ── WHAT HAS BEEN PAID IS A SERVER FACT, AND ONLY A SERVER FACT ──────────────────────
 * The `paid` rows come from `catering_payments` via loadCustomerQuoteDetail. A kind with a
 * paid row loses its button and gains a calm "payment received" line. `?checkout=success`
 * and `?checkout=cancel` are Stripe's return links and they are HINTS ONLY — anyone can
 * type them — so they render one notice and decide nothing. The money's status is what the
 * webhook wrote, never what the URL claims, and a success return that arrives before the
 * webhook honestly says "we're confirming it" rather than pretending.
 *
 * Dynamic route (per-customer, per-quote) — never statically prerendered.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCustomerFromHeaders } from "@/lib/portal/session";
import { loadCustomerQuoteDetail, type PortalPayment } from "@/lib/portal/quotes";
import { paymentPlan } from "@/lib/catering/payment-plan";
import { serverT } from "@/lib/i18n/server";
import { TranslationProvider } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { Quote, QuoteItem } from "@/lib/catering/quotes";
import { PayButtons } from "./pay-buttons";

/**
 * The portal has no per-customer language preference yet — every /order surface mounts
 * `TranslationProvider initialLanguage="en"`. Server-rendered strings resolve through the
 * same dictionaries with the same constant, so the day a customer language lands, this is
 * one variable, not a copy hunt.
 */
const PORTAL_LANG = "en" as const;
const t = (key: TranslationKey, params?: Record<string, string | number>) =>
  serverT(PORTAL_LANG, key, params);

const PAID_LINE_KEY: Record<PortalPayment["kind"], TranslationKey> = {
  deposit: "order.quote.paid_deposit",
  balance: "order.quote.paid_balance",
  full: "order.quote.paid_full",
};
const PAY_LABEL_KEY: Record<"deposit" | "full", TranslationKey> = {
  deposit: "order.quote.pay_deposit",
  full: "order.quote.pay_full",
};

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

function formatDate(iso: string | null): string {
  if (!iso) return "Date to be confirmed";
  const d = new Date(`${iso}T00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-co-bg pb-16 text-co-text">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-co-text/90 text-co-bg backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3.5">
          <Link href="/order" className="text-sm font-semibold text-co-bg/70 transition hover:text-co-bg">‹ Compliments Only</Link>
          <span className="text-sm font-extrabold uppercase tracking-[0.22em]">Your order</span>
          <span className="w-24" />
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-5 py-8">{children}</main>
    </div>
  );
}

export default async function QuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getCustomerFromHeaders();
  if (!ctx) redirect("/order/start"); // sign in first

  const { id } = await params; // Next 16 — params is a Promise.
  const query = await searchParams; // Next 16 — searchParams is a Promise too.
  const checkoutHint = query.checkout === "success" ? "success" : query.checkout === "cancel" ? "cancel" : null;
  const detail = await loadCustomerQuoteDetail(ctx.customerId, id);

  if (!detail) {
    return (
      <Shell>
        <div className="rounded-3xl border border-co-border/70 bg-co-surface p-8 text-center shadow-sm sm:p-10">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-co-gold/40 text-3xl">🔍</div>
          <h1 className="mt-5 text-2xl font-extrabold text-co-text">Order not found</h1>
          <p className="mx-auto mt-2 max-w-sm text-co-text-muted">
            We couldn&apos;t find that order on your account. If someone sent you a link, make sure
            you&apos;re signed in with the email it was sent to.
          </p>
          <Link
            href="/order"
            className="mt-6 inline-flex min-h-[48px] items-center justify-center rounded-full bg-co-text px-8 text-sm font-bold uppercase tracking-[0.08em] text-co-cta transition hover:bg-co-text/90"
          >
            Start an order →
          </Link>
        </div>
      </Shell>
    );
  }

  const quote: Quote = detail.quote;
  const items: QuoteItem[] = detail.items;
  const plan = paymentPlan({
    origin: detail.origin,
    eventDate: quote.eventDate,
    totalCents: quote.totalCents,
    depositCents: quote.depositCents,
  });

  // ONCE ANYTHING IS PAID, THE SELF-SERVE PANEL CLOSES — every option, not just the one
  // that was paid. `paymentPlan`'s options are both priced for an UNPAID quote: `deposit`
  // is deposit_cents and `full` is total_cents. So leaving `full` on the panel after a
  // deposit landed would offer the customer the whole total a second time, which is a
  // double charge wearing the label of a helpful button. The remaining BALANCE is a
  // `balance` intent the team raises (lib/catering/payment-plan.ts: deposit → team
  // confirms → balance), and this surface has never been able to create one.
  const paid = detail.payments.filter((p) => p.status === "paid");
  const payOptions = paid.length > 0 ? [] : plan.options;
  // What the customer still owes AFTER what has cleared. The closed panel must not read as
  // "nothing left to pay" when only the deposit landed (LRA-236): the balance is real money
  // the team raises later, so name it and say when it comes.
  const paidCents = paid.reduce((sum, p) => sum + p.amountCents, 0);
  const remainingCents = Math.max(0, quote.totalCents - paidCents);

  return (
    <Shell>
      <p className="text-xs font-bold uppercase tracking-[0.28em] text-co-text-dim">Review &amp; pay</p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-co-text sm:text-4xl">Here&apos;s your catering order.</h1>
      <p className="mt-2 text-co-text-muted">
        For {formatDate(quote.eventDate)}{quote.headcount ? ` · ${quote.headcount} guests` : ""}.
        Choose how you&apos;d like to pay below.
      </p>

      {/* Line items */}
      <section className="mt-7 overflow-hidden rounded-3xl border border-co-border/70 bg-co-surface shadow-sm">
        <div className="border-b border-co-border/60 px-6 py-4">
          <h2 className="text-sm font-extrabold uppercase tracking-[0.14em] text-co-text-dim">Your order</h2>
        </div>
        {items.length === 0 ? (
          <p className="px-6 py-5 text-sm text-co-text-dim">No line items on this order.</p>
        ) : (
          <ul className="divide-y divide-co-border/50">
            {items.map((l) => (
              <li key={l.id} className="flex items-start justify-between gap-4 px-6 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-co-text">
                    <span className="tabular-nums text-co-text-muted">{l.quantity}×</span> {l.description ?? "Item"}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-bold tabular-nums text-co-text">{money(l.lineTotalCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Charge stack (from the quote's snapshot) */}
      <section className="mt-5 overflow-hidden rounded-3xl border border-co-border/70 bg-co-surface shadow-sm">
        <div className="border-b border-co-border/60 px-6 py-4">
          <h2 className="text-sm font-extrabold uppercase tracking-[0.14em] text-co-text-dim">Price breakdown</h2>
        </div>
        <div className="flex flex-col gap-2.5 px-6 py-5 text-sm">
          <Row label="Subtotal" value={money(quote.subtotalCents)} />
          {quote.serviceChargeCents > 0 && <Row label="Service charge" value={money(quote.serviceChargeCents)} muted />}
          {quote.deliveryFeeCents > 0 && <Row label="Delivery" value={money(quote.deliveryFeeCents)} muted />}
          {quote.gratuityCents > 0 && <Row label="Gratuity" value={money(quote.gratuityCents)} muted />}
          {quote.taxCents > 0 && <Row label="Tax" value={money(quote.taxCents)} muted />}
          <div className="mt-1.5 flex items-center justify-between border-t border-co-border pt-3">
            <span className="text-base font-extrabold text-co-text">Total</span>
            <span className="text-lg font-extrabold tabular-nums text-co-text">{money(quote.totalCents)}</span>
          </div>
        </div>
      </section>

      {/* Stripe's return links are HINTS ONLY — one notice, zero authority over state. */}
      {checkoutHint && (
        <p
          className={`mt-5 rounded-2xl border px-5 py-4 text-sm font-semibold ${
            checkoutHint === "success"
              ? "border-co-gold/50 bg-co-gold/10 text-co-text"
              : "border-co-border bg-co-surface text-co-text-muted"
          }`}
        >
          {checkoutHint === "success" ? t("order.quote.checkout_success") : t("order.quote.checkout_cancel")}
        </p>
      )}

      {/* What has actually been paid — server-authoritative, from catering_payments. */}
      {paid.length > 0 && (
        <section className="mt-5 rounded-3xl border border-co-border/70 bg-co-surface p-6 shadow-sm">
          <h2 className="text-sm font-extrabold uppercase tracking-[0.14em] text-co-text-dim">
            {t("order.quote.paid_heading")}
          </h2>
          <ul className="mt-2 flex flex-col gap-1.5">
            {paid.map((p, i) => (
              <li key={`${p.kind}-${i}`} className="text-sm font-semibold text-co-text">
                {t(PAID_LINE_KEY[p.kind], { amount: money(p.amountCents) })}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Pay panel — options come from the server-side payment plan, minus what is paid */}
      {payOptions.length > 0 ? (
        <section className="mt-5 rounded-3xl border border-co-gold/50 bg-co-gold/10 p-6">
          <h2 className="text-sm font-extrabold text-co-text">
            {plan.mode === "deposit_required"
              ? "Pay your deposit to reserve"
              : plan.mode === "deposit_optional"
                ? "Choose how to pay"
                : "Pay in full"}
          </h2>
          <p className="mt-1 text-xs text-co-text-dim">
            {plan.mode === "deposit_required"
              ? "A deposit reserves your date while our team confirms your order. We'll email you to pay the balance."
              : plan.mode === "deposit_optional"
                ? "Lock your date with a deposit, or pay the full amount now."
                : "Your event is close — please pay the full amount to confirm."}
          </p>
          <div className="mt-5">
            <TranslationProvider initialLanguage={PORTAL_LANG}>
              <PayButtons
                quoteId={quote.id}
                options={payOptions.map((o) => ({
                  kind: o.kind,
                  amountCents: o.amountCents,
                  labelKey: PAY_LABEL_KEY[o.kind],
                }))}
              />
            </TranslationProvider>
          </div>
        </section>
      ) : (
        paid.length > 0 && (
          <p className="mt-5 text-center text-sm font-semibold text-co-text-muted">
            {remainingCents > 0
              ? t("order.quote.balance_later", { amount: money(remainingCents) })
              : t("order.quote.all_paid")}
          </p>
        )
      )}

      <p className="mt-6 text-center text-xs text-co-text-dim">
        Questions about your order? Reply to the email we sent and our team will help.
      </p>
    </Shell>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={muted ? "text-co-text-muted" : "font-semibold text-co-text"}>{label}</span>
      <span className={`tabular-nums ${muted ? "text-co-text-muted" : "font-bold text-co-text"}`}>{value}</span>
    </div>
  );
}
