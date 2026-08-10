/* eslint-disable @next/next/no-img-element -- storefront uses remote images for hero/gallery */
/**
 * /order — Catering customer STOREFRONT (data-driven pass).
 *
 * Server Component: loads the real seeded catering menu via loadPublicCateringMenu
 * and passes orderable groups to the StorefrontOrderTray client island.
 * All static marketing sections (hero, trust bar, "How it works", reviews,
 * locations, FAQ panels, footer CTA) are preserved verbatim from the mockup.
 */

// Reads the DB (loadPublicCateringMenu → service-role client) at render time.
// Force dynamic so the menu is always fetched fresh, never baked into static HTML.
export const dynamic = "force-dynamic";

import Link from "next/link";
import { Reveal } from "@/components/portal/Reveal";
import { FaqItem } from "@/components/portal/FaqItem";
import { StorefrontOrderTray } from "@/components/portal/StorefrontOrderTray";
import { StorefrontPackages } from "@/components/portal/StorefrontPackages";
import { loadPublicCateringMenu, loadPublicCateringPackages } from "@/lib/portal/menu";
import type { CateringMenuItem } from "@/lib/catering/menu";
import type { CateringPackage } from "@/lib/catering/menu";

// ─── location id ─────────────────────────────────────────────────────────────
// Prices are identical at both shops; the storefront reads ONE canonical
// location (T0: env owns identity — default is CO's Capitol Hill, so the live
// deploy needs no env change; a future tenant sets the var at project creation).
const STOREFRONT_LOCATION_ID =
  process.env.NEXT_PUBLIC_STOREFRONT_LOCATION_ID ?? "54ce1029-400e-4a92-9c2b-0ccb3b031f0a";

// ─── static image references (hero + gallery) ─────────────────────────────────
const G = (id: string) => `https://static.spotapps.co/spots/${id}/full`;
const IMG = {
  hero:     G("b3/4e5acb6be54926844053bc6b44355d"),
  interior: G("bd/571a5564f24cc7a60fac380d4439ad"),
  exterior: G("8f/a86fd66e2e4958a54b661d02a63194"),
  counter:  G("0b/09a06b39a24bc58d5a35e99ea48cc0"),
  spread:   "https://s3.amazonaws.com/toasttab/restaurants/restaurant-221473000000000000/menu/items/9/item-100000052580370539_1744237345.jpg",
  lightLunch: "https://s3.amazonaws.com/toasttab/restaurants/restaurant-221473000000000000/menu/items/0/item-100000052583329150_1744237425.jpg",
};

// ─── static marketing data (preserved verbatim from mockup) ──────────────────
const STEPS = [
  { n: "01", t: "Pick your spread",   d: "Choose a platter or lunch boxes, or build à la carte from the full menu." },
  { n: "02", t: "Make it yours",      d: "Swap subs, set quantities, add sides & sweets — customize every item." },
  { n: "03", t: "We confirm",         d: "Our team reviews your date & headcount, then sends a secure deposit link to lock it in." },
  { n: "04", t: "Eat well",           d: "Built the morning of, delivered on time. You collect the compliments." },
];

const REVIEWS = [
  { name: "Elizabeth R.", text: "Hands down my favorite sub shop. The staff is always super friendly, and the sandwiches never miss. The Crunchy Boi is my go-to — it's just perfect." },
  { name: "Michael M.",  text: "Huge, delicious, creative sandwiches. Reasonable prices. Great atmosphere. Went for the first time and I've been back 4 times since." },
  { name: "Pooja V.",    text: "Lovely sandwich shop, subs are huge so worth the price! Food was fresh and staff were inviting. Highly recommend!" },
];

const LOCATIONS = [
  { name: "Capitol Hill",  img: IMG.exterior, addr: "526 8th St SE, Ste A · Washington, DC 20003",     hours: "10:30am–6pm daily · til 10pm Fri & Sat", phone: "(202) 621-8645" },
  { name: "Dupont Circle", img: IMG.counter,  addr: "2029 P St NW, Front 1 · Washington, DC 20036",    hours: "10:30am–8pm · seven days a week",         phone: "(202) 794-4638" },
];

// ─── group derivation ─────────────────────────────────────────────────────────
const EXCLUDE_SECTION = /gear/i;
const EXCLUDE_NAME    = /add.?on|napkin/i;

