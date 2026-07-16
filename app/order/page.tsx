/**
 * /order — Catering customer STOREFRONT (mockup pass v2).
 *
 * MOCKUP: static, sample content, no auth/logic — a public look-only pass for design review
 * (portal spec 2026-07-16). Food images are auto-pulled placeholders (loremflickr) to be
 * replaced with CO's own photography in the real build. English-only + hardcoded is
 * intentional for the mockup; i18n + real package/menu data land in Portal-1.
 *
 * Direction (Juan): spectacular + unmistakably CO, real food imagery, content that surfaces
 * naturally on scroll (info + an attached FAQ), lowkey-interactive, ordering stays the goal.
 */

/* eslint-disable @next/next/no-img-element -- mockup uses placeholder <img>; real build swaps in CO photography via next/image */
import Link from "next/link";
import { Reveal } from "@/components/portal/Reveal";
import { FaqItem } from "@/components/portal/FaqItem";

const IMG = (w: number, h: number, kw: string, lock: number) => `https://loremflickr.com/${w}/${h}/${kw}?lock=${lock}`;

const PACKAGES = [
  { img: IMG(700, 520, "sub,sandwich,platter", 21), name: "The Classic Spread", blurb: "Assorted signature subs, quartered, with chips & fresh-baked cookies.", price: "$14", per: "per person", min: "10+ guests" },
  { img: IMG(700, 520, "sandwich,buffet,deli", 22), name: "The Build-Your-Own Bar", blurb: "Breads, meats, cheeses & toppings — your guests build their perfect sub.", price: "$16", per: "per person", min: "15+ guests" },
  { img: IMG(700, 520, "breakfast,pastry,coffee", 23), name: "Breakfast Boxes", blurb: "Individually boxed pastries, seasonal fruit, and coffee for the a.m. crowd.", price: "$12", per: "per person", min: "8+ guests" },
  { img: IMG(700, 520, "charcuterie,cheese,board", 24), name: "The Grazing Table", blurb: "A generous cheese, charcuterie & seasonal produce board that wows.", price: "$180", per: "serves ~20", min: "flat platter" },
];

const ALA_CARTE = [
  { name: "Signature sub tray (10)", price: "$85" },
  { name: "Garden salad bowl", price: "$42" },
  { name: "Cookie & brownie box (24)", price: "$36" },
  { name: "Iced tea / lemonade (gal.)", price: "$14" },
];

