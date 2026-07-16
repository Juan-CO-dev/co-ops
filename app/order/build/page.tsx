"use client";
/* eslint-disable @next/next/no-img-element -- mockup uses remote <img>; real build swaps to next/image */
/**
 * /order/build — Catering ORDER BUILDER (mockup pass v1).
 *
 * MOCKUP: interactive client prototype (no backend/auth) of the order-building step —
 * add items to a live cart, adjust quantities, see the running total. Per Juan: the ONLY
 * clicking is to build/complete the order; everything informative (food facts, tips, allergen
 * + deposit info) SURFACES ON ITS OWN — a rotating "good to know" ticker + contextual notes
 * that appear based on what's in the cart. Same style + feel as the storefront, cleaner.
 * Sample pricing is client-side; the real charge stack + auth land in the functional build.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

const T = (id: string) => `https://s3.amazonaws.com/toasttab/restaurants/restaurant-221473000000000000/menu/images/item-${id}.jpg`;
const VESUVIO = "https://static.spotapps.co/spots/d3/a96ed4e6d84d189e5f239fa7fc42e4/full";

interface Item { id: string; name: string; price: number; note?: string; img?: string; lead?: string }
interface Group { key: string; label: string; kind: "sub" | "row"; items: Item[] }

const MENU: Group[] = [
  {
    key: "platters", label: "Sandwich platters", kind: "row", items: [
      { id: "p8", name: "8 pc platter", price: 60, note: "serves 4–6 · assorted Classics" },
      { id: "p16", name: "16 pc platter", price: 115, note: "serves 8–16 · assorted Classics" },
      { id: "p32", name: "32 pc platter", price: 210, note: "serves 16–32 · assorted Classics" },
      { id: "p48", name: "48 pc platter", price: 330, note: "serves 24–48 · assorted Classics" },
    ],
  },
  {
    key: "subs", label: "Subs · 10\"", kind: "sub", items: [
      { id: "teamster", name: "The Teamster", price: 16.29, note: "Ham, capicola, genoa, provolone, hot & sweet peppers.", img: T("abd7ad07-cc58-4349-8c2f-1f88a43caa38") },
      { id: "crunchy", name: "Crunchy Boi", price: 15.79, note: "Turkey, provolone, potato chips, garlic mayo, pickles.", img: T("3846fa6d-2632-4fe4-8fab-a25c2f9b0b0a") },
      { id: "hotpants", name: "Hot Pants", price: 15.79, note: "Pepperoni, capicola, genoa, cholula mayo, hot peppers.", img: T("dbf2cd1a-9b17-491c-853a-907a960bc311") },
      { id: "marisa", name: "Marisa Tomei Eats Free", price: 15.29, note: "Capicola, genoa, fresh mozz, basil, honey chili aioli.", img: T("c780adb3-69c8-4b01-b640-7f3c269df298") },
      { id: "vesuvio", name: "Vesuvio II", price: 19.99, note: "Beef & pork meatballs, vodka sauce, melted mozzarella.", img: VESUVIO },
      { id: "frex", name: "The Frex", price: 18.39, note: "Ham, capicola, pepperoni, genoa, prosciutto, fresh mozz.", img: T("af933f0c-c537-46fa-a2ae-dd8b0fda3cca") },
    ],
  },
  {
    key: "boxes", label: "Individual lunch boxes", kind: "row", items: [
      { id: "light", name: "Light Lunch", price: 12, note: "5\" sub, chips, water & napkin" },
      { id: "full", name: "Full Lunch", price: 19.99, note: "10\" sub, assorted chips, water" },
    ],
  },
  {
    key: "big", label: "The really big subs", kind: "row", items: [
      { id: "three", name: "The Three Footer", price: 135, note: "3 ft of sub, your choice of Classics", lead: "48 hours notice" },
      { id: "six", name: "The Six Footer", price: 260, note: "Six freakin' feet of sub", lead: "72 hours notice" },
    ],
  },
  {
    key: "sides", label: "Sides", kind: "row", items: [
      { id: "greek", name: "House Greek Salad", price: 12 },
      { id: "caesar", name: "Caesar Salad", price: 12 },
      { id: "pasta", name: "Large Pasta Salad (32oz)", price: 16 },
      { id: "dip", name: "Large French Onion Dip", price: 20 },
      { id: "pickles", name: "Quart of Pickle Spears (12)", price: 9 },
      { id: "chips", name: "Case of Assorted Chips (24)", price: 52 },
    ],
  },
  {
    key: "sweets", label: "Sweets & drinks", kind: "row", items: [
      { id: "cookie", name: "Whisked! Chocolate Chip Cookie", price: 2.25 },
      { id: "berger", name: "Berger Cookies — Large", price: 9.99 },
      { id: "cannoli", name: "Fruity Pebble Cannoli", price: 2 },
      { id: "waters", name: "Dozen Waters", price: 12 },
      { id: "sodas", name: "24 Mixed Sodas", price: 48 },
    ],
  },
];

const FACTS = [
  "Everything's built the morning of your event — never the night before.",
  "48 hours notice keeps things smooth. The 3-footer needs 48, the six-footer 72.",
  "Allergen info is on every item — flag anything at checkout and we'll confirm.",
  "Delivery across DC, or free pickup at Capitol Hill or Dupont.",
  "“The Crunchy Boi is my go-to — it's just perfect.” — a real regular.",
  "House-made ingredients, sliced and built face-to-face.",
];

const ALL_ITEMS: Item[] = MENU.flatMap((g) => g.items);
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default function OrderBuild() {
  const [cart, setCart] = useState<Record<string, number>>({});
  const add = useCallback((id: string) => setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 })), []);
  const dec = useCallback((id: string) => setCart((c) => {
    const next = (c[id] ?? 0) - 1;
    const copy = { ...c };
    if (next <= 0) delete copy[id]; else copy[id] = next;
    return copy;
  }), []);

  const lines = useMemo(
    () => Object.entries(cart).map(([id, qty]) => ({ item: ALL_ITEMS.find((i) => i.id === id), qty })).filter((l): l is { item: Item; qty: number } => !!l.item),
    [cart],
  );
  const subtotal = lines.reduce((s, l) => s + l.item.price * l.qty, 0);
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const hasBig = lines.some((l) => l.item.id === "three" || l.item.id === "six");

  // Auto-surfacing rotating fact (no clicking).
  const [factIdx, setFactIdx] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setFactIdx((i) => (i + 1) % FACTS.length), 4500);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div className="min-h-screen bg-co-bg pb-28 text-co-text lg:pb-0">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-co-text/90 text-co-bg backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <Link href="/order" className="text-sm font-semibold text-co-bg/70 transition hover:text-co-bg">‹ Menu</Link>
          <span className="text-sm font-extrabold uppercase tracking-[0.22em]">Build your order</span>
          <span className="text-sm font-bold text-co-gold">{count > 0 ? `${count} item${count > 1 ? "s" : ""}` : " "}</span>
        </div>
      </header>

      {/* Auto fact ticker */}
      <div className="border-b border-co-border/50 bg-co-surface/60">
        <div key={factIdx} className="mx-auto max-w-6xl px-5 py-2.5 text-center text-sm text-co-text-muted transition-opacity duration-500">
          <span className="mr-2">💡</span>{FACTS[factIdx]}
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-5 py-8 lg:grid-cols-[1fr_360px]">
        {/* Menu */}
        <div className="flex flex-col gap-10">
          {MENU.map((g) => (
            <section key={g.key}>
              <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-co-text-dim">{g.label}</h2>
              {g.kind === "sub" ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {g.items.map((it) => (
                    <article key={it.id} className="flex overflow-hidden rounded-2xl border border-co-border/70 bg-co-surface">
                      <div className="relative w-28 shrink-0 bg-co-text/5"><img src={it.img} alt={it.name} loading="lazy" className="absolute inset-0 h-full w-full object-cover" /></div>
                      <div className="flex flex-1 flex-col p-4">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-extrabold text-co-text">{it.name}</h3>
                          <span className="shrink-0 text-sm font-bold text-co-cta">{money(it.price)}</span>
                        </div>
                        <p className="mt-0.5 flex-1 text-xs text-co-text-muted">{it.note}</p>
                        <AddControl id={it.id} qty={cart[it.id] ?? 0} add={add} dec={dec} />
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col divide-y divide-co-border/60 overflow-hidden rounded-2xl border border-co-border/70 bg-co-surface">
                  {g.items.map((it) => (
                    <div key={it.id} className="flex items-center justify-between gap-4 p-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-extrabold text-co-text">{it.name}</h3>
                          {it.lead && <span className="rounded-full bg-co-gold/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-co-text">{it.lead}</span>}
                        </div>
                        {it.note && <p className="mt-0.5 text-xs text-co-text-muted">{it.note}</p>}
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="text-sm font-bold text-co-cta">{money(it.price)}</span>
                        <AddControl id={it.id} qty={cart[it.id] ?? 0} add={add} dec={dec} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>

        {/* Cart (sticky on desktop) */}
        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <Cart lines={lines} subtotal={subtotal} hasBig={hasBig} dec={dec} add={add} />
          </div>
        </aside>
      </div>

      {/* Mobile cart summary bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-co-border bg-co-bg/95 px-5 py-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="text-sm"><span className="font-bold text-co-text">{count} item{count === 1 ? "" : "s"}</span><span className="ml-2 text-co-text-muted">{money(subtotal)}</span></div>
          <Link href="#" className={`inline-flex min-h-[46px] items-center justify-center rounded-full px-6 text-sm font-bold uppercase tracking-[0.08em] ${count > 0 ? "bg-co-text text-co-cta" : "pointer-events-none bg-co-border text-co-text-dim"}`}>Continue →</Link>
        </div>
      </div>
    </div>
  );
}

function AddControl({ id, qty, add, dec }: { id: string; qty: number; add: (id: string) => void; dec: (id: string) => void }) {
  if (qty === 0) {
    return <button type="button" onClick={() => add(id)} className="mt-2 self-start rounded-full bg-co-text px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-co-cta transition hover:bg-co-text/90">Add</button>;
  }
  return (
    <div className="mt-2 inline-flex items-center gap-3 self-start rounded-full border border-co-border-2 px-1.5 py-1">
      <button type="button" onClick={() => dec(id)} aria-label="Remove one" className="grid h-7 w-7 place-items-center rounded-full bg-co-surface text-lg font-bold text-co-text">−</button>
      <span className="min-w-4 text-center text-sm font-bold tabular-nums text-co-text">{qty}</span>
      <button type="button" onClick={() => add(id)} aria-label="Add one" className="grid h-7 w-7 place-items-center rounded-full bg-co-text text-lg font-bold text-co-cta">+</button>
    </div>
  );
}

function Cart({ lines, subtotal, hasBig, dec, add }: { lines: { item: Item; qty: number }[]; subtotal: number; hasBig: boolean; dec: (id: string) => void; add: (id: string) => void }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-co-border/70 bg-co-surface shadow-sm">
      <div className="border-b border-co-border/60 bg-co-text px-6 py-4 text-co-bg"><h2 className="text-lg font-extrabold">Your order</h2></div>
      <div className="p-6">
        {lines.length === 0 ? (
          <p className="text-sm text-co-text-muted">Add a platter or a few subs to get started — your order builds here.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {lines.map((l) => (
              <li key={l.item.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-co-text">{l.item.name}</p>
                  <p className="text-xs text-co-text-dim">{money(l.item.price)} each</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button type="button" onClick={() => dec(l.item.id)} className="grid h-6 w-6 place-items-center rounded-full bg-co-bg text-sm font-bold text-co-text">−</button>
                  <span className="w-4 text-center text-sm font-bold tabular-nums">{l.qty}</span>
                  <button type="button" onClick={() => add(l.item.id)} className="grid h-6 w-6 place-items-center rounded-full bg-co-text text-sm font-bold text-co-cta">+</button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {lines.length > 0 && (
          <div className="mt-5 flex items-center justify-between border-t border-co-border pt-4">
            <span className="text-sm font-semibold text-co-text-muted">Subtotal</span>
            <span className="text-lg font-extrabold text-co-text">{money(subtotal)}</span>
          </div>
        )}

        {/* Auto-surfacing contextual notes */}
        <div className="mt-4 flex flex-col gap-2">
          {hasBig && (
            <p className="rounded-xl border border-co-gold/50 bg-co-gold/15 px-3 py-2 text-xs font-semibold text-co-text">⏱ Heads up — big subs need 48–72 hours notice. We'll confirm your date.</p>
          )}
          {lines.length > 0 && (
            <p className="rounded-xl bg-co-bg px-3 py-2 text-xs text-co-text-muted">You'll pay a deposit to lock your date, with the balance due 48 hours before. We confirm within a few hours — no charge until we do.</p>
          )}
        </div>

        <Link href="#" className={`mt-5 flex min-h-[52px] items-center justify-center rounded-full text-base font-bold uppercase tracking-[0.08em] transition ${lines.length > 0 ? "bg-co-text text-co-cta hover:bg-co-text/90" : "pointer-events-none bg-co-border text-co-text-dim"}`}>Continue to details →</Link>
      </div>
    </div>
  );
}