function deriveGroups(menu: CateringMenuItem[]) {
  const orderable = menu.filter(
    (m) =>
      !(m.section && EXCLUDE_SECTION.test(m.section)) &&
      !EXCLUDE_NAME.test(m.name),
  );

  // Subs = the sandwich menu_items only (sections "Subs" / "Build Your Own"). Resale menu_items
  // (chips/drinks/sweets) are ALSO kind "menu_item" — they must fall through to their own groups,
  // never the subs photo grid.
  const subs   = orderable.filter(
    (m) => m.kind === "menu_item" && !!m.section && /^(subs|build your own)$/i.test(m.section),
  );
  const subIds = new Set(subs.map((m) => m.id));
  const sidesRaw = orderable.filter(
    (m) => !subIds.has(m.id) && (m.kind === "item" || (m.section && /(side|chip|salad)/i.test(m.section))),
  );
  // Deduplicate (an item might satisfy both kind==="item" and a side section name)
  const sideIds = new Set(sidesRaw.map((m) => m.id));
  const sides  = sidesRaw.filter(
    (m, idx, arr) => arr.findIndex((x) => x.id === m.id) === idx,
  );
  const sweets = orderable.filter(
    (m) => m.section && /(sweet|cookie|cannoli)/i.test(m.section) && !sideIds.has(m.id),
  );
  const sweetIds = new Set(sweets.map((m) => m.id));
  const drinks = orderable.filter(
    (m) =>
      m.section &&
      /(drink|soda|water|beverage)/i.test(m.section) &&
      !sideIds.has(m.id) &&
      !sweetIds.has(m.id),
  );

  const groups: { label: string; items: CateringMenuItem[] }[] = [
    { label: "Subs",   items: subs   },
    { label: "Sides",  items: sides  },
    { label: "Sweets", items: sweets },
    { label: "Drinks", items: drinks },
  ];

  return groups.filter((g) => g.items.length > 0);
}

