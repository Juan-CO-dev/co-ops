/* eslint-disable @next/next/no-img-element -- mockup uses placeholder/remote <img>; real build swaps to next/image + CO photography */
/**
 * /order — Catering customer STOREFRONT (mockup pass v4, expanded).
 *
 * MOCKUP: static, look-only, no auth/logic — public design-review pass (portal spec
 * 2026-07-16). Real content from complimentsonlysubs.com: menu, prices, voice, tagline,
 * real subs, real locations (addresses/hours/phones). HERO + VIBE + location images are the
 * two large images pulled from the CO CDN (unverified — swap if wrong). Package + featured
 * photos are keyword placeholders (the site's food gallery is JS-lazy-loaded, not scrapable —
 * CO photos get dropped in for the real build). Catering PACKAGES are built from the real
 * à-la-carte menu (Toast catering menu is an unscrapable SPA — replace with the real ones).
 * Color discipline: gold only on dark, red only for CTAs, dark+cream base.
 */

import Link from "next/link";
import { Reveal } from "@/components/portal/Reveal";
import { FaqItem } from "@/components/portal/FaqItem";

// Two large images from the CO site CDN (unverified content — swap if not right).
const CO_IMG_A = "https://cdn.spotapps.co/spothopper/image/fetch/f_auto,q_auto:best,c_fit,h_1200/http://static.spotapps.co/spots/83/680ef84fcc45bf97f94e70f4e423cf/:original";
const CO_IMG_B = "https://cdn.spotapps.co/spothopper/image/fetch/f_auto,q_auto:best,c_fit,h_1200/http://static.spotapps.co/spots/92/f4e418d60d423486174f1c68c1ed49/:original";
const FLK = (w: number, h: number, kw: string, lock: number) => `https://loremflickr.com/${w}/${h}/${kw}?lock=${lock}`;

const PACKAGES = [
  { img: FLK(700, 520, "sub,sandwich,platter", 21), name: "The Signature Spread", blurb: "A curated mix of our signature subs — Teamster, Crunchy Boi, Hot Pants & more — quartered for sharing, with UTZ chips and deli pickles.", price: "$17", per: "per person", min: "10+ guests" },
  { img: FLK(700, 520, "sandwich,buffet,deli", 22), name: "Build-Your-Own Bar", blurb: "House-baked Italian rolls, our meats & cheeses, and every topping — your crew builds their own perfect sub.", price: "$15", per: "per person", min: "15+ guests" },
  { img: FLK(700, 520, "meatball,pasta,italian", 23), name: "The Meatball Situation", blurb: "Vesuvio II — beef & pork meatballs in vodka sauce with melted mozz — plus garlic bread and marinara.", price: "$120", per: "serves ~12", min: "party tray" },
  { img: FLK(700, 520, "cookies,dessert,cannoli", 24), name: "The Sweet Finish", blurb: "Whisked! chocolate chip cookies, Fruity Pebbles cannoli, Berger cookies, and Black Forest bread pudding.", price: "$65", per: "serves ~15", min: "dessert tray" },
];

const FEATURED = [
  { name: "Crunchy Boi", desc: "Turkey, provolone, potato chips, garlic mayo, pickles, onions, shredduce, oil & vin.", price: "$15.79" },
  { name: "Vesuvio II", desc: "Beef & pork meatballs, vodka sauce, pepperoncini, melted mozzarella, oregano.", price: "$19.99" },
  { name: "Marisa Tomei Eats Free", desc: "Capicola, genoa, fresh mozzarella, basil & arugula salad, honey chili aioli.", price: "$15.29" },
  { name: "Hot Pants", desc: "Pepperoni, capicola, genoa, provolone, cholula mayo, hot & sweet peppers.", price: "$15.79" },
  { name: "Our French Dip", desc: "Roast beef, caramelized onion, provolone, Horsey mayo, black pepper, dipping jus.", price: "$18.99" },
  { name: "Never Been Cheddar", desc: "Roast beef, cheddar cheese, arugula, radish & mustard aioli.", price: "$15.29" },
];

const STEPS = [
  { n: "01", t: "Pick your spread", d: "Choose a catering package, or build à la carte from the full menu." },
  { n: "02", t: "Make it yours", d: "Swap subs, set quantities, add sides & sweets — customize every item." },
  { n: "03", t: "We confirm", d: "Our team reviews your date & headcount, then sends a secure deposit link to lock it in." },
  { n: "04", t: "Eat well", d: "Built the morning of, delivered on time. You collect the compliments." },
];

const LOCATIONS = [
  { name: "Capitol Hill", img: CO_IMG_A, addr: "526 8th St SE, Ste A · Washington, DC 20003", hours: "10:30am–6pm daily · til 10pm Fri & Sat", phone: "(202) 621-8645" },
  { name: "Dupont Circle", img: CO_IMG_B, addr: "2029 P St NW, Front 1 · Washington, DC 20036", hours: "10:30am–6pm · seven days a week", phone: "(202) 794-4638" },
];

