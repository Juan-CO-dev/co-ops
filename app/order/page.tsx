/* eslint-disable @next/next/no-img-element -- mockup uses placeholder/remote <img>; real build swaps to next/image + CO photography */
/**
 * /order — Catering customer STOREFRONT (mockup pass v3).
 *
 * MOCKUP: static, look-only, no auth/logic — public design-review pass (portal spec
 * 2026-07-16). Real content pulled from complimentsonlysubs.com (menu, prices, voice,
 * tagline, logo). HERO + VIBE images are two large images from the CO SpotHopper CDN
 * (unverified — swap if wrong); package-card photos are keyword placeholders (their food
 * gallery is JS-lazy-loaded, not scrapable). Catering PACKAGES are constructed from the
 * real à-la-carte menu (the Toast catering menu is an unscrapable SPA) — replace with the
 * real Toast packages. Color discipline: gold only on dark, red only for CTAs, dark+cream base.
 */

import Link from "next/link";
import { Reveal } from "@/components/portal/Reveal";
import { FaqItem } from "@/components/portal/FaqItem";

// Two large images pulled from the CO site CDN (unverified content — swap if not food).
const HERO_IMG = "https://cdn.spotapps.co/spothopper/image/fetch/f_auto,q_auto:best,c_fit,h_1200/http://static.spotapps.co/spots/83/680ef84fcc45bf97f94e70f4e423cf/:original";
const VIBE_IMG = "https://cdn.spotapps.co/spothopper/image/fetch/f_auto,q_auto:best,c_fit,h_1200/http://static.spotapps.co/spots/92/f4e418d60d423486174f1c68c1ed49/:original";
const FLK = (w: number, h: number, kw: string, lock: number) => `https://loremflickr.com/${w}/${h}/${kw}?lock=${lock}`;

// Catering bundles built from the REAL menu (stand-ins for the real Toast catering packages).
const PACKAGES = [
  { img: FLK(700, 520, "sub,sandwich,platter", 21), name: "The Signature Spread", blurb: "A curated mix of our signature subs — Teamster, Crunchy Boi, Hot Pants & more — quartered for sharing, with UTZ chips and deli pickles.", price: "$17", per: "per person", min: "10+ guests" },
  { img: FLK(700, 520, "sandwich,buffet,deli", 22), name: "Build-Your-Own Bar", blurb: "House-baked Italian rolls, our meats & cheeses, and every topping — your crew builds their own perfect sub.", price: "$15", per: "per person", min: "15+ guests" },
  { img: FLK(700, 520, "meatball,pasta,italian", 23), name: "The Meatball Situation", blurb: "Vesuvio II — beef & pork meatballs in vodka sauce with melted mozz — plus garlic bread and marinara.", price: "$120", per: "serves ~12", min: "party tray" },
  { img: FLK(700, 520, "cookies,dessert,cannoli", 24), name: "The Sweet Finish", blurb: "Whisked! chocolate chip cookies, Fruity Pebbles cannoli, Berger cookies, and Black Forest bread pudding.", price: "$65", per: "serves ~15", min: "dessert tray" },
];

const ALA_CARTE = [
  { name: "The Teamster (tray of 10)", price: "$149" },
  { name: "Crunchy Boi (tray of 10)", price: "$145" },
  { name: "Garlic bread + marinara", price: "$12.50" },
  { name: "Meatballs, by the dozen", price: "$33" },
  { name: "Whisked! cookies (dozen)", price: "$26" },
  { name: "UTZ chips (case)", price: "$36" },
];

