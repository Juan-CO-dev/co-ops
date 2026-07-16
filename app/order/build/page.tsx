"use client";
/* eslint-disable @next/next/no-img-element -- mockup uses remote <img>; real build swaps to next/image */
/**
 * /order/build — Catering ORDER BUILDER (mockup pass v3).
 *
 * MOCKUP: interactive client prototype (no backend/auth). Per Juan:
 *  - Item-appropriate customize popup: à-la-carte subs customize the sub (instructions +
 *    allergens); PLATTERS pick the subs in the assortment (whole platter, not per-item);
 *    LUNCH BOXES pick the sub + the drink; BIG SUBS pick the sub; sides/sweets/drinks are qty.
 *  - Coverage shows UNDER and OVER — mains/sides/sweets/drinks vs headcount, including
 *    "seconds / thirds for all" so they can make a full decision.
 *  - Info auto-surfaces (ticker + contextual notes); the only clicks are order actions.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

const T = (id: string) => `https://s3.amazonaws.com/toasttab/restaurants/restaurant-221473000000000000/menu/images/item-${id}.jpg`;
const VESUVIO = "https://static.spotapps.co/spots/d3/a96ed4e6d84d189e5f239fa7fc42e4/full";

type Cat = "main" | "side" | "sweet" | "drink";
type Kind = "sub" | "platter" | "lunchbox" | "bigsub" | "simple";
interface Item { id: string; name: string; price: number; note?: string; img?: string; lead?: string; serves: number; cat: Cat; kind: Kind }
interface Group { key: string; label: string; layout: "sub" | "row"; items: Item[] }
interface Line { qty: number; notes: string; allergens: string[]; subs: string[]; sub: string; drink: string }

const SUB_CHOICES = ["The Teamster", "Crunchy Boi", "Hot Pants", "Marisa Tomei", "Vesuvio II", "The Frex", "Sicky Wicky Club", "Never Been Cheddar"];
const DRINK_CHOICES = ["Water", "Coke", "Diet Coke", "Natalie's Lemonade", "Topo Chico"];

const MENU: Group[] = [
  { key: "platters", label: "Sandwich platters", layout: "row", items: [
    { id: "p8", name: "8 pc platter", price: 60, note: "eight 5\" sandwiches · serves 4–6", serves: 5, cat: "main", kind: "platter" },
    { id: "p16", name: "16 pc platter", price: 115, note: "sixteen 5\" sandwiches · serves 8–16", serves: 12, cat: "main", kind: "platter" },
    { id: "p32", name: "32 pc platter", price: 210, note: "thirty-two 5\" sandwiches · serves 16–32", serves: 24, cat: "main", kind: "platter" },
    { id: "p48", name: "48 pc platter", price: 330, note: "forty-eight 5\" sandwiches · serves 24–48", serves: 36, cat: "main", kind: "platter" },
  ]},
  { key: "subs", label: "Subs · 10\"", layout: "sub", items: [
    { id: "teamster", name: "The Teamster", price: 16.29, note: "Ham, capicola, genoa, provolone, hot & sweet peppers.", img: T("abd7ad07-cc58-4349-8c2f-1f88a43caa38"), serves: 1, cat: "main", kind: "sub" },
    { id: "crunchy", name: "Crunchy Boi", price: 15.79, note: "Turkey, provolone, potato chips, garlic mayo, pickles.", img: T("3846fa6d-2632-4fe4-8fab-a25c2f9b0b0a"), serves: 1, cat: "main", kind: "sub" },
    { id: "hotpants", name: "Hot Pants", price: 15.79, note: "Pepperoni, capicola, genoa, cholula mayo, hot peppers.", img: T("dbf2cd1a-9b17-491c-853a-907a960bc311"), serves: 1, cat: "main", kind: "sub" },
    { id: "marisa", name: "Marisa Tomei Eats Free", price: 15.29, note: "Capicola, genoa, fresh mozz, basil, honey chili aioli.", img: T("c780adb3-69c8-4b01-b640-7f3c269df298"), serves: 1, cat: "main", kind: "sub" },
    { id: "vesuvio", name: "Vesuvio II", price: 19.99, note: "Beef & pork meatballs, vodka sauce, melted mozzarella.", img: VESUVIO, serves: 1, cat: "main", kind: "sub" },
    { id: "frex", name: "The Frex", price: 18.39, note: "Ham, capicola, pepperoni, genoa, prosciutto, fresh mozz.", img: T("af933f0c-c537-46fa-a2ae-dd8b0fda3cca"), serves: 1, cat: "main", kind: "sub" },
  ]},
  { key: "boxes", label: "Individual lunch boxes", layout: "row", items: [
    { id: "light", name: "Light Lunch", price: 12, note: "5\" sub, chips, water & napkin", serves: 1, cat: "main", kind: "lunchbox" },
    { id: "full", name: "Full Lunch", price: 19.99, note: "10\" sub, assorted chips, water", serves: 1, cat: "main", kind: "lunchbox" },
  ]},
  { key: "big", label: "The really big subs", layout: "row", items: [
    { id: "three", name: "The Three Footer", price: 135, note: "3 ft of sub, your choice of Classics", lead: "48 hours notice", serves: 12, cat: "main", kind: "bigsub" },
    { id: "six", name: "The Six Footer", price: 260, note: "Six freakin' feet of sub", lead: "72 hours notice", serves: 24, cat: "main", kind: "bigsub" },
  ]},
  { key: "sides", label: "Sides", layout: "row", items: [
    { id: "greek", name: "House Greek Salad", price: 12, serves: 8, cat: "side", kind: "simple" },
    { id: "caesar", name: "Caesar Salad", price: 12, serves: 8, cat: "side", kind: "simple" },
    { id: "pasta", name: "Large Pasta Salad (32oz)", price: 16, serves: 10, cat: "side", kind: "simple" },
    { id: "dip", name: "Large French Onion Dip", price: 20, serves: 12, cat: "side", kind: "simple" },
    { id: "chips", name: "Case of Assorted Chips (24)", price: 52, serves: 24, cat: "side", kind: "simple" },
  ]},
  { key: "sweets", label: "Sweets & drinks", layout: "row", items: [
    { id: "cookie", name: "Whisked! Chocolate Chip Cookie", price: 2.25, serves: 1, cat: "sweet", kind: "simple" },
    { id: "berger", name: "Berger Cookies — Large", price: 9.99, serves: 8, cat: "sweet", kind: "simple" },
    { id: "cannoli", name: "Fruity Pebble Cannoli", price: 2, serves: 1, cat: "sweet", kind: "simple" },
    { id: "waters", name: "Dozen Waters", price: 12, serves: 12, cat: "drink", kind: "simple" },
    { id: "sodas", name: "24 Mixed Sodas", price: 48, serves: 24, cat: "drink", kind: "simple" },
  ]},
];

const ALLERGENS = ["Peanuts", "Tree nuts", "Dairy", "Eggs", "Gluten", "Soy", "Shellfish", "Sesame"];
const FACTS = [
  "Everything's built the morning of your event — never the night before.",
  "48 hours notice keeps things smooth. The 3-footer needs 48, the six-footer 72.",
  "Allergen info is on every item — flag anything and we'll confirm.",
  "Delivery across DC, or free pickup at Capitol Hill or Dupont.",
  "“The Crunchy Boi is my go-to — it's just perfect.” — a real regular.",
  "House-made ingredients, sliced and built face-to-face.",
];
const ALL_ITEMS: Item[] = MENU.flatMap((g) => g.items);
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const emptyLine = (): Line => ({ qty: 1, notes: "", allergens: [], subs: [], sub: "", drink: "" });

export default function OrderBuild() {
  const [cart, setCart] = useState<Record<string, Line>>({});
  const [headcount, setHeadcount] = useState(20);
  const [modalId, setModalId] = useState<string | null>(null);

  const quickAdd = useCallback((id: string) => setCart((c) => ({ ...c, [id]: { ...(c[id] ?? emptyLine()), qty: (c[id]?.qty ?? 0) + 1 } })), []);
  const dec = useCallback((id: string) => setCart((c) => {
    const next = (c[id]?.qty ?? 0) - 1; const copy = { ...c };
    if (next <= 0) delete copy[id]; else copy[id] = { ...copy[id]!, qty: next };
    return copy;
  }), []);
  const applyCustom = useCallback((id: string, line: Line) => setCart((c) => ({ ...c, [id]: line })), []);

  const lines = useMemo(() => Object.entries(cart).map(([id, line]) => ({ item: ALL_ITEMS.find((i) => i.id === id)!, line })).filter((l) => l.item), [cart]);
  const subtotal = lines.reduce((s, l) => s + l.item.price * l.line.qty, 0);
  const count = lines.reduce((s, l) => s + l.line.qty, 0);
  const hasBig = lines.some((l) => l.item.id === "three" || l.item.id === "six");
  const servedBy = (cat: Cat) => lines.filter((l) => l.item.cat === cat).reduce((s, l) => s + l.item.serves * l.line.qty, 0);
  const coverage = { main: servedBy("main"), side: servedBy("side"), sweet: servedBy("sweet"), drink: servedBy("drink") };

  const [factIdx, setFactIdx] = useState(0);
  useEffect(() => { const t = window.setInterval(() => setFactIdx((i) => (i + 1) % FACTS.length), 4500); return () => window.clearInterval(t); }, []);
  const modalItem = modalId ? ALL_ITEMS.find((i) => i.id === modalId) ?? null : null;

  return (
    <div className="min-h-screen bg-co-bg pb-28 text-co-text lg:pb-0">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-co-text/90 text-co-bg backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <Link href="/order" className="text-sm font-semibold text-co-bg/70 transition hover:text-co-bg">‹ Menu</Link>
          <span className="text-sm font-extrabold uppercase tracking-[0.22em]">Build your order</span>
          <span className="text-sm font-bold text-co-gold">{count > 0 ? `${count} item${count > 1 ? "s" : ""}` : " "}</span>
        </div>
      </header>

      <div className="border-b border-co-border/50 bg-co-surface/60">
        <div key={factIdx} className="mx-auto max-w-6xl px-5 py-2.5 text-center text-sm text-co-text-muted transition-opacity duration-500"><span className="mr-2">💡</span>{FACTS[factIdx]}</div>
      </div>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-5 py-8 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-10">
          {MENU.map((g) => (
            <section key={g.key}>
              <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-co-text-dim">{g.label}</h2>
              {g.layout === "sub" ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {g.items.map((it) => (
                    <button key={it.id} type="button" onClick={() => setModalId(it.id)} className="group flex overflow-hidden rounded-2xl border border-co-border/70 bg-co-surface text-left transition hover:border-co-text/40 hover:shadow-lg">
                      <div className="relative w-28 shrink-0 bg-co-text/5"><img src={it.img} alt={it.name} loading="lazy" className="absolute inset-0 h-full w-full object-cover" /></div>
                      <div className="flex flex-1 flex-col p-4">
                        <div className="flex items-start justify-between gap-2"><h3 className="text-sm font-extrabold text-co-text">{it.name}</h3><span className="shrink-0 text-sm font-bold text-co-cta">{money(it.price)}</span></div>
                        <p className="mt-0.5 flex-1 text-xs text-co-text-muted">{it.note}</p>
                        <span className="mt-2 self-start text-xs font-bold uppercase tracking-wide text-co-text-dim transition group-hover:text-co-text">Customize →</span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col divide-y divide-co-border/60 overflow-hidden rounded-2xl border border-co-border/70 bg-co-surface">
                  {g.items.map((it) => (
                    <div key={it.id} className="flex items-center justify-between gap-4">
                      <button type="button" onClick={() => setModalId(it.id)} className="flex-1 p-4 text-left transition hover:bg-co-bg/40">
                        <div className="flex items-center gap-2"><h3 className="text-sm font-extrabold text-co-text">{it.name}</h3>{it.lead && <span className="rounded-full bg-co-gold/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-co-text">{it.lead}</span>}</div>
                        {it.note && <p className="mt-0.5 text-xs text-co-text-muted">{it.note}</p>}
                        {it.kind !== "simple" && <span className="mt-1 inline-block text-[11px] font-bold uppercase tracking-wide text-co-text-dim">Customize →</span>}
                      </button>
                      <div className="flex shrink-0 items-center gap-3 pr-4">
                        <span className="text-sm font-bold text-co-cta">{money(it.price)}</span>
                        <button type="button" onClick={() => quickAdd(it.id)} aria-label={`Quick add ${it.name}`} className="grid h-9 w-9 place-items-center rounded-full bg-co-text text-xl font-bold text-co-cta transition hover:bg-co-text/90">+</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>

        <aside className="hidden lg:block"><div className="sticky top-24">
          <Cart lines={lines} subtotal={subtotal} hasBig={hasBig} headcount={headcount} setHeadcount={setHeadcount} coverage={coverage} onCustomize={setModalId} dec={dec} add={quickAdd} />
        </div></aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-co-border bg-co-bg/95 px-5 py-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="text-sm"><span className="font-bold text-co-text">{count} item{count === 1 ? "" : "s"}</span><span className="ml-2 text-co-text-muted">{money(subtotal)}</span></div>
          <Link href="#" className={`inline-flex min-h-[46px] items-center justify-center rounded-full px-6 text-sm font-bold uppercase tracking-[0.08em] ${count > 0 ? "bg-co-text text-co-cta" : "pointer-events-none bg-co-border text-co-text-dim"}`}>Continue →</Link>
        </div>
      </div>

      {modalItem && <CustomizeModal item={modalItem} existing={cart[modalItem.id] ?? null} onClose={() => setModalId(null)} onSave={(line) => { applyCustom(modalItem.id, line); setModalId(null); }} />}
    </div>
  );
}

function coverLabel(served: number, H: number): { text: string; done: boolean; pct: number } {
  const pct = Math.min(100, Math.round((served / Math.max(1, H)) * 100));
  if (served === 0) return { text: "—", done: false, pct: 0 };
  const per = served / H;
  if (per < 1) return { text: `covers ~${served} of ${H}`, done: false, pct };
  if (per < 1.8) return { text: `✓ one each (~${served})`, done: true, pct };
  if (per < 2.8) return { text: `✓ seconds for all (~${served})`, done: true, pct };
  return { text: `✓ thirds+ (~${served})`, done: true, pct };
}
function Bar({ label, served, headcount, softer }: { label: string; served: number; headcount: number; softer?: boolean }) {
  const c = coverLabel(served, headcount);
  return (
    <div>
      <div className="flex items-center justify-between text-xs"><span className="font-semibold text-co-text">{label}</span><span className={c.done ? "font-bold text-co-success" : "text-co-text-dim"}>{c.text}</span></div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-co-border/50"><div className={`h-full rounded-full ${c.done ? "bg-co-success" : softer ? "bg-co-gold" : "bg-co-text"}`} style={{ width: `${c.pct}%` }} /></div>
    </div>
  );
}

function Cart({ lines, subtotal, hasBig, headcount, setHeadcount, coverage, onCustomize, dec, add }: {
  lines: { item: Item; line: Line }[]; subtotal: number; hasBig: boolean; headcount: number; setHeadcount: (n: number) => void;
  coverage: { main: number; side: number; sweet: number; drink: number }; onCustomize: (id: string) => void; dec: (id: string) => void; add: (id: string) => void;
}) {
  const gapNudge = (() => {
    if (lines.length === 0) return null;
    if (coverage.main < headcount) return `Mains cover ~${coverage.main} of ${headcount}. Add a platter to round it out.`;
    if (coverage.drink < headcount) return `No drinks for everyone yet — a case of sodas covers 24.`;
    if (coverage.sweet === 0) return `Add a sweet to finish — not everyone needs one, but it lands.`;
    if (coverage.main >= headcount * 1.8) return `Set for ${headcount} with seconds all around. 🎉`;
    return `Nicely covered for ${headcount}. Add more for seconds if you like.`;
  })();

  const lineSummary = (l: { item: Item; line: Line }) => {
    const bits: string[] = [];
    if (l.line.subs.length) bits.push(l.line.subs.join(", "));
    if (l.line.sub) bits.push(l.line.sub);
    if (l.line.drink) bits.push(l.line.drink);
    if (l.line.allergens.length) bits.push(`no ${l.line.allergens.join(", ").toLowerCase()}`);
    if (l.line.notes) bits.push(l.line.notes);
    return bits.join(" · ");
  };

  return (
    <div className="overflow-hidden rounded-3xl border border-co-border/70 bg-co-surface shadow-sm">
      <div className="border-b border-co-border/60 bg-co-text px-6 py-4 text-co-bg"><h2 className="text-lg font-extrabold">Your order</h2></div>
      <div className="p-6">
        {lines.length === 0 ? (
          <p className="text-sm text-co-text-muted">Tap an item to customize, or use + for a quick add. Your order builds here.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {lines.map((l) => (
              <li key={l.item.id}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0"><p className="truncate text-sm font-semibold text-co-text">{l.item.name}</p><p className="text-xs text-co-text-dim">{money(l.item.price)} each</p></div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button type="button" onClick={() => dec(l.item.id)} className="grid h-6 w-6 place-items-center rounded-full bg-co-bg text-sm font-bold text-co-text">−</button>
                    <span className="w-4 text-center text-sm font-bold tabular-nums">{l.line.qty}</span>
                    <button type="button" onClick={() => add(l.item.id)} className="grid h-6 w-6 place-items-center rounded-full bg-co-text text-sm font-bold text-co-cta">+</button>
                  </div>
                </div>
                {lineSummary(l) && <p className="mt-0.5 text-[11px] text-co-text-dim">{lineSummary(l)}</p>}
                {l.item.kind !== "simple" && <button type="button" onClick={() => onCustomize(l.item.id)} className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-co-text-dim underline">Customize</button>}
              </li>
            ))}
          </ul>
        )}

        {lines.length > 0 && <div className="mt-5 flex items-center justify-between border-t border-co-border pt-4"><span className="text-sm font-semibold text-co-text-muted">Subtotal</span><span className="text-lg font-extrabold text-co-text">{money(subtotal)}</span></div>}

        <div className="mt-5 rounded-2xl bg-co-bg p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-co-text-dim">Covering</span>
            <label className="flex items-center gap-1.5 text-xs text-co-text-muted">guests<input type="number" min={1} value={headcount} onChange={(e) => setHeadcount(Math.max(1, Number(e.target.value) || 1))} className="w-14 rounded-md border border-co-border-2 bg-co-surface px-2 py-1 text-sm font-bold text-co-text" /></label>
          </div>
          <div className="mt-3 flex flex-col gap-2.5">
            <Bar label="Mains" served={coverage.main} headcount={headcount} />
            <Bar label="Sides & chips" served={coverage.side} headcount={headcount} softer />
            <Bar label="Sweets" served={coverage.sweet} headcount={headcount} softer />
            <Bar label="Drinks" served={coverage.drink} headcount={headcount} softer />
          </div>
          {gapNudge && <p className="mt-3 text-xs font-semibold text-co-text">{gapNudge}</p>}
          <p className="mt-1 text-[11px] text-co-text-dim">Not everyone takes a sub, a sweet, or a drink — this is your at-a-glance guide.</p>
        </div>

        {hasBig && <p className="mt-3 rounded-xl border border-co-gold/50 bg-co-gold/15 px-3 py-2 text-xs font-semibold text-co-text">⏱ Big subs need 48–72 hours notice. We'll confirm your date.</p>}
        {lines.length > 0 && <p className="mt-2 rounded-xl bg-co-bg px-3 py-2 text-xs text-co-text-muted">Deposit locks your date; balance due 48h before. We confirm within a few hours — no charge until we do.</p>}

        <Link href="#" className={`mt-5 flex min-h-[52px] items-center justify-center rounded-full text-base font-bold uppercase tracking-[0.08em] transition ${lines.length > 0 ? "bg-co-text text-co-cta hover:bg-co-text/90" : "pointer-events-none bg-co-border text-co-text-dim"}`}>Continue to details →</Link>
      </div>
    </div>
  );
}

function Chips({ options, selected, onToggle, single }: { options: string[]; selected: string[]; onToggle: (v: string) => void; single?: boolean }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.includes(o);
        return <button key={o} type="button" onClick={() => onToggle(o)} aria-pressed={on} className={`rounded-full border-2 px-3 py-1 text-xs font-bold transition ${on ? (single ? "border-co-text bg-co-text text-co-bg" : "border-co-text bg-co-text/10 text-co-text") : "border-co-border-2 bg-co-surface text-co-text-muted hover:text-co-text"}`}>{o}</button>;
      })}
    </div>
  );
}

function CustomizeModal({ item, existing, onClose, onSave }: { item: Item; existing: Line | null; onClose: () => void; onSave: (line: Line) => void }) {
  const [line, setLine] = useState<Line>(existing ?? emptyLine());
  const set = (patch: Partial<Line>) => setLine((l) => ({ ...l, ...patch }));
  const toggleAllergen = (a: string) => set({ allergens: line.allergens.includes(a) ? line.allergens.filter((x) => x !== a) : [...line.allergens, a] });
  const toggleSub = (s: string) => set({ subs: line.subs.includes(s) ? line.subs.filter((x) => x !== s) : [...line.subs, s] });

  const k = item.kind;
  return (
    <div role="dialog" aria-modal="true" onClick={onClose} className="fixed inset-0 z-50 flex items-end justify-center bg-co-text/60 backdrop-blur-sm sm:items-center sm:p-4">
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg overflow-hidden rounded-t-3xl bg-co-bg shadow-2xl sm:rounded-3xl">
        {item.img && <div className="relative aspect-[16/9] bg-co-text/5"><img src={item.img} alt={item.name} className="absolute inset-0 h-full w-full object-cover" /></div>}
        <div className="max-h-[74vh] overflow-y-auto p-6">
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="text-xl font-extrabold text-co-text">{item.name}</h2>{item.note && <p className="mt-1 text-sm text-co-text-muted">{item.note}</p>}</div>
            <span className="shrink-0 text-lg font-extrabold text-co-cta">{money(item.price)}</span>
          </div>

          {k === "platter" && (
            <div className="mt-5">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-co-text-dim">Choose your subs — we'll make an even mix</p>
              <Chips options={SUB_CHOICES} selected={line.subs} onToggle={toggleSub} />
              <p className="mt-1.5 text-[11px] text-co-text-dim">Leave blank for our house assortment of the Classics.</p>
            </div>
          )}
          {(k === "lunchbox" || k === "bigsub") && (
            <div className="mt-5">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-co-text-dim">Choose the sub</p>
              <Chips options={SUB_CHOICES} selected={line.sub ? [line.sub] : []} onToggle={(s) => set({ sub: line.sub === s ? "" : s })} single />
            </div>
          )}
          {k === "lunchbox" && (
            <div className="mt-5">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-co-text-dim">Choose the drink</p>
              <Chips options={DRINK_CHOICES} selected={line.drink ? [line.drink] : []} onToggle={(d) => set({ drink: line.drink === d ? "" : d })} single />
            </div>
          )}

          {k !== "simple" && (
            <div className="mt-5">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-co-text-dim">Allergen alert — flag anything a guest can't have</p>
              <Chips options={ALLERGENS} selected={line.allergens} onToggle={toggleAllergen} />
              <p className="mt-1.5 text-[11px] text-co-text-dim">We'll confirm exactly how we handle it before you pay.</p>
            </div>
          )}

          <div className="mt-5">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-co-text-dim">Special instructions</p>
            <textarea value={line.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} placeholder="e.g. hold the onions, extra hot honey…" className="mt-2 w-full rounded-xl border-2 border-co-border-2 bg-co-surface px-3 py-2 text-sm text-co-text" />
          </div>

          <div className="mt-6 flex items-center gap-4">
            <div className="inline-flex items-center gap-3 rounded-full border-2 border-co-border-2 px-2 py-1.5">
              <button type="button" onClick={() => set({ qty: Math.max(1, line.qty - 1) })} className="grid h-8 w-8 place-items-center rounded-full bg-co-surface text-xl font-bold text-co-text">−</button>
              <span className="min-w-6 text-center text-base font-bold tabular-nums">{line.qty}</span>
              <button type="button" onClick={() => set({ qty: line.qty + 1 })} className="grid h-8 w-8 place-items-center rounded-full bg-co-text text-xl font-bold text-co-cta">+</button>
            </div>
            <button type="button" onClick={() => onSave({ ...line, notes: line.notes.trim() })} className="flex min-h-[52px] flex-1 items-center justify-center rounded-full bg-co-text text-base font-bold uppercase tracking-[0.08em] text-co-cta transition hover:bg-co-text/90">{existing ? "Update" : "Add"} · {money(item.price * line.qty)}</button>
          </div>
          <button type="button" onClick={onClose} className="mt-3 w-full py-2 text-center text-sm font-semibold text-co-text-muted">Cancel</button>
        </div>
      </div>
    </div>
  );
}
