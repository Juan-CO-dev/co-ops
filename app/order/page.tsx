/* eslint-disable @next/next/no-img-element -- mockup uses remote <img>; real build swaps to next/image */
/**
 * /order — Catering customer STOREFRONT (mockup pass v8).
 *
 * MOCKUP: static, look-only, no auth/logic — public design-review pass (portal spec
 * 2026-07-16). Now uses the REAL Toast catering menu (Sandwich Platters, subs, lunch boxes,
 * big subs, sides/sweets/drinks — names, descriptions, prices) + REAL per-item photos from
 * the CO Toast S3 + the CO site gallery. Colors confirmed from the CO stylesheet
 * (#FFF9E4/#141414/#FFE560); gold on dark, red for CTAs.
 */

import Link from "next/link";
import { Reveal } from "@/components/portal/Reveal";
import { FaqItem } from "@/components/portal/FaqItem";

const T = (id: string) => `https://s3.amazonaws.com/toasttab/restaurants/restaurant-221473000000000000/menu/images/item-${id}.jpg`;
const G = (id: string) => `https://static.spotapps.co/spots/${id}/full`; // CO site gallery
const IMG = {
  hero: G("b3/4e5acb6be54926844053bc6b44355d"), // various subs
  interior: G("bd/571a5564f24cc7a60fac380d4439ad"),
  exterior: G("8f/a86fd66e2e4958a54b661d02a63194"),
  counter: G("0b/09a06b39a24bc58d5a35e99ea48cc0"),
  vesuvio: G("d3/a96ed4e6d84d189e5f239fa7fc42e4"), // meatball
  spread: "https://s3.amazonaws.com/toasttab/restaurants/restaurant-221473000000000000/menu/items/9/item-100000052580370539_1744237345.jpg",
  lightLunch: "https://s3.amazonaws.com/toasttab/restaurants/restaurant-221473000000000000/menu/items/0/item-100000052583329150_1744237425.jpg",
};

const PLATTER_SIZES = [
  { size: "8 pc", serves: "serves 4–6", price: "$60" },
  { size: "16 pc", serves: "serves 8–16", price: "$115" },
  { size: "32 pc", serves: "serves 16–32", price: "$210" },
  { size: "48 pc", serves: "serves 24–48", price: "$330" },
];

const SUBS = [
  { name: "The Teamster", desc: "Ham, capicola, genoa, provolone, hot & sweet peppers, onions, shredduce, oil & vin.", price: "$16.29", img: T("abd7ad07-cc58-4349-8c2f-1f88a43caa38") },
  { name: "Crunchy Boi", desc: "Turkey, provolone, potato chips, garlic mayo, pickles, onions, shredduce, oil & vin.", price: "$15.79", img: T("3846fa6d-2632-4fe4-8fab-a25c2f9b0b0a") },
  { name: "Hot Pants", desc: "Pepperoni, capicola, genoa, provolone, cholula mayo, hot & sweet peppers.", price: "$15.79", img: T("dbf2cd1a-9b17-491c-853a-907a960bc311") },
  { name: "Marisa Tomei Eats Free", desc: "Capicola, genoa, fresh mozz, basil & arugula salad, honey chili aioli.", price: "$15.29", img: T("c780adb3-69c8-4b01-b640-7f3c269df298") },
  { name: "The Frex", desc: "Ham, capicola, pepperoni, genoa, prosciutto, fresh mozz, hot peppers, onion, arugula.", price: "$18.39", img: T("af933f0c-c537-46fa-a2ae-dd8b0fda3cca") },
  { name: "Vesuvio II", desc: "Beef & pork meatballs, vodka sauce, pepperoncini, melted mozzarella, oregano.", price: "$19.99", img: IMG.vesuvio },
  { name: "Sicky Wicky Club", desc: "Turkey, ham, bacon, Duke's mayo, provolone, tomato, onion, shredduce.", price: "$15.00", img: T("a1d9a1d8-54e5-437c-9fc1-38999bd02dc7") },
  { name: "Never Been Cheddar", desc: "Roast beef, cheddar, arugula, radish & mustard aioli.", price: "$15.29", img: T("ce210b97-390b-44f0-89c5-0a59ae667db5") },
  { name: "Farmers Market After Dark", desc: "Cucumber, marinated tomatoes, hot & sweet peppers, onion, arugula, salsa verde.", price: "$12.65", img: T("e75b63c1-de98-40bd-855b-9bce1b2abe4c") },
];

const BIG_SUBS = [
  { name: "The Three Footer", desc: "3 feet of sub roll from Cardinal Bakery, your choice of the Classics.", note: "48 hours notice", price: "$135" },
  { name: "The Six Footer", desc: "Six freakin' feet of sub. Your choice of the Classics.", note: "72 hours notice", price: "$260" },
];

