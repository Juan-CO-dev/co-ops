"use client";
/**
 * /order/checkout — Catering DEPOSIT PAYMENT (mockup pass v1).
 *
 * MOCKUP: the in-app deposit step. Per Juan, the deposit is paid right here on the web app to
 * lock in the date + the customer's requirements — it is NOT an emailed link. (The emailed link
 * is later, for the remaining balance, after the team confirms the order.) Payment fields are
 * non-functional in the mockup; the real Stripe deposit lands in Wave 2. Reads the order /
 * details / charges the prior screens persisted; on "pay" it marks the deposit paid and hands
 * off to the confirmation screen.
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
    window.setTimeout(() => router.push("/order/confirmation"), 750);
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
        {/* Payment */}
        <div className="order-2 lg:order-1">
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-co-text-dim">Deposit</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-co-text sm:text-4xl">Pay your deposit to lock in {formatDate(details.date).split(",")[0]}.</h1>
          <p className="mt-2 text-co-text-muted">This <span className="font-bold text-co-text">{money(charges.deposit)}</span> deposit holds your date and your requirements. Our team then confirms your order and emails you to pay the balance.</p>

          {/* Express pay (mock) */}
          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
            <button type="button" className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-co-text text-sm font-bold text-co-bg transition hover:bg-co-text/90"> Pay</button>
            <button type="button" className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl border-2 border-co-border-2 bg-co-surface text-sm font-bold text-co-text transition hover:border-co-text/40">G Pay</button>
          </div>
          <div className="my-5 flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-co-text-dim"><span className="h-px flex-1 bg-co-border" />or pay by card<span className="h-px flex-1 bg-co-border" /></div>

          {/* Card form (mock) */}
          <div className="flex flex-col gap-4 rounded-3xl border border-co-border/70 bg-co-surface p-6 shadow-sm">
            <Field label="Card number"><input inputMode="numeric" placeholder="1234 1234 1234 1234" className="ci" /></Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Expiry"><input inputMode="numeric" placeholder="MM / YY" className="ci" /></Field>
              <Field label="CVC"><input inputMode="numeric" placeholder="123" className="ci" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Name on card"><input placeholder={details.name || "Full name"} className="ci" /></Field>
              <Field label="ZIP"><input inputMode="numeric" placeholder="20005" className="ci" /></Field>
            </div>
          </div>

          <button type="button" onClick={pay} disabled={paying} className={`mt-6 flex min-h-[56px] w-full items-center justify-center rounded-full text-base font-bold uppercase tracking-[0.08em] shadow-xl shadow-black/20 transition ${paying ? "cursor-wait bg-co-text/70 text-co-bg" : "bg-co-text text-co-cta hover:bg-co-text/90"}`}>
            {paying ? "Processing…" : `Pay ${money(charges.deposit)} deposit & lock my date`}
          </button>
          <p className="mt-3 text-center text-xs text-co-text-dim">After we confirm your order, we&apos;ll email you to pay the {money(charges.balance)} balance — due up to 48h before your event, or the deposit is forfeited. We&apos;ll remind you daily.</p>
          <p className="mt-4 rounded-xl bg-co-gold/15 px-4 py-2.5 text-center text-xs font-semibold text-co-text">Preview — payment isn&apos;t wired yet. This is a mockup of the Stripe deposit step (Wave 2).</p>
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

      <style>{`.ci{min-height:48px;width:100%;border-radius:0.75rem;border:2px solid var(--co-border-2,#e6ddc0);background:var(--co-bg,#fff9e4);padding:0 0.85rem;font-size:0.95rem;color:var(--co-text,#141414)}`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-co-text-dim">{label}</span>
      {children}
    </label>
  );
}
