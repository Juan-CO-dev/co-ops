"use client";
/**
 * /order/confirmation — Catering ORDER CONFIRMATION (mockup pass v1).
 *
 * MOCKUP: the "we've got it" screen the customer lands on after placing an order. No charge has
 * happened yet — v1 deposits are emailed secure links (Stripe in-flow is Wave 2), so this screen
 * sets expectations: pending our team's availability check, then a deposit link by email, then
 * pay-in-full by 48h before. Reads the order / details / charges the prior screens persisted to
 * sessionStorage; falls back to a representative sample when opened directly. Order number is
 * derived deterministically from the details (stable across renders — no hydration mismatch).
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Reveal } from "@/components/portal/Reveal";

const SERVICE_RATE = 0.08;
const TAX_RATE = 0.1;
const DELIVERY_FEE = 25;
const DEPOSIT_RATE = 0.25;

interface OrderLine { id: string; name: string; price: number; qty: number; summary: string; lead?: string }
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

const FACTS = [
  "Everything's built the morning of your event — never the night before.",
  "House-made ingredients, sliced and built face-to-face.",
  "Allergen info is on every item, and we'll confirm anything you flagged.",
];

function computeCharges(order: OrderBlob, details: Details): Charges {
  const serviceCharge = order.subtotal * SERVICE_RATE;
  const deliveryFee = details.fulfillment === "delivery" ? DELIVERY_FEE : 0;
  const tax = (order.subtotal + serviceCharge + deliveryFee) * TAX_RATE;
  const total = order.subtotal + serviceCharge + deliveryFee + tax;
  const deposit = total * DEPOSIT_RATE;
  return { total, deposit, balance: total - deposit };
}
function orderNumber(details: Details): string {
  const seed = `${details.email}|${details.date}`;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const suffix = h.toString(36).toUpperCase().padStart(4, "0").slice(0, 4);
  const datePart = (details.date || "").replace(/-/g, "").slice(2) || "TBD";
  return `CO-${datePart}-${suffix}`;
}
function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00`);
  if (Number.isNaN(d.getTime())) return iso || "Date TBD";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

export default function OrderConfirmation() {
  const [state, setState] = useState<{ order: OrderBlob; details: Details; charges: Charges } | null>(null);

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

  const fact = useMemo(() => {
    if (!state) return FACTS[0];
    // deterministic pick from the order number, no Math.random
    const n = orderNumber(state.details).split("").reduce((a, ch) => a + ch.charCodeAt(0), 0);
    return FACTS[n % FACTS.length];
  }, [state]);

  if (!state) {
    return (
      <div className="grid min-h-screen place-items-center bg-co-bg text-co-text-dim">
        <p className="text-sm">Finishing up…</p>
      </div>
    );
  }

  const { order, details, charges } = state;
  const isCompany = !!details.company.trim();
  const firstName = (details.name || "there").trim().split(" ")[0] ?? "there";

  return (
    <div className="min-h-screen bg-co-bg text-co-text">
      <header className="border-b border-white/10 bg-co-text text-co-bg">
        <div className="mx-auto flex max-w-2xl items-center justify-center px-5 py-4">
          <span className="text-sm font-extrabold uppercase tracking-[0.22em]">Compliments Only</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-5 py-10">
        {/* Success hero */}
        <Reveal className="text-center">
          <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-co-success/20 text-4xl text-co-success">✓</div>
          <h1 className="mt-6 text-3xl font-extrabold tracking-tight text-co-text sm:text-4xl">You&apos;re locked in, {firstName}!</h1>
          <p className="mx-auto mt-3 max-w-md text-co-text-muted">Your <span className="font-bold text-co-text">{money(charges.deposit)}</span> deposit is in and {formatDate(details.date)} is held — pending our team&apos;s confirmation, usually within 24 hours. Here&apos;s what happens next.</p>
          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-co-border bg-co-surface px-4 py-2 text-sm">
            <span className="font-bold uppercase tracking-wide text-co-text-dim">Order</span>
            <span className="font-extrabold tabular-nums text-co-text">{orderNumber(details)}</span>
          </div>
        </Reveal>

        {/* What happens next */}
        <Reveal className="mt-9">
          <ol className="flex flex-col gap-4">
            <Next n="1" title="Deposit paid — date locked" tone="done">Your {formatDate(details.date).split(",")[0]} spot is held. Nothing more to do right now.</Next>
            <Next n="2" title="We confirm your order — usually within 24 hours" tone="active">A team member checks we can do your date. If we can&apos;t, your deposit is refunded in full — otherwise you&apos;re locked in.</Next>
            <Next n="3" title="Pay the balance — up to 48h before">We&apos;ll email you a link for the <span className="font-bold text-co-text">{money(charges.balance)}</span> balance{isCompany ? <>, or put it on {details.company}&apos;s Net-30 / Net-60 terms</> : ""}. Pay anytime before the 48-hour mark — we&apos;ll remind you daily so it&apos;s easy.</Next>
            <Next n="4" title="We build it & deliver">Made the morning of and delivered on time. <span className="text-co-text-dim">(Miss the 48h balance deadline and the deposit is forfeited — so we&apos;ll keep the reminders coming.)</span></Next>
          </ol>
        </Reveal>

        {/* Order summary */}
        <Reveal className="mt-8">
          <section className="overflow-hidden rounded-3xl border border-co-border/70 bg-co-surface shadow-sm">
            <div className="border-b border-co-border/60 px-6 py-4"><h2 className="text-sm font-extrabold uppercase tracking-[0.14em] text-co-text-dim">Your order</h2></div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-co-border/50 px-6 py-5 sm:grid-cols-4">
              <SumCell label="Date" value={new Date(`${details.date}T00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })} />
              <SumCell label="Guests" value={`${details.guests || order.headcount}`} />
              <SumCell label={details.fulfillment === "delivery" ? "Delivery" : "Pickup"} value={details.fulfillment === "delivery" ? "To your address" : details.location} />
              <SumCell label="Contact" value={isCompany ? details.company : firstName} />
            </dl>
            <ul className="divide-y divide-co-border/50">
              {order.lines.map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-4 px-6 py-3.5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-co-text"><span className="tabular-nums text-co-text-muted">{l.qty}×</span> {l.name}</p>
                    {l.summary && <p className="mt-0.5 text-xs text-co-text-dim">{l.summary}</p>}
                  </div>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-co-text">{money(l.price * l.qty)}</span>
                </li>
              ))}
            </ul>
            <div className="border-t border-co-border/60 bg-co-bg/50 px-6 py-4">
              <div className="flex items-center justify-between text-sm text-co-text-muted"><span>Order total</span><span className="tabular-nums">{money(charges.total)}</span></div>
              <div className="mt-2 flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-sm font-bold text-co-success">✓ Deposit paid</span>
                <span className="text-base font-extrabold tabular-nums text-co-success">{money(charges.deposit)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-sm">
                <span className="font-semibold text-co-text">Balance due (by 48h before)</span>
                <span className="font-extrabold tabular-nums text-co-text">{money(charges.balance)}</span>
              </div>
            </div>
          </section>
        </Reveal>

        {/* Reassurance + contact */}
        <Reveal className="mt-6">
          <div className="rounded-2xl bg-co-text px-6 py-5 text-center text-co-bg">
            <p className="text-sm">💡 {fact}</p>
          </div>
          <p className="mt-5 text-center text-sm text-co-text-muted">Questions? Reply to your confirmation email or call <span className="font-bold text-co-text">(202) 621-8645</span>. We&apos;re on it.</p>
        </Reveal>

        <div className="mt-8 flex flex-col items-center gap-3">
          <Link href="/order" className="inline-flex min-h-[52px] items-center justify-center rounded-full bg-co-text px-9 text-base font-bold uppercase tracking-[0.08em] text-co-cta transition hover:bg-co-text/90">Back to the menu</Link>
          <p className="text-xs text-co-text-dim">A confirmation is on its way to {details.email} · Mockup</p>
        </div>
      </main>
    </div>
  );
}

function Next({ n, title, children, tone }: { n: string; title: string; children: React.ReactNode; tone?: "done" | "active" }) {
  const badge = tone === "done" ? "bg-co-success/20 text-co-success" : tone === "active" ? "bg-co-text text-co-gold" : "bg-co-bg text-co-text-dim ring-1 ring-co-border";
  return (
    <li className={`flex gap-4 rounded-2xl border p-5 shadow-sm ${tone === "done" ? "border-co-success/40 bg-co-success/5" : "border-co-border/60 bg-co-surface"}`}>
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-extrabold ${badge}`}>{tone === "done" ? "✓" : n}</span>
      <div>
        <h3 className="text-sm font-extrabold text-co-text">{title}</h3>
        <p className="mt-0.5 text-sm text-co-text-muted">{children}</p>
      </div>
    </li>
  );
}
function SumCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-co-text-dim">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-semibold text-co-text">{value}</dd>
    </div>
  );
}