// ─── helpers ──────────────────────────────────────────────────────────────────
function CtaButton({ label, dark }: { label: string; dark?: boolean }) {
  return (
    <Link
      href="/order/start"
      className={`inline-flex min-h-[56px] items-center justify-center rounded-full px-9 text-base font-bold uppercase tracking-[0.08em] shadow-xl shadow-black/20 transition hover:-translate-y-0.5 ${
        dark
          ? "bg-co-text text-co-cta hover:bg-co-text/90"
          : "bg-co-bg text-co-cta hover:bg-white"
      }`}
    >
      {label}
    </Link>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return <section className="mx-auto max-w-6xl px-5 py-12 sm:py-16">{children}</section>;
}

// ─── page ─────────────────────────────────────────────────────────────────────
export default async function OrderStorefront() {
  // Load the real catering menu; gracefully degrade to empty array on error
  // (page is public marketing — never hard-crash for a DB hiccup).
  let menu: CateringMenuItem[] = [];
  try {
    menu = await loadPublicCateringMenu(STOREFRONT_LOCATION_ID);
  } catch (err) {
    console.error("[/order] loadPublicCateringMenu failed:", err);
  }

  // Load real catering packages; gracefully degrade to empty array on error.
  let packages: CateringPackage[] = [];
  try {
    packages = await loadPublicCateringPackages(STOREFRONT_LOCATION_ID);
  } catch (err) {
    console.error("[/order] loadPublicCateringPackages failed:", err);
  }

  const groups = deriveGroups(menu);

  return (
    <div className="min-h-screen bg-co-bg text-co-text">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="fixed inset-x-0 top-0 z-30 border-b border-white/10 bg-co-text/75 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <span className="text-sm font-extrabold uppercase tracking-[0.22em] text-co-bg">
            Compliments Only
          </span>
          <div className="flex items-center gap-5">
            <Link
              href="#subs"
              className="hidden text-sm font-semibold text-co-bg/70 transition hover:text-co-bg sm:block"
            >
              Menu
            </Link>
            <Link
              href="/order/start?mode=signin"
              className="rounded-full border border-co-bg/25 px-4 py-1.5 text-sm font-bold text-co-bg transition hover:bg-co-bg hover:text-co-text"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="relative flex min-h-[92vh] items-end overflow-hidden bg-co-text">
        <img src={IMG.hero} alt="" className="absolute inset-0 h-full w-full object-cover opacity-95" />
        <div className="absolute inset-0 bg-gradient-to-t from-co-text via-co-text/80 to-co-text/30" />
        <div className="relative mx-auto w-full max-w-6xl px-5 pb-16 pt-28 sm:pb-24">
          <p className="text-xs font-bold uppercase tracking-[0.32em] text-co-gold">
            Catering · Capitol Hill &amp; Dupont Circle
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl font-extrabold leading-[1.0] tracking-tight text-co-bg sm:text-6xl">
            Where every bite
            <br />
            deserves a compliment.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-co-bg/85">
            Chef-inspired subs and house-made ingredients, built the morning of your event and
            delivered on time — for 10 to 500.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <CtaButton label="Start your order" />
            <Link
              href="#subs"
              className="inline-flex min-h-[56px] items-center justify-center rounded-full border border-co-bg/35 px-9 text-base font-bold text-co-bg backdrop-blur-sm transition hover:border-co-bg"
            >
              See the menu
            </Link>
          </div>
        </div>
      </section>

      {/* ── Trust bar ──────────────────────────────────────────────────── */}
      <div className="border-b border-co-border/50 bg-co-text text-co-bg">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-10 gap-y-2 px-5 py-4 text-sm font-semibold">
          <span>Serves 4–500</span>
          <span className="text-co-gold">•</span>
          <span>Delivery or free pickup</span>
          <span className="text-co-gold">•</span>
          <span>Built the morning of</span>
          <span className="text-co-gold">•</span>
          <span>Allergens on every item</span>
        </div>
      </div>

      {/* ── Catering packages — platters / lunch boxes / big subs (data-driven) ── */}
      <StorefrontPackages packages={packages} images={{ platter: IMG.spread, lunchBox: IMG.lightLunch }} />

      {/* ── Orderable tray (subs + sides/sweets/drinks) ────────────────── */}
      <StorefrontOrderTray groups={groups} />


      {/* ── Insight 1 ──────────────────────────────────────────────────── */}
      <Section>
        <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2">
          <Reveal>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-co-text-dim">
              Taste the difference
            </p>
            <h2 className="mt-2 text-3xl font-extrabold leading-tight tracking-tight text-co-text sm:text-4xl">
              A classic kind of place — chef-inspired, house-made.
            </h2>
            <p className="mt-3 text-co-text-muted">
              We make chef-inspired subs using house-made ingredients, with face-to-face
              interaction from the people making your food. Built the morning of, never the night
              before.
            </p>
          </Reveal>
          <Reveal delay={100} className="flex flex-col gap-3">
            <FaqItem
              q="How far ahead should I order?"
              a="48 hours is the sweet spot. The 3- and 6-foot subs need 48 and 72 hours. For large or same-week events, start an order and we'll confirm what we can pull off."
            />
            <FaqItem
              q="Can you scale up fast?"
              a="Comfortably to 500 — our platters go up to 48 pieces, and there's always the six-footer. Put it in and we'll get back to you quickly."
            />
          </Reveal>
        </div>
      </Section>

      {/* ── How it works ───────────────────────────────────────────────── */}
      <section className="border-y border-co-border/50 bg-co-surface/50 py-16">
        <div className="mx-auto max-w-6xl px-5">
          <Reveal className="mb-9 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-co-text-dim">
              How it works
            </p>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-co-text sm:text-4xl">
              From cart to compliments in four steps.
            </h2>
          </Reveal>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 70}>
                <div className="flex h-full flex-col rounded-2xl border border-co-border/60 bg-co-bg p-6">
                  <span className="text-4xl font-extrabold tabular-nums text-co-text/15">
                    {s.n}
                  </span>
                  <h3 className="mt-2 text-lg font-extrabold text-co-text">{s.t}</h3>
                  <p className="mt-1 text-sm text-co-text-muted">{s.d}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal className="mt-9 text-center">
            <CtaButton label="Start your order" dark />
          </Reveal>
        </div>
      </section>

      {/* ── Vibe ───────────────────────────────────────────────────────── */}
      <section className="relative my-4 flex min-h-[52vh] items-center overflow-hidden bg-co-text">
        <img
          src={IMG.interior}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover opacity-90"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-co-text via-co-text/60 to-co-text/10" />
        <Reveal className="relative mx-auto w-full max-w-6xl px-5">
          <h2 className="max-w-xl text-4xl font-extrabold leading-tight tracking-tight text-co-bg sm:text-5xl">
            The food people actually talk about after.
          </h2>
          <p className="mt-3 max-w-md text-co-bg/80">
            Made face-to-face by the people behind the counter. That&apos;s the whole idea —
            compliments, only.
          </p>
        </Reveal>
      </section>

      {/* ── Reviews ────────────────────────────────────────────────────── */}
      <Section>
        <Reveal className="mb-8 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-co-text-dim">
            What DC says
          </p>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-co-text sm:text-4xl">
            Five stars, and hungry regulars.
          </h2>
        </Reveal>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {REVIEWS.map((r, i) => (
            <Reveal key={r.name} delay={i * 80}>
              <figure className="flex h-full flex-col rounded-2xl border border-co-border/70 bg-co-surface p-6 shadow-sm">
                <div className="text-lg tracking-wide text-[#E0A800]" aria-label="5 out of 5 stars">
                  ★★★★★
                </div>
                <blockquote className="mt-3 flex-1 text-sm leading-relaxed text-co-text">
                  &ldquo;{r.text}&rdquo;
                </blockquote>
                <figcaption className="mt-4 text-xs font-bold uppercase tracking-wide text-co-text-dim">
                  {r.name} · Google
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ── Locations ──────────────────────────────────────────────────── */}
      <Section>
        <Reveal className="mb-8 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-co-text-dim">
            Two DC shops
          </p>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-co-text sm:text-4xl">
            Made right here in the District.
          </h2>
        </Reveal>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {LOCATIONS.map((l, i) => (
            <Reveal key={l.name} delay={i * 90}>
              <article className="overflow-hidden rounded-3xl border border-co-border/70 bg-co-surface shadow-sm">
                <div className="relative aspect-[16/9] overflow-hidden bg-co-text/5">
                  <img
                    src={l.img}
                    alt={l.name}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute bottom-3 left-4 rounded-full bg-co-text/85 px-3 py-1 text-sm font-extrabold text-co-bg backdrop-blur-sm">
                    {l.name}
                  </span>
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

      {/* ── Insight 2 ──────────────────────────────────────────────────── */}
      <Section>
        <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2">
          <Reveal delay={100} className="order-2 flex flex-col gap-3 lg:order-1">
            <FaqItem
              q="Where do you deliver?"
              a="Across DC within our delivery zones — you'll see your fee at checkout — or grab it free at Capitol Hill or Dupont. We'll confirm the window when we approve your order."
            />
            <FaqItem
              q="Can you handle allergies & dietary needs?"
              a="Every item lists its allergens, and we can flag prep separations. Note it on your order and we'll confirm exactly how we'll handle it before you pay."
            />
          </Reveal>
          <Reveal className="order-1 lg:order-2">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-co-text-dim">
              No surprises
            </p>
            <h2 className="mt-2 text-3xl font-extrabold leading-tight tracking-tight text-co-text sm:text-4xl">
              Delivered where you need it — safe for everyone at the table.
            </h2>
            <p className="mt-3 text-co-text-muted">
              Clear zones, clear fees, allergen info on every single item. You&apos;ll always know
              exactly what you&apos;re getting before you pay a cent.
            </p>
          </Reveal>
        </div>
      </Section>

      {/* ── Footer CTA ─────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 pb-20 pt-4">
        <Reveal>
          <div className="relative overflow-hidden rounded-[2rem] bg-co-text p-10 text-center sm:p-16">
            <h2 className="text-4xl font-extrabold tracking-tight text-co-bg sm:text-5xl">
              Ready for the <span className="text-co-gold">compliments</span>?
            </h2>
            <p className="mx-auto mt-3 max-w-md text-co-bg/70">
              Build your order in a few minutes. We&apos;ll confirm and get you set.
            </p>
            <div className="mt-7">
              <CtaButton label="Start your order" />
            </div>
          </div>
        </Reveal>
        <p className="mt-8 text-center text-xs text-co-text-dim">
          Compliments Only · complimentsonlysubs.com
        </p>
      </section>
    </div>
  );
}