const SIDES = [
  { name: "House Greek Salad", price: "$12" },
  { name: "Caesar Salad", price: "$12" },
  { name: "Large Pasta Salad (32oz)", price: "$16" },
  { name: "Large Tuna Salad (32oz)", price: "$18" },
  { name: "Large Egg Salad (32oz)", price: "$16" },
  { name: "Large French Onion Dip (32oz)", price: "$20" },
  { name: "Quart of Pickle Spears (12)", price: "$9" },
  { name: "Case of Assorted Chips (24)", price: "$52" },
];
const SWEETS = [
  { name: "Whisked! Chocolate Chip Cookie", price: "$2.25" },
  { name: "Berger Cookies — 2 pk", price: "$4" },
  { name: "Berger Cookies — Large (15oz)", price: "$9.99" },
  { name: "Fruity Pebble Cannoli", price: "$2" },
];
const DRINKS = [
  { name: "Dozen Waters", price: "$12" },
  { name: "24 Mixed Sodas", price: "$48" },
  { name: "Topo Chico / Topo Lime", price: "$3" },
  { name: "Natalie's Lemonade", price: "$3.41" },
];

const STEPS = [
  { n: "01", t: "Pick your spread", d: "Choose a platter or lunch boxes, or build à la carte from the full menu." },
  { n: "02", t: "Make it yours", d: "Swap subs, set quantities, add sides & sweets — customize every item." },
  { n: "03", t: "We confirm", d: "Our team reviews your date & headcount, then sends a secure deposit link to lock it in." },
  { n: "04", t: "Eat well", d: "Built the morning of, delivered on time. You collect the compliments." },
];
const REVIEWS = [
  { name: "Elizabeth R.", text: "Hands down my favorite sub shop. The staff is always super friendly, and the sandwiches never miss. The Crunchy Boi is my go-to — it's just perfect." },
  { name: "Michael M.", text: "Huge, delicious, creative sandwiches. Reasonable prices. Great atmosphere. Went for the first time and I've been back 4 times since." },
  { name: "Pooja V.", text: "Lovely sandwich shop, subs are huge so worth the price! Food was fresh and staff were inviting. Highly recommend!" },
];
const LOCATIONS = [
  { name: "Capitol Hill", img: IMG.exterior, addr: "526 8th St SE, Ste A · Washington, DC 20003", hours: "10:30am–6pm daily · til 10pm Fri & Sat", phone: "(202) 621-8645" },
  { name: "Dupont Circle", img: IMG.counter, addr: "2029 P St NW, Front 1 · Washington, DC 20036", hours: "10:30am–8pm · seven days a week", phone: "(202) 794-4638" },
];

