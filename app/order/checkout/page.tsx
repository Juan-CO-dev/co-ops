"use client";
/**
 * /order/checkout — Catering DEPOSIT PAYMENT (mockup pass v2 — Stripe hand-off).
 *
 * MOCKUP: the in-app deposit step. Per Juan, the deposit is paid on the web app to lock in the
 * date + requirements — BUT payment goes through Stripe's hosted checkout so we never see or
 * store card details. So this page is the pre-Stripe hand-off: it shows the deposit + what it
 * does + the refund/confirmation terms, and the CTA "redirects to Stripe" (mocked). The real
 * build creates a Stripe Checkout session and redirects; on return we land the customer on
 * confirmation. No card fields ever live on our page.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const SERVICE_RATE = 0.08;
const TAX_RATE = 0.1;
const DELIVERY_FEE = 25;
const DEPOSIT_RATE = 0.25;

interface OrderLine { id: string; name: string; price: number; qty: number; summary: string }
interface OrderBlob { lines: OrderLine[]; subtotal: number; headcount: number }
interface Details { name: string; email: string; company: string; date: string; guests: string; fulfillment: "delivery" | "pickup"; location: string; address: string }
interface Charges { total: number; deposit: number; balance: number }

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const SAMPLE_ORDER: OrderBlob = {
  lines: [
    { id: "p32", name: "32 pc platter", price: 210, qty: 1, summary: "The Teamster, Crunchy Boi, Hot Pants, Marisa Tomei" },
    { id: "greek", name: "House Greek Salad", price: 12, qty: 2, summary: "" },
    { id: "cookie", name: "Whisked! Chocolate Chip Cookie", price: 2.25, qty: 20, summary: "" },
    { id: "sodas", name: "24 Mixed Sodas", price: 48, qty: 1, summary: "" },
  ],
  subtotal: 327,
  headcount: 20,
};
const SAMPLE_DETAILS: Details = { name: "Jordan Alvarez", email: "jordan@acmedesign.com", company: "Acme Design", date: "2026-08-14", guests: "20", fulfillment: "delivery", location: "Capitol Hill", address: "1200 K St NW, Washington, DC 20005" };

function computeCharges(order: OrderBlob, details: Details): Charges {
  const serviceCharge = order.subtotal * SERVICE_RATE;
  const deliveryFee = details.fulfillment === "delivery" ? DELIVERY_FEE : 0;
  const tax = (order.subtotal + serviceCharge + deliveryFee) * TAX_RATE;
  const total = order.subtotal + serviceCharge + deliveryFee + tax;
  const deposit = total * DEPOSIT_RATE;
  return { total, deposit, balance: total - deposit };
}
function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00`);
  if (Number.isNaN(d.getTime())) return iso || "Date TBD";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

export default function OrderCheckout() {
  const router = useRouter();
  const [state, setState] = useState<{ order: OrderBlob; details: Details; charges: Charges } | null>(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    let order = SAMPLE_ORDER;
    let details = SAMPLE_DETAILS;
    let charges: Charges | null = null;
    try {
      const o = window.sessionStorage.getItem("co_order");
      if (o) { const p = JSON.parse(o) as OrderBlob; if (p?.lines?.length) order = p; }
      const d = window.sessionStorage.getItem("co_order_details");
      if (d) { const p = JSON.parse(d) as Details; if (p?.email || p?.date) details = { ...SAMPLE_DETAILS, ...p }; }
      const c = window.sessionStorage.getItem("co_order_charges");
      if (c) { const p = JSON.parse(c) as Charges; if (typeof p?.total === "number") charges = p; }
    } catch { /* fall back to sample */ }
    setState({ order, details, charges: charges ?? computeCharges(order, details) });
  }, []);

  const pay = () => {
    if (paying) return;
    setPaying(true);
    try { window.sessionStorage.setItem("co_order_paid", "1"); } catch { /* non-fatal in mockup */ }
    // Real build: create a Stripe Checkout session + redirect; on return, land on confirmation.
    window.setTimeout(() => router.push("/order/confirmation"), 900);
  };

  const summaryDate = useMemo(() => (state ? new Date(`${state.details.date}T00:00`) : null), [state]);

  if (!state) {
    return (
      <div className="grid min-h-screen place-items-center bg-co-bg text-co-text-dim">
        <p className="text-sm">Loading checkout…</p>
      </div>
    );
  }

  const { order, details, charges } = state;
  const dayLabel = formatDate(details.date).split(",")[0] ?? "your date";

  return (
    <div className="min-h-screen bg-co-bg pb-10 text-co-text">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-co-text/90 text-co-bg backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-3.5">
          <Link href="/order/review" className="text-sm font-semibold text-co-bg/70 transition hover:text-co-bg">‹ Review</Link>
          <span className="flex items-center gap-1.5 text-sm font-extrabold uppercase tracking-[0.22em]"><span aria-hidden>🔒</span> Secure checkout</span>
          <span className="w-14" />
        </div>
      </header>

      <main className="mx-auto grid max-w-4xl grid-cols-1 gap-8 px-5 py-8 lg:grid-cols-[1fr_360px]">
        {/* Payment hand-off */}
        <div className="order-2 lg:order-1">
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-co-text-dim">Deposit</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-co-text sm:text-4xl">Pay your deposit to lock in {dayLabel}.</h1>
          <p className="mt-2 text-co-text-muted">Your <span className="font-bold text-co-text">{money(charges.deposit)}</span> deposit locks in your date &amp; requirements while a team member confirms your order — usually <span className="font-bold text-co-text">within 24 hours</span>. If we can&apos;t accommodate your date, it&apos;s refunded in full.</p>

          {/* Stripe hosted checkout — card data never touches our servers */}
          <div className="mt-6 rounded-3xl border border-co-border/70 bg-co-surface p-6 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-extrabold text-co-text"><span aria-hidden>🔒</span> Secure payment by Stripe</div>
            <p className="mt-2 text-sm text-co-text-muted">You&apos;ll complete payment on Stripe&apos;s secure checkout — card, Apple&nbsp;Pay, or Google&nbsp;Pay. <span className="font-semibold text-co-text">Compliments Only never sees or stores your card details.</span></p>
            <div className="mt-4 flex items-center justify-between rounded-2xl bg-co-text px-5 py-4 text-co-bg">
              <span className="text-sm font-semibold text-co-bg/70">Deposit due now</span>
              <span className="text-2xl font-extrabold tabular-nums">{money(charges.deposit)}</span>
            </div>
            <button type="button" onClick={pay} disabled={paying} className={`mt-4 flex min-h-[56px] w-full items-center justify-center gap-2 rounded-full text-base font-bold uppercase tracking-[0.08em] shadow-xl shadow-black/20 transition ${paying ? "cursor-wait bg-co-text/70 text-co-bg" : "bg-co-text text-co-cta hover:bg-co-text/90"}`}>
              {paying ? "Redirecting to secure checkout…" : <>Pay deposit securely <span aria-hidden>→</span></>}
            </button>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-co-text-dim"><span aria-hidden>🔒</span> Powered by <span className="font-bold text-co-text">Stripe</span> · PCI-compliant, encrypted</p>
          </div>

          <p className="mt-4 text-sm text-co-text-muted">Once your order is confirmed, we&apos;ll email you to pay the <span className="font-bold text-co-text">{money(charges.balance)}</span> balance — due up to 48h before your event, or the deposit is forfeited. We&apos;ll remind you daily.</p>
          <p className="mt-4 rounded-xl bg-co-gold/15 px-4 py-2.5 text-center text-xs font-semibold text-co-text">Preview — the Stripe checkout isn&apos;t wired yet. This mocks the hand-off (Wave 2).</p>
        </div>

        {/* Order summary */}
        <aside className="order-1 lg:order-2">
          <div className="overflow-hidden rounded-3xl border border-co-border/70 bg-co-surface shadow-sm lg:sticky lg:top-24">
            <div className="border-b border-co-border/60 bg-co-text px-6 py-4 text-co-bg">
              <p className="text-sm font-extrabold">Order summary</p>
              <p className="mt-0.5 text-xs text-co-bg/60">{summaryDate ? summaryDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : details.date} · {details.guests || order.headcount} guests · {details.fulfillment === "delivery" ? "Delivery" : `Pickup · ${details.location}`}</p>
            </div>
            <ul className="divide-y divide-co-border/50">
              {order.lines.map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-3 px-6 py-3">
                  <p className="min-w-0 text-sm text-co-text"><span className="tabular-nums text-co-text-muted">{l.qty}×</span> {l.name}</p>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-co-text">{money(l.price * l.qty)}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-2 border-t border-co-border/60 px-6 py-4 text-sm">
              <div className="flex items-center justify-between text-co-text-muted"><span>Order total</span><span className="tabular-nums">{money(charges.total)}</span></div>
              <div className="flex items-center justify-between border-t border-co-border pt-2">
                <span className="font-extrabold text-co-text">Deposit due now</span>
                <span className="text-lg font-extrabold tabular-nums text-co-cta">{money(charges.deposit)}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-co-text-dim"><span>Balance later (by 48h before)</span><span className="tabular-nums">{money(charges.balance)}</span></div>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
