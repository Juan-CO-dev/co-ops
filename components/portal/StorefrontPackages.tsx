"use client";

/**
 * StorefrontPackages — data-driven catering package cards for the /order storefront.
 *
 * Receives real CateringPackage rows (from loadPublicCateringPackages) and renders them in their
 * own marketing sections — Sandwich Platters, Individual Lunch Boxes, The Really Big Subs (+ a
 * catch-all) — echoing the pre-B static marketing layout. Each card has an "Add to order" button
 * that writes a package reference (packageId, quantity:1) to sessionStorage under the PRESELECT_KEY,
 * then shows a brief per-card "Added ✓" confirmation. A shared floating pill (mirroring
 * StorefrontOrderTray) reflects the total package count and links to /order/start.
 *
 * Carry writes REFERENCES only — never a price. The build page configures + prices.
 */

import { useState, useCallback } from "react";
import Link from "next/link";
import type { CateringPackage } from "@/lib/catering/menu";

/** sessionStorage key — same key consumed by /order/start. */
const PRESELECT_KEY = "co_order_preselect";

const money = (c: number) =>
  (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

// ─── read / write preselect ────────────────────────────────────────────────────

type PreselectEntry = Record<string, unknown>;

function readPreselect(): PreselectEntry[] {
  try {
    const raw = window.sessionStorage.getItem(PRESELECT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as PreselectEntry[]) : [];
  } catch {
    return [];
  }
}

function writePreselect(entries: PreselectEntry[]): void {
  try {
    window.sessionStorage.setItem(PRESELECT_KEY, JSON.stringify(entries));
  } catch {
    // sessionStorage may be unavailable (private mode, storage full) — proceed anyway
  }
}

// ─── advisory line builder ─────────────────────────────────────────────────────

function buildAdvisory(pkg: CateringPackage): string | null {
  const parts: string[] = [];
  if (pkg.minHeadcount != null) parts.push(`min ${pkg.minHeadcount} guests`);
  if (pkg.leadTimeHours != null) parts.push(`${pkg.leadTimeHours}h notice`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

// ─── package card ─────────────────────────────────────────────────────────────

function PackageCard({
  pkg,
  onAdd,
}: {
  pkg: CateringPackage;
  onAdd: (id: string) => void;
}) {
  const [added, setAdded] = useState(false);
  const advisory = buildAdvisory(pkg);

  function handleAdd() {
    onAdd(pkg.id);
    setAdded(true);
    // Reset per-card "Added ✓" state after 2 s so the button is available again
    setTimeout(() => setAdded(false), 2000);
  }

  return (
    <article className="flex h-full flex-col rounded-2xl border border-co-border/70 bg-co-surface p-6 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-co-text-dim">
        {pkg.pricingMode === "per_head" ? "Per person" : pkg.pricingMode === "per_platter" ? "Per platter" : "Package"}
      </p>
      <h3 className="mt-1 text-xl font-extrabold leading-snug text-co-text">
        {pkg.labelEn}
      </h3>
      <div className="mt-2 text-2xl font-extrabold text-co-cta">
        {money(pkg.priceCents)}
        {pkg.pricingMode === "per_head" && (
          <span className="ml-1 text-sm font-semibold text-co-text-dim">/ person</span>
        )}
        {pkg.pricingMode === "per_platter" && (
          <span className="ml-1 text-sm font-semibold text-co-text-dim">/ platter</span>
        )}
      </div>
      {advisory && (
        <p className="mt-1.5 text-xs font-semibold text-co-text-muted">{advisory}</p>
      )}
      <div className="mt-auto pt-4">
        {added ? (
          <span className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-co-text px-5 py-2 text-sm font-bold text-co-gold">
            Added ✓
          </span>
        ) : (
          <button
            onClick={handleAdd}
            className="inline-flex min-h-[44px] items-center gap-1 rounded-full bg-co-text px-5 py-2 text-sm font-bold text-co-cta transition hover:bg-co-text/90 hover:gap-2"
          >
            Add to order <span aria-hidden>→</span>
          </button>
        )}
      </div>
    </article>
  );
}

// ─── a titled package section ───────────────────────────────────────────────────

function PkgSection({
  id, eyebrow, title, blurb, packages, onAdd, gold,
}: {
  id: string; eyebrow: string; title: string; blurb: string;
  packages: CateringPackage[]; onAdd: (id: string) => void; gold?: boolean;
}) {
  if (packages.length === 0) return null;
  return (
    <section id={id} className={`scroll-mt-16 ${gold ? "bg-co-gold/10" : ""}`}>
      <div className="mx-auto max-w-6xl px-5 py-14">
        <div className="mb-8">
          <p className={`text-xs font-bold uppercase tracking-[0.28em] ${gold ? "text-co-text/60" : "text-co-text-dim"}`}>{eyebrow}</p>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-co-text sm:text-4xl">{title}</h2>
          <p className="mt-2 text-co-text-muted">{blurb}</p>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {packages.map((pkg) => (
            <PackageCard key={pkg.id} pkg={pkg} onAdd={onAdd} />
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── main export ──────────────────────────────────────────────────────────────

export function StorefrontPackages({ packages }: { packages: CateringPackage[] }) {
  // Track how many package slots are in the preselect (pill count).
  // We only increment/reset on user actions; we don't read sessionStorage during render.
  const [pkgCount, setPkgCount] = useState(0);

  const handleAdd = useCallback((packageId: string) => {
    const current = readPreselect();
    current.push({ packageId, quantity: 1 });
    writePreselect(current);
    // Compute new total from what we just wrote (count all packageId entries)
    const newCount = current.filter((e) => "packageId" in e).length;
    setPkgCount(newCount);
  }, []);

  // If no packages, render nothing (graceful dormant state)
  if (packages.length === 0) return null;

  // Bucket into their own marketing sections (by label), sorted small→large by price.
  const byPrice = (a: CateringPackage, b: CateringPackage) => a.priceCents - b.priceCents;
  const platters = packages.filter((p) => /platter/i.test(p.labelEn)).sort(byPrice);
  const bigSubs = packages.filter((p) => /footer/i.test(p.labelEn)).sort(byPrice);
  const lunchBoxes = packages.filter((p) => /lunch/i.test(p.labelEn)).sort(byPrice);
  const grouped = new Set([...platters, ...bigSubs, ...lunchBoxes].map((p) => p.id));
  const other = packages.filter((p) => !grouped.has(p.id)).sort(byPrice); // catch-all so nothing is lost

  return (
    <>
      <PkgSection id="platters" eyebrow="Sandwich platters" title="The crowd-pleaser."
        blurb="Assorted 5-inch sandwiches — pick your size and build the spread on the next step."
        packages={platters} onAdd={handleAdd} />
      <PkgSection id="lunch-boxes" eyebrow="Individual lunch boxes" title="Grab-and-go, sorted."
        blurb="A sub, chips & a drink per person — choose the box, pick the subs on the next step."
        packages={lunchBoxes} onAdd={handleAdd} />
      <PkgSection id="big-subs" eyebrow="Go big" title="The really big subs."
        blurb="Three or six feet of sub roll from Cardinal Bakery — your choice of the Classics."
        packages={bigSubs} onAdd={handleAdd} gold />
      <PkgSection id="more-packages" eyebrow="More" title="More catering packages."
        blurb="Carry one into your order and configure the details on the next step."
        packages={other} onAdd={handleAdd} />

      {/* ── Floating pill (only when packages have been added) ───────────── */}
      {pkgCount > 0 && (
        <div
          className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 pb-[env(safe-area-inset-bottom)]"
          aria-live="polite"
        >
          <Link
            href="/order/start"
            className="flex min-h-[52px] items-center gap-2 rounded-full bg-co-text px-6 py-3 text-sm font-bold text-co-cta shadow-2xl shadow-black/40 transition hover:-translate-y-0.5 hover:shadow-black/50 active:scale-95"
          >
            <span className="rounded-full bg-co-cta px-2 py-0.5 text-xs font-extrabold text-co-bg">
              {pkgCount} package{pkgCount === 1 ? "" : "s"}
            </span>
            Start your order →
          </Link>
        </div>
      )}
    </>
  );
}
