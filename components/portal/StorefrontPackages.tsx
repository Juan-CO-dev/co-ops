"use client";
/* eslint-disable @next/next/no-img-element -- storefront uses remote marketing photos */

/**
 * StorefrontPackages — the marketing package sections for the /order storefront.
 *
 * Renders real CateringPackage rows (from loadPublicCateringPackages) in their own image-rich
 * marketing sections — Sandwich Platters (options beside the platter photo), Individual Lunch Boxes
 * (with a lunch-box photo), and The Really Big Subs (a gold feature block) — plus a catch-all so no
 * package is ever dropped. Each package has an "Add to order" that writes a package reference
 * (packageId, quantity:1) to sessionStorage under the PRESELECT_KEY, then briefly flips to "Added ✓".
 * The persistent "Start your order" CTA is the always-on StorefrontOrderTray pill (one shared pill).
 *
 * Carry writes REFERENCES only — never a price. The build page configures + prices.
 */

import { useState, useCallback } from "react";
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

// ─── small helpers ──────────────────────────────────────────────────────────────

/** Leading integer of a label, e.g. "8 pc platter" → 8 (0 when none). */
function leadingNumber(label: string): number {
  const m = label.match(/\d+/);
  return m ? Number(m[0]) : 0;
}

/** Advisory notice ("48h notice") from lead time, or null. */
function noticeOf(pkg: CateringPackage): string | null {
  return pkg.leadTimeHours != null ? `${pkg.leadTimeHours}h notice` : null;
}

/** An Add button that self-manages its brief "Added ✓" confirmation. */
function AddButton({ id, onAdd, dark, small }: { id: string; onAdd: (id: string) => void; dark?: boolean; small?: boolean }) {
  const [added, setAdded] = useState(false);
  const base = small ? "min-h-[38px] px-4 text-xs" : "min-h-[44px] px-5 text-sm";
  function click() {
    onAdd(id);
    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  }
  if (added) {
    return (
      <span className={`inline-flex ${base} items-center gap-1.5 rounded-full font-bold ${dark ? "bg-co-text text-co-gold" : "bg-co-text text-co-gold"}`}>
        Added ✓
      </span>
    );
  }
  return (
    <button
      onClick={click}
      className={`inline-flex ${base} items-center gap-1 rounded-full font-bold transition hover:gap-2 ${
        dark ? "bg-co-bg text-co-cta hover:bg-white" : "bg-co-text text-co-cta hover:bg-co-text/90"
      }`}
    >
      Add to order <span aria-hidden>→</span>
    </button>
  );
}

// ─── section title ──────────────────────────────────────────────────────────────

