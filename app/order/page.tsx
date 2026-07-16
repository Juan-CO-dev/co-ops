/**
 * /order — Catering customer STOREFRONT (mockup pass).
 *
 * MOCKUP: static, sample content, no auth/logic — a public look-only first pass of the
 * customer ordering experience for design review, per the portal spec
 * (docs/superpowers/specs/2026-07-16-catering-customer-portal-design.md). It becomes
 * Portal-1's real storefront once the visual direction is agreed. English-only + hardcoded
 * content is intentional for the mockup; i18n + real package/menu data land in the build.
 */

import Link from "next/link";

const PACKAGES = [
  { icon: "🥪", name: "The Classic Spread", blurb: "Assorted signature subs, quartered, with chips & cookies.", price: "$14", per: "per person", min: "10+ people", items: ["Choice of 4 signature subs", "Kettle chips", "Fresh-baked cookies"] },
  { icon: "🌮", name: "The Build-Your-Own Bar", blurb: "A make-your-own spread your guests assemble themselves.", price: "$16", per: "per person", min: "15+ people", items: ["Breads, meats & cheeses", "Toppings & spreads", "Sides & pickles"] },
  { icon: "🥐", name: "Breakfast Boxes", blurb: "Individually boxed morning pastries + fruit + coffee.", price: "$12", per: "per person", min: "8+ people", items: ["Pastry of the day", "Seasonal fruit cup", "Coffee & juice"] },
  { icon: "🧀", name: "The Grazing Table", blurb: "A generous cheese, charcuterie & seasonal produce board.", price: "$180", per: "serves ~20", min: "flat platter", items: ["Cured meats & cheeses", "Crackers & crostini", "Seasonal fruit & nuts"] },
];

const ALA_CARTE = [
  { name: "Signature sub tray (10)", price: "$85" },
  { name: "Garden salad bowl", price: "$42" },
  { name: "Cookie & brownie box (24)", price: "$36" },
  { name: "Iced tea / lemonade (gallon)", price: "$14" },
];

const FACTS = [
  { emoji: "🔪", text: "Everything's sliced and built the morning of — never the night before." },
  { emoji: "🌶️", text: "Ask about the house hot-honey. It goes on more than you'd think." },
  { emoji: "🍞", text: "Our bread's baked in-house daily. The ends are the best part (we won't tell)." },
];

const FAQS = [
  { q: "How far ahead should I order?", a: "48 hours is ideal. For large or same-week events, start an order and we'll confirm what we can do." },
  { q: "Do you deliver?", a: "Yes — delivery within our zones, or free pickup at either location. You'll pick at checkout." },
  { q: "Can you handle allergies?", a: "Every item lists its allergens, and we can flag prep separations. Note it on your order and we'll confirm." },
];