function CtaButton({ label, dark }: { label: string; dark?: boolean }) {
  return (
    <Link href="/order/start" className={`inline-flex min-h-[56px] items-center justify-center rounded-full px-9 text-base font-bold uppercase tracking-[0.08em] shadow-xl shadow-black/20 transition hover:-translate-y-0.5 ${dark ? "bg-co-text text-co-cta hover:bg-co-text/90" : "bg-co-bg text-co-cta hover:bg-white"}`}>{label}</Link>
  );
}
function PriceList({ title, items }: { title: string; items: { name: string; price: string }[] }) {
  return (
    <div>
      <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-co-gold">{title}</h3>
      <ul className="flex flex-col gap-2">
        {items.map((i) => (
          <li key={i.name} className="flex items-baseline justify-between gap-3 border-b border-co-bg/15 pb-1.5 text-sm">
            <span className="text-co-bg/90">{i.name}</span>
            <span className="shrink-0 font-bold text-co-gold">{i.price}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function OrderStorefrontMockup() {
  return (
    <div className="min-h-screen bg-co-bg text-co-text">
      <header className="fixed inset-x-0 top-0 z-30 border-b border-white/10 bg-co-text/75 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <span className="text-sm font-extrabold uppercase tracking-[0.22em] text-co-bg">Compliments Only</span>
          <div className="flex items-center gap-5">
            <Link href="#subs" className="hidden text-sm font-semibold text-co-bg/70 transition hover:text-co-bg sm:block">Menu</Link>
            <Link href="#" className="rounded-full border border-co-bg/25 px-4 py-1.5 text-sm font-bold text-co-bg transition hover:bg-co-bg hover:text-co-text">Sign in</Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative flex min-h-[92vh] items-end overflow-hidden bg-co-text">
        <img src={IMG.hero} alt="" className="absolute inset-0 h-full w-full object-cover opacity-95" />
        <div className="absolute inset-0 bg-gradient-to-t from-co-text via-co-text/80 to-co-text/30" />
        <div className="relative mx-auto w-full max-w-6xl px-5 pb-16 pt-28 sm:pb-24">
          <p className="text-xs font-bold uppercase tracking-[0.32em] text-co-gold">Catering · Capitol Hill & Dupont Circle</p>
          <h1 className="mt-4 max-w-3xl text-4xl font-extrabold leading-[1.0] tracking-tight text-co-bg sm:text-6xl">Where every bite<br />deserves a compliment.</h1>
          <p className="mt-5 max-w-xl text-lg text-co-bg/85">Chef-inspired subs and house-made ingredients, built the morning of your event and delivered on time — for 10 to 500.</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <CtaButton label="Start your order" />
            <Link href="#subs" className="inline-flex min-h-[56px] items-center justify-center rounded-full border border-co-bg/35 px-9 text-base font-bold text-co-bg backdrop-blur-sm transition hover:border-co-bg">See the menu</Link>
          </div>
        </div>
      </section>

      <div className="border-b border-co-border/50 bg-co-text text-co-bg">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-10 gap-y-2 px-5 py-4 text-sm font-semibold">
          <span>Serves 4–500</span><span className="text-co-gold">•</span>
          <span>Delivery or free pickup</span><span className="text-co-gold">•</span>
          <span>Built the morning of</span><span className="text-co-gold">•</span>
          <span>Allergens on every item</span>
        </div>
      </div>

      {/* Sandwich Platters */}
      <section id="platters" className="mx-auto max-w-6xl scroll-mt-16 px-5 py-16">
        <Reveal>
          <div className="grid grid-cols-1 items-stretch gap-8 lg:grid-cols-2">
            <div className="overflow-hidden rounded-3xl bg-co-text/5">
              <img src={IMG.spread} alt="Sandwich platter" className="h-full w-full object-cover" />
            </div>
            <div className="flex flex-col justify-center">
              <p className="text-xs font-bold uppercase tracking-[0.28em] text-co-text-dim">Sandwich platters</p>
              <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-co-text sm:text-4xl">The crowd-pleaser.</h2>
              <p className="mt-2 text-co-text-muted">Assorted 5-inch sandwiches — a mix of the Classics (Teamsters, Crunchy Bois & more). Pick your size and we'll build the spread.</p>
              <div className="mt-5 grid grid-cols-2 gap-3">
                {PLATTER_SIZES.map((p) => (
                  <div key={p.size} className="rounded-2xl border border-co-border/70 bg-co-surface p-4">
                    <div className="text-lg font-extrabold text-co-text">{p.size}</div>
                    <div className="text-xs text-co-text-dim">{p.serves}</div>
                    <div className="mt-1 text-base font-extrabold text-co-cta">{p.price}</div>
                  </div>
                ))}
              </div>
              <div className="mt-6"><CtaButton label="Start your order" dark /></div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* The subs — photo grid */}
      <section id="subs" className="bg-co-text py-16 text-co-bg">
        <div className="mx-auto max-w-6xl px-5">
          <Reveal className="mb-9">
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-co-gold">À la carte · 10&quot; subs</p>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">The ones people ask for by name.</h2>
          </Reveal>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {SUBS.map((s, i) => (
              <Reveal key={s.name} delay={(i % 3) * 70}>
                <article className="group flex h-full flex-col overflow-hidden rounded-3xl bg-co-bg text-co-text shadow-lg shadow-black/20">
                  <div className="relative aspect-[4/3] overflow-hidden bg-co-text/10">
                    <img src={s.img} alt={s.name} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
                    <div className="absolute right-3 top-3 rounded-full bg-co-text/90 px-3 py-1 text-sm font-extrabold text-co-gold backdrop-blur-sm">{s.price}</div>
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <h3 className="text-lg font-extrabold">{s.name}</h3>
                    <p className="mt-1 flex-1 text-sm text-co-text-muted">{s.desc}</p>
                    <span className="mt-3 inline-flex items-center gap-1 self-start rounded-full bg-co-text px-4 py-2 text-sm font-bold text-co-cta transition group-hover:gap-2">Add to order <span aria-hidden>→</span></span>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Lunch boxes + big subs */}
      <Section>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Reveal>
            <div className="flex h-full overflow-hidden rounded-3xl border border-co-border/70 bg-co-surface">
              <div className="relative hidden w-2/5 bg-co-text/5 sm:block"><img src={IMG.lightLunch} alt="Lunch box" className="absolute inset-0 h-full w-full object-cover" /></div>
              <div className="flex-1 p-6">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-co-text-dim">Individual lunch boxes</p>
                <h3 className="mt-1 text-2xl font-extrabold text-co-text">Grab-and-go, sorted.</h3>
                <div className="mt-4 flex flex-col gap-3">
                  <div className="flex items-baseline justify-between border-b border-co-border pb-2"><span className="text-sm font-semibold text-co-text">Light Lunch <span className="font-normal text-co-text-dim">· 5&quot; sub, chips, water</span></span><span className="font-extrabold text-co-cta">$12</span></div>
                  <div className="flex items-baseline justify-between"><span className="text-sm font-semibold text-co-text">Full Lunch <span className="font-normal text-co-text-dim">· 10&quot; sub, chips, water</span></span><span className="font-extrabold text-co-cta">$19.99</span></div>
                </div>
              </div>
            </div>
          </Reveal>
          <Reveal delay={80}>
            <div className="flex h-full flex-col rounded-3xl bg-co-gold p-7">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-co-text/60">Go big</p>
              <h3 className="mt-1 text-2xl font-extrabold text-co-text">The really big subs.</h3>
              <div className="mt-4 flex flex-1 flex-col gap-4">
                {BIG_SUBS.map((b) => (
                  <div key={b.name} className="border-b border-co-text/15 pb-3 last:border-0">
                    <div className="flex items-baseline justify-between gap-3"><span className="font-extrabold text-co-text">{b.name}</span><span className="font-extrabold text-co-text">{b.price}</span></div>
                    <p className="mt-0.5 text-sm text-co-text/70">{b.desc}</p>
                    <span className="mt-1 inline-block rounded-full bg-co-text px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-co-gold">{b.note}</span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* Insight 1 */}
      <Section>
        <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2">
          <Reveal>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-co-text-dim">Taste the difference</p>
            <h2 className="mt-2 text-3xl font-extrabold leading-tight tracking-tight text-co-text sm:text-4xl">A classic kind of place — chef-inspired, house-made.</h2>
            <p className="mt-3 text-co-text-muted">We make chef-inspired subs using house-made ingredients, with face-to-face interaction from the people making your food. Built the morning of, never the night before.</p>
          </Reveal>
          <Reveal delay={100} className="flex flex-col gap-3">
            <FaqItem q="How far ahead should I order?" a="48 hours is the sweet spot. The 3- and 6-foot subs need 48 and 72 hours. For large or same-week events, start an order and we'll confirm what we can pull off." />
            <FaqItem q="Can you scale up fast?" a="Comfortably to 500 — our platters go up to 48 pieces, and there's always the six-footer. Put it in and we'll get back to you quickly." />
          </Reveal>
        </div>
      </Section>

      {/* Sides / Sweets / Drinks */}
      <section className="bg-co-text py-16 text-co-bg">
        <div className="mx-auto max-w-6xl px-5">
          <Reveal className="mb-9"><h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Round it out.</h2></Reveal>
          <div className="grid grid-cols-1 gap-10 md:grid-cols-3">
            <Reveal><PriceList title="Sides" items={SIDES} /></Reveal>
            <Reveal delay={80}><PriceList title="Sweets" items={SWEETS} /></Reveal>
            <Reveal delay={160}><PriceList title="Drinks" items={DRINKS} /></Reveal>
          </div>
        </div>
      </section>

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
        <img src={IMG.interior} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-90" />
        <div className="absolute inset-0 bg-gradient-to-r from-co-text via-co-text/60 to-co-text/10" />
        <Reveal className="relative mx-auto w-full max-w-6xl px-5">
          <h2 className="max-w-xl text-4xl font-extrabold leading-tight tracking-tight text-co-bg sm:text-5xl">The food people actually talk about after.</h2>
          <p className="mt-3 max-w-md text-co-bg/80">Made face-to-face by the people behind the counter. That's the whole idea — compliments, only.</p>
        </Reveal>
      </section>

      {/* Reviews */}
      <Section>
        <Reveal className="mb-8 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-co-text-dim">What DC says</p>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-co-text sm:text-4xl">Five stars, and hungry regulars.</h2>
        </Reveal>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {REVIEWS.map((r, i) => (
            <Reveal key={r.name} delay={i * 80}>
              <figure className="flex h-full flex-col rounded-2xl border border-co-border/70 bg-co-surface p-6 shadow-sm">
                <div className="text-lg tracking-wide text-[#E0A800]" aria-label="5 out of 5 stars">★★★★★</div>
                <blockquote className="mt-3 flex-1 text-sm leading-relaxed text-co-text">&ldquo;{r.text}&rdquo;</blockquote>
                <figcaption className="mt-4 text-xs font-bold uppercase tracking-wide text-co-text-dim">{r.name} · Google</figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </Section>

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

      {/* Insight 2 */}
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
        <p className="mt-8 text-center text-xs text-co-text-dim">Compliments Only · complimentsonlysubs.com · Mockup</p>
      </section>
    </div>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return <section className="mx-auto max-w-6xl px-5 py-12 sm:py-16">{children}</section>;
}