function SectionHead({ eyebrow, title, blurb, muted }: { eyebrow: string; title: string; blurb: string; muted?: boolean }) {
  return (
    <>
      <p className={`text-xs font-bold uppercase tracking-[0.28em] ${muted ? "text-co-text/60" : "text-co-text-dim"}`}>{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-co-text sm:text-4xl">{title}</h2>
      <p className={`mt-2 ${muted ? "text-co-text/75" : "text-co-text-muted"}`}>{blurb}</p>
    </>
  );
}

// ─── main export ──────────────────────────────────────────────────────────────

export function StorefrontPackages({
  packages,
  images,
}: {
  packages: CateringPackage[];
  images: { platter: string; lunchBox: string };
}) {
  const handleAdd = useCallback((packageId: string) => {
    const current = readPreselect();
    current.push({ packageId, quantity: 1 });
    writePreselect(current);
  }, []);

  if (packages.length === 0) return null;

  // Bucket into their own marketing sections (by label), sorted small→large by price.
  const byPrice = (a: CateringPackage, b: CateringPackage) => a.priceCents - b.priceCents;
  const platters = packages.filter((p) => /platter/i.test(p.labelEn)).sort(byPrice);
  const bigSubs = packages.filter((p) => /footer/i.test(p.labelEn)).sort(byPrice);
  const lunchBoxes = packages.filter((p) => /lunch/i.test(p.labelEn)).sort(byPrice);
  const grouped = new Set([...platters, ...bigSubs, ...lunchBoxes].map((p) => p.id));
  const other = packages.filter((p) => !grouped.has(p.id)).sort(byPrice);

  return (
    <>
      {/* ── Sandwich Platters — photo + addable size options beside it ──────── */}
      {platters.length > 0 && (
        <section id="platters" className="mx-auto max-w-6xl scroll-mt-16 px-5 py-16">
          <div className="grid grid-cols-1 items-stretch gap-8 lg:grid-cols-2">
            <div className="min-h-[320px] overflow-hidden rounded-3xl bg-co-text/5">
              <img src={images.platter} alt="Sandwich platter" className="h-full w-full object-cover" />
            </div>
            <div className="flex flex-col justify-center">
              <SectionHead
                eyebrow="Sandwich platters"
                title="The crowd-pleaser."
                blurb="Assorted 5-inch sandwiches — a mix of the Classics (Teamsters, Crunchy Bois & more). Pick a size; you'll choose the subs on the next step."
              />
              <div className="mt-6 grid grid-cols-2 gap-3">
                {platters.map((p) => {
                  const pieces = leadingNumber(p.labelEn);
                  return (
                    <div key={p.id} className="flex flex-col rounded-2xl border border-co-border/70 bg-co-surface p-4 transition hover:border-co-text/30 hover:shadow-md">
                      <div className="text-lg font-extrabold text-co-text">{pieces || ""} pc</div>
                      {pieces > 0 && <div className="text-xs text-co-text-dim">serves ~{Math.round(pieces / 2)}–{pieces}</div>}
                      <div className="mt-1 text-lg font-extrabold text-co-cta">{money(p.priceCents)}</div>
                      <div className="mt-3">
                        <AddButton id={p.id} onAdd={handleAdd} small />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── Individual Lunch Boxes — addable boxes + photo ──────────────────── */}
      {lunchBoxes.length > 0 && (
        <section id="lunch-boxes" className="border-y border-co-border/50 bg-co-surface/40 scroll-mt-16">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <div className="grid grid-cols-1 items-stretch gap-8 lg:grid-cols-2">
              <div className="order-2 flex flex-col justify-center lg:order-1">
                <SectionHead
                  eyebrow="Individual lunch boxes"
                  title="Grab-and-go, sorted."
                  blurb="One packed box per person — a sub with chips & a drink. Choose the box; you'll pick each sub on the next step."
                />
                <div className="mt-6 flex flex-col gap-3">
                  {lunchBoxes.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-4 rounded-2xl border border-co-border/70 bg-co-bg p-4">
                      <div className="min-w-0">
                        <p className="text-base font-extrabold text-co-text">{p.labelEn}</p>
                        <p className="text-sm font-bold text-co-cta">{money(p.priceCents)}<span className="ml-1 text-xs font-semibold text-co-text-dim">/ person</span></p>
                      </div>
                      <AddButton id={p.id} onAdd={handleAdd} small />
                    </div>
                  ))}
                </div>
              </div>
              <div className="order-1 min-h-[300px] overflow-hidden rounded-3xl bg-co-text/5 lg:order-2">
                <img src={images.lunchBox} alt="Individual lunch box" className="h-full w-full object-cover" />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── The Really Big Subs — a gold feature block ──────────────────────── */}
      {bigSubs.length > 0 && (
        <section id="big-subs" className="mx-auto max-w-6xl scroll-mt-16 px-5 py-16">
          <div className="overflow-hidden rounded-[2rem] bg-co-gold">
            <div className="grid grid-cols-1 gap-8 p-8 sm:p-12 lg:grid-cols-2 lg:items-center">
              <div>
                <SectionHead
                  eyebrow="Go big"
                  title="The really big subs."
                  blurb="Three or six feet of sub roll from Cardinal Bakery — your choice of the Classics, built the morning of and sliced to share."
                  muted
                />
              </div>
              <div className="flex flex-col gap-4">
                {bigSubs.map((p) => {
                  const notice = noticeOf(p);
                  return (
                    <div key={p.id} className="flex items-center justify-between gap-4 rounded-2xl bg-co-text p-5 text-co-bg">
                      <div className="min-w-0">
                        <p className="text-lg font-extrabold">{p.labelEn}</p>
                        <div className="mt-0.5 flex items-center gap-2">
                          <span className="text-base font-extrabold text-co-gold">{money(p.priceCents)}</span>
                          {notice && <span className="rounded-full bg-co-bg/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-co-bg/80">{notice}</span>}
                        </div>
                      </div>
                      <AddButton id={p.id} onAdd={handleAdd} dark small />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── Catch-all (any package not bucketed above) ──────────────────────── */}
      {other.length > 0 && (
        <section id="more-packages" className="mx-auto max-w-6xl scroll-mt-16 px-5 py-16">
          <SectionHead eyebrow="More" title="More catering packages." blurb="Carry one into your order and configure the details on the next step." />
          <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {other.map((p) => (
              <div key={p.id} className="flex h-full flex-col rounded-2xl border border-co-border/70 bg-co-surface p-6">
                <h3 className="text-xl font-extrabold text-co-text">{p.labelEn}</h3>
                <div className="mt-1 text-2xl font-extrabold text-co-cta">{money(p.priceCents)}</div>
                <div className="mt-auto pt-4"><AddButton id={p.id} onAdd={handleAdd} /></div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
