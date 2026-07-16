"use client";
/**
 * GoodToKnow — the "good to know" companion that rides the order flow (mockup).
 *
 * A calm, auto-cycling strip that shows a fact or a mini-answer relevant to the current step —
 * the cohesion device across start → review → checkout → confirmation (the builder has its own
 * cart-aware ticker). Surfaces on its own; no click. FaqOpen is an always-open Q&A card for the
 * order flow (per the rule: FAQ surfaces naturally, not behind a click-to-expand).
 */

import { useEffect, useState } from "react";

export function GoodToKnow({ items, label = "Good to know", tone = "surface" }: { items: string[]; label?: string; tone?: "surface" | "gold" | "dark" }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (items.length <= 1) return;
    const t = window.setInterval(() => setI((x) => (x + 1) % items.length), 5000);
    return () => window.clearInterval(t);
  }, [items.length]);
  if (!items.length) return null;

  const wrap = tone === "dark"
    ? "bg-co-text text-co-bg"
    : tone === "gold"
      ? "border border-co-gold/40 bg-co-gold/10 text-co-text"
      : "border border-co-border/70 bg-co-surface text-co-text";
  const labelColor = tone === "dark" ? "text-co-gold" : "text-co-text-dim";
  const activeDot = tone === "dark" ? "bg-co-gold" : "bg-co-text";

  return (
    <div className={`rounded-2xl px-5 py-4 shadow-sm ${wrap}`}>
      <p className={`text-[11px] font-bold uppercase tracking-[0.18em] ${labelColor}`}>💡 {label}</p>
      <p key={i} className="mt-1.5 min-h-[2.75em] text-sm leading-snug transition-opacity duration-500">{items[i]}</p>
      {items.length > 1 && (
        <div className="mt-2 flex gap-1.5" aria-hidden>
          {items.map((_, x) => (
            <span key={x} className={`h-1.5 w-1.5 rounded-full transition ${x === i ? activeDot : tone === "dark" ? "bg-co-bg/30" : "bg-co-border-2"}`} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FaqOpen({ q, a }: { q: string; a: string }) {
  return (
    <div className="rounded-2xl border border-co-border/70 bg-co-surface p-4 shadow-sm">
      <p className="text-sm font-bold text-co-text">{q}</p>
      <p className="mt-1 text-sm text-co-text-muted">{a}</p>
    </div>
  );
}