function CtaButton({ label, dark }: { label: string; dark?: boolean }) {
  return (
    <Link
      href="#packages"
      className={`inline-flex min-h-[56px] items-center justify-center rounded-full px-9 text-base font-bold uppercase tracking-[0.08em] shadow-xl shadow-black/20 transition hover:-translate-y-0.5 ${dark ? "bg-co-text text-co-cta hover:bg-co-text/90" : "bg-co-bg text-co-cta hover:bg-white"}`}
    >
      {label}
    </Link>
  );
}

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
      <section className="relative flex min-h-[92vh] items-end overflow-hidden bg-co-text">
        <img src={CO_IMG_A} alt="" className="absolute inset-0 h-full w-full object-cover opacity-95" />
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
            <CtaButton label="Start your order" />
            <Link href="#packages" className="inline-flex min-h-[56px] items-center justify-center rounded-full border border-co-bg/35 px-9 text-base font-bold text-co-bg backdrop-blur-sm transition hover:border-co-bg">See the menu</Link>
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

      {/* Featured subs — the menu personality (real subs, dark canvas so gold pops) */}
      <section className="bg-co-text py-16 text-co-bg">
        <div className="mx-auto max-w-6xl px-5">
          <Reveal className="mb-8">
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-co-gold">The subs themselves</p>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">The ones people ask for by name.</h2>
          </Reveal>
          <div className="grid grid-cols-1 gap-x-10 gap-y-6 md:grid-cols-2">
            {FEATURED.map((s, i) => (
              <Reveal key={s.name} delay={(i % 2) * 60}>
                <div className="flex items-baseline justify-between gap-4 border-b border-co-bg/15 pb-4">
                  <div className="min-w-0">
                    <h3 className="text-lg font-extrabold text-co-bg">{s.name}</h3>
                    <p className="mt-0.5 text-sm text-co-bg/60">{s.desc}</p>
                  </div>
                  <span className="shrink-0 text-base font-extrabold text-co-gold">{s.price}</span>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal className="mt-8 text-center"><CtaButton label="Start your order" /></Reveal>
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
                {[
                  { name: "The Teamster (tray of 10)", price: "$149" },
                  { name: "Crunchy Boi (tray of 10)", price: "$145" },
                  { name: "Garlic bread + marinara", price: "$12.50" },
                  { name: "Meatballs, by the dozen", price: "$33" },
                  { name: "Whisked! cookies (dozen)", price: "$26" },
                  { name: "UTZ chips (case)", price: "$36" },
                ].map((a) => (
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

      {/* How it works */}
      <section className="border-y border-co-border/50 bg-co-surface/50 py-16">
        <div className="mx-auto max-w-6xl px-5">
          <Reveal className="mb-9 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-co-text-dim">How it works</p>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-co-text sm:text-4xl">From cart to compliments in four steps.</h2>
          </Reveal>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 70}>
                <div className="flex h-full flex-col rounded-2xl border border-co-border/60 bg-co-bg p-6">
                  <span className="text-4xl font-extrabold tabular-nums text-co-text/15">{s.n}</span>
                  <h3 className="mt-2 text-lg font-extrabold text-co-text">{s.t}</h3>
                  <p className="mt-1 text-sm text-co-text-muted">{s.d}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal className="mt-9 text-center"><CtaButton label="Start your order" dark /></Reveal>
        </div>
      </section>

      {/* Vibe */}
      <section className="relative my-4 flex min-h-[52vh] items-center overflow-hidden bg-co-text">
        <img src={CO_IMG_B} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-90" />
        <div className="absolute inset-0 bg-gradient-to-r from-co-text via-co-text/60 to-co-text/10" />
        <Reveal className="relative mx-auto w-full max-w-6xl px-5">
          <h2 className="max-w-xl text-4xl font-extrabold leading-tight tracking-tight text-co-bg sm:text-5xl">The food people actually talk about after.</h2>
          <p className="mt-3 max-w-md text-co-bg/80">Made face-to-face by the people behind the counter. That's the whole idea — compliments, only.</p>
        </Reveal>
      </section>

      {/* Locations */}
      <Section>
        <Reveal className="mb-8 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-co-text-dim">Two DC shops</p>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-co-text sm:text-4xl">Made right here in the District.</h2>
        </Reveal>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {LOCATIONS.map((l, i) => (
            <Reveal key={l.name} delay={i * 90}>
              <article className="overflow-hidden rounded-3xl border border-co-border/70 bg-co-surface shadow-sm">
                <div className="relative aspect-[16/9] overflow-hidden bg-co-text/5">
                  <img src={l.img} alt={l.name} loading="lazy" className="h-full w-full object-cover" />
                  <span className="absolute bottom-3 left-4 rounded-full bg-co-text/85 px-3 py-1 text-sm font-extrabold text-co-bg backdrop-blur-sm">{l.name}</span>
                </div>
                <div className="p-6">
                  <p className="text-sm font-semibold text-co-text">{l.addr}</p>
                  <p className="mt-1 text-sm text-co-text-muted">{l.hours}</p>
                  <p className="mt-1 text-sm font-bold text-co-text">{l.phone}</p>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </Section>

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
      <section className="mx-auto max-w-6xl px-5 pb-20 pt-4">
        <Reveal>
          <div className="relative overflow-hidden rounded-[2rem] bg-co-text p-10 text-center sm:p-16">
            <h2 className="text-4xl font-extrabold tracking-tight text-co-bg sm:text-5xl">Ready for the <span className="text-co-gold">compliments</span>?</h2>
            <p className="mx-auto mt-3 max-w-md text-co-bg/70">Build your order in a few minutes. We'll confirm and get you set.</p>
            <div className="mt-7"><CtaButton label="Start your order" /></div>
          </div>
        </Reveal>
        <p className="mt-8 text-center text-xs text-co-text-dim">Compliments Only · complimentsonlysubs.com · Mockup — hero/vibe/location images pulled from your site (unverified); card photos are placeholders</p>
      </section>
    </div>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return <section className="mx-auto max-w-6xl px-5 py-12 sm:py-16">{children}</section>;
}