export default function OrderStorefrontMockup() {
  return (
    <div className="min-h-screen bg-co-bg text-co-text">
      {/* Top bar */}
      <header className="fixed inset-x-0 top-0 z-30 border-b border-white/10 bg-co-text/75 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <span className="text-sm font-extrabold uppercase tracking-[0.22em] text-co-bg">Compliments Only</span>
          <div className="flex items-center gap-5">
            <Link href="#packages" className="hidden text-sm font-semibold text-co-bg/70 transition hover:text-co-bg sm:block">Catering menu</Link>
            <Link href="#" className="rounded-full border border-co-bg/25 px-4 py-1.5 text-sm font-bold text-co-bg transition hover:bg-co-bg hover:text-co-text">Sign in</Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative flex min-h-[92vh] items-end overflow-hidden">
        <img src={HERO_IMG} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-co-text via-co-text/80 to-co-text/30" />
        <div className="relative mx-auto w-full max-w-6xl px-5 pb-16 pt-28 sm:pb-24">
          <p className="text-xs font-bold uppercase tracking-[0.32em] text-co-gold">Catering · Capitol Hill & Dupont Circle</p>
          <h1 className="mt-4 max-w-3xl text-4xl font-extrabold leading-[1.0] tracking-tight text-co-bg sm:text-6xl">
            Where every bite<br />deserves a compliment.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-co-bg/85">
            Chef-inspired subs and house-made ingredients, built the morning of your event and delivered on time — for 10 to 500.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="#packages" className="inline-flex min-h-[56px] items-center justify-center rounded-full bg-co-bg px-9 text-base font-bold uppercase tracking-[0.08em] text-co-cta shadow-xl shadow-black/25 transition hover:-translate-y-0.5 hover:bg-white">
              Start your order
            </Link>
            <Link href="#packages" className="inline-flex min-h-[56px] items-center justify-center rounded-full border border-co-bg/35 px-9 text-base font-bold text-co-bg backdrop-blur-sm transition hover:border-co-bg">
              See the menu
            </Link>
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <div className="border-b border-co-border/50 bg-co-text text-co-bg">
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
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-co-text-dim">The catering menu</p>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-co-text sm:text-4xl">Pick a spread, make it yours.</h2>
          <p className="mx-auto mt-2 max-w-lg text-co-text-muted">Every item is customizable — swap subs, add sides, or build from scratch below.</p>
        </Reveal>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {PACKAGES.map((p, i) => (
            <Reveal key={p.name} delay={(i % 2) * 80}>
              <article className="group flex h-full flex-col overflow-hidden rounded-3xl border border-co-border/70 bg-co-surface shadow-sm transition hover:-translate-y-1 hover:shadow-2xl hover:shadow-co-text/10">
                <div className="relative aspect-[16/10] overflow-hidden bg-co-text/5">
                  <img src={p.img} alt={p.name} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                  <div className="absolute right-3 top-3 rounded-full bg-co-text/90 px-3 py-1 text-sm font-extrabold text-co-gold backdrop-blur-sm">
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

      {/* Woven insight 1 */}
      <Section>
        <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2">
          <Reveal>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-co-text-dim">Why it tastes better</p>
            <h2 className="mt-2 text-3xl font-extrabold leading-tight tracking-tight text-co-text sm:text-4xl">Chef-inspired, house-made, built the morning of.</h2>
            <p className="mt-3 text-co-text-muted">Never the night before, never sitting in a fridge. Bread baked in-house, ingredients made from scratch, and subs assembled the same day they're served — by the people who actually make them.</p>
          </Reveal>
          <Reveal delay={100} className="flex flex-col gap-3">
            <FaqItem q="How far ahead should I order?" a="48 hours is the sweet spot. For large or same-week events, start an order anyway and we'll confirm what we can pull off — we say yes more than you'd think." />
            <FaqItem q="Can you scale up fast?" a="Comfortably to 500. Bigger or last-minute? Put it in and we'll get back to you quickly with a real answer." />
          </Reveal>
        </div>
      </Section>

      {/* À la carte */}
      <Section>
        <Reveal>
          <div className="grid grid-cols-1 overflow-hidden rounded-3xl bg-co-text text-co-bg lg:grid-cols-5">
            <div className="relative hidden bg-co-text/50 lg:col-span-2 lg:block">
              <img src={FLK(700, 900, "sandwich,tray,catering", 25)} alt="" loading="lazy" className="h-full w-full object-cover" />
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

      {/* Vibe */}
      <section className="relative my-4 flex min-h-[52vh] items-center overflow-hidden bg-co-text">
        <img src={VIBE_IMG} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-90" />
        <div className="absolute inset-0 bg-gradient-to-r from-co-text via-co-text/60 to-co-text/10" />
        <Reveal className="relative mx-auto w-full max-w-6xl px-5">
          <h2 className="max-w-xl text-4xl font-extrabold leading-tight tracking-tight text-co-bg sm:text-5xl">The food people actually talk about after.</h2>
          <p className="mt-3 max-w-md text-co-bg/80">Made face-to-face by the people behind the counter. That's the whole idea — compliments, only.</p>
        </Reveal>
      </section>

      {/* Woven insight 2 */}
      <Section>
        <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2">
          <Reveal delay={100} className="order-2 flex flex-col gap-3 lg:order-1">
            <FaqItem q="Where do you deliver?" a="Across DC within our delivery zones — you'll see your fee at checkout — or grab it free at Capitol Hill or Dupont. We'll confirm the window when we approve your order." />
            <FaqItem q="Can you handle allergies & dietary needs?" a="Every item lists its allergens, and we can flag prep separations. Note it on your order and we'll confirm exactly how we'll handle it before you pay." />
          </Reveal>
          <Reveal className="order-1 lg:order-2">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-co-text-dim">No surprises</p>
            <h2 className="mt-2 text-3xl font-extrabold leading-tight tracking-tight text-co-text sm:text-4xl">Delivered where you need it — safe for everyone at the table.</h2>
            <p className="mt-3 text-co-text-muted">Clear zones, clear fees, allergen info on every single item. You'll always know exactly what you're getting before you pay a cent.</p>
          </Reveal>
        </div>
      </Section>

      {/* Footer CTA */}
      <section className="mx-auto max-w-6xl px-5 pb-20 pt-8">
        <Reveal>
          <div className="relative overflow-hidden rounded-[2rem] bg-co-text p-10 text-center sm:p-16">
            <h2 className="text-4xl font-extrabold tracking-tight text-co-bg sm:text-5xl">Ready for the <span className="text-co-gold">compliments</span>?</h2>
            <p className="mx-auto mt-3 max-w-md text-co-bg/70">Build your order in a few minutes. We'll confirm and get you set.</p>
            <Link href="#packages" className="mt-7 inline-flex min-h-[56px] items-center justify-center rounded-full bg-co-bg px-11 text-base font-bold uppercase tracking-[0.08em] text-co-cta shadow-xl shadow-black/25 transition hover:-translate-y-0.5 hover:bg-white">
              Start your order
            </Link>
          </div>
        </Reveal>
        <p className="mt-8 text-center text-xs text-co-text-dim">Compliments Only · complimentsonlysubs.com · Mockup — hero/vibe pulled from your site (unverified); card photos are placeholders</p>
      </section>
    </div>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return <section className="mx-auto max-w-6xl px-5 py-12 sm:py-16">{children}</section>;
}
