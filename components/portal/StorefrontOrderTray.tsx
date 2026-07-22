"use client";
/* eslint-disable @next/next/no-img-element -- storefront uses remote Toast S3 images for subs */

/**
 * StorefrontOrderTray — the orderable section of the /order storefront.
 *
 * Renders real catering menu groups (subs with photos, sides/sweets/drinks as compact rows).
 * Local qty state; floating pill carries selection to /order/start via sessionStorage.
 * No prices in the pill, no coverage, no portion/size selector — item + qty only. A sized item
 * carries its DEFAULT (smallest) size id in the preselect; the customer changes it on /order/build.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CateringMenuItem } from "@/lib/catering/menu";
import { subImage } from "./storefront-images";

/** sessionStorage key read by /order/start to pre-populate intent. */
const PRESELECT_KEY = "co_order_preselect";

type Pick = { kind: "menu_item" | "item"; id: string; name: string; qty: number; sizeId?: string };
type Picks = Record<string, Pick>;

const money = (c: number) =>
  (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** A sized item (kind:"item" with catering size tiers). Its top-level unitPriceCents is the "from" price. */
const isSized = (m: CateringMenuItem) => m.sizes != null && m.sizes.length > 0;

// ─── stepper ──────────────────────────────────────────────────────────────────

function Stepper({
  qty,
  onAdd,
  onRemove,
}: {
  qty: number;
  onAdd: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="mt-3 flex items-center gap-2 self-start">
      <button
        onClick={onRemove}
        aria-label="Remove one"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-co-border bg-co-bg text-lg font-bold text-co-text transition hover:bg-co-surface-2"
      >
        −
      </button>
      <span className="min-w-[1.5rem] text-center text-sm font-bold tabular-nums text-co-text">
        {qty}
      </span>
      <button
        onClick={onAdd}
        aria-label="Add one more"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-co-text text-lg font-bold text-co-cta transition hover:bg-co-text/90"
      >
        +
      </button>
    </div>
  );
}

// ─── sub card (photo) ──────────────────────────────────────────────────────────

function SubCard({
  item,
  qty,
  onAdd,
  onRemove,
}: {
  item: CateringMenuItem;
  qty: number;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const priceDisplay =
    item.portionable && item.portionPricesCents
      ? `from ${money(item.portionPricesCents.whole)}`
      : isSized(item)
        ? `from ${money(item.unitPriceCents)}`
        : money(item.unitPriceCents);

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-3xl bg-co-bg text-co-text shadow-lg shadow-black/20">
      <div className="relative aspect-[4/3] overflow-hidden bg-co-text/10">
        <img
          src={subImage(item.name)}
          alt={item.name}
          loading="lazy"
          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
        />
        <div className="absolute right-3 top-3 rounded-full bg-co-text/90 px-3 py-1 text-sm font-extrabold text-co-gold backdrop-blur-sm">
          {priceDisplay}
        </div>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-lg font-extrabold">{item.name}</h3>
        {qty > 0 ? (
          <Stepper qty={qty} onAdd={onAdd} onRemove={onRemove} />
        ) : (
          <button
            onClick={onAdd}
            className="mt-3 inline-flex min-h-[44px] items-center gap-1 self-start rounded-full bg-co-text px-4 py-2 text-sm font-bold text-co-cta transition hover:gap-2"
          >
            Add to order <span aria-hidden>→</span>
          </button>
        )}
      </div>
    </article>
  );
}

// ─── compact row (sides / sweets / drinks) ────────────────────────────────────

function CompactRow({
  item,
  qty,
  onAdd,
  onRemove,
}: {
  item: CateringMenuItem;
  qty: number;
  onAdd: () => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-co-bg/15 pb-2.5 last:border-0">
      <div className="flex flex-1 flex-col">
        <span className="text-sm font-semibold text-co-bg/90">{item.name}</span>
        <span className="text-xs font-bold text-co-gold">{isSized(item) ? `from ${money(item.unitPriceCents)}` : money(item.unitPriceCents)}</span>
      </div>
      {qty > 0 ? (
        <div className="flex items-center gap-1.5">
          <button
            onClick={onRemove}
            aria-label={`Remove ${item.name}`}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-co-bg/30 text-co-bg/80 transition hover:border-co-bg"
          >
            −
          </button>
          <span className="min-w-[1.25rem] text-center text-sm font-bold tabular-nums text-co-bg">
            {qty}
          </span>
          <button
            onClick={onAdd}
            aria-label={`Add another ${item.name}`}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-co-gold text-co-text transition hover:bg-co-gold/90"
          >
            +
          </button>
        </div>
      ) : (
        <button
          onClick={onAdd}
          className="shrink-0 rounded-full bg-co-bg/15 px-3 py-1.5 text-xs font-bold text-co-bg transition hover:bg-co-bg/25"
        >
          Add
        </button>
      )}
    </li>
  );
}

// ─── main export ──────────────────────────────────────────────────────────────

export function StorefrontOrderTray({
  groups,
}: {
  groups: { label: string; items: CateringMenuItem[] }[];
}) {
  const router = useRouter();
  const [picks, setPicks] = useState<Picks>({});

  const key = (m: CateringMenuItem) => `${m.kind}:${m.id}`;

  function add(m: CateringMenuItem) {
    setPicks((prev) => {
      const k = key(m);
      const existing = prev[k];
      // A sized item carries its default (smallest) size id; the customer changes it on /order/build.
      const sizeId = m.sizes?.[0]?.id;
      return { ...prev, [k]: { kind: m.kind, id: m.id, name: m.name, qty: (existing?.qty ?? 0) + 1, ...(sizeId ? { sizeId } : {}) } };
    });
  }

  function remove(m: CateringMenuItem) {
    setPicks((prev) => {
      const k = key(m);
      const existing = prev[k];
      if (!existing || existing.qty <= 1) {
        const next = { ...prev };
        delete next[k];
        return next;
      }
      return { ...prev, [k]: { ...existing, qty: existing.qty - 1 } };
    });
  }

  const count = Object.values(picks).reduce((s, p) => s + p.qty, 0);

  function handlePillClick() {
    const preselect = Object.values(picks).map((x) =>
      x.kind === "menu_item"
        ? { menuItemId: x.id, quantity: x.qty }
        : { itemId: x.id, quantity: x.qty, ...(x.sizeId ? { sizeId: x.sizeId } : {}) },
    );
    try {
      window.sessionStorage.setItem(PRESELECT_KEY, JSON.stringify(preselect));
    } catch {
      // sessionStorage may be unavailable (private mode, storage full) — proceed anyway
    }
    router.push("/order/start");
  }

  const [subGroup, ...otherGroups] = groups;

  return (
    <>
      {/* ── Subs photo grid ─────────────────────────────────────────────── */}
      {subGroup && subGroup.items.length > 0 && (
        <section id="subs" className="bg-co-text py-16 text-co-bg">
          <div className="mx-auto max-w-6xl px-5">
            <div className="mb-9">
              <p className="text-xs font-bold uppercase tracking-[0.28em] text-co-gold">
                À la carte · 10&quot; subs
              </p>
              <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
                The ones people ask for by name.
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {subGroup.items.map((item) => (
                <SubCard
                  key={item.id}
                  item={item}
                  qty={picks[key(item)]?.qty ?? 0}
                  onAdd={() => add(item)}
                  onRemove={() => remove(item)}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Sides / Sweets / Drinks compact lists ───────────────────────── */}
      {otherGroups.some((g) => g.items.length > 0) && (
        <section className="bg-co-text py-16 text-co-bg">
          <div className="mx-auto max-w-6xl px-5">
            <div className="mb-9">
              <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
                Round it out.
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-10 md:grid-cols-3">
              {otherGroups.map(
                (group) =>
                  group.items.length > 0 && (
                    <div key={group.label}>
                      <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-co-gold">
                        {group.label}
                      </h3>
                      <ul className="flex flex-col gap-2">
                        {group.items.map((item) => (
                          <CompactRow
                            key={item.id}
                            item={item}
                            qty={picks[key(item)]?.qty ?? 0}
                            onAdd={() => add(item)}
                            onRemove={() => remove(item)}
                          />
                        ))}
                      </ul>
                    </div>
                  ),
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Floating pill ────────────────────────────────────────────────── */}
      <div
        className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 pb-[env(safe-area-inset-bottom)]"
        aria-live="polite"
      >
        <button
          onClick={handlePillClick}
          className="flex min-h-[52px] items-center gap-2 rounded-full bg-co-text px-6 py-3 text-sm font-bold text-co-cta shadow-2xl shadow-black/40 transition hover:-translate-y-0.5 hover:shadow-black/50 active:scale-95"
        >
          {count > 0 && (
            <span className="rounded-full bg-co-cta px-2 py-0.5 text-xs font-extrabold text-co-bg">
              {count} item{count === 1 ? "" : "s"}
            </span>
          )}
          Start your order →
        </button>
      </div>
    </>
  );
}