export default function OrderStorefrontMockup() {
  return (
    <div className="min-h-screen bg-co-bg text-co-text">
      {/* Top bar */}
      <header className="fixed inset-x-0 top-0 z-30 border-b border-white/10 bg-co-text/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <span className="text-sm font-extrabold uppercase tracking-[0.22em] text-co-bg">Compliments Only</span>
          <div className="flex items-center gap-5">
            <Link href="#packages" className="hidden text-sm font-semibold text-co-bg/70 transition hover:text-co-bg sm:block">Menu</Link>
            <Link href="#" className="rounded-full bg-co-gold px-4 py-1.5 text-sm font-bold text-co-text transition hover:bg-co-gold/90">Sign in</Link>
          </div>
        </div>
      </header>

      {/* Hero — full-bleed food photo + brand wash */}
      <section className="relative flex min-h-[92vh] items-end overflow-hidden">
        <img src={IMG(1600, 1200, "sub,sandwich,deli,fresh", 7)} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-co-text via-co-text/75 to-co-text/25" />
        <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-co-gold/20" />
        <div className="relative mx-auto w-full max-w-6xl px-5 pb-16 pt-28 sm:pb-24">
          <p className="text-xs font-bold uppercase tracking-[0.32em] text-co-gold">Catering · Compliments Only</p>
          <h1 className="mt-4 max-w-3xl text-5xl font-extrabold leading-[0.98] tracking-tight text-co-bg sm:text-7xl">
            Subs worth<br />gathering for.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-co-bg/80">
            Fresh-built spreads, boxes, and platters for 10 to 500 — made the morning of, delivered on time, and genuinely good.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="#packages" className="inline-flex min-h-[56px] items-center justify-center rounded-full bg-co-gold px-9 text-base font-bold uppercase tracking-[0.08em] text-co-text shadow-xl shadow-black/20 transition hover:-translate-y-0.5 hover:bg-co-gold/90">
              Start your order
            </Link>
            <Link href="#packages" className="inline-flex min-h-[56px] items-center justify-center rounded-full border border-co-bg/30 bg-co-text/20 px-9 text-base font-bold text-co-bg backdrop-blur-sm transition hover:border-co-bg/70">
              See the menu
            </Link>
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <div className="border-b border-co-border/60 bg-co-text text-co-bg">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-10 gap-y-2 px-5 py-4 text-sm font-semibold">
          <span>Serves 10–500</span><span className="text-co-gold">•</span>
          <span>Delivery or free pickup</span><span className="text-co-gold">•</span>
          <span>Built the morning of</span><span className="text-co-gold">•</span>
          <span>Allergens on every item</span>
        </div>
      </div>

      {/* Packages */}
      <section id="packages" className="mx-auto max-w-6xl scroll-mt-16 px-5 py-16">
        <Reveal className="mb-9 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-co-text-dim">The menu</p>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-co-text sm:text-4xl">Pick a package, make it yours.</h2>
          <p className="mx-auto mt-2 max-w-lg text-co-text-muted">Every item is customizable — swap, add, or build from scratch below.</p>
        </Reveal>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {PACKAGES.map((p, i) => (
            <Reveal key={p.name} delay={(i % 2) * 80}>
              <article className="group flex h-full flex-col overflow-hidden rounded-3xl border border-co-border/70 bg-co-surface shadow-sm transition hover:-translate-y-1 hover:shadow-2xl hover:shadow-co-text/10">
                <div className="relative aspect-[16/10] overflow-hidden">
                  <img src={p.img} alt={p.name} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                  <div className="absolute right-3 top-3 rounded-full bg-co-text/85 px-3 py-1 text-sm font-extrabold text-co-gold backdrop-blur-sm">
                    {p.price}<span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-co-bg/70">{p.per}</span>
                  </div>
                </div>
                <div className="flex flex-1 flex-col p-6">
                  <h3 className="text-xl font-extrabold text-co-text">{p.name}</h3>
                  <p className="mt-1.5 flex-1 text-sm text-co-text-muted">{p.blurb}</p>
                  <div className="mt-5 flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wide text-co-text-dim">{p.min}</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-co-text px-4 py-2 text-sm font-bold text-co-cta transition group-hover:gap-2">Customize <span aria-hidden>→</span></span>
                  </div>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Woven insight 1 — info + attached FAQ, surfacing on scroll */}
      <Section>
        <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2">
          <Reveal>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-co-gold">Why it tastes better</p>
            <h2 className="mt-2 text-3xl font-extrabold leading-tight tracking-tight text-co-text sm:text-4xl">Everything's built the morning of your event.</h2>
            <p className="mt-3 text-co-text-muted">Never the night before, never sitting in a fridge. Bread baked in-house, sliced to order, assembled the same day it's served.</p>
          </Reveal>
          <Reveal delay={100} className="flex flex-col gap-3">
            <FaqItem q="How far ahead should I order?" a="48 hours is the sweet spot. For large or same-week events, start an order anyway and we'll confirm what we can pull off — we say yes more than you'd think." />
            <FaqItem q="Can you scale up fast?" a="Comfortably to 500. Bigger or last-minute? Put it in and we'll call you within the hour with a real answer." />
          </Reveal>
        </div>
      </Section>

      {/* À la carte — dark panel + accent photo */}
      <Section>
        <Reveal>
          <div className="grid grid-cols-1 overflow-hidden rounded-3xl bg-co-text text-co-bg lg:grid-cols-5">
            <div className="relative hidden lg:col-span-2 lg:block">
              <img src={IMG(700, 900, "sandwich,tray,catering", 25)} alt="" className="h-full w-full object-cover" />
            </div>
            <div className="p-8 lg:col-span-3 lg:p-10">
              <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Or go à la carte.</h2>
              <p className="mt-1 text-co-bg/70">Add exactly what you want, by the tray.</p>
              <ul className="mt-6 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
                {ALA_CARTE.map((a) => (
                  <li key={a.name} className="flex items-center justify-between border-b border-co-bg/15 pb-2">
                    <span className="text-sm font-semibold">{a.name}</span>
                    <span className="text-sm font-extrabold text-co-gold">{a.price}</span>
                  </li>
                ))}
              </ul>
              <Link href="#" className="mt-7 inline-flex items-center gap-1 text-sm font-bold text-co-gold transition hover:gap-2">Browse the full à-la-carte menu <span aria-hidden>→</span></Link>
            </div>
          </div>
        </Reveal>
      </Section>

      {/* Vibe — social/food photo with overlaid line */}
      <section className="relative my-4 flex min-h-[52vh] items-center overflow-hidden">
        <img src={IMG(1500, 1000, "friends,eating,lunch,party", 31)} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-co-text/85 via-co-text/50 to-transparent" />
        <Reveal className="relative mx-auto w-full max-w-6xl px-5">
          <h2 className="max-w-xl text-4xl font-extrabold leading-tight tracking-tight text-co-bg sm:text-5xl">The food people actually talk about after.</h2>
          <p className="mt-3 max-w-md text-co-bg/80">That's the whole idea. Compliments, only.</p>
        </Reveal>
      </section>

      {/* Woven insight 2 — delivery + allergens, info + FAQ */}
      <Section>
        <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2">
          <Reveal delay={100} className="order-2 flex flex-col gap-3 lg:order-1">
            <FaqItem q="Where do you deliver?" a="Across the city within our delivery zones — you'll see your fee at checkout — or grab it free at either shop. We'll confirm the window when we approve your order." />
            <FaqItem q="Can you handle allergies & dietary needs?" a="Every item lists its allergens, and we can flag prep separations. Note it on your order and we'll confirm exactly how we'll handle it before you pay." />
          </Reveal>
          <Reveal className="order-1 lg:order-2">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-co-gold">No surprises</p>
            <h2 className="mt-2 text-3xl font-extrabold leading-tight tracking-tight text-co-text sm:text-4xl">Delivered where you need it — and safe for everyone at the table.</h2>
            <p className="mt-3 text-co-text-muted">Clear zones, clear fees, allergen info on every single item. You'll always know what you're getting before you pay a cent.</p>
          </Reveal>
        </div>
      </Section>

      {/* Footer CTA */}
      <section className="mx-auto max-w-6xl px-5 pb-20 pt-8">
        <Reveal>
          <div className="relative overflow-hidden rounded-[2rem] bg-co-gold p-10 text-center sm:p-16">
            <h2 className="text-4xl font-extrabold tracking-tight text-co-text sm:text-5xl">Ready to eat well?</h2>
            <p className="mx-auto mt-3 max-w-md text-co-text/70">Build your order in a few minutes. We'll confirm and get you set.</p>
            <Link href="#packages" className="mt-7 inline-flex min-h-[56px] items-center justify-center rounded-full bg-co-text px-11 text-base font-bold uppercase tracking-[0.08em] text-co-cta shadow-xl shadow-black/15 transition hover:-translate-y-0.5 hover:bg-co-text/90">
              Start your order
            </Link>
          </div>
        </Reveal>
        <p className="mt-8 text-center text-xs text-co-text-dim">Compliments Only · complimentsonlysubs.com · Mockup — food photos are placeholders</p>
      </section>
    </div>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return <section className="mx-auto max-w-6xl px-5 py-12 sm:py-16">{children}</section>;
}
