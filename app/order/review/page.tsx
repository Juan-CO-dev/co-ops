"use client";
/**
 * /order/review — Catering ORDER REVIEW (mockup pass v1).
 *
 * MOCKUP: interactive client prototype (no backend/pricing engine). The "complete the order"
 * surface — per Juan, the ONE place the customer actually clicks to finish. Everything else
 * (event details, order, the full charge stack, the deposit + pay-in-full terms) surfaces
 * plainly and stays visible; no click-through accordions in the order flow.
 *
 * Reads the order the builder persisted to sessionStorage (co_order) + the event details the
 * entry flow persisted (co_order_details); falls back to a representative sample when opened
 * directly. Charge stack mirrors the real 1E shape — gratuity ≠ service charge, service charge
 * sits in the tax base — with illustrative rates (real rates are set server-side in the build).
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Reveal } from "@/components/portal/Reveal";
import { GoodToKnow, FaqOpen } from "@/components/portal/GoodToKnow";
import { FAQ, GTK } from "@/components/portal/portal-content";

// —— Illustrative rates (real rates are server-side authority in the functional build) ——
const SERVICE_RATE = 0.08; // kitchen & packing
const TAX_RATE = 0.1; // DC prepared-food / catering
const DELIVERY_FEE = 25; // flat, delivery only
const DEPOSIT_RATE = 0.25; // reserves the date; balance due in full 48h before
const TIP_PRESETS = [0, 0.15, 0.18, 0.2] as const;

interface OrderLine { id: string; name: string; price: number; kind: string; serves: number; qty: number; summary: string; lead?: string }
interface OrderBlob { lines: OrderLine[]; subtotal: number; headcount: number; coverage: { main: number; side: number; sweet: number; drink: number }; hasBig: boolean }
interface Details { name: string; email: string; company: string; date: string; guests: string; fulfillment: "delivery" | "pickup"; location: string; address: string }

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const SAMPLE_ORDER: OrderBlob = {
  lines: [
    { id: "p32", name: "32 pc platter", price: 210, kind: "platter", serves: 24, qty: 1, summary: "The Teamster, Crunchy Boi, Hot Pants, Marisa Tomei" },
    { id: "greek", name: "House Greek Salad", price: 12, kind: "simple", serves: 8, qty: 2, summary: "" },
    { id: "cookie", name: "Whisked! Chocolate Chip Cookie", price: 2.25, kind: "simple", serves: 1, qty: 20, summary: "" },
    { id: "sodas", name: "24 Mixed Sodas", price: 48, kind: "simple", serves: 24, qty: 1, summary: "" },
  ],
  subtotal: 210 + 24 + 45 + 48,
  headcount: 20,
  coverage: { main: 24, side: 16, sweet: 20, drink: 24 },
  hasBig: false,
};
const SAMPLE_DETAILS: Details = { name: "Jordan Alvarez", email: "jordan@acmedesign.com", company: "Acme Design", date: "2026-08-14", guests: "20", fulfillment: "delivery", location: "Capitol Hill", address: "1200 K St NW, Washington, DC 20005" };

function coverageLine(cov: OrderBlob["coverage"], h: number): string {
  const cats = [cov.main, cov.side, cov.sweet, cov.drink];
  if (cats.every((c) => c >= h * 1.8)) return `Set for ${h} guests — with seconds all around.`;
  if (cov.main >= h && cats.every((c) => c >= h)) return `Covered for ${h} guests, one of everything.`;
  if (cov.main >= h) return `Mains covered for ${h}; a light spread on the extras.`;
  return `Covers about ${cov.main} of ${h} — you can still add more from your cart.`;
}
function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00`);
  if (Number.isNaN(d.getTime())) return iso || "Date TBD";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

export default function OrderReview() {
  const router = useRouter();
  const [data, setData] = useState<{ order: OrderBlob; details: Details } | null>(null);
  const [tipRate, setTipRate] = useState<number>(0);

  useEffect(() => {
    let order = SAMPLE_ORDER;
    let details = SAMPLE_DETAILS;
    try {
      const o = window.sessionStorage.getItem("co_order");
      if (o) { const parsed = JSON.parse(o) as OrderBlob; if (parsed?.lines?.length) order = parsed; }
      const d = window.sessionStorage.getItem("co_order_details");
      if (d) { const parsed = JSON.parse(d) as Details; if (parsed?.email || parsed?.date) details = { ...SAMPLE_DETAILS, ...parsed }; }
    } catch { /* fall back to sample */ }
    setData({ order, details });
  }, []);

  const charges = useMemo(() => {
    if (!data) return null;
    const { subtotal } = data.order;
    const serviceCharge = subtotal * SERVICE_RATE;
    const deliveryFee = data.details.fulfillment === "delivery" ? DELIVERY_FEE : 0;
    const taxBase = subtotal + serviceCharge + deliveryFee;
    const tax = taxBase * TAX_RATE;
    const gratuity = subtotal * tipRate;
    const total = subtotal + serviceCharge + deliveryFee + tax + gratuity;
    const deposit = total * DEPOSIT_RATE;
    return { subtotal, serviceCharge, deliveryFee, tax, gratuity, total, deposit, balance: total - deposit };
  }, [data, tipRate]);

  const toCheckout = () => {
    if (data && charges) {
      try {
        window.sessionStorage.setItem("co_order_charges", JSON.stringify({ ...charges, tipRate }));
      } catch { /* non-fatal in mockup */ }
    }
    router.push("/order/checkout");
  };

  if (!data || !charges) {
    return (
      <div className="grid min-h-screen place-items-center bg-co-bg text-co-text-dim">
        <p className="text-sm">Loading your order…</p>
      </div>
    );
  }

  const { order, details } = data;
  const isCompany = !!details.company.trim();

  return (
    <div className="min-h-screen bg-co-bg pb-32 text-co-text">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-co-text/90 text-co-bg backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3.5">
          <Link href="/order/build" className="text-sm font-semibold text-co-bg/70 transition hover:text-co-bg">‹ Order</Link>
          <span className="text-sm font-extrabold uppercase tracking-[0.22em]">Review &amp; reserve</span>
          <span className="w-12" />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-5 py-8">
        <Reveal>
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-co-text-dim">Last step</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-co-text sm:text-4xl">Review, then lock in your date.</h1>
          <p className="mt-2 text-co-text-muted">Here&apos;s everything in one place. Your deposit locks your date &amp; requirements while a team member confirms your order — usually within 24 hours — then we email you to pay the balance before the event.</p>
        </Reveal>

        {/* Event details */}
        <Reveal className="mt-7">
          <section className="overflow-hidden rounded-3xl border border-co-border/70 bg-co-surface shadow-sm">
            <div className="flex items-center justify-between border-b border-co-border/60 px-6 py-4">
              <h2 className="text-sm font-extrabold uppercase tracking-[0.14em] text-co-text-dim">Event details</h2>
              <Link href="/order/start" className="text-xs font-bold uppercase tracking-wide text-co-text underline decoration-co-gold decoration-2 underline-offset-4">Edit</Link>
            </div>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 p-6 sm:grid-cols-2">
              <Detail label="Date" value={formatDate(details.date)} />
              <Detail label="Guests" value={`${details.guests || order.headcount} people`} />
              <Detail label={details.fulfillment === "delivery" ? "Delivery to" : "Pickup at"} value={details.fulfillment === "delivery" ? details.address || "Address on file" : `${details.location} shop`} />
              <Detail label="Contact" value={details.email} sub={isCompany ? details.company : details.name} />
            </dl>
          </section>
        </Reveal>

        {/* Your order */}
        <Reveal className="mt-5">
          <section className="overflow-hidden rounded-3xl border border-co-border/70 bg-co-surface shadow-sm">
            <div className="flex items-center justify-between border-b border-co-border/60 px-6 py-4">
              <h2 className="text-sm font-extrabold uppercase tracking-[0.14em] text-co-text-dim">Your order</h2>
              <Link href="/order/build" className="text-xs font-bold uppercase tracking-wide text-co-text underline decoration-co-gold decoration-2 underline-offset-4">Edit order</Link>
            </div>
            <ul className="divide-y divide-co-border/50">
              {order.lines.map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-4 px-6 py-4">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-co-text"><span className="tabular-nums text-co-text-muted">{l.qty}×</span> {l.name}</p>
                    {l.summary && <p className="mt-0.5 text-xs text-co-text-dim">{l.summary}</p>}
                    {l.lead && <p className="mt-1 inline-block rounded-full bg-co-gold/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-co-text">{l.lead}</p>}
                  </div>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-co-text">{money(l.price * l.qty)}</span>
                </li>
              ))}
            </ul>
            <div className="border-t border-co-border/60 bg-co-bg/50 px-6 py-3">
              <p className="text-sm font-semibold text-co-text">{coverageLine(order.coverage, Number(details.guests) || order.headcount)}</p>
            </div>
          </section>
        </Reveal>

        {/* Reassurance — surfaces before you commit, no click needed */}
        <Reveal className="mt-5 flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FaqOpen q={FAQ.count.q} a={FAQ.count.a} />
            <FaqOpen q={FAQ.changeOrder.q} a={FAQ.changeOrder.a} />
          </div>
          <GoodToKnow items={GTK.review} tone="gold" />
        </Reveal>

        {/* Tip (optional) */}
        <Reveal className="mt-5">
          <section className="rounded-3xl border border-co-border/70 bg-co-surface p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-extrabold text-co-text">Add a tip for the crew</h2>
                <p className="mt-0.5 text-xs text-co-text-dim">Optional — 100% goes to the team who builds &amp; delivers.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {TIP_PRESETS.map((r) => (
                  <button key={r} type="button" onClick={() => setTipRate(r)} aria-pressed={tipRate === r} className={`min-w-14 rounded-full border-2 px-3.5 py-1.5 text-sm font-bold transition ${tipRate === r ? "border-co-text bg-co-text text-co-bg" : "border-co-border-2 bg-co-surface text-co-text-muted hover:text-co-text"}`}>{r === 0 ? "None" : `${Math.round(r * 100)}%`}</button>
                ))}
              </div>
            </div>
          </section>
        </Reveal>

        {/* Charge stack */}
        <Reveal className="mt-5">
          <section className="overflow-hidden rounded-3xl border border-co-border/70 bg-co-surface shadow-sm">
            <div className="border-b border-co-border/60 px-6 py-4"><h2 className="text-sm font-extrabold uppercase tracking-[0.14em] text-co-text-dim">Price breakdown</h2></div>
            <div className="flex flex-col gap-2.5 px-6 py-5 text-sm">
              <Row label="Subtotal" value={money(charges.subtotal)} />
              <Row label="Service charge (kitchen & packing)" value={money(charges.serviceCharge)} muted />
              <Row label={details.fulfillment === "delivery" ? "Delivery" : "Pickup"} value={charges.deliveryFee > 0 ? money(charges.deliveryFee) : "Free"} muted />
              {charges.gratuity > 0 && <Row label="Tip for the crew" value={money(charges.gratuity)} muted />}
              <Row label="Estimated DC tax" value={money(charges.tax)} muted />
              <div className="mt-1.5 flex items-center justify-between border-t border-co-border pt-3">
                <span className="text-base font-extrabold text-co-text">Total</span>
                <span className="text-lg font-extrabold tabular-nums text-co-text">{money(charges.total)}</span>
              </div>
            </div>
            {/* Deposit split */}
            <div className="border-t border-co-border/60 bg-co-text px-6 py-5 text-co-bg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-extrabold text-co-gold">Deposit to lock in your date</p>
                  <p className="mt-0.5 text-xs text-co-bg/60">{Math.round(DEPOSIT_RATE * 100)}% now · locks your date &amp; requirements</p>
                </div>
                <span className="text-2xl font-extrabold tabular-nums text-co-bg">{money(charges.deposit)}</span>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
                <p className="text-xs font-semibold text-co-bg/70">Balance — pay by 48h before, or forfeit</p>
                <span className="text-sm font-bold tabular-nums text-co-bg/90">{money(charges.balance)}</span>
              </div>
            </div>
          </section>
        </Reveal>

        {/* How payment works — surfaced plainly, not hidden behind a click */}
        <Reveal className="mt-5">
          <section className="rounded-3xl border border-co-gold/50 bg-co-gold/10 p-6">
            <h2 className="text-sm font-extrabold text-co-text">How payment works</h2>
            <ol className="mt-3 flex flex-col gap-3 text-sm text-co-text">
              <PayStep n="1" title={`Pay your ${Math.round(DEPOSIT_RATE * 100)}% deposit — securely via Stripe.`}>It locks in your date and requirements while a team member reviews your order. We never see or store your card.</PayStep>
              <PayStep n="2" title="We confirm your order — usually within 24 hours.">If we can&apos;t accommodate your date, your deposit is refunded in full.</PayStep>
              <PayStep n="3" title="We email you to pay the balance.">{isCompany ? <>Pay anytime up to 48h before — or use {details.company}&apos;s Net-30 / Net-60 terms. We&apos;ll remind you daily.</> : <>Pay the balance anytime up to 48 hours before your event. We&apos;ll remind you daily so it&apos;s easy.</>}</PayStep>
              <PayStep n="4" title="Miss the 48h deadline and the deposit is forfeited.">So we nudge you daily until it&apos;s paid — then we build &amp; deliver.</PayStep>
            </ol>
          </section>
        </Reveal>

        <p className="mt-6 text-center text-xs text-co-text-dim">Prices shown are estimates and are re-confirmed by our team when they confirm your order.</p>
      </main>

      {/* Sticky place-order bar — the one click that completes the order */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-co-border bg-co-bg/95 px-5 py-3.5 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-co-text-dim">Deposit to lock in</p>
            <p className="text-lg font-extrabold tabular-nums text-co-text">{money(charges.deposit)}<span className="ml-1.5 text-xs font-semibold text-co-text-dim">of {money(charges.total)}</span></p>
          </div>
          <button type="button" onClick={toCheckout} className="inline-flex min-h-[54px] flex-1 items-center justify-center rounded-full bg-co-text px-6 text-sm font-bold uppercase tracking-[0.08em] text-co-cta shadow-xl shadow-black/20 transition hover:bg-co-text/90 sm:flex-none sm:px-10">Pay deposit &amp; lock my date →</button>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-co-text-dim">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-co-text">{value}</dd>
      {sub && <dd className="text-xs text-co-text-muted">{sub}</dd>}
    </div>
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
function PayStep({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-co-text text-xs font-extrabold text-co-gold">{n}</span>
      <span><span className="font-bold text-co-text">{title}</span> <span className="text-co-text-muted">{children}</span></span>
    </li>
  );
}