export default function OrderStorefrontMockup() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#FFFBEF] via-co-bg to-[#FCF1CC] text-co-text">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-co-border/60 bg-co-bg/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3.5">
          <span className="text-sm font-extrabold uppercase tracking-[0.2em] text-co-text">Compliments Only</span>
          <Link href="#" className="text-sm font-bold text-co-text-muted transition hover:text-co-text">Sign in</Link>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-5 pt-14 pb-10 text-center sm:pt-20">
        <p className="text-xs font-bold uppercase tracking-[0.28em] text-co-text-dim">Catering</p>
        <h1 className="mx-auto mt-3 max-w-2xl text-4xl font-extrabold leading-[1.05] tracking-tight text-co-text sm:text-6xl">
          Catering that makes <span className="bg-co-gold/60 px-1.5 [box-decoration-break:clone]">you</span> look good.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base text-co-text-muted sm:text-lg">
          Fresh subs, spreads, and platters for 10 to 500 — built the morning of, delivered on time. Order online in minutes.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="#packages" className="inline-flex min-h-[54px] w-full items-center justify-center rounded-full bg-co-text px-8 text-base font-bold uppercase tracking-[0.1em] text-co-cta shadow-lg shadow-co-text/20 transition hover:bg-co-text/90 sm:w-auto">
            Start your order
          </Link>
          <Link href="#packages" className="inline-flex min-h-[54px] w-full items-center justify-center rounded-full border-2 border-co-text/20 px-8 text-base font-bold text-co-text transition hover:border-co-text sm:w-auto">
            Browse the menu
          </Link>
        </div>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm font-semibold text-co-text-dim">
          <span>✓ Serves 10–500</span>
          <span>✓ Delivery or pickup</span>
          <span>✓ Allergens on every item</span>
        </div>
      </section>

      {/* Packages */}
      <section id="packages" className="mx-auto max-w-5xl px-5 py-10">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight text-co-text sm:text-3xl">Catering packages</h2>
            <p className="mt-1 text-sm text-co-text-muted">Pick one and customize every item — or build your own below.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {PACKAGES.map((p) => (
            <article key={p.name} className="group flex flex-col rounded-3xl border border-co-border/70 bg-co-surface/80 p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-co-text/5">
              <div className="flex items-start justify-between gap-3">
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-co-gold/40 text-3xl">{p.icon}</span>
                <div className="text-right">
                  <div className="text-xl font-extrabold text-co-text">{p.price}</div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-co-text-dim">{p.per}</div>
                </div>
              </div>
              <h3 className="mt-4 text-lg font-extrabold text-co-text">{p.name}</h3>
              <p className="mt-1 text-sm text-co-text-muted">{p.blurb}</p>
              <ul className="mt-4 flex flex-col gap-1.5 text-sm text-co-text">
                {p.items.map((it) => (
                  <li key={it} className="flex items-center gap-2"><span className="text-co-gold">◆</span>{it}</li>
                ))}
              </ul>
              <div className="mt-5 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-co-text-dim">{p.min}</span>
                <span className="inline-flex items-center gap-1 text-sm font-bold text-co-text transition group-hover:gap-2">Customize <span aria-hidden>→</span></span>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* À la carte */}
      <section className="mx-auto max-w-5xl px-5 py-6">
        <div className="rounded-3xl border border-co-border/70 bg-co-text p-6 text-co-bg sm:p-8">
          <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Or go à la carte</h2>
          <p className="mt-1 text-sm text-co-bg/70">Add exactly what you want, by the tray.</p>
          <ul className="mt-5 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
            {ALA_CARTE.map((a) => (
              <li key={a.name} className="flex items-center justify-between border-b border-co-bg/15 pb-2">
                <span className="text-sm font-semibold">{a.name}</span>
                <span className="text-sm font-extrabold text-co-gold">{a.price}</span>
              </li>
            ))}
          </ul>
          <Link href="#packages" className="mt-6 inline-flex items-center gap-1 text-sm font-bold text-co-gold transition hover:gap-2">See the full à-la-carte menu <span aria-hidden>→</span></Link>
        </div>
      </section>

      {/* Good to know */}
      <section className="mx-auto max-w-5xl px-5 py-10">
        <h2 className="text-center text-sm font-bold uppercase tracking-[0.24em] text-co-text-dim">Good to know</h2>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {FACTS.map((f) => (
            <div key={f.text} className="rounded-2xl bg-co-surface/60 p-5 text-center">
              <div className="text-3xl">{f.emoji}</div>
              <p className="mt-2 text-sm text-co-text-muted">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-5 py-10">
        <h2 className="text-center text-2xl font-extrabold tracking-tight text-co-text sm:text-3xl">Questions?</h2>
        <div className="mt-6 flex flex-col gap-3">
          {FAQS.map((f) => (
            <div key={f.q} className="rounded-2xl border border-co-border/70 bg-co-surface/70 p-5">
              <p className="font-bold text-co-text">{f.q}</p>
              <p className="mt-1.5 text-sm text-co-text-muted">{f.a}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-center text-sm"><Link href="#" className="font-bold text-co-text underline decoration-co-gold decoration-2 underline-offset-4">See all FAQs</Link></p>
      </section>

      {/* Footer CTA */}
      <section className="mx-auto max-w-5xl px-5 pb-20 pt-6">
        <div className="rounded-3xl bg-co-gold/50 p-8 text-center sm:p-12">
          <h2 className="text-3xl font-extrabold tracking-tight text-co-text sm:text-4xl">Ready to eat well?</h2>
          <p className="mx-auto mt-2 max-w-md text-co-text-muted">Build your order in a few minutes. We'll confirm and get you set.</p>
          <Link href="#packages" className="mt-6 inline-flex min-h-[54px] items-center justify-center rounded-full bg-co-text px-10 text-base font-bold uppercase tracking-[0.1em] text-co-cta shadow-lg shadow-co-text/20 transition hover:bg-co-text/90">
            Start your order
          </Link>
        </div>
        <p className="mt-8 text-center text-xs text-co-text-dim">Compliments Only · complimentsonlysubs.com · A mockup — not yet live</p>
      </section>
    </div>
  );
}
